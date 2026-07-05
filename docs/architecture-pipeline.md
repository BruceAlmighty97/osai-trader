# Architecture & Trading Pipeline

## The vision

A cron-driven bot that, during market hours, (1) scans a watchlist, (2) checks current holdings, (3) decides on closing open positions, and (4) decides on opening new ones. Runs unattended in AWS ECS.

## The full pipeline

```
1. CANDIDATE SELECTION   → which symbols to look at (curated watchlist)
2. PRE-FILTER (cheap)     → drop bad candidates before spending an LLM call
3. ANALYZE (the AI)       → per survivor: Claude suggests a strategy + strikes   ← BUILT (/strategy/suggest)
4. RANK & SELECT          → score suggestions, apply portfolio limits, pick top N
5. RISK GATE (hard)       → position size, buying power, portfolio delta, loss limits
6. EXECUTE                → submit the multi-leg order (dry-run proven; live behind a flag)
7. MANAGE                 → monitor open positions for exits (separate, frequent loop)
```

## The core principle: AI vs. deterministic code

**Use deterministic code for filtering, ranking, and risk. Use the AI only for the judgment call** — "given this chain, what structure and strikes make sense, and why" (step 3). Do not burn LLM calls on decisions a filter can make.

| Deterministic (code) | AI (Claude) |
|---|---|
| Candidate pre-filter (liquidity, IV rank, earnings) | Read the chain → pick strategy + strikes |
| Ranking suggestions by score | Market direction/vol assessment |
| Portfolio constraints (correlation, max positions) | Rationale / reasoning |
| Risk gate (hard limits) | — |
| Exit rules (50% profit / 21 DTE) | — |

## Two cadences (the scheduler runs both)

1. **Frequent — position management.** Read open positions (from OUR DB, see persistence doc), fetch live quotes, apply exit rules. Mostly deterministic, cheap. Runs often.
2. **Infrequent — new-opportunity scan.** 1–2×/day. Run the AI entry pipeline across the watchlist, rank, risk-gate, execute. This is where the LLM cost lives.

## Ranking & portfolio constraints (step 4 detail)

Each candidate yields one AI suggestion (or `no_trade`). Then:
1. **Score** each: e.g. `credit ÷ max_risk` (return on risk), optionally weighted by IV rank and probability-of-profit (approx. from short-strike delta — a 0.20-delta short ≈ ~80% POP).
2. **Portfolio constraints:** max 2–3 new positions/day; buying-power available; **don't stack correlated risk** (see below).
3. Take **top 1–3** survivors; each must pass the hard risk gate before execution.

### Correlation bucketing (important)
SPY, QQQ, IWM are highly correlated ("long US equity"). Selling bull-put spreads on all three is **one leveraged bet**, not diversification. The ranking logic must treat them as a **single correlation bucket** and cap combined equity exposure — real diversification comes from GLD/TLT/SLV (different risk drivers).
