import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TastytradeModule } from './tastytrade/tastytrade.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TastytradeModule,
  ],
})
export class AppModule {}
