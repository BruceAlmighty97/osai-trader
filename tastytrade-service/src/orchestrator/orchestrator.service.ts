import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EtParts, MarketCalendarService } from './market-calendar.service';
import {
  EARLY_CLOSE_SHIFT_MIN,
  PHASE_SCHEDULE,
  TradingPhase,
} from './orchestrator.types';

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

  constructor(private readonly calendar: MarketCalendarService) {}

  onModuleInit(): void {
    this.logger.log('Orchestrator scheduler armed — event-loop tick registered.');
  }

  /** Every 15 minutes (:00, :15, :30, :45). */
  @Cron('0 */15 * * * *', { name: 'osai-tick' })
  tick(): void {
    this.runEventLoop();
  }

  /** Entry point for one pass of the trading orchestration. */
  runEventLoop(now: Date = new Date()): void {
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
    this.dispatch(match.phase);
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

  /** Phase handlers — stubs for now; each gets its real implementation next. */
  private dispatch(phase: TradingPhase): void {
    switch (phase) {
      case TradingPhase.PRE_MARKET:
        this.logger.log('  → pre-market: build candidates (stub)');
        break;
      case TradingPhase.ENTRY:
        this.logger.log('  → entry: discover/qualify/propose (stub)');
        break;
      case TradingPhase.MANAGE:
        this.logger.log('  → manage: mark-to-market + exit rules (stub)');
        break;
      case TradingPhase.AFTER_CLOSE:
        this.logger.log('  → after-close: review + log the day (stub)');
        break;
      default:
        break;
    }
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
