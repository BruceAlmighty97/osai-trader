import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

/**
 * The heartbeat of the trading day. Fires every 15 minutes and calls the OSAI
 * trader event loop. For now the loop just logs — the market-hours/NYSE-calendar
 * gate and the phase dispatch (pre-market prep, entry, manage, review) land on
 * top of this. See docs/trading-day.md.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  /** Every 15 minutes (:00, :15, :30, :45). */
  @Cron('0 */15 * * * *', { name: 'osai-tick' })
  tick(): void {
    this.runEventLoop();
  }

  /** Entry point for one pass of the trading orchestration. */
  runEventLoop(): void {
    this.logger.log('Run the OSAI trader event loop.');
  }
}
