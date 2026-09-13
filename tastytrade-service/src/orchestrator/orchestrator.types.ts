import { TradingPhase } from '../trading/trading.types';

export interface PhaseWindow {
  phase: TradingPhase;
  label: string;
  /** Minutes from ET midnight, inclusive on both ends. */
  startMin: number;
  endMin: number;
  /** Half-days close at 1pm ET — shift these windows earlier. */
  shiftOnEarlyClose: boolean;
  /**
   * Only fire on ticks whose ET minute is a multiple of this. The heartbeat is
   * every TICK_MINUTES; a window may want a coarser cadence (entries every
   * 15 min, not every 5 — each entry tick is a chain fetch and maybe a model
   * call). Omit to fire on every tick inside the window.
   */
  everyMinutes?: number;
}

const at = (h: number, m = 0): number => h * 60 + m;

/** Heartbeat cadence. The cron expression in orchestrator.service must match. */
export const TICK_MINUTES = 5;

/** Half-days close 3h early (13:00 vs 16:00), so late phases move with it. */
export const EARLY_CLOSE_SHIFT_MIN = 180;

/**
 * The trading-day schedule (ET). Ticks land every TICK_MINUTES; a tick runs
 * EVERY window it falls inside, in this order — so on a quarter-hour inside
 * the session MANAGE runs first (a stop fires, buying power frees) and ENTRY
 * second. Playbook 06 §1.2 / §5.2:
 *
 *   - stops are evaluated continuously in RTH (every tick, 09:35-15:55; the
 *     first five minutes are skipped for quote quality, the last five are the
 *     closing auction);
 *   - entries 10:00-15:30 on quarter-hours, never 09:30-09:45 or after 15:30
 *     (release-day offsets — 10:05 / 10:15 / 10:30 — land with the event
 *     calendar);
 *   - pre-market prep at 08:00 and the after-close review at 16:15 run once.
 */
export const PHASE_SCHEDULE: PhaseWindow[] = [
  {
    phase: TradingPhase.PRE_MARKET,
    label: 'pre-market prep',
    startMin: at(8),
    endMin: at(8),
    shiftOnEarlyClose: false,
  },
  {
    phase: TradingPhase.MANAGE,
    label: 'manage (stops / targets / time exit)',
    startMin: at(9, 35),
    endMin: at(15, 55),
    shiftOnEarlyClose: true,
  },
  {
    phase: TradingPhase.ENTRY,
    label: 'entry window',
    startMin: at(10),
    endMin: at(15, 30),
    shiftOnEarlyClose: true,
    everyMinutes: 15,
  },
  {
    phase: TradingPhase.AFTER_CLOSE,
    label: 'after-close review',
    startMin: at(16, 15),
    endMin: at(16, 15),
    shiftOnEarlyClose: true,
  },
];
