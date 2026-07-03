import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IBApi, EventName, ErrorCode } from '@stoqey/ib';
import {
  IbkrConfig,
  IbkrConnectionState,
  AccountSummary,
} from './ibkr.types';

@Injectable()
export class IbkrService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IbkrService.name);
  private api: IBApi;
  private config: IbkrConfig;
  private connectionState = IbkrConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelayMs = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextRequestId = 1;
  private readonly onConnectedCallbacks: Array<(api: IBApi) => void> = [];

  constructor(private readonly configService: ConfigService) {
    this.config = {
      host: this.configService.get<string>('IBKR_HOST', '127.0.0.1'),
      port: this.configService.get<number>('IBKR_PORT', 4002),
      clientId: this.configService.get<number>('IBKR_CLIENT_ID', 0),
      marketDataType: this.configService.get<number>('IBKR_MARKET_DATA_TYPE', 3),
    };
  }

  async onModuleInit() {
    this.createApi();
    this.registerEventHandlers();
    await this.connect();
  }

  async onModuleDestroy() {
    this.clearReconnectTimer();
    this.disconnect();
  }

  // --- Connection lifecycle ---

  private createApi() {
    this.api = new IBApi({
      host: this.config.host,
      port: this.config.port,
      clientId: this.config.clientId,
    });

  }

  async connect(): Promise<void> {
    if (this.connectionState === IbkrConnectionState.CONNECTED) {
      this.logger.warn('Already connected to IBKR');
      return;
    }

    this.connectionState = IbkrConnectionState.CONNECTING;
    this.logger.log(
      `Connecting to IBKR at ${this.config.host}:${this.config.port} (clientId: ${this.config.clientId})...`,
    );

    try {
      this.api.connect();
    } catch (error) {
      this.logger.error(`Failed to connect: ${error.message}`);
      this.scheduleReconnect();
    }
  }

  disconnect() {
    if (this.connectionState === IbkrConnectionState.DISCONNECTED) {
      return;
    }
    this.logger.log('Disconnecting from IBKR...');
    try {
      this.api.disconnect();
    } catch (error) {
      this.logger.error(`Error during disconnect: ${error.message}`);
    }
    this.connectionState = IbkrConnectionState.DISCONNECTED;
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`,
      );
      this.connectionState = IbkrConnectionState.DISCONNECTED;
      return;
    }

    this.connectionState = IbkrConnectionState.RECONNECTING;
    const delay =
      this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.logger.log(
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`,
    );

    this.reconnectTimer = setTimeout(async () => {
      this.createApi();
      this.registerEventHandlers();
      await this.connect();
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --- Event handlers ---

  private registerEventHandlers() {
    this.api.on(EventName.connected, () => {
      this.connectionState = IbkrConnectionState.CONNECTED;
      this.reconnectAttempts = 0;
      const mdTypes = { 1: 'live', 2: 'frozen', 3: 'delayed', 4: 'delayed-frozen' };
      this.api.reqMarketDataType(this.config.marketDataType);
      this.logger.log(`Connected to IBKR (market data: ${mdTypes[this.config.marketDataType] || this.config.marketDataType})`);
      this.onConnectedCallbacks.forEach((cb) => cb(this.api));
    });

    this.api.on(EventName.disconnected, () => {
      this.logger.warn('Disconnected from IBKR');
      if (this.connectionState !== IbkrConnectionState.DISCONNECTED) {
        this.connectionState = IbkrConnectionState.DISCONNECTED;
        this.scheduleReconnect();
      }
    });

    this.api.on(EventName.error, (error: Error, code: number, reqId: number) => {
      // Connection-related errors that should trigger reconnect
      if (code === ErrorCode.NOT_CONNECTED || code === 502) {
        this.logger.error(`Connection error (code ${code}): ${error.message}`);
        if (this.connectionState === IbkrConnectionState.CONNECTED) {
          this.connectionState = IbkrConnectionState.DISCONNECTED;
          this.scheduleReconnect();
        }
        return;
      }

      this.logger.error(
        `IBKR error — code: ${code}, reqId: ${reqId}, message: ${error.message}`,
      );
    });

    this.api.on(EventName.currentTime, (time: number) => {
      this.logger.debug(`Server time: ${new Date(time * 1000).toISOString()}`);
    });
  }

  // --- Public API ---

  getApi(): IBApi {
    return this.api;
  }

  onApiConnected(callback: (api: IBApi) => void): void {
    this.onConnectedCallbacks.push(callback);
    if (this.isConnected()) {
      callback(this.api);
    }
  }

  getConnectionState(): IbkrConnectionState {
    return this.connectionState;
  }

  isConnected(): boolean {
    return this.connectionState === IbkrConnectionState.CONNECTED;
  }

  getNextRequestId(): number {
    return this.nextRequestId++;
  }

  async getAccountSummary(): Promise<AccountSummary> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected to IBKR'));
        return;
      }

      const reqId = this.getNextRequestId();
      const summary: Partial<AccountSummary> = {};
      const tags = 'NetLiquidation,BuyingPower,TotalCashValue';

      const timeout = setTimeout(() => {
        this.api.cancelAccountSummary(reqId);
        reject(new Error('Account summary request timed out'));
      }, 10000);

      this.api.on(
        EventName.accountSummary,
        (id: number, account: string, tag: string, value: string, currency: string) => {
          if (id !== reqId) return;
          summary.account = account;
          summary.currency = currency;

          switch (tag) {
            case 'NetLiquidation':
              summary.netLiquidation = parseFloat(value);
              break;
            case 'BuyingPower':
              summary.buyingPower = parseFloat(value);
              break;
            case 'TotalCashValue':
              summary.totalCashValue = parseFloat(value);
              break;
          }
        },
      );

      this.api.on(EventName.accountSummaryEnd, (id: number) => {
        if (id !== reqId) return;
        clearTimeout(timeout);
        resolve(summary as AccountSummary);
      });

      this.api.reqAccountSummary(reqId, 'All', tags);
    });
  }

  async getCurrentTime(): Promise<Date> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected to IBKR'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Current time request timed out'));
      }, 5000);

      this.api.once(EventName.currentTime, (time: number) => {
        clearTimeout(timeout);
        resolve(new Date(time * 1000));
      });

      this.api.reqCurrentTime();
    });
  }
}
