import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RiskConfigData {
  // --- Position Limits ---

  @ApiProperty({ description: 'Max contracts per position', example: 10 })
  maxPositionSize: number;

  @ApiProperty({ description: 'Max notional dollar value per trade', example: 50000 })
  maxNotionalPerTrade: number;

  @ApiProperty({ description: 'Max number of open positions', example: 20 })
  maxOpenPositions: number;

  // --- Portfolio Limits ---

  @ApiProperty({ description: 'Max absolute portfolio delta exposure', example: 500 })
  maxPortfolioDelta: number;

  @ApiProperty({ description: 'Max absolute portfolio gamma exposure', example: 100 })
  maxPortfolioGamma: number;

  @ApiProperty({ description: 'Max buying power utilization (0-1)', example: 0.5 })
  maxBuyingPowerUsage: number;

  @ApiProperty({ description: 'Max margin utilization (0-1)', example: 0.8 })
  maxMarginUsage: number;

  // --- Loss Limits ---

  @ApiProperty({ description: 'Max realized loss per day in USD — halts new trades', example: 1000 })
  maxDailyLoss: number;

  @ApiProperty({ description: 'Max realized loss per week in USD — halts and notifies', example: 3000 })
  maxWeeklyLoss: number;

  @ApiProperty({ description: 'Max unrealized loss per position in USD — triggers auto-close', example: 500 })
  maxPositionLoss: number;

  @ApiProperty({ description: 'Max drawdown from peak equity (0-1) — full stop', example: 0.1 })
  maxDrawdownPercent: number;

  // --- Operational ---

  @ApiProperty({ description: 'Max age of market data in seconds before rejecting trades', example: 30 })
  dataFreshnessMaxAge: number;

  @ApiProperty({ description: 'Master kill switch — disables all trading', example: true })
  tradingEnabled: boolean;
}

export class UpdateRiskConfigDto {
  @ApiPropertyOptional({ description: 'Max contracts per position' })
  maxPositionSize?: number;

  @ApiPropertyOptional({ description: 'Max notional dollar value per trade' })
  maxNotionalPerTrade?: number;

  @ApiPropertyOptional({ description: 'Max number of open positions' })
  maxOpenPositions?: number;

  @ApiPropertyOptional({ description: 'Max absolute portfolio delta exposure' })
  maxPortfolioDelta?: number;

  @ApiPropertyOptional({ description: 'Max absolute portfolio gamma exposure' })
  maxPortfolioGamma?: number;

  @ApiPropertyOptional({ description: 'Max buying power utilization (0-1)' })
  maxBuyingPowerUsage?: number;

  @ApiPropertyOptional({ description: 'Max margin utilization (0-1)' })
  maxMarginUsage?: number;

  @ApiPropertyOptional({ description: 'Max realized loss per day in USD' })
  maxDailyLoss?: number;

  @ApiPropertyOptional({ description: 'Max realized loss per week in USD' })
  maxWeeklyLoss?: number;

  @ApiPropertyOptional({ description: 'Max unrealized loss per position in USD' })
  maxPositionLoss?: number;

  @ApiPropertyOptional({ description: 'Max drawdown from peak equity (0-1)' })
  maxDrawdownPercent?: number;

  @ApiPropertyOptional({ description: 'Max age of market data in seconds' })
  dataFreshnessMaxAge?: number;

  @ApiPropertyOptional({ description: 'Master kill switch' })
  tradingEnabled?: boolean;
}

export const DEFAULT_RISK_CONFIG: RiskConfigData = {
  maxPositionSize: 10,
  maxNotionalPerTrade: 50000,
  maxOpenPositions: 20,
  maxPortfolioDelta: 500,
  maxPortfolioGamma: 100,
  maxBuyingPowerUsage: 0.5,
  maxMarginUsage: 0.8,
  maxDailyLoss: 1000,
  maxWeeklyLoss: 3000,
  maxPositionLoss: 500,
  maxDrawdownPercent: 0.1,
  dataFreshnessMaxAge: 30,
  tradingEnabled: true,
};
