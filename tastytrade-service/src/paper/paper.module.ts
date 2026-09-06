import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaperAccountEntity } from './paper-account.entity';
import { PositionEntity } from '../persistence/entities/position.entity';
import { PaperService } from './paper.service';
import { PaperController } from './paper.controller';
import { RiskModule } from '../risk/risk.module';

/** Imaginary account: virtual $2500 portfolio tracked in Postgres, no broker. */
@Module({
  imports: [
    TypeOrmModule.forFeature([PaperAccountEntity, PositionEntity]),
    RiskModule,
  ],
  controllers: [PaperController],
  providers: [PaperService],
  exports: [PaperService],
})
export class PaperModule {}
