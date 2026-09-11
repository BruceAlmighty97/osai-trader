import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';
import { PaperService } from '../paper/paper.service';
import { MarkToMarketService } from '../paper/mark-to-market.service';
import { PositionValuation } from '../paper/paper.types';
import { ExitReason } from '../persistence/persistence.types';

/** A rule firing on one position, with the numbers that fired it. */
interface ExitVerdict {
  reason: ExitReason;
  why: string;
}

/** What one arm did this manage tick. */
interface ArmManageOutcome {
  arm: string;
  closed: number;
  held: number;
  unpriced: number;
  realized: number;
  summary: string;
}

/**
 * 12:30 + 15:00-15:45 ET — value every open position and close what the rules
 * say. The exit half of the strategy, and the half that actually books P&L:
 * until a position closes, an arm's settled value never moves.
 *
 * Deterministic and idempotent. A position is closed at most once because
 * PaperService.close() rejects anything not currently OPEN, so a double tick
 * cannot double-book.
 *
 * Rules, in firing order (first match wins, and the order is the priority):
 *
 *   1. STOP LOSS   — unrealized loss >= stopMultiple x MAX PROFIT. For a credit
 *                    spread that is the familiar "2x the credit received";
 *                    stated against max profit it is also correct for debit
 *                    structures, whose entry price is a cost, not a maximum
 *                    gain. Risk control outranks everything; take the loss.
 *   2. PROFIT      — captured >= profitTargetPct of max profit. The tastytrade
 *                    200k-trade result: harvesting at 50% beats holding to
 *                    expiry on both win rate and risk-adjusted return, because
 *                    the last 50% of decay costs you weeks of gamma exposure.
 *   3. DTE         — at/inside dteThreshold days. Gamma ramps hard into the
 *                    final weeks; exit regardless of P&L.
 *
 * Every threshold is per-arm overridable (ArmConfig), so exit policy is an A/B
 * variable exactly like entry policy.
 *
 * The AI is deliberately NOT here yet. Exits are where a model can do the most
 * damage — the rules are cheap, well-evidenced and unambiguous, so code owns
 * them. The future seam is judgment on the PROFIT and DTE cases only (take /
 * hold / roll); the stop is never negotiable.
 */
@Injectable()
export class ManagementService {
  private readonly logger = new Logger(ManagementService.name);
  private readonly profitTargetPct: number;
  private readonly stopMultiple: number;
  private readonly dteThreshold: number;

  constructor(
    private readonly paper: PaperService,
    private readonly mtm: MarkToMarketService,
    config: ConfigService,
  ) {
    this.profitTargetPct = num(config.get('MANAGE_PROFIT_TARGET_PCT'), 0.5);
    this.stopMultiple = num(config.get('MANAGE_STOP_MULTIPLE'), 2);
    this.dteThreshold = num(config.get('MANAGE_DTE_THRESHOLD'), 21);
    this.logger.log(
      `manage defaults: profitTarget=${this.profitTargetPct} ` +
        `stopMultiple=${this.stopMultiple}x dteThreshold=${this.dteThreshold}d ` +
        `(arms may override any of these)`,
    );
  }

  async run(ctx: PhaseContext): Promise<PhaseResult> {
    // One batched re-quote covering every leg of every arm.
    const valuation = await this.mtm.valueAll(null);
    const arms = await this.paper.listArms(true);
    const byName = new Map(arms.map((a) => [a.name, a]));

    const outcomes: ArmManageOutcome[] = [];
    let closedTotal = 0;

    for (const armVal of valuation.arms) {
      const arm = byName.get(armVal.name);
      if (!arm) continue; // disabled arm — leave its book alone

      const cfg = arm.config ?? {};
      const thresholds = {
        profitTargetPct: num(cfg.profitTargetPct, this.profitTargetPct),
        stopMultiple: num(cfg.stopMultiple, this.stopMultiple),
        dteThreshold: num(cfg.dteThreshold, this.dteThreshold),
      };
      const tag = `manage[${armVal.name}]`;

      if (!armVal.positions.length) {
        this.logger.debug(`${tag}: no open positions`);
        outcomes.push({
          arm: armVal.name,
          closed: 0,
          held: 0,
          unpriced: 0,
          realized: 0,
          summary: 'no open positions',
        });
        continue;
      }

      let closed = 0;
      let held = 0;
      let unpriced = 0;
      let realized = 0;

      for (const pos of armVal.positions) {
        // Never act on a position we could not price. A missing quote is not a
        // signal, and closing on invented numbers writes phantom P&L forever.
        if (pos.currentDebit === null || pos.pctOfMaxProfit === null) {
          unpriced += 1;
          this.logger.warn(
            `${tag}: #${pos.positionId} ${pos.symbol} UNPRICED — holding ` +
              `(no usable quote; exit rules cannot be evaluated)`,
          );
          continue;
        }

        const verdict = this.classify(pos, thresholds);
        if (!verdict) {
          held += 1;
          this.logger.log(
            `${tag}: #${pos.positionId} ${pos.symbol} HOLD — ` +
              `${(pos.pctOfMaxProfit * 100).toFixed(0)}% of max ` +
              `(target ${(thresholds.profitTargetPct * 100).toFixed(0)}%), ` +
              `P&L $${pos.unrealizedPnl} of $${pos.maxProfit ?? '?'} max ` +
              `(stop at $${pos.maxProfit ? round2(-thresholds.stopMultiple * pos.maxProfit) : '?'}), ` +
              `${pos.dte}d left (roll at ${thresholds.dteThreshold}d)`,
          );
          continue;
        }

        try {
          const saved = await this.paper.close(pos.positionId, {
            closeDebitPerSpread: pos.currentDebit,
            exitReason: verdict.reason,
          });
          closed += 1;
          closedTotal += 1;
          realized += Number(saved.realizedPnl ?? 0);
          this.logger.log(
            `${tag}: #${pos.positionId} ${pos.symbol} CLOSED ${verdict.reason} — ` +
              `${verdict.why} | debit ${pos.currentDebit} vs credit ${pos.entryCredit} ` +
              `-> realized $${saved.realizedPnl}`,
          );
        } catch (err) {
          // Already closed by a concurrent tick, or a validation failure.
          this.logger.warn(
            `${tag}: #${pos.positionId} ${pos.symbol} close failed — ${errMsg(err)}`,
          );
        }
      }

      const summary =
        closed > 0
          ? `closed ${closed} (realized $${round2(realized)}), held ${held}`
          : `held ${held}${unpriced ? `, ${unpriced} unpriced` : ''}`;
      this.logger.log(`${tag}: ${summary}`);
      outcomes.push({
        arm: armVal.name,
        closed,
        held,
        unpriced,
        realized: round2(realized),
        summary,
      });
    }

    const summary = outcomes.map((o) => `${o.arm}: ${o.summary}`).join(' | ');
    this.logger.log(`manage (${ctx.trigger}): ${summary}`);

    return {
      phase: TradingPhase.MANAGE,
      ran: closedTotal > 0,
      summary,
      details: { closed: closedTotal, arms: outcomes },
    };
  }

  /**
   * First rule to fire wins, and the order encodes the priority: a position at
   * both its stop and its DTE limit is recorded as a stop, because that is the
   * fact worth knowing when reading the journal later.
   */
  private classify(
    pos: PositionValuation,
    t: { profitTargetPct: number; stopMultiple: number; dteThreshold: number },
  ): ExitVerdict | null {
    const debit = pos.currentDebit as number;
    const captured = pos.pctOfMaxProfit as number;

    // STOP expressed against MAX PROFIT, not the entry credit.
    //
    // "2x the credit received" is the familiar formulation, but it only makes
    // sense for a credit structure, where max profit IS the credit. Stated as
    // "unrealized loss >= stopMultiple x max profit" it is arithmetically the
    // same rule for a credit spread and also correct for a debit spread, where
    // the entry price is a cost rather than a maximum gain. The old form
    // compared a debit-spread's cost-to-close against a NEGATIVE entryCredit
    // and could never fire.
    if (pos.maxProfit !== null && pos.maxProfit > 0 && pos.unrealizedPnl !== null) {
      const stopAtLoss = -t.stopMultiple * pos.maxProfit;
      if (pos.unrealizedPnl <= stopAtLoss) {
        return {
          reason: ExitReason.STOP_LOSS,
          why:
            `unrealized $${round2(pos.unrealizedPnl)} <= ${t.stopMultiple}x max profit ` +
            `($${round2(stopAtLoss)}); cost to close ${debit} vs entry ${pos.entryCredit}`,
        };
      }
    }

    if (captured >= t.profitTargetPct) {
      return {
        reason: ExitReason.PROFIT_TARGET,
        why:
          `captured ${(captured * 100).toFixed(0)}% of max profit ` +
          `>= ${(t.profitTargetPct * 100).toFixed(0)}% target`,
      };
    }

    if (pos.dte !== null && pos.dte <= t.dteThreshold) {
      return {
        reason: ExitReason.DTE_ROLL,
        why: `${pos.dte}d to expiration <= ${t.dteThreshold}d gamma threshold`,
      };
    }

    return null;
  }
}

function num(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
