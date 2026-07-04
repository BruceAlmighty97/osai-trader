import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

// Loads .env so the TypeORM CLI (migration:generate/run/revert) uses the same
// connection as the running app. Not used at runtime — app.module wires its own.
dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'osaitrader',
  password: process.env.DB_PASSWORD ?? 'osaitrader_dev',
  database: process.env.DB_NAME ?? 'osaitrader',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
