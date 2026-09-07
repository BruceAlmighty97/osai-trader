/**
 * The trading-day phases and the contract every phase handler implements.
 * Lives here (not in orchestrator/) so the dependency runs one way:
 * orchestrator -> trading. See docs/trading-day.md.
 */
export enum TradingPhase {
  PRE_MARKET = 'pre_market',
  ENTRY = 'entry',
  MANAGE = 'manage',
  AFTER_CLOSE = 'after_close',
  NONE = 'none',
}

/** What a phase run is given. Each tick is a separate invocation. */
export interface PhaseContext {
  now: Date;
  /** Scheduled tick vs. a manual /trading/run call. */
  trigger: 'tick' | 'manual';
  /** ET wall-clock label for logs, e.g. "10:15 ET". */
  clock?: string;
}

/** What a phase run reports back. */
export interface PhaseResult {
  phase: TradingPhase;
  /** false when the phase was a no-op (nothing to do, or still a stub). */
  ran: boolean;
  summary: string;
  details?: Record<string, unknown>;
}
