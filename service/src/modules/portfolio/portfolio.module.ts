import { Module } from '@nestjs/common';
import { IbkrModule } from '../ibkr/ibkr.module';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';

@Module({
  imports: [IbkrModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
