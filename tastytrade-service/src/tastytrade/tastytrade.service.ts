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
  private loggedIn = false;

  constructor(private readonly config: ConfigService) {
    this.envName = this.config.get<string>('TT_ENV', 'sandbox');
    const env = this.envName === 'production' ? ENVS.production : ENVS.sandbox;
    this.client = new TastytradeClient(env.base, env.streamer);
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
    if (this.loggedIn) return;
    const user = this.config.get<string>('TT_USERNAME');
    const pass = this.config.get<string>('TT_PASSWORD');
    if (!user || !pass) {
      throw new Error('TT_USERNAME / TT_PASSWORD not set in .env');
    }
    await this.client.sessionService.login(user, pass);
    this.loggedIn = true;
    this.logger.log(`Logged into tastytrade (${this.envName})`);
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
    return this.client.marketMetricsService.getMarketMetrics({ symbols });
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
        try {
          streamer.disconnect();
        } catch {
          /* ignore */
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
}
