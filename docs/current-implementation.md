# Current Implementation

What's actually coded in `tastytrade-service/`. (For exact routes/signatures, read the source — this is the map.)

## App structure

- **`src/main.ts`** — bootstrap; Swagger at `/swagger`; listens on `PORT` (default **3100**).
- **`src/app.module.ts`** — global `ConfigModule`, `TypeOrmModule.forRootAsync` (Postgres, `synchronize: false`), imports `TastytradeModule` + `StrategyModule`.
- **`src/data-source.ts`** — TypeORM CLI DataSource (migrations).

## Tastytrade module (`src/tastytrade/`)

`TastytradeService` — the integration layer. Key methods:
- `ensureLogin()` — session auth on first request (username/password from env).
- `accountItems(...)` — normalizes SDK responses (the `@tastytrade/api` SDK returns **direct arrays**, not `{items:[]}` — a recurring gotcha; always `Array.isArray()`-check).
- `getNestedChain(symbol)` — full nested chain (expirations → strikes).
- `getDetailedChain` / `getCompactChain` / `getSingleOption` / `getMarketMetrics` — chain/instrument/IV data.
- `getQuoteToken()` — DXLink token + streamer URL.
- `streamSnapshot(streamerSymbols, seconds)` — connects to **DXLink websocket**, subscribes Quote+Greeks for N contracts, collects for N seconds, disconnects, returns raw events. **This is how greeks are obtained** (greeks require live streaming, not plain REST).
- **`getGreeksSnapshot(symbol, dte=35, strikesPerSide=8, seconds=7)`** — the strategy input builder. Picks the expiration nearest `dte`, takes a window of strikes around ATM, streams the underlying quote + each strike's call & put, and returns a clean snapshot:
  ```
  { symbol, underlyingPrice, expiration, dte,
    contracts: [{ strike, put: {symbol,delta,iv,bid,ask}, call: {…} }, …] }
  ```

`TastytradeController` (`@ApiTags('tastytrade')`) — REST endpoints for: whoami/auth, nested chain, detailed chain, compact chain, strike ladder, market-metrics (IV — **502s in sandbox**, works in prod), equity definition, single option, quote-token, a live greeks endpoint, and a **dry-run multi-leg spread** validator (validates only — does NOT place orders).

**Data notes:** strike objects expose `put-streamer-symbol` / `call-streamer-symbol` (the DXLink symbols). Sandbox data is ~15-min delayed.

## Strategy module (`src/strategy/`) — the AI brain

- **`strategy.controller.ts`** — `POST /strategy/suggest?symbol=SPY&dte=35` (`@ApiTags('strategy (experimental)')`). Suggestion only — places nothing.
- **`strategy.service.ts`** — the Claude call:
  - SDK: **`@anthropic-ai/sdk`** (^0.110). Client reads `ANTHROPIC_API_KEY`.
  - Model: **`claude-opus-4-8`** by default, override via `STRATEGY_MODEL`.
  - **Adaptive thinking** (`thinking: {type: 'adaptive'}`) + `output_config: { effort: 'medium', format: { type: 'json_schema', schema } }` for **structured output** (guaranteed shape). `max_tokens: 8192`. System prompt is `cache_control`-cached.
  - Flow: `getGreeksSnapshot` → build user message with the snapshot JSON → Claude → parse the first text block (guaranteed JSON) → return `{ symbol, model, suggestion, snapshot, usage, stopReason }`.
  - **Structured suggestion schema:** `strategy` (enum: bull_put_spread | bear_call_spread | iron_condor | iron_butterfly | covered_call | no_trade), `marketAssessment`, `rationale`, `legs[]` ({action, right P/C, strike, targetDelta}), `targetCreditPerSpread`, `maxRiskPerSpread`, `expiration`, `caveats`.
- **`system-prompt.ts`** — the strategy playbook: conservative ~$50k premium-seller, the allowed strategies, 30–45 DTE, 0.15–0.30 delta shorts, defined-risk only, credit ≥ 1/3 width, `no_trade` when nothing fits.

> **Claude API note for future work:** this repo uses the **claude-api skill** conventions — default model `claude-opus-4-8`, adaptive thinking, structured outputs via `output_config.format` (on the stable `client.messages.create`, typed since SDK 0.110). Don't use `budget_tokens` (rejected on Opus 4.8).

## Environment (`tastytrade-service/.env`, gitignored)

```
TT_ENV=sandbox            # sandbox (api.cert.tastyworks.com) | production
TT_USERNAME=...           # tastytrade sandbox login
TT_PASSWORD=...
PORT=3100
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=osaitrader
DB_PASSWORD=osaitrader_dev
DB_NAME=osaitrader
ANTHROPIC_API_KEY=...     # required for /strategy/*
# STRATEGY_MODEL=...      # optional model override
```

Sandbox account (from testing): number `3AD50506`, `suitable-options-level: No Restrictions`. Real tastytrade account has MFA (won't work with plain session login — sandbox is used for the spike).

## Auth model

Currently **session auth** (username/password) for the sandbox spike. Production should move to **OAuth2** (stateless, no MFA friction) — a later task.
