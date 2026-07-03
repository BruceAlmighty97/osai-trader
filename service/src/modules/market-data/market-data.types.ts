export interface Quote {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  bidSize: number;
  askSize: number;
  volume: number;
  high: number;
  low: number;
  close: number;
  timestamp: Date;
}

export interface OptionGreeks {
  impliedVolatility: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  optionPrice: number;
  underlyingPrice: number;
}

export interface OptionChainParams {
  exchange: string;
  underlyingConId: number;
  tradingClass: string;
  multiplier: string;
  expirations: string[];
  strikes: number[];
}

export interface OptionContract {
  symbol: string;
  expiration: string;
  strike: number;
  right: 'C' | 'P';
  exchange: string;
  multiplier: string;
}

export interface OptionChainRequest {
  symbol: string;
  exchange?: string;
}

export interface MarketDataRequest {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
}

export interface MarketDataSnapshot extends Quote {
  greeks?: OptionGreeks;
}
