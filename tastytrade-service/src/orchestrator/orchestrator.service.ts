import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EtParts, MarketCalendarService } from './market-calendar.service';
import { EARLY_CLOSE_SHIFT_MIN, PHASE_SCHEDULE, PhaseWindow } from './orchestrator.types';
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

  /** Every 5 minutes (TICK_MINUTES) — stops at 7-14 DTE need the finer cadence. */
  @Cron('0 */5 * * * *', { name: 'osai-tick' })
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
    const windows = this.phasesFor(parts, earlyClose);

    if (!windows.length) {
      this.logger.debug(`Skip — no phase active at ${clock}${suffix}.`);
      return;
    }

    this.logger.log(
      `Run the OSAI trader event loop — ${windows.map((w) => w.label).join(' → ')} @ ${clock}${suffix}`,
    );

    // Phases run in schedule order, sequentially: MANAGE before ENTRY so a
    // stop that fires this tick frees buying power for the same tick's entry.
    // A failing phase must never kill the heartbeat — the next phase and the
    // next tick still run.
    for (const w of windows) {
      try {
        const result = await this.trader.runPhase(w.phase, {
          now,
          trigger: 'tick',
          clock,
        });
        this.logger.log(`  → ${w.label}: ${result.summary}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`  → ${w.label} failed: ${msg}`);
      }
    }
  }

  /**
   * Every window an ET wall-clock time falls inside, in schedule order (early
   * close shifts the late ones). A window with `everyMinutes` only matches
   * ticks on that cadence.
   */
  phasesFor(parts: EtParts, earlyClose: boolean): PhaseWindow[] {
    const mins = parts.hour * 60 + parts.minute;
    const out: PhaseWindow[] = [];
    for (const w of PHASE_SCHEDULE) {
      const shift = earlyClose && w.shiftOnEarlyClose ? EARLY_CLOSE_SHIFT_MIN : 0;
      if (mins < w.startMin - shift || mins > w.endMin - shift) continue;
      if (w.everyMinutes && parts.minute % w.everyMinutes !== 0) continue;
      out.push(w);
    }
    return out;
  }

  /** The first matching phase, or NONE — kept for callers that want one answer. */
  phaseFor(parts: EtParts, earlyClose: boolean): { phase: TradingPhase; label: string } {
    const [first] = this.phasesFor(parts, earlyClose);
    return first ? { phase: first.phase, label: first.label } : { phase: TradingPhase.NONE, label: 'none' };
  }

}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
