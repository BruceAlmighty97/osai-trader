import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraderService } from './trader.service';
import { PreMarketService } from './pre-market.service';
import { EntryService } from './entry.service';
import { ManagementService } from './management.service';
import { ReviewService } from './review.service';
import { TradingController } from './trading.controller';
import { TradingDayEntity } from './trading-day.entity';
import { WatchlistEntity } from '../persistence/entities/watchlist.entity';
import { TastytradeModule } from '../tastytrade/tastytrade.module';
import { FinnhubModule } from '../finnhub/finnhub.module';
import { SocialModule } from '../social/social.module';

/**
 * The "meat" — what actually happens in each trading-day phase. The orchestrator
 * owns WHEN (tick + calendar + phase windows); this owns HOW.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TradingDayEntity, WatchlistEntity]),
    TastytradeModule,
    FinnhubModule,
    SocialModule,
  ],
  controllers: [TradingController],
  providers: [
    TraderService,
    PreMarketService,
    EntryService,
    ManagementService,
    ReviewService,
  ],
  exports: [TraderService],
})
export class TradingModule {}
