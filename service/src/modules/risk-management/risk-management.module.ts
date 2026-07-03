import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskConfigEntity } from './risk-config.entity';
import { RiskManagementService } from './risk-management.service';
import { RiskManagementController } from './risk-management.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RiskConfigEntity])],
  controllers: [RiskManagementController],
  providers: [RiskManagementService],
  exports: [RiskManagementService],
})
export class RiskManagementModule {}
