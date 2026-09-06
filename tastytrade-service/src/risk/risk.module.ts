import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskConfigEntity } from './risk-config.entity';
import { RiskService } from './risk.service';
import { RiskController } from './risk.controller';

/** Shared, account-agnostic risk gate (used by paper now, live later). */
@Module({
  imports: [TypeOrmModule.forFeature([RiskConfigEntity])],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
