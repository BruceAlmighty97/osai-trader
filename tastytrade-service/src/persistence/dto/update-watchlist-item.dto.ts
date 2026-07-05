import { ApiPropertyOptional } from '@nestjs/swagger';
import { AnalysisCadence } from '../persistence.types';

/**
 * Payload to update a watchlist entry. All fields optional — omit what you don't
 * change. `symbol` is not editable (it's the key; delete + re-add to rename).
 */
export class UpdateWatchlistItemDto {
  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Correlation bucket' })
  correlationGroup?: string;

  @ApiPropertyOptional({ enum: AnalysisCadence })
  cadence?: AnalysisCadence;

  @ApiPropertyOptional({ description: 'Pause/resume in scans' })
  enabled?: boolean;

  @ApiPropertyOptional()
  priority?: number;

  @ApiPropertyOptional()
  notes?: string;
}
