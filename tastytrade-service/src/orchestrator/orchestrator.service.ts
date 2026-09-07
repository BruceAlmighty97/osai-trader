import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EtParts, MarketCalendarService } from './market-calendar.service';
import { EARLY_CLOSE_SHIFT_MIN, PHASE_SCHEDULE } from './orchestrator.types';
import { TraderService } from '../trading/trader.service';
import { TradingPhase } from '../trading/trading.types';

/**
 * The heartbeat of the trading day. Ticks every 15 minutes; each tick asks two
 * questions — is today a trading day (NYSE calendar), and which phase is it right
 * now (ET) — then dispatches that phase. Ticks outside every window no-op, so
 * pre-market and after-close work still runs even though the market is shut.
 * See docs/trading-day.md.
 */
@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly calendar: MarketCalendarService,
    private readonly trader: TraderService,
  ) {}

  onModuleInit(): void {
    this.logger.log('Orchestrator scheduler armed — event-loop tick registered.');
  }

  /** Every 15 minutes (:00, :15, :30, :45). */
  @Cron('0 */15 * * * *', { name: 'osai-tick' })
  async tick(): Promise<void> {
    await this.runEventLoop();
  }

  /** Entry point for one pass of the trading orchestration. */
  async runEventLoop(now: Date = new Date()): Promise<void> {
    const parts = this.calendar.etParts(now);
    const clock = `${pad(parts.hour)}:${pad(parts.minute)} ET`;

    if (!this.calendar.isTradingDay(now)) {
      this.logger.debug(`Skip — not a trading day (${clock}).`);
      return;
    }

    const earlyClose = this.calendar.isEarlyClose(now);
    const suffix = earlyClose ? ' [early close]' : '';
    const match = this.phaseFor(parts, earlyClose);

    if (match.phase === TradingPhase.NONE) {
      this.logger.debug(`Skip — no phase active at ${clock}${suffix}.`);
      return;
    }

    this.logger.log(
      `Run the OSAI trader event loop — ${match.label} @ ${clock}${suffix}`,
    );

    // A failing phase must never kill the heartbeat — the next tick still runs.
    try {
      const result = await this.trader.runPhase(match.phase, {
        now,
        trigger: 'tick',
        clock,
      });
      this.logger.log(`  → ${result.summary}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`  → ${match.label} failed: ${msg}`);
    }
  }

  /** Map an ET wall-clock time to its trading phase (early close shifts late phases). */
  phaseFor(
    parts: EtParts,
    earlyClose: boolean,
  ): { phase: TradingPhase; label: string } {
    const mins = parts.hour * 60 + parts.minute;
    for (const w of PHASE_SCHEDULE) {
      const shift =
        earlyClose && w.shiftOnEarlyClose ? EARLY_CLOSE_SHIFT_MIN : 0;
      if (mins >= w.startMin - shift && mins <= w.endMin - shift) {
        return { phase: w.phase, label: w.label };
      }
    }
    return { phase: TradingPhase.NONE, label: 'none' };
  }

}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
