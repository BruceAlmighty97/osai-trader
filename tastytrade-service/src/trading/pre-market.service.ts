import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhaseContext, PhaseResult, TradingPhase } from './trading.types';
import { ShortlistCandidate, TradingDayEntity } from './trading-day.entity';
import { WatchlistEntity } from '../persistence/entities/watchlist.entity';
import { TastytradeService } from '../tastytrade/tastytrade.service';
import { FinnhubClient } from '../finnhub/finnhub.client';
import { StockTwitsClient } from '../social/stocktwits.client';
import { ApeWisdomClient } from '../social/apewisdom.client';

/**
 * 08:00 ET — build the day's candidate shortlist.
 *
 * Discover wide, then qualify hard, cheapest filter first so the expensive data
 * only ever touches survivors:
 *   1. DISCOVER  watchlist universe + StockTwits trending + Reddit top-N (ApeWisdom)
 *   2. ENRICH    one market-metrics call + one earnings call for the whole pool
 *   3. QUALIFY   earnings (hard exclude) -> liquidity -> IV rank
 *   4. RANK      by IV rank, tie-broken on watchlist priority
 *   5. SENTIMENT survivors only (one StockTwits call each + Reddit mention counts)
 *   6. PERSIST   to trading_day so the 10:00 entry phase can read it
 *
 * Measured live: ~84 candidates in, ~24 qualified out.
 */
@Injectable()
export class PreMarketService {
  private readonly logger = new Logger(PreMarketService.name);
  private readonly minIvRank: number;
  private readonly minLiquidityRating: number;
  /** How many of ApeWisdom's top tickers join the discovery pool (0 = off). */
  private readonly redditDiscoverTop: number;

  constructor(
    @InjectRepository(TradingDayEntity)
    private readonly days: Repository<TradingDayEntity>,
    @InjectRepository(WatchlistEntity)
    private readonly watchlist: Repository<WatchlistEntity>,
    private readonly tastytrade: TastytradeService,
    private readonly finnhub: FinnhubClient,
    private readonly stocktwits: StockTwitsClient,
    private readonly apewisdom: ApeWisdomClient,
    config: ConfigService,
  ) {
    // TODO: move to DB config when you want to tune these without a deploy.
    this.minIvRank = Number(config.get<string>('MIN_IV_RANK', '30'));
    this.minLiquidityRating = Number(
      config.get<string>('MIN_LIQUIDITY_RATING', '3'),
    );
    this.redditDiscoverTop = Number(
      config.get<string>('APEWISDOM_DISCOVER_TOP', '25'),
    );
  }

  async run(ctx: PhaseContext): Promise<PhaseResult> {
    const date = etDate(ctx.now);

    // 1. DISCOVER
    const universe = await this.watchlist.find({ where: { enabled: true } });
    const known = new Set(universe.map((w) => w.symbol));
    let trending: string[] = [];
    try {
      trending = (await this.stocktwits.getTrendingSymbols()).filter(
        (s) => !known.has(s),
      );
    } catch (err) {
      this.logger.warn(`StockTwits trending unavailable: ${errMsg(err)}`);
    }
    // Reddit attention (mention counts, no direction). Same pool, same source
    // label: "trending" means "dynamic discovery" regardless of which feed.
    let reddit: string[] = [];
    if (this.redditDiscoverTop > 0) {
      try {
        const rows = await this.apewisdom.getTrending();
        const seen = new Set([...known, ...trending]);
        reddit = rows
          .slice(0, this.redditDiscoverTop)
          .map((r) => r.symbol)
          .filter((s) => /^[A-Z]{1,5}$/.test(s) && !seen.has(s));
        this.logger.log(
          `discover: reddit top ${this.redditDiscoverTop} -> ${reddit.length} new symbols ` +
            `(rest already in pool or not ticker-shaped)`,
        );
      } catch (err) {
        this.logger.warn(`ApeWisdom (reddit) unavailable: ${errMsg(err)}`);
      }
    }
    const pool = [
      ...universe.map((w) => ({
        symbol: w.symbol,
        source: 'watchlist' as const,
        correlationGroup: w.correlationGroup,
        priority: w.priority,
      })),
      ...[...trending, ...reddit].map((s) => ({
        symbol: s,
        source: 'trending' as const,
        correlationGroup: null,
        priority: 0,
      })),
    ];

    // 2. ENRICH — one call each for the whole pool
    const symbols = pool.map((p) => p.symbol);
    const [metrics, earnings] = await Promise.all([
      this.tastytrade.getMarketMetrics(symbols).catch((err) => {
        this.logger.error(`market-metrics failed: ${errMsg(err)}`);
        return [] as any[];
      }),
      this.finnhub.isConfigured()
        ? this.finnhub.earningsWithin(symbols, 45).catch((err) => {
            this.logger.error(`earnings lookup failed: ${errMsg(err)}`);
            return new Map<string, { date: string }>();
          })
        : Promise.resolve(new Map<string, { date: string }>()),
    ]);
    const bySymbol = new Map<string, any>();
    for (const m of metrics ?? []) bySymbol.set(m.symbol, m);

    if (!this.finnhub.isConfigured()) {
      // Fail loud: without earnings data we could sell premium into a report.
      this.logger.warn(
        'FINNHUB_API_KEY not set — earnings exclusion is NOT being applied.',
      );
    }

    // 3. QUALIFY
    const rejections: Record<string, number> = {};
    const reject = (why: string) => {
      rejections[why] = (rejections[why] ?? 0) + 1;
      return null;
    };
    const qualified: (ShortlistCandidate & { priority: number })[] = [];

    for (const c of pool) {
      const m = bySymbol.get(c.symbol);
      if (!m) {
        reject('no options data');
        continue;
      }
      if (earnings.has(c.symbol)) {
        reject('earnings');
        continue;
      }
      const liq = numOrNull(m['liquidity-rating']);
      if (liq === null || liq < this.minLiquidityRating) {
        reject('illiquid');
        continue;
      }
      const ivRank = pct(m['implied-volatility-index-rank']);
      if (ivRank === null || ivRank < this.minIvRank) {
        reject('low IV rank');
        continue;
      }
      qualified.push({
        symbol: c.symbol,
        source: c.source,
        correlationGroup: c.correlationGroup,
        ivRank: round1(ivRank),
        liquidityRating: liq,
        iv30: numOrNull(m['implied-volatility-30-day']),
        bullish: null,
        bearish: null,
        redditMentions: null,
        redditMentions24hAgo: null,
        priority: c.priority,
      });
    }

    // 4. RANK — richest premium first, watchlist priority breaks ties
    qualified.sort((a, b) => b.ivRank! - a.ivRank! || b.priority - a.priority);

    // 5. SENTIMENT — survivors only
    for (const c of qualified) {
      try {
        const msgs = await this.stocktwits.getSymbolStream(c.symbol, 30);
        c.bullish = msgs.filter((m) => m.sentiment === 'Bullish').length;
        c.bearish = msgs.filter((m) => m.sentiment === 'Bearish').length;
      } catch {
        /* sentiment is enrichment, never fatal */
      }
    }
    // Reddit attention comes from the (cached) snapshot fetched in DISCOVER —
    // one lookup for all survivors, no per-symbol calls.
    try {
      const buzz = await this.apewisdom.lookup(qualified.map((c) => c.symbol));
      for (const c of qualified) {
        const b = buzz.get(c.symbol);
        if (!b) continue;
        c.redditMentions = b.mentions;
        c.redditMentions24hAgo = b.mentions24hAgo;
      }
      this.logger.log(
        `sentiment: reddit mentions for ${buzz.size}/${qualified.length} survivors`,
      );
    } catch (err) {
      this.logger.warn(`ApeWisdom (reddit) lookup failed: ${errMsg(err)}`);
    }

    // 6. PERSIST — the entry phase reads this back at 10:00
    const shortlist: ShortlistCandidate[] = qualified.map(
      ({ priority: _priority, ...rest }) => rest,
    );
    const existing = await this.days.findOne({ where: { date } });
    const row =
      existing ?? this.days.create({ date, brief: null, shortlist: [] });
    row.shortlist = shortlist;
    row.candidatesScanned = pool.length;
    row.rejections = rejections;
    await this.days.save(row);

    const summary =
      `${pool.length} candidates → ${shortlist.length} qualified ` +
      `(${Object.entries(rejections)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')})`;
    this.logger.log(`pre-market ${date}: ${summary}`);

    return {
      phase: TradingPhase.PRE_MARKET,
      ran: true,
      summary,
      details: {
        date,
        scanned: pool.length,
        qualified: shortlist.length,
        rejections,
        top: shortlist.slice(0, 10).map((c) => `${c.symbol}(${c.ivRank})`),
      },
    };
  }
}

function etDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pct(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : n * 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
