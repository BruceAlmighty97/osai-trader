import { Module } from '@nestjs/common';
import { TraderService } from './trader.service';
import { PreMarketService } from './pre-market.service';
import { EntryService } from './entry.service';
import { ManagementService } from './management.service';
import { ReviewService } from './review.service';
import { TradingController } from './trading.controller';

/**
 * The "meat" — what actually happens in each trading-day phase. The orchestrator
 * owns WHEN (tick + calendar + phase windows); this owns HOW. Phase services will
 * pull in their collaborators (paper, risk, tastytrade, social) as they're built.
 */
@Module({
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
