/**
 * Shared enums + shapes for the persistence layer.
 *
 * Our Postgres is the system of record (see docs/persistence-and-db.md): the
 * tastytrade sandbox wipes balances/positions nightly, so the canonical record
 * of what we hold lives here, not at the broker.
 */

/** The strategy playbook — mirrors the AI suggestion enum in strategy.service.ts. */
export enum StrategyType {
  BULL_PUT_SPREAD = 'bull_put_spread',
  BEAR_CALL_SPREAD = 'bear_call_spread',
  IRON_CONDOR = 'iron_condor',
  IRON_BUTTERFLY = 'iron_butterfly',
  COVERED_CALL = 'covered_call',
}

export enum PositionStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

/** Why a position was closed — drives the management-loop exit rules. */
export enum ExitReason {
  PROFIT_TARGET = 'profit_target', // 50% of max profit
  DTE_ROLL = 'dte_roll', // ~21 DTE, before gamma ramps
  STOP_LOSS = 'stop_loss', // ~2x credit received
  EXPIRED = 'expired', // held to expiration
  MANUAL = 'manual', // closed by hand
}

/** Order lifecycle — adapted from the legacy IBKR order module for tastytrade. */
export enum OrderStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
}

/** What kicked off an AI decision. */
export enum DecisionTrigger {
  MANUAL = 'manual', // POST /strategy/suggest by hand
  SCAN = 'scan', // watchlist scan pipeline
  CRON = 'cron', // scheduled run
}

/**
 * How often a watchlist symbol should be run through the AI entry pipeline.
 * EVERY_CYCLE is costlier (an LLM call per scan cycle) — reserve it for anchors;
 * DAILY matches the "scan 1-2x/day" cost design in docs/architecture-pipeline.md.
 */
export enum AnalysisCadence {
  EVERY_CYCLE = 'every_cycle',
  DAILY = 'daily',
}

/**
 * One leg of a multi-leg options position/order. `streamerSymbol` is the DXLink
 * symbol used to re-fetch live quotes/greeks for the management loop — without
 * it we can't value an open position after the broker forgets it.
 */
export interface OptionLeg {
  action: string; // 'Sell to Open' | 'Buy to Open' | 'Sell to Close' | 'Buy to Close'
  right: 'P' | 'C';
  strike: number;
  quantity: number; // contracts per spread unit
  streamerSymbol?: string; // DXLink symbol for live re-quote
  entryPrice?: number; // per-contract price at entry, if known
}
