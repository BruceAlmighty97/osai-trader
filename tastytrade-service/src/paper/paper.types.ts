import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExitReason, StrategyType } from '../persistence/persistence.types';
import { RiskRules } from '../risk/risk.types';
import { ArmConfig } from './paper-account.entity';

/**
 * Paper trading = an imaginary account tracked entirely in OUR database. Real
 * market metrics come in (production tastytrade), but nothing is ever sent to a
 * broker. TRADING_MODE guards that intent; there is no live-order code path.
 */
export const TRADING_MODE = (process.env.TRADING_MODE ?? 'paper').toLowerCase();
export const IS_PAPER = TRADING_MODE === 'paper';

/** Default open commission per contract (tastytrade ≈ $1 open / $0 close). */
export const COMMISSION_PER_CONTRACT = Number(
  process.env.COMMISSION_PER_CONTRACT ?? 1,
);

class SuggestionLegInput {
  @ApiProperty({ example: 'Sell to Open' })
  action: string;
  @ApiProperty({ enum: ['P', 'C'], example: 'P' })
  right: 'P' | 'C';
  @ApiProperty({ example: 440 })
  strike: number;
}

/** Accept a /strategy/suggest play into the imaginary ledger. */
export class OpenFromSuggestionDto {
  @ApiProperty({ example: 'SPY' })
  symbol: string;

  @ApiProperty({ enum: StrategyType, example: StrategyType.BULL_PUT_SPREAD })
  strategy: StrategyType;

  @ApiProperty({ example: '2026-10-17' })
  expiration: string;

  @ApiProperty({ type: [SuggestionLegInput] })
  legs: SuggestionLegInput[];

  @ApiProperty({
    description: 'Net credit per spread unit (the AI targetCreditPerSpread).',
    example: 0.62,
  })
  creditPerSpread: number;

  @ApiProperty({
    description: 'Defined max risk per spread unit, e.g. (width - credit).',
    example: 4.38,
  })
  maxRiskPerSpread: number;

  @ApiPropertyOptional({ description: 'Spread units to open.', default: 1 })
  contracts?: number;

  @ApiPropertyOptional({ description: 'Free-text note (e.g. AI rationale).' })
  notes?: string;

  @ApiPropertyOptional({ description: 'Link to a strategy_decisions row.' })
  decisionId?: number;

  @ApiPropertyOptional({
    description: 'Experiment arm to open in. Defaults to the baseline arm.',
    example: 'mech',
  })
  account?: string;
}

/** Close an open imaginary position and realize the P&L. */
export class ClosePositionDto {
  @ApiProperty({
    description:
      'Debit per spread unit to close (what you pay to buy it back). 0 = expired worthless / max profit.',
    example: 0.2,
  })
  closeDebitPerSpread: number;

  @ApiPropertyOptional({ enum: ExitReason, default: ExitReason.MANUAL })
  exitReason?: ExitReason;
}

export interface PaperAccountSummary {
  /** Arm key, e.g. 'mech' or 'ai'. */
  name: string;
  accountId: number;
  /** What this arm is testing. */
  description: string | null;
  enabled: boolean;
  /** Arm overrides on top of the ENTRY_* env defaults. */
  config: ArmConfig;
  startingBalance: number;
  /** Active risk rules (from the shared risk_config, shown for convenience). */
  rules: RiskRules;
  realizedPnl: number;
  /** startingBalance + realizedPnl (settled; excludes open unrealized). */
  settledValue: number;
  buyingPowerUsed: number;
  buyingPowerAvailable: number;
  openPositions: number;
  closedPositions: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number | null;
}
