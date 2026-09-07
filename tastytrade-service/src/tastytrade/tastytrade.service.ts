import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TastytradeClient, {
  MarketDataStreamer,
  MarketDataSubscriptionType,
} from '@tastytrade/api';

const ENVS = {
  sandbox: {
    base: 'https://api.cert.tastyworks.com',
    streamer: 'wss://streamer.cert.tastyworks.com',
  },
  production: {
    base: 'https://api.tastyworks.com',
    streamer: 'wss://streamer.tastyworks.com',
  },
};

/**
 * Thin wrapper around the official @tastytrade/api SDK.
 * Session auth (username/password) — simplest for the spike. Production will
 * switch to OAuth2 with refresh tokens.
 */
@Injectable()
export class TastytradeService implements OnModuleInit {
  private readonly logger = new Logger(TastytradeService.name);
  private readonly client: TastytradeClient;
  private readonly envName: string;
  private readonly baseUrl: string;
  private readonly useOAuth: boolean;
  private loggedIn = false;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0; // epoch ms

  constructor(private readonly config: ConfigService) {
    this.envName = this.config.get<string>('TT_ENV', 'sandbox');
    const env = this.envName === 'production' ? ENVS.production : ENVS.sandbox;
    this.baseUrl = env.base;
    this.client = new TastytradeClient(env.base, env.streamer);
    // OAuth2 when a refresh token + client secret are present (required for
    // production); otherwise fall back to username/password session auth.
    this.useOAuth = !!(
      this.config.get<string>('TT_REFRESH_TOKEN') &&
      this.config.get<string>('TT_CLIENT_SECRET')
    );
  }

  async onModuleInit() {
    try {
      await this.ensureLogin();
    } catch (err) {
      // Don't crash the app if creds aren't set yet — endpoints will report it.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`tastytrade login deferred: ${msg}`);
    }
  }

  private async ensureLogin(): Promise<void> {
    if (this.useOAuth) {
      await this.ensureOAuthToken();
      return;
    }
    if (this.loggedIn) return;
    const user = this.config.get<string>('TT_USERNAME');
    const pass = this.config.get<string>('TT_PASSWORD');
    if (!user || !pass) {
      throw new Error('TT_USERNAME / TT_PASSWORD not set in .env');
    }
    await this.client.sessionService.login(user, pass);
    this.loggedIn = true;
    this.logger.log(`Logged into tastytrade (${this.envName}, session auth)`);
  }

  /**
   * OAuth2: exchange the long-lived refresh token for a 15-min access token and
   * inject it as the SDK's Authorization header. Every API call runs through
   * ensureLogin(), so this re-mints lazily on expiry (60s safety buffer).
   */
  private async ensureOAuthToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return;
    }
    const secret = this.config.get<string>('TT_CLIENT_SECRET');
    const refresh = this.config.get<string>('TT_REFRESH_TOKEN');
    if (!secret || !refresh) {
      throw new Error('TT_CLIENT_SECRET / TT_REFRESH_TOKEN not set');
    }
    const resp = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'osaitrader/0.1',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_secret: secret,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`OAuth token request failed: ${resp.status} ${body}`);
    }
    const data = (await resp.json()) as {
      access_token: string;
      expires_in?: number;
    };
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + (data.expires_in ?? 900) * 1000;
    this.client.httpClient.session.authToken = `Bearer ${this.accessToken}`;
    this.loggedIn = true;
    this.logger.log(
      `tastytrade OAuth token acquired (${this.envName}), valid ${data.expires_in ?? 900}s`,
    );
  }

  isLoggedIn(): boolean {
    return this.loggedIn;
  }

  environment(): string {
    return this.envName;
  }

  async getAccounts(): Promise<any> {
    await this.ensureLogin();
    return this.client.accountsAndCustomersService.getCustomerAccounts();
  }

  /** Normalize the accounts response to a plain array of account items. */
  accountItems(accounts: any): any[] {
    if (Array.isArray(accounts)) return accounts;
    return accounts?.items ?? accounts?.data?.items ?? [];
  }

  async getFirstAccountNumber(): Promise<string> {
    const items = this.accountItems(await this.getAccounts());
    const num =
      items[0]?.account?.['account-number'] ?? items[0]?.['account-number'];
    if (!num) throw new Error('No accounts found on this login');
    return num;
  }

  /** Real broker account balances (net liq, cash, buying power, ...). */
  async getAccountBalances(): Promise<any> {
    await this.ensureLogin();
    const account = await this.getFirstAccountNumber();
    return this.client.balancesAndPositionsService.getAccountBalanceValues(
      account,
    );
  }

  /** Real broker open positions (distinct from our imaginary paper ledger). */
  async getBrokerPositions(): Promise<any> {
    await this.ensureLogin();
    const account = await this.getFirstAccountNumber();
    return this.client.balancesAndPositionsService.getPositionsList(account);
  }

  async getNestedChain(symbol: string): Promise<any> {
    await this.ensureLogin();
    return this.client.instrumentsService.getNestedOptionChain(symbol);
  }

  /** Validate a multi-leg order WITHOUT placing it. */
  async dryRunOrder(order: object): Promise<any> {
    await this.ensureLogin();
    const account = await this.getFirstAccountNumber();
    return this.client.orderService.postOrderDryRun(account, order);
  }

  // --- Options / market data (REST) ---

  /** Underlying equity definition. */
  async getEquity(symbol: string): Promise<any> {
    await this.ensureLogin();
    return this.client.instrumentsService.getSingleEquity(symbol);
  }

  /** Flat, detailed option-instrument list (per-contract fields incl. streamer-symbol). */
  async getDetailedChain(symbol: string): Promise<any> {
    await this.ensureLogin();
    return this.client.instrumentsService.getOptionChain(symbol);
  }

  /** Compact chain — arrays of option symbols, lightweight. */
  async getCompactChain(symbol: string): Promise<any> {
    await this.ensureLogin();
    return this.client.instrumentsService.getCompactOptionChain(symbol);
  }

  /** Single option instrument detail by OCC symbol. */
  async getSingleOption(occSymbol: string): Promise<any> {
    await this.ensureLogin();
    return this.client.instrumentsService.getSingleEquityOption(occSymbol);
  }

  /** Volatility / liquidity metrics (IV rank, IV percentile, HV, beta, ...). */
  async getMarketMetrics(symbols: string[]): Promise<any> {
    await this.ensureLogin();
    const started = Date.now();
    this.logger.log(`market-metrics: requesting ${symbols.length} symbols`);
    // tastytrade wants a comma-separated `symbols=SPY,QQQ`. The SDK serializes
    // arrays as `symbols[]=SPY` (qs brackets), which production 400s — so pass a
    // pre-joined string to get the flat `symbols=` form.
    const result = await this.client.marketMetricsService.getMarketMetrics({
      symbols: symbols.join(','),
    });
    const count = Array.isArray(result) ? result.length : 0;
    this.logger.log(
      `market-metrics: got ${count}/${symbols.length} in ${Date.now() - started}ms`,
    );
    return result;
  }

  /** DXLink quote token + streamer URL (for live quotes/greeks). */
  async getQuoteToken(): Promise<any> {
    await this.ensureLogin();
    return this.client.accountsAndCustomersService.getApiQuoteToken();
  }

  // --- Options / market data (streaming snapshot via DXLink) ---

  /**
   * Subscribe to Quote + Greeks for a set of dxfeed streamer symbols, collect
   * whatever arrives within `seconds`, then tear the socket down and return.
   * Snapshot-style — good for a point-in-time read of greeks/quotes.
   */
  async streamSnapshot(
    streamerSymbols: string[],
    seconds = 6,
  ): Promise<Record<string, unknown>> {
    await this.ensureLogin();
    const tokenResp = await this.getQuoteToken();
    const token = tokenResp?.token ?? tokenResp?.['token'];
    const url =
      tokenResp?.['dxlink-url'] ??
      tokenResp?.['streamer-url'] ??
      tokenResp?.['websocket-url'] ??
      tokenResp?.url;
    if (!token || !url) {
      throw new Error(
        `No quote token/url in response: ${JSON.stringify(tokenResp)}`,
      );
    }

    const streamer = new MarketDataStreamer();
    const channelId = 3;
    const events: any[] = [];

    return new Promise((resolve) => {
      const removeData = streamer.addDataListener(
        (d: any) => events.push(d),
        channelId,
      );
      const removeError = streamer.addErrorListener((err: any) =>
        this.logger.warn(
          `streamer error (${streamerSymbols.length} symbols): ${err?.message ?? err}`,
        ),
      );
      const removeAuth = streamer.addAuthStateChangeListener(
        (isAuthorized: boolean) => {
          if (!isAuthorized) return;
          // Queue subscriptions, then open the channel (queued subs flush on open).
          for (const sym of streamerSymbols) {
            streamer.addSubscription(sym, {
              subscriptionTypes: [
                MarketDataSubscriptionType.Quote,
                MarketDataSubscriptionType.Greeks,
              ],
              channelId,
            });
          }
          streamer.openFeedChannel(channelId);
        },
      );

      streamer.connect(url, token);

      setTimeout(() => {
        removeData();
        removeAuth();
        removeError();
        // disconnect() nulls the socket's onerror handler and THEN closes it. If
        // the socket is still CONNECTING (common when several snapshots run at
        // once), `ws` emits an EventEmitter 'error' — and an 'error' event with
        // no listener is a fatal throw in Node, which killed the whole service.
        // The surrounding try/catch cannot help: the event is asynchronous.
        // Attaching a listener on the emitter channel absorbs it; disconnect()
        // only clears the on* properties, so this survives the teardown.
        const ws = (streamer as unknown as { webSocket?: any }).webSocket;
        if (ws && typeof ws.on === 'function') {
          ws.on('error', (err: any) =>
            this.logger.debug(
              `streamer socket closed mid-connect: ${err?.message ?? err}`,
            ),
          );
        }
        try {
          streamer.disconnect();
        } catch (err) {
          this.logger.warn(`streamer disconnect failed: ${errText(err)}`);
        }
        resolve({
          streamerUrl: url,
          requestedSymbols: streamerSymbols.length,
          eventCount: events.length,
          events,
        });
      }, seconds * 1000);
    });
  }

  /**
   * Build a compact market snapshot for one expiration: underlying price plus a
   * window of strikes around ATM, each with call/put delta, IV, and bid/ask.
   * This is the input the strategy AI reasons over.
   */
  async getGreeksSnapshot(
    symbol: string,
    dte = 35,
    strikesPerSide = 8,
    seconds = 7,
  ): Promise<Record<string, unknown>> {
    await this.ensureLogin();
    const sym = symbol.toUpperCase();
    const chain = await this.getNestedChain(sym);
    const root = Array.isArray(chain)
      ? chain[0]
      : (chain?.items?.[0] ?? chain?.data?.items?.[0]);
    const expirations = root?.expirations ?? [];
    const exp = expirations.reduce(
      (best: any, e: any) =>
        !best ||
        Math.abs(e['days-to-expiration'] - dte) <
          Math.abs(best['days-to-expiration'] - dte)
          ? e
          : best,
      null,
    );
    if (!exp) throw new Error(`No expirations available for ${sym}`);

    const strikes = [...(exp.strikes ?? [])].sort(
      (a: any, b: any) =>
        parseFloat(a['strike-price']) - parseFloat(b['strike-price']),
    );
    const mid = Math.floor(strikes.length / 2);
    const start = Math.max(0, mid - strikesPerSide);
    const window = strikes.slice(start, start + strikesPerSide * 2 + 1);

    // Stream the underlying equity quote + each strike's call & put.
    const streamerSymbols = [sym];
    for (const s of window) {
      if (s['put-streamer-symbol']) streamerSymbols.push(s['put-streamer-symbol']);
      if (s['call-streamer-symbol'])
        streamerSymbols.push(s['call-streamer-symbol']);
    }

    const snap = await this.streamSnapshot(streamerSymbols, seconds);
    const bySymbol: Record<string, any> = {};
    for (const evt of (snap.events as any[]) ?? []) {
      for (const e of Array.isArray(evt?.data) ? evt.data : []) {
        const s = e?.eventSymbol;
        if (!s) continue;
        bySymbol[s] = bySymbol[s] ?? {};
        if (e.eventType === 'Greeks') {
          Object.assign(bySymbol[s], {
            iv: e.volatility,
            delta: e.delta,
            theta: e.theta,
            vega: e.vega,
            price: e.price,
          });
        } else if (e.eventType === 'Quote') {
          Object.assign(bySymbol[s], { bid: e.bidPrice, ask: e.askPrice });
        }
      }
    }

    const u = bySymbol[sym];
    const underlyingPrice =
      u && u.bid != null && u.ask != null
        ? (u.bid + u.ask) / 2
        : (u?.price ?? null);

    const round = (n: any) =>
      typeof n === 'number' ? Math.round(n * 10000) / 10000 : n;
    const contracts = window.map((s: any) => {
      const p = bySymbol[s['put-streamer-symbol']] ?? {};
      const c = bySymbol[s['call-streamer-symbol']] ?? {};
      return {
        strike: parseFloat(s['strike-price']),
        put: {
          symbol: s.put,
          delta: round(p.delta),
          iv: round(p.iv),
          bid: p.bid,
          ask: p.ask,
        },
        call: {
          symbol: s.call,
          delta: round(c.delta),
          iv: round(c.iv),
          bid: c.bid,
          ask: c.ask,
        },
      };
    });

    return {
      symbol: root?.['underlying-symbol'] ?? sym,
      underlyingPrice: round(underlyingPrice),
      expiration: exp['expiration-date'],
      dte: exp['days-to-expiration'],
      contracts,
    };
  }
}

/** Error message extraction for log lines. */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
