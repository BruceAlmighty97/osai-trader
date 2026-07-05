# API Endpoints — A Trader's Companion Guide

This is the **plain-language companion** to [api-endpoints.md](api-endpoints.md). That doc is the precise reference (inputs, outputs, field types). This one answers the questions a newer options trader actually asks: **why does this endpoint exist, when would I call it, and what is the data telling me?**

If a term is unfamiliar, start with the [concepts primer](#a-quick-options-primer) below, then read the endpoint sections.

---

## A quick options primer

Just enough vocabulary to make the endpoints make sense. OsaiTrader trades **defined-risk credit spreads on liquid ETFs** — that shapes what data we care about.

- **Option** — a contract to buy (**call**) or sell (**put**) 100 shares of an underlying at a set **strike price** until an **expiration** date. We mostly *sell* options to collect premium.
- **Underlying** — the thing the option is on (e.g. SPY, the S&P 500 ETF).
- **Strike** — the price the option is "aimed at." A put at strike 600 gains value if the underlying falls below 600.
- **Expiration / DTE** — when the option dies. **DTE = days to expiration.** We target **30–45 DTE** (best balance of time-decay income vs. risk). Shorter than that and the position swings wildly ("gamma risk"); see [strategy-methodology.md](strategy-methodology.md).
- **Premium / credit** — the cash you receive for *selling* an option. Our strategies are "credit" strategies: we get paid up front and want the options to expire worthless so we keep it.
- **Bid / ask** — the price buyers will pay (bid) vs. sellers will take (ask). The gap ("the spread") is a hidden cost; **tight bid/ask = liquid = good.** This is why we stick to SPY/QQQ/IWM/GLD/TLT/SLV.
- **The Greeks** — numbers that describe how an option's price reacts:
  - **Delta** — how much the option moves per $1 move in the underlying, and loosely, the **probability it expires in-the-money.** A 0.20-delta short option ≈ ~80% chance it expires worthless (good for us). We sell strikes at **0.15–0.30 delta.**
  - **Theta** — daily income from time decay. Positive for option *sellers* — this is our engine.
  - **Gamma** — how fast delta changes. High gamma (near expiration) = danger. Why we avoid short-DTE.
  - **Vega** — sensitivity to volatility changes.
  - **IV (implied volatility)** — the market's expected movement, baked into the option's price. **Higher IV = fatter premium.** We prefer to sell when IV is elevated.
- **Credit spread** — sell one option, buy a further-out cheaper one as insurance. The bought leg **caps the loss** = "defined risk." Every trade we make has this protective leg.
- **Dry run** — ask the broker "would this order be valid, and what would it cost me in buying power?" **without actually placing it.** Our safety rail.

---

## How the endpoints map to the trading workflow

The bot's real job is a pipeline (see [architecture-pipeline.md](architecture-pipeline.md)). The endpoints roughly line up with its stages:

```
Which symbols do I even look at?      → /watchlist/*
What's the crowd talking about?       → /social/* (optional funnel → watchlist candidates)
Is the broker connection alive?      → /tt/whoami
What can I trade on this symbol?      → /tt/chain, /tt/strikes, /tt/equity, /tt/chain/*
What's the risk climate?             → /tt/market-metrics
What's it worth RIGHT NOW?           → /tt/live, /tt/quote-token, /tt/option
What should I do? (the judgment)     → /strategy/suggest
Would this order be valid?           → /tt/dry-run-spread
What do I hold + how did it go?       → /positions/*
```

---

## 0. "Which symbols do I even look at?"

Before any analysis, the bot needs a **list of what to consider** — its watchlist. Rather than hardcode it, we keep it in a table you can edit, so you can add/remove symbols, pause one temporarily, or tell the bot to look at some more often than others.

### `GET /watchlist` / `POST` / `PATCH /:id` / `DELETE /:id`
**In trader terms:** *"What's my shortlist of tickers to hunt for trades on, and how should the bot treat each one?"*

Each entry is a symbol plus a few knobs:

- **`cadence`** — how often to run the AI analysis on it. **`daily`** = look once a trading day (the normal, cost-conscious setting). **`every_cycle`** = look on every scan cycle (more responsive, but each look is an AI call, so it costs more — reserve it for your anchor symbol like SPY).
- **`enabled`** — a pause switch. Set it off to sideline a symbol without losing its settings (e.g. skip TLT around a Fed meeting).
- **`correlationGroup`** — which "risk family" the symbol belongs to. This is the important one. SPY, QQQ, and IWM all rise and fall together — selling spreads on all three isn't three diversified trades, it's **one big bet on US stocks.** Tagging them all `us_equity` lets the ranking logic later cap how much it piles into a single family. Real diversification comes from *different* families — `gold` (GLD), `rates` (TLT), `silver` (SLV).
- **`priority`** — when the bot can only open a couple new trades a day, which symbols get first look. Higher = preferred.

**Starter list (seeded):** SPY, QQQ, IWM (the `us_equity` trio), plus GLD, TLT, SLV as diversifiers — 6 liquid ETFs chosen because they have tight bid/ask spreads and, being funds, **don't have earnings surprises** that can blow through a strike overnight. See [strategy-methodology.md](strategy-methodology.md) for why these six.

> This table is what the future `/strategy/scan` will loop over: for each enabled symbol due for its cadence, run the analysis, then rank the results (using `correlationGroup` to avoid over-concentrating).

---

## 0.5 "What's the crowd talking about?" (optional funnel)

Beyond your curated watchlist, the bot can watch **Reddit** for tickers suddenly getting a lot of attention — a wider, timelier funnel of ideas. This is a *sourcing* tool: it never trades, it just nominates symbols you might want to watch.

### `POST /social/ingest` / `GET /social/trending` / `GET /social/mentions` / `POST /social/audit`
**In trader terms:** *"Which tickers are heating up on the trading subreddits right now?"*

- **`ingest`** goes out to subreddits like r/options and r/wallstreetbets, reads the posts, and pulls out any tickers mentioned. It trusts **`$SPY`-style cashtags** (unambiguous) and is cautious with bare words like `SPY` (filtered against a list of look-alikes such as `CEO`, `YOLO`, `DD`).
- **`trending`** ranks what's bubbling up — but by **distinct authors**, not raw mentions, so one person spamming a ticker 50 times doesn't fake a trend. SPY is always mentioned; the point is to catch a symbol going from quiet to loud.
- **`mentions`** is the raw feed for a given symbol (the actual posts).
- **`audit`** is housekeeping for Reddit's rules — it re-checks stored posts and deletes the text of any the author later removed.

**Important guardrail:** trending symbols do **not** auto-trade. In the full design they become *candidates* you (or a score threshold) promote onto the watchlist **disabled**, so the normal scan → AI → risk-gate flow still decides everything. And because Reddit surfaces meme single-stocks — which carry earnings-gap risk the ETF watchlist deliberately avoids — those need the (future) earnings-calendar check before they're safe to trade. Think of this as *idea generation*, not a trade signal.

> **Needs Reddit API creds** to actually run (`REDDIT_CLIENT_ID`/`SECRET`/`USER_AGENT`). Without them it no-ops cleanly.

---

## 1. "Is the broker connection alive?"

### `GET /tt/whoami`
**In trader terms:** *"Am I logged in, and which account am I about to trade in?"*

This is the handshake. Before doing anything, you want to confirm the session with tastytrade works and that it's pointed at the right account (and the right **environment** — `sandbox` for practice with fake money, `production` for real). If this fails, nothing else will. It's the first thing to hit when something seems broken.

**What you learn:** logged-in yes/no, environment, and your account number(s).

---

## 2. "What can I trade on this symbol?"

These explore the **option chain** — the full menu of contracts available on an underlying. You call these to see *what expirations and strikes exist* before deciding on anything.

### `GET /tt/chain`
**In trader terms:** *"What expiration dates are available for SPY, and how many strikes does each have?"*

A quick, readable overview. Options come in batches by expiration date; this lists them with their **DTE** and strike counts. You'd glance here to confirm there's a ~30–45 DTE expiration to work with. It's also the simplest "are options data flowing?" check.

### `GET /tt/strikes`
**In trader terms:** *"Show me the full ladder of strike prices for the expiration nearest 30 days out."*

Once you've picked an expiration, this is the **strike ladder** — every available strike price, low to high, with all the underlying identifiers (including the symbols needed to pull live quotes). This is where you'd eyeball which strikes sit where relative to the current price. You give it a target DTE and it picks the closest real expiration.

### `GET /tt/equity`
**In trader terms:** *"Give me the basic facts about the underlying itself."*

The definition of the stock/ETF behind the options — description, exchange, tick sizes. Rarely the star of the show; useful for confirming a symbol is valid and tradable.

### `GET /tt/chain/detailed` and `GET /tt/chain/compact`
**In trader terms:** *"Give me the raw, complete contract list — either fully detailed or just the symbols."*

Two flavors of the whole chain in one shot. **Detailed** = every contract with all its fields (heavy). **Compact** = just the option symbols (light). These are more for programmatic/bulk use than eyeballing — `chain` and `strikes` are friendlier for a human. Reach for these when you need the entire universe of contracts at once.

---

## 3. "What's the risk climate?"

### `GET /tt/market-metrics`
**In trader terms:** *"Is volatility high or low right now — i.e. is premium fat or thin — and is this thing liquid?"*

This is the **should-I-even-be-selling-premium-today** check. Key number is **IV rank**: is current implied volatility high or low *relative to this symbol's own past year*? Premium sellers want to sell when IV is elevated (richer credit, better odds). Also carries liquidity and beta.

> **Heads-up:** this **doesn't work in the sandbox** (returns an error) — the practice feed doesn't provide it. It works in production. Until then, the volatility-based pre-filter is on hold.

---

## 4. "What's it worth right now?"

The chain tells you what *exists*; these tell you what things are **currently priced at and how they'll behave** — including the all-important Greeks.

### `GET /tt/live`  ← the important one
**In trader terms:** *"For the strikes around the money, give me live bid/ask AND the Greeks — especially delta — so I can pick which strike to sell."*

This is the **strike-selection workhorse.** It streams live quotes and Greeks for a window of strikes at one expiration. The reason it matters: **delta drives strike selection.** We sell strikes at 0.15–0.30 delta, and delta only comes from this live Greeks feed — you can't get it from the static chain. It also gives bid/ask so you can judge liquidity and likely fill price.

You tell it the symbol, target DTE, puts or calls, how many strikes, and how many seconds to listen. It returns one tidy row per contract with delta/theta/IV/etc. plus bid/ask.

### `GET /tt/quote-token`
**In trader terms:** *"Get me the pass to the live-quote firehose."*

Plumbing. Live quotes/Greeks come over a separate streaming connection (DXLink) that needs its own token. `/tt/live` uses this under the hood; you'd rarely call it directly unless debugging the streaming setup.

### `GET /tt/option`
**In trader terms:** *"Look up this one specific contract by its official symbol."*

When you already know the exact contract (by its 21-character [OCC symbol](api-endpoints.md#get-ttoption), like `TGT   260731P00095000`), this fetches its instrument details. A targeted single-contract lookup rather than browsing the chain.

---

## 5. "What should I actually do?" (the AI judgment call)

### `POST /strategy/suggest`  ← the brain
**In trader terms:** *"Given everything about SPY right now, recommend one specific trade — the structure, the strikes, and why."*

This is the endpoint that ties it all together. Point it at a symbol and it: pulls the live price + Greeks snapshot, hands it to Claude, and gets back **one concrete recommendation** from the playbook — which strategy (bull put spread, iron condor, etc.), which exact legs/strikes, the expected credit, the max risk, and a **written rationale**. Or `no_trade` if nothing looks good, which is a legitimate and important answer.

Think of it as an experienced options trader looking at the same screen and saying "here's the trade I'd put on, and here's my reasoning." **It only *suggests* — it places nothing.** The deterministic risk checks and execution are separate layers (by design: the AI proposes, hard-coded rules dispose).

**What you learn:** the recommended strategy, the legs with target deltas, target credit, max risk, market read, and caveats.

---

## 6. "Would this order be valid?"

### `POST /tt/dry-run-spread`
**In trader terms:** *"Pretend I'm submitting this credit spread — would the broker accept it, and how much buying power would it tie up? (But don't actually place it.)"*

The **safety-rail proof.** It builds a sample bull-put credit spread from the live chain and sends it to tastytrade as a *dry run* — the broker validates it and reports the buying-power effect, fees, and any warnings, **without placing an order.** This is how we confirm the whole multi-leg order plumbing works before ever risking a live submission. (Real, live order execution is a separate future capability, kept behind a flag.)

---

## 7. "What do I hold, and how did it go?"

This is **our own record-keeping**, not the broker's. Critical detail: the practice (sandbox) account **wipes its positions every night**, so we keep the real record in our own database. These endpoints manage that record. See [persistence-and-db.md](persistence-and-db.md).

### `POST /positions`
**In trader terms:** *"Log that I've opened this spread, so the system remembers I own it."*

Records an open position — the strategy, the legs, the credit collected, the max risk. Right now you do this by hand (later, execution will do it automatically on a fill). Each leg carries the symbol needed to re-price it later. This is what lets the bot know "I'm holding a SPY bull put spread" even after the broker has forgotten overnight.

### `GET /positions`
**In trader terms:** *"What am I currently holding?" (or "what have I closed?")*

Your portfolio ledger. Filter by **open** (what's live and needs managing) or **closed** (your track record). The management loop reads the open list to decide what to monitor.

### `GET /positions/:id`
**In trader terms:** *"Pull up the full detail on this one position."*

A single position, everything about it — its legs, entry credit, current status, and (if closed) how it ended.

### `PATCH /positions/:id/close`
**In trader terms:** *"Mark this trade as closed and record how it turned out."*

When you exit a position, you log why and the result. The **exit reason** matters because it maps to our management rules:
- **`profit_target`** — hit ~50% of max profit; take the win early (the standard premium-seller exit).
- **`dte_roll`** — reached ~21 DTE; close/roll before gamma risk ramps up.
- **`stop_loss`** — loss hit ~2× the credit received; cut it.
- **`expired`** — held all the way to expiration.
- **`manual`** — you closed it by hand for your own reasons.

Along with the realized **P&L**, this builds the track record you'll use to judge whether the strategy actually works.

---

## Putting it together: a typical "open a trade" flow

1. **`/watchlist`** — start from your shortlist of symbols (and their priority/cadence).
2. **`/tt/whoami`** — confirm you're connected to the right account.
3. **`/tt/chain`** → **`/tt/strikes`** — find a ~35 DTE expiration and see the strike ladder.
4. **`/tt/market-metrics`** *(prod only)* — is IV high enough to bother selling premium?
5. **`/tt/live`** — pull Greeks for the near-the-money strikes to find the 0.15–0.30 delta candidates.
6. **`/strategy/suggest`** — let the AI read it all and propose a specific spread.
7. **`/tt/dry-run-spread`** — validate the order would be accepted and check buying-power cost.
8. *(future: risk gate → live execution)*
9. **`POST /positions`** — record the opened position so the system tracks it.
10. Later, repeatedly: check open positions, re-price them, and **`PATCH .../close`** when an exit rule fires.

---

*For exact request/response shapes, field types, and error codes, see [api-endpoints.md](api-endpoints.md).*
