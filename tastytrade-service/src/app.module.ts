import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TastytradeModule } from './tastytrade/tastytrade.module';
import { StrategyModule } from './strategy/strategy.module';
import { PersistenceModule } from './persistence/persistence.module';
import { SocialModule } from './social/social.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PaperModule } from './paper/paper.module';
import { RiskModule } from './risk/risk.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
      }),
    }),
    AuthModule,
    HealthModule,
    RiskModule,
    PaperModule,
    TastytradeModule,
    StrategyModule,
    PersistenceModule,
    SocialModule,
  ],
})
export class AppModule {}
