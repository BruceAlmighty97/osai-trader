import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum StrategyType {
  BULL_PUT_SPREAD = 'bull_put_spread',
  BEAR_CALL_SPREAD = 'bear_call_spread',
  IRON_CONDOR = 'iron_condor',
  IRON_BUTTERFLY = 'iron_butterfly',
  COVERED_CALL = 'covered_call',
  NO_TRADE = 'no_trade',
}

export enum DecisionType {
  OPEN_POSITION = 'open_position',
  CLOSE_POSITION = 'close_position',
  ADJUST_POSITION = 'adjust_position',
  NO_TRADE = 'no_trade',
}

export enum DecisionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXECUTED = 'executed',
  ERROR = 'error',
}

export enum AnalysisTrigger {
  MANUAL = 'manual',
  SCHEDULED_SCAN = 'scheduled_scan',
  POSITION_REVIEW = 'position_review',
}

export interface ProposedTradeLeg {
  action: 'BUY' | 'SELL';
  symbol: string;
  secType: 'STK' | 'OPT';
  quantity: number;
  orderType: 'LMT' | 'MKT';
  limitPrice?: number;
  expiration?: string;
  strike?: number;
  right?: 'C' | 'P';
}

export interface ProposedTrade {
  strategy: StrategyType;
  underlying: string;
  legs: ProposedTradeLeg[];
  expectedCredit?: number;
  expectedDebit?: number;
  maxRisk?: number;
  maxProfit?: number;
  targetDTE?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export class RunAnalysisDto {
  @ApiPropertyOptional({ description: 'Underlying symbol to analyze', example: 'SPY' })
  underlying?: string;

  @ApiPropertyOptional({
    enum: AnalysisTrigger,
    description: 'What triggered this analysis',
    default: AnalysisTrigger.MANUAL,
  })
  trigger?: AnalysisTrigger;
}

export interface AnalysisResult {
  id: number;
  sessionId: string;
  trigger: string;
  underlying: string | null;
  strategyType: StrategyType | null;
  decision: DecisionType;
  reasoning: string;
  proposedTrade: ProposedTrade | null;
  riskCheckResult: { approved: boolean; violations: string[] } | null;
  executionResult: Record<string, unknown> | null;
  status: DecisionStatus;
  tokenUsage: TokenUsage;
  durationMs: number;
  errorMessage: string | null;
  createdAt: Date;
}
