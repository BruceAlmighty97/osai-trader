import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BASE = 'https://api.stocktwits.com/api/2';

export interface StockTwitsMessage {
  id: number;
  body: string;
  createdAt: string | null;
  username: string | null;
  sentiment: 'Bullish' | 'Bearish' | null;
  likes: number;
}

/**
 * StockTwits public API client — replaces the (dead) Reddit scanner. Uses the
 * keyless public endpoints (new app registrations are closed), so this rides the
 * same public-endpoint fragility, but they work today AND carry real Bullish/
 * Bearish sentiment. See docs/data-sources.md.
 */
@Injectable()
export class StockTwitsClient {
  private readonly logger = new Logger(StockTwitsClient.name);
  private readonly userAgent: string;
  private readonly requestDelayMs: number;
  private lastRequestAt = 0;

  constructor(private readonly config: ConfigService) {
    this.userAgent = this.config.get<string>(
      'STOCKTWITS_USER_AGENT',
      'osaitrader/0.1',
    );
    // Public endpoints are rate-limited (~200/hr) — space requests out.
    this.requestDelayMs = parseInt(
      this.config.get<string>('SOCIAL_REQUEST_DELAY_MS', '1500'),
      10,
    );
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.requestDelayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async getJson(url: string): Promise<any> {
    await this.throttle();
    const started = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': this.userAgent } });
    const ms = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`GET ${url} -> ${res.status} in ${ms}ms`);
      throw new Error(
        `StockTwits GET failed (${res.status}): ${body.slice(0, 160)}`,
      );
    }
    this.logger.debug(`GET ${url} -> 200 in ${ms}ms`);
    return res.json();
  }

  /** Currently-trending symbols, equities/ETFs only (drops crypto `SYM.X`). */
  async getTrendingSymbols(): Promise<string[]> {
    const json = await this.getJson(`${BASE}/trending/symbols.json`);
    const syms: any[] = json?.symbols ?? [];
    return syms
      .map((s) => String(s?.symbol ?? '').toUpperCase())
      .filter((s) => s && !s.includes('.'));
  }

  /** Recent messages for a symbol, each with its Bullish/Bearish tag (if any). */
  async getSymbolStream(symbol: string, limit = 30): Promise<StockTwitsMessage[]> {
    const json = await this.getJson(
      `${BASE}/streams/symbol/${encodeURIComponent(symbol)}.json`,
    );
    const msgs: any[] = json?.messages ?? [];
    return msgs.slice(0, limit).map((m) => ({
      id: m.id,
      body: m.body ?? '',
      createdAt: m.created_at ?? null,
      username: m.user?.username ?? null,
      sentiment: m.entities?.sentiment?.basic ?? null,
      likes: m.likes?.total ?? 0,
    }));
  }
}
