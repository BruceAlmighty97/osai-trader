import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';
import { ShortlistCandidate, TradingDayEntity } from './trading-day.entity';
import { TastytradeService } from '../tastytrade/tastytrade.service';
import { PaperService } from '../paper/paper.service';
import { StrategyType } from '../persistence/persistence.types';

/** A concrete spread the selector built from live chain data. */
interface SpreadPlan {
  symbol: string;
  expiration: string;
  dte: number;
  underlyingPrice: number;
  shortStrike: number;
  longStrike: number;
  shortDelta: number;
  width: number;
  /** Net credit per share (short mid − long mid). */
  credit: number;
  /** Defined risk per share = width − credit. */
  riskPerShare: number;
  creditToWidth: number;
}

/**
 * 10:00-11:30 ET, every 15 min — open the single best play, or pass.
 *
 * MECHANICAL for now: no LLM. Rule-based bull put spread — short strike nearest a
 * target delta, long strike a risk-budgeted width below, priced at mids. This is
 * deliberately the baseline the AI analyst will later have to BEAT; swapping
 * selectSpread() for a bounded AI call is the only change that layer needs.
 *
 * Polling != over-trading: each tick opens at most one position and the risk gate
 * caps the ceiling, so later ticks in the window usually pass.
 */
@Injectable()
export class EntryService {
  private readonly logger = new Logger(EntryService.name);
  private readonly targetDelta: number;
  private readonly widthPct: number;
  private readonly minCreditToWidth: number;
  private readonly targetDte: number;
  private readonly maxNewPerRun: number;
  private readonly maxQuoteSpreadPct: number;

  constructor(
    @InjectRepository(TradingDayEntity)
    private readonly days: Repository<TradingDayEntity>,
    private readonly tastytrade: TastytradeService,
    private readonly paper: PaperService,
    config: ConfigService,
  ) {
    this.targetDelta = num(config.get('ENTRY_TARGET_DELTA'), 0.16);
    this.widthPct = num(config.get('ENTRY_WIDTH_PCT'), 0.05);
    this.minCreditToWidth = num(config.get('ENTRY_MIN_CREDIT_RATIO'), 0.15);
    this.targetDte = num(config.get('ENTRY_TARGET_DTE'), 45);
    this.maxNewPerRun = num(config.get('ENTRY_MAX_NEW_PER_RUN'), 1);
    this.maxQuoteSpreadPct = num(config.get('ENTRY_MAX_QUOTE_SPREAD_PCT'), 0.5);
  }

  async run(ctx: PhaseContext): Promise<PhaseResult> {
    const date = etDate(ctx.now);
    const day = await this.days.findOne({ where: { date } });
    if (!day || !day.shortlist?.length) {
      const msg = `no shortlist for ${date} — has pre-market run today?`;
      this.logger.warn(`entry: ${msg}`);
      return { phase: TradingPhase.ENTRY, ran: false, summary: msg };
    }

    const account = await this.paper.getSummary();
    const open = await this.paper.listPositions(undefined);
    const heldSymbols = new Set(
      open.filter((p) => p.status === 'open').map((p) => p.symbol),
    );
    const riskBudget =
      (account.settledValue * account.rules.maxRiskPerTradePct) / 100;

    this.logger.log(
      `entry ${date}: ${day.shortlist.length} candidates | open=${heldSymbols.size}/` +
        `${account.rules.maxConcurrentPositions} | bpAvail=$${account.buyingPowerAvailable} | ` +
        `riskBudget=$${round2(riskBudget)} | targetDelta=${this.targetDelta} dte~${this.targetDte}`,
    );

    if (heldSymbols.size >= account.rules.maxConcurrentPositions) {
      const msg = `at max concurrent positions (${account.rules.maxConcurrentPositions}) — passing`;
      this.logger.log(`entry: ${msg}`);
      return { phase: TradingPhase.ENTRY, ran: false, summary: msg };
    }

    let opened = 0;
    const attempts: string[] = [];

    for (const c of day.shortlist) {
      if (opened >= this.maxNewPerRun) {
        this.logger.log(
          `entry: reached max new positions per run (${this.maxNewPerRun}) — stopping`,
        );
        break;
      }
      if (heldSymbols.has(c.symbol)) {
        this.logger.debug(`entry: ${c.symbol} skipped — already held`);
        continue;
      }

      let plan: SpreadPlan | null;
      try {
        plan = await this.selectSpread(c, riskBudget);
      } catch (err) {
        this.logger.warn(`entry: ${c.symbol} chain lookup failed — ${errMsg(err)}`);
        attempts.push(`${c.symbol}:chain-error`);
        continue;
      }
      if (!plan) {
        attempts.push(`${c.symbol}:no-viable-spread`);
        continue;
      }

      this.logger.log(
        `entry: ${plan.symbol} candidate — ${plan.shortStrike}/${plan.longStrike}P ` +
          `exp ${plan.expiration} (${plan.dte}d) spot ${plan.underlyingPrice} ` +
          `shortDelta ${plan.shortDelta.toFixed(3)} width ${plan.width} ` +
          `credit ${plan.credit.toFixed(2)} (${(plan.creditToWidth * 100).toFixed(0)}% of width) ` +
          `risk $${round2(plan.riskPerShare * 100)}`,
      );

      // PaperService runs the deterministic risk gate; a rejection is normal.
      try {
        const position = await this.paper.openFromSuggestion({
          symbol: plan.symbol,
          strategy: StrategyType.BULL_PUT_SPREAD,
          expiration: plan.expiration,
          legs: [
            { action: 'Sell to Open', right: 'P', strike: plan.shortStrike },
            { action: 'Buy to Open', right: 'P', strike: plan.longStrike },
          ],
          creditPerSpread: round2(plan.credit),
          maxRiskPerSpread: round2(plan.riskPerShare),
          contracts: 1,
          notes:
            `mechanical entry: shortDelta ${plan.shortDelta.toFixed(3)}, ` +
            `width ${plan.width}, credit/width ${(plan.creditToWidth * 100).toFixed(0)}%, ` +
            `IVR ${c.ivRank}, sentiment +${c.bullish}/-${c.bearish}`,
        });
        opened += 1;
        heldSymbols.add(plan.symbol);
        attempts.push(`${plan.symbol}:OPENED#${position.id}`);
        this.logger.log(
          `entry: OPENED ${plan.symbol} id=${position.id} ` +
            `credit $${round2(plan.credit * 100)} risk $${round2(plan.riskPerShare * 100)}`,
        );
      } catch (err) {
        // Risk gate rejections land here and are expected, not failures.
        this.logger.log(`entry: ${plan.symbol} not opened — ${errMsg(err)}`);
        attempts.push(`${plan.symbol}:gate-rejected`);
      }
    }

    const summary =
      opened > 0
        ? `opened ${opened} position(s): ${attempts.filter((a) => a.includes('OPENED')).join(', ')}`
        : `no position opened (evaluated ${attempts.length} candidates)`;
    this.logger.log(`entry ${date}: ${summary}`);

    return {
      phase: TradingPhase.ENTRY,
      ran: opened > 0,
      summary,
      details: { date, opened, attempts },
    };
  }

  /**
   * Mechanical strike selection. Short strike = OTM put nearest the target delta;
   * long strike sits `width` below, where width is the risk budget capped by a
   * percentage of spot and snapped to the chain's strike increment.
   *
   * This is the seam the AI analyst replaces later.
   */
  private async selectSpread(
    c: ShortlistCandidate,
    riskBudget: number,
  ): Promise<SpreadPlan | null> {
    // Wide window: the long leg sits well below the short strike, and a narrow
    // window silently has no long leg to pair with.
    const snap: any = await this.tastytrade.getGreeksSnapshot(
      c.symbol,
      this.targetDte,
      25,
      8,
    );
    const spot = Number(snap?.underlyingPrice);
    const contracts: any[] = snap?.contracts ?? [];
    if (!spot || contracts.length < 2) {
      this.logger.warn(`entry: ${c.symbol} — no usable chain snapshot`);
      return null;
    }

    // OTM puts with a live two-sided quote and a delta.
    const puts = contracts
      .filter((x) => x?.put && x.strike < spot)
      .map((x) => ({
        strike: Number(x.strike),
        delta: Number(x.put.delta),
        bid: Number(x.put.bid),
        ask: Number(x.put.ask),
      }))
      .filter(
        (p) =>
          Number.isFinite(p.delta) &&
          Number.isFinite(p.bid) &&
          Number.isFinite(p.ask) &&
          p.ask > 0,
      )
      .sort((a, b) => b.strike - a.strike);

    if (puts.length < 2) {
      this.logger.warn(
        `entry: ${c.symbol} — only ${puts.length} quotable OTM puts, skipping`,
      );
      return null;
    }

    // Short strike: closest |delta| to target.
    const short = puts.reduce((best, p) =>
      Math.abs(Math.abs(p.delta) - this.targetDelta) <
      Math.abs(Math.abs(best.delta) - this.targetDelta)
        ? p
        : best,
    );

    // Width: risk-budgeted and capped by % of spot. Don't demand an exact strike
    // — quotes are sparse (thin books, holidays), so take the WIDEST strike that
    // still fits the budget. Wider = more credit for the same risk ceiling.
    const maxWidth = Math.min(riskBudget / 100, spot * this.widthPct);
    const long = puts
      .filter((p) => p.strike < short.strike)
      .filter((p) => short.strike - p.strike <= maxWidth)
      .sort((a, b) => a.strike - b.strike)[0]; // lowest strike = widest spread
    if (!long) {
      const nearest = puts.find((p) => p.strike < short.strike);
      this.logger.warn(
        `entry: ${c.symbol} — no long strike within budget ` +
          `(short ${short.strike}, maxWidth ${round2(maxWidth)}, ` +
          `nearest below ${nearest ? nearest.strike : 'none'})`,
      );
      return null;
    }

    // Stale/illiquid quote guard — a holiday or thin book gives garbage mids.
    for (const [label, leg] of [
      ['short', short],
      ['long', long],
    ] as const) {
      const mid = (leg.bid + leg.ask) / 2;
      if (mid <= 0 || (leg.ask - leg.bid) / mid > this.maxQuoteSpreadPct) {
        this.logger.warn(
          `entry: ${c.symbol} — ${label} leg ${leg.strike}P quote too wide ` +
            `(${leg.bid}/${leg.ask}); skipping`,
        );
        return null;
      }
    }

    const credit = (short.bid + short.ask) / 2 - (long.bid + long.ask) / 2;
    const actualWidth = round2(short.strike - long.strike);
    const creditToWidth = credit / actualWidth;

    if (credit <= 0) {
      this.logger.warn(`entry: ${c.symbol} — non-positive credit, skipping`);
      return null;
    }
    if (creditToWidth < this.minCreditToWidth) {
      this.logger.log(
        `entry: ${c.symbol} — credit/width ${(creditToWidth * 100).toFixed(0)}% ` +
          `below ${(this.minCreditToWidth * 100).toFixed(0)}%, poor risk/reward — skipping`,
      );
      return null;
    }

    return {
      symbol: c.symbol,
      expiration: String(snap.expiration),
      dte: Number(snap.dte),
      underlyingPrice: spot,
      shortStrike: short.strike,
      longStrike: long.strike,
      shortDelta: short.delta,
      width: actualWidth,
      credit,
      riskPerShare: round2(actualWidth - credit),
      creditToWidth,
    };
  }
}

function etDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
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
