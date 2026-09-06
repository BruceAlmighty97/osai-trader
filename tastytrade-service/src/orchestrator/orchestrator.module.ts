import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { MarketCalendarService } from './market-calendar.service';

/** The trading-day scheduler/dispatcher (in-process, via @nestjs/schedule). */
@Module({
  providers: [OrchestratorService, MarketCalendarService],
  exports: [OrchestratorService, MarketCalendarService],
})
export class OrchestratorModule {}
