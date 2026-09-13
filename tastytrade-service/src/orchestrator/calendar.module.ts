import { Module } from '@nestjs/common';
import { MarketCalendarService } from './market-calendar.service';

/**
 * The NYSE calendar on its own, so both the dispatcher (WHEN a phase runs) and
 * the phases themselves (the exit engine's "two trading days before expiry")
 * can use it without TradingModule and OrchestratorModule importing each other.
 */
@Module({
  providers: [MarketCalendarService],
  exports: [MarketCalendarService],
})
export class CalendarModule {}
