import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Deterministic pre-trade risk policy — the gate the AI can never override.
 * Account-agnostic: the SAME rules govern the paper account now and the live
 * account later, so dollar-sensitive limits are expressed as PERCENTAGES of the
 * account's capital base (they scale to any account size).
 */
export interface RiskRules {
  /** Most open positions allowed at once (absolute). */
  maxConcurrentPositions: number;
  /** Max defined risk for one play, as % of account capital base. */
  maxRiskPerTradePct: number;
  /** Max total risk deployed across all open positions, as % of capital base. */
  maxPortfolioRiskPct: number;
  /** Max open positions in the same underlying (absolute). */
  maxPerUnderlying: number;
  /**
   * Max open positions sharing a watchlist correlationGroup. maxPerUnderlying
   * alone won't stop SPY + QQQ + IWM — three positions that are one bet. At
   * concentrated sizing this is the cap that actually protects the account.
   */
  maxPerCorrelationGroup: number;
  /** When true, all new opens are blocked. */
  killSwitch: boolean;
}

/**
 * Concentrated profile (Geoff, 2026-09-16): TWO positions, each allowed up to
 * HALF of NLV, one per underlying and one per correlated group so the two are
 * never the same bet. This overrides the playbook's 01 §5 sizing (5% / 30% /
 * five positions) — a deliberate choice, made knowing a single max-loss
 * outcome takes half the account. Deployed by scaling contracts on
 * playbook-shaped strikes (see EntryService), never by widening the spread.
 * Migration 1788740000000 applies the same values to the seeded row.
 *
 * With this much per position the kill switches (01 §9, stage 4) matter more,
 * not less.
 */
export const DEFAULT_RULES: RiskRules = {
  maxConcurrentPositions: 2,
  maxRiskPerTradePct: 50,
  maxPortfolioRiskPct: 100,
  maxPerUnderlying: 1,
  maxPerCorrelationGroup: 1,
  killSwitch: false,
};

/** Partial update of the risk rules (any subset). */
export class UpdateRulesDto {
  @ApiPropertyOptional({ example: 2 })
  maxConcurrentPositions?: number;
  @ApiPropertyOptional({ example: 50, description: '% of capital base' })
  maxRiskPerTradePct?: number;
  @ApiPropertyOptional({ example: 100, description: '% of capital base' })
  maxPortfolioRiskPct?: number;
  @ApiPropertyOptional({ example: 1 })
  maxPerUnderlying?: number;
  @ApiPropertyOptional({ example: 1, description: 'per watchlist correlationGroup' })
  maxPerCorrelationGroup?: number;
  @ApiPropertyOptional({ example: false })
  killSwitch?: boolean;
}

/** A single open position's capital at risk, for the gate's aggregate checks. */
export interface OpenPositionRisk {
  symbol: string;
  risk: number; // $ at risk for this position
}

/** Everything the gate needs about the account + the proposed trade ($). */
export interface RiskCheckContext {
  /** Capital base the % caps apply to (paper: settled value; live: NLV). */
  accountValue: number;
  buyingPowerAvailable: number;
  openPositions: OpenPositionRisk[];
  symbol: string;
  proposedRisk: number;
}

export interface RiskCheckResult {
  ok: boolean;
  reason?: string;
}
