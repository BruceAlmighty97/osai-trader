# 02 — Defined-Risk Strategies for a 7–14 DTE Bot ($2,500 tastytrade account)

Companion to `01-account-and-capital-rules.md` (sizing, fees, kill-switches, product selection). This file defines **what** the bot may trade, **how** to build each structure at 7–14 DTE, and **how** to manage it. Rules are numbered (**RULE T#**) so the agent can apply them mechanically. Every quantitative claim is sourced in `## Sources`; unverifiable items are flagged **UNVERIFIED**.

Important framing from the research: almost all published, data-backed guidance for premium selling is built around **30–45 DTE entries managed at 21 DTE or 50 % of max profit**. Multiple sources explicitly *discourage* 7–14 DTE for premium sellers because of gamma ("Weeklies (7-14 DTE) have extreme gamma risk and require constant monitoring" — DaysToExpiry). The 7–14 DTE window is a *constraint of this bot*, so this document adapts the 45-DTE rules downward and compensates with tighter management, smaller size, and stricter filters. No fetched source provides a tastylive study specifically at 7–14 DTE (**gap; see §11**).

---

## 0. Universal conventions

| Symbol | Meaning |
|---|---|
| `W` | Spread width (difference between short and long strike), in $ per share |
| `C` | Net credit received, $ per share (× 100 = per contract) |
| `D` | Net debit paid, $ per share |
| `Δs` | Absolute delta of the short strike at entry |
| `F` | Round-trip fee budget per structure (2-leg $2.50, 4-leg $5.00; see 01 §3) |
| `DTE` | Calendar days to expiration at entry |
| POP | Probability of profit at expiration; approximation `POP ≈ 1 − C/W` for credit spreads; the short strike's delta ≈ probability that strike expires ITM (rough proxy only) |
| IVR | IV Rank (0–100); IV% = IV percentile |
| Ex-move | 1-SD expected move ≈ `price × IV × sqrt(DTE/365)` |

**RULE T0 (defined risk gate).** An order is permitted only if, for every possible underlying price at expiration, the loss is capped by long options in the same order and the cap ≤ `max_loss` allowed by 01 RULE S1. Every short option must be paired with a long option in the same expiration (or a later expiration for calendars/diagonals) on the same side, same or greater quantity.

---

## 1. Vertical credit spreads (bull put spread, bear call spread)

**Structure.** Bull put: sell put at K, buy put at K − W, same expiration. Bear call: sell call at K, buy call at K + W.

**When to use.**
- IV environment: credit spreads when IV is above the 50th percentile of its 52-week range (Schwab); tastylive's approach is to sell premium in elevated IVR. **RULE T1:** the canonical IV gate is 04-market-signals §3.4 — for any short-premium structure require **IVR ≥ 30 and IV percentile ≥ 50 and VRP (IV − 20-day realized) ≥ 3 pts**; IVR ≥ 50 preferred for condors. Below IVR 30 (or VRP < 3), use §2 debit spreads or no trade.
- Directional bias: bull put = neutral-to-bullish, bear call = neutral-to-bearish. Sell the spread *away* from the expected move.

**Build at 7–14 DTE.**

| Parameter | Rule | Basis |
|---|---|---|
| Short strike delta | **RULE T2:** `Δs` between **0.15 and 0.25** (target 0.20); never > 0.30 | DaysToExpiry: aim for 70–80 % POP at 7–14 DTE (i.e., short delta ≈ 0.20–0.30); OptionsPilot: 16Δ best Sharpe, 10Δ lowest drawdown |
| Width | **RULE T3:** $1–$5 on SPY/XSP/QQQ/XND; choose the narrowest width that satisfies the credit rule *and* 01 RULE S1 | 01 §5 sizing |
| Target credit | **RULE T4:** target `C ≥ W/3` (≥ 33 % of width); **hard floor 25 % of width** — reject anything below 25 %. Between 25 % and 33 % is allowed only with IVR ≥ 30 and short delta ≤ 0.20 (i.e., you are paid less but sit further out). This floor is the single canonical credit rule used in every file | tastylive rule "collect 1/3 the width" → ~67 % POP (HaiKhuu summary); DaysToExpiry reports typical 30-DTE credits of 25–30 % of width, so at 7–14 DTE hitting 1/3 requires either elevated IV or a short delta near 0.25. Below 25 % the reward:risk (< 1:3) cannot survive a realistic 25–30 % loss rate after fees |
| Short strike placement vs. expected move | **RULE T5:** short strike beyond 1.0 × ex-move (≈ 16Δ) preferred; minimum 0.8 × ex-move | ex-move formula |
| Minimum credit in $ | ≥ $0.30/contract (fee gate 01 RULE A6) | 01 §3 |
| Expiration | 7–14 DTE at entry; PM-settled only (01 RULE D3); for SPY/QQQ avoid expirations spanning an ex-dividend date on the call side (01 RULE D1) | |

**Formulas (per share; × 100 per contract).**
- Max profit = `C`
- Max loss = `W − C` (+ fees)
- Breakeven: bull put `K_short − C`; bear call `K_short + C`
- BPR = `(W − C) × 100`
- Reward:risk = `C / (W − C)`; at C = W/3 this is 1 : 2 with POP ≈ 67 %.

**POP vs. risk/reward.** Higher `Δs` → more credit, lower POP. Backtests (SPX iron condors, 45 DTE, 2006–2025, OptionsPilot): 10Δ 84.1 % win / +$72 avg / −13.5 % max DD; 16Δ 74.6 % / +$138 / −21.3 %; 20Δ 68.4 % / +$172 / −26.8 %. Shorter DTE raises win rate but lowers $ per trade and increases whipsaw: 21 DTE 80.1 % / +$78 vs 45 DTE 74.6 % / +$138, with "18 % more whipsaw events" at 21 DTE. Extrapolate: expect 7–14 DTE to have *still* higher nominal win rate, smaller credits, and more frequent stop-outs on sharp moves.

**Capital at $2,500.** Using C = W/3: $1-wide BPR ≈ $67, $2-wide ≈ $133, $3-wide ≈ $200, $5-wide ≈ $333. Under 01 RULE S1 (≤ $125 incl. fees) only **$1-wide** (and $2-wide only if C ≥ $0.78) verticals qualify at $2,500 NLV. $3–$5 widths become usable at NLV ≥ $4,000 / $6,700.

**Management.**

| Event | RULE | Action |
|---|---|---|
| Profit target | **T6** | Close at **50 % of max profit** (GTC limit at `C/2`). At ≤ 3 DTE, lower the target to 25 % if not yet hit and close whatever is available at ≥ 25 % | tastylive 50 % rule; tastytrade butterfly page "25–50 %" |
| Stop loss | **T7** | Close when spread mark ≥ `2 × C` (loss = 1 × C) **or** when the short strike delta ≥ 0.40, whichever first. For $1-wide spreads (where 2× credit ≈ 65 % of max loss) this is the only meaningful stop; for wider spreads it caps loss at roughly 1/3–1/2 of width | OptionsPilot: 200 %-of-credit stop gave best Sharpe (0.80), win rate 78.2 %, DD −16.8 % vs −21.3 % unmanaged; DaysToExpiry "cut losers at 2× max profit" |
| Time stop | **T8** | Close **every** position (all underlyings, all structures) no later than **2 trading days before expiration**, by 15:30 ET that day (e.g., Wednesday for a Friday expiry; holidays are not trading days). This is the canonical time stop shared with 03 G-2 and 06 §6.2. If a fill was missed, 06 §6.2/§7 govern the emergency close — never let anything reach expiration day | gamma explosion in the final sessions (03 §2.3), pin/assignment risk, broker expiration-risk closures (01 §6.1) |
| Roll | **T9** | **Do not roll** at 7–14 DTE. Rolling out replaces one high-gamma position with another; take the loss per T7 and re-evaluate as a new trade subject to all entry filters | 21-DTE research applies to 45-DTE cycles, not weeklies |
| Untested-side add | **T10** | Converting a vertical to an iron condor by selling the untested side is permitted only if the new side independently satisfies T2–T5 and total BPR does not rise (equal widths) | tastytrade IC page "managing the untested side" |

**Dangers specific to 7–14 DTE.**
- **Gamma:** a 16–20Δ short strike can become 50Δ on a 1.5 % index move in the final week; P&L per day is "unpredictable" inside 21 DTE (tastylive research via TalkMarkets).
- **Pin risk / assignment (SPY, QQQ):** short leg $0.01 ITM at expiration is auto-exercised (OIC). Long leg expires worthless → 100 shares long/short in a $2,500 account. Hence T8.
- **Early assignment (American):** only realistic when the short put is deep ITM (already a T7 stop-out) or a short call is ITM just before ex-dividend (01 RULE D1–D2).
- **Dividend:** SPY ex-dates 3/20, 6/18, 9/18, 12/18 (2026); QQQ ≈ Mar 23, Jun 22, Sep 22, Dec 22.
- **Fee drag:** at $0.33 credit, fees ≈ 7.6 % of credit / 15 % of the 50 % target (01 §3). Prefer XSP/XND where the same width pays a similar credit but without assignment risk.

---

## 2. Vertical debit spreads (bull call, bear put)

**Structure.** Bull call: buy call at K1, sell call at K1 + W. Bear put: buy put at K1, sell put at K1 − W.

**When to use.** IV in the **0–50th percentile** of its 52-week range (Schwab). Debit spreads are long vega (benefit from rising IV) and short a farther strike, so they are the low-IV analogue of a credit spread. Directional: requires a directional thesis; the 7–14 DTE window means the move must happen within days.

**Build at 7–14 DTE.**

| Parameter | Rule |
|---|---|
| Long strike | **RULE T11:** ATM-to-slightly-ITM, delta 0.50–0.65 (higher win rate, lower ROI — DaysToExpiry ITM/ATM/OTM trade-off) |
| Short strike | delta 0.25–0.35, i.e., at or inside 1 × ex-move |
| Width | $1–$5 |
| Max debit | **RULE T12:** `D ≤ 0.50 × W` (a debit spread costing 50 % of width has POP ≈ 50 % and 1:1 reward:risk). Reject if `D > 0.55 × W` |
| Minimum width : debit | Reward:risk ≥ 1 : 1 net of fees |

**Formulas.** Max loss = `D` (+ fees); max profit = `W − D` (− fees); breakeven bull call = `K1 + D`; bear put = `K1 − D`; BPR = `D × 100`.

**POP vs. R:R.** Equivalent (by put-call parity) to the opposite-side credit spread at the same strikes; POP ≈ `1 − (W − D)/W = D/W`. A debit of 40 % of width ≈ 40 % POP but 1.5 : 1 reward. Use only when the directional signal is explicit; otherwise credit spreads with T2 deltas dominate for a "slow growth" mandate.

**Management.** **RULE T13:** target 50 % of max profit (or 25 % in last 3 DTE); stop at loss = 50 % of debit; time stop identical to T8 (short leg is still assignable on SPY/QQQ). Never hold an ITM debit spread on SPY/QQQ into expiration — both legs may be exercised/assigned, netting to nothing but incurring 2 × $5 fees and intraday stock exposure.

---

## 3. Iron condor

**Structure.** Bull put spread + bear call spread, same expiration, typically equal widths: buy put K1, sell put K2, sell call K3, buy call K4 with K1 < K2 < price < K3 < K4.

**When to use.** Neutral, range-bound expectation; **IVR ≥ 30** (RULE T14) — the tastylive best-practice condor (as automated by Option Alpha) uses 45+ DTE, 20Δ shorts, 50 % profit target, exit at 21 DTE. At 7–14 DTE adapt as below.

**Build at 7–14 DTE.**

| Parameter | Rule | Basis |
|---|---|---|
| Short deltas | **RULE T15:** 0.12–0.20 each side (target 0.16), symmetric ±0.04 | OptionsPilot 16Δ = best Sharpe (0.78–0.80); 10Δ = lowest DD; 20Δ = highest $ but DD −26.8 % |
| Wings | Equal widths, $1–$5 | BPR = one wing width − total credit |
| Total credit | **RULE T16:** target `C_total ≥ W/3` (both sides combined); hard floor 25 % of the wing width, same terms as T4 | tastylive 1/3-width rule → ≈ 67 % POP |
| Short strikes vs. ex-move | Both short strikes ≥ 1.0 × ex-move; if only 0.8–1.0 × is available for 1/3 width, skip | |
| Skew handling | Put side will price richer; it is acceptable to place the call short at 0.12–0.14Δ and the put short at 0.16–0.20Δ to balance credit | |
| Fee gate | total credit ≥ $0.60 (4 legs, $5.00 fees → ≤ 8.3 % drag) | 01 §3 |

**Formulas.** Max profit = `C_total`; max loss = `W − C_total` (one side); breakevens `K2 − C_total`, `K3 + C_total`; BPR = `(W − C_total) × 100`.

**What the data say (SPX, 2006–2025, 15,360 trades, 25-pt wings, OptionsPilot):**

| Management (16Δ, 45 DTE) | Win rate | Avg P&L | Max DD | Sharpe | Avg hold |
|---|---|---|---|---|---|
| 50 % profit target | 74.6 % | +$138 | −21.3 % | 0.78 | 22 d |
| 75 % profit target | 68.2 % | +$164 | −24.8 % | 0.72 | 31 d |
| Hold to expiration | 61.4 % | +$178 | −29.6 % | 0.58 | 45 d |

| Stop-loss (16Δ, 45 DTE, 50 % target) | Win rate | Avg P&L | Max DD | Sharpe |
|---|---|---|---|---|
| None | 74.6 % | +$138 | −21.3 % | 0.78 |
| **200 % of credit** | 78.2 % | +$112 | −16.8 % | **0.80** |
| 150 % of credit | 80.4 % | +$94 | −14.2 % | 0.76 |
| 100 % of credit | 83.1 % | +$68 | −11.4 % | 0.70 |

By DTE (16Δ): 21 DTE 80.1 % / +$78 / −15.6 %; 30 DTE 77.8 % / +$102 / −17.8 %; 45 DTE 74.6 % / +$138 / −21.3 %; 60 DTE 71.9 % / +$148 / −24.1 %. Shorter DTE → higher win rate, smaller profits, lower drawdown *per trade* but more whipsaw. tastylive's own managing-winners research (summarised by TalkMarkets): holding to expiration "yielded the same P/L, but saw larger losses" than managing early. DaysToExpiry recommends: monitor 30–21 DTE, "make-or-break" 21–14 DTE, **close in the 14–7 DTE window; don't hold to expiration**. Option Alpha's 0DTE dataset (25,000+ positions, 88 % SPY): iron condors 63 % win, iron butterflies 72 % win — 0DTE condors opened in the first two hours averaged −0.36 % vs +37 % when opened later. Take-away for 7–14 DTE: manage winners early, use a 150–200 % credit stop, and do not hold through the final day.

**Capital at $2,500.** $1 wings, C = $0.35 → BPR $65; $2 wings, C = $0.70 → BPR $130 (fails RULE S1 unless C ≥ $0.78). One-lot $1–$2 wing condors are the realistic choice.

**Management.**
- **RULE T17:** profit target 50 % of `C_total` (25 % if ≤ 3 DTE remain).
- **RULE T18:** stop when the condor's mark ≥ `2 × C_total` **or** either short strike delta ≥ 0.35 **or** underlying touches a short strike; close the **whole** condor (do not leg out at 7–14 DTE).
- **RULE T19:** time stop as T8. Do not roll (T9). Untested-side management: closing the untested side for ≤ $0.05 to free BPR is permitted; rolling the untested side closer to collect more credit (tastylive adjustment) is **prohibited** at ≤ 14 DTE because it doubles gamma exposure at the worst time.

**Dangers.** Two-sided gamma; on SPY/QQQ the call side carries dividend-assignment risk (01 RULE D1); pin risk at either short strike; fees are double a vertical's.

---

## 4. Iron butterfly (iron fly)

**Structure.** Sell ATM call and ATM put at K, buy call at K + W and put at K − W (equal wings). Net credit is large — a TradingBlock example collects $4.60 on $5 wings (92 % of width).

**When to use.** Elevated IV (IVR ≥ 40, **RULE T20**) with expectation of a pinned/contracting market, or post-event IV crush. Lower POP than a condor (narrow profit zone) but far better reward:risk.

**Build at 7–14 DTE.**
- **RULE T21:** short strike = nearest ATM strike (Δ 0.45–0.55); wings $2–$5; require `C ≥ 0.50 × W` (POP ≈ 50 %), prefer ≥ 0.60 × W. Reject if C < 0.45 × W.
- Fee gate: total credit ≥ $1.00 (4 legs).

**Formulas.** Max profit = `C`; max loss = `W − C`; breakevens `K ± C`; BPR = `(W − C) × 100`. With C = 0.6 W, max loss = 0.4 W and reward:risk = 1.5 : 1.

**Capital at $2,500.** $2 wings with C = $1.20 → BPR $80; $3 wings with C = $1.80 → BPR $120; $5 wings with C = $3.00 → BPR $200 (fails RULE S1 at $2,500).

**Management.**
- **RULE T22:** profit target **25 % of `C`** (the full credit is rarely realised; TradingBlock closes at 50 %, tastytrade butterfly guidance is 25–50 % — use 25 % at 7–14 DTE because the profit zone is narrow and gamma high). Stop when loss = 1 × `C` (mark ≥ 2 C) or when the underlying moves beyond a breakeven. Time stop as T8. No rolling.

**Dangers.** ATM shorts have maximum gamma; the short straddle component means one side is ITM almost always — on SPY/QQQ, an ITM short put/call at expiration is assigned, so T8 is mandatory; prefer XSP/XND for flies.

---

## 5. Broken-wing butterfly (BWB), defined-risk variant

**Structure (put BWB, bullish/neutral).** Buy 1 put at K_high (near ATM or slightly OTM), sell 2 puts at K_mid, buy 1 put at K_low, where `(K_mid − K_low) > (K_high − K_mid)`; the wider lower wing is what "breaks" the butterfly. Opened for a **credit or near-zero debit**. Call BWB is the mirror (bearish/neutral). Option Alpha describes the iron-BWB form: sell ATM straddle, buy the near wing closer than the far wing; if credit ≥ narrow wing width, that side is risk-free ("credit BWB").

**Defined risk check.** Max loss (put BWB) = `(wide wing − narrow wing) − net credit`, occurring below K_low. Upside risk = 0 if opened for a credit (profit = credit above K_high). **RULE T23:** only open BWBs for net credit ≥ $0.05 (so one side is risk-free); the quantity of long puts must equal the quantity of short puts (2 long vs 2 short).

**Build at 7–14 DTE.**
- Narrow wing $1–$2; wide wing 2× narrow (e.g., buy 1 @ K, sell 2 @ K − 2, buy 1 @ K − 6, so narrow = 2, wide = 4; max loss = 2 − credit).
- Short strikes at Δ 0.20–0.30 (the "body" sits around 1 × ex-move).
- BPR = `(wide − narrow − credit) × 100` → $200 minus credit for the example above (fails RULE S1 at $2,500 unless narrow = $1 / wide = $2, i.e., BPR ≈ $100 − credit).

**Formulas.** Max profit = `narrow wing + credit` at K_mid; breakeven (downside) = `K_low + (max loss)`; no upside breakeven when opened for credit.

**When to use.** Neutral-to-directional with a lean; sources give no DTE-specific delta guidance for BWBs (**UNVERIFIED for 7–14 DTE**). Treat as an alternative to a credit vertical when skew makes the far wing cheap.

**Management.** **RULE T24:** target 25–50 % of max profit; stop when loss = 50 % of max loss or underlying breaches K_mid; time stop T8 (two short contracts on SPY/QQQ = 200 shares of assignment risk — use XSP/XND).

**Dangers.** Asymmetric: risk-free on one side but full wing-difference loss on the other; profit peak is a narrow tent that only fills in the last days — fighting the 7–14 DTE window unless placed with ~7 DTE and held close to expiration on cash-settled products.

---

## 6. Defined-risk calendar and diagonal spreads (allowed but discouraged at this DTE)

**Structure.** Calendar: sell near-term option at K, buy later-dated option at same K. Diagonal: different strikes. Max loss = net debit when the long-dated leg is same strike or the width favours the long; if the diagonal's short strike is farther OTM than the long strike by X, add X to max loss.

**Why they fit poorly at 7–14 DTE.**
- Positive vega and negative gamma: they lose when IV falls after entry ("the most common failure mode") and when the underlying moves sharply while the short leg's gamma accelerates in the last week (OptionsTradingIQ).
- Standard guidance sells the front month at 20–30 DTE against 45–60 DTE longs; a 7–14 DTE short leg concentrates gamma and pin risk.
- On SPY/QQQ the short front leg is subject to early assignment (ITM before ex-dividend), which would leave the account long/short 100 shares against a long-dated option.

**RULE T25.** Calendars/diagonals are permitted only on **cash-settled index products (XSP/XND/SPXW)**, only when IVR ≤ 20 (low IV, positive-vega justification), only with BPR = net debit ≤ 01 RULE S1, and with the long leg ≤ 30 DTE so the whole trade fits the mandate. Manage at 50 % of debit gain (OTIQ's "50 % of profit in < 50 % of duration" rule), stop at 25 % loss of debit, and close the short leg by expiration-day noon. Default: **do not use** unless a low-IV regime makes credit structures fail RULE T4/T16.

---

## 7. Long single options (long call / long put)

**Structure.** Buy 1 call or put. Max loss = premium (+ fees), max profit = unlimited (call) / strike − premium (put), breakeven = strike ± premium. BPR = premium × 100.

**When it is worth it.** Only when (a) IV is low (IV% < 30) so premium is cheap *and* (b) a large, fast directional move is expected within the DTE window *and* (c) premium ≤ 01 RULE S1. Positive gamma/vega make it the only structure in this file that *benefits* from a volatility spike.

**Why it is usually inferior.** A long option must overcome theta every day (fastest in the final 2 weeks) and typically has POP < 50 %; a debit spread at the same strikes (§2) sells the wing you are unlikely to reach, cutting cost and raising POP. The OptionsPilot SPY 2005–2025 summary lists vertical spreads at 68 % win / +$49.80 expectancy, while premium-buying strategies rely on rare large wins.

**RULE T26.** Long single options are allowed only as: (i) a hedge sized ≤ 1 % of NLV against an open book of short premium during a K10 volatility shock, or (ii) a directional trade with delta 0.40–0.60, ≥ 10 DTE, premium ≤ 3 % of NLV, target +50 %, stop −50 %, never held into the last 2 DTE. Otherwise prefer §2.

---

## 8. Excluded strategies (never trade)

| Strategy | Why excluded |
|---|---|
| Naked short put / short call | Undefined (call) or near-undefined (put) risk; requires Basic-with-margin (puts) or The Works (calls); one gap move can exceed NLV. Not needed — a wide credit spread replicates most of the premium |
| Short strangle / short straddle | Two naked legs; tastylive's core strategy but undefined risk; BPR alone would exceed a $2,500 account on SPY |
| Ratio spreads / back-spreads with net short legs (1×2 sold for credit, unbalanced butterflies with extra shorts) | Naked excess leg; RULE T0 fails |
| Jade lizard, big lizard, covered strangle | Contain a naked put |
| Short calendar / short diagonal | Short the long-dated leg → undefined risk after front expires |
| 0DTE unless defined | 0DTE defined-risk structures (condors/flies) exist and were traded 25,000+ times in Option Alpha's data with 63–72 % win rates, but they are outside this bot's 7–14 DTE mandate; gamma is "extreme" 0–3 DTE. **RULE T27:** never *open* a position with < 5 DTE |
| AM-settled index series (standard SPX/NDX 3rd Friday) | Cannot be managed after Thursday close; SET can print outside Friday's range ~30 % of the time (Cboe) |
| Any structure whose broker-reported BPR ≠ computed defined-risk BPR (±5 %) | Indicates a mis-built order (01 RULE A9) |

---

## 9. Decision table — market condition → preferred structure

Inputs the bot must compute before the table: VIX level, IVR of the underlying (52-week), 1-SD ex-move for the target expiration, trend state (e.g., price vs. 20-day mean and 5-day change in units of ex-move), days to next ex-dividend (SPY/QQQ), scheduled events (FOMC, CPI, NFP) inside the DTE window.

| Condition | Preferred | Alternative | Do not |
|---|---|---|---|
| IVR ≥ 30, neutral trend, no event in window | **Iron condor** (16Δ, C ≥ W/3) | Two separate verticals | Debit spreads |
| IVR ≥ 30, mild bullish trend (price above 20-day mean, last 5-day move < 1 ex-move) | **Bull put spread** (20Δ) | Put BWB for credit | Bear call |
| IVR ≥ 30, mild bearish trend | **Bear call spread** (20Δ) — XSP/XND only inside 5 days of SPY/QQQ ex-date | Call BWB | Bull put |
| IVR ≥ 40, post-event IV crush expected, range-bound | **Iron butterfly** (C ≥ 0.5 W, 25 % target) | Iron condor | Long options |
| IVR 20–30 | **No short premium** (fails T1 / 04 §3.4). Debit spread only with an explicit directional signal; otherwise **no trade** | — | Credit spreads, iron fly |
| IVR < 20, directional signal | **Debit spread** (long 0.55Δ, D ≤ 0.5 W) | Long option if IV% < 30 and premium ≤ 3 % NLV | Credit structures |
| IVR < 20, no signal | **No trade** (or XSP calendar per T25) | — | Iron condor |
| VIX ≥ 30 or VIX +20 % intraday | **No new premium sales** (01 K10); manage existing | Hedge per T26(i) | Any new short premium |
| Scheduled macro event inside DTE window | Halve size; short strikes ≥ 1.25 × ex-move; or wait until after the event | — | Iron fly |
| Ex-dividend within window (SPY/QQQ) | Trade **XSP/XND** instead, or put-side only | — | Any SPY/QQQ short call |
| Last 5 DTE of any candidate expiration | **Do not open** (T27) | — | — |
| Liquidity test fails (01 §8) | Skip underlying | Switch SPY↔XSP or QQQ↔XND | Widen limit price past L2 |

---

## 10. Management summary (all structures)

| Rule | Value |
|---|---|
| Profit target | 50 % of max profit (credit structures); 25 % for iron flies/BWB; drop to 25 % for everything at ≤ 3 DTE |
| Stop loss | Mark ≥ 2 × credit (loss = 1 × credit) for verticals/condors; loss = 1 × credit for flies; 50 % of debit for debit spreads/long options |
| Delta stop | Short strike Δ ≥ 0.40 (verticals) / 0.35 (condors) |
| Time stop | All underlyings: close by 15:30 ET two trading days before expiration (T8 / 03 G-2 / 06 §6.2) |
| Rolling | Not permitted at ≤ 14 DTE |
| Legging | Open and close as a single multi-leg order; never leg out of condors/flies |
| Re-entry after stop | Not in the same underlying/expiration on the same day |
| Order handling | Limit at mid, improve per 01 RULE L6; GTC profit-target order placed immediately after fill |

Expected performance envelope (from the 45-DTE SPX data, adjusted qualitatively for 7–14 DTE): win rate 70–80 % with a 2× credit stop, average winner ≈ 0.5 × credit, average loser ≈ 1–1.3 × credit, fee drag 5–10 % of credit. Net expectancy is thin: at a 75 % win rate with winner = +0.5 C and loser = −1.15 C (including slippage past the stop), `EV ≈ 0.75 × 0.5 C − 0.25 × 1.15 C = +0.09 C` per trade before fees, which fees (≈ 0.07–0.10 C on small credits) can erase. **Therefore the fee gate (01 RULE A6), the 1/3-width credit rule (T4/T16), and the stop-loss rules are not optional — they are what keep expectancy positive.**

---

## 11. Facts not verified / gaps

1. No fetched tastylive study reports win rate or P/L for 7–14 DTE credit spreads or condors specifically; the numbers above are 21–60 DTE SPX backtests (OptionsPilot), a 0DTE live-trade dataset (Option Alpha), and qualitative tastylive rules (1/3 width, 50 % profit, 21 DTE, 45 DTE entry). The 7–14 DTE parameters here are interpolations flagged as such.
2. The "1/3 width → ~67 % POP" statistic is a tastylive heuristic relayed by a third party (HaiKhuu), not a primary study.
3. BWB delta/DTE guidance for weeklies is not sourced; RULE T23–T24 are conservative constructions.
4. DaysToExpiry's "aim for 70–80 % POP at 7–14 DTE" and "cut losers at 2× max profit" are practitioner guidance without disclosed backtest data.
5. tastytrade's own iron-condor/vertical learn pages provide formulas and the 50 % target but not delta/DTE/credit-ratio numbers; those came from the Option Alpha automation of "Tasty's best practices" (45+ DTE, 20Δ, 50 % target, 21 DTE exit).

---

## Sources

- HaiKhuu — tastylive Iron Condor: Strategy and Mechanics (1/3 width credit ≈ 67 % POP, 50 % profit, untested-side adjustment): https://haikhuu.com/education/tastytrade-iron-condor
- Option Alpha — Tasty's "Best Practices" Iron Condor Automated (45+ DTE, 20Δ, 50 % profit, 21 DTE exit): https://optionalpha.com/videos/tastys-best-practices-iron-condor-automated
- OptionsPilot — Best Delta and DTE Settings for Iron Condors: Backtest Data from 15,000+ Trades (SPX 2006–2025 tables): https://optionspilot.app/blog/best-delta-dte-settings-iron-condors-backtest-data
- OptionsPilot — What is a Good Win Rate for Options Trading (SPY 2005–2025 vertical spread 68 % / +$49.80; expectancy formula): https://optionspilot.app/blog/good-win-rate-options-trading-backtesting-data
- DaysToExpiry — Iron Condor Close at 50 % Profit: DTE Optimization Guide (7–14 DTE discouraged; phase table): https://www.daystoexpiry.com/blog/iron-condor-dte-optimization
- DaysToExpiry — Vertical Spread Options guide (POP targets by DTE; 2× stop; 21 DTE; exits): https://www.daystoexpiry.com/blog/vertical-spread-options-bullish-bearish-strategy-guide
- DaysToExpiry — Best DTE for Credit Spreads (credit as % of width by DTE; 70–75 % win at 25–30Δ/45 DTE): https://www.daystoexpiry.com/blog/best-dte-for-credit-spreads-a-data-driven-comparison-of-30-45-and-60-day-trades
- Option Alpha — 0DTE Options Strategies: Insights from 25k Trades: https://optionalpha.com/blog/0dte
- TalkMarkets — Managing Winners, Managing Early and Managing Based on Theta (tastylive research summary; 21 DTE inflection): https://talkmarkets.com/article/managing-winners-managing-early-and-managing-based-on-theta?post=237791
- tastytrade — Short Put Vertical Spread (formulas, BPR, expiration/assignment note): https://tastytrade.com/learn/trading-products/options/short-put-vertical-spread/
- tastytrade — Iron Condor (formulas, 50 % target, untested side): https://tastytrade.com/learn/trading-products/options/iron-condor/
- tastytrade — Butterfly Spread (iron fly formulas, 25–50 % target, 21–30 DTE): https://tastytrade.com/learn/trading-products/options/butterfly-spread/
- TradingBlock — Iron Butterfly Beginner's Guide (structure, 92 %-of-width example, 50 % close): https://www.tradingblock.com/strategies/iron-butterfly
- Option Alpha — How to Set Up a Broken-Wing Butterfly (credit BWB, risk-free side): https://optionalpha.com/blog/how-to-set-up-a-broken-wing-butterfly-option-strategy
- OptionsTradingIQ — Calendar Spreads complete guide (vega/gamma risks, DTE guidance, 50 %/50 % rule): https://optionstradingiq.com/calendar-spreads/
- Schwab — Credit vs. Debit Spreads: Let Volatility Guide You (IV percentile thresholds): https://www.schwab.com/learn/story/credit-vs-debit-spreads-let-volatility-guide-you
- OptionProfit — Probability of Profit explained (ex-move formula; delta as ITM proxy; POP caveats): https://options-strategies.com/learn/probability-of-profit
- OIC — Options Assignment FAQ ($0.01 auto-exercise; dividend timing): https://www.optionseducation.org/referencelibrary/faq/options-assignment
- Option Alpha — Dividend Assignment Risk: https://optionalpha.com/learn/dividend-assignment-risk
- Cboe — Settlement of Standard A.M.-Settled S&P 500 Index Options (SET vs. close statistics): https://cdn.cboe.com/resources/spx/Settlement_of_Standard_AM_Settled_SP_500_Index_Options.pdf
- Cboe — XSP Options Fact Sheet: https://cdn.cboe.com/resources/xsp/XSP_Options_Fact_Sheet.pdf
- SSGA — SPDR 2026 Dividend Distribution Schedule: https://www.ssga.com/library-content/products/fund-data/etfs/us/distribution/SPDR_Dividend_Distribution_Schedule.pdf
- StockAnalysis — QQQ dividend dates: https://stockanalysis.com/etf/qqq/dividend/
