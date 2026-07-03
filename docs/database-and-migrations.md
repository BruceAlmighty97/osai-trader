# Database & Migrations

## Overview

OsaiTrader uses **PostgreSQL** as its database and **TypeORM** as the ORM. Schema changes are managed differently depending on the environment:

| Environment | Schema Management | How It Works |
|-------------|-------------------|--------------|
| Development | `synchronize: true` | TypeORM compares entity classes to the database on every startup and auto-creates/alters tables to match. Fast iteration, no migration files needed. |
| Production | Migrations | Schema changes are captured in migration files that run in order. Safe, predictable, reversible. |

The behavior is controlled by the `NODE_ENV` environment variable. If `NODE_ENV=production`, synchronize is off and migrations run automatically on startup.

## Local Setup

### Start the database

```bash
# From the project root
docker compose up -d
```

This starts a Postgres 16 container on port 5432 with:
- **User:** osaitrader
- **Password:** osaitrader_dev
- **Database:** osaitrader

Data persists in a Docker volume (`pgdata`), so it survives container restarts.

### Connect manually (optional)

```bash
docker exec -it osaitrader-db psql -U osaitrader
```

## How Schema Changes Work

### In Development (current mode)

1. Edit or create an entity class (e.g., `risk-config.entity.ts`)
2. Restart the service
3. TypeORM detects the changes and auto-alters the database

That's it. No migration files needed. This is fast but **not safe for production** — TypeORM may drop columns or tables if you rename things.

### In Production (when we deploy)

Schema changes go through migration files:

#### 1. Generate a migration

After modifying an entity class, generate a migration that captures the diff:

```bash
cd service
npm run migration:generate --name=AddTradeHistory
```

This compares your entity classes to the current database state and creates a timestamped migration file in `src/migrations/`, e.g.:

```
src/migrations/1712345678901-AddTradeHistory.ts
```

The file contains `up()` (apply) and `down()` (revert) methods with raw SQL.

#### 2. Review the migration

Always review the generated SQL before committing. TypeORM sometimes generates unnecessary changes.

#### 3. Run the migration

```bash
npm run migration:run
```

Or, in production, migrations run automatically on app startup (`migrationsRun: true`).

#### 4. Revert a migration (if needed)

```bash
npm run migration:revert
```

This runs the `down()` method of the most recently applied migration.

## Entity Files

Entities define the database schema using TypeORM decorators. Each entity maps to a table.

| Entity | Table | Module | Description |
|--------|-------|--------|-------------|
| `RiskConfigEntity` | `risk_config` | risk-management | Risk configuration (JSONB) |

As we build more features, new entities will be added to their respective modules (e.g., trade history in order-management, audit logs, etc.).

### Entity conventions

- Entity files are named `*.entity.ts` and live in the module that owns them
- Entities are registered via `TypeOrmModule.forFeature([Entity])` in the module
- `autoLoadEntities: true` in the root config means NestJS auto-discovers all registered entities

## Configuration

Database connection is configured via environment variables in `.env`:

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=osaitrader
DB_PASSWORD=osaitrader_dev
DB_NAME=osaitrader
```

For production, set `NODE_ENV=production` to switch from synchronize mode to migrations mode.

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Postgres container definition |
| `service/src/app.module.ts` | TypeORM root configuration |
| `service/src/data-source.ts` | Standalone DataSource for migration CLI |
| `service/src/migrations/` | Migration files (generated, committed to git) |
| `service/.env` | Database connection credentials |

## Important Notes

- **Never use `synchronize: true` in production.** It can silently drop data.
- **Always commit migration files to git.** They are the source of truth for the production schema.
- **Review generated migrations before running.** TypeORM occasionally generates unnecessary or destructive changes.
- **Migrations are immutable once applied.** If you need to fix a migration, create a new one — don't edit an applied migration.
- **The `migrations` table in Postgres tracks which migrations have been applied.** Don't modify it manually.
