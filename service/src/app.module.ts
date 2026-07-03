import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MarketDataModule } from './modules/market-data/market-data.module';
import { StrategyEngineModule } from './modules/strategy-engine/strategy-engine.module';
import { OrderManagementModule } from './modules/order-management/order-management.module';
import { RiskManagementModule } from './modules/risk-management/risk-management.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { IbkrModule } from './modules/ibkr/ibkr.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>('NODE_ENV') === 'production';
        return {
          type: 'postgres' as const,
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 5432),
          username: config.get<string>('DB_USERNAME', 'osaitrader'),
          password: config.get<string>('DB_PASSWORD', 'osaitrader_dev'),
          database: config.get<string>('DB_NAME', 'osaitrader'),
          autoLoadEntities: true,
          synchronize: !isProduction, // Auto-sync in dev, migrations in production
          migrationsRun: isProduction, // Auto-run pending migrations on startup in production
          migrations: isProduction ? ['dist/migrations/*.js'] : [],
        };
      },
    }),
    IbkrModule,
    MarketDataModule,
    StrategyEngineModule,
    OrderManagementModule,
    RiskManagementModule,
    PortfolioModule,
    SchedulingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
