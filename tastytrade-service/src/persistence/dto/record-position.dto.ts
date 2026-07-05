import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OptionLeg, StrategyType } from '../persistence.types';

/** Payload to record an open position by hand (pre-execution seeding/testing). */
export class RecordPositionDto {
  @ApiProperty({ example: 'SPY' })
  symbol: string;

  @ApiProperty({ enum: StrategyType, example: StrategyType.BULL_PUT_SPREAD })
  strategy: StrategyType;

  @ApiProperty({ example: '2026-08-21' })
  expiration: string;

  @ApiProperty({
    description: 'Legs of the spread, incl. DXLink streamer symbols for re-quoting',
    example: [
      { action: 'Sell to Open', right: 'P', strike: 600, quantity: 1, streamerSymbol: '.SPY260821P600' },
      { action: 'Buy to Open', right: 'P', strike: 599, quantity: 1, streamerSymbol: '.SPY260821P599' },
    ],
  })
  legs: OptionLeg[];

  @ApiPropertyOptional({ example: 1, default: 1 })
  quantity?: number;

  @ApiProperty({ example: 0.35, description: 'Net credit received per spread unit' })
  entryCredit: number;

  @ApiPropertyOptional({ example: 65, description: '(width - credit) * 100 per unit' })
  maxRisk?: number;

  @ApiPropertyOptional({
    description: 'When the position was opened (ISO). Defaults to now.',
    example: '2026-07-04T14:30:00.000Z',
  })
  openedAt?: string;

  @ApiPropertyOptional({ description: 'Soft link to the decision that opened it' })
  openDecisionId?: number;

  @ApiPropertyOptional({ description: 'Soft link to the opening order' })
  openOrderId?: number;

  @ApiPropertyOptional()
  notes?: string;
}
