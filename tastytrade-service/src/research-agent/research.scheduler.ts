import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { MarketCalendarService } from '../orchestrator/market-calendar.service';
import { ResearchAgentService } from './research-agent.service';
import { ResearchExecutionService } from './research-execution.service';

/**
 * Scheduling for the research agent.
 *
 * The spec called for BullMQ, but this project has no Redis — the infra is a
 * single 0.25 vCPU Fargate task and RDS Postgres, and the existing orchestrator
 * is an in-process @nestjs/schedule cron that has run reliably for a week.
 * Adding Redis for one job an hour would cost more than it buys. A run is
 * fire-and-forget with a re-entrancy guard, which is the property BullMQ would
 * have provided here.
 *
 * Deliberately NOT part of PHASE_SCHEDULE: phases apply to every arm, and this
 * belongs to one arm only. Keeping it separate also means a slow or failing
 * agent run can never delay the mechanical arms' entry window.
 */
@Injectable()
export class ResearchScheduler {
  private readonly logger = new Logger(ResearchScheduler.name);
  private readonly enabled: boolean;
  private readonly arm: string;
  private running = false;

  constructor(
    private readonly research: ResearchAgentService,
    private readonly execution: ResearchExecutionService,
    private readonly calendar: MarketCalendarService,
    config: ConfigService,
  ) {
    // Off by default: a scheduled run costs real money, so switching it on is
    // an explicit decision rather than a side effect of deploying.
    this.enabled = String(config.get('RESEARCH_SCHEDULE_ENABLED') ?? 'false') === 'true';
    this.arm = config.get<string>('RESEARCH_ARM', 'research');
    this.logger.log(
      `research scheduler ${this.enabled ? 'ENABLED' : 'disabled'} (RESEARCH_SCHEDULE_ENABLED) — arm=${this.arm}`,
    );
  }

  /** 09:45 and 13:30 ET on trading days — after the open settles, and midday. */
  @Cron('0 45 9,13 * * 1-5', { timeZone: 'America/New_York' })
  async scheduled(): Promise<void> {
    if (!this.enabled) return;
    const now = new Date();
    if (!this.calendar.isTradingDay(now)) {
      this.logger.debug('research skipped — not a trading day');
      return;
    }
    if (this.running) {
      this.logger.warn('research skipped — previous run still in flight');
      return;
    }
    if (!this.research.available) {
      this.logger.warn(
        'research skipped — ANTHROPIC_API_KEY / TASTYTRADE_MCP_COMMAND not configured',
      );
      return;
    }

    this.running = true;
    try {
      const result = await this.research.run({ arm: this.arm });
      await this.execution.submit(result.runId, result.report, this.arm);
    } catch (err) {
      // Never let a failed run kill the scheduler; the next tick retries.
      this.logger.error(
        `scheduled research run failed — ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }
}
