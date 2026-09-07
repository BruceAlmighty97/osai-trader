import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';
import { ShortlistCandidate, TradingDayEntity } from './trading-day.entity';
import { ScoreParts, SelectorChoice, SpreadPlan } from './entry.types';
import { EntryAnalystService } from './entry-analyst.service';
import { TastytradeService } from '../tastytrade/tastytrade.service';
import { PaperService } from '../paper/paper.service';
import { DecisionEntity } from '../persistence/entities/decision.entity';
import {
  DecisionTrigger,
  PositionStatus,
  StrategyType,
} from '../persistence/persistence.types';

/** A priced spread before scoring — everything except the score itself. */
type UnscoredPlan = Omit<SpreadPlan, 'score' | 'scoreParts'>;

/**
 * 10:00-11:30 ET, every 15 min — open the single best play, or pass.
 *
 * Two stages, deliberately separated:
 *
 *   1. BUILD A SLATE (always mechanical). Take the top N candidates off the
 *      pre-market shortlist, pull their chains IN PARALLEL, construct a concrete
 *      bull put spread for each, and score them 0-100 on hard economics. All
 *      arithmetic lives here and only here.
 *   2. CHOOSE ONE (mechanical or AI, per ENTRY_SELECTOR). The mechanical
 *      selector takes the top score. The AI selector gets the same slate plus
 *      the open book and applies judgment the score cannot express — chiefly
 *      whether a candidate duplicates exposure we already carry.
 *
 * The baseline pick is logged on every run whether or not the AI is driving, so
 * the AI's lift over the mechanical score is measurable rather than assumed.
 *
 * Polling != over-trading: each tick opens at most one position and the risk
 * gate caps the ceiling, so later ticks in the window usually pass.
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
  private readonly slateSize: number;
  private readonly selector: 'mechanical' | 'ai';

  constructor(
    @InjectRepository(TradingDayEntity)
    private readonly days: Repository<TradingDayEntity>,
    @InjectRepository(DecisionEntity)
    private readonly decisions: Repository<DecisionEntity>,
    private readonly tastytrade: TastytradeService,
    private readonly paper: PaperService,
    private readonly analyst: EntryAnalystService,
    config: ConfigService,
  ) {
    this.targetDelta = num(config.get('ENTRY_TARGET_DELTA'), 0.16);
    this.widthPct = num(config.get('ENTRY_WIDTH_PCT'), 0.05);
    this.minCreditToWidth = num(config.get('ENTRY_MIN_CREDIT_RATIO'), 0.15);
    this.targetDte = num(config.get('ENTRY_TARGET_DTE'), 45);
    this.maxNewPerRun = num(config.get('ENTRY_MAX_NEW_PER_RUN'), 1);
    this.maxQuoteSpreadPct = num(config.get('ENTRY_MAX_QUOTE_SPREAD_PCT'), 0.5);
    this.slateSize = num(config.get('ENTRY_SLATE_SIZE'), 5);
    this.selector =
      String(config.get('ENTRY_SELECTOR') ?? 'mechanical').toLowerCase() === 'ai'
        ? 'ai'
        : 'mechanical';
    this.logger.log(
      `entry configured: selector=${this.selector} slateSize=${this.slateSize} ` +
        `targetDelta=${this.targetDelta} targetDte=${this.targetDte} ` +
        `minCreditToWidth=${this.minCreditToWidth} maxNewPerRun=${this.maxNewPerRun}`,
    );
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
    const open = await this.paper.listPositions(PositionStatus.OPEN);
    const heldSymbols = new Set(open.map((p) => p.symbol));
    const riskBudget =
      (account.settledValue * account.rules.maxRiskPerTradePct) / 100;

    this.logger.log(
      `entry ${date}: ${day.shortlist.length} candidates | open=${heldSymbols.size}/` +
        `${account.rules.maxConcurrentPositions} | bpAvail=$${account.buyingPowerAvailable} | ` +
        `riskBudget=$${round2(riskBudget)} | selector=${this.selector}`,
    );

    if (heldSymbols.size >= account.rules.maxConcurrentPositions) {
      const msg = `at max concurrent positions (${account.rules.maxConcurrentPositions}) — passing`;
      this.logger.log(`entry: ${msg}`);
      return { phase: TradingPhase.ENTRY, ran: false, summary: msg };
    }

    // ---- Stage 1: build and score the slate -------------------------------
    const { slate, misses } = await this.buildSlate(day.shortlist, heldSymbols, riskBudget);
    if (!slate.length) {
      const msg = `no viable spread on any of ${misses.length} candidate(s) examined`;
      this.logger.log(`entry ${date}: ${msg}`);
      return {
        phase: TradingPhase.ENTRY,
        ran: false,
        summary: msg,
        details: { date, opened: 0, attempts: misses },
      };
    }

    // ---- Stage 2: choose one ----------------------------------------------
    const choice = await this.chooseFromSlate(date, slate, account, open, riskBudget);
    const decision = await this.recordDecision(date, slate, choice);

    if (choice.pick === null) {
      const msg = `passed on all ${slate.length} plan(s) — ${choice.rationale}`;
      this.logger.log(`entry ${date}: ${msg}`);
      return {
        phase: TradingPhase.ENTRY,
        ran: false,
        summary: msg,
        details: { date, opened: 0, decisionId: decision.id, attempts: misses },
      };
    }

    // ---- Open, falling through by score if the risk gate rejects ----------
    const attempts = [...misses];
    const order = [
      choice.pick,
      ...slate.map((_, i) => i).filter((i) => i !== choice.pick),
    ];
    let opened = 0;
    let openedId: number | null = null;

    for (const idx of order) {
      if (opened >= this.maxNewPerRun) break;
      const plan = slate[idx];
      const isFallback = idx !== choice.pick;
      if (isFallback) {
        this.logger.log(
          `entry: falling back to next-best ${plan.symbol} (score ${plan.score.toFixed(1)}) ` +
            `after the risk gate rejected ${slate[choice.pick].symbol}`,
        );
      }

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
          decisionId: decision.id,
          notes: this.buildNotes(plan, choice, isFallback ? slate[choice.pick] : null),
        });
        opened += 1;
        openedId = position.id;
        attempts.push(`${plan.symbol}:OPENED#${position.id}`);
        this.logger.log(
          `entry: OPENED ${plan.symbol} id=${position.id} score ${plan.score.toFixed(1)} ` +
            `credit $${round2(plan.credit * 100)} risk $${round2(plan.riskPerShare * 100)} ` +
            `decision=${decision.id}`,
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
        : `no position opened (${slate.length} plan(s) scored, all rejected by the risk gate)`;
    this.logger.log(`entry ${date}: ${summary}`);

    return {
      phase: TradingPhase.ENTRY,
      ran: opened > 0,
      summary,
      details: {
        date,
        opened,
        openedId,
        decisionId: decision.id,
        selector: choice.source,
        attempts,
      },
    };
  }

  /**
   * Price every eligible candidate CONCURRENTLY and score the survivors.
   *
   * Parallelism is the whole point: each chain snapshot is an ~8s DXLink
   * subscription, so scoring five sequentially would cost 40s of a 15-minute
   * tick and tempt us back into first-fit. Each `streamSnapshot` builds its own
   * streamer and listeners, so the calls are independent.
   */
  private async buildSlate(
    shortlist: ShortlistCandidate[],
    heldSymbols: Set<string>,
    riskBudget: number,
  ): Promise<{ slate: SpreadPlan[]; misses: string[] }> {
    const eligible = shortlist
      .filter((c) => !heldSymbols.has(c.symbol))
      .slice(0, this.slateSize);

    const skipped = shortlist.length - shortlist.filter((c) => !heldSymbols.has(c.symbol)).length;
    this.logger.log(
      `entry: pricing top ${eligible.length} of ${shortlist.length} candidates in parallel ` +
        `(${skipped} skipped as already held) — ${eligible.map((c) => c.symbol).join(', ')}`,
    );

    const started = Date.now();
    const settled = await Promise.allSettled(
      eligible.map((c) => this.selectSpread(c, riskBudget)),
    );

    const slate: SpreadPlan[] = [];
    const misses: string[] = [];
    settled.forEach((r, i) => {
      const symbol = eligible[i].symbol;
      if (r.status === 'rejected') {
        this.logger.warn(`entry: ${symbol} chain lookup failed — ${errMsg(r.reason)}`);
        misses.push(`${symbol}:chain-error`);
      } else if (!r.value) {
        misses.push(`${symbol}:no-viable-spread`);
      } else {
        slate.push(this.scorePlan(r.value));
      }
    });

    slate.sort((a, b) => b.score - a.score);

    this.logger.log(
      `entry: priced ${eligible.length} candidate(s) in ${Date.now() - started}ms — ` +
        `${slate.length} viable, ${misses.length} dropped`,
    );
    slate.forEach((p, i) => {
      this.logger.log(
        `entry:   [${i}] ${p.symbol} score ${p.score.toFixed(1)} | ` +
          `${p.shortStrike}/${p.longStrike}P ${p.expiration} (${p.dte}d) | ` +
          `credit $${round2(p.credit * 100)} risk $${round2(p.riskPerShare * 100)} ` +
          `c/w ${(p.creditToWidth * 100).toFixed(0)}% | delta ${p.shortDelta.toFixed(3)} | ` +
          `IVR ${p.ivRank ?? 'n/a'} | qspread ${(p.avgRelSpread * 100).toFixed(1)}% | ` +
          `parts r/r=${p.scoreParts.creditToWidth.toFixed(2)} d=${p.scoreParts.deltaFit.toFixed(2)} ` +
          `ivr=${p.scoreParts.ivRank.toFixed(2)} liq=${p.scoreParts.liquidity.toFixed(2)}`,
      );
    });

    return { slate, misses };
  }

  /**
   * Deterministic 0-100 score on hard economics only.
   *
   * Sentiment is deliberately NOT weighted here: it is noisy retail chatter and
   * baking a coefficient for it would be false precision. It is handed to the
   * AI selector instead, where a qualitative read belongs.
   */
  private scorePlan(p: UnscoredPlan): SpreadPlan {
    const parts: ScoreParts = {
      // 35% of width is an excellent credit for a defined-risk spread; the 15%
      // floor is already enforced upstream, so this band is the useful range.
      creditToWidth: clamp01(p.creditToWidth / 0.35),
      // Chain granularity means the achieved delta drifts off target. At target
      // = 1.0; off by a full target's worth = 0.
      deltaFit:
        1 -
        clamp01(
          Math.abs(Math.abs(p.shortDelta) - this.targetDelta) / this.targetDelta,
        ),
      // IV rank 30 is the qualification floor and 80+ is genuinely rich premium;
      // map that band rather than 0-100, which would compress all real signal.
      ivRank: clamp01(((p.ivRank ?? 30) - 30) / 50),
      // Quote tightness relative to the threshold that would have rejected it.
      liquidity: 1 - clamp01(p.avgRelSpread / this.maxQuoteSpreadPct),
    };

    const score =
      100 *
      (0.45 * parts.creditToWidth +
        0.2 * parts.deltaFit +
        0.2 * parts.ivRank +
        0.15 * parts.liquidity);

    return { ...p, score, scoreParts: parts };
  }

  /** Mechanical top-score, or the AI analyst when ENTRY_SELECTOR=ai. */
  private async chooseFromSlate(
    date: string,
    slate: SpreadPlan[],
    account: Awaited<ReturnType<PaperService['getSummary']>>,
    open: Awaited<ReturnType<PaperService['listPositions']>>,
    riskBudget: number,
  ): Promise<SelectorChoice> {
    const baseline = slate[0];

    let choice: SelectorChoice;
    if (this.selector === 'ai') {
      choice = await this.analyst.choose({ date, slate, account, open, riskBudget });
    } else {
      choice = {
        source: 'mechanical',
        pick: 0,
        rationale: `Highest deterministic score (${baseline.score.toFixed(1)}/100)`,
      };
    }

    // Always record what the mechanical baseline WOULD have done. Without this
    // line there is no way to tell later whether the AI earned its keep.
    this.logger.log(
      `entry: baseline (mechanical) pick = ${baseline.symbol} @ ${baseline.score.toFixed(1)}`,
    );
    if (choice.source === 'ai') {
      if (choice.pick === null) {
        this.logger.log(
          `entry: AI DIVERGED from baseline — passed on the whole slate ` +
            `(baseline would have opened ${baseline.symbol})`,
        );
      } else if (choice.pick !== 0) {
        const picked = slate[choice.pick];
        this.logger.log(
          `entry: AI DIVERGED from baseline — chose ${picked.symbol} ` +
            `(${picked.score.toFixed(1)}) over ${baseline.symbol} (${baseline.score.toFixed(1)})`,
        );
      } else {
        this.logger.log(`entry: AI AGREED with baseline (${baseline.symbol})`);
      }
    }

    return choice;
  }

  /** Durable audit row: the slate, the choice, and the reasoning behind it. */
  private async recordDecision(
    date: string,
    slate: SpreadPlan[],
    choice: SelectorChoice,
  ): Promise<DecisionEntity> {
    const picked = choice.pick === null ? null : slate[choice.pick];
    const decision = this.decisions.create({
      symbol: picked?.symbol ?? null,
      trigger: DecisionTrigger.CRON,
      strategy: picked ? StrategyType.BULL_PUT_SPREAD : 'no_trade',
      marketAssessment: choice.portfolioFit ?? null,
      rationale: choice.rationale,
      proposedTrade: picked ? ({ ...picked } as Record<string, unknown>) : null,
      snapshot: {
        date,
        selector: choice.source,
        baseline: { symbol: slate[0].symbol, score: slate[0].score },
        slate: slate as unknown as Record<string, unknown>[],
        concerns: choice.concerns ?? null,
      },
      model: choice.model ?? null,
      tokenUsage: choice.tokenUsage ?? null,
      durationMs: choice.durationMs ?? null,
      errorMessage: choice.fallbackReason ?? null,
    });
    const saved = await this.decisions.save(decision);
    this.logger.log(
      `persisted decision ${saved.id} for ${date}: ${saved.strategy} ` +
        `${saved.symbol ?? '(none)'} via ${choice.source}`,
    );
    return saved;
  }

  private buildNotes(
    plan: SpreadPlan,
    choice: SelectorChoice,
    rejectedPick: SpreadPlan | null,
  ): string {
    return [
      `${choice.source} entry (score ${plan.score.toFixed(1)}/100): ` +
        `shortDelta ${plan.shortDelta.toFixed(3)}, width ${plan.width}, ` +
        `credit/width ${(plan.creditToWidth * 100).toFixed(0)}%, IVR ${plan.ivRank ?? 'n/a'}, ` +
        `sentiment +${plan.bullish ?? 0}/-${plan.bearish ?? 0}`,
      rejectedPick
        ? `Fallback — the selector's pick (${rejectedPick.symbol}) was rejected by the risk gate.`
        : null,
      choice.rationale,
      choice.concerns ? `Concerns: ${choice.concerns}` : null,
    ]
      .filter(Boolean)
      .join(' — ');
  }

  /**
   * Mechanical strike selection. Short strike = OTM put nearest the target delta;
   * long strike sits `width` below, where width is the risk budget capped by a
   * percentage of spot and snapped to the chain's strike increment.
   *
   * This stays mechanical even when the AI selector is on — the model chooses
   * between spreads, it never builds one.
   */
  private async selectSpread(
    c: ShortlistCandidate,
    riskBudget: number,
  ): Promise<UnscoredPlan | null> {
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
    const relSpreads: number[] = [];
    for (const [label, leg] of [
      ['short', short],
      ['long', long],
    ] as const) {
      const mid = (leg.bid + leg.ask) / 2;
      const rel = mid > 0 ? (leg.ask - leg.bid) / mid : Infinity;
      if (mid <= 0 || rel > this.maxQuoteSpreadPct) {
        this.logger.warn(
          `entry: ${c.symbol} — ${label} leg ${leg.strike}P quote too wide ` +
            `(${leg.bid}/${leg.ask}); skipping`,
        );
        return null;
      }
      relSpreads.push(rel);
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
      correlationGroup: c.correlationGroup,
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
      avgRelSpread: (relSpreads[0] + relSpreads[1]) / 2,
      ivRank: c.ivRank,
      bullish: c.bullish,
      bearish: c.bearish,
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
function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
