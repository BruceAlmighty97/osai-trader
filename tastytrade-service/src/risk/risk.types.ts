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
  /** When true, all new opens are blocked. */
  killSwitch: boolean;
}

/** "Moderate" default profile (5% / 40% ≈ $125 / $1000 on a $2500 account). */
export const DEFAULT_RULES: RiskRules = {
  maxConcurrentPositions: 4,
  maxRiskPerTradePct: 5,
  maxPortfolioRiskPct: 40,
  maxPerUnderlying: 1,
  killSwitch: false,
};

/** Partial update of the risk rules (any subset). */
export class UpdateRulesDto {
  @ApiPropertyOptional({ example: 4 })
  maxConcurrentPositions?: number;
  @ApiPropertyOptional({ example: 5, description: '% of capital base' })
  maxRiskPerTradePct?: number;
  @ApiPropertyOptional({ example: 40, description: '% of capital base' })
  maxPortfolioRiskPct?: number;
  @ApiPropertyOptional({ example: 1 })
  maxPerUnderlying?: number;
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
