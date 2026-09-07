# The Trading Day (Session Orchestration)

How the bot runs its day. Grounded in how real options premium-sellers structure
their time (see Sources) and adapted for our strategy: **45-DTE credit spreads on
ETFs, managed at 50% profit / 21 DTE.** Because these are swing positions (not
0DTE), intraday timing matters for **fill quality and entry edge**, not because
anything expires today — so the cadence is lean.

## Position sizing (drives everything else)

**4 concurrent positions at 25% risk each — fully deployed.** On the $2,500 paper
account that's **~$625 of defined risk per position**. This is deliberately
aggressive: the account is meant to be working at all times, with no dry powder.

Two consequences worth internalizing:

1. **It sets the tradeable universe.** Spread risk = `width × 100 × contracts`, so
   ~$625 buys a **5-wide spread in a single contract**. That makes the penny-wide
   index ETFs (SPY/QQQ/IWM) the best execution — ~$2 of commissions. A $40 ETF
   would need 6+ contracts for the same risk and **6× the commissions**, so cheap
   underlyings are actively worse at this size. (At 5% risk the logic inverts —
   you'd be stuck in 1-wide spreads where only cheap underlyings give real credit.)
2. **Correlation becomes the real risk, not per-trade size.** Four positions that
   are secretly one bet all hit max loss on a single move. SPY/QQQ/IWM are one
   bet. That's why every watchlist row carries a **`correlationGroup`**
   (`us_equity`, `precious_metals`, `rates`, `energy`) and the gate enforces
   **`maxPerCorrelationGroup: 1`**; `maxPerUnderlying: 1` alone wouldn't stop
   three correlated index spreads.

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
- **Exit judgment** — at decision points only (50% profit, ~21 DTE) the AI weighs
  close/hold/roll from a code-sanctioned set. Hard stops (2× credit, assignment)
  are non-negotiable code closes.

Deterministic-first preserves the agentic option; the reverse doesn't.

## The day — phases + cadence (all times ET, DST-aware)

| Phase | Window | Cadence | Job | AI |
|---|---|---|---|---|
| **Pre-market prep** | 08:00 | once | Earnings/econ calendar (exclude reporters), overnight gaps, IV rank per symbol, social trending, BP/positions → candidate shortlist + morning brief (persisted) | brief |
| *(skip the open)* | 09:30–10:00 | — | Nothing — widest spreads, worst fills | — |
| **Morning entry** | 10:00–11:30 | **every 15 min** (~7) | Entry analyst: open best play or pass → gate → record | analyst |
| **Midday manage** | 12:30 | once | Exit rules + AI exit judgment. No new entries (midday = wide spreads, low premium) | exits |
| **Afternoon entry** *(optional)* | 14:00–14:30 | **2 checks** | Second look if BP free + strong setup. **Hard stop: no opens after 14:45** | analyst |
| **Power-hour manage** | 15:00–15:45 | **every 15 min** (~4) | Harvest winners (remove gamma). **No new opens.** Respect 15:45 cutoff | exits |
| **After-close review** | 16:15 | once | Journal each decision (plan vs outcome), day P&L / W-L, note tomorrow | summary |

The **5 core phases are implemented** in `PHASE_SCHEDULE` (prep, morning entry,
midday manage, power-hour manage, review) — dispatching correctly, with handlers
still stubbed. The **afternoon entry is deliberately omitted** until the core loop
is proven; adding it back is one row in the schedule.

## Entry: how one play gets chosen

Two stages, deliberately separated so the AI is a *swappable selector*, never the
thing doing arithmetic.

**Stage 1 — build a slate (always mechanical).** Take the top `ENTRY_SLATE_SIZE`
(5) candidates off the pre-market shortlist, skipping symbols already held, and
price them **in parallel**. Each is an ~8s DXLink chain snapshot, so five
sequentially would burn 40s of a 15-minute tick — parallel makes it ~9s, which is
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

**Stage 2 — choose one (`ENTRY_SELECTOR`).**
- `mechanical` (default) — take the top score.
- `ai` — Claude gets the same slate plus the open book, and picks one index or
  passes. It **cannot** name a symbol, invent a strike, move an expiration, or
  size a position; the worst it can do is choose a spread code already priced and
  validated. Its value is the judgment the score can't express — chiefly whether a
  candidate duplicates exposure already on the book (the correlation tag catches
  SPY+QQQ, not NVDA+SMH).

The **mechanical baseline is logged on every run either way**, and divergences are
logged explicitly, so the AI's lift is measurable rather than assumed.

Then, unchanged: `RiskService.check()` gates whatever came back, and **if the gate
rejects the pick, entry falls through to the next-best plan by score** rather than
wasting the tick. Every run writes a `decisions` row — the full slate, the choice,
the reasoning, the model and token usage — and the opened position links to it via
`openDecisionId`.

## Rules baked into the schedule

- **Never open in the first 30 min or the last hour** (fills + gamma) — the
  highest-value timing rules in the research.
- **Primary entries 10:00–11:30**; midday is manage-only; optional afternoon entry
  with a **hard ~14:45 cutoff** on new opens.
- **Manage on 50% profit / 21 DTE**, whichever first (tastytrade's 200k-trade
  result). Power hour = harvest winners.
- **Exclude earnings names** in pre-market; **gate candidates on IV Rank** (>50%
  ideal for premium selling).

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
@Cron('0 */15 * * * *', { name: 'osai-tick' })
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
> 15-min tick inside it. Moving this to DB-backed config with a GET/PATCH endpoint
> (like `/risk/config`) is deferred until the phases settle.

**Why not EventBridge → RunTask:** that only wins if we scale the service to 0 to
save ~$7/mo, but each tick would pay a ~30–60s cold boot *and* re-login to
tastytrade. If we ever go fully serverless, the **dispatcher code is identical** —
only the trigger swaps — so this choice isn't a dead end. See
`docs/aws-infrastructure.md`.

## Build order & status

**Done**
1. ✅ 15-min heartbeat (`@nestjs/schedule`) + `runEventLoop()` entry point.
2. ✅ Computed NYSE `MarketCalendarService` (trading days + 1pm early closes),
   verified against the official 2025–2027 calendar.
3. ✅ Phase dispatcher — calendar gate + ET-time→phase mapping + early-close shift.
   **Phase handlers are stubs** that just log.

**Next**
4. **Mark-to-market** — re-quote open legs → live unrealized P&L. Unblocks MANAGE.
5. **Mechanical entry** — deterministic discover → qualify → strike selection →
   risk gate → paper ledger. A complete working loop with no AI.
6. **Earnings calendar** (Finnhub) — the gate that safely opens the single-name lane.
7. **Exit engine** — deterministic classifier (50% profit / 21 DTE / 2× stop).
8. **`trading_day` context record** — carries the pre-market shortlist across phases
   (each phase is a separate tick, so shared state goes through the DB).

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
