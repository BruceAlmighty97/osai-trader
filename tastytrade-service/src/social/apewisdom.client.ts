import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BASE = 'https://apewisdom.io/api/v1.0';

/** ApeWisdom `filter` values we care about (the API also has per-subreddit ones). */
export type ApeWisdomFilter =
  | 'all'
  | 'all-stocks'
  | 'all-crypto'
  | 'wallstreetbets'
  | 'stocks'
  | 'investing'
  | 'options'
  | 'Daytrading'
  | '4chan'
  | (string & {});

export interface RedditBuzzRow {
  symbol: string;
  name: string;
  rank: number;
  rank24hAgo: number | null;
  mentions: number;
  mentions24hAgo: number | null;
  upvotes: number;
  /** (mentions − mentions24hAgo) / mentions24hAgo, as a percent; null when no baseline. */
  mentionsChangePct: number | null;
}

/**
 * ApeWisdom — aggregated Reddit (WSB/stocks/options…) ticker mention counts.
 * Keyless, no login, no cookies. This is what "Reddit access" is for this app:
 * Reddit's own endpoints block anonymous/datacenter traffic and the cookie-
 * scraping route (Agent Reach / rdt-cli) risks account bans, so we take the
 * aggregate instead. Mention COUNTS only — no bull/bear lean; StockTwits still
 * supplies direction. See docs/data-sources.md.
 *
 * The list is a rolling 24h window that moves slowly, so pages are cached for a
 * few minutes: pre-market discover + sentiment and the research agent all read
 * the same snapshot instead of hammering a free service.
 */
@Injectable()
export class ApeWisdomClient {
  private readonly logger = new Logger(ApeWisdomClient.name);
  private readonly userAgent: string;
  private readonly defaultFilter: ApeWisdomFilter;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<
    string,
    { at: number; rows: RedditBuzzRow[] }
  >();

  constructor(private readonly config: ConfigService) {
    this.userAgent = this.config.get<string>(
      'STOCKTWITS_USER_AGENT',
      'osaitrader/0.1',
    );
    this.defaultFilter = this.config.get<string>(
      'APEWISDOM_FILTER',
      'all-stocks',
    );
    this.cacheTtlMs = parseInt(
      this.config.get<string>('APEWISDOM_CACHE_TTL_MS', '300000'),
      10,
    );
  }

  /**
   * Top tickers by Reddit mentions, best rank first. `pages` × 100 rows; one
   * page (the top 100) is plenty for discovery.
   */
  async getTrending(
    filter: ApeWisdomFilter = this.defaultFilter,
    pages = 1,
  ): Promise<RedditBuzzRow[]> {
    const key = `${filter}:${pages}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheTtlMs) {
      this.logger.debug(`apewisdom ${key}: cache hit (${hit.rows.length} rows)`);
      return hit.rows;
    }

    const rows: RedditBuzzRow[] = [];
    for (let page = 1; page <= pages; page++) {
      const json = await this.getJson(
        `${BASE}/filter/${encodeURIComponent(filter)}/page/${page}`,
      );
      const results: any[] = json?.results ?? [];
      for (const r of results) rows.push(toRow(r));
      const totalPages = Number(json?.pages ?? 1);
      if (page >= totalPages) break;
    }

    this.cache.set(key, { at: Date.now(), rows });
    this.logger.log(
      `apewisdom ${filter}: ${rows.length} tickers; top ${rows
        .slice(0, 5)
        .map((r) => `${r.symbol}(${r.mentions})`)
        .join(' ')}`,
    );
    return rows;
  }

  /**
   * Buzz for specific symbols, from the same cached snapshot as getTrending.
   * Symbols outside the top `pages`×100 are simply absent — which is itself the
   * answer: no meaningful Reddit attention.
   */
  async lookup(
    symbols: string[],
    filter: ApeWisdomFilter = this.defaultFilter,
    pages = 1,
  ): Promise<Map<string, RedditBuzzRow>> {
    const wanted = new Set(symbols.map((s) => s.toUpperCase()));
    const rows = await this.getTrending(filter, pages);
    const out = new Map<string, RedditBuzzRow>();
    for (const r of rows) if (wanted.has(r.symbol)) out.set(r.symbol, r);
    return out;
  }

  private async getJson(url: string): Promise<any> {
    const started = Date.now();
    const res = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`GET ${url} -> ${res.status} in ${ms}ms`);
      throw new Error(
        `ApeWisdom GET failed (${res.status}): ${body.slice(0, 160)}`,
      );
    }
    this.logger.debug(`GET ${url} -> 200 in ${ms}ms`);
    return res.json();
  }
}

function toRow(r: any): RedditBuzzRow {
  const mentions = Number(r?.mentions ?? 0);
  const prev = numOrNull(r?.mentions_24h_ago);
  return {
    symbol: String(r?.ticker ?? '').toUpperCase(),
    name: decodeEntities(String(r?.name ?? '')),
    rank: Number(r?.rank ?? 0),
    rank24hAgo: numOrNull(r?.rank_24h_ago),
    mentions,
    mentions24hAgo: prev,
    upvotes: Number(r?.upvotes ?? 0),
    mentionsChangePct:
      prev === null || prev === 0
        ? null
        : Math.round(((mentions - prev) / prev) * 1000) / 10,
  };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ApeWisdom HTML-escapes names ("SPDR S&amp;P 500"). */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
