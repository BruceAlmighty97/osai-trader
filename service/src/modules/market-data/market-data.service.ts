import { Injectable, Logger } from '@nestjs/common';
import { Contract, EventName, OptionType, SecType } from '@stoqey/ib';
import { TickType } from '@stoqey/ib/dist/api/market/tickType';
import { IbkrService } from '../ibkr/ibkr.service';
import {
  Quote,
  OptionGreeks,
  OptionChainParams,
  MarketDataRequest,
  MarketDataSnapshot,
} from './market-data.types';

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(private readonly ibkrService: IbkrService) {}

  async getQuoteSnapshot(request: MarketDataRequest): Promise<MarketDataSnapshot> {
    const api = this.ibkrService.getApi();
    const reqId = this.ibkrService.getNextRequestId();

    const contract: Contract = {
      symbol: request.symbol,
      secType: (request.secType as SecType) || SecType.STK,
      exchange: request.exchange || 'SMART',
      currency: request.currency || 'USD',
    };

    return new Promise((resolve, reject) => {
      const snapshot: Partial<MarketDataSnapshot> = {
        symbol: request.symbol,
        timestamp: new Date(),
      };

      const timeout = setTimeout(() => {
        api.cancelMktData(reqId);
        cleanup();
        // Resolve with whatever we have — snapshots may not fill all fields
        resolve(this.fillDefaults(snapshot));
      }, 10000);

      const onTickPrice = (id: number, field: number, value: number) => {
        if (id !== reqId) return;
        switch (field) {
          case TickType.BID:
          case TickType.DELAYED_BID: snapshot.bidPrice = value; break;
          case TickType.ASK:
          case TickType.DELAYED_ASK: snapshot.askPrice = value; break;
          case TickType.LAST:
          case TickType.DELAYED_LAST: snapshot.lastPrice = value; break;
          case TickType.HIGH:
          case TickType.DELAYED_HIGH: snapshot.high = value; break;
          case TickType.LOW:
          case TickType.DELAYED_LOW: snapshot.low = value; break;
          case TickType.CLOSE:
          case TickType.DELAYED_CLOSE: snapshot.close = value; break;
        }
      };

      const onTickSize = (id: number, field: number, value: number) => {
        if (id !== reqId) return;
        switch (field) {
          case TickType.BID_SIZE:
          case TickType.DELAYED_BID_SIZE: snapshot.bidSize = value; break;
          case TickType.ASK_SIZE:
          case TickType.DELAYED_ASK_SIZE: snapshot.askSize = value; break;
          case TickType.VOLUME:
          case TickType.DELAYED_VOLUME: snapshot.volume = value; break;
        }
      };

      const onTickOption = (
        id: number,
        field: number,
        impliedVolatility?: number,
        delta?: number,
        optPrice?: number,
        pvDividend?: number,
        gamma?: number,
        vega?: number,
        theta?: number,
        undPrice?: number,
      ) => {
        if (id !== reqId) return;
        snapshot.greeks = {
          impliedVolatility: impliedVolatility ?? 0,
          delta: delta ?? 0,
          gamma: gamma ?? 0,
          theta: theta ?? 0,
          vega: vega ?? 0,
          optionPrice: optPrice ?? 0,
          underlyingPrice: undPrice ?? 0,
        };
      };

      const onSnapshotEnd = (id: number) => {
        if (id !== reqId) return;
        clearTimeout(timeout);
        cleanup();
        resolve(this.fillDefaults(snapshot));
      };

      const cleanup = () => {
        api.removeListener(EventName.tickPrice, onTickPrice);
        api.removeListener(EventName.tickSize, onTickSize);
        api.removeListener(EventName.tickOptionComputation, onTickOption);
        api.removeListener(EventName.tickSnapshotEnd, onSnapshotEnd);
      };

      api.on(EventName.tickPrice, onTickPrice);
      api.on(EventName.tickSize, onTickSize as any);
      api.on(EventName.tickOptionComputation, onTickOption);
      api.on(EventName.tickSnapshotEnd, onSnapshotEnd);

      // Use streaming mode (snapshot=false) — required for delayed market data.
      // Timeout resolves with whatever ticks arrived; we cancel the subscription on resolve.
      api.reqMktData(reqId, contract, '', false, false);
    });
  }

  async getOptionChainParams(symbol: string): Promise<OptionChainParams[]> {
    const api = this.ibkrService.getApi();
    const reqId = this.ibkrService.getNextRequestId();

    // First, get the contract details to find the conId
    const conId = await this.getConId(symbol);

    return new Promise((resolve, reject) => {
      const chains: OptionChainParams[] = [];

      const timeout = setTimeout(() => {
        reject(new Error(`Option chain params request timed out for ${symbol}`));
      }, 15000);

      api.on(
        EventName.securityDefinitionOptionParameter,
        (
          id: number,
          exchange: string,
          underlyingConId: number,
          tradingClass: string,
          multiplier: string,
          expirations: string[],
          strikes: number[],
        ) => {
          if (id !== reqId) return;
          chains.push({
            exchange,
            underlyingConId,
            tradingClass,
            multiplier,
            expirations,
            strikes,
          });
        },
      );

      api.on(EventName.securityDefinitionOptionParameterEnd, (id: number) => {
        if (id !== reqId) return;
        clearTimeout(timeout);
        resolve(chains);
      });

      api.reqSecDefOptParams(reqId, symbol, '', 'STK', conId);
    });
  }

  async getOptionQuote(
    symbol: string,
    expiration: string,
    strike: number,
    right: 'C' | 'P',
  ): Promise<MarketDataSnapshot> {
    const contract: Contract = {
      symbol,
      secType: SecType.OPT,
      exchange: 'SMART',
      currency: 'USD',
      lastTradeDateOrContractMonth: expiration,
      strike,
      right: right === 'C' ? OptionType.Call : OptionType.Put,
      multiplier: 100,
    };

    const api = this.ibkrService.getApi();
    const reqId = this.ibkrService.getNextRequestId();

    return new Promise((resolve, reject) => {
      const snapshot: Partial<MarketDataSnapshot> = {
        symbol: `${symbol} ${expiration} ${strike}${right}`,
        timestamp: new Date(),
      };

      const timeout = setTimeout(() => {
        api.cancelMktData(reqId);
        cleanup();
        resolve(this.fillDefaults(snapshot));
      }, 10000);

      const onTickPrice = (id: number, field: number, value: number) => {
        if (id !== reqId) return;
        switch (field) {
          case TickType.BID:
          case TickType.DELAYED_BID: snapshot.bidPrice = value; break;
          case TickType.ASK:
          case TickType.DELAYED_ASK: snapshot.askPrice = value; break;
          case TickType.LAST:
          case TickType.DELAYED_LAST: snapshot.lastPrice = value; break;
          case TickType.HIGH:
          case TickType.DELAYED_HIGH: snapshot.high = value; break;
          case TickType.LOW:
          case TickType.DELAYED_LOW: snapshot.low = value; break;
          case TickType.CLOSE:
          case TickType.DELAYED_CLOSE: snapshot.close = value; break;
        }
      };

      const onTickSize = (id: number, field: number, value: number) => {
        if (id !== reqId) return;
        switch (field) {
          case TickType.BID_SIZE:
          case TickType.DELAYED_BID_SIZE: snapshot.bidSize = value; break;
          case TickType.ASK_SIZE:
          case TickType.DELAYED_ASK_SIZE: snapshot.askSize = value; break;
          case TickType.VOLUME:
          case TickType.DELAYED_VOLUME: snapshot.volume = value; break;
        }
      };

      const onTickOption = (
        id: number,
        field: number,
        impliedVolatility?: number,
        delta?: number,
        optPrice?: number,
        pvDividend?: number,
        gamma?: number,
        vega?: number,
        theta?: number,
        undPrice?: number,
      ) => {
        if (id !== reqId) return;
        snapshot.greeks = {
          impliedVolatility: impliedVolatility ?? 0,
          delta: delta ?? 0,
          gamma: gamma ?? 0,
          theta: theta ?? 0,
          vega: vega ?? 0,
          optionPrice: optPrice ?? 0,
          underlyingPrice: undPrice ?? 0,
        };
      };

      const onSnapshotEnd = (id: number) => {
        if (id !== reqId) return;
        clearTimeout(timeout);
        cleanup();
        resolve(this.fillDefaults(snapshot));
      };

      const cleanup = () => {
        api.removeListener(EventName.tickPrice, onTickPrice);
        api.removeListener(EventName.tickSize, onTickSize);
        api.removeListener(EventName.tickOptionComputation, onTickOption);
        api.removeListener(EventName.tickSnapshotEnd, onSnapshotEnd);
      };

      api.on(EventName.tickPrice, onTickPrice);
      api.on(EventName.tickSize, onTickSize as any);
      api.on(EventName.tickOptionComputation, onTickOption);
      api.on(EventName.tickSnapshotEnd, onSnapshotEnd);

      api.reqMktData(reqId, contract, '', true, false);
    });
  }

  private async getConId(symbol: string): Promise<number> {
    const api = this.ibkrService.getApi();
    const reqId = this.ibkrService.getNextRequestId();

    const contract: Contract = {
      symbol,
      secType: SecType.STK,
      exchange: 'SMART',
      currency: 'USD',
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Contract details request timed out for ${symbol}`));
      }, 10000);

      api.on(EventName.contractDetails, (id: number, details: any) => {
        if (id !== reqId) return;
        clearTimeout(timeout);
        resolve(details.contract.conId);
      });

      api.on(EventName.contractDetailsEnd, (id: number) => {
        if (id !== reqId) return;
        clearTimeout(timeout);
        reject(new Error(`No contract found for ${symbol}`));
      });

      api.reqContractDetails(reqId, contract);
    });
  }

  private fillDefaults(snapshot: Partial<MarketDataSnapshot>): MarketDataSnapshot {
    return {
      symbol: snapshot.symbol || '',
      bidPrice: snapshot.bidPrice ?? -1,
      askPrice: snapshot.askPrice ?? -1,
      lastPrice: snapshot.lastPrice ?? -1,
      bidSize: snapshot.bidSize ?? 0,
      askSize: snapshot.askSize ?? 0,
      volume: snapshot.volume ?? 0,
      high: snapshot.high ?? -1,
      low: snapshot.low ?? -1,
      close: snapshot.close ?? -1,
      timestamp: snapshot.timestamp || new Date(),
      greeks: snapshot.greeks,
    };
  }
}
