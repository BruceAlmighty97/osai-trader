export interface Position {
  account: string;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  quantity: number;
  avgCost: number;
  // Options-specific fields
  expiration?: string;
  strike?: number;
  right?: 'C' | 'P';
  multiplier?: string;
  conId: number;
}

export interface PortfolioPnL {
  dailyPnL: number;
  unrealizedPnL: number;
  realizedPnL: number;
}

export interface PositionPnL {
  conId: number;
  position: number;
  dailyPnL: number;
  unrealizedPnL: number;
  realizedPnL: number;
  marketValue: number;
}

export interface PortfolioGreeks {
  totalDelta: number;
  totalGamma: number;
  totalTheta: number;
  totalVega: number;
}

export interface PortfolioSummary {
  account: string;
  netLiquidation: number;
  buyingPower: number;
  totalCashValue: number;
  currency: string;
  pnl: PortfolioPnL;
  positions: Position[];
  greeks: PortfolioGreeks;
}
