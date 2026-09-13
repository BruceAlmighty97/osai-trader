import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';
import { PaperService } from '../paper/paper.service';
import { MarkToMarketService } from '../paper/mark-to-market.service';
import { MarketCalendarService } from '../orchestrator/market-calendar.service';
import { ExitContext, ExitThresholds, classifyExit, timeStopDate } from './exit-rules';

/** What one arm did this manage tick. */
interface ArmManageOutcome {
  arm: string;
  closed: number;
  held: number;
  unpriced: number;
  realized: number;
  summary: string;
}

/**
 * Every tick 09:35-15:55 ET — value every open position and close what the
 * rules say. The exit half of the strategy, and at 7-14 DTE the half that
 * carries it: a tested spread can pass its stop and keep going inside an hour,
 * so this runs on every tick of the session, not at two fixed checkpoints.
 *
 * Deterministic and idempotent. A position is closed at most once because
 * PaperService.close() rejects anything not currently OPEN, so a double tick
 * cannot double-book.
 *
 * The rules themselves live in exit-rules.ts (pure, testable). This service
 * owns the plumbing: one batched re-quote for every arm, per-arm threshold
 * resolution, the close, and the journal line.
 *
 * The AI is deliberately NOT here. Exits are where a model can do the most
 * damage — the rules are cheap, well-evidenced and unambiguous, so code owns
 * them. Rolling is not permitted at this DTE (02 T9), so there is no
 * hold/roll judgment call to hand a model.
 */
@Injectable()
export class ManagementService {
  private readonly logger = new Logger(ManagementService.name);
  private readonly defaults: ExitThresholds;

  constructor(
    private readonly paper: PaperService,
    private readonly mtm: MarkToMarketService,
    private readonly calendar: MarketCalendarService,
    config: ConfigService,
  ) {
    this.defaults = {
      profitTargetPct: num(config.get('MANAGE_PROFIT_TARGET_PCT'), 0.5),
      accelProfitTargetPct: num(config.get('MANAGE_ACCEL_PROFIT_TARGET_PCT'), 0.25),
      accelDte: num(config.get('MANAGE_ACCEL_DTE'), 3),
      stopLossMultiple: num(config.get('MANAGE_STOP_LOSS_MULTIPLE'), 1),
      deltaStop: num(config.get('MANAGE_DELTA_STOP'), 0.4),
      deltaStopCondor: num(config.get('MANAGE_DELTA_STOP_CONDOR'), 0.35),
      debitLongDeltaStop: num(config.get('MANAGE_DEBIT_LONG_DELTA_STOP'), 0.2),
      timeStopTradingDays: num(config.get('MANAGE_TIME_STOP_TRADING_DAYS'), 2),
      timeStopFromMinute: num(config.get('MANAGE_TIME_STOP_FROM_MINUTE'), 10 * 60),
    };
    this.logger.log(
      `manage defaults: ${JSON.stringify(this.defaults)} (arms may override any of these)`,
    );
  }

  async run(ctx: PhaseContext): Promise<PhaseResult> {
    const parts = this.calendar.etParts(ctx.now);
    const exitCtx: ExitContext = {
      today: this.calendar.isoDate(ctx.now),
      minuteOfDay: parts.hour * 60 + parts.minute,
      tradingDaysBefore: (iso, n) => this.calendar.tradingDaysBefore(iso, n),
    };

    // One batched re-quote covering every leg (and underlying) of every arm.
    const valuation = await this.mtm.valueAll(null);
    const arms = await this.paper.listArms(true);
    const byName = new Map(arms.map((a) => [a.name, a]));

    const outcomes: ArmManageOutcome[] = [];
    let closedTotal = 0;

    for (const armVal of valuation.arms) {
      const arm = byName.get(armVal.name);
      if (!arm) continue; // disabled arm — leave its book alone

      const cfg = arm.config ?? {};
      const t: ExitThresholds = {
        profitTargetPct: num(cfg.profitTargetPct, this.defaults.profitTargetPct),
        accelProfitTargetPct: num(cfg.accelProfitTargetPct, this.defaults.accelProfitTargetPct),
        accelDte: num(cfg.accelDte, this.defaults.accelDte),
        stopLossMultiple: num(cfg.stopLossMultiple, this.defaults.stopLossMultiple),
        deltaStop: num(cfg.deltaStop, this.defaults.deltaStop),
        deltaStopCondor: num(cfg.deltaStopCondor, this.defaults.deltaStopCondor),
        debitLongDeltaStop: num(cfg.debitLongDeltaStop, this.defaults.debitLongDeltaStop),
        timeStopTradingDays: num(cfg.timeStopTradingDays, this.defaults.timeStopTradingDays),
        timeStopFromMinute: this.defaults.timeStopFromMinute,
      };
      const tag = `manage[${armVal.name}]`;

      if (!armVal.positions.length) {
        this.logger.debug(`${tag}: no open positions`);
        outcomes.push({
          arm: armVal.name,
          closed: 0,
          held: 0,
          unpriced: 0,
          realized: 0,
          summary: 'no open positions',
        });
        continue;
      }

      let closed = 0;
      let held = 0;
      let unpriced = 0;
      let realized = 0;

      for (const pos of armVal.positions) {
        // Never act on a position we could not price. A missing quote is not a
        // signal, and closing on invented numbers writes phantom P&L forever.
        if (pos.currentDebit === null || pos.pctOfMaxProfit === null) {
          unpriced += 1;
          this.logger.warn(
            `${tag}: #${pos.positionId} ${pos.symbol} UNPRICED — holding ` +
              `(no usable quote; exit rules cannot be evaluated)`,
          );
          continue;
        }

        const verdict = classifyExit(pos, t, exitCtx);
        if (!verdict) {
          held += 1;
          const stopLoss =
            pos.maxProfit !== null && pos.maxProfit > 0
              ? Math.min(
                  t.stopLossMultiple * pos.maxProfit,
                  pos.maxRisk !== null && pos.maxRisk > 0 ? 0.5 * pos.maxRisk : Infinity,
                )
              : null;
          this.logger.log(
            `${tag}: #${pos.positionId} ${pos.symbol} HOLD — ` +
              `${(pos.pctOfMaxProfit * 100).toFixed(0)}% of max ` +
              `(target ${(t.profitTargetPct * 100).toFixed(0)}%), ` +
              `P&L $${pos.unrealizedPnl} of $${pos.maxProfit ?? '?'} max ` +
              `(stop at -$${stopLoss === null ? '?' : round2(stopLoss)}) | ` +
              `short Δ ${pos.shortDeltaMax ?? '?'} (stop ${t.deltaStop}) | ` +
              `last ${pos.underlyingLast ?? pos.underlyingPrice ?? '?'} today's range ${pos.underlyingDayLow ?? '?'}-${pos.underlyingDayHigh ?? '?'} | ` +
              `${pos.dte}d left, time stop ${timeStopDate(pos, t, exitCtx)}`,
          );
          continue;
        }

        try {
          const saved = await this.paper.close(pos.positionId, {
            closeDebitPerSpread: pos.currentDebit,
            exitReason: verdict.reason,
          });
          closed += 1;
          closedTotal += 1;
          realized += Number(saved.realizedPnl ?? 0);
          this.logger.log(
            `${tag}: #${pos.positionId} ${pos.symbol} CLOSED ${verdict.reason} — ` +
              `${verdict.why} | debit ${pos.currentDebit} vs credit ${pos.entryCredit} ` +
              `-> realized $${saved.realizedPnl}`,
          );
        } catch (err) {
          // Already closed by a concurrent tick, or a validation failure.
          this.logger.warn(
            `${tag}: #${pos.positionId} ${pos.symbol} close failed — ${errMsg(err)}`,
          );
        }
      }

      const summary =
        closed > 0
          ? `closed ${closed} (realized $${round2(realized)}), held ${held}`
          : `held ${held}${unpriced ? `, ${unpriced} unpriced` : ''}`;
      this.logger.log(`${tag}: ${summary}`);
      outcomes.push({
        arm: armVal.name,
        closed,
        held,
        unpriced,
        realized: round2(realized),
        summary,
      });
    }

    const summary = outcomes.map((o) => `${o.arm}: ${o.summary}`).join(' | ');
    this.logger.log(`manage (${ctx.trigger}): ${summary}`);

    return {
      phase: TradingPhase.MANAGE,
      ran: closedTotal > 0,
      summary,
      details: { closed: closedTotal, arms: outcomes },
    };
  }
}

function num(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
