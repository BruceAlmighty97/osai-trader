import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExitReason } from '../persistence.types';

/** Payload to close an open position (mark closed + record outcome). */
export class ClosePositionDto {
  @ApiProperty({ enum: ExitReason, example: ExitReason.PROFIT_TARGET })
  exitReason: ExitReason;

  @ApiPropertyOptional({
    example: 21,
    description: 'Realized P&L total across all units (positive = profit)',
  })
  realizedPnl?: number;

  @ApiPropertyOptional({ description: 'Soft link to the closing order' })
  closeOrderId?: number;

  @ApiPropertyOptional({
    description: 'When it was closed (ISO). Defaults to now.',
    example: '2026-07-11T18:00:00.000Z',
  })
  closedAt?: string;

  @ApiPropertyOptional()
  notes?: string;
}
