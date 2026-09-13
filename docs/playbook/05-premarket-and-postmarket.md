# 05 — Pre-Market and Post-Market Signals

**Scope:** What to observe between 4:00 and 9:30 ET (pre-market) and 4:00 to 8:00 ET (post-market) when running a 7–14 DTE, defined-risk options book (credit spreads, debit spreads, iron condors, butterflies) on SPY / QQQ / IWM / XSP-class underlyings, in a ~$2,500 tastytrade account.

**How to read this file:** Every rule is written as `IF <condition> THEN <action>`. Numbers marked **[sourced]** come from a cited document in `## Sources`. Numbers marked **[policy]** are conservative operating thresholds chosen for this account size; they are *not* empirical findings and may be tuned after 100+ logged trades. All times are US Eastern (ET) unless stated.

---

## 0. Session Map (all times ET)

| Window | What is open | Why it matters |
|---|---|---|
| Sun 18:00 → Fri 17:00 (daily break 17:00–18:00) | CME ES / NQ / RTY futures and Cboe VX (VIX) futures **[sourced]** | Continuous price discovery for the index; the only reliable "where will SPY open" signal overnight. |
| 20:15 (prior evening) → 09:25 | Cboe **Global Trading Hours (GTH)** for SPX, XSP, VIX options **[sourced: Cboe SPX spec]**. (Older Cboe/Morgan Stanley disclosure lists 09:15; the current Cboe spec page lists 09:25 — treat 09:15–09:25 as the end-of-GTH band and confirm on cboe.com.) | Index options *do* have overnight quotes; equity/ETF options (SPY, QQQ, IWM) **do not** trade pre-market. |
| 04:00 → 09:30 | US equity pre-market (Nasdaq, Arca, etc.) **[sourced: Bloomberg Tradebook]** | SPY/QQQ pre-market prints; thin volume, wide spreads. |
| 08:30 | Primary macro release slot (CPI, PPI, NFP, jobless claims, GDP, PCE, retail sales) **[sourced: BLS/BEA/DOL]** | The single most important pre-open timestamp. |
| 09:30 → 16:00 | Regular session (equity options 09:30–16:00; SPY/QQQ/IWM and ~45 other ETF/index options to **16:15**) **[sourced: Nasdaq options hours]** | Only window in which the bot may place spread orders (see file 06). |
| 10:00 | Secondary release slot (ISM, JOLTS, UMich sentiment, new home sales, etc.) | Intraday shock risk 30 minutes after the open. |
| 14:00 / 14:30 | FOMC statement / Chair press conference on decision days **[sourced: Fed calendar; Option Alpha]** | Largest scheduled intraday vol event. |
| 15:50 → 16:00 | NYSE closing-auction imbalance publication and MOC/LOC cutoff **[sourced: NYSE fact sheet]** | Explains late-day whips; avoid placing new spread orders here. |
| 16:00 → 16:15 | Extended equity-option session for SPY/QQQ/IWM; SPX/XSP curb 16:15–17:00 **[sourced]** | Last chance to close ETF spreads on expiration day; index curb session exists but is thin. |
| 16:00 → 20:00 | US equity after-hours; mega-cap earnings typically 16:05–16:30 | Overnight gap risk for open positions. |

---

## 1. Pre-Market (04:00 – 09:30 ET)

### 1.1 Futures: overnight change and range

Use front-month **ES** (S&P 500), **NQ** (Nasdaq-100), **RTY** (Russell 2000) as proxies for SPY, QQQ, IWM. Read these three numbers at each checkpoint (06:00, 08:00, 08:35, 09:15 ET) **[policy]**:

1. `overnight_chg_pct` = (ES now − ES at prior 16:00 ET cash close) / ES cash close.
2. `overnight_range_pct` = (overnight high − overnight low) / prior cash close.
3. `implied_gap_pct` ≈ `overnight_chg_pct` (ES and SPY track closely pre-open; basis is small at 7–14 DTE horizons).

**Significance thresholds — compare to the daily expected move, not to a fixed %:**

- `EM_1d` (1-day expected move) = `SPY_close × IV_atm × sqrt(1/365)`; equivalently `VIX/16` gives the ~1-SD daily move in % (VIX 16 → ~1%/day; VIX 24 → ~1.5%; VIX 32 → ~2%) **[sourced: Schwab "Rule of 16"; OAS expected-move formula]**.
- Alternative: `EM_1d ≈ 1.25 × ATM straddle price` of the nearest expiry (straddle ≈ 0.80 × 1-SD move under Black-Scholes) **[sourced: OAS]**.

| Gap classification **[policy, using sourced EM math]** | Condition | Action |
|---|---|---|
| Noise gap | `abs(implied_gap_pct) < 0.25 × EM_1d` | No change to plan. |
| Normal gap | `0.25 × EM_1d ≤ abs(gap) < 0.75 × EM_1d` | Re-check every open position's short-strike distance (Section 1.9). New entries allowed after 10:00 ET. |
| Significant gap | `0.75 × EM_1d ≤ abs(gap) < 1.5 × EM_1d` | No new entries before 10:30 ET. Any position whose short strike is now within `0.5 × EM_1d` of the projected open goes on the "close at open" list. |
| Shock gap | `abs(gap) ≥ 1.5 × EM_1d` (roughly ≥ 1.5% when VIX ≈ 16) | No new entries today. Close any position whose short strike is projected ITM or within `0.25 × EM_1d` of price, at the first liquid print after 09:35 ET. |

**Gap-fill statistics (SPY, same-day fill = price touches prior close)** **[sourced: TradeThatSwing, rolling 6-month sample updated Jul 30 2026]:**

| Gap size | Gap-up filled same day | Gap-down filled same day |
|---|---|---|
| 0–0.19% | 82% | 83% |
| 0.20–0.39% | 58% | 65% |
| > 0.40% | ~37% | ~50% |

- Of gaps that did fill, **89% filled by noon ET** **[sourced: TradeThatSwing]**.
- For **1%+ gaps** (QQQ, 1999–2023 and last-5-year samples) **[sourced: SharePlanner]:** 1.00–1.99% gaps filled intraday ~45%; 2%+ gaps filled ~30–33%; 1%+ gaps fill within two days ~53% (ups) / ~57% (downs). Gap-ups drifted −0.2% to −0.5% open-to-close on average; gap-downs recovered +0.21% on average.
- **Interpretation rule:** a sub-0.4% gap is more likely than not to be faded by noon; a 1%+ gap is more likely than not to *hold* through the day. Do not treat a 1%+ adverse gap as "it'll come back."

### 1.2 VIX futures and VIX pre-open indication

- VX futures trade the same near-24h schedule as ES **[sourced: tastytrade futures hours]**. The cash VIX is not published until SPX options quote; use the front VX contract and the SPX GTH option quotes as the pre-open indication.
- Rules **[policy]:**
  - `VX_front_chg_pct ≥ +10%` overnight → treat the day as "Significant gap" regardless of ES.
  - `VX_front_chg_pct ≥ +20%` overnight → treat as "Shock gap".
  - Term structure: if `VX_front > VX_second` (backwardation) at 08:00 ET → no new short-premium entries that day; existing positions are reviewed at every checkpoint.

### 1.3 Pre-market volume in SPY / QQQ

- Pre- and post-market sessions together are only ~8% of daily volume for >10M-ADV names on active days, and spreads/NBBO sizes "vary greatly" **[sourced: Bloomberg Tradebook]**. Pre-market SPY prices are informative for *direction*, not for *execution*.
- Rule **[policy]:** compare SPY cumulative pre-market volume at 09:15 ET to its 20-day pre-market average. `≥ 2×` average with a gap ≥ Significant → upgrade one severity tier. Low volume plus a big ES move = the gap is being priced off futures, not off flow; expect a fast re-pricing at 09:30.

### 1.4 Overseas sessions

Read at 06:00 ET (Asia closed, Europe open) and 08:00 ET:

- Asia (Nikkei/Hang Seng/Shanghai/KOSPI): only matters for the US book if the move is ≥ 2% **and** ES is moving with it **[policy]**.
- Europe (Stoxx 600 / DAX): trades concurrently with US pre-market; European close is 11:30 ET (a known intraday liquidity step-down in US futures). A Europe ≥ 1.5% move with ES ≥ Significant gap → confirm the gap classification; Europe alone is never a reason to enter.

### 1.5 Rates, dollar, oil

Track 10-year Treasury yield (basis-point change), DXY, and WTI crude. These are context, not triggers **[policy]:**

- 10Y move ≥ 10 bp overnight, or oil ≥ 3%, or DXY ≥ 0.7% → add a note to the day's log; if it coincides with a Significant gap, raise to Shock handling.
- On CPI/NFP/FOMC days, the 10Y reaction in the first 5 minutes is the fastest read on whether equities will trend or fade.

### 1.6 The 08:30 ET release slot

All of the following print at **08:30 ET** unless noted **[sourced: BLS, BEA, DOL, FedRateCalc]:**

| Release | Agency | Cadence / day rule | Pre-open handling |
|---|---|---|---|
| Employment Situation (NFP) | BLS | Monthly, usually the first Friday (can slip to the second Friday around holidays or after government shutdowns; 2026 examples: Feb 11, Jul 2, Oct 2) | Tier 1 (see file 07). No entries before 10:00; treat as Significant gap minimum. |
| CPI | BLS | Monthly, ~10th–15th; see `bls.gov/schedule/news_release/cpi.htm` | Tier 1. Same handling as NFP. |
| PPI | BLS | Monthly, usually the day after or a few days after CPI | Tier 2. |
| Initial jobless claims | DOL ETA | **Every Thursday 08:30**; moved one day earlier in holiday weeks (e.g., Wed Nov 25 2026) | Tier 3, unless the market is trading off labor data (then Tier 2). |
| GDP (advance / second / third) | BEA | Quarterly; advance ≈ last week of Jan/Apr/Jul/Oct | Advance = Tier 2; revisions = Tier 3. |
| PCE (Personal Income & Outlays) | BEA | Monthly, typically last week of month | Tier 2. |
| Advance Retail Sales | Census | Monthly, mid-month | Tier 2. |

**Realized-move context** (SPX, 12-event samples ending Dec 2023) **[sourced: Russell Rhoads]:** average CPI-day move ±0.64% vs ±1.07% for ordinary days in that window — i.e., CPI days were *not* larger than normal in that sample, while FOMC days averaged ±1.20% vs ±0.84%. Straddles on CPI/FOMC underpriced the realized move in several of the last observations. **Do not assume events always produce large moves; assume they produce *uncertain* ones and size accordingly.**

### 1.7 The 10:00 ET release slot

ISM Manufacturing PMI (first business day of the month), ISM Services PMI (third business day), JOLTS (BLS, ~first week, 10:00), University of Michigan sentiment (prelim mid-month Friday, final at month-end Friday), Consumer Confidence (Conference Board, last Tuesday), new/pending home sales **[sourced: FedRateCalc for JOLTS 10:00; ISM calendar behind login — verify]**.

Rule **[policy]:** on a 10:00 release day, the "after the open" entry window starts at **10:05** rather than 10:00, and the bot must wait for a full 5-minute bar after the print before pricing an entry.

### 1.8 FOMC days (14:00 statement, 14:30 press conference)

- 8 scheduled meetings per year; the Summary of Economic Projections ("dot plot") accompanies the **March, June, September, December** meetings; minutes are released **3 weeks** after each decision **[sourced: Federal Reserve calendar]**.
- SPX moved ~2.0% on average on FOMC days vs ~1.25% on non-FOMC days in an Option Alpha sample from 2022; the day *after* FOMC ran ~1.6% vs ~1.3% the day before, and SPX closed down the next day 66.7% of the time in that sample **[sourced: Option Alpha]**. A separate 12-meeting sample (Jun 2022–Dec 2023) shows ±1.20% vs ±0.84% **[sourced: Rhoads]**. Range: **1.2%–2.0% average absolute FOMC-day move** depending on sample.
- Pre-open rule **[policy]:** no new entries on FOMC day at all. Positions with short strikes inside `1.0 × EM_1d` at 13:45 ET are closed before 13:55 ET.

### 1.9 Pre-market earnings from index heavyweights

- Top-10 SPY weights (May 2026): NVDA 8.00%, AAPL 6.68%, MSFT 4.87%, AMZN 4.25%, GOOGL 3.67%, AVGO 3.19%, GOOG 2.93%, META 2.12%, TSLA 1.78%, BRK.B 1.36%; **top 10 ≈ 39% of SPY** **[sourced: Investing Engineer]**. QQQ concentration in the same names is higher.
- Most mega-cap tech reports **after** the close (Section 2.1). Names that commonly report **pre-market** and can move the index open: JPM/BAC/WFC/C (kick off each earnings season, typically the second week after quarter end), UNH, JNJ, PG, KO, PEP, CAT, HD, WMT, GS, MS **[policy list — verify each quarter via `tastytrade_get_earnings_reports` or a calendar API]**.
- Rule **[policy]:** a single name reports pre-market → weight × expected move gives an approximate index contribution: `index_impact ≈ weight × implied_earnings_move`. If `index_impact ≥ 0.15%` (e.g., an 8% name moving 2%) treat the open like a Normal gap even if ES is flat; if two or more such names report the same morning, raise to Significant.

### 1.10 How options are priced before the open

- **Equity/ETF options (SPY, QQQ, IWM) do not trade pre-market.** The first quotes appear at 09:30 and are typically wide for the first minutes. There is no pre-market IV to read; infer it from SPX/XSP GTH quotes and VX futures.
- **SPX / XSP / VIX options have GTH 20:15–09:25 ET and a curb session 16:15–17:00 ET** **[sourced: Cboe spec; Morgan Stanley disclosure]**. Disclosed risks: fewer market makers, wider spreads, prices that "may not reflect" either the prior close or the next regular-session open, and index values that may not be disseminated **[sourced: MS disclosure]**.
- Rule **[policy]:** the bot never *executes* in GTH or curb. GTH quotes are inputs only (mid-price of the XSP ATM straddle ≈ pre-open EM).

### 1.11 IV behavior around scheduled events (event vol premium and crush)

- Options that span a known event carry extra implied volatility; short-dated ATM options carry the most, and after the event this premium collapses ("IV crush") even if the direction was right **[sourced: SpotGamma IV Crush; OAS expected move]**.
- For index events (CPI/FOMC), the relevant "event straddle" is the nearest expiry that includes the event. In Vol Vibes' 2023–2024 CPI sample, overnight straddles were net winners on soft prints while the post-CPI regular-session straddles were net losers — i.e., the market tended to *over*-price the intraday post-event move and *under*-price the overnight/pre-open gap **[sourced: Vol Vibes]**.
- **Implication for 7–14 DTE credit trades [policy]:** entering the day *after* a Tier 1 event (once crush has happened) is lower-IV but also lower-uncertainty; entering the day *before* collects the event premium but bears the gap. This book's rule (file 07) is: **no new entries within 24 hours before a Tier 1 event; entries permitted from 10:00 ET the day after.**

### 1.12 Pre-market checklist (run 08:00, 08:35, 09:15 ET)

```
PM-1  Load today's calendar (file 07). Tier 1 event today?           → YES: no_new_entries=true
PM-2  Any Tier 1 event within next 24h?                              → YES: no_new_entries=true
PM-3  ES/NQ/RTY overnight_chg_pct and overnight_range_pct recorded.
PM-4  EM_1d computed (VIX/16 or 1.25×ATM straddle from XSP GTH).
PM-5  Gap class = {Noise, Normal, Significant, Shock} per §1.1.
PM-6  VX front-month change ≥ +10% → upgrade to Significant; ≥ +20% → Shock.
PM-7  VX term structure in backwardation → no_new_entries=true.
PM-8  For every open position: projected_open vs short strikes.
        distance_pct = (short_strike − projected_open)/projected_open
        IF abs(distance_pct) < 0.5×EM_1d → add to close_at_open list
        IF short strike projected ITM        → add to close_at_open list (priority)
PM-9  Pre-market earnings from ≥5% index weights? Compute index_impact.
PM-10 10:00 release today? entry_window_start = 10:05 else 10:00.
PM-11 Write all of the above to the day log before 09:25.
```

---

## 2. Post-Market (16:00 – 20:00 ET)

### 2.1 After-hours earnings from mega-caps

- Names whose after-hours report can move SPY/QQQ by itself: NVDA, AAPL, MSFT, AMZN, GOOGL/GOOG, META, AVGO, TSLA (together ≈ 33% of SPY at May-2026 weights) **[sourced weights: Investing Engineer]**. Reports typically hit 16:01–16:30 ET; the call follows 30–60 minutes later.
- Rule **[policy]:** if any name with SPY weight ≥ 2% reports after the close, then for every open position compute `stress_move = weight × 10%` (a 10% single-name move is a reasonable stress for mega-cap earnings) and check whether `projected_SPY = close × (1 ± stress_move)` breaches a short strike. If yes, the position is on the next morning's `close_at_open` list *before* the report prints. If the position can be closed at ≥ 25% of max profit before 15:55 on the report day, close it.

### 2.2 After-hours futures

ES/NQ/RTY resume at 18:00 ET after the 17:00–18:00 break **[sourced: tastytrade futures hours]**. Record ES at 18:05 and 20:00 ET. `after_hours_chg_pct` ≥ 0.5 × EM_1d → flag for the 06:00 checkpoint; ≥ 1.0 × EM_1d → pre-populate the `close_at_open` list **[policy]**.

### 2.3 Closing auction / imbalance data

- NYSE publishes the MOC/LOC regulatory imbalance at **15:50**, then informational imbalance every second; MOC/LOC entry closes at 15:50, D-orders join the imbalance at 15:55, no cancels after 15:58 **[sourced: NYSE closing fact sheet]**.
- Closing-auction share of volume has grown from ~12% of ADV (2011) to >25% in recent years; index rebalance days are the largest closes of the year **[sourced: Nasdaq]**.
- Rule **[policy]:** the bot does not open spreads between 15:45 and 16:00. Large published imbalances (e.g., > $2B to buy or sell in S&P names) explain, but do not predict, the last-10-minute move; log them, do not trade them.

### 2.4 VIX close and daily change rules

- VIX–SPX daily correlation ≈ −0.70 (percentage changes) over 1990–2022; VIX and SPX move the same direction ~1 day in 5. VIX tends to fall into Friday's close (only 37% of Fridays are VIX-up) and rise on Mondays (62% up) because the weekend is priced out on Friday and back in on Monday **[sourced: Macroption]**. So a Friday VIX drop of a few percent is *not* a bullish signal, and a Monday rise is *not* by itself bearish.
- Rules **[policy]:**

| Condition at 16:00 ET | Regime flag | Action for next session |
|---|---|---|
| VIX daily change ≤ +10% | Normal | Standard rules. |
| +10% < VIX change ≤ +20% | Caution | New entries only after 10:30; position size 50% of normal. |
| VIX change > +20% **or** VIX close ≥ 30 | Stress | No new entries next session. Review every position at the 06:00 checkpoint. |
| VIX change ≤ −10% (post-event crush) | Post-event | Entries allowed; note that credit collected will be lower. |

### 2.5 End-of-day breadth

Record: NYSE/Nasdaq advance–decline ratio, % of S&P 500 above 20-day and 50-day averages, and up-volume/down-volume ratio. Rule **[policy]:** a day where SPY closes +/−0.5% but breadth is opposite-signed (e.g., index up, A/D < 0.8) is logged as "narrow"; two consecutive narrow days = raise the gap-classification by one tier next morning. This is a logging/awareness rule, not a trade trigger.

### 2.6 Next-day economic calendar review

At 16:30 ET pull the next trading day's calendar (file 07 §"Sourcing the calendar"). Populate: `tier1_tomorrow`, `tier2_tomorrow`, `release_times[]`, `earnings_before_open[]`, `earnings_after_close_today[]`, `is_opex`, `is_vix_expiry`, `is_early_close`. These flags drive the morning checklist.

### 2.7 Short-strike distance vs after-hours move

For each open position at 18:05 and 20:00 ET **[policy]:**

```
proj = SPY_close × (1 + ES_after_hours_chg_pct)
for each short strike K:
    d = (K − proj)/proj  (sign by side)
    IF d ≤ 0                → ITM projected → close_at_open (priority 1)
    IF 0 < d < 0.25×EM_1d   → close_at_open (priority 2)
    IF 0.25×EM ≤ d < 0.5×EM → review at 09:35, close if still inside 0.5×EM
```

Remember American-style SPY/QQQ/IWM short options can be assigned early if deep ITM near an ex-dividend date (SPY ex-div is normally the third Friday of Mar/Jun/Sep/Dec — the same day as quarterly opex). Never carry a short ITM call on SPY/QQQ/IWM through an ex-dividend date.

### 2.8 Expiration-day after-hours risk (for positions expiring today)

- SPY/QQQ/IWM options trade until **16:15** on every day including expiration **[sourced: Nasdaq options hours]**; XSP/SPXW expire on the close and stop trading at **16:00** (13:00 on half-days) **[sourced: Cboe SPX/XSP specs]**.
- OCC exercises by exception any option **≥ $0.01 ITM** versus the 16:00 closing price; holders can still submit contrary (exercise / do-not-exercise) instructions to their broker until the broker's cutoff, and a stock moving ITM in the extended session can still be exercised by the holder **[sourced: OIC; Public.com]**. Therefore a short SPY option that was $0.20 OTM at 16:00 can still be assigned if SPY moves through it by ~17:30.
- Rule **[policy, see file 06 for the full expiration policy]:** never hold a SPY/QQQ/IWM spread into the last 60 minutes of expiration day. Close by 15:00 ET at the latest.

### 2.9 What to prepare for the next open

1. `close_at_open` list with priorities and limit prices (start at mid − 10% of width for closes, see file 06).
2. `no_new_entries` flag and `entry_window_start` time.
3. Tomorrow's `EM_1d` estimate (from VIX close ÷ 16) and, at 06:00, the GTH XSP straddle cross-check.
4. Candidate list for new entries with target expirations (file 06 §Day-of-week) and required credit (file 04/strategy files).
5. Buying-power check: total BPR in use must stay ≤ 01 RULE S3 (30 % of NLV; 20 % when VIX ≥ 30) and each new position ≤ RULE S1 (5 % of NLV max loss); no entry that would exceed either is queued.

### 2.10 Post-market checklist (run 16:20 and 20:00 ET)

```
AM-1  Record SPY/QQQ/IWM close, VIX close, VIX % change → regime flag (§2.4).
AM-2  Record breadth (A/D, % above 20d/50d) → narrow-day flag.
AM-3  Pull tomorrow's calendar; set tier flags, opex/VIX-expiry/early-close flags.
AM-4  List after-hours reporters with SPY weight ≥ 2%; run stress_move check.
AM-5  At 18:05 and 20:00: ES after-hours change; run §2.7 distance check.
AM-6  Any position expiring within 2 trading days? → schedule close (file 06).
AM-7  Any position at ≥ 50% max profit at the close? → queue close order for 09:35 (or earlier if it was already working).
AM-8  Any position at ≥ 2× credit loss (credit spreads/IC) or ≥ 50% of debit lost (debit spreads)? → queue close at open.
AM-9  Write P/L, Greeks (net delta, theta, vega per position and total) to the log.
AM-10 Set no_new_entries / entry_window_start / size multiplier for tomorrow.
```

---

## 3. Facts that could not be verified (flag for Geoff)

- tastytrade's help-center pages (expiration-risk policy, DNE cutoff, market-hours page) are JavaScript-rendered and could not be fetched here; the exact tastytrade close-out time on expiration day is therefore **not stated** in these files. Confirm at `support.tastytrade.com` article IDs 43000484765 / 43000484774 / 43000472843.
- The end of SPX/XSP GTH is listed as 09:15 ET in an older Cboe/Morgan Stanley disclosure and 09:25 ET on the current Cboe SPX/XSP spec pages; the spec page is treated as current.
- ISM's release-date calendar sits behind a login; the "first business day / third business day at 10:00" rule is the long-standing convention but was not fetched from ISM directly.
- Gap-fill statistics are from a rolling 6-month retail-sourced sample and a QQQ 1999–2023 study; they are directional guidance, not a validated edge.

## Sources

- Cboe SPX product specifications (trading hours, GTH 20:15–09:25 ET, curb, last trading times): https://www.cboe.com/tradable_products/sp_500/spx_options/specifications/
- Cboe XSP product specifications (hours, PM cash settlement, last trade 3:00 pm CT): https://cboe.com/tradable-products/sp-500/xsp-options/specifications
- Morgan Stanley / Cboe Global Trading Hours disclosure (GTH & curb risks): https://www.morganstanley.com/content/dam/msdotcom/en/assets/pdfs/sales_and_trading_disclosures/Cboe_Global_Trading_Hours_Disclosure.pdf
- Nasdaq options market hours (ETF options to 4:15 pm ET list): https://www.nasdaqtrader.com/Trader.aspx?id=optionshours
- tastytrade futures market hours (ES/NQ/RTY/VX 6 pm–5 pm ET, daily break): https://tastytrade.com/learn/trading-products/futures/futures-market-hours/
- Schwab, Rule of 16: https://www.schwab.com/learn/story/options-volatility-vix-skew-and-rule-16
- Options Analysis Suite, expected-move formulas (IV-based; straddle × 1.25): https://www.optionsanalysissuite.com/documentation/expected-move
- TradeThatSwing SPY gap-fill statistics: https://tradethatswing.com/sp-500-spy-es-gap-fill-strategy-and-statistics/
- SharePlanner, SPY/QQQ 1%+ gap behavior: https://www.shareplanner.com/blog/strategies-for-trading/fading-the-gap-how-large-overnight-moves-in-spy-and-qqq-play-out-during-the-trading-day.html
- Bloomberg Tradebook, pre/post-market trading analysis: https://assets.bbhub.io/professional/sites/10/imported/tradebook/sites/6/636724344-Pre-Post-Market-Trading-Analysis.pdf
- BLS Employment Situation schedule: https://www.bls.gov/schedule/news_release/empsit.htm
- BLS release calendar and ICS feed: https://www.bls.gov/schedule/
- BEA release schedule (GDP, PCE at 8:30; JSON/ICS): https://www.bea.gov/news/schedule
- Initial jobless claims release rule (Thursday 8:30, holiday shifts): https://www.cmelitegroup.com/trends-and-insights/initial-jobless-claims-release-time-schedule-and-what-the-weekly-data-measures/
- FedRateCalc US economic calendar (release times by agency): https://fedratecalc.com/us-economic-calendar/
- Federal Reserve FOMC calendar (8 meetings, SEP quarters, minutes +3 weeks): https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- Option Alpha, FOMC day statistics: https://optionalpha.com/blog/trading-the-fomc-meeting-0dte-next-day-strategies
- Russell Rhoads, SPX moves on CPI and FOMC days: https://russellrhoads.substack.com/p/historical-index-and-option-price
- Vol Vibes, CPI straddle performance 2023–2024: https://volvibes.substack.com/p/cpi-update-spx-and-spx-options
- SpotGamma, IV crush mechanics: https://spotgamma.com/iv-crush-explained/
- Investing Engineer, SPY top-25 holdings (May 2026): https://investingengineer.com/top-25-holdings-of-spy-by-weight/
- NYSE closing auction fact sheet (3:50 imbalance, cutoffs): https://www.nyse.com/publicdocs/nyse/NYSE_Auctions_Closing_Process_Fact_Sheet.pdf
- Nasdaq, closing-auction volume growth and Russell reconstitution: https://www.nasdaq.com/articles/what-to-know-about-the-annual-russell-index-changes
- Macroption, VIX–SPX correlation and weekday pattern: https://www.macroption.com/vix-spx-correlation/
- OIC, options exercise FAQ ($0.01 threshold, 4:30 pm CT exchange cutoff): https://www.optionseducation.org/referencelibrary/faq/options-exercise
- Public.com, expiration/exercise FAQ (after-hours exercise risk, DNE cutoff example): https://help.public.com/en/articles/8460531-understanding-option-expiration-exercise-and-assignment
- Option Alpha, 0DTE expiration times: https://optionalpha.com/learn/0dte-expiration
