import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TradeAction {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum TradeOrderType {
  MARKET = 'MKT',
  LIMIT = 'LMT',
  STOP = 'STP',
  STOP_LIMIT = 'STP LMT',
}

export enum TradeSecType {
  STOCK = 'STK',
  OPTION = 'OPT',
}

export enum OrderLifecycleStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  FILLED = 'FILLED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  CANCELLED = 'CANCELLED',
  ERROR = 'ERROR',
}

export class SubmitOrderDto {
  @ApiProperty({ description: 'Ticker symbol', example: 'SPY' })
  symbol: string;

  @ApiProperty({ enum: TradeSecType, description: 'Security type', example: 'OPT' })
  secType: TradeSecType;

  @ApiProperty({ enum: TradeAction, description: 'Buy or sell', example: 'SELL' })
  action: TradeAction;

  @ApiProperty({ description: 'Number of contracts or shares', example: 1 })
  quantity: number;

  @ApiProperty({ enum: TradeOrderType, description: 'Order type', example: 'LMT' })
  orderType: TradeOrderType;

  @ApiPropertyOptional({ description: 'Limit price (required for LMT and STP LMT)', example: 2.50 })
  limitPrice?: number;

  @ApiPropertyOptional({ description: 'Stop price (required for STP and STP LMT)', example: 2.00 })
  stopPrice?: number;

  @ApiPropertyOptional({ description: 'Exchange', example: 'SMART' })
  exchange?: string;

  @ApiPropertyOptional({ description: 'Currency', example: 'USD' })
  currency?: string;

  // Options-specific fields
  @ApiPropertyOptional({ description: 'Expiration date YYYYMMDD', example: '20260417' })
  expiration?: string;

  @ApiPropertyOptional({ description: 'Strike price', example: 655 })
  strike?: number;

  @ApiPropertyOptional({ description: 'Option right: C (call) or P (put)', enum: ['C', 'P'], example: 'P' })
  right?: 'C' | 'P';
}

export interface TrackedOrder {
  orderId: number;
  symbol: string;
  secType: string;
  action: string;
  quantity: number;
  orderType: string;
  limitPrice?: number;
  stopPrice?: number;
  status: OrderLifecycleStatus;
  filledQuantity: number;
  avgFillPrice: number;
  remaining: number;
  expiration?: string;
  strike?: number;
  right?: string;
  submittedAt: Date;
  updatedAt: Date;
  errorMessage?: string;
}
