import { Injectable, Logger } from '@nestjs/common';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';

/**
 * 08:00 ET — build the day's candidate shortlist and morning brief.
 *
 * TODO (the discover -> qualify funnel, see docs/trading-day.md):
 *  1. Discover: fixed watchlist ETFs + StockTwits trending (single names).
 *  2. Qualify (cheapest/hardest filters first, before spending data/AI):
 *       earnings soon? (hard exclude) -> IV Rank high enough? -> liquid enough?
 *  3. Persist the shortlist + brief to the trading_day record so the 10:00
 *     entry phase can read it (phases share state through the DB, not memory).
 */
@Injectable()
export class PreMarketService {
  private readonly logger = new Logger(PreMarketService.name);

  async run(ctx: PhaseContext): Promise<PhaseResult> {
    this.logger.log(`pre-market prep (${ctx.trigger}) — stub`);
    return {
      phase: TradingPhase.PRE_MARKET,
      ran: false,
      summary: 'stub — candidate discovery/qualification not implemented yet',
    };
  }
}
