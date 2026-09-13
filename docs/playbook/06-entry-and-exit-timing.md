# 06 — Entry and Exit Timing for 7–14 DTE Defined-Risk Spreads

**Scope:** Intraday timing, day-of-week timing, order-entry mechanics, profit targets, stop-losses, time-based exits, breach handling, expiration mechanics, and trade logging for credit spreads, debit spreads, iron condors and butterflies held 7–14 DTE on SPY / QQQ / IWM / XSP, in a ~$2,500 tastytrade account.

**Conventions:** `IF … THEN …` rules. **[sourced]** = number comes from a cited document. **[policy]** = an operating threshold set for this account; not an empirical finding. Times are ET. `credit` = net credit received at entry; `width` = distance between strikes of a vertical (max loss = width − credit for a credit vertical; for an iron condor, max loss = wider wing − total credit).

---

## 1. Intraday timing

### 1.1 Evidence

- Intraday spread behavior in a large exchange sample: bid-ask spread is "wide at the open, constant through the day and rises slightly at the close," while volatility is U-shaped (high at open and close, low midday) **[sourced: Journal of Business Finance & Accounting 1997, LSE stocks]**. This is the empirical basis for "avoid the first minutes and the last minutes."
- Retail education sources consistently describe: first 30–60 minutes = high volume, wide option spreads; midday = lull with "lower volume and unclear direction"; last hour = renewed liquidity, "the day's trend is clearer"; and advise waiting "a few minutes" after the open for spreads to tighten **[sourced: Option Samurai — descriptive, no measurements]**.
- The NYSE close: MOC/LOC imbalance published at 15:50, informational imbalance every second thereafter, D-orders included at 15:55, no cancels after 15:58 **[sourced: NYSE closing fact sheet]**. The closing auction has grown to >25% of ADV **[sourced: Nasdaq]**. Prices in 15:50–16:00 are auction-driven, not option-flow-driven.
- Option Alpha's TLT iron-condor case study (31,000 quotes in one day) found three of four legs' spreads moving "in lockstock" while one leg was erratic — i.e., a 4-leg complex order can be held hostage by a single leg's quote **[sourced: Option Alpha]**.

### 1.2 Intraday windows and rules **[policy, built on the evidence above]**

| Window (ET) | Character | New entries? | Exits? |
|---|---|---|---|
| 09:30–09:45 | Opening auction, widest option spreads, gap re-pricing | **No** | Only `close_at_open` priority-1 items (projected ITM); use limit at mid, re-price every 30 s |
| 09:45–10:00 | Spreads tightening; 10:00 data risk | No | Priority-2 closes allowed |
| **10:00–11:30** | Primary entry window: direction after data, spreads normal, Europe still open (Europe closes 11:30) | **Yes** (start 10:05 on 10:00-release days) | Yes |
| 11:30–14:00 | Lunch lull; lower volume, choppy; fills slower but not worse | Yes, second choice | Yes |
| 14:00–15:00 | FOMC-day event window; otherwise normal | Yes (never on FOMC day) | Yes |
| **15:00–15:45** | "Power hour"; liquidity returns; trend of day visible; good for *closing* and for entering positions that expire ≥ 7 trading days out | Yes (last entry accepted 15:30) | **Preferred exit window** for scheduled closes |
| 15:45–16:00 | Closing imbalance drives price; option quotes lag | **No** | Emergency only |
| 16:00–16:15 | SPY/QQQ/IWM options still trade; underlying prints thin | No | Only if forced (expiration day, see §7) |

Hard rules:
1. `entry_allowed = 10:00 ≤ t ≤ 15:30` and none of the block flags from files 05/07 is set.
2. Scheduled exits (profit target hit, DTE exit) run at the first opportunity but are *preferred* in 10:00–11:30 or 15:00–15:45.
3. Stop-loss exits run immediately, any time in 09:30–16:00, using the order-walking rules below.

---

## 2. Order-entry mechanics

### 2.1 Never market orders on spreads

A multi-leg market order is filled against the worst side of each leg. Given the observed leg-by-leg spread instability **[sourced: Option Alpha]**, this can cost more than the entire edge of a 7–14 DTE credit trade. **Rule: order_type ∈ {LIMIT} only. Market orders and stop-market orders on spreads are prohibited.**

### 2.2 Start at mid, walk toward the natural

tastytrade's own help-center pages on limit orders were not fetchable (JS-rendered); the following is the widely-taught practice and is adopted as policy **[policy]**:

```
mid   = (bid + ask)/2 of the complex (spread) quote
nat   = natural price (bid for a credit you are selling; ask for a debit you are buying)
step  = $0.01 for SPY/QQQ/IWM/XSP verticals ≤ $5 wide; $0.05 for wider/less liquid
OPEN (sell credit spread / buy debit spread):
    t0:   limit = mid
    +45s: limit = mid − 1 step   (credit) / mid + 1 step (debit)
    +90s: limit = mid − 2 steps
    +135s: limit = mid − 3 steps
    STOP walking when give-up ≥ max(  $0.03,  10% × width  ) for credit spreads
                            or  ≥ 15% of the target credit, whichever is smaller in $.
    IF not filled at the stop → cancel; retry once after 5 min; else skip the trade.
CLOSE (buy back credit spread):
    profit-target close: same walk, give-up cap 10% × width.
    stop-loss close:     start at mid, step every 20s, give-up cap 25% × width, then pay nat.
    expiration-day forced close: start at mid, step every 15s, no cap — pay nat if needed.
```

Rationale: for a $2-wide SPY vertical collecting $0.60, giving up more than $0.06–0.09 (10–15%) makes the trade uneconomic; but on a stop-loss the cost of *not* filling is unbounded, so the cap rises.

### 2.3 Complex order handling

- Always send the position as one complex (multi-leg) order so the fill is atomic; never leg in or leg out of a defined-risk position (legging creates an undefined-risk interval).
- Re-price against the *live* complex mid, not the mid at t0 — if the underlying moves against you during the walk, cancel and re-evaluate rather than chase.
- Minimum liquidity gate: the canonical thresholds are 01-account-and-capital-rules §8 (RULES L1–L6: bid-ask ≤ $0.05 SPY/QQQ, ≤ $0.10 XSP/XND, OI ≥ 500 SPY/QQQ or ≥ 100 index, etc.). If a leg fails, choose a different strike/expiry or switch SPY↔XSP / QQQ↔XND.

---

## 3. Day-of-week timing

### 3.1 Available expirations

SPX, XSP, SPY, QQQ, IWM (and NDX) list expirations **every Monday through Friday** **[sourced: my0dteoptions list; Cboe added SPY/QQQ/IWM Tuesday & Thursday weeklies in Nov 2022]**. So a 7–14 DTE trade can be opened on any weekday and expire on any weekday. Note that near-term listings are added progressively (Cboe's 2022 notice lists Mon–Thu weeklies only when within ~15 days), so the 8–14 DTE non-Friday expirations exist but may be thinner than the Friday of the same week.

### 3.2 Weekend theta: is it real?

Three sourced views; they partially disagree:

| Source | Finding |
|---|---|
| Moontower (Kris Abdelmessih) | The "weekend effect" is largely a day-count artifact: market makers effectively weight weekend days at ~0.5 of a business day, so options *do not* decay over the weekend as much as a 365-day model implies. "This is not free money" — weekend gaps are larger in absolute terms. **[sourced]** |
| OptionMetrics (1DTE SPX put-write, Mar 2018–Sep 2025) | Monday-expiring (sold Friday) put-writes returned a mean 7.3 bp vs. other days; in the 0DTE era (May 2022–Sep 2025) 11.3 bp, ~3.25 bp better than other weekdays (95% CI 0.48–6.94 bp, p<0.05). Excluding Mondays cut cumulative return 68% and Sharpe 54%; "nearly two-thirds of the strategy's total profitability" came from weekend-spanning options. **[sourced]** |
| Deltaray backtest (2016–2022, 3–4 DTE, enter Fri 15 min before close, exit Mon 15 min after open) | Short put CAGR ~16%, max DD ~35%; short strangle CAGR 21.1%, max DD −30.1%, Sharpe 1.02; Monday-to-Friday control had drawdowns >50%. **[sourced]** |
| Macroption (VIX by weekday, 1990–2022) | VIX falls into Friday's close (37% up-days) and rises Monday (62% up-days) as the weekend is priced out/in. **[sourced]** |

**Reconciliation:** the weekend is *partially* priced into Friday quotes (Moontower, Macroption), and there is still a measurable, statistically significant *risk premium* for carrying short options over the weekend (OptionMetrics), earned by bearing weekend gap risk. It is a premium for risk, not free theta.

**Rule for this book [policy]:** with a $2,500 account and defined risk, weekend gap risk is acceptable *only* if the short strike is ≥ 1.0 × the 3-day expected move away (`EM_3d = SPY × IV × sqrt(3/365)`). Friday entries are allowed under that condition; otherwise prefer Monday–Wednesday entries.

### 3.3 Day-of-week rules **[policy]**

| Entry day | Target expiration for 7–14 DTE | Notes |
|---|---|---|
| Monday | Wed/Thu/Fri of next week (9–11 DTE) or Mon of the week after (14 DTE) | Preferred. Full week of price discovery before the weekend; can exit before Friday. |
| Tuesday | Thu/Fri next week (9–10 DTE) | Preferred. |
| Wednesday | Fri next week (9 DTE) or Mon/Tue week after (12–13 DTE) | Acceptable. Avoid if Wednesday is FOMC day. |
| Thursday | Mon–Fri week after (11–15 DTE) | Acceptable; weekend is inside the hold regardless. |
| Friday | Mon–Fri week after (10–14 DTE) | Allowed only if `short_strike_distance ≥ 1.0 × EM_3d`; entry after 10:00, not into the close. |

Expiration-day choice:
- Prefer expirations that are **not** a Tier 1 event day (file 07) and **not** monthly opex (3rd Friday) or quad witching — pin/rebalance flows are largest then **[sourced: SpotGamma OPEX; TradeStation quad witching]**.
- Prefer **Wednesday or Friday** expirations for SPY/QQQ/IWM because they carry the most open interest (Monday/Wednesday/Friday weeklies predate Tue/Thu, which were added Nov 2022 **[sourced: Cboe]**). This is a liquidity preference, not an edge.
- Because the book *never holds to expiration* (§6), the expiration day matters mainly for liquidity at the planned exit 1–3 DTE earlier: choose an expiration whose exit day is not a Tier 1 event day.

### 3.4 Do not open the day before big events

`IF tier1_event within next 24h THEN entry_allowed = false` (file 07). This includes the afternoon before CPI/NFP (08:30 next day) and the entire FOMC day.

---

## 4. Profit targets

### 4.1 Evidence

**projectfinance iron-condor study (SPY, Jan 2007–Mar 2017, 71,417 trades, ~45 DTE entries, 1 contract)** **[sourced]:**

16-delta short / 5-delta long (≈68% POP):

| Management | Win rate | Avg days held | Comment |
|---|---|---|---|
| Hold to expiration | ~65% | ~35 | Highest avg P/L, highest 90th-pct loss |
| 25% profit | ~75% | ~17 | |
| 50% profit | ~72% | ~22 | |
| 75% profit | ~70% | ~25 | |
| −100% loss stop | ~63% | ~25 | Lower losses |

Commission-adjusted, 45-day-normalized P/L: "50–75% profit target approaches stood out the most."

30-delta short / 16-delta long (≈40% POP):

| Management | Win rate | Avg days held |
|---|---|---|
| Hold to expiration | ~40% | ~38 |
| 25% profit | ~65% | ~12 |
| 50% profit | ~60% | ~18 |
| 75% profit | ~50% | ~25 |

Commission-adjusted: "25–50% profit target approaches" gave the highest expectancy. Both setups did best when entered in high-VIX environments.

**tastylive** publishes the same conclusion ("managing winners at 50% … can be the sweet spot," improves win rate above the entry POP and "P/L per day") but the fetched tastylive page contains no numbers **[sourced: tastylive Managing Winners]**. Third-party summaries attribute "15–20% better risk-adjusted returns" to the 21-DTE rule and "3–5× higher gamma in the final 21 days" but do not link the underlying study **[sourced: DaysToExpiry — treat as unverified]**.

### 4.2 Adapting to 7–14 DTE

The studies above are 45-DTE entries. At 7–14 DTE the whole trade lives in the window the 45-DTE studies *exit* (≤ 21 DTE), where gamma is highest. Consequences:

- A 50% target is reached faster in calendar days but the position spends its life at higher gamma, so the "loss tail" that 21-DTE management avoids is unavoidable here. The compensation is a *tighter* stop and a *hard* time exit.
- The 30-delta result (best at 25–50%) is the closer analogue for short-DTE credit spreads that necessarily use higher-delta short strikes to collect enough credit.

**Profit-target rules [policy, calibrated to the sourced ranges]:**

| Structure | Primary target | Accelerated target | Notes |
|---|---|---|---|
| Credit vertical (put or call), 7–14 DTE | Close at **50% of max profit** (buy back at ≤ 0.50 × credit) | Close at **25%** if reached within 2 trading days of entry, or if a Tier 1 event falls inside the remaining hold | Working GTC limit placed immediately after fill. |
| Iron condor | 50% of total credit | 25% under the same conditions; also close the *tested* side only if the untested side is worth < $0.05 (then close it too, don't leave a naked wing) | |
| Debit vertical | Close at **50% of max profit** (spread value ≥ debit + 0.5 × (width − debit)) | 25–35% if IV falls > 20% relative after entry | Debit spreads lose to theta if the move doesn't come; time exit is the binding rule. |
| Butterfly (long, debit) | Close at **50–100% gain on debit paid** — do not wait for the peak | 25% if reached within 2 days | Butterfly max value is only realized near expiration, which this book does not hold to. |

Implementation: GTC limit at target placed at fill time (`tastytrade_place_complex_order`, closing side, limit = target). Re-verify the order exists at each checkpoint.

---

## 5. Stop-loss rules

### 5.1 Evidence (short-premium studies; none is an exact 7–14 DTE defined-risk match)

- **projectfinance IC study:** adding a −100% stop to 16-delta condors *lowered* win rate (~63% vs ~65%) but reduced the 90th-percentile loss; loss-management with high-VIX entries had the "highest commission-adjusted P/L expectancy" **[sourced]**.
- **Option Alpha stop-loss backtests (short strangles, 5 configurations):** no-stop beat stop-loss in every configuration for total return and win rate — e.g., 10 DTE / 10-delta: 88.4% vs 85.6% win rate, max DD 4.9% vs 4.5% with a 300% stop; tight 25% stops on 30 DTE cut win rate from ~90% to ~57–67%. Removing stops produced "87% higher annual returns" **[sourced]**. Caveat: undefined-risk strangles, single-name-free SPY-like data; drawdown is *not* reduced in the 70-DTE case (14.8% vs 23.7% with stop).
- **SJ Options replication of the tastytrade "16-delta, 45 DTE, close at 50%, stop at 2× credit" formula (2005–2016):** 65% win rate, avg winner +10%, avg loser −24%; with a 4× stop, 84% win rate, avg loser −36% **[sourced]**.

**Reading across sources:** stops on short premium reduce the size of the worst outcomes and reduce win rate; with *undefined* risk the studies favor no stop or a wide stop; with *defined* risk the wings already cap the loss, so a stop's job is to prevent a *max-loss* outcome, not to cap a tail. Sources disagree on whether stops improve expectancy; they agree stops reduce win rate.

### 5.2 Stop rules for this book **[policy]**

Because max loss on a $2-wide spread is $200 − credit, and 01 RULE S1 caps any single max-loss at 5% of NLV ($125), one uncontrolled max-loss is already the account's whole daily loss budget (01 K2). The stop exists to convert most max-losses into ~1× credit losses. Rules, evaluated every 5 minutes 09:30–16:00 and at the file-05 checkpoints:

| Trigger (any one) | Credit spread / iron condor | Debit spread / butterfly |
|---|---|---|
| **Loss multiple** | Spread mark ≥ **2.0 × credit** (i.e., loss = 1× credit) → close. If `width − credit < 2 × credit` (rich credit), use mark ≥ credit + 0.5 × (width − credit) instead. | Spread mark ≤ **50% of debit paid** → close. |
| **Short-strike delta** | Short option delta ≥ **0.40** (absolute) → close. (Entry deltas are 0.15–0.30; 0.40 means the strike is ~ATM-adjacent.) | Long option delta ≤ 0.20 (directional thesis failed) → close. |
| **Price touch** | Underlying trades at or through the short strike (any print in RTH) → close at the next 1-minute bar. Do not wait for the loss multiple. | n/a |
| **Time** | See §6. | See §6. |
| **Regime** | VIX Stress flag (file 05 §2.4) *and* position is losing → close regardless of multiple. | Same. |

Never use resting stop-market or stop-limit orders on spreads (tastytrade allows stop orders on spreads, but a stop-market becomes a market order — prohibited by §2.1; a stop-limit may not fill). Stops are executed by the bot as fresh limit orders using the §2.2 stop-loss walk.

---

## 6. Time-based exits

### 6.1 Evidence and logic

The tastylive 21-DTE rule for 45-DTE entries exists because gamma rises steeply in the last three weeks and P/L per day flattens; DaysToExpiry's summary cites tastylive as finding "15–20%" better risk-adjusted returns and "3–5× higher gamma" in the final 21 days **[sourced: DaysToExpiry; not independently verified against the original tastylive study]**. Gamma of an ATM option scales roughly with `1/(S·σ·sqrt(T))`, so halving T raises ATM gamma by ~41%; from 7 DTE to 1 DTE it rises ~2.6×. Pin risk (strike near price into expiration) and after-hours exercise risk (file 05 §2.8) concentrate in the final session.

### 6.2 Rules **[policy]**

```
DTE_exit = 2 trading days before expiration (i.e., close on Wednesday for a Friday expiry)
IF DTE ≤ DTE_exit AND position not yet closed → close in the 10:00–11:30 window, else by 15:30.
IF DTE = 1 (day before expiry) for any reason (missed fill, halt) → close before 15:00; walk without cap.
IF expiration day and still open → §7 forced-close protocol; never let it ride.
Never hold any American-style (SPY/QQQ/IWM) spread with an ITM short leg into the last trading hour.
Never hold any spread across an ex-dividend date with a short ITM call.
```

Consequence: a "14 DTE" trade has at most ~10 trading days of life; a "7 DTE" trade has ~5. Expected hold for a 50%-target credit spread is 2–6 trading days.

---

## 7. What to do when the short strike is breached

### 7.1 Principles

- With defined risk, the *maximum* loss is known at entry. Any "roll" that increases width, adds contracts, or extends duration **adds** risk and capital to a losing thesis. Rolling for a credit at 7–14 DTE usually requires going further out in time (past the 14-DTE ceiling) or closer to the money — both violate this book's constraints.
- Rolling the *untested* side of an iron condor closer collects a small credit and raises the loss on the other side if the move reverses; in a 7–14 DTE window there is little time for the reversal to matter, so the extra credit rarely covers the extra risk.
- Therefore the rule on breach is **close**. Rolling is not permitted in this book (02 RULE T9).

### 7.2 Decision tree (text form)

```
BREACH DETECTED (price ≤ short put strike OR price ≥ short call strike, any RTH print)
│
├─ Is this a Shock-gap open (file 05) with price through BOTH strikes?  → §7.3
│
├─ Is DTE ≤ 3?
│     └─ YES → CLOSE now (stop-loss walk). No roll.
│
├─ Is spread mark ≥ 2.0 × credit (or delta ≥ 0.40)?
│     └─ YES → CLOSE now. No roll.
│
├─ (Breached but loss < stop; e.g., quick touch and rebound within 5 min)
│     ├─ Did price close the 5-min bar back beyond the short strike by ≥ 0.25 × EM_1d?
│     │     └─ YES → HOLD, tighten: stop multiple becomes 1.5×; re-check every bar.
│     └─ NO → CLOSE now.
│
├─ Iron condor, one side breached, untested side worth < $0.05?
│     └─ Close the whole condor (both sides) as one order; never leave a single wing open.
│
└─ Otherwise → CLOSE. Rolling (out in time, or of the untested side) is NOT permitted
   at ≤ 14 DTE (02 RULE T9 / T19). A new position after a stop-out is a NEW trade that
   must pass every entry filter, and may not be opened in the same underlying and
   expiration on the same day (02 §10).
```

### 7.3 Gap through both strikes (max-loss scenario)

If the open prints beyond the *long* strike of a credit vertical (or through both wings on one side of an IC):

1. The spread is at or near max loss; the remaining value is time value of the long leg plus early-assignment/pin optionality. There is no stop-loss benefit left to capture.
2. Rule **[policy]:** if `mark ≥ 0.90 × width`, do **not** chase a fill at the open; place a limit at `width − $0.05` and let it work; re-evaluate at 10:00. If the gap partially fills by noon (sub-0.4% gaps do so >50% of the time, 1%+ gaps <50% — file 05 §1.1), improve the exit. Hard deadline: close by 15:00 the same day if DTE ≤ 3; otherwise by 15:00 the next day.
3. If the short leg is ITM on SPY/QQQ/IWM, assume early assignment is possible after the close (particularly for calls before an ex-dividend date). Closing before 16:00 removes that risk entirely; that is why the deadline is 15:00, not 16:15.
4. Log as `outcome = max_loss_gap`. These events are the reason short-strike distance, EM-based sizing and event avoidance exist; review the pre-entry checks after every occurrence.

---

## 8. Expiration-day mechanics (reference — the bot should never rely on these)

| Item | SPY / QQQ / IWM | XSP / SPXW (daily) | SPX standard monthly (AM) |
|---|---|---|---|
| Style | American, physical delivery (100 shares) | European, cash-settled | European, cash-settled |
| Last trade on expiration day | **16:15 ET** (extended-session ETF options) **[sourced: Nasdaq]** | **16:00 ET** (13:00 on half-days) — 3:00 pm Chicago **[sourced: Cboe XSP/SPX specs]** | Business day *before* expiration (Thursday) at 17:00 ET **[sourced: Cboe SPX spec]** |
| Settlement price | Exercise decisions keyed to the **16:00** closing price for the $0.01 test; holders may still exercise/DNE until the broker cutoff, so extended-hours moves can create assignments **[sourced: OIC; Public.com]** | Closing index value **[sourced: Cboe]** | Special Opening Quotation Friday morning |
| Auto-exercise threshold | OCC exercise-by-exception: **≥ $0.01 ITM** vs. 16:00 close; brokers may set their own **[sourced: OIC]** | Cash difference at ≥ $0.01 ITM | Same |
| Exchange exercise-notice cutoff | 4:30 pm **CT**; brokers set earlier deadlines **[sourced: OIC]** | n/a (cash) | n/a |
| Do-not-exercise (DNE) | Submit to broker before its cutoff (example: Public.com 4:30 pm ET) **[sourced: Public.com]**; tastytrade's DNE article (43000472843) exists but could not be fetched — **confirm the tastytrade cutoff** | n/a | n/a |
| Broker expiration risk | tastytrade publishes an "expiration risk" policy under which its risk team can close positions the account cannot support if exercised/assigned (help articles 43000484765, 43000484774). **The exact cutoff time and procedure could not be fetched; confirm directly.** | Cash settlement, no assignment risk; but a short XSP leg ITM at the close is a cash debit for full intrinsic | Same |

Rules **[policy]:**
- Because the account cannot take delivery of 100 SPY shares (~$60k+), *any* SPY/QQQ/IWM spread still open on expiration day will be closed by 15:00 ET by the bot, before any broker action. If a fill cannot be obtained at the walk cap, pay the natural.
- If a long leg is ITM and the short leg is OTM at the close (rare — e.g., debit spread finishing between strikes), submit a DNE only if the long is ≤ $0.05 ITM and closing cost > intrinsic; otherwise close it. Do not carry exercise into stock.
- XSP is preferred over SPY for structures the bot might, in a failure mode, fail to close: cash settlement removes assignment/pin risk (settlement still realizes the full loss).

---

## 9. Trade lifecycle table

| Stage | Time / trigger | Actions | Log fields |
|---|---|---|---|
| 0. Screen | 16:30 (prior day) + 08:00 | Calendar tiers, regime flags, EM_1d/EM_3d, candidate expirations (7–14 DTE, exit day not Tier 1) | date, flags, VIX, EM |
| 1. Entry gate | 10:00–15:30 | `entry_allowed` true; liquidity gate; short-strike distance ≥ required multiple of EM (see strategy files); credit ≥ 25 % of width hard floor, ≥ 33 % target (02 RULE T4) | underlying, structure, strikes, expiry, DTE, deltas, IV, IVR, credit/debit, width, max_loss, POP, EM at entry |
| 2. Order | at gate | Complex limit at mid; walk per §2.2; abandon at cap | limit sequence, fill price, slippage vs mid, fill time |
| 3. Immediately after fill | +0 s | Place GTC closing limit at 50% target; record stop levels (2× credit, delta 0.40, touch) | order ids |
| 4. Monitoring | every 5 min RTH; file-05 checkpoints | Evaluate stop triggers (§5), time exit (§6), breach tree (§7), event flags | marks, delta, P/L, distance to short strike |
| 5. Exit | trigger | Cancel GTC target; send closing limit; walk per §2.2 | exit reason ∈ {target_50, target_25, stop_2x, stop_delta, stop_touch, time_exit, event_exit, forced_expiry, max_loss_gap, kill_switch}, fill, slippage |
| 6. Post-trade | same day 16:30 | Compute realized P/L, P/L per day, % of max profit captured, MAE/MFE, hold days; update running stats by structure and by exit reason | all of the above |

Minimum fields to log per trade (CSV/JSON): `trade_id, underlying, structure, open_dt, close_dt, expiry, dte_open, dte_close, strikes[], deltas_open[], iv_open, ivr_open, vix_open, em1d_open, credit_or_debit, width, max_loss, fill_open, mid_open, slippage_open, target_price, stop_levels, exit_reason, fill_close, mid_close, slippage_close, pnl, pnl_per_day, pct_max_profit, mae, mfe, hold_days, calendar_flags, gap_class_days[], notes`.

Review cadence **[policy]:** after every 25 closed trades, recompute win rate, average winner/loser, P/L per day and slippage by structure, by exit reason, and by entry weekday. Do not change any threshold in this file on fewer than 50 trades per structure.

---

## 10. Facts that could not be verified

- tastytrade help-center pages (limit-order guidance, DNE cutoff, expiration-risk close-out time, market-hours page) are JavaScript-rendered and returned no content; every tastytrade-specific cutoff above is marked "confirm."
- The original tastylive Market Measures data for "manage at 50%" and "21 DTE" (win-rate and P/L-per-day tables) were not retrievable; the projectfinance 71,417-trade replication is used as the primary quantitative source, and the DaysToExpiry "15–20% / 3–5×" figures are third-hand.
- No fetched source gives a measured *option* bid-ask width by time of day for SPY/QQQ; the intraday pattern is taken from an equity-market study and descriptive retail sources.
- Cboe's statement that Mon–Thu weeklies are listed only within ~15 days is from a 2022 notice; current listing horizons may be longer (Cboe has since expanded daily expirations). Check the live chain via `tastytrade_get_option_chain_compact` before assuming an 8–14 DTE Tuesday/Thursday expiry exists.

## Sources

- projectfinance, Iron Condor Management Results from 71,417 Trades: https://www.projectfinance.com/iron-condor-management/
- tastylive, Managing Winners (concept page): https://www.tastylive.com/concepts-strategies/managing-winners
- DaysToExpiry, The 21 DTE Rule Explained (third-party summary of tastylive research): https://www.daystoexpiry.com/blog/the-21-dte-rule-explained-when-and-why-to-close-options-positions-early
- Option Alpha, Stop-Loss Orders: 10 Backtested Option Strategies: https://optionalpha.com/podcast/stop-loss-strategies-for-options
- SJ Options, "Does Tastytrade Work" (replication of 16Δ/45 DTE/50%/2× rules): https://www.sjoptions.com/does-tastytrade-work/
- Option Alpha, Bid-Ask Spread Volatility case study: https://optionalpha.com/blog/bid-ask-spread-volatility
- Journal of Business Finance & Accounting (1997), intraday spread/volatility patterns: https://ideas.repec.org/a/bla/jbfnac/v24y1997i3p343-362.html
- Option Samurai, Best time to trade options: https://optionsamurai.com/blog/best-time-to-trade-options/
- NYSE Closing Auction fact sheet: https://www.nyse.com/publicdocs/nyse/NYSE_Auctions_Closing_Process_Fact_Sheet.pdf
- Nasdaq, closing-auction share of ADV: https://www.nasdaq.com/articles/what-to-know-about-the-annual-russell-index-changes
- Cboe, SPY/QQQ/IWM Tuesday & Thursday weeklies (Nov 2022): https://cdn.cboe.com/resources/product_update/2022/Cboe-Options-to-List-SPY-and-QQQ-Tuesday-and-Thursday-Expiring-Weekly-Options.pdf
- My0DTEOptions, underlyings with Mon–Fri expirations: https://my0dteoptions.com/blog/stocks-with-0dte-options/
- Moontower, weekend theta: https://blog.moontower.ai/weekend-theta/
- OptionMetrics, Selling Saturdays (weekend risk premium, 1DTE put-write): https://optionmetrics.com/blog/selling-saturdays-weekend-risk-premia-in-1dte-put-write-strategies/
- Deltaray, The Weekend Effect backtest: https://blog.deltaray.io/the-weekend-effect/
- Macroption, VIX by weekday: https://www.macroption.com/vix-spx-correlation/
- Nasdaq options market hours (4:15 pm ETF list): https://www.nasdaqtrader.com/Trader.aspx?id=optionshours
- Cboe SPX specifications (last trading day/time, GTH): https://www.cboe.com/tradable_products/sp_500/spx_options/specifications/
- Cboe XSP specifications: https://cboe.com/tradable-products/sp-500/xsp-options/specifications
- OIC, Options Exercise FAQ ($0.01 exercise-by-exception; 4:30 pm CT exchange cutoff): https://www.optionseducation.org/referencelibrary/faq/options-exercise
- Public.com, expiration/exercise/DNE FAQ: https://help.public.com/en/articles/8460531-understanding-option-expiration-exercise-and-assignment
- Option Alpha, What time do 0DTE options expire: https://optionalpha.com/learn/0dte-expiration
- SpotGamma, OPEX calendar and effects: https://spotgamma.com/options-expiration-dates-vix-expirations-dates-download/
- TradeStation, Quadruple witching dates 2026: https://www.tradestation.com/insights/2026/01/23/quadruple-witching-dates-2026-stock-futures-trading/
- tastytrade help center (not fetchable; confirm manually): Expiration risk https://support.tastytrade.com/support/s/solutions/articles/43000484765 ; Expiration risk process https://support.tastytrade.com/support/s/solutions/articles/43000484774 ; Do-Not-Exercise https://support.tastytrade.com/support/s/solutions/articles/43000472843 ; Market hours https://support.tastytrade.com/support/s/solutions/articles/43000504673
