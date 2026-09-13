import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { CalendarModule } from './calendar.module';
import { TradingModule } from '../trading/trading.module';

/**
 * The trading-day scheduler/dispatcher (in-process, via @nestjs/schedule).
 * Owns WHEN work happens; delegates WHAT to TradingModule's TraderService.
 */
@Module({
  imports: [TradingModule, CalendarModule],
  providers: [OrchestratorService],
  exports: [OrchestratorService, CalendarModule],
})
export class OrchestratorModule {}
