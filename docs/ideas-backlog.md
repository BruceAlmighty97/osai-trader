# Ideas & Feature Backlog

Running list of features/ideas to consider adding to OsaiTrader. Not committed work — a
place to capture and refine ideas before they become roadmap items. Newest/high-interest
ideas near the top.

Status legend: 💡 idea · 🔬 exploring · ✅ planned · 🚧 building · ✔️ done

---

## 🚧 Social sentiment: subreddit watcher for options to watch

> **Phase A BUILT (2026-07-05)** — `src/social/` module: dual-mode Reddit client
> (public `.json` + OAuth), cashtag/bare-ticker extractor (stoplist), `social_mentions`
> table + migration, deletion audit, and endpoints `POST /social/ingest`,
> `GET /social/mentions`, `GET /social/trending`, `POST /social/audit`. Extractor
> unit-tested; endpoints verified; ingest surfaces per-sub fetch errors.
> **BLOCKED on live data:** public `.json` is 403 (verified) and OAuth needs Reddit's
> manual app approval (form filed). Code is ready — drop approved creds in `.env` and it
> runs. Phases B–D below.

**What:** Monitor a configurable set of subreddits (e.g. r/options, r/thetagang,
r/wallstreetbets, r/optionswheel) for tickers gaining unusual attention, and surface them
as **watchlist candidates** for the strategy engine.

**Why:** Retail options flow and sentiment often cluster on Reddit before/around notable
moves. A funnel sourced from rising social mentions gives the agent a wider, timelier set
of underlyings to evaluate — instead of only symbols we manually curate. Its output feeds
the existing `watchlist` table, so scan → rank → risk-gate → execute already handles the
rest. **Design decided (2026-07-04); build not yet started — see dependencies below.**

### Pipeline (5 stages)

```
1. INGEST    → poll configured subreddits (Reddit OAuth API) for hot/new posts + top comments
2. EXTRACT   → pull $CASHTAGS and validated bare tickers; capture author, upvotes, timestamp
3. STORE     → social_mentions table (one row per mention) = the audit trail
4. SCORE     → rolling-window rank: spike detection + distinct-author weighting (not raw counts)
5. SURFACE   → trending symbols become social_candidates, promoted (gated) into the watchlist
```

### How it integrates (decided: staging table + promotion gate)

Do **not** write straight into the curated watchlist — the 6-ETF list is deliberate and
clean, and Reddit surfaces noisy, earnings-exposed single-names. Stage candidates and
require a promotion step:

```
mentions → social_candidates(status=new) → promote (manual OR score threshold)
        → watchlist(source='social', enabled=false) → human flips enabled=true → scan/risk/exec
```

Promoting lands a symbol in the watchlist **disabled**, so scan/risk/execution ignore it
until a human enables it. That is the "review gate before anything auto-trades," for free.

### Data model (new)

| Table | Holds | Why |
|---|---|---|
| `social_mentions` | one row per mention: symbol, subreddit, sourceType (post/comment), sourceId (fullname, e.g. `t3_…`/`t1_…`), author, upvotes, createdUtc, sampledAt, (opt) sentiment, **bodyText**, **contentStatus** (`live`/`deleted`/`removed`), **deletedAt**, **lastCheckedAt** | audit trail; enables distinct-author counting + dedupe. We DO retain full text (personal/non-commercial use), reconciled by the deletion-audit job below |
| `social_candidates` | rolled-up trending symbols: symbol, score, rank, firstSeen, lastSeen, status (`new`/`promoted`/`ignored`) | the staging list you review/promote |
| `social_sources` *(config)* | subreddit, weight, enabled | which subs to poll (mirrors the watchlist pattern) |

Plus a small migration adding **`source` to `watchlist`** (`manual` \| `social`) to
distinguish curated symbols from surfaced ones.

### Key decisions

- **Reddit access — the hard blocker (updated 2026-07-05):** Reddit **killed
  self-service API keys in Nov 2025** ("Responsible Builder Policy"). New OAuth apps
  now require **manual approval** via the [Developer Support form](https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164)
  (~7-day target, approval uncertain). Worse: **unauthenticated public `.json`
  endpoints are now 403-blocked** too (verified from a residential IP with browser +
  descriptive User-Agents — all 403). So there is **no instant path** — OAuth approval
  is effectively required. The `RedditClient` is **dual-mode**: it uses public `.json`
  if no creds (currently 403s) and **auto-switches to OAuth** the moment
  `REDDIT_CLIENT_ID`/`REDDIT_SECRET` are set — so an approved app drops in with zero code
  change. Pushshift is dead (2023). Env: `REDDIT_USER_AGENT` (always), `REDDIT_CLIENT_ID`
  /`REDDIT_SECRET` (once approved), optional `SOCIAL_REQUEST_DELAY_MS`.
- **Extraction — noise is the hard part.** Trust `$CASHTAGS` (self-disambiguating); treat
  **bare uppercase words as suspects** requiring validation against a real symbol universe
  + a stoplist of common false positives (`DD`, `CEO`, `IT`, `YOLO`, `ATH`, `FOMO`…).
- **Scoring = spikes, not volume.** SPY is always mentioned — not signal. Rank by
  rate-of-change (z-score vs a trailing baseline) + **distinct authors** (so one spammer
  can't manufacture a trend).
- **Cadence is NOT market-hours-gated** (diverges from the earlier note). Reddit chatter is
  24/7 and pre-market/overnight sentiment matters most — run *ingestion* ~hourly around the
  clock; apply trading-hours gates only at the promote-to-tradable step.
- **Surface-only, always (v1).** The scanner nominates candidates; it never sizes or trades.
  The AI still decides and the risk gate still binds — the key guardrail against meme-driven
  blowups.

### ToS / licensing (know now, revisit at launch)

Reddit's Data API Terms (changed June 2023):
- **Commercial vs non-commercial:** free tier (OAuth, ~100 QPM) is for **non-commercial**
  use. **Resolved — this is a personal, single-user bot; comfortably non-commercial.** (If
  that ever changes — product/monetized/multi-user — it crosses into a paid Enterprise/Data
  API agreement; revisit then.)
- **Honor deletions — we retain full text + reconcile.** We *do* keep `bodyText` (useful for
  sentiment + review). Compliance is handled by a **scheduled deletion-audit job** (see
  below), not by avoiding storage. Reddit emits **no deletion events/webhooks**, so honoring
  deletions cannot be event-based — polling reconciliation is the only mechanism.
- **No model training** on Reddit content — **resolved, not doing it.** We do inference
  (Claude) over live content, never training/fine-tuning.

### Deletion-audit job (deletion compliance)

- **Why not event-based:** Reddit has no deletion push/webhook. (Streaming APIs exist but
  only for *new* submissions/comments — good for ingestion, useless for deletions.)
- **Mechanism:** a scheduled job (default **daily**) batch re-fetches stored `sourceId`
  fullnames via `GET /api/info?id=…` (**up to 100 per call** — cheap even at scale),
  inspects each: `author == "[deleted]"` / body `[deleted]` = user-deleted (the ToS case),
  `[removed]` = mod/admin removal.
- **On a hit:** purge/tombstone the row — null `bodyText`, set `contentStatus` +
  `deletedAt`; stamp `lastCheckedAt` on all rows checked.
- **Signal survives:** scoring uses derived metrics (counts, distinct authors, upvotes at
  sample time), which are plain numbers in our aggregates — purging deleted *text* leaves
  trending detection intact. We lose the content, never the signal.
- *(Optional later: also make ingestion event-based via streaming for lower latency on new
  posts — orthogonal to deletion handling.)*

### Phasing

- **Phase A — Ingest + store:** Reddit OAuth client, poll subs, extract cashtags, write
  `social_mentions` (incl. `bodyText`). Endpoints: `GET /social/mentions`,
  `GET /social/trending`. **+ deletion-audit job** (daily reconciliation via `/api/info`,
  purge/tombstone deleted rows) — ships with Phase A since we retain text from day one.
  Testable end-to-end once creds exist.
- **Phase B — Score + stage:** rolling-window scoring, `social_candidates` table,
  `POST /social/candidates/:id/promote` → creates a disabled `watchlist` row (`source='social'`).
- **Phase C — Quality:** LLM sentiment/spam pass, bare-ticker validation, config-driven
  subreddits/thresholds (`social_sources`), cron wiring.
- **Phase D — Safety:** wire the (not-yet-built) **earnings-calendar gate** before any
  social *single-name* can be enabled for trading — the dependency that makes surfaced meme
  stocks actually safe to sell premium on.

### Dependencies / open items

- **Reddit OAuth app + creds** (external; blocks Phase A from *running*, not from scaffolding).
- **Earnings-calendar gate** (also unbuilt) — a hard prerequisite for trading any surfaced
  single-name, per the ETF-only rationale in [strategy-methodology.md](strategy-methodology.md).
- Bare-ticker symbol universe (validation source — static list vs. tastytrade instruments).
- ToS/commercial-use answer before any non-personal deployment.

**Effort:** M–L (new ingestion service + storage + scoring; LLM sentiment is Phase C).

---

## Parking lot (unrefined)

- _(add quick one-liners here; promote to a full section when ready)_
