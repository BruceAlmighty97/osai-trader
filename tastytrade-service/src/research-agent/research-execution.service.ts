import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaperService } from '../paper/paper.service';
import { StrategyType } from '../persistence/persistence.types';
import { ResearchPlayEntity } from './research-play.entity';
import { ResearchRunEntity } from './research-run.entity';
import { ResearchPlay, ResearchReport } from './schemas';
import { occToStreamer } from './occ';

/**
 * Bridges a validated ResearchReport into the paper ledger.
 *
 * Three things happen here that are easy to get wrong:
 *
 * 1. **OCC -> streamer symbols.** The agent reports OCC ("META  260914P00625000");
 *    mark-to-market subscribes to DXLink (".META260914P625"). Without the
 *    conversion every agent-opened position would be permanently "unpriced" and
 *    the exit engine would never act on it.
 * 2. **Per-share vs per-contract.** The agent reports dollars per contract
 *    (maxLoss 450); PaperService wants per share (4.50). A missing /100 here is
 *    a 100x sizing error that the risk gate would dutifully approve.
 * 3. **Signed prices and multi-expiry.** Debit structures open at a NEGATIVE
 *    net price and calendars span two expirations. Both are passed through as-is
 *    rather than coerced with Math.abs or by taking legs[0] — either would book
 *    a fictional trade that looks plausible in the ledger.
 *
 * Every play is persisted whether or not it executes — scoring only the trades
 * that were taken tells you nothing about whether the gate is discarding good
 * ones.
 */
@Injectable()
export class ResearchExecutionService {
  private readonly logger = new Logger(ResearchExecutionService.name);

  private readonly requireDryRun: boolean;

  constructor(
    private readonly paper: PaperService,
    config: ConfigService,
    @InjectRepository(ResearchPlayEntity)
    private readonly plays: Repository<ResearchPlayEntity>,
    @InjectRepository(ResearchRunEntity)
    private readonly runs: Repository<ResearchRunEntity>,
  ) {
    // The REAL tastytrade account holds ~$250 while the research arm is a
    // $2,500 paper account, so a dry-run on any properly-sized play fails
    // preflight for buying power. Blocking on that would mean nothing ever
    // trades. The dry-run is still run and recorded — it is the only source of
    // real fees and BP numbers — but for a PAPER arm the paper risk gate is the
    // real constraint. Set RESEARCH_REQUIRE_DRY_RUN=true once the live account
    // is funded to at least the arm's size.
    this.requireDryRun =
      String(config.get('RESEARCH_REQUIRE_DRY_RUN') ?? 'false') === 'true';
  }

  async submit(
    runId: number,
    report: ResearchReport,
    arm: string,
  ): Promise<{ submitted: number; skipped: number }> {
    let submitted = 0;
    let skipped = 0;

    for (const play of report.plays) {
      const row = await this.plays.save(this.plays.create(this.toRow(runId, play)));
      const reject = (why: string) => {
        skipped++;
        this.logger.log(`research play #${row.id} ${play.underlying} NOT submitted — ${why}`);
        return this.plays.update(row.id, { rejectionReason: why });
      };

      if (!play.dryRunPassed) {
        if (this.requireDryRun) {
          await reject('dry run did not pass at the broker (RESEARCH_REQUIRE_DRY_RUN=true)');
          continue;
        }
        this.logger.warn(
          `research play ${play.underlying}: broker dry-run did not pass ` +
            `(BP effect $${play.buyingPowerEffect ?? '?'} vs a ~$250 live account) — ` +
            `proceeding anyway; the paper risk gate is the binding constraint for a paper arm`,
        );
      }

      const strategy = STRUCTURE_MAP[play.structure];
      if (!strategy) {
        await reject(`unknown structure "${play.structure}"`);
        continue;
      }

      // The agent reports per CONTRACT; the ledger stores per SHARE — except
      // maxProfit and maxRisk, which the ledger keeps in dollars per unit.
      // A missing /100 here is a 100x sizing error the risk gate would approve.
      const creditPerShare = round4(play.netCredit); // SIGNED: negative = debit
      const riskPerShare = round4(play.maxLoss / 100);
      if (!(riskPerShare > 0)) {
        await reject(`non-positive per-share risk (maxLoss ${play.maxLoss})`);
        continue;
      }

      let legs;
      try {
        legs = play.legs.map((l) => ({
          action: l.action,
          right: l.right,
          strike: l.strike,
          streamerSymbol: occToStreamer(l.occSymbol),
          expiration: l.expiration,
        }));
      } catch (err) {
        await reject(`unusable OCC symbol: ${err instanceof Error ? err.message : err}`);
        continue;
      }

      // A calendar's legs sit in different expirations; the position records the
      // FRONT one, because the front leg expiring is the event the DTE rule
      // cares about. Single-expiration spreads are unaffected.
      const frontExpiration = [...play.legs]
        .map((l) => l.expiration)
        .sort()[0];

      try {
        const position = await this.paper.openFromSuggestion({
          account: arm,
          symbol: play.underlying,
          strategy,
          expiration: frontExpiration,
          legs,
          // Signed: the ledger records a debit structure as negative.
          creditPerSpread: creditPerShare,
          maxRiskPerSpread: riskPerShare,
          maxProfitPerSpread: play.maxProfit,
          contracts: 1,
          notes:
            `research agent [${play.edgeType}/${play.conviction}]: ${play.thesis} ` +
            `— manage: ${play.managementPlan}` +
            (play.sources.length ? ` — sources: ${play.sources.slice(0, 3).join(' ')}` : ''),
        });
        await this.plays.update(row.id, { submittedPositionId: position.id });
        submitted++;
        const priced =
          play.netCredit >= 0
            ? `credit $${round4(play.netCredit * 100)}`
            : `debit $${round4(Math.abs(play.netCredit) * 100)}`;
        this.logger.log(
          `research play #${row.id} ${play.underlying} ${play.structure} SUBMITTED as ` +
            `position ${position.id} — ${priced} maxProfit $${play.maxProfit} risk $${play.maxLoss} ` +
            `exp ${frontExpiration}${
              new Set(play.legs.map((l) => l.expiration)).size > 1 ? ' (multi-expiry)' : ''
            } (${play.edgeType}, POP ${play.probabilityOfProfit})`,
        );
      } catch (err) {
        // Risk-gate rejections land here and are an expected outcome.
        await reject(err instanceof Error ? err.message : String(err));
      }
    }

    await this.runs.update(runId, { playsSubmitted: submitted });
    this.logger.log(
      `research run ${runId}: ${submitted} play(s) submitted to arm "${arm}", ${skipped} skipped`,
    );
    return { submitted, skipped };
  }

  private toRow(runId: number, p: ResearchPlay): Partial<ResearchPlayEntity> {
    return {
      runId,
      underlying: p.underlying,
      structure: p.structure,
      edgeType: p.edgeType,
      legs: p.legs as unknown as Record<string, unknown>[],
      netCredit: p.netCredit,
      maxLoss: p.maxLoss,
      maxProfit: p.maxProfit,
      probabilityOfProfit: p.probabilityOfProfit,
      buyingPowerEffect: p.buyingPowerEffect,
      estimatedFees: p.estimatedFees,
      dryRunPassed: p.dryRunPassed,
      conviction: p.conviction,
      thesis: p.thesis,
      managementPlan: p.managementPlan,
      catalysts: p.catalysts,
      risks: p.risks,
      sources: p.sources,
      ivContext: p.ivContext as unknown as Record<string, unknown>,
    };
  }
}

/**
 * Every structure the agent can propose now maps to the ledger.
 *
 * Condors needed nothing at all — four legs fit in the jsonb, they share one
 * expiration, and total-credit-in/total-debit-out is the correct realization.
 * Debit spreads and calendars needed the ledger to carry SIGNED entry prices, a
 * stored max profit, and per-leg expirations; see migration 1788700000000.
 */
const STRUCTURE_MAP: Record<string, StrategyType> = {
  put_credit_spread: StrategyType.BULL_PUT_SPREAD,
  call_credit_spread: StrategyType.BEAR_CALL_SPREAD,
  iron_condor: StrategyType.IRON_CONDOR,
  call_debit_spread: StrategyType.CALL_DEBIT_SPREAD,
  put_debit_spread: StrategyType.PUT_DEBIT_SPREAD,
  calendar: StrategyType.CALENDAR,
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
