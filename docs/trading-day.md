# The Trading Day (Session Orchestration)

How the bot runs its day. Grounded in how real options premium-sellers structure
their time (see Sources) and adapted for our strategy: **45-DTE credit spreads on
ETFs, managed at 50% profit / 21 DTE.** Because these are swing positions (not
0DTE), intraday timing matters for **fill quality and entry edge**, not because
anything expires today — so the cadence is lean.

## Control model (unchanged)

**Deterministic orchestrator, bounded AI.** Code owns the schedule, the risk gate,
execution, and the hard exit rules. The AI is called only for judgment:
- **Entry** — a read-only tool-using analyst decides *what/if/when* to open across
  the watchlist (it can pass), then the deterministic `RiskService.check()` gates
  it and code records it. The AI has no open/close tool.
- **Exit judgment** — at decision points only (50% profit, ~21 DTE) the AI weighs
  close/hold/roll from a code-sanctioned set. Hard stops (2× credit, assignment)
  are non-negotiable code closes.

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

Start with the 5 core phases (prep, morning entry, midday manage, power-hour
manage, review); add the optional afternoon entry once proven.

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
@Cron('0/15 8-16 * * 1-5', { timeZone: 'America/New_York' }) // every 15 min, mkt hrs, weekdays
async tick() { await this.dispatcher.run(); }
```

The **dispatcher** (runs each tick in the warm process — DB connected, tastytrade
session live):
1. **NYSE-calendar gate** — skip holidays; handle half-days (early close).
2. Read the **phase-schedule config from the DB** (editable at runtime, like the
   risk rules — no redeploy to change times/cadence).
3. Run whatever phase(s) are active at this ET tick; a tick outside every window
   no-ops.

**Why not EventBridge → RunTask:** that only wins if we scale the service to 0 to
save ~$7/mo, but each tick would pay a ~30–60s cold boot *and* re-login to
tastytrade. If we ever go fully serverless, the **dispatcher code is identical** —
only the trigger swaps — so this choice isn't a dead end. See
`docs/aws-infrastructure.md`.

## Build order

1. Mark-to-market (re-quote open legs → live unrealized P&L) — unblocks manage.
2. Exit engine (deterministic classifier + bounded AI exit judgment).
3. Entry analyst (read-only tool-using agent) + `RiskService` gate → paper ledger.
4. Phase dispatcher + `@nestjs/schedule` tick + DB phase-schedule config + NYSE
   calendar gate + `trading_day` context record (carries state across phases).
5. Earnings-calendar source for pre-market (tastytrade metrics where present, else
   a lightweight feed).

## Sources

- [Best Times of Day to Trade Options — optionstrading.org](https://www.optionstrading.org/blog/the-best-times-of-day-to-trade-options/)
- [Pre-Market Routine — optionstrading.org](https://www.optionstrading.org/blog/pre-market-routine-for-options-trading/)
- [Best Time to Sell Credit Spreads (2026) — optionspilot.app](https://optionspilot.app/blog/best-time-to-sell-credit-spreads)
- [Best DTE for Credit Spreads — daystoexpiry.com](https://www.daystoexpiry.com/blog/best-dte-for-credit-spreads-a-data-driven-comparison-of-30-45-and-60-day-trades)
- [Power Hour Trading (2026) — tradefundrr.com](https://tradefundrr.com/blog/the-power-hour-trading-the-last-hour)
- [Post-Trade Routine After Close — bulltraders.com](https://bulltraders.com/blog/creating-a-post-trade-routine-what-to-do-after-markets-close/)
