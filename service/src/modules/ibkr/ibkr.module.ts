import { Module } from '@nestjs/common';
import { IbkrService } from './ibkr.service';
import { IbkrController } from './ibkr.controller';

@Module({
  controllers: [IbkrController],
  providers: [IbkrService],
  exports: [IbkrService],
})
export class IbkrModule {}
