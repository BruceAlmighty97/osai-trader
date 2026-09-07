import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { MarketCalendarService } from './market-calendar.service';
import { TradingModule } from '../trading/trading.module';

/**
 * The trading-day scheduler/dispatcher (in-process, via @nestjs/schedule).
 * Owns WHEN work happens; delegates WHAT to TradingModule's TraderService.
 */
@Module({
  imports: [TradingModule],
  providers: [OrchestratorService, MarketCalendarService],
  exports: [OrchestratorService, MarketCalendarService],
})
export class OrchestratorModule {}
