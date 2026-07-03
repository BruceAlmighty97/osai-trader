import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IbkrModule } from '../ibkr/ibkr.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { OrderManagementModule } from '../order-management/order-management.module';
import { RiskManagementModule } from '../risk-management/risk-management.module';
import { StrategyEngineService } from './strategy-engine.service';
import { StrategyEngineController } from './strategy-engine.controller';
import { StrategyDecisionEntity } from './strategy-decision.entity';
import { StrategyToolCallEntity } from './strategy-tool-call.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([StrategyDecisionEntity, StrategyToolCallEntity]),
    IbkrModule,
    MarketDataModule,
    PortfolioModule,
    OrderManagementModule,
    RiskManagementModule,
  ],
  controllers: [StrategyEngineController],
  providers: [StrategyEngineService],
  exports: [StrategyEngineService],
})
export class StrategyEngineModule {}
