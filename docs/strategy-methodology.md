# Strategy Methodology

> **The strategy is the playbook.** As of 2026-09-13 the bot trades the
> **7–14 DTE defined-risk playbook** in [`docs/playbook/`](playbook/00-README.md).
> That folder is the source of truth for every threshold; this file records how
> the code maps onto it and what is not yet built. Where the two disagree, the
> playbook's canonical table (`00-README.md`) wins and the code is the bug.

## What changed on 2026-09-13

The previous methodology — 30–45 DTE credit spreads managed at 21 DTE / 50 %
profit, sized at 25 % of NLV per position, fully deployed — is retired. It
argued (correctly, for a hands-off swing book) that 7–14 DTE is a gamma trap.
The playbook takes the other side of that trade deliberately: the short window
is a *constraint of this book*, compensated by tighter stops, smaller size, a
hard time exit, and strict regime and event filters. Read
[`00-README.md` → "Honest expectancy note"](playbook/00-README.md#honest-expectancy-note)
before trusting any number below; the edge is thin and the filters are what keep
it positive.

## Canonical rules → where they live in code

| Rule (00-README canonical table) | Value | Enforced in | Status |
|---|---|---|---|
| Expiration at entry | 7–14 DTE (target 10) | `EntryService` (`ENTRY_MIN/MAX/TARGET_DTE`, DTE-windowed chain snapshot); `ResearchExecutionService` (`RESEARCH_MIN/MAX_DTE`) | ✅ |
| Max loss per position | playbook ≤ 5 % of NLV — **overridden 2026-09-16 to 50 %** | `risk_config` rules (`maxRiskPerTradePct`), migration `1788740000000` | ⚠️ deliberate override |
| Buying power in use | playbook ≤ 30 % — **overridden to 100 %** (2 × 50 %) | `maxPortfolioRiskPct` | ⚠️ deliberate override |
| Concurrent positions | playbook 5 / 2 per group / 1 contract — **overridden to 2 positions, 1 per group, contracts scaled to budget** (cap `ENTRY_MAX_CONTRACTS` 10) | `maxConcurrentPositions`, `maxPerCorrelationGroup`; `EntryService` sizes contracts | ⚠️ deliberate override |
| Short-strike delta | 0.15–0.25, target 0.20 (never > 0.30) | `ENTRY_MIN/MAX_SHORT_DELTA`, `ENTRY_TARGET_DELTA` | ✅ |
| Short strike vs expected move | ≥ 1.0 × EM preferred, 0.8 × minimum (02 T5); 1.5 × in VIX 20–30 | `ENTRY_PREFERRED_EM_MULTIPLE` / `ENTRY_MIN_EM_MULTIPLE`; EM from the strike's own IV | ✅ / VIX variant ❌ |
| Credit / width | playbook ≥ 33 % target / 25 % floor — **re-tuned for verticals 2026-09-16 to 20 % / 15 %** (real chains pay 14–18 % at ≤ 0.25Δ); `mech-strict` arm keeps 25 %/33 % as control | `ENTRY_MIN_CREDIT_RATIO`, `ENTRY_TARGET_CREDIT_RATIO`, `ENTRY_THIN_CREDIT_MAX_DELTA` | ⚠️ deliberate override |
| Minimum gross credit | ≥ $0.30 vertical / $0.60 four-leg — **$0.25 for verticals since 2026-09-16** (fees ≤ 10 %) | `ENTRY_MIN_CREDIT_ABS` (verticals); research prompt (four-leg) | ⚠️ override / prompt-only for 4-leg |
| IV gate | IVR ≥ 30 **and** IV %ile ≥ 50 **and** VRP ≥ 3 | `MIN_IV_RANK` in pre-market | ⚠️ IVR only — %ile and VRP are stage 3 |
| Profit target | 50 % (25 % at ≤ 3 DTE, flies/BWBs) | `exit-rules.ts`: `MANAGE_PROFIT_TARGET_PCT`, `MANAGE_ACCEL_PROFIT_TARGET_PCT`, `MANAGE_ACCEL_DTE` | ✅ (Tier-1-event variant with stage 2) |
| Loss stop | mark ≥ 2 × credit **or** short \|Δ\| ≥ 0.40 **or** RTH print through the short strike; rich-credit / debit: 0.5 × max risk | `exit-rules.ts`: `MANAGE_STOP_LOSS_MULTIPLE` (1× max profit, capped at 0.5× max risk), `MANAGE_DELTA_STOP[_CONDOR]`, touch via today's session range | ✅ |
| Time stop | 15:30 ET two trading days before expiry | `exit-rules.ts` + `MarketCalendarService.tradingDaysBefore`; fires from 10:00 on that session (`MANAGE_TIME_STOP_TRADING_DAYS`, `MANAGE_TIME_STOP_FROM_MINUTE`) | ✅ |
| Rolling | never at ≤ 14 DTE | no roll code path exists | ✅ |
| Entry window | 10:00–15:30 ET with release-day offsets | `PHASE_SCHEDULE` 10:00–15:30 on quarter-hours; manage every 5 min 09:35–15:55 | ✅ / offsets with stage 2 |
| Event blackout | FOMC/CPI/NFP 24 h; quad witching; early closes | — | ❌ stage 2 |
| Regime no-trade | VIX family + VRP | — | ❌ stage 3 |
| Kill switches | K1–K11 | `killSwitch` boolean only | ❌ stage 4 |
| Structures | credit verticals, condors, flies, BWB, debit verticals | mechanical arms: **bull put + bear call**, side chosen by the 20-day trend read (04 §5.1 simplified; `TREND_FLAT_BAND`); no short calls on quarterly-dividend ETFs through the ex-date (01 D1); research arm: all | ✅ verticals (the book's focus) — condors/flies not in the mechanical engine |
| Products | XSP/XND/SPXW first, SPY/QQQ fallback | watchlist ETFs + single names | ❌ stage 6 |

## How the entry engine applies the rules (mechanical arms)

1. **Expiration.** The chain snapshot considers only expirations inside
   `[ENTRY_MIN_DTE, ENTRY_MAX_DTE]` and takes the one nearest `ENTRY_TARGET_DTE`.
   A symbol with nothing in the window (monthly-only names) is skipped, not
   traded at the wrong tenor.
2. **Short strike.** Every OTM put gets its own expected move
   (`spot × IV × √(DTE/365)`) and EM multiple. Strikes must satisfy **both** the
   delta band and `≥ ENTRY_MIN_EM_MULTIPLE × EM` (0.8); strikes clearing the
   preferred 1.0× are chosen first, and within the tier the one nearest the
   target delta wins. The two rules pull against each other at 0.20Δ (which is
   ~0.85 SD), so this lands on the ~0.16–0.20Δ strike the playbook actually
   wants rather than rejecting the chain. The underlying's own quote must be
   ≤ 0.5 % wide or the candidate is skipped — a stale mid corrupts every
   downstream number.
3. **Long strike and size.** Among widths within `ENTRY_WIDTH_PCT` of spot,
   take the one with the best credit/width that clears the $0.30 gross gate
   (ties go wider); then `contracts = floor(budget / (risk per contract +
   $2.50 fees))`, capped at `ENTRY_MAX_CONTRACTS`. Risk is `width − credit`,
   never width. Scaling contracts rather than widening keeps playbook-shaped
   strikes — a wide spread pays a thinner credit/width and fails the floor.
4. **Credit gates.** Gross ≥ $0.30; credit/width ≥ 25 %; if < 33 % the short Δ
   must be ≤ 0.20.
5. **Quote gates** are unchanged (no-bid hard reject; wide only if wide in both
   relative and absolute terms).
6. **Score** on hard economics only (credit/width above the floor, delta fit,
   IVR, quote tightness); the AI selector sees the EM multiple alongside.

## Side selection (2026-09-16)

Pre-market pulls ~30 daily closes per survivor in one candle session and
labels each `up` / `down` / `flat` from last close vs its 20-day SMA
(`TREND_FLAT_BAND` 0.25 %). Entry sells the put side on `up`, the call side on
`down`, and prices both on `flat`/unknown so the score decides. Short calls on
the SPDR/index ETFs are never opened through the ~3rd-Friday ex-dividend of
Mar/Jun/Sep/Dec (01 D1); single names are not yet covered by that guard.

## Known tension: the credit floor vs the delta band (read this)

Measured on synthetic Black-Scholes chains at entry-engine defaults
(2026-09-13, `IV 16–32 %, 9–14 DTE, put skew 0.5–0.9`): a short strike in the
0.15–0.25Δ band pays **15–18 % of width**, whatever the width or the risk
budget. That matches the playbook's own tables (03 §4.2: "flat-vol BSM gives
only 13 % for 16Δ 5-wide") and its own caveat ("if the chain will not pay 25 %
of width at ≤ 0.25Δ, there is no trade"). Credit/width on a narrow vertical is
roughly the short delta, so the **25 % floor (02 T4) and the ≤ 0.25Δ band (02
T2) are nearly mutually exclusive** — the 35 %-of-width worked example in
01 §10 is not reachable at 0.20Δ. On top of that, $1-wide spreads (the only
width that fits $125 at these credits) cannot clear the $0.30 gross minimum
(01 A6) below ~0.30Δ.

Consequence: **as written, the mechanical vertical arm is near-dormant.** The
structures the playbook says *can* pay 25 %+ are the rich-credit ones (iron
fly C ≥ 0.5 W, credit BWB, condors combining two sides), which only the
research arm can build today (stage 5 adds them to the mechanical engine).
Resolution (2026-09-16, Geoff: "focus on spreads"): the defaults now carry
vertical-tuned gates — floor 15 %, target 20 %, $0.25 gross — and the spare arm
became **`mech-strict`** (migration `1788750000000`), pinned to the playbook's
25 % / 33 % / $0.30 as the control. Judge the difference on the decision log
and loser size, not on a few weeks of P&L. Bear calls pay less than puts at the
same delta (flatter call skew) and will qualify mainly on richer-IV days.

## Sizing policy (2026-09-16): two positions, half the account each

Geoff's override of playbook 01 §5: **`maxConcurrentPositions` 2,
`maxRiskPerTradePct` 50, `maxPortfolioRiskPct` 100, one per underlying and
one per correlated group** so the pair is never the same bet. The budget is
deployed by scaling contracts: on synthetic chains a $1,250 budget builds
**7 × $2-wide SPY spreads, ~$270 credit against ~$1,130 risk** when the
credit gates pass. A single max-loss outcome takes half the account; two
take all of it — the kill switches (01 §9, stage 4) are the counterweight
and should follow soon.

Note the size change does **not** unblock the strict arms: credit/width at
≤ 0.25Δ is still 16–19 %, under the 25 % floor. Only `mech-relaxed` (18 %)
trades verticals under this policy; the strict arms need the richer
structures of stage 5.

## What the research arm does differently

The Claude research arm proposes its own structures (any playbook structure),
sizes against its own paper book, and is told the mandate verbatim in its
system prompt. Two things are enforced in code regardless of what it says:
the defined-risk leg check (`assertDefinedRisk`) and the front-leg DTE window
(`RESEARCH_MIN_DTE`–`RESEARCH_MAX_DTE`). Its default holding window is 5 trading
days — a 10-DTE entry minus the two-day time stop.

## Legacy positions

Positions opened under the 45-DTE policy (identified by `dteAtOpen > 21`) keep
their 21-DTE exit (`dte_roll`) until closed. New positions use the playbook
time stop (`time_exit`).
