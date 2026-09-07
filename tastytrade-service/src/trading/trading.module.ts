import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraderService } from './trader.service';
import { PreMarketService } from './pre-market.service';
import { EntryService } from './entry.service';
import { EntryAnalystService } from './entry-analyst.service';
import { ManagementService } from './management.service';
import { ReviewService } from './review.service';
import { TradingController } from './trading.controller';
import { TradingDayEntity } from './trading-day.entity';
import { WatchlistEntity } from '../persistence/entities/watchlist.entity';
import { DecisionEntity } from '../persistence/entities/decision.entity';
import { TastytradeModule } from '../tastytrade/tastytrade.module';
import { FinnhubModule } from '../finnhub/finnhub.module';
import { SocialModule } from '../social/social.module';
import { PaperModule } from '../paper/paper.module';

/**
 * The "meat" — what actually happens in each trading-day phase. The orchestrator
 * owns WHEN (tick + calendar + phase windows); this owns HOW.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TradingDayEntity, WatchlistEntity, DecisionEntity]),
    TastytradeModule,
    FinnhubModule,
    SocialModule,
    PaperModule,
  ],
  controllers: [TradingController],
  providers: [
    TraderService,
    PreMarketService,
    EntryService,
    EntryAnalystService,
    ManagementService,
    ReviewService,
  ],
  exports: [TraderService],
})
export class TradingModule {}
