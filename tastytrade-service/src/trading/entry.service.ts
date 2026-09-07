import { Injectable, Logger } from '@nestjs/common';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';

/**
 * 10:00-11:30 ET, every 15 min — open the single best play, or pass.
 *
 * Polling != over-trading: each tick asks "given conditions RIGHT NOW, open the
 * best play or pass". The risk gate caps the ceiling, so later ticks usually pass.
 *
 * TODO (mechanical first — no AI in this loop yet):
 *  1. Load today's shortlist from the trading_day record.
 *  2. Re-check live conditions (IV rank, chain/greeks) for the top candidates.
 *  3. Mechanical strike selection (e.g. ~16-delta short, fixed width, ~45 DTE).
 *  4. RiskService.check() — the gate the strategy can never override.
 *  5. PaperService.openFromSuggestion() to record the fill in the ledger.
 * Later: swap step 3 for the bounded AI analyst and measure the lift.
 */
@Injectable()
export class EntryService {
  private readonly logger = new Logger(EntryService.name);

  async run(ctx: PhaseContext): Promise<PhaseResult> {
    this.logger.log(`entry (${ctx.trigger}) — stub`);
    return {
      phase: TradingPhase.ENTRY,
      ran: false,
      summary: 'stub — mechanical entry not implemented yet',
    };
  }
}
