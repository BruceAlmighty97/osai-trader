import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IbkrModule } from '../ibkr/ibkr.module';
import { RiskManagementModule } from '../risk-management/risk-management.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { OrderEntity } from './order.entity';
import { OrderManagementService } from './order-management.service';
import { OrderManagementController } from './order-management.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderEntity]),
    IbkrModule,
    RiskManagementModule,
    PortfolioModule,
  ],
  controllers: [OrderManagementController],
  providers: [OrderManagementService],
  exports: [OrderManagementService],
})
export class OrderManagementModule {}
