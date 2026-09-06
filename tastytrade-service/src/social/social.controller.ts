import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  IngestSummary,
  SocialService,
  TrendingRow,
} from './social.service';
import { SocialMentionEntity } from './social-mention.entity';

@ApiTags('social')
@Controller('social')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  /**
   * Pull StockTwits messages now and store ticker mentions (with sentiment).
   * With no `symbols`, uses the current StockTwits trending list. Manual trigger
   * for now; a scheduled cron lands with the trading-day scheduler.
   */
  @Post('ingest')
  @ApiOperation({ summary: 'Pull StockTwits messages now and store mentions' })
  @ApiQuery({
    name: 'symbols',
    required: false,
    description: 'comma-separated; defaults to StockTwits trending',
  })
  @ApiQuery({ name: 'limit', required: false, example: '30' })
  ingest(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string,
  ): Promise<IngestSummary> {
    return this.social.ingest({
      symbols: symbols
        ? symbols.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('mentions')
  @ApiOperation({ summary: 'List raw stored mentions (newest first)' })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  @ApiQuery({ name: 'source', required: false, example: 'stocktwits' })
  @ApiQuery({ name: 'limit', required: false, example: '100' })
  mentions(
    @Query('symbol') symbol?: string,
    @Query('source') source?: string,
    @Query('limit') limit?: string,
  ): Promise<SocialMentionEntity[]> {
    return this.social.findMentions({
      symbol,
      source,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('trending')
  @ApiOperation({
    summary:
      'Rank symbols by attention over a rolling window, with bull/bear lean',
  })
  @ApiQuery({ name: 'windowHours', required: false, example: '24' })
  @ApiQuery({ name: 'limit', required: false, example: '25' })
  trending(
    @Query('windowHours') windowHours?: string,
    @Query('limit') limit?: string,
  ): Promise<TrendingRow[]> {
    return this.social.trending(
      windowHours ? parseInt(windowHours, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
