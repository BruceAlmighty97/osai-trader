import { Injectable, Logger } from '@nestjs/common';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';

/**
 * 16:15 ET — close the books on the day.
 *
 * TODO:
 *  1. Mark-to-market open positions for an end-of-day snapshot (ValuationService).
 *  2. Summarize the day: realized P&L, open unrealized, wins/losses, what opened
 *     and closed and why.
 *  3. Journal each decision separating PROCESS from OUTCOME — a trade that
 *     followed the rules but lost is still a good trade. That distinction is what
 *     makes the forward-test worth anything.
 *  4. Persist to the trading_day record + note context for tomorrow.
 */
@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  async run(ctx: PhaseContext): Promise<PhaseResult> {
    this.logger.log(`after-close review (${ctx.trigger}) — stub`);
    return {
      phase: TradingPhase.AFTER_CLOSE,
      ran: false,
      summary: 'stub — day review/journal not implemented yet',
    };
  }
}
