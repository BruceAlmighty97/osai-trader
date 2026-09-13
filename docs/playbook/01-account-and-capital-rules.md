# 01 — Account Mechanics and Capital Rules ($2,500 tastytrade account)

Reference document for an automated, defined-risk options bot. Rules are written to be applied mechanically. Where a number is a hard rule for this account it is marked **RULE**. Where sources disagree or a value could not be verified, it is flagged **UNVERIFIED** and a conservative default is given.

Account profile assumed throughout:

| Parameter | Value |
|---|---|
| Broker | tastytrade |
| Starting net liquidating value (NLV) | $2,500 |
| Account type | Individual **margin** account (required for spreads; see §1) |
| Options level | **The Works** (account is approved for everything, including uncovered options and futures). This makes the software-level defined-risk gate (RULE A2 / 02 RULE T0) the *only* thing preventing an undefined-risk order — the broker will not reject one |
| Strategy universe | Defined-risk only (verticals, iron condors, iron flies, BWB, debit spreads, long options) |
| Holding window | 7–14 DTE at entry |
| Goal | Slow, consistent growth; capital preservation first |

---

## 1. tastytrade trading permissions (options levels)

tastytrade has **three option permission tiers: Limited, Basic, The Works**. Permissions are "subject to tastytrade's suitability requirements and approval." (tastytrade Trading Permissions page.)

| Level | Allows | Does NOT allow | Relevance to this bot |
|---|---|---|---|
| **Limited** | Buy calls/puts, covered calls, cash-secured puts | "Limited does not allow defined-risk options spreads or uncovered options." | **Insufficient** — cannot trade verticals/condors |
| **Basic** | Buying options, covered calls, **defined-risk options spreads**, selling uncovered *puts* (margin) | "Basic does not permit uncovered calls or futures trading." | **Target level.** Everything this bot trades is permitted. |
| **The Works** | "covered and uncovered options, covered and uncovered option spreads, short stock, futures, and options on futures"; portfolio-margin eligible | — | **This account's level.** Every structure in 02 is permitted, and so is everything in 02 §8's excluded list — the broker will happily accept a naked short or a strangle. The defined-risk constraint therefore lives entirely in the bot's own order validation. |

Sources: tastytrade Trading Permissions page; TopRatedFirms tastytrade options levels summary.

**RULE A1.** Permission level is not a constraint for this account. If an order is nonetheless rejected with a permissions or suitability message, halt and alert — do not retry with a different structure.

**RULE A2 (the critical gate).** Because the account is approved for The Works, nothing at the broker stops an undefined-risk order. The bot must run a pre-submit validator on every order and refuse any order whose worst-case loss is not capped by a long option in the same order: for every short leg there must be a long leg of the same type (put/call), same or greater quantity, in the same or a later expiration; net short quantity per type must be ≤ 0; no short stock; no futures or futures options. Implement this as a hard fail in code (and in the dry-run check, RULE A9), not as a prompt instruction. Log every rejection.

### Cash vs. margin account

- **Margin account** (FINRA Rule 4210(b)): initial requirement is "equity of at least $2,000 except that cash need not be deposited in excess of the cost of any security purchased." A $2,500 account satisfies the $2,000 margin-account floor. If NLV drops below $2,000 the account may lose margin privileges and be restricted to cash-account-like behaviour (**UNVERIFIED at tastytrade specifically**; treat $2,000 NLV as a hard floor — see kill-switch §9).
- **Cash account**: not applicable — The Works requires a margin account.
- **Decision:** the account is a **margin account at The Works**. Reg-T margin is only used to *hold* spreads (BPR = width − credit); the bot never borrows and never uses the uncovered-option or futures permissions.

**RULE A3.** Keep NLV ≥ $2,000 at all times. If NLV < $2,100, the bot enters "reduce-only" mode (no new openings) until NLV ≥ $2,200 (hysteresis to avoid flapping).

---

## 2. Pattern Day Trader (PDT) rule — status as of 2026

**Historical rule (2001 – June 3, 2026):** four or more day trades within a rolling five-business-day window in a margin account flagged the account as a Pattern Day Trader, which required $25,000 minimum equity to continue day trading. A "day trade" is "the opening and closing of the same position within the same trading session. This applies to stocks, ETFs, and options." For spreads, "each leg of a spread executed and closed intraday may count separately depending on how the trades are processed." (tastytrade PDT page.)

**Current rule:** The SEC approved FINRA's amendment to Rule 4210 on **April 14, 2026** (SR-FINRA-2025-017, release 34-105226), eliminating the PDT designation and the $25,000 minimum-equity requirement, replacing it with an **intraday margin** framework for all margin accounts. tastytrade states the new regime took effect **June 4, 2026**: "No more $25K minimum or the 3-in-5-day rule." (tastytrade PDT page; tastytrade /pdt/ page; SEC release 34-105226.)

What replaced it (FINRA 4210(d)(2) as amended):

- Firms compute each customer's **intraday margin deficit** — the largest shortfall between required maintenance margin and account equity during the day.
- Deficits must be satisfied "as promptly as possible."
- A deficit unsatisfied after **5 business days** triggers a **90-day freeze** on creating or increasing short positions / debit balances.
- FINRA allowed an 18-month phase-in window for firms; tastytrade implemented on June 4, 2026.

**Practical consequences for this bot:**

1. Same-day open-and-close of a spread (e.g., a 50 % profit target hit intraday, or a stop triggered) **no longer counts against any day-trade quota**. There is no longer a reason to defer a close to the next session to preserve day trades.
2. Because BPR for a defined-risk spread is fully reserved at order entry (width − credit), a bot that only opens positions it has buying power for will **never create an intraday margin deficit**. 

**RULE A4.** Never submit an opening order whose BPR exceeds *available* option buying power reported by the broker at that moment (use a dry-run/margin-impact check before every open). This guarantees no intraday margin deficit under the June-2026 rules.

**RULE A5 (defensive).** Track day trades anyway (open+close of the same spread in one session). If a broker message ever references a PDT flag or a day-trade restriction, stop opening new positions and alert — the rule could be reinstated or the broker's implementation could differ.

---

## 3. tastytrade commissions and fees for options (as of July 30, 2026 schedule)

| Item | Stock/ETF options (SPY, QQQ) | Broad-based index options (SPX, XSP, NDX, XND) |
|---|---|---|
| Commission to **open** | $1.00 / contract | $1.00 / contract |
| Commission to **close** | $0.00 | $0.00 |
| Commission cap | **$10 per leg** (i.e., ≥10 contracts on one leg pay $10 for that leg) | Same capped-commission offer applies to index options (futures options are the excluded product) |
| Clearing fee | $0.10 / contract (open **and** close) | $0.10 / contract (open and close) |
| Options Regulatory Fee (ORF) | $0.02 / contract | $0.02 / contract |
| FINRA TAF (options) | $0.00329 / contract (on sells) | $0.00329 / contract (on sells) |
| Exchange proprietary index fee | n/a | **SPX $0.60**, NDX $0.25, RUT $0.18, VIX $0.35 per contract; **XSP/XND fee not listed on the schedule — UNVERIFIED, assume a small per-contract fee may apply** |
| Exercise / assignment | $5.00 | n/a (cash settled; no exercise/assignment fee event) |

Source: tastytrade Commissions & Fees schedule (contentstack PDF, "Last updated July 30, 2026"); StockBrokers.com review confirms $1.00 open / $0.00 close / $10 per-leg cap.

### Fee model the bot must use

For a **2-leg vertical, 1 contract per leg**, round trip:

```
open  = 2 × ($1.00 commission + $0.10 clearing + $0.02 ORF)        = $2.24
close = 2 × ($0.00 commission + $0.10 clearing + $0.02 ORF)        = $0.24
TAF/SEC fees on the sell side ≈ $0.01                              ≈ $0.01
round-trip total (equity/ETF options)                              ≈ $2.49  → budget $2.50
```

For a **4-leg iron condor / iron fly, 1 contract per leg**: open ≈ $4.48, close ≈ $0.48, **budget $5.00 round trip**.

For **SPX** add $0.60 × contracts × 2 (open + close); for **XSP/XND** add an allowance of $0.10 × contracts × 2 (**UNVERIFIED**).

**Fee drag as % of credit** (2-leg vertical, $2.50 round trip):

| Credit collected | Fees / credit | Fees / 50 % target profit |
|---|---|---|
| $0.20 ($20) | 12.5 % | 25 % |
| $0.33 ($33) | 7.6 % | 15 % |
| $0.50 ($50) | 5.0 % | 10 % |
| $0.70 ($70) | 3.6 % | 7 % |
| $1.00 ($100) | 2.5 % | 5 % |

**RULE A6 (minimum credit / fee gate).** Do not open a credit trade unless *net credit after modelled round-trip fees* ≥ 90 % of gross credit, **and** gross credit ≥ $0.30 per vertical ($30) or ≥ $0.60 per 4-leg structure ($60). This effectively forbids $1-wide spreads that collect less than ~$0.30 and makes $1-wide verticals marginal: prefer $2–$5 widths where the 1/3-of-width credit rule (see 02-strategies) yields ≥ $0.65.

**RULE A7.** Expected value must be computed **net of fees**: `EV = P(win) × (target_profit − fees) − P(loss) × (stop_loss_amount + fees)`.

---

## 4. Buying power reduction (BPR) for defined-risk spreads

tastytrade's definition for a short vertical: margin requirement / max loss = "Total credit received – (Spread width × 100)". Example: $200 credit − ($5 × 100) = −$300 BPR. (tastytrade short-put-vertical page.)

| Structure | BPR (per 1-lot) |
|---|---|
| Credit vertical | (width − credit) × 100 |
| Iron condor (equal wings) | (wider wing width − total credit) × 100 — only one side can lose |
| Iron condor (unequal wings) | (max(put width, call width) − total credit) × 100 |
| Iron butterfly | (wing width − total credit) × 100 |
| Debit vertical | debit × 100 |
| Long call / long put | premium × 100 |
| Long calendar / diagonal (same width or long-dated leg protects) | net debit × 100 (diagonal with wider short side: + strike difference × 100) |
| Broken-wing butterfly | (wider wing − narrower wing − net credit) × 100, or net debit × 100 if opened for debit |

**RULE A8.** `max_loss = BPR + round_trip_fees`. All sizing in §5 is based on `max_loss`, not on BPR alone.

**RULE A9.** Before every opening order run the broker's dry-run/margin-impact call and require `reported_BPR ≤ computed_BPR × 1.05`; otherwise reject the trade (protects against misconfigured legs, e.g. accidentally different expirations).

---

## 5. Position sizing rules

Sources give a range: "risk 1–2 % of your account on any one trade," "absolute ceiling ~5 %," and for accounts under ~$2,000–$5,000 "use defined-risk $1-wide spreads; accept ~3 % per trade" because contract minimums make 1 % impossible (PurePowerPicks position-sizing guide). The iron-condor backtest source recommends "2–3 % position sizing" (OptionsPilot SPX backtest). Correlation caveat: five 2 % positions on correlated names are "roughly one 10 % bet" (PurePowerPicks).

Applied to $2,500 NLV:

| Rule | Value | Dollar amount at $2,500 |
|---|---|---|
| **RULE S1** Max `max_loss` per position | **5 % of NLV** (hard cap); target 3–4 % | ≤ $125 (target $75–$100) |
| **RULE S2** Max concurrent positions | **5** | — |
| **RULE S3** Max total BPR in use | **30 % of NLV** in normal conditions (VIX < 30); **20 %** when VIX ≥ 30. Never higher than 30 % — low-IV regimes do not justify more exposure | $750 normal / $500 high-vol |
| **RULE S4** Max BPR in one underlying | 15 % of NLV | $375 |
| **RULE S5** Correlated-underlying limit | SPY/XSP/SPX/ES-proxies count as **one** underlying group; QQQ/XND/NDX as one group; IWM/RUT a third. Same-direction exposure across all groups ≤ 25 % of NLV. For greek caps (03 §4.2) treat all index groups as one book | $625 |
| **RULE S6** Max net delta (beta-weighted to SPY) | \|net SPY-beta-weighted delta\| ≤ **4** (≈ 100 % of NLV in SPY notional); prefer ≤ 2. Full formula and theta/vega caps in 03-greeks §4.2 | — |
| **RULE S7** Contract count | 1 contract per leg while NLV < $5,000 | — |
| **RULE S8** Same-expiration concentration | No more than 3 positions expiring the same day | — |

Note: with S1 = $125 and typical $2-wide verticals (BPR ≈ $130–$140 at 1/3 width credit), the bot is effectively limited to **$1–$2 wide spreads, or $3–$5 wide spreads only when credit ≥ 45–60 % of width** (which is an iron-fly/BWB profile, not a 16-delta vertical). See worked example §10.

---

## 6. Cash-settled European index options vs. American-style ETF options

| Feature | SPY / QQQ options | XSP | SPX | XND | NDX |
|---|---|---|---|---|---|
| Underlying | ETF shares | S&P 500 index ÷ 10 | S&P 500 index | Nasdaq-100 ÷ 100 | Nasdaq-100 |
| Multiplier | $100 | $100 | $100 | $100 | $100 |
| Notional (S&P ≈ 6,500) | ≈ $65,000 (SPY) | ≈ $65,000 | ≈ $650,000 | ≈ $30,000 | ≈ $3,000,000 |
| Exercise style | **American** (assignable any business day) | **European** (expiration only) | European | European | European |
| Settlement | Physical shares | **Cash** | Cash | Cash | Cash |
| AM/PM | n/a (PM close, physical) | **PM-settled** (all series) | Standard 3rd-Friday SPX = **AM-settled** (SET/SOQ, last trade Thursday); SPXW weeklies = PM | PM only | AM and PM series exist |
| Expirations | Mon/Tue/Wed/Thu/Fri | Mon, Tue, Wed, Thu, Fri, 3rd Fri, end-of-month | Daily | Weekly and monthly | Daily, weekly, monthly |
| Tax | Equity option (short-term rates) | **Section 1256 (60/40)** | Section 1256 | Section 1256 | Section 1256 |
| Dividend risk | **Yes** (quarterly ex-dates) | None | None | None | None |
| Pin / assignment risk | Yes | None (cash) | None | None | None |
| Bid-ask | Tightest (as low as $0.01) | Wider than SPY | Wide in $ but tight in % of notional | Wider | Wide in $ |
| Exercise/assignment fee | $5 | none | none | none | none |

Sources: Cboe XSP fact sheet; Nasdaq XND/NDX page; Cboe SPX AM-settlement paper; tastytrade fee schedule.

### 6.1 Assignment / exercise mechanics (American style)

- "Once you sell an American-style option (put or call), you have the potential for assignment … on any business day." Assignments are determined "based on net positions after the close of the market each day." (OIC.)
- **Auto-exercise:** "OCC employs an administrative procedure where options that are $.01 in-the-money are exercised unless contrary instructions are provided." (OIC.)
- **Pin risk:** at expiration, if the short strike is at/near the underlying price, the bot cannot know whether the short leg will be assigned while the long leg expires worthless. Result: an unintended long or short stock position of 100 shares (≈ $65,000 notional on SPY) in a $2,500 account. tastytrade warns to consider "closing or rolling the position before expiration" when account equity is insufficient for resulting shares.
- **Early assignment on a spread** is not a loss in itself (the long leg still caps risk) but it converts the position to stock + option, consumes buying power far beyond $2,500, and tastytrade's risk desk may liquidate. Deep-ITM short puts on SPY late in the cycle are the realistic case.
- **Broker expiration-risk process:** tastytrade has a stated policy of closing positions that pose expiration risk (ITM short options that would create positions the account cannot support). Exact cut-off time **UNVERIFIED** (Help Center articles 43000484765/43000484774 did not render). Conservative assumption: any SPY/QQQ short option within 1 % of the money on expiration day after 2:00 pm ET is at risk of forced liquidation at the broker's price.

### 6.2 Dividend risk (short calls on SPY/QQQ)

- Assignment risk "increases just before the ex-dividend date for short calls and just after the ex-dividend date for short puts." (OIC.)
- A short call is likely assigned the day before ex-date when the dividend exceeds the remaining extrinsic value — "the long call option holder will only exercise the option if the corresponding put option's price is less than the dividend payment." (Option Alpha.)
- Someone assigned and short shares on the ex-date "is required to pay the dividend."
- **SPY 2026 ex-dates:** 3/20, 6/18, **9/18**, 12/18 (SSGA schedule) — SPY ex-dates fall on the third Friday of the quarter-end month (the monthly expiration day).
- **QQQ ex-dates:** ~Mar 23, Jun 22, Sep 22, Dec 22 (2026 pattern; StockAnalysis).

**RULE D1.** For SPY/QQQ, do not hold any **short call** (bear call spread, iron condor/iron fly call side) through an ex-dividend date. Close call-side positions no later than the close of the session **two trading days** before the ex-date, or choose expirations that expire before the ex-date, or use XSP/XND instead during ex-dividend weeks.

**RULE D2.** For SPY/QQQ, if the short call's extrinsic value < the declared dividend at any time within 5 trading days of the ex-date, close immediately.

### 6.3 Settlement timing rules

- **XSP / SPXW / XND: PM-settled** — settlement value is the index's closing level on expiration day; cash is delivered the next business day. No SET/SOQ surprise.
- **Standard 3rd-Friday SPX (and 3rd-Friday NDX AM series): AM-settled.** Last trading day is **Thursday**; the settlement value (SET) is computed from Friday's **opening** prices. Cboe: median |SET − prior close| = 0.16 % (2009–2024), but the SOQ "fell outside the high and low range of the S&P 500 Index on quarterly A.M.-settled SPX option expiration dates approximately 30 % of the time." A 7–14 DTE spread cannot be managed after Thursday's close.

**RULE D3.** Never trade AM-settled series (standard 3rd-Friday SPX/NDX). On the tastytrade chain, for SPX use only the SPXW (PM) series; XSP and XND are always PM. If settlement type cannot be confirmed from the instrument data, do not trade it.

### 6.4 Section 1256 tax treatment

- Broad-based index options (SPX, **XSP**, NDX, XND, RUT, VIX) are "nonequity options" under IRC §1256. **SPY/QQQ/IWM options are equity options and do NOT qualify.**
- 60 % of gain/loss is long-term and 40 % short-term "no matter how briefly you held it"; open positions are marked to market on the last business day of the year; reported on Form 6781; net 1256 losses may be carried back 3 years against prior 1256 gains; **wash-sale rules do not apply** (important for a bot that re-enters the same strikes repeatedly). (TaxGuidance.org; Cboe XSP fact sheet.)

### 6.5 Why index options can be preferable for a $2,500 account

1. No early assignment, no dividend risk, no pin risk, no $5 exercise/assignment fee, no chance of an unwanted 100-share position in a $2,500 account.
2. No wash-sale bookkeeping for a high-frequency bot; 60/40 tax treatment.
3. XSP notional ≈ SPY notional, so strike widths and credits are comparable; XND notional ≈ $30k (smaller than QQQ) allowing finer sizing.

Costs: wider bid-ask spreads than SPY/QQQ, lower open interest per strike, and the possibility of a small exchange fee. **Policy:** prefer **XSP** (and XND) when the quoted spread passes §8 liquidity tests; fall back to SPY/QQQ only when the XSP/XND markets fail the liquidity test, and then obey RULE D1–D2 and the expiration-day rules in 02-strategies.

---

## 7. Volatility inputs the rules reference

- **IV Rank (IVR)** = where current IV sits between the 52-week low and high of IV: `(IV − IV_52w_low) / (IV_52w_high − IV_52w_low) × 100`. **IV percentile** = % of days in the past year with IV below today's. tastytrade's platform shows both (Help Center article did not render — definitions are the standard ones; **treat as UNVERIFIED wording, standard math**).
- Schwab guidance: sell credit spreads when IV > 50th percentile of its 52-week range; buy debit spreads when IV is in the 0–50th percentile.

---

## 8. Liquidity requirements

Sources give qualitative guidance (open interest "at a minimum, hundreds. Ideally, thousands"; SPY/QQQ spreads "as tight as $0.01"; zero volume is "a huge red flag" — TradingBlock). Converted into hard gates:

| Gate | RULE L# | Threshold |
|---|---|---|
| Bid-ask width, each leg | **L1** | ≤ $0.05 for SPY/QQQ; ≤ $0.10 for XSP/XND; ≤ $0.30 for SPX. Also ≤ 10 % of the leg's mid price (≤ 20 % for legs with mid < $0.30) |
| Bid-ask width, whole spread (natural vs. mid) | **L2** | Natural credit ≥ 85 % of mid credit, i.e., expected slippage ≤ 15 % of credit |
| Open interest, each leg | **L3** | ≥ 500 (SPY/QQQ), ≥ 100 (XSP/XND/SPX) |
| Volume today, each leg | **L4** | ≥ 100 (SPY/QQQ), ≥ 20 (XSP/XND/SPX) after 10:00 ET; before 10:00 ET use prior-day volume |
| Quote staleness | **L5** | Last quote update ≤ 5 s old; bid > 0 on every leg |
| Order type | **L6** | Limit orders only, priced at mid; if unfilled after 30 s, improve by $0.01 (SPY/QQQ) or $0.05 (index) up to 3 times, never beyond the L2 floor |

---

## 9. Drawdown / kill-switch rules

All thresholds use **realized + unrealized P&L** measured against the higher of (start-of-period NLV, prior period-end NLV). "Pause" = cancel all working opening orders, allow only closing orders.

| Trigger | RULE K# | Threshold at $2,500 | Action |
|---|---|---|---|
| Daily loss | **K1** | −3 % of NLV (−$75) | Pause new entries for the rest of the session |
| Daily loss, severe | **K2** | −5 % (−$125) | Pause; also close any position whose current loss ≥ 1.5× its credit |
| Weekly loss (Mon–Fri) | **K3** | −6 % (−$150) | Pause new entries until next Monday |
| Monthly loss | **K4** | −10 % (−$250) | Pause until 1st of next month; require human review before restart |
| Consecutive losing closes | **K5** | 3 in a row | Pause 2 trading days; on resume, size at 50 % of S1 for the next 5 trades |
| Consecutive losing closes | **K6** | 5 in a row | Pause until human review |
| Peak-to-trough drawdown | **K7** | −15 % from all-time-high NLV | Hard stop; human review required |
| NLV floor | **K8** | NLV < $2,100 | Reduce-only mode (see RULE A3) |
| Broker anomalies | **K9** | Any rejected order, margin call, PDT/day-trade message, assignment notice, or BPR reported > 1.05× computed | Pause and alert |
| Volatility shock | **K10** | VIX up ≥ 20 % intraday or VIX ≥ 35 | No new premium-selling entries; existing positions follow their stops |
| Data quality | **K11** | Quote feed stale > 60 s, or option chain missing greeks | Pause |

Logging requirement: every trigger writes (timestamp, trigger id, NLV, open positions, action taken) so the human can audit.

---

## 10. Worked example — $2-wide SPY bull put spread, $0.70 credit

Setup: sell SPY put at strike K, buy SPY put at K − 2, same 7–14 DTE expiration, 1 contract each, filled for a net credit of $0.70.

| Quantity | Formula | Value |
|---|---|---|
| Gross credit | 0.70 × 100 | **$70.00** |
| BPR (max loss before fees) | (2.00 − 0.70) × 100 | **$130.00** |
| Round-trip fees (2 legs) | open $2.24 + close $0.24 + ≈$0.01 | **≈ $2.49 → $2.50** |
| Net credit after fees | 70 − 2.50 | **$67.50** |
| Max loss including fees (`max_loss`) | 130 + 2.50 | **$132.50** |
| Fee drag on gross credit | 2.50 / 70 | **3.6 %** |
| Breakeven at expiration | K − 0.70 | K − $0.70 |
| Credit as % of width | 0.70 / 2.00 | 35 % (meets the 1/3-of-width rule) |
| Approx. POP (1 − credit/width) | 1 − 0.35 | ≈ 65 % (rough; verify against broker's POP) |
| % of $2,500 NLV at risk | 132.50 / 2,500 | **5.3 %** |
| 50 % profit target (gross) | 0.35 × 100 | $35 → **$32.50 net of fees** |
| Reward:risk at 50 % target | 32.50 / 132.50 | 0.25 : 1 |

**Sizing check against §5:**

- RULE S1 (≤ 5 % = $125): **5.3 % exceeds the cap by $7.50.** Options: (a) require ≥ $0.78 credit on the $2-wide spread (BPR $122 + fees = $124.50), (b) use a $1.50-wide spread if listed, or (c) accept only while NLV ≥ $2,650 (where $132.50 = 5.0 %). The bot must **reject** the $0.70/$2-wide trade at $2,500 NLV under the hard 5 % cap, or the human must set S1 to 5.5 % explicitly.
- If S1 were satisfied: RULE S3 (30 % of NLV = $750 total BPR) → floor(750 / 130) = **5 positions**, which also equals RULE S2's cap of 5. RULE S4 (15 % per underlying = $375) → at most **2** such SPY spreads at once (2 × $130 = $260; a third = $390 > $375). RULE S5 groups SPY and XSP together.
- So the realistic book is: ≤ 2 SPY/XSP-group spreads + ≤ 2 QQQ/XND-group spreads (+1 uncorrelated or none), total BPR ≤ $750.

**Expectancy sanity check (per trade, net of fees, 50 % profit target, stop when the spread's mark reaches 2 × credit — i.e., a loss of 1 × credit, the canonical stop in 02 RULE T7):** the OptionsPilot SPX iron-condor backtest reports that a 200 %-of-credit stop with a 50 % target raised win rate from 74.6 % to 78.2 % and lowered max drawdown (16-delta, 45 DTE). Assuming a comparable ~75 % win rate for a managed 30–35 %-of-width vertical, average winner = +$32.50 net, average loser = −$70 stop − $2.50 fees − ~$10 slippage past the stop ≈ −$82.50: `EV ≈ 0.75 × 32.50 − 0.25 × 82.50 ≈ 24.4 − 20.6 = +$3.8` per trade (≈ 3 % of capital at risk). Two things follow: (1) expectancy is thin, so fee drag, slippage and stop discipline decide whether the strategy is positive at all; (2) on a $2-wide spread the stop (loss $70) sits well inside max loss ($130) — but an overnight gap can jump straight past it, which is why the sizing cap (S1), event blackouts (07) and short-strike distance rules (03/04) exist. Note the arithmetic: a stop at mark = 2 × credit (loss = 1 × credit) sits inside max loss only while credit < 50 % of width; for rich-credit structures (iron flies, BWBs with C ≥ 0.5 W) it can never trigger, so those use the alternative stop in 06 §5.2 (mark ≥ credit + 0.5 × (width − credit)). Detailed management rules are in 02-strategies.

---

## 11. Facts that could not be verified (treat conservatively)

1. tastytrade Help Center pages (BP Effect article; expiration-risk process and cut-off time; IVR definitions) are JavaScript-rendered and could not be fetched. Third-party summaries were used and are flagged above.
2. Exchange proprietary fee for XSP and XND on tastytrade (SPX $0.60 and NDX $0.25 are confirmed; the schedule did not list XSP/XND).
3. tastytrade's exact intraday-margin monitoring method after June 4, 2026 (real-time block vs. end-of-day calculation — both are permitted by FINRA).
4. Exact time on expiration day when tastytrade's risk desk closes at-risk positions.

---

## Sources

- tastytrade Commissions & Fees schedule (last updated July 30, 2026): https://assets.contentstack.io/v3/assets/blt7dc2e3d4a7071563/blt2b752fef372188fe/commissions-and-fees
- StockBrokers.com tastytrade review 2026 (fee confirmation): https://www.stockbrokers.com/review/tastytrade
- tastytrade Trading Permissions: https://tastytrade.com/learn/accounts/account-resources/trading-permissions/
- TopRatedFirms — tastytrade options levels (Limited/Basic/The Works): https://topratedfirms.com/trading/options/tastytrade-options-levels.aspx
- tastytrade — Pattern Day Trading (history and June 4, 2026 change): https://tastytrade.com/learn/markets/industry/pattern-day-trading/
- tastytrade — PDT rule eliminated page: https://tastytrade.com/pdt/
- SEC release 34-105226 approving SR-FINRA-2025-017 (PDT elimination, intraday margin): https://www.sec.gov/files/rules/sro/finra/2026/34-105226.pdf
- FINRA Rule 4210 (margin; $2,000 minimum; intraday margin deficit): https://www.finra.org/rules-guidance/rulebooks/finra-rules/4210
- tastytrade — Short Put Vertical Spread (BPR / max loss / breakeven formulas): https://tastytrade.com/learn/trading-products/options/short-put-vertical-spread/
- Cboe — XSP Options Fact Sheet: https://cdn.cboe.com/resources/xsp/XSP_Options_Fact_Sheet.pdf
- Cboe — Settlement of Standard A.M.-Settled S&P 500 Index Options: https://cdn.cboe.com/resources/spx/Settlement_of_Standard_AM_Settled_SP_500_Index_Options.pdf
- Nasdaq — Nasdaq-100 Index Options: XND and NDX: https://www.nasdaq.com/nasdaq-100-options-xnd-ndx
- OIC — Options Assignment FAQ: https://www.optionseducation.org/referencelibrary/faq/options-assignment
- Option Alpha — Dividend Assignment Risk: https://optionalpha.com/learn/dividend-assignment-risk
- SSGA — SPDR 2026 Dividend Distribution Schedule (SPY ex-dates): https://www.ssga.com/library-content/products/fund-data/etfs/us/distribution/SPDR_Dividend_Distribution_Schedule.pdf
- StockAnalysis — QQQ dividend history/ex-dates: https://stockanalysis.com/etf/qqq/dividend/
- TaxGuidance.org — Cash-settled options, 60/40, Form 6781, Section 1256: https://taxguidance.org/cash-settled-options-60-40-treatment-form-6781-and-section-1256-rules/
- Schwab — Credit vs. Debit Spreads: Let Volatility Guide You (IV percentile thresholds): https://www.schwab.com/learn/story/credit-vs-debit-spreads-let-volatility-guide-you
- TradingBlock — Options Liquidity (open interest / spread guidance): https://www.tradingblock.com/blog/options-liquidity
- PurePowerPicks — Position Sizing for Options (1–2 %, 5 % ceiling, small-account note, correlation): https://purepowerpicks.com/position-sizing-options-trading/
- OptionsPilot — Best Delta and DTE Settings for Iron Condors (SPX 2006–2025 backtest; 2–3 % sizing; stop-loss table): https://optionspilot.app/blog/best-delta-dte-settings-iron-condors-backtest-data
