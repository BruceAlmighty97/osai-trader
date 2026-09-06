# OsaiTrader

An automated options-strategy trader on [tastytrade](https://tastytrade.com),
with strategy decisions made by an AI analyst behind a deterministic risk gate.
It reads **real market data**, has an AI propose defined-risk options plays, runs
them through hard risk rules, and — for now — records them in an **imaginary
"paper" account** to forward-test the strategy with zero execution risk.

> **Status:** forward-testing. Production tastytrade access is live (OAuth2, real
> IV Rank / metrics). Trades are **paper only** — the app never sends orders to a
> broker (`TRADING_MODE=paper`; there is no live-order code path).

## How it works

1. **Market data in** — real IV Rank, option chains, greeks, and liquidity from
   tastytrade (production), plus a Reddit social-sentiment scanner.
2. **AI proposes** — a Claude-powered analyst suggests a defined-risk credit
   spread (bull put / bear call / iron condor / iron butterfly) from the playbook.
3. **Risk gate decides** — a deterministic, account-agnostic gate (`/risk/config`)
   validates every play (position limits, per-trade / portfolio risk %, per-symbol
   concentration, kill switch). The AI can never override it.
4. **Paper ledger records** — accepted plays are booked into a virtual $2,500
   account; the app tracks realized P&L, win/loss, and buying power.

Strategy basis (tastytrade research): sell ~45 DTE, manage at **50% profit or
21 DTE**, whichever comes first. See [docs/trading-day.md](docs/trading-day.md)
for the planned scheduled "trading day" (pre-market prep → entry windows →
management → after-close review).

## Stack

- **[tastytrade-service/](tastytrade-service/)** — NestJS app (port 3100),
  TypeORM + Postgres, `@tastytrade/api`, Anthropic SDK
- **[infra/](infra/)** — AWS CDK (ECS Fargate, RDS, Secrets Manager, no ALB)
- **[docs/](docs/)** — architecture, strategy, risk, trading-day, AWS runbook

## Run it locally

Prerequisites: Node 22, Docker, and a tastytrade account (sandbox is fine to
start).

```bash
# 1. Start Postgres
docker compose up -d

# 2. Configure the service
cd tastytrade-service
cp .env.example .env        # then fill in the values (see below)

# 3. Create the schema (migrations don't auto-run outside production)
npm install
npm run migration:run

# 4. Run it (watch mode)
npm run start:dev
```

Swagger UI: **http://localhost:3100/swagger**

### Required `.env` values

| Var | Purpose |
|---|---|
| `TT_ENV` | `sandbox` or `production` |
| `TT_REFRESH_TOKEN` + `TT_CLIENT_SECRET` | tastytrade **OAuth2** (required for production) |
| `TT_USERNAME` + `TT_PASSWORD` | session auth (sandbox alternative to OAuth) |
| `DB_HOST/PORT/USERNAME/PASSWORD/NAME` | Postgres (defaults match docker-compose) |
| `ANTHROPIC_API_KEY` | Claude, for the strategy analyst |
| `API_KEY` | required on every request via the `X-API-Key` header |
| `TRADING_MODE` | `paper` (the only supported mode) |

To use production data, create an OAuth app at **my.tastytrade.com → Manage → My
Profile → API → OAuth Applications**, then **Create Grant** for a refresh token.
See `.env.example` for the full walkthrough.

## Auth

Every endpoint requires an `X-API-Key` header (except `GET /health` and Swagger):

```bash
curl -H "X-API-Key: $API_KEY" localhost:3100/paper/account
```

Locally, if `API_KEY` is unset the guard is disabled (dev convenience); in
production it fails closed.

## Key endpoints

| Area | Endpoints |
|---|---|
| Health | `GET /health` (public) |
| Market data | `GET /tt/market-metrics`, `/tt/chain*`, `/tt/strikes`, `/tt/option`, `/tt/live` |
| Real account | `GET /tt/whoami`, `/tt/balances`, `/tt/positions` |
| Strategy (AI) | `POST /strategy/suggest?symbol=SPY` |
| Paper account | `GET /paper/account`, `GET /paper/positions`, `POST /paper/positions/from-suggestion`, `PATCH /paper/positions/:id/close` |
| Risk gate | `GET/PATCH /risk/config` |
| Watchlist | `GET/POST/PATCH/DELETE /watchlist` |
| Social | `GET /social/trending`, `/social/mentions`; `POST /social/ingest` |

## Deployment

Deployed to AWS via CDK + GitHub Actions (push to `main` builds the image and
rolls the ECS service). The service has no public ingress — reach it and the DB
through the SSM bastion (`/tunnels` skill, or [docs/bastion-access.md](docs/bastion-access.md)).
Full runbook: [docs/aws-infrastructure.md](docs/aws-infrastructure.md).
