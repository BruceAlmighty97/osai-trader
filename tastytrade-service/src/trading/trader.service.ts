import { Injectable, Logger } from '@nestjs/common';
import { PreMarketService } from './pre-market.service';
import { EntryService } from './entry.service';
import { ManagementService } from './management.service';
import { ReviewService } from './review.service';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';

/**
 * The main character. One entry point — runPhase() — that the orchestrator (or a
 * manual /trading/run call) invokes; it delegates to the service that owns that
 * phase. Deliberately thin: the orchestrator decides WHEN, the phase services
 * decide HOW, and this just routes between them.
 */
@Injectable()
export class TraderService {
  private readonly logger = new Logger(TraderService.name);

  constructor(
    private readonly preMarket: PreMarketService,
    private readonly entry: EntryService,
    private readonly management: ManagementService,
    private readonly review: ReviewService,
  ) {}

  async runPhase(phase: TradingPhase, ctx: PhaseContext): Promise<PhaseResult> {
    switch (phase) {
      case TradingPhase.PRE_MARKET:
        return this.preMarket.run(ctx);
      case TradingPhase.ENTRY:
        return this.entry.run(ctx);
      case TradingPhase.MANAGE:
        return this.management.run(ctx);
      case TradingPhase.AFTER_CLOSE:
        return this.review.run(ctx);
      default:
        return {
          phase: TradingPhase.NONE,
          ran: false,
          summary: 'no phase active',
        };
    }
  }
}
