# The Trading Day (Session Orchestration)

How the bot runs its day. Grounded in how real options premium-sellers structure
their time (see Sources) and adapted for our strategy: the **7–14 DTE
defined-risk playbook** in [`docs/playbook/`](playbook/00-README.md), managed at
50 % profit / 2× credit stop / two trading days before expiry. At this tenor
intraday timing matters for both fill quality **and** risk — gamma is large and
a position can go from winner to stop in a session — so the manage cadence
matters more than it did at 45 DTE (see "What the playbook still needs from the
schedule" below).

> **Historical note.** Until 2026-09-13 this book ran 45-DTE spreads at 25 % of
> NLV per position, four positions, fully deployed. Sections below that
> describe the sizing rationale have been rewritten; the A/B-arm machinery,
> mark-to-market and scheduling are unchanged.

## Position sizing (drives everything else)

**Two positions, up to half of NLV each** (Geoff's 2026-09-16 override of
playbook 01 §5): `maxConcurrentPositions` 2, `maxRiskPerTradePct` 50,
`maxPortfolioRiskPct` 100, **1 per underlying, 1 per correlated group**.
Seeded into `risk_config` by migration `1788740000000`.

Two consequences worth internalizing:

1. **Size is contracts, not width.** Spread risk = `(width − credit) × 100 ×
   contracts`. The entry engine picks the width with the best credit/width
   that clears the fee gate and scales contracts to the budget (cap
   `ENTRY_MAX_CONTRACTS`), so a $1,250 budget is ~7 lots of a $2-wide, not one
   $20-wide. The 25 % credit floor still decides whether the trade exists.
2. **Correlation is the whole risk at this size.** SPY/XSP/QQQ/XND/IWM are one
   bet in a selloff, and two positions at 50 % each is the entire account. The
   gate enforces **`maxPerCorrelationGroup: 1`**, so the two positions must
   come from different `correlationGroup`s.

### ETF groups are tight; single stocks are intentionally ungrouped

The group cap is calibrated for **index/commodity ETFs**, which really are the
same instrument (SPY/QQQ/IWM run ~0.95 correlation — overlapping baskets). Two
unrelated single stocks are more like 0.5-0.6, so a 1-per-sector cap would be too
blunt for them.

So **single stocks are added with `correlationGroup: null` on purpose** — the gate
skips the check for ungrouped symbols (both as the proposed trade and as peers).
This is a deliberate choice, not an unset field.

The residual risk is real and accepted for now: correlations converge toward 1 in
a selloff, and single-stock tails are fatter than ETF tails (gaps, earnings). Four
"independent" stock spreads is still four bullish equity bets. **Revisit when the
stock lane is actually enabled** (it's gated on the earnings calendar anyway) —
the options then are a shared `single_stock` bucket with a looser cap (needs
per-group caps rather than one global number), or a separate total-equity-beta
rule.

Sizing should be revisited as the account grows — the universe that's optimal at
$2,500 is not the one that's optimal at $25,000.

## Control model

**Deterministic orchestrator, mechanical first.** Code owns the schedule, the risk
gate, execution, and the exit rules. We're deliberately starting **fully
mechanical** — rule-based strike selection, no LLM in the loop — to get the whole
loop working cheaply and testably, and to establish a **baseline the AI has to
beat**.

**Bounded AI is a later, measurable layer**, not a rewrite — it slots into defined
seams:
- **Entry** — a read-only tool-using analyst decides *what/if/when* to open across
  the watchlist (it can pass); `RiskService.check()` still gates it and code still
  records it. The AI never gets an open/close tool.
- **Exit judgment** — at decision points only (50% profit) the AI could weigh
  close/hold from a code-sanctioned set. Hard stops (2× credit, delta, touch,
  the time stop) are non-negotiable code closes, and rolling is not permitted
  at ≤ 14 DTE (playbook 02 T9).

Deterministic-first preserves the agentic option; the reverse doesn't.

## The day — phases + cadence (all times ET, DST-aware)

The heartbeat ticks **every 5 minutes**. A tick runs *every* window it falls
inside, in schedule order — MANAGE before ENTRY, so a stop that fires frees
buying power for the same tick's entry.

| Phase | Window | Cadence | Job | AI |
|---|---|---|---|---|
| **Pre-market prep** | 08:00 | once | Earnings/econ calendar (exclude reporters), IV rank per symbol, StockTwits + Reddit attention, BP/positions → candidate shortlist (persisted) | — |
| *(skip the open)* | 09:30–09:35 | — | Nothing — widest spreads, worst fills | — |
| **Manage** | 09:35–15:55 | **every 5 min** | Value every open position; fire stops (loss / touch / delta), profit target, time exit. Playbook 06 §5.2 wants stops "every 5 minutes 09:30–16:00" | — |
| **Entry** | 10:00–15:30 | **every 15 min** (quarter-hours) | Each arm opens its best play or passes → gate → record. Last entry accepted 15:30; never 15:45–16:00 | analyst (ai arm) |
| **After-close review** | 16:15 | once | Journal each decision (plan vs outcome), day P&L / W-L | summary |

Half-days shift MANAGE, ENTRY and the review 3h earlier (13:00 close).
Release-day entry offsets (10:05 / 10:15 / 10:30 — playbook 07 R5) land with
the event calendar.

## Entry: how one play gets chosen

Two stages, deliberately separated so the AI is a *swappable selector*, never the
thing doing arithmetic.

**Stage 1 — build a slate (always mechanical).** Take the top `ENTRY_SLATE_SIZE`
(5) candidates off the pre-market shortlist, skipping symbols already held, and
price them **in parallel**. Each is built on the side its pre-market trend read
favours — bull put above the 20-day mean, bear call below, both when flat. Each is an ~8s DXLink chain snapshot, so five
sequentially would burn 40s of a 15-minute entry cadence — parallel makes it ~9s, which is
what makes best-of affordable at all. For each: short strike = OTM put nearest
`ENTRY_TARGET_DELTA`, long strike = widest that fits the risk budget, both legs
priced at the mid, then rejected if the quote is stale/wide, the credit is
non-positive, or credit/width is below the floor.

Survivors get a **deterministic 0-100 score** on hard economics only:

| Weight | Component | Band |
|---|---|---|
| 0.45 | credit ÷ width | 0 → 35% of width |
| 0.20 | delta fit | how far the achieved short delta drifted off target |
| 0.20 | IV rank | 30 (the qualification floor) → 80 |
| 0.15 | quote tightness | relative bid/ask vs. the rejection threshold |

Sentiment is deliberately **not** weighted here — it's noisy retail chatter and a
coefficient for it would be false precision. It's handed to the AI instead.

**Stage 2 — choose one (per-arm `selector`).**
- `mechanical` (default) — take the top score.
- `ai` — Claude gets the same slate plus the open book, and picks one index or
  passes. It **cannot** name a symbol, invent a strike, move an expiration, or
  size a position; the worst it can do is choose a spread code already priced and
  validated. Its value is the judgment the score can't express — chiefly whether a
  candidate duplicates exposure already on the book (the correlation tag catches
  SPY+QQQ, not NVDA+SMH).

The **mechanical baseline is logged for every arm on every run**, and divergences
are logged explicitly, so an arm's lift over plain top-score is measurable rather
than assumed.

## A/B arms

Changes get tested against a live baseline instead of argued about. An **arm** is a
paper account plus a `config` blob of overrides on the `ENTRY_*` defaults —
`selector`, `model`, `targetDelta`, `targetDte`, `widthPct`, `minCreditToWidth`,
`maxQuoteSpreadPct`, `slateSize`, `maxNewPerRun`. Two ship seeded:

| Arm | Config | Testing |
|---|---|---|
| `mech` | `{"selector":"mechanical"}` | Baseline — highest deterministic score, playbook-strict credit gates |
| `ai` | `{"selector":"ai"}` | Claude picks from the same scored slate |
| `mech-strict` | `{"selector":"mechanical","minCreditToWidth":0.25,"targetCreditToWidth":0.33,"minCreditAbs":0.3,"thinCreditMaxDelta":0.2}` | Same funnel pinned to the playbook's credit gates — the control for the vertical-tuned defaults (see strategy-methodology.md "Known tension") |
| `research` | `{"selector":"agent"}` | Claude agent with web research; builds its own structures |

Each arm keeps its **own book**, starting from the same $2,500. That's the point:
once the arms pick differently their holdings diverge, and a portfolio-level effect
— "it declined to double up on semis" — is invisible if they share a book. Two arms
can hold the same symbol without blocking each other, because the risk gate runs
per arm.

Every arm's candidates are unioned and **each chain is fetched exactly once**, so
arms score off identical prices — a price that moved between two fetches can never
explain a difference in outcome. Two arms cost the same ~9s as one.

Risk rules stay **global** (`risk_config`), not per arm: they apply to the real
account too, so they aren't an experiment variable.

- `GET /paper/accounts` — the scoreboard, every arm side by side
- `GET /paper/account?account=ai`, `GET /paper/positions?account=ai|all`
- Arms are rows: add one with an INSERT, disable one with `enabled=false`

**Re-entry after a stop (02 §10, enforced 2026-09-22):** an arm that stopped
out of a symbol today will not be offered that symbol again until the next
session. On 2026-09-18 a JNJ bear call stopped at 17:40 and the next tick sold
the same expiration again at 17:45; that pair plus a flip to the put side cost
`mech` −$505 across three trades.

**On reading the results:** at 4 concurrent positions and 45 DTE each arm closes
only a handful of trades a month, and credit-spread P&L is dominated by the
occasional big loser. P&L divergence over a few weeks is mostly noise — treat the
**decision log** (where and why the arms diverged) as the near-term signal, and
P&L as a many-months question.

Then, unchanged: `RiskService.check()` gates whatever came back, and **if the gate
rejects the pick, entry falls through to the next-best plan by score** rather than
wasting the tick. Every run writes a `decisions` row — the full slate, the choice,
the reasoning, the model and token usage — and the opened position links to it via
`openDecisionId`.

## Mark-to-market

`GET /paper/accounts` is **settled value only** — `startingBalance + realized P&L`
— so it deliberately will not move while positions are open. It is a fast DB-only
read. `GET /paper/mark` is the live counterpart (~8s, opens a quote session):

```
currentDebit  = shortLegMid - longLegMid              (per share, cost to close)
unrealized    = (entryCredit - currentDebit) x 100 x qty - commissions
netLiq        = settledValue + openUnrealized
```

Legs are priced at the **mid**, matching how entry priced them. Quoting the
bid/ask you would really pay to close would bake in a systematic loss that is an
artifact of the measurement, not the strategy — every position would look
underwater the instant it opened.

Each open leg persists its **DXLink `streamerSymbol`** at entry, so valuation is
**one** batched quote session covering every leg of every position in every arm —
not one chain fetch per position. Duplicate contracts (both arms holding the same
spread) are quoted once. Positions opened before this existed have no leg symbol;
they are reported with `unrealizedPnl: null` and excluded from `netLiq` rather
than silently valued at zero.

`pctOfMaxProfit` = `(entryCredit - currentDebit) / entryCredit` is the number the
**50%-profit rule** fires on, and `dte` drives the **21-DTE** rule — which is why
this had to land before the exit engine. Note it does NOT change buying power:
`maxRisk` is locked up for the life of a defined-risk spread regardless of what
the position is currently worth.

## Rules baked into the schedule

- **Never open in the first 30 min or after 15:30** (fills + the closing
  auction) — playbook 06 §1.2.
- **Entries 10:00–15:30 on quarter-hours**; manage runs every 5 minutes
  alongside.
- **Manage on 50% profit / 1× credit loss / delta / touch / two trading days
  before expiry**, whichever first (playbook 02 §10), every 5 minutes.
- **Exclude earnings names** in pre-market; **gate candidates on IV Rank ≥ 30**
  (playbook adds IV percentile ≥ 50 and VRP ≥ 3 — stage 3).

## Exit engine (stage 1, 2026-09-13)

`trading/exit-rules.ts` is a pure function over a valued position — no clock,
no I/O — so the policy is tested against synthetic books (26 cases in the
scratch suite, including holiday arithmetic). Firing order is the priority and
is what gets journaled as `exitReason`:

1. `expired` — expiration reached with the position open (a missed exit, logged as such)
2. `stop_loss` — unrealized loss ≥ 1 × max profit (= "mark ≥ 2× credit"), capped at 0.5 × max risk (rich-credit / debit variant)
3. `stop_touch` — underlying printed at/through a short strike (today's dxfeed Summary range, plus last trade / mid). The **session range only counts for a position that was already open when the session began** — it covers prints from before an intraday entry, and on 2026-09-21 that closed three META positions within five minutes each on a low that happened hours before they existed
4. `stop_delta` — short |Δ| ≥ 0.40 (0.35 condors); debit spreads: long |Δ| ≤ 0.20
5. `profit_target` — 50 %, or 25 % at ≤ 3 DTE and always for iron flies
6. `time_exit` — from 10:00 on the session two trading days before expiry (holidays skipped); immediately if missed. Legacy 45-DTE positions: `dte_roll` at 21 DTE

Mark-to-market carries what the rules need: per-leg delta (Greeks), the
underlying's NBBO mid (rejected when > 0.5 % wide), last trade, and today's
session range — all in the one batched DXLink session per tick.

Still to come from the playbook's schedule: pre-market (08:00) and post-market
(16:15) **checklists** — gap classification vs expected move, `close_at_open`
list, VIX daily-change regime flag (stage 7).

## Polling ≠ over-trading

A 15-min entry check means "given conditions *now*, open the single best play or
pass" — not a trade every 15 min. The risk gate caps the ceiling (max concurrent,
per-symbol, portfolio %, BP), plus a **`maxNewPositionsPerDay`** rule, and the
analyst can read the day's prior decisions to avoid re-chewing a passed setup.
Manage checks are idempotent — a position triggers its exit once.

## How it's scheduled — in-process, no EventBridge

The service is always-on (it serves the API), so it schedules **itself** — no
EventBridge, no RunTask, no HTTP ingress, no ALB:

```ts
// orchestrator.service.ts — a deliberately dumb, frequent tick
@Cron('0 */5 * * * *', { name: 'osai-tick' })
tick(): void { this.runEventLoop(); }
```

All the intelligence lives in the **dispatcher** (`runEventLoop()`), which runs each
tick in the warm process (DB connected, tastytrade session live) and:
1. **NYSE-calendar gate** — `MarketCalendarService.isTradingDay()`; weekends and
   holidays no-op. `isEarlyClose()` shifts the late phases 3h earlier on half-days.
2. **Phase lookup** — maps the ET wall clock to a phase via `PHASE_SCHEDULE`.
3. **Dispatch** — runs that phase; ticks outside every window no-op (debug log).

Keeping the market-hours logic in the **dispatcher rather than the cron expression**
is what lets **pre-market (08:00) and after-close (16:15) run at all** — both sit
outside regular market hours, so a market-hours cron would silently skip them.

> **Where the config lives:** phase windows are in code today
> (`orchestrator.types.ts` → `PHASE_SCHEDULE`), so changing a time needs a deploy.
> A single-point window (`startMin === endMin`) fires once; a range fires on every
> tick inside it (a window with `everyMinutes: 15` only on quarter-hours). Moving this to DB-backed config with a GET/PATCH endpoint
> (like `/risk/config`) is deferred until the phases settle.

**Why not EventBridge → RunTask:** that only wins if we scale the service to 0 to
save ~$7/mo, but each tick would pay a ~30–60s cold boot *and* re-login to
tastytrade. If we ever go fully serverless, the **dispatcher code is identical** —
only the trigger swaps — so this choice isn't a dead end. See
`docs/aws-infrastructure.md`.

## Build order & status

**Done**
1. ✅ 5-min heartbeat (`@nestjs/schedule`) + `runEventLoop()` entry point.
2. ✅ Computed NYSE `MarketCalendarService` (trading days + 1pm early closes),
   verified against the official 2025–2027 calendar.
3. ✅ Phase dispatcher — calendar gate + ET-time→phases mapping (several per
   tick, manage before entry) + early-close shift.

4. ✅ **Mark-to-market** — batched re-quote of every leg + underlying (mids, deltas, session range).
5. ✅ **Mechanical entry** — discover → qualify → strike selection → risk gate → paper ledger.
6. ✅ **Earnings calendar** (Finnhub) — hard exclude in pre-market.
7. ✅ **Exit engine** — `exit-rules.ts` (stops: loss / touch / delta; profit; calendar-aware time exit).
8. ✅ **`trading_day` context record** — carries the pre-market shortlist across phases.

9. ~~Swap the mechanical picker for the **bounded AI analyst**~~ — **built.**
   Both selectors ship behind `ENTRY_SELECTOR`; the baseline is logged on every
   run so the lift is measurable. Still needs live trading days to judge.

**Later**
10. DB-backed phase schedule; the optional afternoon-entry window.

## Sources

- [Best Times of Day to Trade Options — optionstrading.org](https://www.optionstrading.org/blog/the-best-times-of-day-to-trade-options/)
- [Pre-Market Routine — optionstrading.org](https://www.optionstrading.org/blog/pre-market-routine-for-options-trading/)
- [Best Time to Sell Credit Spreads (2026) — optionspilot.app](https://optionspilot.app/blog/best-time-to-sell-credit-spreads)
- [Best DTE for Credit Spreads — daystoexpiry.com](https://www.daystoexpiry.com/blog/best-dte-for-credit-spreads-a-data-driven-comparison-of-30-45-and-60-day-trades)
- [Power Hour Trading (2026) — tradefundrr.com](https://tradefundrr.com/blog/the-power-hour-trading-the-last-hour)
- [Post-Trade Routine After Close — bulltraders.com](https://bulltraders.com/blog/creating-a-post-trade-routine-what-to-do-after-markets-close/)
