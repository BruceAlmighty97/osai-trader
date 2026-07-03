import Anthropic from '@anthropic-ai/sdk';
import { MarketDataService } from '../market-data/market-data.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { OrderManagementService } from '../order-management/order-management.service';
import { RiskManagementService } from '../risk-management/risk-management.service';
import { IbkrService } from '../ibkr/ibkr.service';
import { TradeSecType, TradeAction, TradeOrderType } from '../order-management/order.types';

export interface AgentToolDeps {
  marketData: MarketDataService;
  portfolio: PortfolioService;
  orders: OrderManagementService;
  risk: RiskManagementService;
  ibkr: IbkrService;
}

type ToolExecutor = (input: Record<string, unknown>) => Promise<unknown>;

const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'get_market_quote',
    description:
      'Get current price data (bid, ask, last, volume, high, low, close) for a stock or ETF.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol, e.g. SPY' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_options_chain',
    description:
      'Get available expirations and strikes for an underlying symbol. Returns arrays of expiration dates and strike prices.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Underlying ticker symbol' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_option_quote',
    description:
      'Get price and greeks (IV, delta, gamma, theta, vega) for a specific option contract.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Underlying ticker symbol' },
        expiration: {
          type: 'string',
          description: 'Expiration date in YYYYMMDD format',
        },
        strike: { type: 'number', description: 'Strike price' },
        right: {
          type: 'string',
          enum: ['C', 'P'],
          description: 'C for call, P for put',
        },
      },
      required: ['symbol', 'expiration', 'strike', 'right'],
    },
  },
  {
    name: 'get_portfolio_summary',
    description:
      'Get current portfolio state: account balance, buying power, cash, positions with details, and daily P&L.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_open_orders',
    description: 'Get all currently open/pending orders.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'evaluate_risk',
    description:
      'Pre-check a proposed trade against risk limits without executing. Returns approved/rejected with violation details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        positionSize: {
          type: 'number',
          description: 'Number of contracts or shares',
        },
        notionalValue: {
          type: 'number',
          description:
            'Total notional value of the trade (quantity * price * multiplier)',
        },
      },
      required: ['positionSize', 'notionalValue'],
    },
  },
  {
    name: 'submit_order',
    description:
      'Submit a single order leg to IBKR. For spreads, submit each leg separately — long (protective) leg first, then short leg.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol' },
        secType: {
          type: 'string',
          enum: ['STK', 'OPT'],
          description: 'Security type: STK for stock, OPT for option',
        },
        action: {
          type: 'string',
          enum: ['BUY', 'SELL'],
          description: 'Buy or sell',
        },
        quantity: {
          type: 'number',
          description: 'Number of contracts or shares',
        },
        orderType: {
          type: 'string',
          enum: ['LMT', 'MKT'],
          description: 'Order type',
        },
        limitPrice: {
          type: 'number',
          description: 'Limit price (required for LMT orders)',
        },
        expiration: {
          type: 'string',
          description: 'Option expiration YYYYMMDD (required for options)',
        },
        strike: {
          type: 'number',
          description: 'Strike price (required for options)',
        },
        right: {
          type: 'string',
          enum: ['C', 'P'],
          description: 'C for call, P for put (required for options)',
        },
      },
      required: ['symbol', 'secType', 'action', 'quantity', 'orderType'],
    },
  },
];

function createToolExecutors(deps: AgentToolDeps): Record<string, ToolExecutor> {
  return {
    get_market_quote: async (input) => {
      const snapshot = await deps.marketData.getQuoteSnapshot({
        symbol: input.symbol as string,
      });
      return {
        symbol: snapshot.symbol,
        bidPrice: snapshot.bidPrice,
        askPrice: snapshot.askPrice,
        lastPrice: snapshot.lastPrice,
        volume: snapshot.volume,
        high: snapshot.high,
        low: snapshot.low,
        close: snapshot.close,
      };
    },

    get_options_chain: async (input) => {
      const chains = await deps.marketData.getOptionChainParams(
        input.symbol as string,
      );
      const smartChain = chains.find((c) => c.exchange === 'SMART') || chains[0];
      if (!smartChain) {
        return { error: 'No options chain found for this symbol' };
      }
      return {
        exchange: smartChain.exchange,
        expirations: smartChain.expirations,
        strikes: smartChain.strikes,
      };
    },

    get_option_quote: async (input) => {
      const snapshot = await deps.marketData.getOptionQuote(
        input.symbol as string,
        input.expiration as string,
        input.strike as number,
        input.right as 'C' | 'P',
      );
      return {
        symbol: snapshot.symbol,
        bidPrice: snapshot.bidPrice,
        askPrice: snapshot.askPrice,
        lastPrice: snapshot.lastPrice,
        greeks: snapshot.greeks
          ? {
              impliedVolatility: snapshot.greeks.impliedVolatility,
              delta: snapshot.greeks.delta,
              gamma: snapshot.greeks.gamma,
              theta: snapshot.greeks.theta,
              vega: snapshot.greeks.vega,
              underlyingPrice: snapshot.greeks.underlyingPrice,
            }
          : null,
      };
    },

    get_portfolio_summary: async () => {
      return await deps.portfolio.getPortfolioSummary();
    },

    get_open_orders: async () => {
      return await deps.orders.getOpenOrders();
    },

    evaluate_risk: async (input) => {
      const positions = await deps.portfolio.getPositions();
      const account = await deps.ibkr.getAccountSummary();
      return await deps.risk.validateTrade({
        positionSize: input.positionSize as number,
        notionalValue: input.notionalValue as number,
        currentOpenPositions: positions.length,
        portfolioDelta: 0,
        portfolioGamma: 0,
        buyingPowerUsage: 0,
        marginUsage: 0,
        dailyLoss: 0,
        weeklyLoss: 0,
        dataAgeSeconds: 0,
      });
    },

    submit_order: async (input) => {
      const order = await deps.orders.submitOrder({
        symbol: input.symbol as string,
        secType: input.secType as TradeSecType,
        action: input.action as TradeAction,
        quantity: input.quantity as number,
        orderType: input.orderType as TradeOrderType,
        limitPrice: input.limitPrice as number | undefined,
        expiration: input.expiration as string | undefined,
        strike: input.strike as number | undefined,
        right: input.right as 'C' | 'P' | undefined,
      });
      return {
        orderId: order.orderId,
        symbol: order.symbol,
        action: order.action,
        quantity: order.quantity,
        orderType: order.orderType,
        limitPrice: order.limitPrice,
        status: order.status,
      };
    },
  };
}

export function createAgentTools(deps: AgentToolDeps) {
  const executors = createToolExecutors(deps);
  return {
    definitions: toolDefinitions,
    execute: async (
      toolName: string,
      toolInput: Record<string, unknown>,
    ): Promise<unknown> => {
      const executor = executors[toolName];
      if (!executor) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      return executor(toolInput);
    },
  };
}
