# Risk Configuration Parameters

All risk parameters are stored in the database and can be viewed/modified at runtime via the API:

- `GET /risk/config` — view current configuration
- `PATCH /risk/config` — update specific values
- `POST /risk/config/reset` — reset all values to defaults

## Default Values

Defaults are calibrated for a **~$50,000 starting portfolio**. These should be reviewed and adjusted as the portfolio grows or shrinks. See [Scaling Guidelines](#scaling-guidelines) below.

---

## Position Limits

These control the size and count of individual trades.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxPositionSize` | 10 | **Max contracts per position.** The maximum number of option contracts (or stock lots) the system can hold in a single position. At 10 contracts of a $5-wide spread, max risk per position is ~$5,000 (10% of portfolio). |
| `maxNotionalPerTrade` | 50,000 | **Max notional value per trade in USD.** The total dollar exposure of a single trade (contracts × multiplier × underlying price). Set to 100% of portfolio as an outer guardrail — most strategies will use far less. |
| `maxOpenPositions` | 20 | **Max number of simultaneous open positions.** Prevents over-diversification that becomes unmanageable and limits total portfolio exposure. |

## Portfolio Limits

These control aggregate exposure across all positions.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxPortfolioDelta` | 500 | **Max absolute portfolio delta.** Delta measures directional exposure — a delta of 500 means the portfolio gains/loses ~$500 per $1 move in the underlying. At $50k, this is a 1% portfolio impact per dollar move. Keeps the portfolio from becoming too directionally biased. |
| `maxPortfolioGamma` | 100 | **Max absolute portfolio gamma.** Gamma measures how fast delta changes. High gamma means delta can swing rapidly, making the portfolio hard to manage. A gamma of 100 means delta shifts by 100 for each $1 underlying move. |
| `maxBuyingPowerUsage` | 0.5 (50%) | **Max percentage of buying power that can be used.** Reserves half your buying power as a buffer for adjustments, margin calls, or new opportunities. On a $50k account with ~$200k buying power (Reg-T margin), this allows ~$100k deployed. |
| `maxMarginUsage` | 0.8 (80%) | **Max percentage of available margin that can be consumed.** Harder ceiling than buying power — if margin usage hits 80%, no new trades. Prevents margin calls which force liquidation at unfavorable prices. |

## Loss Limits

These are circuit breakers that halt trading when losses exceed thresholds.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxDailyLoss` | 1,000 | **Max realized loss per day in USD.** If cumulative realized losses for the day exceed $1,000 (2% of $50k portfolio), all new trade activity is halted for the remainder of the day. Existing positions are left open unless they hit `maxPositionLoss`. |
| `maxWeeklyLoss` | 3,000 | **Max realized loss per week in USD.** If cumulative realized losses for the week exceed $3,000 (6% of $50k portfolio), all trading halts and a notification is sent for manual review. Prevents compounding a bad week. |
| `maxPositionLoss` | 500 | **Max unrealized loss per individual position in USD.** If any single position's unrealized loss exceeds $500 (1% of portfolio), the system triggers an auto-close for that position. This is a per-position stop-loss. |
| `maxDrawdownPercent` | 0.1 (10%) | **Max drawdown from peak equity.** If the portfolio drops 10% from its highest recorded value (e.g., from $50k peak to $45k), ALL trading stops and ALL positions are closed. This is the nuclear option — full capital preservation mode. Requires manual intervention to resume. |

## Operational Parameters

These control system behavior independent of financial limits.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `dataFreshnessMaxAge` | 30 | **Max age of market data in seconds.** If the most recent market data for a symbol is older than 30 seconds, the system will reject any trade involving that symbol. Options prices can move significantly in seconds — stale data leads to bad fills. |
| `tradingEnabled` | true | **Master kill switch.** When set to `false`, the system will not submit any new orders regardless of all other parameters. Existing positions are unaffected. Use this for planned maintenance, overnight, or when you want to pause the system without shutting it down. |

---

## Scaling Guidelines

These defaults assume a **$50,000 portfolio**. As the portfolio value changes, these parameters should be reviewed.

### Parameters that should scale with portfolio size

| Parameter | Scaling Rule | Example at $100k |
|-----------|-------------|-----------------|
| `maxNotionalPerTrade` | ~100% of portfolio | 100,000 |
| `maxPortfolioDelta` | ~1% impact per $1 move | 1,000 |
| `maxPortfolioGamma` | Scales with delta limit | 200 |
| `maxDailyLoss` | ~2% of portfolio | 2,000 |
| `maxWeeklyLoss` | ~6% of portfolio | 6,000 |
| `maxPositionLoss` | ~1% of portfolio | 1,000 |

### Parameters that are relatively fixed

| Parameter | Notes |
|-----------|-------|
| `maxPositionSize` | Depends on strategy, not portfolio size |
| `maxOpenPositions` | Depends on management capacity |
| `maxBuyingPowerUsage` | Percentage-based — already scales |
| `maxMarginUsage` | Percentage-based — already scales |
| `maxDrawdownPercent` | Percentage-based — already scales |
| `dataFreshnessMaxAge` | Technical parameter, doesn't scale |
| `tradingEnabled` | On/off switch |

### When to review

- **After significant portfolio growth/decline** (>20% change from when params were last set)
- **When changing strategies** (e.g., moving from credit spreads to iron condors changes typical position sizes)
- **After a loss event** that triggered a circuit breaker — evaluate whether limits were too loose or too tight
- **Monthly** during active trading as a general hygiene check
