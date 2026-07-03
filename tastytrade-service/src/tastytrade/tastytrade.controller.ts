import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TastytradeService } from './tastytrade.service';

@ApiTags('tastytrade')
@Controller('tt')
export class TastytradeController {
  constructor(private readonly tt: TastytradeService) {}

  /** Auth + account check — proves the session works. */
  @Get('whoami')
  @ApiOperation({
    summary: 'Log in and list accounts (proves auth works)',
  })
  async whoami(): Promise<Record<string, unknown>> {
    const accounts = await this.tt.getAccounts();
    const items = this.tt.accountItems(accounts);
    return {
      environment: this.tt.environment(),
      loggedIn: this.tt.isLoggedIn(),
      accountNumbers: items.map(
        (i: any) => i?.account?.['account-number'] ?? i?.['account-number'],
      ),
      raw: accounts,
    };
  }

  /** Option chain — proves options data flows. Returns a readable summary. */
  @Get('chain')
  @ApiOperation({ summary: 'Fetch nested option chain (proves options data)' })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  async chain(
    @Query('symbol') symbol = 'SPY',
  ): Promise<Record<string, unknown>> {
    const chain = await this.tt.getNestedChain(symbol.toUpperCase());
    const root = Array.isArray(chain)
      ? chain[0]
      : (chain?.items?.[0] ?? chain?.data?.items?.[0]);
    const expirations = (root?.expirations ?? []).map((e: any) => ({
      expiration: e['expiration-date'],
      dte: e['days-to-expiration'],
      strikeCount: (e.strikes ?? []).length,
    }));
    return {
      symbol: root?.['underlying-symbol'] ?? symbol,
      expirationCount: expirations.length,
      expirations,
    };
  }

  /**
   * Build a bull put credit spread from the live chain and DRY-RUN it.
   * Places nothing — just validates that tastytrade accepts a multi-leg order
   * and returns buying-power effect / warnings. This is the key proof.
   */
  @Post('dry-run-spread')
  @ApiOperation({
    summary:
      'Build a bull put credit spread from the live chain and DRY-RUN it (places nothing)',
  })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  async dryRunSpread(
    @Query('symbol') symbol = 'SPY',
  ): Promise<Record<string, unknown>> {
    const sym = symbol.toUpperCase();
    const chain = await this.tt.getNestedChain(sym);
    const root = Array.isArray(chain)
      ? chain[0]
      : (chain?.items?.[0] ?? chain?.data?.items?.[0]);
    const expirations = root?.expirations ?? [];

    // Pick an expiration ~30–45 DTE (fall back to the first available).
    const exp =
      expirations.find(
        (e: any) =>
          e['days-to-expiration'] >= 30 && e['days-to-expiration'] <= 45,
      ) ?? expirations[0];
    if (!exp) {
      return { error: `No expirations available for ${sym}` };
    }

    // Sort strikes ascending; bull put spread = sell higher put, buy lower put.
    const strikes = [...(exp.strikes ?? [])].sort(
      (a: any, b: any) =>
        parseFloat(a['strike-price']) - parseFloat(b['strike-price']),
    );
    if (strikes.length < 2) {
      return { error: `Not enough strikes for ${sym} ${exp['expiration-date']}` };
    }
    const mid = Math.floor(strikes.length / 2);
    const shortLeg = strikes[mid]; // sell to open (higher strike)
    const longLeg = strikes[mid - 1]; // buy to open (lower strike, protection)

    const order = {
      'order-type': 'Limit',
      'time-in-force': 'Day',
      price: '0.50',
      'price-effect': 'Credit',
      legs: [
        {
          'instrument-type': 'Equity Option',
          symbol: shortLeg.put,
          quantity: 1,
          action: 'Sell to Open',
        },
        {
          'instrument-type': 'Equity Option',
          symbol: longLeg.put,
          quantity: 1,
          action: 'Buy to Open',
        },
      ],
    };

    const result = await this.tt.dryRunOrder(order);
    return {
      symbol: sym,
      strategy: 'bull put credit spread',
      expiration: exp['expiration-date'],
      dte: exp['days-to-expiration'],
      shortPutStrike: shortLeg['strike-price'],
      longPutStrike: longLeg['strike-price'],
      submittedOrder: order,
      dryRunResult: result,
    };
  }

  // ---------- options data endpoints ----------

  private async nestedRoot(symbol: string): Promise<any> {
    const chain = await this.tt.getNestedChain(symbol);
    return Array.isArray(chain)
      ? chain[0]
      : (chain?.items?.[0] ?? chain?.data?.items?.[0]);
  }

  /** Pick the expiration whose DTE is closest to the target. */
  private pickExpiration(root: any, dte: number): any {
    const exps = root?.expirations ?? [];
    return exps.reduce(
      (best: any, e: any) =>
        !best ||
        Math.abs(e['days-to-expiration'] - dte) <
          Math.abs(best['days-to-expiration'] - dte)
          ? e
          : best,
      null,
    );
  }

  private sortedStrikes(exp: any): any[] {
    return [...(exp?.strikes ?? [])].sort(
      (a: any, b: any) =>
        parseFloat(a['strike-price']) - parseFloat(b['strike-price']),
    );
  }

  @Get('equity')
  @ApiOperation({ summary: 'Underlying equity definition' })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  async equity(@Query('symbol') symbol = 'SPY'): Promise<any> {
    return this.tt.getEquity(symbol.toUpperCase());
  }

  @Get('chain/detailed')
  @ApiOperation({ summary: 'Detailed flat option-instrument chain (per-contract)' })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  async chainDetailed(@Query('symbol') symbol = 'SPY'): Promise<any> {
    return this.tt.getDetailedChain(symbol.toUpperCase());
  }

  @Get('chain/compact')
  @ApiOperation({ summary: 'Compact option chain (arrays of symbols)' })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  async chainCompact(@Query('symbol') symbol = 'SPY'): Promise<any> {
    return this.tt.getCompactChain(symbol.toUpperCase());
  }

  /** Strike ladder for one expiration — raw strike objects (shows all fields). */
  @Get('strikes')
  @ApiOperation({ summary: 'Strike ladder for one expiration (raw strike objects)' })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  @ApiQuery({ name: 'dte', required: false, example: '30' })
  async strikes(
    @Query('symbol') symbol = 'SPY',
    @Query('dte') dte = '30',
  ): Promise<Record<string, unknown>> {
    const root = await this.nestedRoot(symbol.toUpperCase());
    const exp = this.pickExpiration(root, parseInt(dte, 10));
    if (!exp) return { error: `No expirations for ${symbol}` };
    const strikes = this.sortedStrikes(exp);
    return {
      symbol: root?.['underlying-symbol'] ?? symbol.toUpperCase(),
      expiration: exp['expiration-date'],
      dte: exp['days-to-expiration'],
      strikeCount: strikes.length,
      strikes,
    };
  }

  @Get('market-metrics')
  @ApiOperation({ summary: 'IV rank / IV percentile / HV / beta / liquidity' })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  async marketMetrics(
    @Query('symbol') symbol = 'SPY',
  ): Promise<any> {
    try {
      return await this.tt.getMarketMetrics([symbol.toUpperCase()]);
    } catch (err: any) {
      // Surface the real reason (often unavailable on the demo/sandbox feed).
      return {
        error: 'market-metrics request failed',
        detail: err?.response?.data ?? err?.message ?? String(err),
      };
    }
  }

  @Get('option')
  @ApiOperation({ summary: 'Single option instrument by OCC symbol' })
  @ApiQuery({
    name: 'symbol',
    required: true,
    example: 'SPY   260731P00696000',
  })
  async option(@Query('symbol') symbol: string): Promise<any> {
    return this.tt.getSingleOption(symbol);
  }

  @Get('quote-token')
  @ApiOperation({ summary: 'DXLink quote token + streamer URL' })
  async quoteToken(): Promise<any> {
    return this.tt.getQuoteToken();
  }

  /**
   * Live quotes + greeks snapshot for N strikes at one expiration, via DXLink
   * streaming. This is where delta/IV per contract comes from (strike selection).
   */
  @Get('live')
  @ApiOperation({
    summary: 'Live quotes + greeks snapshot for one expiration (DXLink streaming)',
  })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  @ApiQuery({ name: 'dte', required: false, example: '30' })
  @ApiQuery({ name: 'right', required: false, example: 'P', description: 'P or C' })
  @ApiQuery({ name: 'count', required: false, example: '10' })
  @ApiQuery({ name: 'seconds', required: false, example: '6' })
  async live(
    @Query('symbol') symbol = 'SPY',
    @Query('dte') dte = '30',
    @Query('right') right = 'P',
    @Query('count') count = '10',
    @Query('seconds') seconds = '6',
  ): Promise<Record<string, unknown>> {
    const root = await this.nestedRoot(symbol.toUpperCase());
    const exp = this.pickExpiration(root, parseInt(dte, 10));
    if (!exp) return { error: `No expirations for ${symbol}` };

    const strikes = this.sortedStrikes(exp);
    const n = Math.max(1, parseInt(count, 10));
    const mid = Math.floor(strikes.length / 2);
    const start = Math.max(0, mid - Math.floor(n / 2));
    const slice = strikes.slice(start, start + n);

    const isPut = right.toUpperCase().startsWith('P');
    const field = isPut ? 'put-streamer-symbol' : 'call-streamer-symbol';
    const streamerSymbols = slice
      .map((s: any) => s[field])
      .filter((x: any) => typeof x === 'string' && x.length);

    if (!streamerSymbols.length) {
      return {
        error: `No streamer symbols on strikes (field "${field}"). Check /tt/strikes for the real field names.`,
        sampleStrike: slice[0],
      };
    }

    const snap = await this.tt.streamSnapshot(
      streamerSymbols,
      parseInt(seconds, 10),
    );

    // Merge streaming events into one row per contract (Greeks + Quote).
    const bySymbol: Record<string, any> = {};
    for (const evt of (snap.events as any[]) ?? []) {
      const dataArr = Array.isArray(evt?.data) ? evt.data : [];
      for (const e of dataArr) {
        const s = e?.eventSymbol;
        if (!s) continue;
        bySymbol[s] = bySymbol[s] ?? { streamerSymbol: s };
        if (e.eventType === 'Greeks') {
          Object.assign(bySymbol[s], {
            iv: e.volatility,
            delta: e.delta,
            gamma: e.gamma,
            theta: e.theta,
            vega: e.vega,
            rho: e.rho,
            optionPrice: e.price,
          });
        } else if (e.eventType === 'Quote') {
          Object.assign(bySymbol[s], {
            bid: e.bidPrice,
            ask: e.askPrice,
            bidSize: e.bidSize,
            askSize: e.askSize,
          });
        }
      }
    }

    return {
      symbol: root?.['underlying-symbol'] ?? symbol.toUpperCase(),
      expiration: exp['expiration-date'],
      dte: exp['days-to-expiration'],
      right: isPut ? 'P' : 'C',
      streamerUrl: snap.streamerUrl,
      eventCount: snap.eventCount,
      contracts: Object.values(bySymbol),
    };
  }
}
