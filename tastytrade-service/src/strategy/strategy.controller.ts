import { Controller, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StrategyService } from './strategy.service';

@ApiTags('strategy (experimental)')
@Controller('strategy')
export class StrategyController {
  constructor(private readonly strategy: StrategyService) {}

  /**
   * Call with a symbol; the AI reads the live price/chain/greeks snapshot and
   * suggests one options strategy. Suggestion only — places nothing.
   */
  @Post('suggest')
  @ApiOperation({
    summary:
      'AI suggests an options strategy for a symbol from the live chain + greeks (suggestion only)',
  })
  @ApiQuery({ name: 'symbol', required: false, example: 'SPY' })
  @ApiQuery({ name: 'dte', required: false, example: '35' })
  async suggest(
    @Query('symbol') symbol = 'SPY',
    @Query('dte') dte = '35',
  ): Promise<Record<string, unknown>> {
    return this.strategy.suggest(symbol.toUpperCase(), parseInt(dte, 10));
  }
}
