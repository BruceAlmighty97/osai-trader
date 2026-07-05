import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TastytradeModule } from './tastytrade/tastytrade.module';
import { StrategyModule } from './strategy/strategy.module';
import { PersistenceModule } from './persistence/persistence.module';
import { SocialModule } from './social/social.module';

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
        // Migrations-only: never auto-sync schema (avoids silent data loss).
        synchronize: false,
        migrationsRun: config.get<string>('NODE_ENV') === 'production',
        migrations: ['dist/migrations/*.js'],
      }),
    }),
    TastytradeModule,
    StrategyModule,
    PersistenceModule,
    SocialModule,
  ],
})
export class AppModule {}
