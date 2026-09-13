import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaperService } from './paper.service';
import { PositionEntity } from '../persistence/entities/position.entity';
import { PositionStatus } from '../persistence/persistence.types';
import { TastytradeService } from '../tastytrade/tastytrade.service';
import { MarketDataSubscriptionType } from '@tastytrade/api';
import {
  ArmValuation,
  COMMISSION_PER_CONTRACT,
  LegValuation,
  MarkToMarketResult,
  PositionValuation,
} from './paper.types';

/** Everything one feed symbol told us during the snapshot. */
interface FeedRow {
  bid?: number;
  ask?: number;
  delta?: number;
  last?: number;
  dayHigh?: number;
  dayLow?: number;
  /** dxfeed day id (days since epoch) the Summary range belongs to. */
  dayId?: number;
}

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
    // in more than one arm's book, and it only needs quoting once. The
    // underlying rides along in the same session: the delta and price-touch
    // stops need it, and it is one more symbol on a socket already open.
    const symbols = new Set<string>();
    const unquotable: PositionEntity[] = [];
    for (const p of scoped) {
      const legSyms = (p.legs ?? []).map((l) => l.streamerSymbol);
      if (legSyms.some((s) => !s)) {
        unquotable.push(p);
        continue;
      }
      legSyms.forEach((s) => symbols.add(s as string));
      symbols.add(underlyingStreamerSymbol(p.symbol));
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

    const quotes = symbols.size ? await this.quote([...symbols]) : new Map<string, FeedRow>();

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

  /**
   * One streamer session for every leg (and underlying) across every position.
   * Quote for mids, Greeks for the delta stop, Summary for the underlying's
   * session high/low (the price-touch stop keys on any RTH print, not just
   * where price sits when the tick happens to land).
   */
  private async quote(streamerSymbols: string[]): Promise<Map<string, FeedRow>> {
    const out = new Map<string, FeedRow>();
    const snap: any = await this.tastytrade.streamSnapshot(streamerSymbols, 8, [
      MarketDataSubscriptionType.Quote,
      MarketDataSubscriptionType.Greeks,
      MarketDataSubscriptionType.Trade,
      MarketDataSubscriptionType.Summary,
    ]);
    let quoted = 0;
    let greeked = 0;
    for (const evt of (snap?.events as any[]) ?? []) {
      for (const e of Array.isArray(evt?.data) ? evt.data : []) {
        if (!e?.eventSymbol) continue;
        const row = out.get(e.eventSymbol) ?? {};
        if (e.eventType === 'Quote') {
          row.bid = e.bidPrice;
          row.ask = e.askPrice;
          quoted += 1;
        } else if (e.eventType === 'Greeks') {
          row.delta = e.delta;
          greeked += 1;
        } else if (e.eventType === 'Trade') {
          row.last = e.price;
        } else if (e.eventType === 'Summary') {
          row.dayHigh = e.dayHighPrice;
          row.dayLow = e.dayLowPrice;
          row.dayId = e.dayId;
        }
        out.set(e.eventSymbol, row);
      }
    }
    this.logger.log(
      `mark-to-market: ${out.size}/${streamerSymbols.length} symbols heard from ` +
        `(${quoted} quote events, ${greeked} greeks events)`,
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
    quotes: Map<string, FeedRow>,
    armNames: Map<number, string>,
  ): PositionValuation | null {
    const entryCredit = num(p.entryCredit);
    const qty = p.quantity;
    let currentDebit = 0;
    let priced = true;
    const legVals: LegValuation[] = [];

    // Underlying: mid only when two-sided and tight; a wide after-hours quote
    // is not a price (see entry.service for the same rule).
    const u = quotes.get(underlyingStreamerSymbol(p.symbol));
    const uUsable =
      u && Number.isFinite(u.bid) && Number.isFinite(u.ask) && (u.bid as number) > 0 && (u.ask as number) > 0;
    const uMid = uUsable ? ((u!.bid as number) + (u!.ask as number)) / 2 : null;
    const underlyingPrice =
      uMid !== null && ((u!.ask as number) - (u!.bid as number)) / uMid <= 0.005 ? round4(uMid) : null;
    const underlyingLast = Number.isFinite(u?.last) && (u!.last as number) > 0 ? (u!.last as number) : null;
    // The session range only counts if it is TODAY's. Before the open (and
    // all weekend) Summary still carries the previous session, and a prior
    // day's low that sits under a short strike would fire a false touch stop.
    const rangeIsToday = u?.dayId !== undefined && u.dayId === todayDayId();
    const underlyingDayHigh = rangeIsToday && Number.isFinite(u?.dayHigh) ? (u!.dayHigh as number) : null;
    const underlyingDayLow = rangeIsToday && Number.isFinite(u?.dayLow) ? (u!.dayLow as number) : null;

    for (const leg of p.legs ?? []) {
      const q = leg.streamerSymbol ? quotes.get(leg.streamerSymbol) : undefined;
      // A ZERO BID IS NOT A PRICE. Outside regular hours (and in thin books)
      // market makers pull their bids and the feed returns bid=0 with a stale
      // ask. Number.isFinite(0) is true, so an earlier version happily took
      // mid = ask/2 on both legs — and when two legs returned the same garbage
      // ask they cancelled to currentDebit = 0, i.e. "100% of max profit" on a
      // spread opened the day before.
      //
      // That is not merely a cosmetic P&L error: pctOfMaxProfit is exactly what
      // the exit engine triggers on, so a pulled bid would fabricate a profit
      // target, close the position at an invented price, and write phantom
      // realized P&L into the ledger. Refusing to price is always correct here;
      // a null propagates to "unpriced" and the position is simply left alone.
      const usable =
        q &&
        Number.isFinite(q.bid) &&
        Number.isFinite(q.ask) &&
        (q.bid as number) > 0 &&
        (q.ask as number) > 0;
      const mid = usable ? ((q!.bid as number) + (q!.ask as number)) / 2 : null;
      legVals.push({
        action: leg.action,
        right: leg.right as 'P' | 'C',
        strike: num(leg.strike),
        mid: mid === null ? null : round4(mid),
        delta: Number.isFinite(q?.delta) ? round4(q!.delta as number) : null,
      });
      if (mid === null) {
        this.logger.warn(
          `mark-to-market: position #${p.id} ${p.symbol} leg ${leg.strike}${leg.right} ` +
            `has no usable quote (${q ? `${q.bid}/${q.ask}` : 'no quote received'}) — ` +
            `leaving position unpriced rather than guessing`,
        );
        priced = false;
        break;
      }
      // Sold to open -> buy back (pay). Bought to open -> sell (receive).
      const sold = /sell/i.test(leg.action);
      currentDebit += sold ? mid * leg.quantity : -mid * leg.quantity;
    }

    const dte = dteFrom(p.expiration);
    const openedAt = new Date(p.openedAt);
    const dteAtOpen = dteFrom(p.expiration, openedAt.getTime());

    if (!priced) {
      return {
        positionId: p.id,
        arm: armNames.get(p.accountId as number) ?? 'unassigned',
        symbol: p.symbol,
        strategy: p.strategy,
        expiration: p.expiration,
        dte,
        openedAt: openedAt.toISOString(),
        dteAtOpen,
        quantity: qty,
        entryCredit: round2(entryCredit),
        ...greekFields(legVals, underlyingPrice, underlyingLast, underlyingDayHigh, underlyingDayLow),
        currentDebit: null,
        unrealizedPnl: null,
        pctOfMaxProfit: null,
        maxProfit: p.maxProfit === null ? null : round2(num(p.maxProfit) * qty),
        maxRisk: p.maxRisk === null ? null : num(p.maxRisk),
      };
    }

    // Commissions were charged on open only, matching PaperService.close().
    const commission = COMMISSION_PER_CONTRACT * (p.legs?.length ?? 0) * qty;
    // Signed throughout: entryCredit is negative for a debit structure and
    // currentDebit is negative when closing it would pay us. The subtraction is
    // correct for both directions.
    const grossPnl = (entryCredit - currentDebit) * MULTIPLIER * qty;
    const unrealizedPnl = grossPnl - commission;

    // Max profit in dollars for the whole position. Credit structures keep the
    // premium, so credit x 100 is the identity; debit structures do not, which
    // is why it is stored at open. Legacy rows predate the column.
    const maxProfitTotal =
      p.maxProfit !== null && p.maxProfit !== undefined
        ? num(p.maxProfit) * qty
        : entryCredit > 0
          ? entryCredit * MULTIPLIER * qty
          : null;
    const maxRiskTotal =
      p.maxRisk !== null && p.maxRisk !== undefined ? num(p.maxRisk) * qty : null;

    // A DEFINED-RISK STRUCTURE CANNOT BE WORTH MORE THAN ITS MAX PROFIT OR LESS
    // THAN ITS MAX LOSS. If the quotes say otherwise, the quotes are wrong.
    //
    // Observed live on 2026-09-11 at 12:30 ET: EWZ 34/32.5P, a 1.5-wide credit
    // spread sold for $0.23, marked at a cost-to-close of -$0.36 — the lower
    // strike put quoted ABOVE the higher one. Both legs had a nonzero bid so the
    // zero-bid guard passed, and the exit engine booked "259% of max profit",
    // realizing $57 on a trade whose ceiling was $23. That $34 per arm is
    // phantom P&L the ledger cannot unwind on its own.
    //
    // A crossed or stale leg on a thin name is not a price. Bound the result to
    // what the structure can physically be worth, with a little slack for
    // rounding, and refuse to price anything outside it.
    const slack = 1.02;
    if (
      (maxProfitTotal !== null && grossPnl > maxProfitTotal * slack) ||
      (maxRiskTotal !== null && grossPnl < -maxRiskTotal * slack)
    ) {
      this.logger.warn(
        `mark-to-market: position #${p.id} ${p.symbol} IMPOSSIBLE VALUE — gross P&L ` +
          `$${round2(grossPnl)} outside [-$${maxRiskTotal ?? '?'}, +$${maxProfitTotal ?? '?'}] ` +
          `(cost to close ${round2(currentDebit)} vs entry ${entryCredit}). A defined-risk ` +
          `spread cannot be worth this; a leg quote is crossed or stale. Leaving unpriced.`,
      );
      return {
        positionId: p.id,
        arm: armNames.get(p.accountId as number) ?? 'unassigned',
        symbol: p.symbol,
        strategy: p.strategy,
        expiration: p.expiration,
        dte,
        openedAt: openedAt.toISOString(),
        dteAtOpen,
        quantity: qty,
        entryCredit: round2(entryCredit),
        ...greekFields(legVals, underlyingPrice, underlyingLast, underlyingDayHigh, underlyingDayLow),
        currentDebit: null,
        unrealizedPnl: null,
        pctOfMaxProfit: null,
        maxProfit: maxProfitTotal === null ? null : round2(maxProfitTotal),
        maxRisk: maxRiskTotal,
      };
    }

    return {
      positionId: p.id,
      arm: armNames.get(p.accountId as number) ?? 'unassigned',
      symbol: p.symbol,
      strategy: p.strategy,
      expiration: p.expiration,
      dte,
      openedAt: openedAt.toISOString(),
      dteAtOpen,
      quantity: qty,
      entryCredit: round2(entryCredit),
      ...greekFields(legVals, underlyingPrice, underlyingLast, underlyingDayHigh, underlyingDayLow),
      currentDebit: round2(currentDebit),
      unrealizedPnl: round2(unrealizedPnl),
      maxProfit: maxProfitTotal === null ? null : round2(maxProfitTotal),
      // The number the 50%-profit rule fires on, measured against ACTUAL max
      // profit rather than the entry price. For a credit spread those are the
      // same thing; for a debit spread they are not remotely the same, and the
      // old formula returned a negative number for a winning trade.
      pctOfMaxProfit:
        maxProfitTotal && maxProfitTotal > 0
          ? round2(grossPnl / maxProfitTotal)
          : null,
      maxRisk: p.maxRisk === null ? null : num(p.maxRisk),
    };
  }

}
/** dxfeed symbol for an equity/ETF underlying is just its ticker. */
function underlyingStreamerSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

/** The leg-level and underlying fields shared by every valuation shape. */
function greekFields(
  legs: LegValuation[],
  underlyingPrice: number | null,
  underlyingLast: number | null,
  underlyingDayHigh: number | null,
  underlyingDayLow: number | null,
): Pick<
  PositionValuation,
  | 'legs'
  | 'shortDeltaMax'
  | 'longDeltaMax'
  | 'underlyingPrice'
  | 'underlyingLast'
  | 'underlyingDayHigh'
  | 'underlyingDayLow'
> {
  const maxAbs = (ls: LegValuation[]): number | null => {
    const ds = ls.map((l) => l.delta).filter((d): d is number => d !== null);
    return ds.length ? round4(Math.max(...ds.map(Math.abs))) : null;
  };
  return {
    legs,
    shortDeltaMax: maxAbs(legs.filter((l) => /sell/i.test(l.action))),
    longDeltaMax: maxAbs(legs.filter((l) => /buy/i.test(l.action))),
    underlyingPrice,
    underlyingLast,
    underlyingDayHigh,
    underlyingDayLow,
  };
}

/** dxfeed dayId (days since the Unix epoch) for today's ET calendar date. */
function todayDayId(): number {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()))
    p[part.type] = part.value;
  return Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day) / 86_400_000);
}

function dteFrom(expiration: string, asOf = Date.now()): number | null {
  const exp = Date.parse(`${expiration}T20:00:00Z`); // ~16:00 ET
  if (Number.isNaN(exp) || Number.isNaN(asOf)) return null;
  return Math.round((exp - asOf) / 86_400_000);
}
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
