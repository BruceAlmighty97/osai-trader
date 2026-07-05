# OsaiTrader — Project Context (load this first)

> **Purpose of this folder:** a complete handoff of the project's state, architecture, and every design decision made so far. Load these docs at the start of a new session to restore full context. Start here, then read the topic files linked below.

## What this is

An **automated options-strategy trader**: a NestJS service that connects to **tastytrade**, pulls live options data, uses **Claude (Anthropic API)** to decide on credit-spread strategies, runs pre-trade risk checks, executes multi-leg orders, and manages positions — designed to eventually run **unattended in AWS ECS** on a cron schedule during market hours.

The project name is "OsaiTrader" (likely "Options Strategy AI" — not documented anywhere, just the name).

## Where we are right now (as of 2026-07-04)

**Working / built:**
- tastytrade **session auth** (sandbox/cert environment)
- **Options data pipeline** — chains, strike ladders, per-contract greeks via DXLink streaming
- **Multi-leg dry-run** order validation (proven; no live orders yet)
- **AI strategy suggestion** — `POST /strategy/suggest?symbol=SPY` reads live price/chain/greeks and returns a structured strategy recommendation from Claude
- **Postgres + TypeORM** wired up (migrations-first), fresh empty `osaitrader` database

**Designed but NOT built:**
- Watchlist scan + candidate ranking (`/strategy/scan`)
- Persistence layer (positions/orders/decisions tables) — the durable memory
- Risk gate (pre-trade validation)
- Order execution (real submit behind a flag)
- Position management (exit rules loop)
- Cron orchestration (market-hours-aware scheduler)

## The two apps in this repo

- **`tastytrade-service/`** — the ACTIVE app. Everything new goes here.
- **`service/`** — the PARKED legacy IBKR app. **Removed from the working tree** but preserved in git history (initial commit `1197b3b`). It's still a useful reference for the risk-parameter values and audit-table entity designs we'll port. Pull old files with `git show 1197b3b:service/<path>`.

We **pivoted from IBKR to tastytrade** on ~2026-07-03 because IBKR's persistent-gateway architecture, one-session-per-login limit, and market-data entitlement friction made it hostile to unattended cloud operation. tastytrade won on: options-native REST API, native multi-leg orders, stateless auth, and the user already having an account. (Tradier was the runner-up; Alpaca was rejected — can't do covered calls as multi-leg.)

## Reading order

1. **[architecture-pipeline.md](architecture-pipeline.md)** — the end-to-end trading pipeline and the AI-vs-deterministic split
2. **[strategy-methodology.md](strategy-methodology.md)** — watchlist, DTE policy, strategy selection, strikes, management rules, small-account math
3. **[persistence-and-db.md](persistence-and-db.md)** — DB-as-source-of-truth, sandbox-wipe handling, TypeORM/migrations setup
4. **[market-hours-scheduling.md](market-hours-scheduling.md)** — trading window, calendar gating, cron cadences
5. **[current-implementation.md](current-implementation.md)** — what's actually coded, how to run it, Claude API details
6. **[roadmap.md](roadmap.md)** — next steps in build order + open items

## Quick start (run it locally)

```bash
# 1. Start Postgres (repo root)
docker compose up -d            # osaitrader-db on :5432, database "osaitrader"

# 2. Start the app
cd tastytrade-service
npm install
npm run start:dev               # http://localhost:3100 ; Swagger at /swagger
```

Requires `tastytrade-service/.env` (gitignored) with tastytrade sandbox creds, `ANTHROPIC_API_KEY`, and DB vars — see [current-implementation.md](current-implementation.md) for the full list.

## Git

- Remote: `github.com/BruceAlmighty97/osai-trader.git` (`origin`), branch **`main`**.
- Latest commit at handoff: `cd1f20c` (AI strategy endpoint + TypeORM setup; removed legacy IBKR service). **Committed but not yet pushed** — 1 ahead of `origin/main`.
