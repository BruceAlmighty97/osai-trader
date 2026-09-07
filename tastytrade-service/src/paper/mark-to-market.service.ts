import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaperService } from './paper.service';
import { PositionEntity } from '../persistence/entities/position.entity';
import { PositionStatus } from '../persistence/persistence.types';
import { TastytradeService } from '../tastytrade/tastytrade.service';
import {
  ArmValuation,
  COMMISSION_PER_CONTRACT,
  MarkToMarketResult,
  PositionValuation,
} from './paper.types';

const MULTIPLIER = 100; // options are per-100-shares

/**
 * What every open position is worth RIGHT NOW.
 *
 * `PaperService.getSummary()` deliberately reports only settled value —
 * starting balance plus realized P&L — so it stays a fast DB-only read. This
 * service is the expensive counterpart: it re-quotes live legs.
 *
 * For a credit spread the current value is what it would cost to buy the whole
 * thing back:
 *
 *     currentDebit  = shortLegMid - longLegMid            (per share)
 *     unrealized    = (entryCredit - currentDebit) * 100 * qty - commissions
 *
 * Legs are priced at the MID, matching how entry priced them. Using the bid/ask
 * you would actually pay to close would bake in a systematic loss that is an
 * artifact of the measurement rather than the strategy — every position would
 * look underwater the instant it opened.
 *
 * This is what MANAGE needs: the 50%-profit target and the 2x stop are both
 * expressed against `currentDebit`, so the exit engine cannot exist without it.
 */
@Injectable()
export class MarkToMarketService {
  private readonly logger = new Logger(MarkToMarketService.name);

  constructor(
    @InjectRepository(PositionEntity)
    private readonly positions: Repository<PositionEntity>,
    private readonly paper: PaperService,
    private readonly tastytrade: TastytradeService,
  ) {}

  /**
   * Value every open position across every arm in ONE quote subscription.
   *
   * Batching is the whole design: each `streamSnapshot` is a multi-second DXLink
   * session, so quoting 8 positions one at a time would cost ~80s. Every leg of
   * every position goes into a single call instead.
   */
  async valueAll(accountName?: string | null): Promise<MarkToMarketResult> {
    const started = Date.now();
    const arms = await this.paper.listArms();
    const targetArms = accountName
      ? arms.filter((a) => a.name === accountName)
      : arms;

    const open = await this.positions.find({
      where: { status: PositionStatus.OPEN },
      order: { openedAt: 'DESC' },
    });
    const armIds = new Set(targetArms.map((a) => a.id));
    const scoped = open.filter((p) => p.accountId && armIds.has(p.accountId));

    // Collect every leg symbol we need, deduped — the same contract can appear
    // in more than one arm's book, and it only needs quoting once.
    const symbols = new Set<string>();
    const unquotable: PositionEntity[] = [];
    for (const p of scoped) {
      const legSyms = (p.legs ?? []).map((l) => l.streamerSymbol);
      if (legSyms.some((s) => !s)) {
        unquotable.push(p);
        continue;
      }
      legSyms.forEach((s) => symbols.add(s as string));
    }

    this.logger.log(
      `mark-to-market: ${scoped.length} open position(s) across ${targetArms.length} arm(s) — ` +
        `${symbols.size} unique leg(s) to quote, ${unquotable.length} unquotable`,
    );
    if (unquotable.length) {
      this.logger.warn(
        `mark-to-market: ${unquotable.length} position(s) have legs without a streamerSymbol ` +
          `(opened before it was persisted) — excluded from netLiq: ` +
          unquotable.map((p) => `#${p.id} ${p.symbol}`).join(', '),
      );
    }

    const quotes = symbols.size
      ? await this.quote([...symbols])
      : new Map<string, { bid: number; ask: number }>();

    const armNames = new Map(arms.map((a) => [a.id, a.name]));
    const valuations: PositionValuation[] = [];
    for (const p of scoped) {
      const v = this.valuePosition(p, quotes, armNames);
      if (v) valuations.push(v);
    }

    // Roll up per arm.
    const armResults: ArmValuation[] = [];
    for (const arm of targetArms) {
      const summary = await this.paper.getSummary(arm.name);
      const mine = valuations.filter((v) => v.arm === arm.name);
      const priced = mine.filter((v) => v.unrealizedPnl !== null);
      const openUnrealized = round2(
        priced.reduce((s, v) => s + (v.unrealizedPnl ?? 0), 0),
      );
      armResults.push({
        name: arm.name,
        settledValue: summary.settledValue,
        openUnrealized,
        netLiq: round2(summary.settledValue + openUnrealized),
        openPositions: mine.length,
        pricedPositions: priced.length,
        positions: mine,
      });
      this.logger.log(
        `mark-to-market[${arm.name}]: settled=$${summary.settledValue} ` +
          `unrealized=$${openUnrealized} netLiq=$${round2(summary.settledValue + openUnrealized)} ` +
          `(${priced.length}/${mine.length} priced)`,
      );
    }

    this.logger.log(`mark-to-market: completed in ${Date.now() - started}ms`);
    return { asOf: new Date().toISOString(), durationMs: Date.now() - started, arms: armResults };
  }

  /** One streamer session for every leg across every position. */
  private async quote(
    streamerSymbols: string[],
  ): Promise<Map<string, { bid: number; ask: number }>> {
    const out = new Map<string, { bid: number; ask: number }>();
    const snap: any = await this.tastytrade.streamSnapshot(streamerSymbols, 8);
    for (const evt of (snap?.events as any[]) ?? []) {
      for (const e of Array.isArray(evt?.data) ? evt.data : []) {
        if (e?.eventType !== 'Quote' || !e.eventSymbol) continue;
        out.set(e.eventSymbol, { bid: e.bidPrice, ask: e.askPrice });
      }
    }
    this.logger.log(
      `mark-to-market: quoted ${out.size}/${streamerSymbols.length} legs`,
    );
    return out;
  }

  /**
   * Net cost to close, from the perspective of the position we hold: legs we
   * sold to open must be bought back (a debit), legs we bought are sold (a
   * credit). Summing signed mids handles any spread shape, not just two legs.
   */
  private valuePosition(
    p: PositionEntity,
    quotes: Map<string, { bid: number; ask: number }>,
    armNames: Map<number, string>,
  ): PositionValuation | null {
    const entryCredit = num(p.entryCredit);
    const qty = p.quantity;
    let currentDebit = 0;
    let priced = true;

    for (const leg of p.legs ?? []) {
      const q = leg.streamerSymbol ? quotes.get(leg.streamerSymbol) : undefined;
      const mid =
        q && Number.isFinite(q.bid) && Number.isFinite(q.ask)
          ? (q.bid + q.ask) / 2
          : null;
      if (mid === null) {
        priced = false;
        break;
      }
      // Sold to open -> buy back (pay). Bought to open -> sell (receive).
      const sold = /sell/i.test(leg.action);
      currentDebit += sold ? mid * leg.quantity : -mid * leg.quantity;
    }

    const dte = dteFrom(p.expiration);

    if (!priced) {
      return {
        positionId: p.id,
        arm: armNames.get(p.accountId as number) ?? 'unassigned',
        symbol: p.symbol,
        strategy: p.strategy,
        expiration: p.expiration,
        dte,
        quantity: qty,
        entryCredit: round2(entryCredit),
        currentDebit: null,
        unrealizedPnl: null,
        pctOfMaxProfit: null,
        maxRisk: p.maxRisk === null ? null : num(p.maxRisk),
      };
    }

    // Commissions were charged on open only, matching PaperService.close().
    const commission = COMMISSION_PER_CONTRACT * (p.legs?.length ?? 0) * qty;
    const unrealizedPnl =
      (entryCredit - currentDebit) * MULTIPLIER * qty - commission;

    return {
      positionId: p.id,
      arm: armNames.get(p.accountId as number) ?? 'unassigned',
      symbol: p.symbol,
      strategy: p.strategy,
      expiration: p.expiration,
      dte,
      quantity: qty,
      entryCredit: round2(entryCredit),
      currentDebit: round2(currentDebit),
      unrealizedPnl: round2(unrealizedPnl),
      // The number the 50%-profit rule fires on. 1.0 = the spread is worthless
      // and we keep the whole credit.
      pctOfMaxProfit:
        entryCredit > 0
          ? round2((entryCredit - currentDebit) / entryCredit)
          : null,
      maxRisk: p.maxRisk === null ? null : num(p.maxRisk),
    };
  }

}
function dteFrom(expiration: string): number | null {
  const exp = Date.parse(`${expiration}T20:00:00Z`); // ~16:00 ET
  if (Number.isNaN(exp)) return null;
  return Math.round((exp - Date.now()) / 86_400_000);
}
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
