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

/**
 * Round-trip fee budget for a 2-leg, 1-lot vertical (01 §3: open $2.24 + close
 * $0.24 + TAF). Counted inside the per-position risk cap because a max-loss
 * outcome pays them too.
 */
const ROUND_TRIP_FEES_2LEG = 2.5;

/** Widest (ask − bid) / mid on the UNDERLYING before its mid is distrusted as spot. */
const MAX_UNDERLYING_QUOTE_REL = 0.005;

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
 * 10:00-15:30 ET, every 15 min — each experiment arm opens its best play, or passes.
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
      // Playbook defaults (docs/playbook/00-README.md canonical table). Every
      // one is an env default an arm may override.
      targetDelta: num(config.get('ENTRY_TARGET_DELTA'), 0.2),
      minShortDelta: num(config.get('ENTRY_MIN_SHORT_DELTA'), 0.15),
      maxShortDelta: num(config.get('ENTRY_MAX_SHORT_DELTA'), 0.25),
      widthPct: num(config.get('ENTRY_WIDTH_PCT'), 0.05),
      minCreditToWidth: num(config.get('ENTRY_MIN_CREDIT_RATIO'), 0.25),
      targetCreditToWidth: num(config.get('ENTRY_TARGET_CREDIT_RATIO'), 0.33),
      thinCreditMaxDelta: num(config.get('ENTRY_THIN_CREDIT_MAX_DELTA'), 0.2),
      minCreditAbs: num(config.get('ENTRY_MIN_CREDIT_ABS'), 0.3),
      minEmMultiple: num(config.get('ENTRY_MIN_EM_MULTIPLE'), 0.8),
      preferredEmMultiple: num(config.get('ENTRY_PREFERRED_EM_MULTIPLE'), 1.0),
      targetDte: num(config.get('ENTRY_TARGET_DTE'), 10),
      minDte: num(config.get('ENTRY_MIN_DTE'), 7),
      maxDte: num(config.get('ENTRY_MAX_DTE'), 14),
      maxContracts: num(config.get('ENTRY_MAX_CONTRACTS'), 10),
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
    const wanted = new Map<
      string,
      { symbol: string; dte: number; window: { min: number; max: number } }
    >();
    for (const run of runs) {
      for (const c of run.candidates) {
        const window = { min: run.params.minDte, max: run.params.maxDte };
        wanted.set(snapKey(c.symbol, run.params), {
          symbol: c.symbol,
          dte: run.params.targetDte,
          window,
        });
      }
    }

    const snapshots = new Map<string, any>();
    if (!wanted.size) return snapshots;

    const requestedTotal = runs.reduce((n, r) => n + r.candidates.length, 0);
    this.logger.log(
      `entry: pricing ${wanted.size} unique chain(s) in parallel ` +
        `(${requestedTotal} arm-requests deduped) — ${[...wanted.values()].map((w) => `${w.symbol}@${w.dte}d[${w.window.min}-${w.window.max}]`).join(', ')}`,
    );

    const started = Date.now();
    const keys = [...wanted.keys()];
    const settled = await Promise.allSettled(
      keys.map((k) => {
        const { symbol, dte, window } = wanted.get(k)!;
        return this.tastytrade.getGreeksSnapshot(symbol, dte, 25, 8, window);
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
      const snap = snapshots.get(snapKey(c.symbol, params));
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
          `${p.contracts}x credit $${round2(p.credit * 100)} risk $${round2(p.riskPerShare * 100)} ` +
          `(total $${p.totalRisk}) c/w ${(p.creditToWidth * 100).toFixed(0)}% | delta ${p.shortDelta.toFixed(3)} | ` +
          `EM ${p.emMultiple ?? '?'}x | ` +
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
          contracts: plan.contracts,
          decisionId: decision.id,
          notes: this.buildNotes(plan, choice, isFallback ? slate[choice.pick] : null),
        });
        opened += 1;
        openedId = position.id;
        attempts.push(`${plan.symbol}:OPENED#${position.id}`);
        this.logger.log(
          `${tag}: OPENED ${plan.symbol} id=${position.id} score ${plan.score.toFixed(1)} ` +
            `${plan.contracts}x credit $${round2(plan.credit * 100 * plan.contracts)} ` +
            `risk $${plan.totalRisk} decision=${decision.id}`,
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
      // Everything on the slate already clears the 25% floor (02 T4), so score
      // the band above it: 25% = 0, 50% of width (iron-fly territory) = 1.
      creditToWidth: clamp01((p.creditToWidth - params.minCreditToWidth) / 0.25),
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
    // Spot is the equity NBBO mid. Every downstream number — which strikes are
    // OTM, the expected-move distance, the width cap — keys off it, so a wide
    // quote (after-hours, halted, weekend) is disqualifying, not a rounding
    // error. Liquid ETFs quote a penny wide in RTH; 0.5% is generous.
    const uBid = Number(snap?.underlyingBid);
    const uAsk = Number(snap?.underlyingAsk);
    if (spot && Number.isFinite(uBid) && Number.isFinite(uAsk) && uAsk > 0) {
      const rel = (uAsk - uBid) / spot;
      if (rel > MAX_UNDERLYING_QUOTE_REL) {
        this.logger.warn(
          `${tag}: ${c.symbol} — underlying quote ${uBid}/${uAsk} is ${(rel * 100).toFixed(1)}% wide; ` +
            `mid ${spot} is not a usable spot (market closed or halted?). skipping`,
        );
        return null;
      }
    }
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
        iv: Number(x.put.iv),
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

    // Short strike selection. Two playbook bands apply at once: |delta| in
    // [minShortDelta, maxShortDelta] (02 T2) and distance in 1-SD expected
    // moves to expiry (02 T5: >= 1.0x preferred, 0.8x the hard minimum; EM =
    // S·σ·√(DTE/365) using each strike's own IV, so skew is respected).
    // Picking nearest-to-target and then checking EM would reject most chains
    // — 0.20Δ sits ~0.85 SD out — so filter to strikes that satisfy both,
    // prefer the >= 1.0x tier, and take the one closest to target within the
    // tier. That lands on the ~0.16-0.20Δ strike the rules actually want.
    const dte = Number(snap.dte);
    const eligible = puts
      .map((p) => {
        const absDelta = Math.abs(p.delta);
        const hasIv = Number.isFinite(p.iv) && p.iv > 0 && dte > 0;
        const expectedMove = hasIv ? round2(spot * p.iv * Math.sqrt(dte / 365)) : null;
        const emMultiple =
          expectedMove && expectedMove > 0 ? round2((spot - p.strike) / expectedMove) : null;
        return { ...p, absDelta, expectedMove, emMultiple };
      })
      .filter((p) => p.absDelta >= params.minShortDelta && p.absDelta <= params.maxShortDelta)
      // No IV on the leg = cannot verify the EM rule; do not guess, drop it.
      .filter((p) => p.emMultiple !== null && p.emMultiple >= params.minEmMultiple);
    const preferred = eligible.filter(
      (p) => (p.emMultiple as number) >= params.preferredEmMultiple,
    );
    const pool = preferred.length ? preferred : eligible;

    if (!pool.length) {
      const nearest = puts.reduce((best, p) =>
        Math.abs(Math.abs(p.delta) - params.targetDelta) <
        Math.abs(Math.abs(best.delta) - params.targetDelta)
          ? p
          : best,
      );
      const nIv = Number.isFinite(nearest.iv) && nearest.iv > 0 && dte > 0
        ? round2(spot * nearest.iv * Math.sqrt(dte / 365))
        : null;
      this.logger.log(
        `${tag}: ${c.symbol} — no strike satisfies Δ ${params.minShortDelta}-${params.maxShortDelta} ` +
          `AND >= ${params.minEmMultiple}x EM (${params.preferredEmMultiple}x preferred); nearest to target is ${nearest.strike}P ` +
          `(${Math.abs(nearest.delta).toFixed(2)}Δ, ${nIv ? `${round2((spot - nearest.strike) / nIv)}x EM $${nIv}` : 'no IV'}); skipping`,
      );
      return null;
    }

    const short = pool.reduce((best, p) =>
      Math.abs(p.absDelta - params.targetDelta) < Math.abs(best.absDelta - params.targetDelta)
        ? p
        : best,
    );
    const shortAbsDelta = short.absDelta;
    const expectedMove = short.expectedMove;
    const emMultiple = short.emMultiple;
    if (!preferred.length) {
      this.logger.log(
        `${tag}: ${c.symbol} — no strike in the delta band clears ${params.preferredEmMultiple}x EM; ` +
          `using ${short.strike}P at ${emMultiple}x (>= ${params.minEmMultiple}x minimum)`,
      );
    }

    // Width and size. Sizing policy (2026-09-16): a trade may use up to the
    // arm's risk budget, deployed by SCALING CONTRACTS on playbook-shaped
    // strikes rather than by widening the spread — credit/width falls as
    // width grows, so "widest that fits" would build thin-credit spreads the
    // 25% floor then rejects. Instead: among long strikes within widthPct of
    // spot, take the width with the BEST credit/width that still clears the
    // gross-credit fee gate (ties go wider — more absolute credit per lot),
    // then contracts = floor(budget / (risk per contract + round-trip fees)),
    // capped at maxContracts. Risk is width − credit (01 §4), never width.
    const maxWidth = spot * params.widthPct;
    const shortMid = (short.bid + short.ask) / 2;
    const longs = puts
      .filter((p) => p.strike < short.strike && short.strike - p.strike <= maxWidth)
      .map((cand) => {
        const width = round2(short.strike - cand.strike);
        const credit = shortMid - (cand.bid + cand.ask) / 2;
        return { cand, width, credit, creditToWidth: credit / width, risk: width - credit };
      })
      .filter((w) => w.credit > 0 && w.credit >= params.minCreditAbs);
    if (!longs.length) {
      const nearest = puts.find((p) => p.strike < short.strike);
      this.logger.log(
        `${tag}: ${c.symbol} — no width within $${round2(maxWidth)} of short ${short.strike}P pays ` +
          `>= $${params.minCreditAbs} gross (fee gate); ` +
          `nearest long ${nearest ? `${nearest.strike}P pays $${round2(shortMid - (nearest.bid + nearest.ask) / 2)}` : 'none'}; skipping`,
      );
      return null;
    }
    const best = longs.reduce((a, b) =>
      b.creditToWidth > a.creditToWidth + 1e-9 ||
      (Math.abs(b.creditToWidth - a.creditToWidth) <= 1e-9 && b.width > a.width)
        ? b
        : a,
    );
    const long = best.cand;
    const riskPerContract = best.risk * 100 + ROUND_TRIP_FEES_2LEG;
    const lots = Math.min(params.maxContracts, Math.floor(riskBudget / riskPerContract));
    if (lots < 1) {
      this.logger.warn(
        `${tag}: ${c.symbol} — one ${short.strike}/${long.strike}P risks $${round2(riskPerContract)} ` +
          `incl. fees, over the $${round2(riskBudget)} budget; skipping`,
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
    // Fee gate (01 A6): a $0.20 credit on a $2.50 round trip is 12.5% drag
    // before the trade has done anything. Gross floor, per share.
    if (credit < params.minCreditAbs) {
      this.logger.log(
        `${tag}: ${c.symbol} — gross credit $${round2(credit)} below $${params.minCreditAbs} ` +
          `minimum (fee gate); skipping`,
      );
      return null;
    }
    // Credit/width (02 T4): hard floor, and a target above it. In between is
    // allowed only when the short strike is far enough out that being paid
    // less is justified (|Δ| <= thinCreditMaxDelta).
    if (creditToWidth < params.minCreditToWidth) {
      this.logger.log(
        `${tag}: ${c.symbol} — credit/width ${(creditToWidth * 100).toFixed(0)}% ` +
          `below the ${(params.minCreditToWidth * 100).toFixed(0)}% floor — skipping`,
      );
      return null;
    }
    if (
      creditToWidth < params.targetCreditToWidth &&
      round2(shortAbsDelta) > params.thinCreditMaxDelta
    ) {
      this.logger.log(
        `${tag}: ${c.symbol} — credit/width ${(creditToWidth * 100).toFixed(0)}% is under the ` +
          `${(params.targetCreditToWidth * 100).toFixed(0)}% target and short Δ ${shortAbsDelta.toFixed(2)} ` +
          `> ${params.thinCreditMaxDelta} (thin credit needs a further strike) — skipping`,
      );
      return null;
    }

    return {
      symbol: c.symbol,
      correlationGroup: c.correlationGroup,
      expiration: String(snap.expiration),
      dte,
      underlyingPrice: spot,
      shortStrike: short.strike,
      longStrike: long.strike,
      shortStreamerSymbol: short.streamerSymbol,
      longStreamerSymbol: long.streamerSymbol,
      shortDelta: short.delta,
      expectedMove,
      emMultiple,
      contracts: lots,
      totalRisk: round2((actualWidth - credit) * 100 * lots),
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

function snapKey(
  symbol: string,
  p: { targetDte: number; minDte: number; maxDte: number },
): string {
  return `${symbol}@${p.targetDte}[${p.minDte}-${p.maxDte}]`;
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
