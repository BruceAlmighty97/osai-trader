import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalysisCadence } from '../persistence.types';

/** Payload to add a symbol to the watchlist. */
export class CreateWatchlistItemDto {
  @ApiProperty({ example: 'SPY' })
  symbol: string;

  @ApiPropertyOptional({ example: 'S&P 500 ETF' })
  description?: string;

  @ApiPropertyOptional({
    example: 'us_equity',
    description: 'Correlation bucket (us_equity | gold | rates | silver | ...)',
  })
  correlationGroup?: string;

  @ApiPropertyOptional({
    enum: AnalysisCadence,
    default: AnalysisCadence.DAILY,
    description: 'every_cycle is costlier (an LLM call per cycle); daily is the default',
  })
  cadence?: AnalysisCadence;

  @ApiPropertyOptional({ default: true, description: 'Included in scans when true' })
  enabled?: boolean;

  @ApiPropertyOptional({ default: 0, description: 'Higher = analyzed first' })
  priority?: number;

  @ApiPropertyOptional()
  notes?: string;
}
