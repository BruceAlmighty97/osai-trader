# Strategy Methodology

## Watchlist (starter: 6 liquid ETFs)

| Symbol | What | Why |
|--------|------|-----|
| **SPY** | S&P 500 | Most liquid options on earth; penny-wide strikes, daily expirations. Anchor. |
| **QQQ** | Nasdaq 100 | Nearly as liquid; tech-heavy → slightly more IV/premium than SPY. |
| **IWM** | Russell 2000 | Small caps run **higher IV** → richest credit of the equity trio; still very liquid. |
| **GLD** | Gold | Diversifier — driven by macro/rates, not equity beta. |
| **TLT** | 20yr Treasuries | Rates exposure, often inverse to stocks. |
| **SLV** | Silver | Commodity, higher IV → more premium. |

**All ETFs on purpose.** Mega-caps (AAPL/MSFT/NVDA/TSLA…) have deeper premium but carry **earnings-gap risk** — a report can blow through a short strike overnight. We have **no earnings calendar wired up yet** (and tastytrade `market-metrics`/IV-rank 502s in the sandbox), so single names are deferred to a later tier. ETFs don't report earnings.

**Sandbox caveat:** the cert environment has a limited instrument universe. SPY is confirmed; verify each other symbol returns a chain (`/tt/chain?symbol=X`) before committing it.

**Pre-filter (later, needs production data):** only sell premium when IV rank is elevated; require liquidity; avoid earnings within ~7 days. For MVP: curated list, skip the pre-filter.

## DTE: a policy, not a per-trade search

**Fix DTE at ~30–45 days. Do NOT sweep 7/14/30 and compare live.**

- **Theta** decay is most favorable risk-adjusted around 30–45 DTE.
- **Gamma** explodes near expiration. A 7-DTE spread swings violently on small moves — winning at 10am, max-loss by 2pm. That's the opposite of conservative ("picking up pennies in front of a steamroller").
- **Sweeping tenors by credit biases you toward short DTE** (7 DTE always shows juicy annualized credit) — straight into the gamma trap. A 7-DTE and a 30-DTE spread are *different risk products*, not the same trade at different lengths.
- Legitimate DTE comparison exists only for: (a) choosing among the 1–3 expirations inside the 30–45 window, or (b) **backtesting offline** to set the policy — never a live per-trade sweep.

## Strategy selection (the real per-trade decision)

Once DTE is fixed, pick strategy + strikes from the market read:

| Market read (from snapshot) | Strategy |
|---|---|
| Neutral, range-bound, IV elevated | **Iron condor** |
| Bullish / on support | **Bull put spread** |
| Bearish / at resistance | **Bear call spread** |
| Very little expected movement, IV rich | **Iron butterfly** (sparingly) |
| (existing long stock only) | **Covered call** |
| Nothing fits | **no_trade** |

**Strikes by delta:** short strike at **0.15–0.30 delta** (|delta| for puts), protective long further OTM. Always defined-risk — every spread has a protective long leg. Target credit ≥ ~1/3 of spread width.

## Management rules (bake into the system + the exit loop)

- Close at **50% of max profit**, OR
- Close/roll at **~21 DTE** (before gamma ramps), OR
- Stop at **~2× credit received** loss.

## Small-account reality (~$1k)

- **A spread's max risk = (width − credit) × 100 — it depends on WIDTH, not the underlying's price.** A 1-wide SPY put spread risks ~$65–85 regardless of SPY being $600.
- That ~$80 floor is **~8% of a $1k account** on ONE position — you can't size "conservatively" (1–5% = $10–50) with the minimum liquid-ETF spread.
- Iron condors (~2 spreads, ~$160) are effectively off the table at $1k.
- **Diversification is impossible** at $1k — 1–2 positions max, single concentrated bet.
- **Fees are a proportionally big drag** (~$1/contract/leg to open; ~10% of a small credit).
- **Conclusion:** $1k works as a *learning/tuition* operation (1-wide, 1-contract, SPY/IWM, 1–2 positions). The strategy's diversification + sizing only breathe at ~$5–10k+. **Build & validate in the free sandbox** (fake balance, account size irrelevant); fund small real money only once trusted; scale up later. The risk-gate parameters are just a config re-seed for whatever the account size is.
