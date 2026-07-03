import { Injectable, Logger } from '@nestjs/common';
import { Contract, EventName } from '@stoqey/ib';
import { IbkrService } from '../ibkr/ibkr.service';
import {
  Position,
  PortfolioPnL,
  PositionPnL,
  PortfolioGreeks,
  PortfolioSummary,
} from './portfolio.types';

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(private readonly ibkrService: IbkrService) {}

  async getPositions(): Promise<Position[]> {
    const api = this.ibkrService.getApi();

    return new Promise((resolve, reject) => {
      if (!this.ibkrService.isConnected()) {
        reject(new Error('Not connected to IBKR'));
        return;
      }

      const positions: Position[] = [];

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Positions request timed out'));
      }, 15000);

      const onPosition = (
        account: string,
        contract: Contract,
        pos: number,
        avgCost: number,
      ) => {
        if (pos === 0) return; // Skip zero-quantity positions

        positions.push({
          account,
          symbol: contract.symbol || '',
          secType: contract.secType || '',
          exchange: contract.exchange || 'SMART',
          currency: contract.currency || 'USD',
          quantity: pos,
          avgCost,
          expiration: contract.lastTradeDateOrContractMonth,
          strike: contract.strike,
          right: contract.right as 'C' | 'P' | undefined,
          multiplier: contract.multiplier?.toString(),
          conId: contract.conId ?? 0,
        });
      };

      const onPositionEnd = () => {
        clearTimeout(timeout);
        cleanup();
        resolve(positions);
      };

      const cleanup = () => {
        api.removeListener(EventName.position, onPosition);
        api.removeListener(EventName.positionEnd, onPositionEnd);
      };

      api.on(EventName.position, onPosition);
      api.on(EventName.positionEnd, onPositionEnd);

      api.reqPositions();
    });
  }

  async getPortfolioPnL(account: string): Promise<PortfolioPnL> {
    const api = this.ibkrService.getApi();
    const reqId = this.ibkrService.getNextRequestId();

    return new Promise((resolve, reject) => {
      if (!this.ibkrService.isConnected()) {
        reject(new Error('Not connected to IBKR'));
        return;
      }

      const timeout = setTimeout(() => {
        api.cancelPnL(reqId);
        reject(new Error('PnL request timed out'));
      }, 10000);

      api.on(
        EventName.pnl,
        (id: number, dailyPnL: number, unrealizedPnL?: number, realizedPnL?: number) => {
          if (id !== reqId) return;
          clearTimeout(timeout);
          api.cancelPnL(reqId);
          resolve({
            dailyPnL,
            unrealizedPnL: unrealizedPnL ?? 0,
            realizedPnL: realizedPnL ?? 0,
          });
        },
      );

      api.reqPnL(reqId, account);
    });
  }

  async getPositionPnL(account: string, conId: number): Promise<PositionPnL> {
    const api = this.ibkrService.getApi();
    const reqId = this.ibkrService.getNextRequestId();

    return new Promise((resolve, reject) => {
      if (!this.ibkrService.isConnected()) {
        reject(new Error('Not connected to IBKR'));
        return;
      }

      const timeout = setTimeout(() => {
        api.cancelPnLSingle(reqId);
        reject(new Error('Position PnL request timed out'));
      }, 10000);

      api.on(
        EventName.pnlSingle,
        (
          id: number,
          pos: number,
          dailyPnL: number,
          unrealizedPnL: number | undefined,
          realizedPnL: number | undefined,
          value: number,
        ) => {
          if (id !== reqId) return;
          clearTimeout(timeout);
          api.cancelPnLSingle(reqId);
          resolve({
            conId,
            position: pos,
            dailyPnL,
            unrealizedPnL: unrealizedPnL ?? 0,
            realizedPnL: realizedPnL ?? 0,
            marketValue: value,
          });
        },
      );

      api.reqPnLSingle(reqId, account, null, conId);
    });
  }

  async getPortfolioSummary(): Promise<PortfolioSummary> {
    const [accountSummary, positions] = await Promise.all([
      this.ibkrService.getAccountSummary(),
      this.getPositions(),
    ]);

    let pnl: PortfolioPnL = { dailyPnL: 0, unrealizedPnL: 0, realizedPnL: 0 };
    try {
      pnl = await this.getPortfolioPnL(accountSummary.account);
    } catch (error) {
      this.logger.warn(`Could not fetch PnL: ${error.message}`);
    }

    // Aggregate greeks from option positions would require market data subscriptions
    // For now, return zeroed greeks — will be populated when we integrate with market data
    const greeks: PortfolioGreeks = {
      totalDelta: 0,
      totalGamma: 0,
      totalTheta: 0,
      totalVega: 0,
    };

    return {
      account: accountSummary.account,
      netLiquidation: accountSummary.netLiquidation,
      buyingPower: accountSummary.buyingPower,
      totalCashValue: accountSummary.totalCashValue,
      currency: accountSummary.currency,
      pnl,
      positions,
      greeks,
    };
  }
}
