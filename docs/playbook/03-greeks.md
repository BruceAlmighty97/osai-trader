# 03 — The Greeks at 7–14 DTE for Defined-Risk Spreads

Scope: rules an automated agent can apply mechanically to credit spreads, debit spreads, iron condors and butterflies held 7–14 DTE on liquid ETFs/indexes (SPY, QQQ, IWM, SPX/XSP). Account context: $2,500, defined-risk only.

Conventions used in this file:
- Greeks are quoted **per share** (per 1 option contract multiply by 100 for dollar terms).
- Theta is **per calendar day** (negative for a long option, positive for a net short spread).
- Vega is per **1 percentage point** of implied volatility.
- Gamma is delta change per **$1** move in the underlying.
- "Net" greek of a spread = sum of legs with sign (short leg contributes −greek, long leg contributes +greek).
- All numeric examples are Black-Scholes computed with **SPY = $650, IV = 16 % (flat), r = 4 %**, no dividends, unless stated. Real chains carry put skew, so real put-spread credits are somewhat higher than these flat-vol values; the *shapes* of the curves are what matter.

---

## 1. Quick reference: what each greek is and what it does to a spread

| Greek | Measures | Long option | Short vertical (credit spread) | Long vertical (debit spread) | Iron condor (short) | Behaviour 14 → 7 → 0 DTE |
|---|---|---|---|---|---|---|
| Delta (Δ) | $ P/L per $1 underlying move; ≈ probability of expiring ITM | + call / − put | Put credit spread: **+Δ**; call credit spread: **−Δ** | Sign of directional bet | ≈ 0 at entry | OTM \|Δ\| decays toward 0, ITM toward 1 — faster as DTE shrinks (charm) |
| Gamma (Γ) | Δ change per $1 move | + | **Short (−Γ)** | Long (+Γ) | Short (−Γ) | ATM Γ rises ~1/√T; explodes in last 3 days. Far-OTM Γ collapses to 0 |
| Theta (Θ) | $ P/L per day from time passing | − | **Long (+Θ)** | Short (−Θ) | Long (+Θ) | ATM Θ rises ~1/√T; a fixed OTM strike's Θ peaks then falls to 0 as it becomes "dead" |
| Vega (ν) | $ P/L per 1 IV point | + | **Short (−ν)** | Long (+ν) | Short (−ν) | Shrinks ~√T: 14 DTE ATM vega is ~56 % of the 45 DTE value; 7 DTE ~40 % |
| Rho (ρ) | $ P/L per 1 % rate change | + call / − put | negligible | negligible | negligible | ATM 650 put ρ = −0.12 at 14 DTE vs −0.38 at 45 DTE; ignore at ≤14 DTE |
| Charm (∂Δ/∂t) | Delta decay per day | OTM: \|Δ\| falls; ITM: \|Δ\| rises | Pulls net Δ toward 0 if OTM, toward max if ITM | same | Pulls both wings toward 0 if OTM | Grows sharply inside 7 DTE; weekends deliver 2–3 days of charm at once |
| Vanna (∂Δ/∂IV) | Delta change per 1 IV point | OTM options gain \|Δ\| when IV rises | IV spike **raises** short-strike \|Δ\| (looks "more tested") | — | both short strikes gain \|Δ\| on IV spike | Small in $ terms at ≤14 DTE, but matters for reading "delta breached" alerts during IV spikes |

Key structural facts (sourced):
- Delta ≈ probability of expiring ITM: "A 0.50 delta has roughly a 50% chance of expiring in-the-money" (Option Alpha). So a 16-delta short strike ≈ 84 % probability OTM, 30-delta ≈ 70 % (StrikeWatch table: 1-SD ≈ Δ0.16 / 84 % OTM; 1.5-SD ≈ Δ0.07 / 93 %; 2-SD ≈ Δ0.025 / 97.5 %).
- "Gamma is highest for contracts closer to at-the-money and declines as an option moves farther in-the-money or out-of-the-money" (Option Alpha).
- "Theta is smaller on long-dated options but time decay accelerates as expiration approaches" and "Vega declines as an option approaches expiration because there is less time for volatility to impact the option's value" (Option Alpha).
- Charm: OTM options have negative charm (delta → 0), ITM positive charm (delta → ±1), ATM ≈ 0; over a weekend two-plus days of charm land at once (Pro Trader Dashboard example: Δ0.30 OTM call with charm −0.04/day → ~0.22 on Monday).

---

## 2. How the greeks move as DTE goes 14 → 7 → 3 → 1

### 2.1 ATM curve (SPY 650 put, single leg) — the shape of theta acceleration and gamma explosion

| DTE | Price | Δ | Γ | Θ /day | Vega | Rho |
|---|---|---|---|---|---|---|
| 45 | 12.99 | −0.454 | 0.0109 | −0.127 | 0.904 | −0.380 |
| 30 | 10.84 | −0.462 | 0.0133 | −0.163 | 0.740 | −0.256 |
| 21 | 9.21 | −0.468 | 0.0159 | −0.202 | 0.620 | −0.180 |
| **14** | 7.63 | −0.474 | 0.0195 | −0.255 | 0.507 | −0.121 |
| 10 | 6.51 | −0.478 | 0.0231 | −0.308 | 0.429 | −0.087 |
| **7** | 5.50 | −0.482 | 0.0277 | −0.375 | 0.359 | −0.061 |
| 3 | 3.65 | −0.488 | 0.0423 | −0.591 | 0.235 | −0.026 |
| 1 | 2.14 | −0.493 | 0.0733 | −1.050 | 0.136 | −0.009 |

Rules of thumb that fall out of this table (ATM, constant IV):
- ATM Γ, Θ scale ≈ 1/√T. Going 14 → 7 DTE multiplies ATM gamma by ~1.4×; 7 → 1 DTE by ~2.6×; 14 → 1 DTE by ~3.8×.
- ATM vega scales ≈ √T. 14 DTE vega is 56 % of 45 DTE; 7 DTE is 40 %; 1 DTE is 15 %. **Short-dated spreads are primarily gamma/theta trades, not vega trades.**
- Rho is <0.13 per share at ≤14 DTE — ignore.
- These are consistent with the qualitative "gamma multiplier" published by Days To Expiry (45 DTE 1×, 21 DTE 2×, 7 DTE 5×, 3 DTE 10×+) — that source measures against 45 DTE and includes the ATM-drift effect, so treat it as directional, not exact.

### 2.2 The trade the bot actually puts on: 16-delta put credit spread, 631/626, entered at 14 DTE

Net greeks, SPY unchanged at 650. (Net sign: positive Θ = spread earns; negative Γ/vega = spread loses on big moves / IV rises.)

| DTE | Short Δ | Long Δ | **Net Δ** | **Net Γ** | **Net Θ /day** | **Net Vega** | Spread value | Net charm /day |
|---|---|---|---|---|---|---|---|---|
| 14 (entry) | −0.156 | −0.103 | +0.053 | −0.0029 | +0.040 | −0.076 | 0.67 | −0.0003 |
| 10 | −0.120 | −0.070 | +0.050 | −0.0038 | +0.053 | −0.071 | 0.49 | −0.0015 |
| 7 | −0.083 | −0.041 | +0.042 | −0.0046 | +0.065 | −0.059 | 0.31 | −0.0038 |
| 3 | −0.019 | −0.004 | +0.015 | −0.0036 | +0.052 | −0.020 | 0.05 | −0.0101 |
| 1 | −0.000 | −0.000 | +0.000 | −0.0001 | +0.002 | −0.000 | 0.00 | −0.0012 |

What this shows:
1. **The long leg dampens everything.** At entry the short put alone has Γ 0.0117 / Θ −0.163 / vega 0.305; the 5-wide spread nets only Γ −0.0029 / Θ +0.040 / vega −0.076 — ~25 % of the naked exposure. That is the price of defined risk: you keep ~25 % of the theta and ~25 % of the vega for capping the loss at width − credit.
2. **Untouched, the spread's value decays 0.67 → 0.31 (54 % of credit) by 7 DTE and to 0.05 by 3 DTE.** The 50 % profit target is hit around 7 DTE in this flat scenario, *before* the gamma danger zone.
3. **Net theta peaks around 7 DTE then falls** because the strike is far OTM and "dies". Holding an already-dead spread from 3 DTE to 0 earns ~$5/contract. That residual is not worth the tail risk (see 2.3).

### 2.3 The same spread after SPY falls 2 % to 637 (short strike under pressure)

| DTE | Short Δ | Net Δ | Net Γ | Net Θ /day | Net Vega | Spread value | Gamma-$ loss on a further 1 % move (per contract) |
|---|---|---|---|---|---|---|---|
| 14 | −0.357 | +0.089 | −0.0022 | +0.025 | −0.055 | 1.61 | $4.47 |
| 10 | −0.340 | +0.102 | −0.0034 | +0.041 | −0.060 | 1.48 | $6.85 |
| 7 | −0.318 | +0.115 | −0.0053 | +0.067 | −0.066 | 1.33 | $10.71 |
| 3 | −0.248 | +0.138 | −0.0140 | +0.189 | −0.075 | 0.88 | $28.33 |
| 1 | −0.126 | +0.108 | −0.0304 | +0.425 | −0.054 | 0.30 | $61.74 |

And if SPY falls 3.5 % to 627.2 (short strike ≈ ATM, spread now ITM):

| DTE | Short Δ | Net Δ | Net Γ | Net Θ /day | Spread value |
|---|---|---|---|---|---|
| 14 | −0.550 | +0.101 | ≈0 | −0.007 | 2.56 |
| 7 | −0.588 | +0.142 | +0.0004 | −0.016 | 2.63 |
| 3 | −0.648 | +0.215 | +0.0025 | −0.049 | 2.74 |
| 1 | −0.756 | +0.357 | +0.0138 | −0.216 | 2.94 |

Mechanical takeaways:
- A 2 % adverse move at entry turns a 0.67 credit into a 1.61 liability (−$94/contract, 2.4× the credit) — this is the **loss-side** most stop rules key on (2× credit, see §5).
- **Once the short strike is ATM, the spread has zero theta and positive gamma against you in P/L terms** — the theta edge is gone (net Θ turns *negative* because the long leg now decays faster than the short). Holding "for theta" after the short strike is breached is a category error.
- Gamma-$ for one more 1 % move goes from $4 at 14 DTE to $28 at 3 DTE to $62 at 1 DTE — a **14× increase** in the same position. That is the "gamma explosion".

### 2.4 Iron condor, 14 DTE, 16-delta wings: 626/631 puts + 672/677 calls

| DTE | Value | Net Δ | Net Γ | Net Θ /day | Net Vega | Θ/\|Γ\| |
|---|---|---|---|---|---|---|
| 14 | 1.30 | +0.002 | −0.0057 | +0.084 | −0.148 | 14.8 |
| 10 | 0.92 | +0.004 | −0.0073 | +0.108 | −0.136 | 14.8 |
| 7 | 0.57 | +0.006 | −0.0086 | +0.127 | −0.111 | 14.8 |
| 3 | 0.08 | +0.006 | −0.0059 | +0.087 | −0.033 | 14.7 |

The condor is delta-neutral, ~2× the theta and ~2× the vega of one vertical, and hits 50 % of max profit around 7–8 DTE if SPY sits still.

---

## 3. The gamma/theta tradeoff — the precise version

Under Black-Scholes, for any option **Θ ≈ −½ · σ² · S² · Γ** (the interest terms are negligible at ≤14 DTE). Consequence: **the ratio Θ/Γ is fixed by implied volatility, not by DTE** (see the constant Θ/|Γ| ≈ 13–15 columns above). Gamma "outweighing" theta is therefore never about the ratio — it is about **realized moves vs. implied moves**:

- A short-gamma position's daily P/L ≈ Θ · 1 day − ½ · Γ · (ΔS)².
- Break-even daily move = √(2Θ/Γ) = σ · S · √(1/365) = **the 1-day 1-SD move**. For the 631/626 spread this is $5.20–$5.39 at every DTE (SPY 1-day 1-SD at 16 % IV = $5.44).
- A **2-SD day ($10.89 on SPY)** costs the spread: 14 DTE $17.5 gamma-loss vs $4.0 theta earned; 7 DTE $27.1 vs $6.5; 3 DTE $21.1 vs $5.2 (per contract, flat-vol, strike still OTM). The loss is ~4× the daily theta at every DTE.

So why does everyone (tastylive, projectfinance, Days To Expiry) still say "close early / avoid the last days"?
1. **Absolute size.** Θ and Γ both grow ~1/√T as the strike approaches ATM. Same ratio, bigger numbers: a 2-SD day at 1 DTE on a tested spread costs $62 vs $4 at 14 DTE (table 2.3). The bet is the same shape but 10–15× bigger, on an account that hasn't gotten bigger.
2. **Convexity of remaining reward.** By 7 DTE the untouched spread has already paid 54 % of its credit; from 3 DTE onward the remaining reward is <10 % of credit while the remaining risk is the full width. Reward/risk collapses.
3. **Realized vol clusters and gaps.** Overnight gaps, event days and negative-gamma regimes (see 04-market-signals) produce >2-SD days more often than the lognormal model prices — and those are the days short gamma loses.
4. **Evidence.** projectfinance's 71,417-trade SPY iron-condor study (2007–2017, ~45 DTE, 16Δ/5Δ): win rate ~68 % held to expiry vs ~72 % with a 50 % profit target, and the 50 % target had the highest commission-adjusted average P/L; 90th-percentile losses were largest for hold-to-expiry-with-wide-stops. Days To Expiry summarises the tastylive 21-DTE research as ~15–20 % better risk-adjusted returns and worst losses clustering in the final 21 days (exact tastylive figures not independently verified).

### Rules for the 7–14 DTE window (translate "21 DTE" logic to a 14-DTE entry)

| Rule | Threshold | Rationale |
|---|---|---|
| G-1 Profit take | Close at **≥50 % of max credit** (credit spreads / condors) or **≥50 % of max debit gain** (debit spreads) | projectfinance 50 % target = best avg P/L; in table 2.2 this arrives ~7 DTE with no help from direction |
| G-2 Time stop | Close **all** remaining short-premium positions at **≤2 DTE** (i.e. no positions held into the last two sessions), regardless of P/L | From 3 DTE the untouched spread has <10 % of credit left but 14× the gamma-$ of entry if tested |
| G-3 Gamma dominance | If net Γ per contract × (1-day 1-SD move)² × ½ × 100 > 3 × net Θ per contract × 100, the position is "gamma-dominated" → close (rolling is not permitted at this DTE, 02 T9). Equivalent: the position's realized break-even move has fallen below half of the *realized* 5-day average true range | Once a spread is tested, its break-even move (√(2Θ/Γ)) shrinks; when realized range is routinely larger than that, expected daily P/L is negative |
| G-4 Tested strike | Short strike \|Δ\| ≥ 0.40 → position is "tested": no more theta edge (§2.3), treat as directional and apply the loss rule | At Δ0.55 net Θ is ≈0 or negative |
| G-5 Loss rule | Close credit spread when its mark ≥ **2× credit received** (loss = 1× credit); for condors, when either side's spread mark ≥ 2× the *total* credit | SJ Options / tastylive-style rule; projectfinance: −100 % (of credit) stops cut 90th-percentile loss to ~$1.00 per $1.00 credit vs ~$2.00 without |
| G-6 Weekend | Do not open new 7-DTE positions on Friday afternoon just to "collect weekend theta": a 16-delta strike loses only ~$0.16/contract/day of theta but takes 2–3 days of gap risk with no ability to act | Charm/theta over weekends is priced into Friday's quotes by market makers; the gap risk is not offset |

---

## 4. Entry targets

### 4.1 Strike selection by delta

| Structure | Short-strike delta | Long-strike / wing | Approx. POP at entry | Source |
|---|---|---|---|---|
| Credit spread, conservative | **0.10–0.16** | 1–5 strikes further OTM; on SPY prefer $2–$5 wide | 84–90 % OTM | StrikeWatch 1-SD ≈ Δ0.16; projectfinance 16Δ/5Δ study |
| Credit spread, standard | **0.16–0.30** | same | 70–84 % | projectfinance 30Δ/16Δ study (win rate ~40 % to expiry, ~55–60 % at 50 % target); Days To Expiry: 25–30Δ ≈ 70–75 % to expiry at 45 DTE |
| Iron condor | **0.16 both sides** (0.10–0.20 acceptable), wings 5Δ or fixed width | — | ~68 % to expiry, ~72 % with 50 % target (projectfinance) | projectfinance; StrikeWatch |
| Debit spread (directional) | Buy ~0.55–0.70Δ, sell ~0.30–0.40Δ (Δ-neutral-ish debit that pays ≤50 % of width) | — | — | Structural: keeps net Δ ≈ +0.25–0.35 per spread, limits theta bleed |
| Butterfly (neutral) | Body at ATM or at target level; wings ±1 × expected move | — | — | Expected-move framework (§6) |
| Credit/width | Target **≥ 33 % of width**; **hard floor 25 %** (canonical rule: 02 T4) | — | — | SJ Options "credit = 1/3 spread width" convention. Flat-vol BSM gives only 13 % for 16Δ 5-wide — real SPY put skew adds several cents, and narrower widths / slightly higher deltas raise the ratio; if the chain will not pay 25 % of width at ≤ 0.25Δ, there is no trade |

Never sell a short strike with \|Δ\| > 0.30 at entry for a "premium" trade (02 T2); that is a directional bet and must be sized and stopped as one.

### 4.2 Position and portfolio greek bands for a $2,500 account

Sources give guidance per $10k–$100k; scaled linearly for $2,500. These are **caps**, not targets.

| Metric | Guideline (sourced) | Scaled to $2,500 | Hard rule |
|---|---|---|---|
| Beta-weighted net Δ (SPY-equivalent) | "no more than 0.1 delta per $10,000 of net liq" ≈ 100 SPY-Δ per $100k (Options Jive); tastylive: match SPY notional exposure ⇒ NLV / SPY price (≈ 100 Δ per $45k at SPY 450) | Options Jive band: ±0.025 SPY-Δ per share ≈ **±2.5 Δ**; tastylive "match SPY": 2,500/650 ≈ **3.8 Δ** | Keep \|beta-weighted Δ\| ≤ **4 SPY deltas** (≈ $2,600 SPY-notional, ~100 % of NLV). Because one 5-wide 16Δ spread ≈ +5 Δ (0.053 × 100), this means **one directional vertical at a time**, or pair a put spread with a call spread (condor) to net toward 0 |
| Beta-weighted notional as % NLV | 20–40 % of NLV = moderate bias; >50 % P/L becomes direction-driven (Options Jive) | 20–40 % = $500–$1,000 SPY notional ≈ 0.8–1.5 Δ | Prefer condors / paired verticals so net Δ stays < 2 |
| Daily portfolio theta | 0.1 %–0.5 % of net liq per day (tastylive) | **$2.50–$12.50 /day** | One 14-DTE 5-wide 16Δ vertical = $4/day; one 16Δ condor = $8.4/day. So **1–2 open structures** is the whole book. Do not chase $12.50 by stacking correlated condors on SPY+QQQ+IWM |
| Δ/Θ ratio (negative-delta books) | ≈ 0.5 (tastylive) | same | If net Δ is negative (call spreads), \|Δ\| ≤ 0.5 × Θ |
| Net vega | no published $ rule; structural | 16Δ 5-wide vertical −7.6 $/IV-pt; condor −14.8 $/IV-pt | Cap total net vega so that a **+10 IV-point spike costs ≤ 6 % of NLV ($150)** ⇒ \|net vega\| ≤ 15 $/pt ≈ 2 verticals or 1 condor |
| Max loss per structure | (width − credit) × 100 | 5-wide ≈ $433 = 17 % of NLV; 2-wide ≈ $170 = 6.8 %; 1-wide ≈ $84 = 3.4 % | Defined-risk max loss per position ≤ **5 % of NLV ($125)** ⇒ on SPY at 650 use **$1–$2 wide** spreads, or trade XSP/QQQ/IWM-sized products. (See 01-account-and-capital-rules §5 for the authoritative sizing rule.) |

Width comparison at 14 DTE, short 631 put, flat 16 % IV (BSM): 1-wide credit 0.16 (16 % of width), 2-wide 0.30 (15 %), 3-wide 0.44 (15 %), 5-wide 0.67 (13 %), 10-wide 1.11 (11 %). Narrower spreads keep a slightly better credit/width but pay more in commissions and bid/ask as a fraction of credit.

---

## 5. Reading greeks for management (decision table)

Evaluate at least once per session (recommended: 30 min after open and 60 min before close) and on any 1 % intraday move.

| Condition (per structure) | Classification | Action |
|---|---|---|
| Mark ≤ 50 % of credit | Winner | Close (G-1). Do not wait for 75 %+ — projectfinance: 75 % target ≈ same P/L as 50 % with more time in trade |
| DTE ≤ 2 | Time stop | Close regardless (G-2) |
| Short strike \|Δ\| 0.30–0.40 and DTE ≥ 5 | Pressured | Hold if net Θ still > 0 and the move is < 1 SD-of-remaining-life from short strike; otherwise reduce. If a condor, consider closing the untested side when its value ≤ 10–20 % of its credit (frees margin, removes upside whipsaw) |
| Short strike \|Δ\| ≥ 0.40 | Tested (G-4) | Treat as directional. Close if mark ≥ 2× credit (G-5) or on any of the 06 §5.2 triggers. Rolling — out in time or of the untested side — is not permitted (02 T9/T19) |
| Mark ≥ 2× credit | Loss stop (G-5) | Close now. Do not "wait for theta" — a tested spread has no net theta |
| Net Θ ≤ 0 on a credit structure | Theta gone | Position is ITM enough that the long leg decays faster than the short. Close |
| Gamma-$ for a 1-SD day > 3× daily Θ-$ (G-3) | Gamma-dominated | Close or reduce |
| IV rank fell > 20 points since entry and mark ≤ 60 % of credit | Vega winner | Close — the vol edge has been collected; remaining P/L is pure gamma risk |
| IV spiked ≥ +5 pts since entry but price hasn't moved | Vanna alert | Short-strike \|Δ\| will read higher (vanna). Do not treat as "tested" on delta alone — check the underlying's distance to short strike in SD terms. If IV spike is event-driven and price is inside 0.5 EM of the short strike, close |

---

## 6. Expected move and 1-SD strike placement

Formula (StrikeWatch, projectoption, Options Analysis Suite all agree):

**EM(1 SD) = S × IV × √(DTE / 365)**  (IV as a decimal; some sources use trading days/252 — use 365 with calendar DTE and calendar-day IV as quoted by tastytrade)

Shortcut: EM ≈ ATM straddle price; tighter version ≈ 0.85 × straddle (StrikeWatch) — straddles overprice 1 SD because of skew.

SPY = 650, IV = 16 %:

| DTE | 1-SD EM | 1-SD range | 2-SD low | 1-day 1-SD |
|---|---|---|---|---|
| 14 | ±$20.37 (3.13 %) | 629.6 – 670.4 | 609.3 | $5.44 |
| 10 | ±$17.21 (2.65 %) | 632.8 – 667.2 | 615.6 | |
| 7 | ±$14.40 (2.22 %) | 635.6 – 664.4 | 621.2 | |
| 3 | ±$9.43 (1.45 %) | 640.6 – 659.4 | 631.1 | |
| 1 | ±$5.44 (0.84 %) | 644.6 – 655.4 | 639.1 | |

Placement rules:
- **Short strike at or beyond the 1-SD boundary** ⇒ \|Δ\| ≈ 0.16, ~84 % POP (StrikeWatch). Check that the delta from the chain agrees with the EM calculation; if the chain's 16Δ strike is *inside* the EM boundary, skew/term structure is distorting — prefer the further strike.
- **1.5-SD** (Δ ≈ 0.07, ~93 %) for low-credit, high-POP condors in high-IV regimes; **2-SD** (Δ ≈ 0.025) for wings only — credit is too small to sell at 2 SD on a $2,500 account after fees.
- Use the **EM of the remaining life** when re-evaluating: at 7 DTE the relevant 1-SD is $14.40, not $20.37. A short strike that is 1 SD away at entry is ~1.4 SD away after a week with no price change.
- For directional debit spreads, put the long strike near ATM and the short strike at ≈ 0.5–1.0 × EM in the direction of the trade; targets beyond 1 EM are low-probability by construction.

---

## 7. IV crush / IV expansion and spreads

Same 631/626 put spread, 14 DTE, SPY 650:

| IV | Spread value | Short Δ | Net vega |
|---|---|---|---|
| 12 % | 0.35 | −0.090 | −0.083 |
| **16 % (entry)** | **0.67** | −0.156 | −0.076 |
| 24 % | 1.17 | −0.246 | −0.049 |

At 7 DTE: 12 % → 0.10, 16 % → 0.31, 24 % → 0.77.

Rules:
- **Selling into high IV rank, buying into low IV rank.** An 8-point IV rise turns the 0.67 credit into a 1.17 liability (−$50/contract) *with no price move* and pushes the short delta from 0.16 to 0.25 (vanna). An IV drop of 4 pts alone delivers ~48 % of max profit. Premium sellers want IV that is high *relative to its own history* (IVR) and *relative to realized* (VRP) — see 04-market-signals §3–4 — so that mean-reversion of IV is a tailwind.
- tastytrade's platform default: "sell premium when IV rank is above 50, buy when below 30" (as summarised by Volatility Box); TradingBlock: IVR > 50 sell / < 25 buy, IV percentile > 75 sell. Volatility Box's own backtest: iron condors with IVR > 50 **and** IV-percentile > 50 won 56.8 % vs 48.2 % unfiltered (595 symbols). Counter-evidence: SJ Options' 2005–2015 SPX 10Δ/7Δ put-spread backtest found *low* IVR entries had 27 % smaller average losers and "no advantage to high IV rank entry signals". Treat IVR as a **necessary filter for adequate credit**, not a proven edge on its own; the reliable edge is the variance risk premium (Cboe: VIX averaged 19.3 vs 15.1 realized, 1990–2018).
- **Debit spreads / long butterflies** are the reverse: enter when IVR is low (< 30) so vega is cheap; their max loss is the debit, but a +IV move helps only modestly because the short leg offsets most vega.
- **Vega shrinks with DTE**, so a spread opened at 14 DTE has lost ~25 % of its vega exposure by 7 DTE and ~75 % by 3 DTE. IV crush after an event helps most when the event lands early in the hold; IV expansion hurts most in the first days.
- **Never hold short-premium spreads across scheduled binary events** (FOMC, CPI, NFP, the underlying's earnings) unless the short strike is beyond the event-implied move (ATM straddle for the expiry containing the event) — the IV expansion into the event and gamma on the day both work against the position. Index ETFs (SPY/QQQ/IWM) have no earnings but do have macro events.

---

## 8. Portfolio-level beta-weighted delta

Formula (Options Jive): **Beta-weighted Δ = Option Δ × contracts × 100 × β(underlying vs SPY) × (Underlying price / SPY price)**. tastytrade displays this natively (beta-weight to SPY).

Steps for the bot:
1. For each leg compute position delta (Δ × qty × 100, sign by long/short).
2. Multiply by β and by the price ratio to convert to SPY-share equivalents.
3. Sum across all positions → net SPY-equivalent Δ. Multiply by SPY price → SPY-equivalent notional. Divide by NLV → market exposure %.
4. Apply the §4.2 caps: \|net Δ\| ≤ 4 SPY-Δ; exposure ≤ 100 % NLV; prefer 20–40 %.

Correlation note: SPY–QQQ correlation ≈ 0.93 (range 0.87–0.94 across timeframes), SPY–IWM ≈ 0.79 (0.78–0.85) (PortfoliosLab). Three "separate" condors on SPY, QQQ and IWM are ~one condor sized 3×; beta-weight them together and apply the theta and vega caps to the *sum*.

---

## 9. Greek red-flags table

| # | Red flag | Threshold | Response |
|---|---|---|---|
| R1 | Short strike delta at entry too high | \|Δ\| > 0.30 for a credit structure (02 T2) | Reject the trade / choose a further strike |
| R2 | Short strike delta while open | \|Δ\| ≥ 0.40 | Tested — directional management, loss rule G-5 |
| R3 | Credit spread mark vs credit | mark ≥ 2 × credit | Close (loss ≈ 1× credit) |
| R4 | Net theta of a credit structure | ≤ 0 | Close — no edge remains |
| R5 | Gamma-$ vs theta-$ | ½ × \|net Γ\| × (1-day 1-SD move)² × 100 > 3 × net Θ × 100 | Gamma-dominated; close/reduce |
| R6 | Days to expiry | ≤ 2 DTE with any short option open | Close (G-2) |
| R7 | Portfolio beta-weighted delta | \|Δ_SPY\| > 4 (≈ 100 % NLV notional) | Add offsetting side (convert vertical → condor) or close |
| R8 | Portfolio theta | > 0.5 % NLV/day ($12.50) | Over-levered short premium; do not add |
| R9 | Portfolio net vega | \|vega\| > $15/pt (a +10-pt IV spike > 6 % NLV) | Do not add short-vega positions; close weakest |
| R10 | IV move since entry | +5 IV pts or more with price within 0.5 × remaining EM of short strike | Close |
| R11 | Distance to short strike | < 0.5 × remaining-life 1-SD EM | Pressured; treat like R2 unless DTE ≥ 7 and IV falling |
| R12 | Credit/width at entry | < 25 % of width (target ≥ 33 %; 02 T4) | Reject — reward/risk cannot survive the base loss rate |
| R13 | Long leg residual value (condor untested side) | ≤ 10–20 % of that side's credit | Optional close of that side to free margin and avoid whipsaw |
| R14 | Untouched spread with < 10 % of credit remaining and DTE ≥ 3 | e.g. 0.05 on a 0.67 credit | Close — you are holding full width risk for pennies |

---

## 10. Worked entry example (for the agent to pattern-match)

Inputs: SPY 650, 30-day IV 16 %, IVR 45, 14 DTE expiry, VIX in 15–20 band, no macro event inside the hold, NLV $2,500.

1. EM(14 DTE) = 650 × 0.16 × √(14/365) = $20.37 → 1-SD low 629.6.
2. Chain: 631 put Δ −0.156 (just inside 1 SD — acceptable; 630 would be exactly 1 SD). Choose short 630 or 631; long 2 wide (629/628) for max loss ≤ $170 = 6.8 % NLV (or 1-wide for ≤ $84).
3. Expected credit (2-wide, flat vol) 0.30 = 15 % of width — **below the 25 % floor (02 T4)**. On a real skewed chain the same strikes typically pay more; if the live quote is still < 0.50 (25 %), move the short strike in toward 0.20–0.25Δ or narrow to $1 wide; if no strike ≤ 0.25Δ pays ≥ 25 % of width, there is no trade today.
4. Net greeks per contract (2-wide, scale from table 2.2 ≈ 40 %): Δ +2.1, Γ −0.12, Θ +$1.6/day, vega −$3.1/pt. Portfolio caps OK.
5. Management schedule (assuming a 0.50 fill): profit close at mark ≤ 0.25; loss close at mark ≥ 1.00; short-strike Δ ≥ 0.40 ⇒ tested; hard close at 2 DTE (Wednesday of expiry week for a Friday expiry); re-check EM daily with remaining DTE.

---

## Sources

- Option Alpha — Options Greeks (delta≈probability, gamma highest ATM, theta acceleration, vega falls with time): https://optionalpha.com/learn/options-greeks
- StrikeWatch — Expected move formula, straddle shortcut, 1-SD/1.5-SD/2-SD delta table: https://www.strike-watch.com/lab/expected-move-options-implied-volatility-range
- projectoption — Expected move calculator: https://projectoption.com/expected-move-calculator
- projectfinance — Iron Condor Management Results from 71,417 Trades (16Δ/5Δ and 30Δ/16Δ, win rates and P/L by management rule): https://www.projectfinance.com/iron-condor-management/
- Days To Expiry — The 21 DTE rule (summary of tastylive research; gamma phases): https://www.daystoexpiry.com/blog/the-21-dte-rule-explained-when-and-why-to-close-options-positions-early
- Days To Expiry — Theta decay curve / gamma multiplier by DTE: https://www.daystoexpiry.com/blog/theta-decay-dte-guide
- Days To Expiry — Best DTE for credit spreads (25–30Δ win rates): https://www.daystoexpiry.com/blog/best-dte-for-credit-spreads-a-data-driven-comparison-of-30-45-and-60-day-trades
- tastylive — Options Portfolio: How Much Delta & How Much Theta? (0.1–0.5 % NLV theta/day; match SPY exposure; Δ/Θ ≈ 0.5): https://www.tastylive.com/news-insights/how-to-put-delta-and-theta-to-work
- Options Jive — Beta-weighted delta formula, 0.1 Δ per $10k, 20–40 % NLV exposure: https://optionsjive.com/blog/beta-weighted-delta/
- tastytrade Help Center — Beta-weighting (page did not render at fetch time; formula taken from Options Jive): https://support.tastytrade.com/support/s/solutions/articles/43000522492
- Pro Trader Dashboard — Charm (delta decay) definition, OTM/ITM sign, weekend example: https://protraderdashboard.com/blog/charm-options-greek/
- TradingBlock — IV rank vs IV percentile formulas and thresholds (IVR > 50 sell, < 25 buy; IV%ile > 75 sell): https://www.tradingblock.com/blog/iv-rank-vs-iv-percentile
- Volatility Box — IV rank vs percentile; condor backtest 56.8 % vs 48.2 %; tastytrade default thresholds: https://volatilitybox.com/research/iv-rank-vs-iv-percentile/
- SJ Options — Tastytrade credit spreads 11-year backtest (1/3-width credit, 45 DTE, IVR 50–100, 50 % winners, 2× stop; 61 % win rate but negative returns): https://www.sjoptions.com/tastytrade-credit-spreads-do-they-work/
- SJ Options — High vs low IV rank credit spreads (low IVR losers 27 % smaller): https://www.sjoptions.com/high-iv-rank-vs-low-iv-rank-credit-spreads/
- Cboe — Volatility risk premium white paper (VIX avg 19.3 vs realized 15.1, 1990–2018): https://www.cboe.com/insights/posts/white-paper-shows-volatility-risk-premium-facilitated-higher-risk-adjusted-returns-for-put-index/
- PortfoliosLab — SPY vs QQQ correlation 0.93 (0.87–0.94): https://portfolioslab.com/tools/stock-comparison/SPY/QQQ
- PortfoliosLab — IWM vs SPY correlation 0.79 (0.78–0.85): https://portfolioslab.com/tools/stock-comparison/IWM/SPY
- Numeric greek tables: Black-Scholes computed by the author (script `bs.py`, SPY 650 / IV 16 % / r 4 % / calendar-day T), 2026-09-13. Values are model outputs, not market quotes.
