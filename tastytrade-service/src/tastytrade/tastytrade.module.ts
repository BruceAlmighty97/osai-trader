import { Module } from '@nestjs/common';
import { TastytradeService } from './tastytrade.service';
import { TastytradeController } from './tastytrade.controller';

@Module({
  controllers: [TastytradeController],
  providers: [TastytradeService],
  exports: [TastytradeService],
})
export class TastytradeModule {}
