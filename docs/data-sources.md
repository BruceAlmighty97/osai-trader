# Data Sources & Tools

Decision record for the external data/tools that feed OsaiTrader — especially the
**pre-market phase** (build the watchlist, check earnings/macro, gather sentiment)
and the **entry analyst**. Researched 2026-09-06. Paid services are acceptable.

## What the app needs (mapped to the trading day)

| Need | Used for | Status |
|---|---|---|
| Quotes / chains / greeks / **IV Rank** | Strike selection, premium-selling edge | ✅ tastytrade (have) |
| **Earnings calendar** (universe sweep) | Exclude names reporting before selling premium | ❌ **gap** (tastytrade only gives a per-symbol flag) |
| **Economic calendar** (Fed / CPI / FOMC) | Pre-market "is today a big-event day?" | ❌ **gap** |
| **News / catalysts** | Pre-market context, single-name vetting | ❌ **gap** |
| **Sentiment** (social/news) | "Unusual attention / crowd lean" input | ⚠️ StockTwits works; Reddit dead |
| Options analytics / backtesting | Validate the strategy, single-name edge | ❌ (deferred, for funding time) |

## What we already have (the base)

- **tastytrade** — quotes, option chains, greeks, **IV Rank / IV percentile / HV /
  liquidity** (market-metrics), and a **per-symbol earnings field**. Free on the
  account. Real-time quotes require a **funded** account; unfunded = ~15-min
  delayed (fine for 45-DTE swings). Production access is via OAuth2.
- **StockTwits** — real **Bullish/Bearish** social sentiment via public endpoints
  (no key needed today): `GET api.stocktwits.com/api/2/trending/symbols.json` and
  `.../streams/symbol/{SYM}.json`. ~30–60% of messages carry a sentiment tag.
  Caveat: new API registrations are closed, so this rides the same public-endpoint
  fragility that killed Reddit — works now, could change.
- **Claude** — already paid for; the reasoning engine.

> **Reddit is dead as a source.** Its public `.json` endpoints now 403 even from a
> residential IP with a browser User-Agent — a blanket block, not a bug. The
> Reddit scanner is being retired in favor of StockTwits. See git history for the
> `social/reddit.client.ts` implementation if ever needed.

## The tool landscape

### All-in-one calendar + news + fundamentals (fills the core gaps)

| Service | Covers | Free tier | Paid | Fit |
|---|---|---|---|---|
| **Finnhub** ⭐ | **Earnings calendar**, company news, real-time US quotes, social sentiment, insider/congressional, FDA calendar | **60 calls/min; earnings calendar + news + quotes free** | $12–100/mo (econ calendar, alt-data, higher limits) | **Best value** — free tier closes the #1 gap (earnings) |
| **Financial Modeling Prep (FMP)** | Earnings **+ economic calendar + news**, analyst estimates, 30yr history | Limited | ~$22–50/mo (verify) | Cleanest single API for earnings **and** macro together |
| **Alpha Vantage** | AI news-sentiment scores, 200k tickers | 25 req/day (too low) | $49.99–99.99/mo | Only if you want pre-scored news sentiment |

### Market / options data (only if you outgrow tastytrade or fund for real-time)

| Service | Notes | Cost |
|---|---|---|
| **Polygon.io** (now Massive.com) | OPRA options data, but real-time options is specialized + pricey; stocks $29 (delayed) / $79 (RT IEX) / $199 (SIP) | $$ — overkill; tastytrade already gives chains+greeks |
| **Tradier** | Dev-friendly brokerage market-data API (chains, quotes) | ~$10/mo — cheap backup/cross-check |

### Options analytics / IV depth / flow (edge & validation — later, for funding time)

| Service | Strength | Cost |
|---|---|---|
| **Market Chameleon** | Best-in-class **earnings + IV analytics**, backtesting | from **$39/mo** |
| **ORATS** | Serious options **backtesting** (25yr history), IV research | from **$99/mo** |
| **Unusual Whales** | Options **flow / unusual activity**, IV rank, dark pool | **$48/mo** (API on request) |
| FlashAlpha | Dealer positioning (GEX/DEX) — 0DTE-focused | free tier; niche — skip |

### Sentiment APIs (from the Adanos roundup + our own testing)

| Tool | Signal | Cost | Notes |
|---|---|---|---|
| **StockTwits** (have) | Social, Bullish/Bearish | Free | Directional, finance-native, works today |
| **Quiver Quantitative** ⭐ | Reddit/WSB **+ congressional + insider** | $30/mo | Standout: bundles sentiment with **alt-data** nothing else here has; history 2018+ |
| **Adanos** | Reddit + X + news + Polymarket + crypto, one schema | Free 250/mo; $29 / $299 | Multi-source consolidation. **Self-serving caveat: it's the roundup's own product** |
| **StockGeist.ai** | Social + news, emotion vs. informative split, SSE stream | Free 10k credits; $75 pack | Real-time-ish, novel emotion breakdown |
| **Marketaux** | News, 80+ markets, 200k entities | Free (3/req); $29/mo | Entity-level normalized scores |
| **Finnhub social** | Reddit/Twitter aggregated | Plan-gated | Bundled if you go Finnhub |
| **ApeWisdom** | Reddit/WSB + 4chan | Free, no key | **Mention counts, not sentiment scores** |
| **RavenPack / Bigdata.com** | News+social, 40k sources, history to 2000 | Enterprise (~$0.0075/unit) | Institutional gold standard — out of scope |
| **Social Market Analytics** | Social S-Score, sub-second | Quote-only | Institutional, inaccessible self-serve |
| **Utradea** | X + StockTwits + Reddit | $22.95/mo | ⚠️ shows signs of being **unmaintained** |
| **Swaggy Stocks** | Reddit/WSB | Free dashboard | ⚠️ **no real developer API** despite an `/API` page |

## Recommended stack for this app

**Tier 0 — have (free):** tastytrade (quotes/chains/greeks/IV rank/earnings flag),
StockTwits (social sentiment), Claude (reasoning).

**Tier 1 — add now, ~$0: Finnhub (free tier).** Single-handedly closes the biggest
gap — a real **earnings calendar** to sweep the watchlist and exclude reporters —
plus **news headlines**. Highest-leverage move, costs nothing to start.

**The money-saving insight:** don't buy a separate "sentiment score" product. Feed
raw Finnhub headlines + StockTwits messages to **Claude and let it score sentiment
/ summarize catalysts** in the pre-market brief. You already pay for the reasoning,
and LLM-on-headlines is more tailored ("earnings in 3 days → skip") than a generic
score.

**Tier 2 — when macro-awareness matters (~$0–50/mo):** Finnhub's economic-calendar
add-on, or **FMP** for earnings + econ + news in one clean API.

**Tier 3 — sentiment upgrade (optional, ~$30/mo):** **Quiver Quantitative** if you
want the **congressional/insider alt-data** edge (the one signal StockTwits + Claude
can't give you). **Adanos** ($29) if you'd rather consolidate all social+news
sentiment behind one API.

**Tier 4 — validation / funding time (~$39–99/mo):** **Market Chameleon** or
**ORATS** to **backtest** the credit-spread approach on real history before putting
money in, and for deeper single-name earnings/IV edges.

**Skip:** Polygon options (expensive; tastytrade covers it), Alpha Vantage
(Finnhub+Claude covers news sentiment), FlashAlpha/GEX (0DTE-oriented), Utradea &
Swaggy Stocks (unmaintained / no real API).

## Net pre-market data picture

IV Rank (tastytrade) + earnings calendar (Finnhub) + macro calendar (FMP/Finnhub) +
social sentiment (StockTwits) + news (Finnhub) → **all reasoned over by Claude** →
the pre-market brief + the entry analyst's inputs. Cost: **~$0–50/month** until
funding, then add backtesting.

## Sources

- [Finnhub pricing](https://finnhub.io/pricing) · [earnings calendar](https://finnhub.io/docs/api/earnings-calendar)
- [Financial Modeling Prep pricing](https://site.financialmodelingprep.com/pricing-plans) · [economic calendar](https://site.financialmodelingprep.com/developer/docs/stable/economics-calendar)
- [Polygon.io pricing](https://apicostcalc.com/polygon.html)
- [Best Options Data APIs 2026 — Medium](https://medium.com/@diseasex/best-options-data-apis-2026-7-compared-pricing-free-tiers-d3833b7cf2f0)
- [Best Stock Sentiment APIs 2026 — Adanos](https://adanos.org/insights/blog/best-stock-sentiment-apis-2026/) (11-tool sentiment roundup; note it's Adanos's own post)
- [StockTwits for Developers](https://api.stocktwits.com/developers)
