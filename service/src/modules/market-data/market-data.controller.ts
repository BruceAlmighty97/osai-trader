import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MarketDataService } from './market-data.service';

@ApiTags('Market Data')
@Controller('market-data')
export class MarketDataController {
  constructor(private readonly marketDataService: MarketDataService) {}

  @Get('quote')
  @ApiOperation({ summary: 'Get a market data snapshot for a stock symbol' })
  @ApiQuery({ name: 'symbol', example: 'SPY' })
  @ApiQuery({ name: 'secType', required: false, example: 'STK' })
  @ApiQuery({ name: 'exchange', required: false, example: 'SMART' })
  async getQuote(
    @Query('symbol') symbol: string,
    @Query('secType') secType?: string,
    @Query('exchange') exchange?: string,
  ) {
    return this.marketDataService.getQuoteSnapshot({ symbol, secType, exchange });
  }

  @Get('option-chain')
  @ApiOperation({ summary: 'Get available expirations and strikes for an options chain' })
  @ApiQuery({ name: 'symbol', example: 'SPY' })
  async getOptionChain(@Query('symbol') symbol: string) {
    return this.marketDataService.getOptionChainParams(symbol);
  }

  @Get('option-quote')
  @ApiOperation({ summary: 'Get a quote with greeks for a specific option contract' })
  @ApiQuery({ name: 'symbol', example: 'SPY' })
  @ApiQuery({ name: 'expiration', example: '20260417', description: 'YYYYMMDD format' })
  @ApiQuery({ name: 'strike', example: 655 })
  @ApiQuery({ name: 'right', enum: ['C', 'P'], example: 'C' })
  async getOptionQuote(
    @Query('symbol') symbol: string,
    @Query('expiration') expiration: string,
    @Query('strike') strike: number,
    @Query('right') right: 'C' | 'P',
  ) {
    return this.marketDataService.getOptionQuote(symbol, expiration, +strike, right);
  }
}
