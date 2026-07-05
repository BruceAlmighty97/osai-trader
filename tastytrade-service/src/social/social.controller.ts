import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  AuditSummary,
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
   * Poll the configured subreddits now and store extracted ticker mentions.
   * Manual trigger for Phase A; a scheduled cron lands with the scheduler work.
   */
  @Post('ingest')
  @ApiOperation({ summary: 'Poll subreddits now and store ticker mentions' })
  @ApiQuery({ name: 'subreddits', required: false, description: 'comma-separated override' })
  @ApiQuery({ name: 'sort', required: false, enum: ['hot', 'new', 'rising', 'top'] })
  @ApiQuery({ name: 'limit', required: false, example: '50' })
  ingest(
    @Query('subreddits') subreddits?: string,
    @Query('sort') sort?: 'hot' | 'new' | 'rising' | 'top',
    @Query('limit') limit?: string,
  ): Promise<IngestSummary> {
    return this.social.ingest({
      subreddits: subreddits
        ? subreddits.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
      sort,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('mentions')
  @ApiOperation({ summary: 'List raw stored mentions (newest first)' })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  @ApiQuery({ name: 'subreddit', required: false, example: 'options' })
  @ApiQuery({ name: 'limit', required: false, example: '100' })
  mentions(
    @Query('symbol') symbol?: string,
    @Query('subreddit') subreddit?: string,
    @Query('limit') limit?: string,
  ): Promise<SocialMentionEntity[]> {
    return this.social.findMentions({
      symbol,
      subreddit,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('trending')
  @ApiOperation({
    summary: 'Rank symbols by attention over a rolling window (distinct authors + mentions)',
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

  /**
   * Deletion-compliance audit: re-check the least-recently-verified live rows
   * against Reddit and purge/tombstone any whose source is gone.
   */
  @Post('audit')
  @ApiOperation({ summary: 'Run the deletion-compliance audit (purge deleted content)' })
  @ApiQuery({ name: 'limit', required: false, example: '300' })
  audit(@Query('limit') limit?: string): Promise<AuditSummary> {
    return this.social.auditDeletions(limit ? parseInt(limit, 10) : undefined);
  }
}
