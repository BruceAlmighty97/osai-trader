import { Controller, Get, Query } from '@nestjs/common';
import { BarSizeSetting, Contract, EventName, SecType } from '@stoqey/ib';
import { AppService } from './app.service';
import { IbkrService } from './modules/ibkr/ibkr.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly ibkr: IbkrService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Bare-metal diagnostic: no service, no abstraction — ask IBKR directly for the
  // last ~10 daily bars of a symbol. Historical data works even when the market is
  // closed (weekends/holidays), so this proves the data pipe end-to-end.
  @Get('get-tesla-data')
  async getTeslaData(
    @Query('symbol') symbol = 'TSLA',
  ): Promise<Record<string, unknown>> {
    const api = this.ibkr.getApi();
    const reqId = this.ibkr.getNextRequestId();

    const contract: Contract = {
      symbol: (symbol || 'TSLA').toUpperCase(),
      secType: SecType.STK,
      exchange: 'SMART',
      currency: 'USD',
    };

    return new Promise((resolve) => {
      const bars: Array<{
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }> = [];
      const errors: Array<{ code: number; message: string }> = [];

      const onBar = (
        id: number,
        time: string,
        open: number,
        high: number,
        low: number,
        close: number,
        volume: number,
      ) => {
        if (id !== reqId) return;
        // the final bar is signalled with a time string starting "finished"
        if (typeof time === 'string' && time.startsWith('finished')) {
          finish();
          return;
        }
        bars.push({ date: time, open, high, low, close, volume });
      };

      const onError = (err: Error, code: number, id: number) => {
        if (id !== reqId) return;
        errors.push({ code, message: err.message });
      };

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        api.removeListener(EventName.historicalData, onBar);
        api.removeListener(EventName.error, onError);
        const latest = bars[bars.length - 1];
        resolve({
          reqId,
          connected: this.ibkr.isConnected(),
          contract,
          barCount: bars.length,
          latestClose: latest ? latest.close : null,
          latestBar: latest ?? null,
          bars,
          errors,
        });
      };

      api.on(EventName.historicalData, onBar);
      api.on(EventName.error, onError);

      // last ~10 daily bars, regular trading hours, actual trades
      api.reqHistoricalData(
        reqId,
        contract,
        '',
        '10 D',
        BarSizeSetting.DAYS_ONE,
        'TRADES',
        1,
        1,
        false,
      );

      // safety net in case IBKR never sends the "finished" marker
      setTimeout(finish, 12000);
    });
  }
}
