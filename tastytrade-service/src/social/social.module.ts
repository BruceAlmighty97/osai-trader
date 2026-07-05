import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialMentionEntity } from './social-mention.entity';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { RedditClient } from './reddit.client';

/**
 * Social-sentiment scanner (Phase A): polls Reddit for tickers gaining attention
 * and stores them as mentions. Trending symbols become watchlist candidates in
 * Phase B. See docs/ideas-backlog.md for the full design.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SocialMentionEntity])],
  controllers: [SocialController],
  providers: [SocialService, RedditClient],
  exports: [SocialService],
})
export class SocialModule {}
