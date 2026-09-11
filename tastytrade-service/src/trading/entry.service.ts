import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';
import { ShortlistCandidate, TradingDayEntity } from './trading-day.entity';
import { ArmParams, ScoreParts, SelectorChoice, SpreadPlan } from './entry.types';
import { EntryAnalystService } from './entry-analyst.service';
import { TastytradeService } from '../tastytrade/tastytrade.service';
import { PaperService } from '../paper/paper.service';
import { PaperAccountEntity } from '../paper/paper-account.entity';
import { PaperAccountSummary } from '../paper/paper.types';
import { DecisionEntity } from '../persistence/entities/decision.entity';
import { PositionEntity } from '../persistence/entities/position.entity';
import {
  DecisionTrigger,
  PositionStatus,
  StrategyType,
} from '../persistence/persistence.types';

/** A priced spread before scoring — everything except the score itself. */
type UnscoredPlan = Omit<SpreadPlan, 'score' | 'scoreParts'>;

/** What one arm actually did this tick. */
interface ArmOutcome {
  arm: string;
  opened: number;
  summary: string;
  openedId?: number | null;
  decisionId?: number;
  selector?: string;
  attempts?: string[];
}

/** What one arm intends to do this tick, resolved before any chain is fetched. */
interface ArmRun {
  arm: PaperAccountEntity;
  params: ArmParams;
  account: PaperAccountSummary;
  open: PositionEntity[];
  candidates: ShortlistCandidate[];
  riskBudget: number;
  /** Set when the arm sits this tick out — no candidates need pricing. */
  skip?: string;
}

/**
 * 10:00-11:30 ET, every 15 min — each experiment arm opens its best play, or passes.
 *
 * Three stages:
 *
 *   1. PLAN THE TICK. Every enabled arm resolves its own params (env defaults +
 *      arm overrides) and its own candidate list, excluding what IT already holds.
 *   2. PRICE ONCE. Union every arm's candidates and fetch each chain snapshot a
 *      single time, in parallel. Arms then score off the SAME snapshot, so a
 *      price that moved between two fetches can never explain a difference in
 *      outcome. Each snapshot is an ~8s DXLink subscription, so this is also what
 *      keeps a multi-arm tick affordable.
 *   3. CHOOSE AND OPEN, per arm, into that arm's own book.
 *
 * Arms keep separate books on purpose. Once they pick differently their holdings
 * diverge, which is the whole point — a portfolio-level effect ("it declined to
 * double up on semis") is invisible if the arms share a book.
 *
 * The mechanical baseline is logged for every arm on every run, so an arm's lift
 * over plain top-score is measurable rather than assumed.
 */
@Injectable()
export class EntryService {
  private readonly logger = new Logger(EntryService.name);
  private readonly defaults: ArmParams;

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
    this.defaults = {
      selector:
        String(config.get('ENTRY_SELECTOR') ?? 'mechanical').toLowerCase() === 'ai'
          ? 'ai'
          : 'mechanical',
      targetDelta: num(config.get('ENTRY_TARGET_DELTA'), 0.16),
      widthPct: num(config.get('ENTRY_WIDTH_PCT'), 0.05),
      minCreditToWidth: num(config.get('ENTRY_MIN_CREDIT_RATIO'), 0.1),
      targetDte: num(config.get('ENTRY_TARGET_DTE'), 45),
      maxNewPerRun: num(config.get('ENTRY_MAX_NEW_PER_RUN'), 1),
      maxQuoteSpreadPct: num(config.get('ENTRY_MAX_QUOTE_SPREAD_PCT'), 0.5),
      maxQuoteSpreadAbs: num(config.get('ENTRY_MAX_QUOTE_SPREAD_ABS'), 0.1),
      slateSize: num(config.get('ENTRY_SLATE_SIZE'), 5),
      model: config.get('ENTRY_MODEL'),
    };
    this.logger.log(
      `entry defaults: ${JSON.stringify(this.defaults)} (arms may override any of these)`,
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

    // Arms with selector 'agent' are owned by the research agent, which does its
    // own discovery, structures and sizing. Running the mechanical funnel over
    // them too would fill their books with bull put spreads and destroy the
    // comparison. They are still managed and exited by the MANAGE phase.
    const allArms = await this.paper.listArms(true);
    const selectorFor = (a: (typeof allArms)[number]) =>
      a.config?.selector ?? this.defaults.selector;
    const arms = allArms.filter((a) => selectorFor(a) !== 'agent');
    const skipped = allArms.filter((a) => selectorFor(a) === 'agent');
    if (skipped.length) {
      this.logger.log(
        `entry ${date}: skipping agent-owned arm(s) ${skipped.map((a) => a.name).join(', ')} ` +
          `— the research agent trades those`,
      );
    }
    if (!arms.length) {
      const msg = 'no mechanical arms enabled';
      this.logger.log(`entry ${date}: ${msg}`);
      return { phase: TradingPhase.ENTRY, ran: false, summary: msg };
    }
    this.logger.log(
      `entry ${date}: ${day.shortlist.length} candidates | ${arms.length} active arm(s): ` +
        arms.map((a) => `${a.name}(${selectorFor(a)})`).join(', '),
    );

    // ---- Stage 1: what does each arm want to look at? ---------------------
    const runs: ArmRun[] = [];
    for (const arm of arms) {
      runs.push(await this.planArm(arm, day.shortlist));
    }

    // ---- Stage 2: price the union of all arms' candidates, once ----------
    const snapshots = await this.priceUnion(runs);

    // ---- Stage 3: each arm chooses and opens into its own book -----------
    const results: ArmOutcome[] = [];
    let openedTotal = 0;
    for (const run of runs) {
      const outcome = await this.runArm(date, run, snapshots);
      openedTotal += outcome.opened;
      results.push(outcome);
    }

    const summary = results.map((r) => `${r.arm}: ${r.summary}`).join(' | ');
    this.logger.log(`entry ${date}: ${summary}`);

    return {
      phase: TradingPhase.ENTRY,
      ran: openedTotal > 0,
      summary,
      details: { date, opened: openedTotal, arms: results },
    };
  }

  /** Resolve an arm's params, book and candidate list. No network calls. */
  private async planArm(
    arm: PaperAccountEntity,
    shortlist: ShortlistCandidate[],
  ): Promise<ArmRun> {
    const params: ArmParams = { ...this.defaults, ...(arm.config ?? {}) };
    const account = await this.paper.getSummary(arm.name);
    const open = await this.paper.listPositions(PositionStatus.OPEN, arm.name);
    const held = new Set(open.map((p) => p.symbol));
    const riskBudget =
      (account.settledValue * account.rules.maxRiskPerTradePct) / 100;

    this.logger.log(
      `entry[${arm.name}]: selector=${params.selector} | open=${held.size}/` +
        `${account.rules.maxConcurrentPositions} | settled=$${account.settledValue} | ` +
        `bpAvail=$${account.buyingPowerAvailable} | riskBudget=$${round2(riskBudget)}`,
    );

    if (held.size >= account.rules.maxConcurrentPositions) {
      const skip = `at max concurrent positions (${account.rules.maxConcurrentPositions})`;
      this.logger.log(`entry[${arm.name}]: ${skip} — passing`);
      return { arm, params, account, open, candidates: [], riskBudget, skip };
    }

    const candidates = shortlist
      .filter((c) => !held.has(c.symbol))
      .slice(0, params.slateSize);

    return { arm, params, account, open, candidates, riskBudget };
  }

  /**
   * Fetch every (symbol, DTE) any arm needs — once, in parallel.
   *
   * Arms usually overlap almost entirely, so this is typically 5-6 fetches
   * instead of 5 per arm, and it guarantees both arms reason over identical
   * prices rather than two snapshots taken seconds apart.
   */
  private async priceUnion(runs: ArmRun[]): Promise<Map<string, any>> {
    const wanted = new Map<string, { symbol: string; dte: number }>();
    for (const run of runs) {
      for (const c of run.candidates) {
        wanted.set(snapKey(c.symbol, run.params.targetDte), {
          symbol: c.symbol,
          dte: run.params.targetDte,
        });
      }
    }

    const snapshots = new Map<string, any>();
    if (!wanted.size) return snapshots;

    const requestedTotal = runs.reduce((n, r) => n + r.candidates.length, 0);
    this.logger.log(
      `entry: pricing ${wanted.size} unique chain(s) in parallel ` +
        `(${requestedTotal} arm-requests deduped) — ${[...wanted.values()].map((w) => `${w.symbol}@${w.dte}d`).join(', ')}`,
    );

    const started = Date.now();
    const keys = [...wanted.keys()];
    const settled = await Promise.allSettled(
      keys.map((k) => {
        const { symbol, dte } = wanted.get(k)!;
        return this.tastytrade.getGreeksSnapshot(symbol, dte, 25, 8);
      }),
    );
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') snapshots.set(keys[i], r.value);
      else
        this.logger.warn(
          `entry: chain lookup failed for ${keys[i]} — ${errMsg(r.reason)}`,
        );
    });

    this.logger.log(
      `entry: priced ${snapshots.size}/${wanted.size} chain(s) in ${Date.now() - started}ms`,
    );
    return snapshots;
  }

  /** Score, choose and open for a single arm. */
  private async runArm(
    date: string,
    run: ArmRun,
    snapshots: Map<string, any>,
  ): Promise<ArmOutcome> {
    const { arm, params, account, open, riskBudget } = run;
    const tag = `entry[${arm.name}]`;

    if (run.skip) {
      return { arm: arm.name, opened: 0, summary: run.skip };
    }

    // ---- Build this arm's slate from the shared snapshots ----------------
    const slate: SpreadPlan[] = [];
    const misses: string[] = [];
    for (const c of run.candidates) {
      const snap = snapshots.get(snapKey(c.symbol, params.targetDte));
      if (!snap) {
        misses.push(`${c.symbol}:chain-error`);
        continue;
      }
      const plan = this.planFromSnapshot(c, snap, params, riskBudget, tag);
      if (!plan) {
        misses.push(`${c.symbol}:no-viable-spread`);
        continue;
      }
      slate.push(this.scorePlan(plan, params));
    }
    slate.sort((a, b) => b.score - a.score);

    this.logger.log(
      `${tag}: ${slate.length} viable of ${run.candidates.length} examined`,
    );
    slate.forEach((p, i) => {
      this.logger.log(
        `${tag}:   [${i}] ${p.symbol} score ${p.score.toFixed(1)} | ` +
          `${p.shortStrike}/${p.longStrike}P ${p.expiration} (${p.dte}d) | ` +
          `credit $${round2(p.credit * 100)} risk $${round2(p.riskPerShare * 100)} ` +
          `c/w ${(p.creditToWidth * 100).toFixed(0)}% | delta ${p.shortDelta.toFixed(3)} | ` +
          `IVR ${p.ivRank ?? 'n/a'} | qspread ${(p.avgRelSpread * 100).toFixed(1)}% | ` +
          `parts r/r=${p.scoreParts.creditToWidth.toFixed(2)} d=${p.scoreParts.deltaFit.toFixed(2)} ` +
          `ivr=${p.scoreParts.ivRank.toFixed(2)} liq=${p.scoreParts.liquidity.toFixed(2)}`,
      );
    });

    if (!slate.length) {
      const msg = `no viable spread on any of ${run.candidates.length} candidate(s)`;
      this.logger.log(`${tag}: ${msg}`);
      return { arm: arm.name, opened: 0, summary: msg, attempts: misses };
    }

    // ---- Choose ----------------------------------------------------------
    const choice = await this.chooseFromSlate(date, run, slate, tag);
    const decision = await this.recordDecision(date, arm, slate, choice);

    if (choice.pick === null) {
      const msg = `passed on all ${slate.length} plan(s)`;
      this.logger.log(`${tag}: ${msg} — ${choice.rationale}`);
      return {
        arm: arm.name,
        opened: 0,
        summary: msg,
        decisionId: decision.id,
        attempts: misses,
      };
    }

    // ---- Open, falling through by score if the risk gate rejects ---------
    const attempts = [...misses];
    const order = [
      choice.pick,
      ...slate.map((_, i) => i).filter((i) => i !== choice.pick),
    ];
    let opened = 0;
    let openedId: number | null = null;

    for (const idx of order) {
      if (opened >= params.maxNewPerRun) break;
      const plan = slate[idx];
      const isFallback = idx !== choice.pick;
      if (isFallback) {
        this.logger.log(
          `${tag}: falling back to next-best ${plan.symbol} (score ${plan.score.toFixed(1)}) ` +
            `after the risk gate rejected ${slate[choice.pick].symbol}`,
        );
      }

      try {
        const position = await this.paper.openFromSuggestion({
          account: arm.name,
          symbol: plan.symbol,
          strategy: StrategyType.BULL_PUT_SPREAD,
          expiration: plan.expiration,
          legs: [
            {
              action: 'Sell to Open',
              right: 'P',
              strike: plan.shortStrike,
              streamerSymbol: plan.shortStreamerSymbol,
            },
            {
              action: 'Buy to Open',
              right: 'P',
              strike: plan.longStrike,
              streamerSymbol: plan.longStreamerSymbol,
            },
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
          `${tag}: OPENED ${plan.symbol} id=${position.id} score ${plan.score.toFixed(1)} ` +
            `credit $${round2(plan.credit * 100)} risk $${round2(plan.riskPerShare * 100)} ` +
            `decision=${decision.id}`,
        );
      } catch (err) {
        // Risk gate rejections land here and are expected, not failures.
        this.logger.log(`${tag}: ${plan.symbol} not opened — ${errMsg(err)}`);
        attempts.push(`${plan.symbol}:gate-rejected`);
      }
    }

    const summary =
      opened > 0
        ? `opened ${attempts.filter((a) => a.includes('OPENED')).join(', ')}`
        : `nothing opened (${slate.length} scored, all gate-rejected)`;
    this.logger.log(`${tag}: ${summary}`);

    return {
      arm: arm.name,
      opened,
      openedId,
      summary,
      decisionId: decision.id,
      selector: choice.source,
      attempts,
    };
  }

  /**
   * Deterministic 0-100 score on hard economics only.
   *
   * Sentiment is deliberately NOT weighted here: it is noisy retail chatter and
   * baking a coefficient for it would be false precision. It is handed to the
   * AI selector instead, where a qualitative read belongs.
   */
  private scorePlan(p: UnscoredPlan, params: ArmParams): SpreadPlan {
    const parts: ScoreParts = {
      // 20% of width is an excellent credit at 16-delta with budget-sized width;
      // measured live, real markets pay 8-20% here. A wider band (0-35%) pinned
      // every candidate near 0.3 and let the lesser components drive the ranking.
      creditToWidth: clamp01(p.creditToWidth / 0.2),
      // Chain granularity means the achieved delta drifts off target. At target
      // = 1.0; off by a full target's worth = 0.
      deltaFit:
        1 -
        clamp01(
          Math.abs(Math.abs(p.shortDelta) - params.targetDelta) / params.targetDelta,
        ),
      // IV rank 30 is the qualification floor and 80+ is genuinely rich premium;
      // map that band rather than 0-100, which would compress all real signal.
      ivRank: clamp01(((p.ivRank ?? 30) - 30) / 50),
      // Quote tightness relative to the threshold that would have rejected it.
      liquidity: 1 - clamp01(p.avgRelSpread / params.maxQuoteSpreadPct),
    };

    const score =
      100 *
      (0.45 * parts.creditToWidth +
        0.2 * parts.deltaFit +
        0.2 * parts.ivRank +
        0.15 * parts.liquidity);

    return { ...p, score, scoreParts: parts };
  }

  /** Mechanical top-score, or the AI analyst when the arm's selector is 'ai'. */
  private async chooseFromSlate(
    date: string,
    run: ArmRun,
    slate: SpreadPlan[],
    tag: string,
  ): Promise<SelectorChoice> {
    const baseline = slate[0];

    let choice: SelectorChoice;
    if (run.params.selector === 'ai') {
      choice = await this.analyst.choose({
        date,
        slate,
        account: run.account,
        open: run.open,
        riskBudget: run.riskBudget,
        model: run.params.model,
        armTag: tag,
      });
    } else {
      choice = {
        source: 'mechanical',
        pick: 0,
        rationale: `Highest deterministic score (${baseline.score.toFixed(1)}/100)`,
      };
    }

    // Always record what plain top-score WOULD have done. Without this line
    // there is no way to tell later whether the arm's selector earned its keep.
    this.logger.log(
      `${tag}: baseline (top score) = ${baseline.symbol} @ ${baseline.score.toFixed(1)}`,
    );
    if (choice.source === 'ai') {
      if (choice.pick === null) {
        this.logger.log(
          `${tag}: AI DIVERGED — passed on the whole slate ` +
            `(baseline would have opened ${baseline.symbol})`,
        );
      } else if (choice.pick !== 0) {
        const picked = slate[choice.pick];
        this.logger.log(
          `${tag}: AI DIVERGED — chose ${picked.symbol} (${picked.score.toFixed(1)}) ` +
            `over ${baseline.symbol} (${baseline.score.toFixed(1)})`,
        );
      } else {
        this.logger.log(`${tag}: AI AGREED with baseline (${baseline.symbol})`);
      }
    }

    return choice;
  }

  /** Durable audit row: the slate, the choice, and the reasoning behind it. */
  private async recordDecision(
    date: string,
    arm: PaperAccountEntity,
    slate: SpreadPlan[],
    choice: SelectorChoice,
  ): Promise<DecisionEntity> {
    const picked = choice.pick === null ? null : slate[choice.pick];
    const decision = this.decisions.create({
      symbol: picked?.symbol ?? null,
      accountId: arm.id,
      trigger: DecisionTrigger.CRON,
      strategy: picked ? StrategyType.BULL_PUT_SPREAD : 'no_trade',
      marketAssessment: choice.portfolioFit ?? null,
      rationale: choice.rationale,
      proposedTrade: picked ? ({ ...picked } as Record<string, unknown>) : null,
      snapshot: {
        date,
        arm: arm.name,
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
      `persisted decision ${saved.id} for ${date} arm=${arm.name}: ` +
        `${saved.strategy} ${saved.symbol ?? '(none)'} via ${choice.source}`,
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
   * Mechanical strike selection from an already-fetched snapshot. Short strike =
   * OTM put nearest the target delta; long strike sits `width` below, where width
   * is the risk budget capped by a percentage of spot and snapped to the chain's
   * strike increment.
   *
   * This stays mechanical even for AI arms — the model chooses BETWEEN spreads,
   * it never builds one.
   */
  private planFromSnapshot(
    c: ShortlistCandidate,
    snap: any,
    params: ArmParams,
    riskBudget: number,
    tag: string,
  ): UnscoredPlan | null {
    const spot = Number(snap?.underlyingPrice);
    const contracts: any[] = snap?.contracts ?? [];
    if (!spot || contracts.length < 2) {
      this.logger.warn(`${tag}: ${c.symbol} — no usable chain snapshot`);
      return null;
    }

    // OTM puts with a live two-sided quote and a delta.
    const puts = contracts
      .filter((x) => x?.put && x.strike < spot)
      .map((x) => ({
        strike: Number(x.strike),
        streamerSymbol: x.put.streamerSymbol as string | undefined,
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
        `${tag}: ${c.symbol} — only ${puts.length} quotable OTM puts, skipping`,
      );
      return null;
    }

    // Short strike: closest |delta| to target.
    const short = puts.reduce((best, p) =>
      Math.abs(Math.abs(p.delta) - params.targetDelta) <
      Math.abs(Math.abs(best.delta) - params.targetDelta)
        ? p
        : best,
    );

    // Width: risk-budgeted and capped by % of spot. Don't demand an exact strike
    // — quotes are sparse (thin books, holidays), so take the WIDEST strike that
    // still fits the budget. Wider = more credit for the same risk ceiling.
    const maxWidth = Math.min(riskBudget / 100, spot * params.widthPct);
    const long = puts
      .filter((p) => p.strike < short.strike)
      .filter((p) => short.strike - p.strike <= maxWidth)
      .sort((a, b) => a.strike - b.strike)[0]; // lowest strike = widest spread
    if (!long) {
      const nearest = puts.find((p) => p.strike < short.strike);
      this.logger.warn(
        `${tag}: ${c.symbol} — no long strike within budget ` +
          `(short ${short.strike}, maxWidth ${round2(maxWidth)}, ` +
          `nearest below ${nearest ? nearest.strike : 'none'})`,
      );
      return null;
    }

    // Quote quality. Two distinct failures, deliberately tested differently:
    //
    //  1. NO BID at all — genuinely untradeable, you cannot sell it. Hard reject.
    //     (Thin sector ETFs really do quote 0/1.40 on OTM puts; verified this is
    //     the live book, not an incomplete snapshot — an 8s and a 20s
    //     subscription return identical data.)
    //  2. WIDE — only meaningful when the spread is wide in BOTH relative and
    //     absolute terms. Relative spread alone is useless on a cheap leg: a
    //     0.14/0.24 long leg reads as 53% but costs $0.10 to cross, which is
    //     noise against the credit collected. Requiring both stops us rejecting
    //     perfectly tradeable spreads over their cheapest leg.
    const relSpreads: number[] = [];
    for (const [label, leg] of [
      ['short', short],
      ['long', long],
    ] as const) {
      const mid = (leg.bid + leg.ask) / 2;
      const abs = leg.ask - leg.bid;
      if (leg.bid <= 0 || mid <= 0) {
        this.logger.warn(
          `${tag}: ${c.symbol} — ${label} leg ${leg.strike}P has no bid ` +
            `(${leg.bid}/${leg.ask}), untradeable; skipping`,
        );
        return null;
      }
      const rel = abs / mid;
      if (rel > params.maxQuoteSpreadPct && abs > params.maxQuoteSpreadAbs) {
        this.logger.warn(
          `${tag}: ${c.symbol} — ${label} leg ${leg.strike}P quote too wide ` +
            `(${leg.bid}/${leg.ask} = $${round2(abs)}, ${(rel * 100).toFixed(0)}%); skipping`,
        );
        return null;
      }
      relSpreads.push(rel);
    }

    const credit = (short.bid + short.ask) / 2 - (long.bid + long.ask) / 2;
    const actualWidth = round2(short.strike - long.strike);
    const creditToWidth = credit / actualWidth;

    if (credit <= 0) {
      this.logger.warn(`${tag}: ${c.symbol} — non-positive credit, skipping`);
      return null;
    }
    if (creditToWidth < params.minCreditToWidth) {
      this.logger.log(
        `${tag}: ${c.symbol} — credit/width ${(creditToWidth * 100).toFixed(0)}% ` +
          `below ${(params.minCreditToWidth * 100).toFixed(0)}%, poor risk/reward — skipping`,
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
      shortStreamerSymbol: short.streamerSymbol,
      longStreamerSymbol: long.streamerSymbol,
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

function snapKey(symbol: string, dte: number): string {
  return `${symbol}@${dte}`;
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
