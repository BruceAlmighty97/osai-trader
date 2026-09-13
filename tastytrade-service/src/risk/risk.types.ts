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
 * Playbook profile (docs/playbook/01-account-and-capital-rules.md §5, RULES
 * S1-S5): max loss per position 5% of NLV ($125 on $2,500), total buying power
 * in use 30%, five positions, one per underlying, two per correlated group.
 * Capital preservation first — at 7-14 DTE a single gap can take a position to
 * max loss, so no one position may be more than the account's daily loss
 * budget. Migration 1788720000000 applies the same values to the seeded row.
 *
 * Not yet here (later stages): 20% BP cap when VIX >= 30 (S3), the greek caps
 * (03 §4.2) and the kill switches (01 §9).
 */
export const DEFAULT_RULES: RiskRules = {
  maxConcurrentPositions: 5,
  maxRiskPerTradePct: 5,
  maxPortfolioRiskPct: 30,
  maxPerUnderlying: 1,
  maxPerCorrelationGroup: 2,
  killSwitch: false,
};

/** Partial update of the risk rules (any subset). */
export class UpdateRulesDto {
  @ApiPropertyOptional({ example: 5 })
  maxConcurrentPositions?: number;
  @ApiPropertyOptional({ example: 5, description: '% of capital base' })
  maxRiskPerTradePct?: number;
  @ApiPropertyOptional({ example: 30, description: '% of capital base' })
  maxPortfolioRiskPct?: number;
  @ApiPropertyOptional({ example: 1 })
  maxPerUnderlying?: number;
  @ApiPropertyOptional({ example: 2, description: 'per watchlist correlationGroup' })
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
