# Defined-Risk Options Trading Context — 7–14 DTE, $2,500 Account

Knowledge base for an automated / AI-assisted options trading agent running on tastytrade. Everything in these files is scoped to one mandate:

| Constraint | Value |
|---|---|
| Capital | $2,500 starting net liquidating value (NLV); goal is slow, consistent growth with capital preservation first |
| Risk type | **Defined risk only.** Every short option is paired with a long option in the same order. No naked options, strangles, straddles, ratio spreads, or anything whose worst case is not capped at order entry |
| Holding window | Open at **7–14 DTE**, close by **2 trading days before expiration** at the latest |
| Underlyings | Index products first (XSP, XND, SPXW — cash-settled, European, no assignment), SPY/QQQ/IWM as fallbacks when index liquidity fails |
| Broker | tastytrade, margin account approved at **The Works** — the broker permits undefined-risk orders, so the defined-risk constraint is enforced entirely by the bot's own order validator (01 RULE A2) |

These files are written so an LLM can apply them mechanically: numbered rules, explicit thresholds, decision tables, and `IF … THEN …` pseudo-code. Numbers are tagged **[sourced]** (from a cited document) or **[policy]** (a conservative operating default chosen for this account size — meant to be tuned by backtest). Every file ends with a `## Sources` section and a list of facts that could not be verified.

## File map

| File | What it answers | Load it when |
|---|---|---|
| `01-account-and-capital-rules.md` | tastytrade permissions, PDT status (eliminated June 2026), fee model, buying-power math, position sizing (RULES S1–S8), product selection (XSP vs SPY etc.), liquidity gates (L1–L6), kill switches (K1–K11), worked $2-wide example | Sizing any trade; checking whether a trade is allowed at all; account-level risk |
| `02-strategies.md` | Each permitted structure (credit verticals, debit verticals, iron condor, iron fly, broken-wing butterfly, calendars/diagonals, long options): how to build at 7–14 DTE, formulas, management (RULES T0–T27), excluded strategies, market-condition → structure decision table | Choosing and constructing a position |
| `03-greeks.md` | Delta/gamma/theta/vega/charm/vanna behaviour from 14 → 1 DTE with Black-Scholes tables, gamma/theta tradeoff, entry targets, portfolio greek caps for $2,500, management decision table, expected-move math, red-flags table (R1–R14) | Reading a chain; deciding whether an open position still has edge |
| `04-market-signals.md` | VIX bands, term structure (VIX/VIX3M, VIX9D/VIX, VVIX), IV rank/percentile and variance risk premium, trend/ADX filters, breadth, put/call, SKEW, dealer gamma (GEX), key levels, cross-asset risk-off; pre-trade checklist and regime → strategy map | Deciding whether today is a trading day and which structure fits the regime |
| `05-premarket-and-postmarket.md` | Session map, overnight futures and gap classification (vs. expected move), VIX futures, release slots, earnings stress test, closing auction, VIX daily-change flags, pre- and post-market checklists | The 04:00–09:30 and 16:00–20:00 routines |
| `06-entry-and-exit-timing.md` | Intraday windows, limit-order walking, day-of-week/expiration choice, profit targets, stop rules, time exit, breach decision tree, expiration mechanics, trade lifecycle and log schema | Placing, monitoring and closing orders |
| `07-events-and-calendar.md` | Event tiers (FOMC, CPI, NFP, PPI/PCE/GDP/ISM…), opex/quad witching, VIX expiration, JPM collar, rebalances, holidays/early closes, seasonality evidence, master rule set (R1–R10), how to build the calendar programmatically | Building the daily calendar and blackout flags |

Recommended load order for an agent: 01 → 04 → 07 → 05 → 02 → 03 → 06. If context is limited, the canonical rule table below plus 02 and 06 are the minimum.

## Canonical rules (single source of truth)

Where a number appears in more than one file, this table is authoritative and the files reference it.

| Rule | Value | Defined in |
|---|---|---|
| Max loss per position (incl. fees) | ≤ 5 % of NLV ($125 at $2,500); target 3–4 % | 01 S1 |
| Max total buying power in use | 30 % of NLV; 20 % when VIX ≥ 30 | 01 S3 |
| Max concurrent positions | 5; max 2 per correlated underlying group; 1 contract per leg while NLV < $5,000 | 01 S2, S4, S7 |
| Portfolio greek caps | \|SPY-beta-weighted Δ\| ≤ 4; theta ≤ $12.50/day; \|vega\| ≤ $15/pt — all index products counted as one book | 03 §4.2, 01 S5/S6 |
| Short-strike delta at entry | 0.15–0.25 (target 0.20) for verticals; 0.12–0.20 (target 0.16) per side for condors; never > 0.30 | 02 T2, T15 |
| Credit as % of width | Target ≥ 33 %; **hard floor 25 %** (25–33 % only with IVR ≥ 30 and short Δ ≤ 0.20) | 02 T4, T16 |
| Minimum gross credit ($) | ≥ $0.30 per vertical, ≥ $0.60 per 4-leg structure; fees ≤ 10 % of gross credit | 01 A6 |
| IV gate for short premium | IVR ≥ 30 **and** IV percentile ≥ 50 **and** VRP (IV − 20d realized) ≥ 3 pts; no entries if IV percentile ≥ 95 | 04 §3.4, 02 T1 |
| Short-strike placement | At or beyond 1.0 × expected move (≈ 16Δ); 1.5 × in VIX 20–30; beyond the event straddle if an event is inside the hold | 03 §6, 04 §4 |
| Profit target | Close at 50 % of max profit (25 % for iron flies/BWBs; 25 % for anything with ≤ 3 DTE left or a Tier 1 event ahead). GTC closing order placed at fill | 02 T6/T17/T22, 06 §4 |
| Loss stop | Close when spread mark ≥ 2 × credit (loss = 1 × credit); **or** short-strike \|Δ\| ≥ 0.40 (0.35 for condors); **or** any RTH print through the short strike. Debit spreads: mark ≤ 50 % of debit. Rich-credit structures (C ≥ 0.5 W): mark ≥ credit + 0.5 × (width − credit) | 02 T7/T18, 06 §5.2 |
| Time stop | Close every position by 15:30 ET **two trading days before expiration**; never hold anything into expiration day | 02 T8, 03 G-2, 06 §6.2 |
| Rolling | Not permitted at ≤ 14 DTE; a stop-out is closed, and any re-entry is a new trade passing all filters (not same underlying/expiry same day) | 02 T9/T19, 06 §7 |
| Entry window | 10:00–15:30 ET only (10:05 on 10:00-release days; 10:15 VIX-expiry Wednesday; 10:30 post-quarterly-opex Monday); never 09:30–09:45 or 15:45–16:00 | 06 §1.2, 07 R5 |
| Event blackout | No new entries within 24 h before FOMC/CPI/NFP (from 16:00 prior day through 10:00 next day for FOMC); half size on Tier 2 days; no entries on quad witching, early-close days, or when the VIX Stress flag is set | 07 §1, §8 |
| Regime no-trade | VIX > 30 and rising; VIX/VIX3M ≥ 1.0; VIX9D/VIX > 1.10; VVIX > 125 on the crossing day; 1-day VIX change ≥ +20 %; VRP < 0 | 04 §10 checklist |
| Orders | Limit only, start at mid, walk per 06 §2.2; single complex order for all legs; never leg in/out; never market or stop-market orders | 06 §2 |
| Kill switches | Daily −3 % pause / −5 % severe; weekly −6 %; monthly −10 %; 3 consecutive losers → 2-day pause at half size; 5 → human review; −15 % peak-to-trough → hard stop; NLV < $2,100 → reduce-only | 01 §9 |
| Products | Prefer XSP/XND/SPXW (PM-settled only — never AM-settled standard SPX/NDX); SPY/QQQ only when index liquidity fails, and then no short calls through an ex-dividend date | 01 §6, D1–D3 |

## Honest expectancy note

Read this before trusting any of the rules above.

Nearly all published, data-backed research on premium selling is built on 30–45 DTE entries managed at 21 DTE or 50 % profit. No fetched study reports results for 7–14 DTE credit spreads specifically; the 7–14 DTE parameters in these files are interpolations from 21–60 DTE SPX backtests, a 0DTE live-trade dataset, and Black-Scholes modelling, and are labelled as such. Several sources explicitly discourage 7–14 DTE for premium sellers because of gamma. The 7–14 DTE window is a *constraint of this book*, compensated by tighter stops, smaller size, a hard time exit, and strict regime and event filters.

The edge is thin. With a ~75 % win rate, winners of +0.5 × credit and losers of ~−1.15 × credit (stop plus slippage), expectancy is roughly +0.09 × credit per trade *before* fees, and fees on small credits are 5–10 % of credit. An independent replication of the standard tastylive credit-spread formula (SJ Options, SPX 2005–2016) found a 61–65 % win rate but net losses in most years. The credit floor (25 % of width), the fee gate, the stop discipline, and the event/regime filters are not optional refinements — they are what keeps expectancy above zero. Expect months where the correct number of trades is zero.

Slow, consistent growth on $2,500 realistically means single-digit dollars of expectancy per trade and a book of 1–3 positions. The rules are designed so that no single day, event, or gap can remove more than ~5 % of the account.

## Things to confirm manually (could not be verified from public sources)

1. tastytrade Help Center pages are JavaScript-rendered and would not fetch. Confirm directly: the expiration-risk close-out time and procedure (43000484765 / 43000484774); the do-not-exercise cutoff (43000472843); how intraday margin deficits are monitored after the June 4, 2026 PDT change.
2. Whether tastytrade charges an exchange fee on XSP / XND (SPX $0.60 and NDX $0.25 are confirmed; XSP/XND are not on the schedule).
3. The exact end of SPX/XSP Global Trading Hours (09:15 vs 09:25 ET across two Cboe documents).
4. Which 8–14 DTE Tuesday/Thursday expirations are actually listed on SPY/QQQ/IWM on any given day — check the live chain (`tastytrade_get_option_chain_compact`).
5. Every threshold tagged **[policy]** is a starting default. Do not change any of them on fewer than 50 logged trades per structure (06 §9).

## Disclaimer

This material is educational research compiled from public sources on the dates cited; it is not personalised financial advice and none of its authors are licensed advisors. Options involve risk, including the loss of the entire amount at risk in each position. Verify every broker-specific rule with tastytrade before trading live, and paper-trade the rule set first.
