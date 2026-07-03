import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Standalone DataSource configuration for TypeORM CLI.
 * Used for generating and running migrations outside of NestJS.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'osaitrader',
  password: process.env.DB_PASSWORD || 'osaitrader_dev',
  database: process.env.DB_NAME || 'osaitrader',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});
