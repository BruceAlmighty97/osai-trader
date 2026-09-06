/** What kind of work a tick should do. See docs/trading-day.md. */
export enum TradingPhase {
  PRE_MARKET = 'pre_market',
  ENTRY = 'entry',
  MANAGE = 'manage',
  AFTER_CLOSE = 'after_close',
  NONE = 'none',
}

export interface PhaseWindow {
  phase: TradingPhase;
  label: string;
  /** Minutes from ET midnight, inclusive on both ends. */
  startMin: number;
  endMin: number;
  /** Half-days close at 1pm ET — shift these windows earlier. */
  shiftOnEarlyClose: boolean;
}

const at = (h: number, m = 0): number => h * 60 + m;

/** Half-days close 3h early (13:00 vs 16:00), so late phases move with it. */
export const EARLY_CLOSE_SHIFT_MIN = 180;

/**
 * The trading-day schedule (ET). Ticks land on :00/:15/:30/:45, so single-point
 * phases are matched exactly and windows cover every tick inside them.
 * The optional afternoon-entry window (14:00-14:30) is deliberately omitted until
 * the core loop is proven — see docs/trading-day.md.
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
    // 09:30-10:00 is deliberately skipped — widest spreads, worst fills.
    phase: TradingPhase.ENTRY,
    label: 'morning entry',
    startMin: at(10),
    endMin: at(11, 30),
    shiftOnEarlyClose: false,
  },
  {
    phase: TradingPhase.MANAGE,
    label: 'midday manage',
    startMin: at(12, 30),
    endMin: at(12, 30),
    shiftOnEarlyClose: false,
  },
  {
    phase: TradingPhase.MANAGE,
    label: 'power-hour manage',
    startMin: at(15),
    endMin: at(15, 45),
    shiftOnEarlyClose: true,
  },
  {
    phase: TradingPhase.AFTER_CLOSE,
    label: 'after-close review',
    startMin: at(16, 15),
    endMin: at(16, 15),
    shiftOnEarlyClose: true,
  },
];
