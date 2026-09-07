import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FinnhubClient } from './finnhub.client';

@ApiTags('finnhub')
@Controller('finnhub')
export class FinnhubController {
  constructor(private readonly finnhub: FinnhubClient) {}

  /**
   * Which symbols report within N days — the pre-market earnings exclusion.
   * Defaults to the current watchlist universe when no symbols are given.
   */
  @Get('earnings')
  @ApiOperation({ summary: 'Upcoming earnings for symbols (the earnings gate)' })
  @ApiQuery({ name: 'symbols', required: false, description: 'comma-separated' })
  @ApiQuery({ name: 'days', required: false, example: '45' })
  async earnings(
    @Query('symbols') symbols?: string,
    @Query('days') days?: string,
  ): Promise<Record<string, unknown>> {
    if (!this.finnhub.isConfigured()) {
      return { configured: false, error: 'FINNHUB_API_KEY not set' };
    }
    const list = (symbols ?? 'SPY,QQQ,IWM,GLD,TLT,XLE,GDX,SLV')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const window = days ? parseInt(days, 10) : 45;
    try {
      const found = await this.finnhub.earningsWithin(list, window);
      return {
        configured: true,
        days: window,
        checked: list,
        reporting: Object.fromEntries(found),
      };
    } catch (err) {
      return {
        configured: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
