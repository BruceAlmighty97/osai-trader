import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggingInterceptor } from './common/logging.interceptor';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ResearchAgentModule } from './research-agent/research-agent.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TastytradeModule } from './tastytrade/tastytrade.module';
import { StrategyModule } from './strategy/strategy.module';
import { PersistenceModule } from './persistence/persistence.module';
import { SocialModule } from './social/social.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PaperModule } from './paper/paper.module';
import { RiskModule } from './risk/risk.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { TradingModule } from './trading/trading.module';
import { FinnhubModule } from './finnhub/finnhub.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME', 'osaitrader'),
        password: config.get<string>('DB_PASSWORD', 'osaitrader_dev'),
        database: config.get<string>('DB_NAME', 'osaitrader'),
        autoLoadEntities: true,
        // RDS enforces TLS (rds.force_ssl) but we don't ship the RDS CA bundle,
        // so encrypt without verifying the server cert.
        ssl:
          config.get<string>('DB_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : undefined,
        // Migrations-only: never auto-sync schema (avoids silent data loss).
        synchronize: false,
        migrationsRun: config.get<string>('NODE_ENV') === 'production',
        migrations: ['dist/migrations/*.js'],
        // Log every SQL statement when DB_LOGGING=true (noisy; off by default).
        logging: config.get<string>('DB_LOGGING') === 'true',
      }),
    }),
    AuthModule,
    HealthModule,
    OrchestratorModule,
    TradingModule,
    FinnhubModule,
    RiskModule,
    PaperModule,
    TastytradeModule,
    StrategyModule,
    PersistenceModule,
    SocialModule,
    ResearchAgentModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }],
})
export class AppModule {}
