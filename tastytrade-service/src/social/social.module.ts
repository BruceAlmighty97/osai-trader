import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialMentionEntity } from './social-mention.entity';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { StockTwitsClient } from './stocktwits.client';

/**
 * Social-sentiment scanner: pulls StockTwits messages (with Bullish/Bearish tags)
 * for trending / watchlist symbols and stores them as mentions. Trending symbols +
 * net sentiment feed the entry analyst. See docs/data-sources.md.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SocialMentionEntity])],
  controllers: [SocialController],
  providers: [SocialService, StockTwitsClient],
  exports: [SocialService, StockTwitsClient],
})
export class SocialModule {}
