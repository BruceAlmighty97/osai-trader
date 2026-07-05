# API Endpoints Reference

Every HTTP endpoint the `tastytrade-service` exposes, grouped by module, with its purpose, inputs, and output shape. Base URL is `http://localhost:3100` (the `PORT` env var; default 3100). Interactive docs live at **`/swagger`**.

**Three controllers:**

| Prefix | Tag | What it does |
|---|---|---|
| [`/tt`](#tastytrade-tt) | `tastytrade` | Broker integration — auth, chains, quotes/greeks, dry-run orders |
| [`/strategy`](#strategy-strategy-experimental) | `strategy (experimental)` | The AI brain — Claude suggests a strategy for a symbol |
| [`/positions`](#positions-positions) | `positions` | Our canonical holdings store (survives the sandbox nightly wipe) |
| [`/watchlist`](#watchlist-watchlist) | `watchlist` | The universe of symbols to scan, with per-symbol cadence + correlation bucket |
| [`/social`](#social-social) | `social` | Reddit sentiment scanner — surfaces tickers gaining attention (Phase A) |

> **A note on data:** the tastytrade **sandbox** feed is ~15-min delayed and only live during regular US market hours (9:30–16:00 ET). Outside those hours quotes are stale/frozen. `market-metrics` currently 502s in the sandbox. See [market-hours-scheduling.md](market-hours-scheduling.md).

---

## tastytrade (`/tt`)

Thin REST wrappers over `TastytradeService`, which talks to the `@tastytrade/api` SDK and the DXLink streaming websocket. Session auth happens lazily on first request.

### `GET /tt/whoami`
**Use:** Prove the tastytrade session works and list the accounts it can see. The first call triggers login.

**Input:** none.

**Output:**
| Field | Type | Meaning |
|---|---|---|
| `environment` | `string` | `sandbox` or `production` (from `TT_ENV`). |
| `loggedIn` | `boolean` | Whether the session token is currently valid. |
| `accountNumbers` | `string[]` | Account numbers the login can access (e.g. `["3AD50506"]`). |
| `raw` | `object` | The unmodified SDK accounts response, for debugging. |

---

### `GET /tt/chain`
**Use:** Confirm options data flows for a symbol and get a readable summary of available expirations.

**Input (query):**
| Param | Type | Default | Meaning |
|---|---|---|---|
| `symbol` | `string` | `SPY` | Underlying ticker (case-insensitive; upper-cased server-side). |

**Output:**
| Field | Type | Meaning |
|---|---|---|
| `symbol` | `string` | The underlying symbol resolved from the chain. |
| `expirationCount` | `number` | Number of expirations returned. |
| `expirations` | `array` | One entry per expiration (see below). |
| `expirations[].expiration` | `string` | Expiration date, `YYYY-MM-DD`. |
| `expirations[].dte` | `number` | Days to expiration. |
| `expirations[].strikeCount` | `number` | How many strikes exist at that expiration. |

---

### `POST /tt/dry-run-spread`
**Use:** The key broker proof — build a **bull put credit spread** (~30–45 DTE, the two middle strikes) from the live chain and submit it as a **dry run**. tastytrade validates it and returns buying-power effect + warnings. **Places nothing.**

**Input (query):**
| Param | Type | Default | Meaning |
|---|---|---|---|
| `symbol` | `string` | `SPY` | Underlying ticker. |

**Output:**
| Field | Type | Meaning |
|---|---|---|
| `symbol` | `string` | Underlying. |
| `strategy` | `string` | Always `"bull put credit spread"` for this endpoint. |
| `expiration` | `string` | Chosen expiration (`YYYY-MM-DD`). |
| `dte` | `number` | Days to expiration of the chosen expiration. |
| `shortPutStrike` | `string` | Strike of the sold (higher) put. |
| `longPutStrike` | `string` | Strike of the bought (lower, protective) put. |
| `submittedOrder` | `object` | The exact multi-leg order body sent to tastytrade (order-type, legs, price/price-effect). |
| `dryRunResult` | `object` | tastytrade's validation response — buying-power effect, fees, warnings. |

> On failure returns `{ error }` instead (e.g. no expirations, fewer than 2 strikes).

---

### `GET /tt/equity`
**Use:** Fetch the underlying equity instrument definition.

**Input (query):** `symbol` (`string`, default `SPY`).

**Output:** the raw SDK equity-definition object (instrument type, description, exchange, option-tick sizes, etc.).

---

### `GET /tt/chain/detailed`
**Use:** Full **flat** per-contract option chain — every option instrument with its fields (OCC symbol, strike, expiration, streamer symbol).

**Input (query):** `symbol` (`string`, default `SPY`).

**Output:** raw SDK detailed-chain response (a list of per-contract instrument objects).

---

### `GET /tt/chain/compact`
**Use:** Compact chain — arrays of option symbols only (lightest chain payload).

**Input (query):** `symbol` (`string`, default `SPY`).

**Output:** raw SDK compact-chain response (symbol arrays grouped by expiration).

---

### `GET /tt/strikes`
**Use:** The **strike ladder** for a single expiration — raw strike objects, so you can see every field (including `put-streamer-symbol` / `call-streamer-symbol` used for live quotes).

**Input (query):**
| Param | Type | Default | Meaning |
|---|---|---|---|
| `symbol` | `string` | `SPY` | Underlying. |
| `dte` | `string` | `30` | Target days-to-expiration; the endpoint picks the expiration whose DTE is **closest** to this. |

**Output:**
| Field | Type | Meaning |
|---|---|---|
| `symbol` | `string` | Underlying. |
| `expiration` | `string` | Chosen expiration (`YYYY-MM-DD`). |
| `dte` | `number` | Actual DTE of the chosen expiration. |
| `strikeCount` | `number` | Number of strikes. |
| `strikes` | `array` | Raw strike objects, ascending by strike price. Each exposes `strike-price`, `put` / `call` (OCC symbols), and `put-streamer-symbol` / `call-streamer-symbol` (DXLink symbols). |

> On failure returns `{ error }` (no expirations for the symbol).

---

### `GET /tt/market-metrics`
**Use:** IV rank / IV percentile / historical vol / beta / liquidity for a symbol — the inputs a premium-selling pre-filter wants.

**Input (query):** `symbol` (`string`, default `SPY`).

**Output:** raw SDK market-metrics response **when available**. In the **sandbox this typically 502s**, in which case the endpoint returns `{ error: 'market-metrics request failed', detail }` (works in production).

---

### `GET /tt/option`
**Use:** Look up a single option instrument by its full OCC symbol.

**Input (query):**
| Param | Type | Required | Example |
|---|---|---|---|
| `symbol` | `string` | **yes** | `SPY   260731P00696000` (OCC format, space-padded) |

**Output:** raw SDK single-option instrument object.

---

### `GET /tt/quote-token`
**Use:** Get a **DXLink quote token + streamer URL** — the credentials needed to open a streaming websocket for live quotes/greeks.

**Input:** none.

**Output:** raw SDK response containing the `token` and the DXLink `streamer-url` (and expiry metadata).

---

### `GET /tt/live`
**Use:** The greeks source. Streams **live quotes + greeks** for N strikes at one expiration over the DXLink websocket, then merges the events into one row per contract. This is where per-contract **delta / IV** (for strike selection) come from — greeks require streaming, not plain REST.

**Input (query):**
| Param | Type | Default | Meaning |
|---|---|---|---|
| `symbol` | `string` | `SPY` | Underlying. |
| `dte` | `string` | `30` | Target DTE; picks the closest expiration. |
| `right` | `string` | `P` | `P` (puts) or `C` (calls). |
| `count` | `string` | `10` | How many strikes around ATM to stream. |
| `seconds` | `string` | `6` | How long to collect streaming events before disconnecting. |

**Output:**
| Field | Type | Meaning |
|---|---|---|
| `symbol` | `string` | Underlying. |
| `expiration` | `string` | Chosen expiration. |
| `dte` | `number` | Actual DTE. |
| `right` | `string` | `P` or `C`. |
| `streamerUrl` | `string` | The DXLink URL used. |
| `eventCount` | `number` | Raw streaming events received. |
| `contracts` | `array` | One merged row per contract (see below). |
| `contracts[].streamerSymbol` | `string` | DXLink symbol. |
| `contracts[].iv,delta,gamma,theta,vega,rho,optionPrice` | `number` | From the `Greeks` event. |
| `contracts[].bid,ask,bidSize,askSize` | `number` | From the `Quote` event. |

> On failure returns `{ error, ... }` (no expiration, or strikes carry no streamer symbols).

---

## strategy (`/strategy (experimental)`)

The AI layer. Calls Claude (`claude-opus-4-8` by default, override with `STRATEGY_MODEL`) with adaptive thinking and a **structured-output JSON schema**, so the suggestion is guaranteed to match the shape below. **Suggestion only — places nothing.**

### `POST /strategy/suggest`
**Use:** Given a symbol, the AI reads the live price/chain/greeks snapshot and suggests **one** options strategy from the playbook (with strikes and rationale).

**Input (query):**
| Param | Type | Default | Meaning |
|---|---|---|---|
| `symbol` | `string` | `SPY` | Underlying (upper-cased server-side). |
| `dte` | `string` | `35` | Target days-to-expiration for the snapshot (policy is ~30–45 DTE). |

**Output:**
| Field | Type | Meaning |
|---|---|---|
| `symbol` | `string` | Underlying analyzed. |
| `model` | `string` | Model id used. |
| `suggestion` | `object` | The structured strategy recommendation (schema below). |
| `snapshot` | `object` | The market snapshot the AI reasoned over (see [snapshot shape](#the-snapshot-object)). |
| `usage` | `object` | Anthropic token usage (`input_tokens`, `output_tokens`, cache counters). |
| `stopReason` | `string` | Why the model stopped (e.g. `end_turn`). |

**`suggestion` object (structured output):**
| Field | Type | Meaning |
|---|---|---|
| `strategy` | enum | One of `bull_put_spread`, `bear_call_spread`, `iron_condor`, `iron_butterfly`, `covered_call`, `no_trade`. |
| `marketAssessment` | `string` | The AI's read of direction/vol from the snapshot. |
| `rationale` | `string` | Why this structure and these strikes. |
| `legs` | `array` | The proposed legs (empty for `no_trade`). |
| `legs[].action` | enum | `Sell to Open` or `Buy to Open`. |
| `legs[].right` | enum | `P` or `C`. |
| `legs[].strike` | `number` | Strike price. |
| `legs[].targetDelta` | `number` | Intended delta of the leg (short legs target 0.15–0.30). |
| `targetCreditPerSpread` | `number` | Credit the AI expects per spread unit. |
| `maxRiskPerSpread` | `number` | Defined max risk per unit = (width − credit) × 100. |
| `expiration` | `string` | Chosen expiration (`YYYY-MM-DD`). |
| `caveats` | `string` | Risks/assumptions the AI flags (e.g. delayed data). |

---

## positions (`/positions`)

**Our canonical holdings store.** The tastytrade sandbox wipes positions nightly, so this table — in our Postgres — is the source of truth for what we hold. The management loop reads open positions from here and re-quotes each leg's `streamerSymbol` to value them. See [persistence-and-db.md](persistence-and-db.md). Until the execution layer exists, positions are written by hand through these endpoints.

### `POST /positions`
**Use:** Record an open position (manual write path — seeds holdings for testing the management loop).

**Input (JSON body — `RecordPositionDto`):**
| Field | Type | Required | Meaning |
|---|---|---|---|
| `symbol` | `string` | **yes** | Underlying (upper-cased on save). |
| `strategy` | enum | **yes** | `bull_put_spread` \| `bear_call_spread` \| `iron_condor` \| `iron_butterfly` \| `covered_call`. |
| `expiration` | `string` | **yes** | Legs' expiration (`YYYY-MM-DD`). |
| `legs` | `OptionLeg[]` | **yes** | Non-empty; the spread's legs (shape below). |
| `entryCredit` | `number` | **yes** | Net credit received **per spread unit**. |
| `quantity` | `number` | no (default 1) | Number of spread units. |
| `maxRisk` | `number` | no | Defined max risk per unit = (width − credit) × 100. |
| `openedAt` | `string` (ISO) | no (default now) | When the position was opened. |
| `openDecisionId` | `number` | no | Soft link to the `decisions` row that produced it. |
| `openOrderId` | `number` | no | Soft link to the opening `orders` row. |
| `notes` | `string` | no | Free text. |

**`OptionLeg` shape:**
| Field | Type | Required | Meaning |
|---|---|---|---|
| `action` | `string` | yes | e.g. `Sell to Open`, `Buy to Open`, `Sell to Close`, `Buy to Close`. |
| `right` | `'P'` \| `'C'` | yes | Put or call. |
| `strike` | `number` | yes | Strike price. |
| `quantity` | `number` | yes | Contracts per spread unit. |
| `streamerSymbol` | `string` | recommended | DXLink symbol — **needed to re-fetch live quotes** for management once the broker forgets the position. |
| `entryPrice` | `number` | no | Per-contract price at entry, if known. |

**Output:** the created **Position object** (see [below](#the-position-object)), including its generated `id` and `status: "open"`.

**Errors:** `400` if `symbol`/`entryCredit` missing, `strategy` invalid, or `legs` empty.

---

### `GET /positions`
**Use:** List positions, newest first (by `openedAt`).

**Input (query):**
| Param | Type | Default | Meaning |
|---|---|---|---|
| `status` | enum | (all) | Filter by `open` or `closed`. |

**Output:** array of **Position objects**.

---

### `GET /positions/:id`
**Use:** Fetch one position by id.

**Input (path):** `id` (`number`).

**Output:** the **Position object**. `404` if not found.

---

### `PATCH /positions/:id/close`
**Use:** Close an open position — mark it closed and record the exit outcome (the management loop calls this when an exit rule fires).

**Input (path):** `id` (`number`).

**Input (JSON body — `ClosePositionDto`):**
| Field | Type | Required | Meaning |
|---|---|---|---|
| `exitReason` | enum | **yes** | `profit_target` (50% max profit) \| `dte_roll` (~21 DTE) \| `stop_loss` (~2× credit) \| `expired` \| `manual`. |
| `realizedPnl` | `number` | no | Total realized P&L across all units (positive = profit). |
| `closeOrderId` | `number` | no | Soft link to the closing `orders` row. |
| `closedAt` | `string` (ISO) | no (default now) | When it was closed. |
| `notes` | `string` | no | Free text (overwrites existing notes if given). |

**Output:** the updated **Position object** (`status: "closed"`, with `closedAt`, `exitReason`, `realizedPnl` set).

**Errors:** `404` if not found; `409` if the position is already closed.

---

## watchlist (`/watchlist`)

The universe of securities the scan pipeline analyzes — a DB table (not a hardcoded list). Each row controls whether and how often a symbol is scanned, and which **correlation bucket** it belongs to (so ranking can cap stacked correlated risk). Seeded with 6 liquid ETFs from [strategy-methodology.md](strategy-methodology.md). See also [roadmap.md](roadmap.md) (`/strategy/scan` consumes this).

### `POST /watchlist`
**Use:** Add a symbol to the watchlist.

**Input (JSON body — `CreateWatchlistItemDto`):**
| Field | Type | Required | Meaning |
|---|---|---|---|
| `symbol` | `string` | **yes** | Ticker (upper-cased on save; must be unique). |
| `description` | `string` | no | Free text, e.g. "S&P 500 ETF". |
| `correlationGroup` | `string` | no | Bucket for ranking: `us_equity` \| `gold` \| `rates` \| `silver` \| … Symbols sharing a bucket are treated as one bet. |
| `cadence` | enum | no (default `daily`) | `every_cycle` (costlier — an LLM call per cycle) or `daily`. |
| `enabled` | `boolean` | no (default `true`) | Whether scans include it. |
| `priority` | `number` | no (default `0`) | Higher = analyzed/preferred first. |
| `notes` | `string` | no | Free text. |

**Output:** the created **Watchlist object**. **Errors:** `400` (missing symbol / invalid cadence), `409` (symbol already on the list).

---

### `GET /watchlist`
**Use:** List watchlist entries, ordered by `priority` desc then symbol.

**Input (query):**
| Param | Type | Meaning |
|---|---|---|
| `enabled` | `string` | `true`/`false` — filter by enabled state. |
| `cadence` | enum | Filter by `every_cycle` or `daily`. |

**Output:** array of **Watchlist objects**.

---

### `GET /watchlist/:id`
**Use:** Fetch one entry by id. **Output:** the **Watchlist object**. `404` if not found.

---

### `PATCH /watchlist/:id`
**Use:** Update an entry — enable/disable, change cadence, priority, group, notes. `symbol` is **not** editable (delete + re-add to rename).

**Input (JSON body — `UpdateWatchlistItemDto`, all optional):** `description`, `correlationGroup`, `cadence`, `enabled`, `priority`, `notes`.

**Output:** the updated **Watchlist object**. **Errors:** `400` (invalid cadence), `404`.

---

### `DELETE /watchlist/:id`
**Use:** Remove a symbol from the watchlist.

**Output:** `{ "deleted": true, "id": <n> }`. `404` if not found.

---

## social (`/social`)

Reddit sentiment scanner (**Phase A** of the social-sentiment design in [ideas-backlog.md](ideas-backlog.md)). Polls configured subreddits, extracts ticker mentions (`$CASHTAGS` trusted; bare tickers filtered through a stoplist), and stores them in `social_mentions`. Trending symbols become watchlist candidates in Phase B (not built yet).

> **Requires Reddit creds** (`REDDIT_CLIENT_ID` / `REDDIT_SECRET` / `REDDIT_USER_AGENT`) — see [.env.example](../tastytrade-service/.env.example). Without them, `ingest`/`audit` return a `configured:false` / zero summary instead of erroring.

### `POST /social/ingest`
**Use:** Poll the configured subreddits **now** and store extracted mentions (manual trigger; a scheduled cron lands with the scheduler work). Re-polling an already-seen post refreshes its upvotes instead of duplicating (unique on `symbol`+`sourceId`).

**Input (query):**
| Param | Type | Default | Meaning |
|---|---|---|---|
| `subreddits` | `string` | env `SOCIAL_SUBREDDITS` | Comma-separated override. |
| `sort` | enum | `hot` | `hot` \| `new` \| `rising` \| `top`. |
| `limit` | `string` | `50` | Posts per subreddit (max 100). |

**Output (`IngestSummary`):** `{ configured, subreddits[], postsScanned, mentionsUpserted, distinctSymbols }`.

---

### `GET /social/mentions`
**Use:** List raw stored mentions, newest first.

**Input (query):** `symbol` (e.g. `SPY`), `subreddit` (e.g. `options`), `limit` (default 100, max 500).

**Output:** array of **SocialMention objects**.

---

### `GET /social/trending`
**Use:** Rank symbols by attention over a rolling window. Phase A scoring is distinct-authors + mention count (spike/z-score detection is Phase B). Only live content counts.

**Input (query):** `windowHours` (default 24), `limit` (default 25, max 200).

**Output (array of `TrendingRow`):**
| Field | Type | Meaning |
|---|---|---|
| `symbol` | `string` | Ticker. |
| `mentions` | `number` | Total mentions in window. |
| `distinctAuthors` | `number` | Unique authors (resists single-spammer pumps). |
| `totalUpvotes` | `number` | Summed Reddit score. |
| `cashtagMentions` | `number` | How many were high-confidence `$CASHTAG` matches. |
| `subreddits` | `number` | Distinct subreddits it appeared in. |

---

### `POST /social/audit`
**Use:** Deletion-compliance audit — re-check the least-recently-verified live rows against Reddit and purge/tombstone any whose source is gone (Reddit emits no deletion events, so this poll is the mechanism). See [ideas-backlog.md](ideas-backlog.md).

**Input (query):** `limit` (default 300, max 1000 — rows checked per run).

**Output (`AuditSummary`):** `{ checked, deleted, removed, stillLive }`.

---

## Shared object shapes

### The Position object
Returned by every `/positions` endpoint. (Numeric DB columns of type `numeric` — `entryCredit`, `maxRisk`, `realizedPnl` — come back as **strings** from Postgres, e.g. `"0.3500"`.)

| Field | Type | Meaning |
|---|---|---|
| `id` | `number` | Primary key. |
| `symbol` | `string` | Underlying. |
| `strategy` | enum | The strategy type. |
| `expiration` | `string` | Legs' expiration. |
| `legs` | `OptionLeg[]` | Stored as JSONB. |
| `quantity` | `number` | Spread units held. |
| `entryCredit` | `string` | Net credit per unit at entry. |
| `maxRisk` | `string \| null` | Defined max risk per unit. |
| `status` | enum | `open` or `closed`. |
| `realizedPnl` | `number \| null` | Set on close. |
| `exitReason` | enum \| null | Set on close. |
| `openDecisionId` / `openOrderId` / `closeOrderId` | `number \| null` | Soft links (no FK constraint) to `decisions`/`orders`. |
| `notes` | `string \| null` | Free text. |
| `openedAt` | `string` (ISO) | When opened. |
| `closedAt` | `string \| null` | When closed. |
| `createdAt` / `updatedAt` | `string` (ISO) | Row audit timestamps. |

### The Watchlist object
Returned by every `/watchlist` endpoint.

| Field | Type | Meaning |
|---|---|---|
| `id` | `number` | Primary key. |
| `symbol` | `string` | Ticker (unique). |
| `description` | `string \| null` | Free text. |
| `correlationGroup` | `string \| null` | Correlation bucket for ranking. |
| `cadence` | enum | `every_cycle` or `daily`. |
| `enabled` | `boolean` | Whether scans include it. |
| `priority` | `number` | Higher = analyzed first. |
| `notes` | `string \| null` | Free text. |
| `lastAnalyzedAt` | `string \| null` (ISO) | When the scan last ran it (written by the future scan; lets the scheduler gate daily cadence). |
| `createdAt` / `updatedAt` | `string` (ISO) | Row audit timestamps. |

### The SocialMention object
Returned by `GET /social/mentions`. One row per (symbol, Reddit source).

| Field | Type | Meaning |
|---|---|---|
| `id` | `number` | Primary key. |
| `symbol` | `string` | Ticker mentioned. |
| `subreddit` | `string` | Where it was found. |
| `sourceType` | enum | `post` (Phase A) or `comment` (later). |
| `sourceId` | `string` | Reddit fullname, e.g. `t3_abc123`. |
| `matchType` | enum | `cashtag` (trusted) or `bare` (stoplist-filtered). |
| `author` | `string \| null` | Reddit username. |
| `upvotes` | `number` | Reddit score at sample time. |
| `permalink` | `string \| null` | Link to the source. |
| `title` / `bodyText` | `string \| null` | Retained text; **purged to null** when the audit finds it deleted/removed. |
| `sentiment` | `string \| null` | Populated by the Phase C LLM pass. |
| `contentStatus` | enum | `live` \| `deleted` \| `removed`. |
| `createdUtc` | `string \| null` (ISO) | When the source was posted. |
| `sampledAt` | `string` (ISO) | When we first ingested it. |
| `lastCheckedAt` | `string \| null` (ISO) | Last deletion-audit check. |
| `deletedAt` | `string \| null` (ISO) | When found gone. |

### The snapshot object
Built by `TastytradeService.getGreeksSnapshot()` and returned inside `/strategy/suggest`. It's the market read the AI reasons over.

| Field | Type | Meaning |
|---|---|---|
| `symbol` | `string` | Underlying. |
| `underlyingPrice` | `number` | Spot price (delayed in sandbox). |
| `expiration` | `string` | Expiration nearest the requested DTE. |
| `dte` | `number` | Days to expiration. |
| `contracts` | `array` | One entry per strike in the ATM window. |
| `contracts[].strike` | `number` | Strike price. |
| `contracts[].put` / `.call` | `object` | `{ symbol, delta, iv, bid, ask }` for each side. |

---

## Related tables (no endpoints yet)

The persistence layer also created `decisions` and `orders` tables (schema stable, written later by the strategy/execution layers). They have **no HTTP endpoints yet** — see [persistence-and-db.md](persistence-and-db.md) and [roadmap.md](roadmap.md).

## Not built yet
Endpoints on the roadmap but **not** implemented: `/strategy/scan` (watchlist ranking), risk-gate validation, live order execution, and the position-management loop. See [roadmap.md](roadmap.md).
