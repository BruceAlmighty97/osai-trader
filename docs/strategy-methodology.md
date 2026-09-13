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
| Max loss per position | ≤ 5 % of NLV | `risk_config` rules (`maxRiskPerTradePct`), migration `1788720000000` | ✅ |
| Buying power in use | ≤ 30 % of NLV (20 % when VIX ≥ 30) | `maxPortfolioRiskPct` 30 | ✅ / VIX variant ❌ |
| Concurrent positions | 5; 1 per underlying; 2 per correlated group; 1 contract | `maxConcurrentPositions`, `maxPerUnderlying`, `maxPerCorrelationGroup`; entry always opens 1 contract | ✅ |
| Short-strike delta | 0.15–0.25, target 0.20 (never > 0.30) | `ENTRY_MIN/MAX_SHORT_DELTA`, `ENTRY_TARGET_DELTA` | ✅ |
| Short strike vs expected move | ≥ 1.0 × EM preferred, 0.8 × minimum (02 T5); 1.5 × in VIX 20–30 | `ENTRY_PREFERRED_EM_MULTIPLE` / `ENTRY_MIN_EM_MULTIPLE`; EM from the strike's own IV | ✅ / VIX variant ❌ |
| Credit / width | ≥ 33 % target, 25 % hard floor (25–33 % only with short Δ ≤ 0.20) | `ENTRY_MIN_CREDIT_RATIO`, `ENTRY_TARGET_CREDIT_RATIO`, `ENTRY_THIN_CREDIT_MAX_DELTA` | ✅ |
| Minimum gross credit | ≥ $0.30 vertical / $0.60 four-leg | `ENTRY_MIN_CREDIT_ABS` (verticals); research prompt (four-leg) | ✅ / ⚠️ prompt-only for 4-leg |
| IV gate | IVR ≥ 30 **and** IV %ile ≥ 50 **and** VRP ≥ 3 | `MIN_IV_RANK` in pre-market | ⚠️ IVR only — %ile and VRP are stage 3 |
| Profit target | 50 % (25 % at ≤ 3 DTE, flies/BWBs) | `MANAGE_PROFIT_TARGET_PCT` | ⚠️ 50 % only — accelerated target is stage 1 |
| Loss stop | mark ≥ 2 × credit **or** short \|Δ\| ≥ 0.40 **or** RTH print through the short strike | `MANAGE_STOP_MULTIPLE` | ⚠️ 2× only — delta and touch stops are stage 1 |
| Time stop | 15:30 ET two trading days before expiry | `MANAGE_DTE_THRESHOLD` = 3 calendar days (interim) | ⚠️ calendar-aware version is stage 1 |
| Rolling | never at ≤ 14 DTE | no roll code path exists | ✅ |
| Entry window | 10:00–15:30 ET with release-day offsets | `PHASE_SCHEDULE` 10:00–11:30 | ⚠️ stage 1 widens it |
| Event blackout | FOMC/CPI/NFP 24 h; quad witching; early closes | — | ❌ stage 2 |
| Regime no-trade | VIX family + VRP | — | ❌ stage 3 |
| Kill switches | K1–K11 | `killSwitch` boolean only | ❌ stage 4 |
| Structures | credit verticals, condors, flies, BWB, debit verticals | mechanical arms: **bull put only**; research arm: all | ⚠️ stage 5 |
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
3. **Long strike.** Widest whose **risk** (`width − credit`, plus $2.50 of
   round-trip fees) fits the budget `5 % × NLV`. In practice $1-wide on
   SPY-priced underlyings unless the credit is rich, $2 on cheaper ones.
4. **Credit gates.** Gross ≥ $0.30; credit/width ≥ 25 %; if < 33 % the short Δ
   must be ≤ 0.20.
5. **Quote gates** are unchanged (no-bid hard reject; wide only if wide in both
   relative and absolute terms).
6. **Score** on hard economics only (credit/width above the floor, delta fit,
   IVR, quote tightness); the AI selector sees the EM multiple alongside.

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
Stage 0 ships `mech`/`ai` playbook-strict and adds a **`mech-relaxed`** arm
(migration `1788730000000`) that overrides only the credit gates —
`minCreditToWidth` 0.18, `minCreditAbs` 0.20, `thinCreditMaxDelta` 0.25 — so the
cost of the floor is measured as an A/B rather than loosened silently. Judge it
on the decision log and loser size, not on a few weeks of P&L.

## Sizing reality on $2,500

`5 % × $2,500 = $125` max loss including ~$2.50 of fees, and the budget is on
**risk = width − credit**, not width. A $2-wide spread must collect ≥ $0.78 to
fit; a $1-wide fits at any credit. The realistic book is 1–3 one-lot $1–2-wide
verticals, and index condors only when both wings fit inside $125. Playbook
`01 §10` has the worked example; `01 §5` notes $3–5 widths need NLV ≥ $4,000.

## What the research arm does differently

The Claude research arm proposes its own structures (any playbook structure),
sizes against its own paper book, and is told the mandate verbatim in its
system prompt. Two things are enforced in code regardless of what it says:
the defined-risk leg check (`assertDefinedRisk`) and the front-leg DTE window
(`RESEARCH_MIN_DTE`–`RESEARCH_MAX_DTE`). Its default holding window is 5 trading
days — a 10-DTE entry minus the two-day time stop.

## Legacy positions

Positions opened under the 45-DTE policy (identified by `dteAtOpen > 21`) keep
their 21-DTE exit until closed. New positions use the playbook time stop.
