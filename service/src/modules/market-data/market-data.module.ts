import { Module } from '@nestjs/common';
import { IbkrModule } from '../ibkr/ibkr.module';
import { MarketDataService } from './market-data.service';
import { MarketDataController } from './market-data.controller';

@Module({
  imports: [IbkrModule],
  controllers: [MarketDataController],
  providers: [MarketDataService],
  exports: [MarketDataService],
})
export class MarketDataModule {}
