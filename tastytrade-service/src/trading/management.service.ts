import { Injectable, Logger } from '@nestjs/common';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';

/**
 * 12:30 + 15:00-15:45 ET — value open positions and close what the rules say.
 * Idempotent: a position triggers its exit once.
 *
 * TODO:
 *  1. Mark-to-market every open position (re-quote its legs -> live unrealized
 *     P&L). This is a SHARED capability — /paper/account and the after-close
 *     review need it too, so it belongs in its own ValuationService, not here.
 *  2. Classify each position deterministically:
 *       hard close  -> 2x credit stop, assignment risk  (code closes, no debate)
 *       decision    -> >=50% max profit, ~21 DTE        (take/hold/roll)
 *       hold        -> nothing triggered                (skip)
 *  3. Close via PaperService to realize the P&L.
 * Later: the AI weighs the "decision" cases only, from a code-sanctioned set.
 */
@Injectable()
export class ManagementService {
  private readonly logger = new Logger(ManagementService.name);

  async run(ctx: PhaseContext): Promise<PhaseResult> {
    this.logger.log(`manage (${ctx.trigger}) — stub`);
    return {
      phase: TradingPhase.MANAGE,
      ran: false,
      summary: 'stub — mark-to-market + exit rules not implemented yet',
    };
  }
}
