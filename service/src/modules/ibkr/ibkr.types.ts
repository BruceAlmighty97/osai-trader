export interface IbkrConfig {
  host: string;
  port: number;
  clientId: number;
  marketDataType: number;
}

export enum IbkrConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
}

export interface AccountSummary {
  account: string;
  netLiquidation: number;
  buyingPower: number;
  totalCashValue: number;
  currency: string;
}
