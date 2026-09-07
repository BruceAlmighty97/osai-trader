import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BASE = 'https://finnhub.io/api/v1';

/** When a company reports, relative to the session. */
export type EarningsHour = 'bmo' | 'amc' | 'dmh' | null;

export interface EarningsEvent {
  symbol: string;
  /** YYYY-MM-DD */
  date: string;
  /** bmo = before open, amc = after close, dmh = during market hours. */
  hour: EarningsHour;
  epsEstimate: number | null;
}

/**
 * Finnhub client — the earnings calendar that gates premium selling. Selling a
 * credit spread into an earnings report is the fastest way to eat a max loss, so
 * pre-market uses this as a HARD exclusion.
 *
 * Free tier (60 req/min) is plenty: the calendar returns the whole market for a
 * date range in ONE call, so checking N symbols costs one request, not N.
 */
@Injectable()
export class FinnhubClient {
  private readonly logger = new Logger(FinnhubClient.name);
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('FINNHUB_API_KEY', '');
  }

  /** False when FINNHUB_API_KEY isn't set — callers decide how to degrade. */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /** All earnings events between two YYYY-MM-DD dates (inclusive). */
  async getEarningsCalendar(from: string, to: string): Promise<EarningsEvent[]> {
    if (!this.isConfigured()) {
      throw new Error('FINNHUB_API_KEY not set');
    }
    const url =
      `${BASE}/calendar/earnings?from=${from}&to=${to}` +
      `&token=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Finnhub earnings calendar failed (${res.status}): ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as { earningsCalendar?: any[] };
    return (json.earningsCalendar ?? []).map((e) => ({
      symbol: String(e.symbol ?? '').toUpperCase(),
      date: String(e.date ?? ''),
      hour: (e.hour || null) as EarningsHour,
      epsEstimate: e.epsEstimate ?? null,
    }));
  }

  /**
   * Which of `symbols` report within the next `days` — the earnings gate's
   * question. Returns symbol -> soonest event. One API call regardless of N.
   */
  async earningsWithin(
    symbols: string[],
    days = 45,
  ): Promise<Map<string, EarningsEvent>> {
    const from = isoDay(new Date());
    const to = isoDay(new Date(Date.now() + days * 86400_000));
    const events = await this.getEarningsCalendar(from, to);

    const wanted = new Set(symbols.map((s) => s.toUpperCase()));
    const out = new Map<string, EarningsEvent>();
    for (const e of events) {
      if (!wanted.has(e.symbol)) continue;
      const existing = out.get(e.symbol);
      if (!existing || e.date < existing.date) out.set(e.symbol, e);
    }
    this.logger.log(
      `Earnings ${from}..${to}: ${out.size} of ${wanted.size} watched symbols report`,
    );
    return out;
  }
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
