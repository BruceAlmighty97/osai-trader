import { PositionValuation } from '../paper/paper.types';
import { ExitReason, StrategyType } from '../persistence/persistence.types';

/**
 * The exit policy, as numbers. Every field is per-arm overridable (ArmConfig)
 * so exit policy is an A/B variable exactly like entry policy.
 */
export interface ExitThresholds {
  /** Close at this fraction of max profit (02 T6: 0.5). */
  profitTargetPct: number;
  /** ...or at this fraction once accelDte or fewer calendar days remain, and always for iron flies / BWBs (02 T22). */
  accelProfitTargetPct: number;
  accelDte: number;
  /**
   * Stop when the unrealized loss reaches this multiple of MAX PROFIT.
   * 1.0 is the playbook's "mark >= 2x credit" (06 §5.2) — a loss equal to the
   * credit. Also capped at half of max risk, which is the same table's rule
   * for rich-credit structures and for debit spreads ("mark <= 50% of debit").
   */
  stopLossMultiple: number;
  /** Short strike |delta| that marks a credit position "tested" (03 G-4 / 06 §5.2). */
  deltaStop: number;
  /** Same, for iron condors (02 T18). */
  deltaStopCondor: number;
  /** Debit structures: the long leg's |delta| at/below which the directional thesis has failed. */
  debitLongDeltaStop: number;
  /** Close this many trading days before expiration (02 T8: 2). */
  timeStopTradingDays: number;
  /** Minutes after ET midnight from which the time stop fires on its day (10:00 = 600; 06 §6.2). */
  timeStopFromMinute: number;
}

/** What the rules need to know about "now" beyond the valuation itself. */
export interface ExitContext {
  /** ET calendar date, 'YYYY-MM-DD'. */
  today: string;
  /** Minutes after ET midnight. */
  minuteOfDay: number;
  /** Trading day `n` sessions before an ISO date (delegates to MarketCalendarService). */
  tradingDaysBefore: (iso: string, n: number) => string;
}

/** A rule firing on one position, with the numbers that fired it. */
export interface ExitVerdict {
  reason: ExitReason;
  why: string;
}

/**
 * Positions opened with more than this many DTE predate the 7-14 DTE playbook
 * and keep the 21-DTE exit they were opened under (docs/strategy-methodology.md
 * "Legacy positions").
 */
export const LEGACY_DTE_EXIT = 21;

const CONDORS = new Set<string>([StrategyType.IRON_CONDOR]);
const RICH_CREDIT = new Set<string>([StrategyType.IRON_BUTTERFLY]);

/**
 * Classify one valued position against the playbook's exit rules. Pure: no
 * clock, no calendar, no I/O — everything comes in through `pos`, `t` and
 * `ctx`, which is what makes the policy testable against synthetic books.
 *
 * Firing order IS the priority, and the priority is what gets journaled:
 *
 *   1. EXPIRED      — expiration day or later with the position still open.
 *                     This is a missed exit, never a plan; logged as such.
 *   2. STOP_LOSS    — unrealized loss >= stopLossMultiple x max profit, capped
 *                     at 0.5 x max risk (06 §5.2 loss-multiple row, both
 *                     variants, plus the debit-spread row).
 *   3. STOP_TOUCH   — the underlying printed at/through a short strike today
 *                     (session low <= short put, session high >= short call),
 *                     or sits there now. "Do not wait for the loss multiple."
 *   4. STOP_DELTA   — short |delta| >= deltaStop (deltaStopCondor for condors):
 *                     the theta edge is gone and the spread is directional
 *                     (03 G-4). Debit structures: long |delta| <= debitLongDeltaStop.
 *   5. PROFIT       — captured >= target; target drops to accel once accelDte
 *                     or fewer days remain, and is always accel for iron flies.
 *   6. TIME_EXIT    — on/after the session timeStopTradingDays before expiry
 *                     (from timeStopFromMinute on that day; immediately if the
 *                     day was missed). Legacy 45-DTE positions: 21 DTE instead.
 *
 * Stops outrank the profit target so a position at both is journaled as the
 * stop, which is the fact worth knowing later. Profit outranks the time exit
 * for the same reason in reverse.
 */
export function classifyExit(
  pos: PositionValuation,
  t: ExitThresholds,
  ctx: ExitContext,
): ExitVerdict | null {
  const isCredit = pos.entryCredit > 0;
  const captured = pos.pctOfMaxProfit as number;
  const debit = pos.currentDebit as number;

  // 1. Expiration reached with the position open — always a missed exit.
  if (pos.expiration <= ctx.today) {
    return {
      reason: ExitReason.EXPIRED,
      why: `expiration ${pos.expiration} reached with the position still open (MISSED time stop)`,
    };
  }

  // 2. Stop loss, against MAX PROFIT and MAX RISK rather than the entry price
  //    so the same rule reads correctly for credit and debit structures.
  if (
    pos.maxProfit !== null &&
    pos.maxProfit > 0 &&
    pos.unrealizedPnl !== null
  ) {
    const byProfit = t.stopLossMultiple * pos.maxProfit;
    const byRisk = pos.maxRisk !== null && pos.maxRisk > 0 ? 0.5 * pos.maxRisk : Infinity;
    const stopLoss = Math.min(byProfit, byRisk);
    if (pos.unrealizedPnl <= -stopLoss) {
      const rule =
        byRisk < byProfit
          ? `0.5x max risk $${r2(pos.maxRisk as number)} (rich-credit / debit variant)`
          : `${t.stopLossMultiple}x max profit $${r2(pos.maxProfit)}`;
      return {
        reason: ExitReason.STOP_LOSS,
        why:
          `unrealized $${r2(pos.unrealizedPnl)} <= -$${r2(stopLoss)} (${rule}); ` +
          `cost to close ${debit} vs entry ${pos.entryCredit}`,
      };
    }
  }

  // 3. Price touch — any RTH print at/through a short strike. Today's session
  //    range catches a print between ticks; the last trade (or NBBO mid when
  //    there is none) catches where it sits now.
  //
  //    The range is only usable for a position that was ALREADY OPEN when the
  //    session began. It covers the whole session, including prints from
  //    before an intraday entry: on 2026-09-21 META rallied 679.60 -> 747 and
  //    three positions opened at 737+ with short strikes near 695 were closed
  //    within five minutes each, "touched" by a low that happened hours before
  //    they existed. For a same-day entry only the current price is evidence;
  //    the full range applies from the next session.
  const openedToday = etDateOf(pos.openedAt) === ctx.today;
  if (isCredit) {
    for (const leg of pos.legs) {
      if (!/sell/i.test(leg.action)) continue;
      const hi = openedToday ? null : pos.underlyingDayHigh;
      const lo = openedToday ? null : pos.underlyingDayLow;
      const now = pos.underlyingLast ?? pos.underlyingPrice;
      if (leg.right === 'P') {
        const touched = (lo !== null && lo <= leg.strike) || (now !== null && now <= leg.strike);
        if (touched) {
          return {
            reason: ExitReason.STOP_TOUCH,
            why: `underlying printed through short ${leg.strike}P (session low ${lo ?? '?'}, now ${now ?? '?'})`,
          };
        }
      } else {
        const touched = (hi !== null && hi >= leg.strike) || (now !== null && now >= leg.strike);
        if (touched) {
          return {
            reason: ExitReason.STOP_TOUCH,
            why: `underlying printed through short ${leg.strike}C (session high ${hi ?? '?'}, now ${now ?? '?'})`,
          };
        }
      }
    }
  }

  // 4. Delta — the position is "tested" (credit) or the thesis failed (debit).
  if (isCredit && pos.shortDeltaMax !== null) {
    const limit = CONDORS.has(pos.strategy) ? t.deltaStopCondor : t.deltaStop;
    if (pos.shortDeltaMax >= limit) {
      return {
        reason: ExitReason.STOP_DELTA,
        why: `short strike |delta| ${pos.shortDeltaMax} >= ${limit} — tested, no theta edge left`,
      };
    }
  } else if (!isCredit && pos.longDeltaMax !== null) {
    if (pos.longDeltaMax <= t.debitLongDeltaStop) {
      return {
        reason: ExitReason.STOP_DELTA,
        why: `long leg |delta| ${pos.longDeltaMax} <= ${t.debitLongDeltaStop} — directional thesis failed`,
      };
    }
  }

  // 5. Profit target, accelerated in the last sessions and for narrow-tent structures.
  const nearExpiry = pos.dte !== null && pos.dte <= t.accelDte;
  const accel = nearExpiry || RICH_CREDIT.has(pos.strategy);
  const target = accel ? t.accelProfitTargetPct : t.profitTargetPct;
  if (captured >= target) {
    return {
      reason: ExitReason.PROFIT_TARGET,
      why:
        `captured ${(captured * 100).toFixed(0)}% of max profit >= ${(target * 100).toFixed(0)}% target` +
        (accel ? ` (accelerated: ${nearExpiry ? `${pos.dte}d left` : pos.strategy})` : ''),
    };
  }

  // 6. Time exit.
  const legacy = pos.dteAtOpen !== null && pos.dteAtOpen > LEGACY_DTE_EXIT;
  if (legacy) {
    if (pos.dte !== null && pos.dte <= LEGACY_DTE_EXIT) {
      return {
        reason: ExitReason.DTE_ROLL,
        why: `${pos.dte}d to expiration <= ${LEGACY_DTE_EXIT}d (legacy position opened at ${pos.dteAtOpen} DTE under the 45-DTE policy)`,
      };
    }
    return null;
  }
  const exitDate = ctx.tradingDaysBefore(pos.expiration, t.timeStopTradingDays);
  if (ctx.today > exitDate) {
    return {
      reason: ExitReason.TIME_EXIT,
      why: `time stop was ${exitDate} (${t.timeStopTradingDays} trading days before ${pos.expiration}) and today is ${ctx.today} — MISSED, closing now`,
    };
  }
  if (ctx.today === exitDate && ctx.minuteOfDay >= t.timeStopFromMinute) {
    return {
      reason: ExitReason.TIME_EXIT,
      why: `${t.timeStopTradingDays} trading days before expiration ${pos.expiration} (${pos.dte}d calendar)`,
    };
  }

  return null;
}

/** The time-stop date for a position, for HOLD log lines. */
export function timeStopDate(
  pos: PositionValuation,
  t: ExitThresholds,
  ctx: ExitContext,
): string {
  const legacy = pos.dteAtOpen !== null && pos.dteAtOpen > LEGACY_DTE_EXIT;
  if (legacy) return `${LEGACY_DTE_EXIT} DTE (legacy)`;
  return ctx.tradingDaysBefore(pos.expiration, t.timeStopTradingDays);
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ET calendar date of an ISO instant, 'YYYY-MM-DD'. */
function etDateOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
