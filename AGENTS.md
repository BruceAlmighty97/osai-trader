# OsaiTrader - Session Notes

## What This Is
Automated options strategy trader: NestJS service → IBKR (Interactive Brokers) → Codex AI agent for decisions. Targeting AWS ECS deployment.

## Project Structure
- `docs/` — architecture, build plan, risk parameters, IBKR notes, DB/migration docs
- `service/` — NestJS application
- `docker-compose.yml` — local Postgres (port 5432)

## Completed Phases

### Phase 1: IBKR Connection ✅
- Connects to TWS on port 4002 (paper trading, account DUO408075)
- Auto-reconnect with exponential backoff
- Market data type configurable via `IBKR_MARKET_DATA_TYPE` env var (currently 3 = delayed)

### Phase 2: Market Data + Portfolio ✅
- Stock/option quotes, options chain params, option quotes with greeks
- Positions, account summary, P&L
- Endpoints under `/market-data/*` and `/portfolio/*`

### Phase 3: Risk Management ✅
- Postgres DB with JSONB risk config (auto-seeded defaults for ~$50k portfolio)
- Pre-trade validation: position limits, portfolio limits, loss limits, kill switch
- CRUD endpoints at `/risk/config`
- See `docs/risk-parameters.md` for full parameter docs

### Phase 4: Order Management ✅
- Submit, cancel, track orders via `/orders/*`
- Orders persisted to `orders` table in Postgres
- Risk pre-trade checks run before every order submission
- IBKR warning codes (>=10000) now logged as warnings, not errors
- Event listeners register via `onApiConnected` callback (survives reconnects)
- Orders explicitly set `transmit: true` to ensure execution

### Phase 5: Strategy Engine — IN PROGRESS

**What's built (code complete, needs testing):**
- Full agentic loop using Codex Sonnet (`Codex-sonnet-4-6`) with tool use
- System prompt with constrained strategy playbook: credit spreads (bull put, bear call, iron condor, iron butterfly) + covered calls
- 7 agent tools wired to existing services: `get_market_quote`, `get_options_chain`, `get_option_quote`, `get_portfolio_summary`, `get_open_orders`, `evaluate_risk`, `submit_order`
- Full audit logging: `strategy_decisions` table (reasoning, proposed trade, risk checks, token usage) + `strategy_tool_calls` table (every tool call with input/output/duration)
- REST endpoints: `POST /strategy/analyze`, `GET /strategy/decisions`, `GET /strategy/decisions/:id`, `GET /strategy/decisions/:id/tool-calls`
- Prompt caching enabled for cost efficiency
- Temperature 0 for deterministic decisions

**Key files:**
- `service/src/modules/strategy-engine/strategy-engine.service.ts` — core agent loop
- `service/src/modules/strategy-engine/agent-tools.ts` — tool definitions + executors
- `service/src/modules/strategy-engine/system-prompt.ts` — strategy playbook prompt
- `service/src/modules/strategy-engine/strategy-decision.entity.ts` — decision audit table
- `service/src/modules/strategy-engine/strategy-tool-call.entity.ts` — tool call audit table
- `service/src/modules/strategy-engine/strategy-engine.controller.ts` — REST API
- `service/src/modules/strategy-engine/strategy-engine.types.ts` — types/enums

**New env vars added:**
- `ANTHROPIC_API_KEY` — required for Codex agent
- `STRATEGY_MODEL` — optional override, defaults to `Codex-sonnet-4-6`

## Blocker — IBKR Market Data Subscription

**The agent runs but can't get market quotes.** Error:
```
code: 10089 — "Requested market data requires additional subscription for API"
code: 300 — "Can't find EId with tickerId:X"
```

This affects ALL market data, not just the agent — confirmed by testing `GET /market-data/quote?symbol=SPY` directly.

**What to do next session:**
1. Fix the IBKR market data subscription on the paper account (DUO408075)
   - Log into IBKR Account Management (portal, not TWS)
   - Navigate to Settings → Market Data Subscriptions (or User Settings → Market Data)
   - Re-enable "US Securities Snapshot and Futures Value Bundle" (or equivalent free delayed data for paper accounts)
   - This previously worked — subscription may have expired or been reset
   - Alternative: try IBKR Client Portal at https://www.interactivebrokers.com/sso/Login → Settings → User Settings → Market Data
2. Once market data works again, test the agent: `POST /strategy/analyze` with `{ "underlying": "SPY" }`
3. Watch terminal for tool call logs and verify the full analysis flow
4. Check `GET /strategy/decisions` to review the audit trail

## What's Left After Phase 5 Testing

**Phase 5 enhancements (after basic flow works):**
- Two-agent pattern (analysis + execution review) — deferred, single agent first
- Multi-leg combo orders for spreads — currently submits legs individually
- Streaming responses for better UX on manual triggers

**Remaining Phases:**
- Phase 6: AWS Infrastructure + CI/CD
- Phase 7: Scheduling + Orchestration

## How to Run
```bash
# Start Postgres
docker compose up -d

# Start TWS (paper trading, API enabled on port 4002)

# Start the service
cd service
npm run start:dev

# Swagger UI
http://localhost:3000/swagger
```

## Key Env Vars (service/.env)
- `IBKR_HOST`, `IBKR_PORT` (4002), `IBKR_CLIENT_ID` (0)
- `IBKR_MARKET_DATA_TYPE` (3 = delayed, 1 = live)
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`
