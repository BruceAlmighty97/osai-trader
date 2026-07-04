import { Module } from '@nestjs/common';
import { TastytradeModule } from '../tastytrade/tastytrade.module';
import { StrategyService } from './strategy.service';
import { StrategyController } from './strategy.controller';

@Module({
  imports: [TastytradeModule],
  controllers: [StrategyController],
  providers: [StrategyService],
})
export class StrategyModule {}
