import { Injectable, Logger } from '@nestjs/common';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { TastytradeService } from '../tastytrade/tastytrade.service';
import { FinnhubClient } from '../finnhub/finnhub.client';
import { MarketCalendarService } from '../orchestrator/market-calendar.service';
import { occToStreamer } from './occ';

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
});

/**
 * The broker surface, exposed to the agent as IN-PROCESS tools wrapping the
 * services this app already uses.
 *
 * This replaces spawning tastytrade's own MCP server, for two reasons.
 *
 * SAFETY (the decisive one). That server exposes seven tools that place,
 * replace, edit or cancel REAL orders on a production account. Spawning it made
 * the research agent the only component in this system with any path to a live
 * order, with a tool allowlist as the sole guardrail. Wrapping our own
 * TastytradeService restores the property the rest of the codebase has:
 * `postOrderDryRun` is the only order call that exists in this process, so
 * there is nothing to allowlist against. The guarantee is structural again
 * rather than configuration-dependent.
 *
 * DEPLOYABILITY. The server is stdio-only (no HTTP/SSE), so it cannot run as an
 * ECS sidecar — it would have to be baked into the image and run as a second
 * Node process inside a 256-CPU/512MB task. These tools run in-process and work
 * identically on a laptop and on Fargate.
 *
 * Everything here is read-only except `dry_run_spread`, which validates an
 * order without placing it.
 */
@Injectable()
export class TastytradeAgentTools {
  private readonly logger = new Logger(TastytradeAgentTools.name);

  constructor(
    private readonly tt: TastytradeService,
    private readonly finnhub: FinnhubClient,
    private readonly calendar: MarketCalendarService,
  ) {}

  createServer() {
    return createSdkMcpServer({
      name: 'tt',
      version: '1.0.0',
      tools: [
        tool(
          'market_metrics',
          'Volatility screen for up to 100 symbols: IV index, IV rank, IV percentile, IV minus HV30, liquidity rating, next earnings, and IV by expiration. Pre-reduced to one compact row per symbol.',
          { symbols: z.array(z.string()).min(1).max(100) },
          async ({ symbols }) => {
            const started = Date.now();
            const raw = await this.tt.getMarketMetrics(symbols.map((s) => s.toUpperCase()));
            // The SDK hands back an array-like object keyed "0","1",... — not
            // the {items:[]} envelope the REST docs describe.
            const items: any[] = Array.isArray(raw)
              ? raw
              : (raw?.items ?? raw?.data?.items ?? Object.values(raw ?? {}));
            const rows = items.map((m) => this.reduceMetrics(m));
            this.logger.log(
              `tool market_metrics(${symbols.length}) -> ${rows.length} rows in ${Date.now() - started}ms`,
            );
            return ok({
              count: rows.length,
              missing: symbols.filter(
                (s) => !rows.some((r) => r.symbol === s.toUpperCase()),
              ),
              rows,
            });
          },
        ),

        tool(
          'option_chain',
          'Expiration ladder and strike list for an underlying. Returns expirations with DTE and, for the chosen ones, the available strikes with their OCC symbols.',
          {
            symbol: z.string(),
            maxDte: z.number().int().positive().default(60),
            expirations: z
              .array(z.string())
              .optional()
              .describe('YYYY-MM-DD; when given, only these come back with full strike lists'),
          },
          async ({ symbol, maxDte, expirations }) => {
            const chain = await this.tt.getNestedChain(symbol.toUpperCase());
            const root = Array.isArray(chain)
              ? chain[0]
              : (chain?.items?.[0] ?? chain?.data?.items?.[0]);
            const all: any[] = root?.expirations ?? [];
            const inWindow = all.filter((e) => Number(e['days-to-expiration']) <= maxDte);

            const wanted = expirations?.length
              ? inWindow.filter((e) => expirations.includes(e['expiration-date']))
              : [];

            this.logger.log(
              `tool option_chain(${symbol}) -> ${inWindow.length} expirations <= ${maxDte}d` +
                (wanted.length ? `, strikes for ${wanted.length}` : ''),
            );
            return ok({
              symbol: symbol.toUpperCase(),
              expirations: inWindow.map((e) => ({
                expiration: e['expiration-date'],
                dte: e['days-to-expiration'],
                settlementType: e['settlement-type'],
                strikeCount: (e.strikes ?? []).length,
              })),
              strikes: wanted.map((e) => ({
                expiration: e['expiration-date'],
                dte: e['days-to-expiration'],
                strikes: (e.strikes ?? []).map((s: any) => ({
                  strike: Number(s['strike-price']),
                  call: s.call,
                  put: s.put,
                })),
              })),
              note: expirations?.length
                ? undefined
                : 'Call again with `expirations` to get strike lists — omitted here to keep the payload small.',
            });
          },
        ),

        tool(
          'quote_options',
          'LIVE bid/ask/delta/IV for option contracts. Accepts OCC symbols ("META  260914P00625000") or DXLink symbols; OCC is converted for you. Batch every leg into ONE call.',
          {
            symbols: z.array(z.string()).min(1).max(100),
            seconds: z.number().int().min(3).max(20).default(8),
          },
          async ({ symbols, seconds }) => {
            const mapped = symbols.map((s) => {
              const raw = s.trim();
              try {
                return { input: raw, streamer: raw.startsWith('.') ? raw : occToStreamer(raw) };
              } catch {
                return { input: raw, streamer: null as string | null };
              }
            });
            const usable = mapped.filter((m) => m.streamer) as {
              input: string;
              streamer: string;
            }[];
            if (!usable.length) {
              return ok({ error: 'no parseable symbols', received: symbols });
            }

            const snap: any = await this.tt.streamSnapshot(
              usable.map((m) => m.streamer),
              seconds,
            );
            const by: Record<string, any> = {};
            for (const evt of snap?.events ?? []) {
              for (const e of Array.isArray(evt?.data) ? evt.data : []) {
                if (!e?.eventSymbol) continue;
                by[e.eventSymbol] = by[e.eventSymbol] ?? {};
                if (e.eventType === 'Quote') {
                  by[e.eventSymbol].bid = e.bidPrice;
                  by[e.eventSymbol].ask = e.askPrice;
                } else if (e.eventType === 'Greeks') {
                  by[e.eventSymbol].delta = e.delta;
                  by[e.eventSymbol].iv = e.volatility;
                }
              }
            }

            const quotes = usable.map((m) => {
              const q = by[m.streamer] ?? {};
              const bid = num(q.bid);
              const ask = num(q.ask);
              // A zero bid is not a price — market makers pull bids outside RTH
              // and in thin books. Say so explicitly rather than letting the
              // model compute a mid of ask/2 and treat it as real.
              const tradeable = bid !== null && ask !== null && bid > 0 && ask > 0;
              return {
                symbol: m.input,
                streamerSymbol: m.streamer,
                bid,
                ask,
                mid: tradeable ? round4((bid! + ask!) / 2) : null,
                spreadAbs: tradeable ? round4(ask! - bid!) : null,
                spreadPctOfMid:
                  tradeable && bid! + ask! > 0
                    ? round4((ask! - bid!) / ((bid! + ask!) / 2))
                    : null,
                delta: num(q.delta),
                iv: num(q.iv),
                tradeable,
                note: tradeable ? undefined : 'NO BID — untradeable, do not price this leg',
              };
            });

            this.logger.log(
              `tool quote_options(${symbols.length}) -> ${quotes.filter((q) => q.tradeable).length} tradeable`,
            );
            return ok({ quotes, unparseable: mapped.filter((m) => !m.streamer).map((m) => m.input) });
          },
        ),

        tool(
          'quote_equity',
          'LIVE bid/ask for underlyings. Use this for spot prices before computing expected move.',
          { symbols: z.array(z.string()).min(1).max(50) },
          async ({ symbols }) => {
            const syms = symbols.map((s) => s.toUpperCase());
            const snap: any = await this.tt.streamSnapshot(syms, 6);
            const out: Record<string, unknown> = {};
            for (const evt of snap?.events ?? []) {
              for (const e of Array.isArray(evt?.data) ? evt.data : []) {
                if (e?.eventType !== 'Quote' || !e.eventSymbol) continue;
                const bid = num(e.bidPrice);
                const ask = num(e.askPrice);
                out[e.eventSymbol] = {
                  bid,
                  ask,
                  mid: bid !== null && ask !== null ? round4((bid + ask) / 2) : null,
                };
              }
            }
            this.logger.log(`tool quote_equity(${syms.join(',')}) -> ${Object.keys(out).length}`);
            return ok({ quotes: out, missing: syms.filter((s) => !out[s]) });
          },
        ),

        tool(
          'earnings_calendar',
          'Scheduled earnings between two dates (Finnhub). Use this to keep premium selling out of earnings, and to find post-earnings IV-crush setups.',
          {
            from: z.string().describe('YYYY-MM-DD'),
            to: z.string().describe('YYYY-MM-DD'),
            symbols: z.array(z.string()).optional().describe('Filter to these tickers'),
          },
          async ({ from, to, symbols }) => {
            const events = await this.finnhub.getEarningsCalendar(from, to);
            const filter = symbols?.map((s) => s.toUpperCase());
            const rows = (events ?? []).filter(
              (e: any) => !filter || filter.includes(String(e.symbol).toUpperCase()),
            );
            this.logger.log(
              `tool earnings_calendar(${from}..${to}) -> ${rows.length} events`,
            );
            return ok({ from, to, count: rows.length, events: rows });
          },
        ),

        tool(
          'market_calendar',
          'NYSE trading days, closures and 1pm early closes over a date range. Computed, not fetched — this is the same calendar the rest of the system schedules on.',
          { days: z.number().int().positive().max(90).default(14) },
          async ({ days }) => {
            const rows: { date: string; tradingDay: boolean; earlyClose: boolean }[] = [];
            const now = Date.now();
            for (let i = 0; i < days; i++) {
              const d = new Date(now + i * 86_400_000);
              rows.push({
                date: etDate(d),
                tradingDay: this.calendar.isTradingDay(d),
                earlyClose: this.calendar.isEarlyClose(d),
              });
            }
            return ok({
              tradingDays: rows.filter((r) => r.tradingDay).map((r) => r.date),
              closures: rows.filter((r) => !r.tradingDay).map((r) => r.date),
              earlyCloses: rows.filter((r) => r.earlyClose).map((r) => r.date),
              note: 'Macro dates (CPI/PPI/FOMC) are not in this calendar — get those from the web.',
            });
          },
        ),

        tool(
          'account_balances',
          'REAL broker account balances. Read-only, and note this is the LIVE account, not the paper arm you are trading — use paper_positions for sizing.',
          {},
          async () => ok(await this.tt.getAccountBalances()),
        ),

        tool(
          'broker_positions',
          'REAL broker positions. Read-only. Distinct from the paper arm — use paper_positions for sizing.',
          {},
          async () => ok(await this.tt.getBrokerPositions()),
        ),

        tool(
          'dry_run_spread',
          'VALIDATE a multi-leg order with tastytrade without placing it. Returns buying-power effect, fees and warnings. Give legs by OCC symbol; the order payload is built for you. NOTE: the live account holds only ~$250, so a 422 preflight failure for buying power is expected on realistically-sized plays and does NOT mean the play is bad — record it and move on. This cannot place an order; no such capability exists in this process.',
          {
            legs: z
              .array(
                z.object({
                  occSymbol: z.string(),
                  action: z.enum(['Sell to Open', 'Buy to Open']),
                  quantity: z.number().int().positive().default(1),
                }),
              )
              .min(1)
              .max(4),
            price: z.number().describe('Absolute net price per contract, e.g. 0.50'),
            priceEffect: z.enum(['Credit', 'Debit']),
          },
          async ({ legs, price, priceEffect }) => {
            const order = {
              'order-type': 'Limit',
              'time-in-force': 'Day',
              price: Math.abs(price).toFixed(2),
              'price-effect': priceEffect,
              legs: legs.map((l) => ({
                'instrument-type': 'Equity Option',
                symbol: l.occSymbol,
                quantity: l.quantity,
                action: l.action,
              })),
            };
            const started = Date.now();
            try {
              const result: any = await this.tt.dryRunOrder(order);
              const bp =
                result?.['buying-power-effect']?.['change-in-buying-power'] ??
                result?.data?.['buying-power-effect']?.['change-in-buying-power'] ??
                null;
              const fees =
                result?.['fee-calculation']?.['total-fees'] ??
                result?.data?.['fee-calculation']?.['total-fees'] ??
                null;
              const warnings = result?.warnings ?? result?.data?.warnings ?? [];
              this.logger.log(
                `tool dry_run_spread(${legs.length} legs, ${priceEffect} ${price}) -> ` +
                  `bp=${bp} fees=${fees} warnings=${warnings.length} in ${Date.now() - started}ms`,
              );
              return ok({
                passed: true,
                buyingPowerEffect: bp,
                totalFees: fees,
                warnings,
                submittedOrder: order,
              });
            } catch (err) {
              // A bare "status code 422" tells the agent nothing actionable —
              // tastytrade puts the real reason (insufficient buying power,
              // bad symbol, market closed) in the response body.
              const e = err as any;
              const body = e?.response?.data ?? e?.response ?? null;
              const detail =
                body?.error?.message ??
                (body?.error?.errors
                  ? JSON.stringify(body.error.errors)
                  : body
                    ? JSON.stringify(body).slice(0, 600)
                    : null);
              const msg = e instanceof Error ? e.message : String(e);
              this.logger.warn(
                `tool dry_run_spread FAILED — ${msg}${detail ? ` :: ${detail}` : ''}`,
              );
              return ok({
                passed: false,
                error: msg,
                brokerDetail: detail,
                submittedOrder: order,
              });
            }
          },
        ),
      ],
    });
  }

  /**
   * The jq reduction from the spec, done in code: the main agent should only
   * ever see a compact table, never a raw metrics payload.
   */
  private reduceMetrics(m: any) {
    // UNITS ARE INCONSISTENT WITHIN THE SAME PAYLOAD, verified against live
    // production data for SPY:
    //   implied-volatility-index       "0.178771"  <- decimal
    //   implied-volatility-index-rank  "0.426559"  <- decimal
    //   implied-volatility-30-day      "17.88"     <- ALREADY points
    //   historical-volatility-30-day   "8.24"      <- ALREADY points
    //   option-expiration-implied-...  "0.214727"  <- decimal
    // Multiplying the already-pointed fields by 100 turned ivMinusHv30 into
    // -806 instead of +9.6. Everything the model sees is normalized to POINTS
    // here so it never has to guess.
    const ivIndexPts = pct(num(m['implied-volatility-index']));
    const hv30Pts = num(m['historical-volatility-30-day']); // already points
    const expIvs: any[] = m['option-expiration-implied-volatilities'] ?? [];
    return {
      symbol: String(m.symbol ?? '').toUpperCase(),
      ivIndex: ivIndexPts,
      ivRank: pct(num(m['implied-volatility-index-rank'])),
      ivPercentile: pct(num(m['implied-volatility-percentile'])),
      iv5dChange: pct(num(m['implied-volatility-index-5-day-change'])),
      iv30: num(m['implied-volatility-30-day']), // already points
      hv30: hv30Pts,
      // Points, not ratio: > +10 favours selling, < 0 favours buying.
      ivMinusHv30:
        ivIndexPts !== null && hv30Pts !== null ? round2(ivIndexPts - hv30Pts) : null,
      liquidityRating: num(m['liquidity-rating']),
      beta: num(m.beta),
      // ETFs return {visible:false} with no date; stocks carry the real fields.
      nextEarningsDate: m.earnings?.['expected-report-date'] ?? null,
      earningsTimeOfDay: m.earnings?.['time-of-day'] ?? null,
      expirationIvs: expIvs.slice(0, 4).map((e) => ({
        expiration: e['expiration-date'],
        iv: pct(num(e['implied-volatility'])),
      })),
    };
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}
/** tastytrade returns volatilities as decimals (0.41); report as points (41). */
function pct(v: number | null): number | null {
  return v === null ? null : round2(v * 100);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function etDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
