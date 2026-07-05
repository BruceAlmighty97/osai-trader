# Persistence & Database

## Core principle: OUR database is the source of truth, not the broker

The broker (tastytrade) is an **execution venue + live-quote source**, nothing more. Our Postgres is the **system of record** for everything we care about. This is the right architecture regardless of the sandbox, and it also makes the sandbox's daily reset a non-issue.

| Data | Source of truth | Survives sandbox wipe? |
|---|---|---|
| Decisions the bot made (audit trail) | **Our Postgres** | ✅ |
| Orders placed | **Our Postgres** | ✅ |
| Current open positions | **Our Postgres** (canonical) | ✅ |
| P&L history | **Our Postgres** | ✅ |
| Bot "memory" / learnings | **Our Postgres** | ✅ |
| Live quotes / greeks | tastytrade (re-fetch each run) | n/a |
| Broker's *copy* of positions/balance | tastytrade sandbox | ❌ wiped daily |

## The sandbox daily-wipe problem and the fix

The tastytrade sandbox resets balances/positions every ~24h. The only real casualty is **position management** — you can't rely on the broker's position list because it vanishes.

**Fix (also better production architecture):** drive position management off two things, neither of which is the broker's position list:
1. **What do I hold?** → read from **our DB** (`positions` table, written on fill).
2. **What's it worth now?** → fetch **live quotes for those specific legs** from tastytrade.

Then compute P&L, apply exit rules, and on close: update our DB **and** send a close order. This works identically in sandbox and production.

**Reconciliation** is a *cross-check*, not the source: compare our DB vs the broker's position list each run. In production a mismatch is a red flag; in sandbox "DB says open, broker says none" is the expected daily-wipe artifact — handle it gracefully (log, don't panic-close). Make the close path tolerate "broker doesn't have this position" (in sandbox, closing is mostly a DB state update).

## Planned tables (not built yet — the next build)

- **`decisions`** — every AI analysis: symbol, snapshot used, proposed strategy/legs, rationale, token usage, timestamp. (Port field design from `git show 1197b3b:service/src/modules/strategy-engine/strategy-decision.entity.ts`.)
- **`orders`** — submitted orders, status, fills, tastytrade order id. (Ref: `git show 1197b3b:service/.../order.entity.ts`.)
- **`positions`** — open/closed positions (the canonical holdings), legs, entry credit, current P&L, exit reason.
- (later) risk config (JSONB, seeded per account size — port from the IBKR risk module + `docs/risk-parameters.md`).

## TypeORM setup (DONE)

Chosen ORM: **TypeORM** — NestJS's first-party ORM (`@nestjs/typeorm`), and its migration CLI is the closest thing to Alembic. Migrations-first, **`synchronize: false`** (never auto-sync schema — avoids silent data loss).

**Files:**
- `tastytrade-service/src/data-source.ts` — DataSource for the CLI (reads `.env` via dotenv; entities `src/**/*.entity.ts`, migrations `src/migrations/*.ts`).
- `tastytrade-service/src/app.module.ts` — `TypeOrmModule.forRootAsync` at runtime (`autoLoadEntities: true`, `synchronize: false`, `migrationsRun` only in production, migrations from `dist/migrations/*.js`).

**Migration commands (Alembic equivalents):**

| Alembic | This project |
|---|---|
| `alembic revision --autogenerate -m "x"` | `npm run migration:generate --name=X` |
| `alembic revision -m "x"` (empty) | `npm run migration:create --name=X` |
| `alembic upgrade head` | `npm run migration:run` |
| `alembic downgrade -1` | `npm run migration:revert` |

Entities are decorator classes (`@Entity()`, `@Column()`) = SQLAlchemy models. `migration:generate` diffs entities vs the live DB.

## Database / docker

- **`docker-compose.yml`** (repo root): single Postgres 16, container `osaitrader-db`, `POSTGRES_DB: osaitrader`, user `osaitrader` / pw `osaitrader_dev`, port 5432, named volume `pgdata`. No init script — the app's single `osaitrader` DB is created directly.
- The DB was **wiped clean** during setup (`docker compose down -v`) to remove leftover IBKR schema. It is currently **empty** (no tables) — the first migration will create the schema.
- To reset again: `docker compose down -v && docker compose up -d`.
