import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PortfolioService } from './portfolio.service';

@ApiTags('Portfolio')
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get full portfolio summary: balances, positions, P&L, greeks' })
  async getSummary() {
    return this.portfolioService.getPortfolioSummary();
  }

  @Get('positions')
  @ApiOperation({ summary: 'Get all current positions' })
  async getPositions() {
    return this.portfolioService.getPositions();
  }

  @Get('pnl')
  @ApiOperation({ summary: 'Get portfolio-level P&L (requires open positions with trade history)' })
  @ApiQuery({ name: 'account', example: 'DUO408075' })
  async getPnL(@Query('account') account: string) {
    try {
      return await this.portfolioService.getPortfolioPnL(account);
    } catch {
      return { dailyPnL: 0, unrealizedPnL: 0, realizedPnL: 0, note: 'No PnL data available — account may have no trade history' };
    }
  }

  @Get('position-pnl')
  @ApiOperation({ summary: 'Get P&L for a specific position by contract ID' })
  @ApiQuery({ name: 'account', example: 'DUO408075' })
  @ApiQuery({ name: 'conId', example: 265598 })
  async getPositionPnL(
    @Query('account') account: string,
    @Query('conId') conId: number,
  ) {
    return this.portfolioService.getPositionPnL(account, +conId);
  }
}
