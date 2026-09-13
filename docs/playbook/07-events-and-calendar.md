# 07 — Scheduled Events and Calendar Effects

**Scope:** Every recurring event that can move SPY / QQQ / IWM / XSP inside a 7–14 DTE holding window, how big those moves have been, and a mechanical rule set (tiers, blackout windows, sizing) for a ~$2,500 defined-risk tastytrade bot. Also: how to build the calendar programmatically each year.

**Conventions:** `IF … THEN …` rules. **[sourced]** = from a cited document. **[policy]** = an operating threshold for this account, not a finding. Times ET. Calendar dates are described by *rule* — specific dates change every year; fetch them from the sources in §9.

---

## 1. Event tiers (drives every rule below)

Tier is assigned by typical SPY/SPX impact. Sourced impact numbers are sparse and sample-dependent, so the table gives the sourced figure where one exists and the range where sources disagree.

| Tier | Event | Time (ET) | Sourced impact | Rule |
|---|---|---|---|---|
| **1** | FOMC decision + press conference | 14:00 / 14:30 | SPX avg abs move **1.20%** (12 meetings Jun-2022→Dec-2023, vs 0.84% normal) **[Rhoads]**; **~2.0%** avg (2022-era sample, vs 1.25% non-FOMC; day after +23% more volatile; SPX down next day 66.7%) **[Option Alpha]**. Range **1.2–2.0%**. | No new entries from 16:00 the prior day through 10:00 the day after. Positions with a short strike inside 1.0 × EM_1d at 13:45 → close by 13:55. |
| **1** | CPI | 08:30 | SPX avg abs move **0.64%** (12 prints to Dec-2023) — *lower* than the 1.07% ordinary-day average in that sample **[Rhoads]**; but individual prints of ~2% occur, and post-CPI intraday straddles were net losers while overnight straddles were net winners in 2023–24 **[Vol Vibes]**. | No new entries from 15:30 the prior day through 10:00 on release day. |
| **1** | Employment Situation (NFP) | 08:30, usually first Friday | No fetched SPX-move statistic; treated as Tier 1 by convention and because it also moves rates/dollar. | Same as CPI. |
| **2** | PPI, PCE, Advance GDP, Retail Sales, ISM Manufacturing / Services, JOLTS, UMich prelim | 08:30 (ISM/JOLTS/UMich at 10:00) | No fetched statistic; typically smaller than Tier 1. | Entries allowed only after the release + 30 min; position size × 0.5 on release day. |
| **2** | Monthly opex (3rd Friday) and quad witching (3rd Fri of Mar/Jun/Sep/Dec) | all day; close auction | Quad witching volume 2–4× a normal Friday **[SpotGamma]**; March-2025 quad witching saw the year's highest S&P volume **[TradeStation]**; post-quarterly-opex Mondays "historically produce outsized S&P 500 moves" **[SpotGamma, no figure]**. | No new entries on quad-witching day; do not choose quad-witching/monthly-opex as an expiration or as the planned exit day. Size × 0.5 on monthly opex. |
| **2** | JPM collar roll (last trading day of Mar/Jun/Sep/Dec) | into the close | JHEQX ≈ $19B AUM, ~40,000 SPX contracts; long put ~5% OTM, short put ~20% OTM, short call ~3–5% OTM; gamma pinning at the strikes near expiry (e.g., SPX closed "very near" the 6475 put strike on Mar 26 2026) **[OptionsTradingIQ; SpotGamma]**. | Note the collar strikes; treat the short-call strike as resistance and the long-put strike as support in the last week of the quarter. No new entries in the final 60 minutes of quarter-end. |
| **2** | Index rebalances: S&P quarterly (3rd Friday Mar/Jun/Sep/Dec, effective after close; changes announced ~5 trading days prior) **[CME OpenMarkets]**; Russell reconstitution (now **semi-annual, June and December**, effective after the close of the last Friday of June — e.g., Jun 26 2026, rank day Apr 30) **[LSEG]** | closing auction | Russell recon: "typically the biggest close of the year"; 3.3B shares / $63.8B in ~2 seconds (2022) **[Nasdaq]**; closing-auction share of ADV >25% **[Nasdaq]**. IWM is directly affected. | No IWM entries on Russell recon day; no entries in 15:30–16:00 on any rebalance day. |
| **3** | Initial jobless claims (Thu 08:30; a day earlier in holiday weeks) **[CM Elite / DOL]**, GDP revisions, UMich final, Consumer Confidence, housing data, Fed minutes (Wed 14:00, 3 weeks after FOMC) **[Fed]**, Fed speakers | various | Ordinarily small; escalate to Tier 2 if the market's dominant narrative is labor/inflation. | No blackout; log only. |
| **3** | VIX expiration (Wednesday, 30 days before the next month's 3rd-Friday SPX expiry; Tuesday when that Friday is a holiday) **[SpotGamma; Macroption]** | SOQ at the 09:30 open | VIX options/futures settle to the Special Opening Quotation from SPX opening prices; no direct SPY-move statistic sourced. | Entry window on VIX-expiry Wednesday starts 10:15 rather than 10:00 (SOQ-related SPX option flow at the open) **[policy]**. |
| **3** | Market holidays and 13:00 early closes | — | Two 1:00 pm early closes in 2026 (day after Thanksgiving, Christmas Eve); 10 full closures **[StockMarketHours; NYSE]**. Options close at 13:00 with the stock market; Cboe SPXW/XSP last trade 13:00 on half-days **[Cboe]**. | No new entries on early-close days; all scheduled exits due that day execute by 12:15. Count holidays as non-trading days in DTE_exit math. |
| **3** | Earnings season (starts ~2 weeks after quarter end: early/mid Jan, Apr, Jul, Oct; big banks first; no official end) **[FINRA]** | pre-open / after close | Index effect comes from mega-cap after-hours reports (file 05 §2.1). | Index-only book: apply file 05 stress-move rule for ≥ 2% SPY weights. Single-name trades are out of scope for this book. |

**Tier-1 blackout summary [policy]:**
```
no_new_entries = true IF
    now ≥ (tier1_release_time − 24h)   AND   now < (tier1_release_time + 90 min for 08:30 events / next-day 10:00 for FOMC)
size_multiplier = 0.5 IF tier2 event today (release not yet 30 min old) OR monthly opex OR early-close eve
size_multiplier = 0   IF quad witching, FOMC day, or VIX Stress flag (file 05)
```
A 7–14 DTE position will almost always *contain* at least one Tier 1 event; the blackout controls the *entry timing*, not the existence of events in the window. Positions carried through a Tier 1 event must satisfy: short strike distance ≥ 1.0 × EM to that event's date (`EM_n = S × IV × sqrt(n/365)`) at the 13:45 (FOMC) or prior-day 15:30 (08:30 releases) checkpoint; otherwise close **[policy]**.

---

## 2. FOMC detail

- **8 scheduled meetings per year**, two-day meetings ending on a Wednesday (occasionally Tuesday/Thursday around holidays). Statement **14:00**, press conference **14:30**. The **Summary of Economic Projections (dot plot)** accompanies the **March, June, September, December** meetings. Minutes are released **3 weeks after** the decision (Wednesday 14:00) **[Federal Reserve calendar]**.
- SEP meetings carry more repricing risk (rate path), so in the tier table they are treated as Tier 1 with `size_multiplier = 0` on the day and 0.5 on the following day **[policy]**.
- Pattern data **[Option Alpha, small sample]:** day-after-FOMC realized ~1.6% vs ~1.3% day-before; SPX closed down the day after in 66.7% of the sampled meetings. Treat as weak evidence; do not trade direction from it.
- Unscheduled/intermeeting actions and Chair testimony (semi-annual Humphrey-Hawkins, usually Feb/Mar and Jun/Jul) are Tier 2 by policy.

## 3. Macro data cadence (recurring rules)

| Release | Agency | Recurring rule | Time |
|---|---|---|---|
| Employment Situation (NFP) | BLS | Monthly; usually the **first Friday** for the prior month; can slip to the second Friday (e.g., Jan 9 and Feb 11 2026) and was rescheduled after the 2025/2026 appropriations lapses **[BLS]** | 08:30 |
| CPI | BLS | Monthly, ~10th–15th, weekday; check `bls.gov/schedule/news_release/cpi.htm` | 08:30 |
| PPI | BLS | Monthly, typically within 1–3 business days of CPI (Oct 14/15 2026 example) **[FedRateCalc]** | 08:30 |
| JOLTS | BLS | Monthly, ~first week, ~two months' lag | 10:00 |
| Initial jobless claims | DOL ETA | **Every Thursday**; brought forward one day in holiday weeks **[CM Elite]** | 08:30 |
| GDP | BEA | Quarterly: advance (~4 weeks after quarter end), second (~8 weeks), third (~12 weeks) **[BEA]** | 08:30 |
| Personal Income & Outlays (PCE) | BEA | Monthly, generally the last week of the month **[BEA]** | 08:30 |
| Advance Retail Sales | Census | Monthly, mid-month | 08:30 |
| ISM Manufacturing / Services | ISM | First / third business day of the month (convention; ISM calendar is behind a login — verify) | 10:00 |
| UMich Consumer Sentiment | UMich | Preliminary mid-month Friday; final last Friday of month (convention) | 10:00 |
| Consumer Confidence | Conference Board | Last Tuesday of the month (convention) | 10:00 |

## 4. Options-calendar structure

### 4.1 Expirations available per underlying

| Underlying | Expirations | Style / settlement | Last trade on expiry |
|---|---|---|---|
| SPX (SPXW) | Every Mon–Fri; plus 3rd-Friday AM-settled standard | European, cash | 16:00 (PM); standard monthly stops trading Thursday 17:00 and settles to Friday SOQ **[Cboe]** |
| XSP | Every Mon–Fri | European, cash, PM | 16:00 (13:00 half-day) **[Cboe]** |
| SPY | Every Mon–Fri (Tue/Thu added Nov 2022) | American, physical | 16:15 **[Nasdaq; Cboe]** |
| QQQ | Every Mon–Fri | American, physical | 16:15 |
| IWM | Every Mon–Fri (Tue/Thu added Nov 2022) | American, physical | 16:15 |
| NDX | Every Mon–Fri | European, cash | 16:00 |

**What daily expirations mean for a 7–14 DTE book:** (a) any weekday can be the expiry, so the bot can always find an expiry whose planned exit day (DTE_exit = 2 trading days before expiry, file 06) avoids a Tier 1 day; (b) Mon/Wed/Fri series are older and generally deeper than Tue/Thu; (c) daily expirations concentrate dealer gamma near the money every day, which is one reason intraday pinning and late-day whips are common — not a reason to hold to expiration.

### 4.2 Monthly opex and witching

- **Monthly opex:** 3rd Friday of every month; largest open interest of the month **[SpotGamma]**. SPY/QQQ/IWM ex-dividend dates typically coincide with the 3rd Friday of Mar/Jun/Sep/Dec — early-assignment risk on short ITM calls peaks the day before.
- **Quad ("triple") witching:** 3rd Friday of Mar/Jun/Sep/Dec — index futures, index options, single-stock options and options on index futures expire together; volume 2–4× a normal Friday **[SpotGamma; TradeStation]**. When that Friday is a holiday (e.g., Juneteenth Jun 19 2026), expiration moves to **Thursday** and VIX expiration moves to **Tuesday** **[SpotGamma]**.
- **S&P quarterly rebalance** takes effect at the same 3rd-Friday close; changes announced ~5 trading days ahead **[CME]**.

### 4.3 VIX expiration

- Rule: the **Wednesday that is 30 calendar days before the 3rd Friday of the following month** (SPX standard expiry); if that Friday is a holiday, the SPX expiry is Thursday and VIX expiry is Tuesday **[SpotGamma; Macroption]**. VIX options are European; last trading day is the business day before (normally Tuesday); settlement to the SOQ derived from SPX option opening prices/quotes **[Macroption]**.

### 4.4 Quarter-end flows

- **JPM collar (JHEQX):** rolled on the last trading day of each quarter (Mar/Jun/Sep/Dec) using quarterly SPX options; ~$19B fund, ~40k contracts; put ~5% OTM long / ~20% OTM short, call ~3–5% OTM short **[OptionsTradingIQ; SpotGamma]**. Its strikes act as gamma magnets in the final week; the roll itself is executed to avoid "large intraday delta risk" but still produces a visible late-day print.
- **Month-end / quarter-end rebalancing:** pension/target-date rebalancing is inferred from equity-vs-bond performance in the month; no fetched source quantifies its SPY impact, so it is Tier 3 (log only) **[policy]**.

---

## 5. Seasonality and calendar anomalies (with the evidence — and how weak it is)

| Effect | Evidence | Strength | Rule |
|---|---|---|---|
| **September weakness** | S&P 500 average monthly return since 1950: Sep **−0.72%**, the only meaningfully negative month; Aug −0.01%, Feb −0.01% **[Visual Capitalist / YCharts]** | Average is negative but dispersion is large; many Septembers are up | No position change. Slightly larger short-strike distance (× 1.1) in Sep–Oct is optional **[policy]**. |
| **"Sell in May" (May–Oct vs Nov–Apr)** | Avg monthly return May–Oct **0.13%** vs Nov–Apr **1.14%** since 1950 **[Visual Capitalist]** | Persistent on average; useless for a 7–14 DTE trade | None. |
| **October** | Avg +0.91% since 1950 but home to the largest crashes (1929, 1987, 2008) — higher realized vol, not lower return | Vol, not drift | Treat VIX regime rules (file 05) as sufficient. |
| **Turn of the month (last trading day → 3rd trading day of next month)** | McConnell & Xu (1926–2005): "virtually all of the excess market return" accrues in this 4-day window; strategy stats 7.2% p.a., Sharpe 1.04, max DD −20.8% **[Quantpedia]**; Quantpedia warns "calendar effects tend to vanish or rotate" | Statistically robust historically; economically small per day (a few bp) | None for entries; awareness that call-side short strikes are marginally more likely to be tested in this window. |
| **Day of week** | VIX tends to fall into Friday close (37% up-days) and rise Monday (62%) **[Macroption]**; weekend-spanning 1DTE put-writes earned a significant premium (+3.25 bp/day vs other days, p<0.05) **[OptionMetrics]**; Monday gap-downs filled 85% vs Friday gap-downs 30% in one 6-month SPY sample **[TradeThatSwing]** | Weekend premium is real but is compensation for gap risk; day-of-week gap stats are unstable small samples | See file 06 §3 for entry-day rules. |
| **Post-quarterly-opex Monday** | "historically produce outsized S&P 500 moves" **[SpotGamma — no figure given]** | Anecdotal | Entry window on that Monday starts 10:30 **[policy]**. |
| **Election-year / geopolitical shocks** | Not a calendar effect; unscheduled. The relevant sourced facts: VIX spikes decay "like ripples in a pond" and large one-day SPX declines have historically been buying opportunities on average, with wide dispersion **[Adam Grimes]**; after the 10 instances of a 50% monthly VIX surge, S&P 12-month returns beat the historical average in 7 of 10 **[TrueShares]** | Directional edge is not exploitable at 7–14 DTE; the *vol* behaviour is | Governed entirely by the VIX regime flags (file 05 §2.4): Stress → no entries; Post-event crush → entries resume. US presidential election day (first Tuesday after the first Monday in November, every 4 years) is Tier 1 by policy: no entries from the prior Friday through the Thursday after. |

---

## 6. Holidays and early closes

- NYSE/Nasdaq/Cboe observe **10 full-day holidays** (New Year's Day, MLK Day, Presidents Day, Good Friday, Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas). Observance rule: Saturday holidays are observed on the preceding Friday (e.g., Jul 3 2026), Sunday holidays on the following Monday; **New Year's Day falling on Saturday is an exception — the market does not close the prior Friday** (NYSE rule; confirm each year) **[StockMarketHours; tastytrade futures page for the weekend-observance rule]**.
- **13:00 ET early closes:** the day after Thanksgiving, and Christmas Eve / July 3 when they fall on a weekday and the following day is the holiday (2026: Nov 27 and Dec 24) **[StockMarketHours]**. Options stop at 13:00; SPXW/XSP expiring that day stop at 13:00 **[Cboe]**; SPY/QQQ/IWM extended session ends 13:15 (confirm with Nasdaq's holiday schedule).
- CME equity futures observe the same holidays with shortened sessions; VX futures likewise **[tastytrade futures hours]**.
- Rules **[policy]:** (1) holidays are not trading days for DTE_exit; (2) no entries on an early-close day; (3) an entry on the last trading day before a 3-day weekend requires short strike distance ≥ 1.0 × EM_4d.

---

## 7. Earnings seasons and the index book

- Seasons begin roughly two weeks after each quarter end (early/mid Jan, Apr, Jul, Oct), led by large banks; intensity fades toward the SEC filing deadline; no official end **[FINRA]**.
- Peak weeks for SPY/QQQ: the two weeks when NVDA (late Feb/May/Aug/Nov — off-cycle), AAPL/MSFT/AMZN/GOOGL/META (late Jan/Apr/Jul/Oct, after the close) report; together these plus AVGO/TSLA ≈ 33% of SPY **[Investing Engineer]**.
- Rules **[policy]:** index-only book; apply file 05 §2.1 stress test (`weight × 10%`) for each ≥ 2%-weight reporter inside the holding window; if the sum of stress moves for reporters inside the window exceeds 0.75 × EM to expiry, do not enter that expiry. QQQ positions get `size_multiplier = 0.5` during the two peak mega-cap weeks.

---

## 8. Master rule set (copy into the bot's config)

```
TIER_1 = {FOMC_decision, CPI, NFP, US_presidential_election_day}
TIER_2 = {PPI, PCE, GDP_advance, retail_sales, ISM_mfg, ISM_svc, JOLTS, UMich_prelim,
          monthly_opex, quad_witching, JPM_collar_roll_day, SP_rebalance_day, Russell_recon_day,
          FOMC_SEP_day_after, Fed_chair_testimony}
TIER_3 = {jobless_claims, GDP_revisions, UMich_final, conf_board, housing, FOMC_minutes,
          VIX_expiration, early_close, holiday_eve, earnings_season_flag}

R1  no_new_entries IF (tier1_release − 24h) ≤ now < tier1_release + 90min   (08:30 releases)
R2  no_new_entries IF FOMC_day, from 16:00 prior day until 10:00 next day
R3  no_new_entries IF quad_witching_day OR early_close_day OR Russell_recon_day(IWM only) OR VIX_stress
R4  size × 0.5     IF tier2_release_today (until release + 30min elapsed) OR monthly_opex OR post-quarterly-opex Monday
R5  entry window   = 10:00–15:30; start 10:05 on 10:00-release days; 10:15 on VIX-expiry Wednesday; 10:30 on post-quarterly-opex Monday
R6  expiry choice  = 7–14 DTE, exit day (expiry − 2 trading days) must not be a Tier 1 day; expiry must not be monthly opex / quad witching
R7  carry-through  : a position may span a Tier 1 event only if short_strike_distance ≥ 1.0 × EM_to_event at the pre-event checkpoint; else close
R8  earnings       : sum(weight × 10%) for ≥2%-weight reporters inside window ≤ 0.75 × EM_to_expiry; else skip
R9  holiday math   : DTE_exit counts trading days only; entries before a 3-day weekend need distance ≥ 1.0 × EM_4d
R10 no_entries in 15:45–16:00 on any day; none in 15:30–16:00 on rebalance/quarter-end days
```

---

## 9. Sourcing the calendar programmatically

| Feed | What it gives | How |
|---|---|---|
| **BLS** | CPI, PPI, NFP, JOLTS, etc. with times | ICS feed `https://www.bls.gov/schedule/news_release/bls.ics` (auto-updated); per-release pages `https://www.bls.gov/schedule/news_release/{cpi,empsit,ppi,jolts}.htm`; monthly HTML `https://www.bls.gov/schedule/{YYYY}/{MM}_sched.htm`. No JSON API for the schedule **[BLS]**. Parse the ICS. |
| **BEA** | GDP (3 estimates), PCE, trade, etc. | Schedule page offers **JSON** at its API endpoint plus ICS **[BEA]**: `https://www.bea.gov/news/schedule`. |
| **DOL** | Weekly claims | Always Thursday 08:30, shifted a day earlier in holiday weeks; derive from the holiday calendar; verify at `https://www.dol.gov/ui/data.pdf` **[DOL]**. |
| **Federal Reserve** | FOMC dates, SEP meetings (asterisked), minutes dates | `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm` (HTML; scrape the meeting table; SEP marked with `*`) **[Fed]**. |
| **Cboe** | Holidays, early closes, expiration calendars, VIX expiration | `https://www.cboe.com/about/hours/us-options/` and the Cboe expiration calendar; SpotGamma publishes a derived OPEX/VIX-expiry download **[SpotGamma]**. |
| **NYSE** | Holidays and 13:00 closes | `https://www.nyse.com/trade/hours-calendars` (HTML; 403 to some fetchers — mirror sites such as stockmarkethours.org list the same data) **[NYSE; StockMarketHours]**. |
| **tastytrade API** | Market holidays/sessions, earnings dates, option chains | MCP tools available in this environment: `tastytrade_get_market_holidays`, `tastytrade_get_market_session`, `tastytrade_get_sessions_range`, `tastytrade_get_earnings_reports`, `tastytrade_get_option_chain_compact` (to confirm which daily expirations are actually listed). |
| **S&P DJI / FTSE Russell** | Rebalance and reconstitution dates | S&P: 3rd Friday of Mar/Jun/Sep/Dec, announcements ~5 trading days prior **[CME]**; Russell: LSEG press releases give rank day, preliminary-list dates and the effective Friday (June and December, semi-annual) **[LSEG]**. |
| **ISM / UMich / Conference Board** | 10:00 releases | ISM calendar page requires login; use the business-day rule and confirm via a third-party economic calendar (e.g., Apify "Official US Economic and Federal Calendar" actor, or FedRateCalc) **[FedRateCalc; Apify]**. |
| **Derived** | Monthly opex = 3rd Friday (Thursday if holiday); quad witching = 3rd Friday of Mar/Jun/Sep/Dec; VIX expiry = the Wednesday 30 days before the *next* month's 3rd Friday (Tuesday if that Friday is a holiday); JPM collar roll = last trading day of Mar/Jun/Sep/Dec; SPY/QQQ/IWM ex-dividend ≈ 3rd Friday of Mar/Jun/Sep/Dec (confirm via `tastytrade_get_historical_dividends`). | Compute in code each January; re-verify against Cboe/SpotGamma. |

Build order each year: (1) exchange holidays → (2) derived options dates → (3) Fed → (4) BLS/BEA/DOL → (5) ISM/UMich/CB from a third-party calendar → (6) index rebalances → (7) earnings from the tastytrade API weekly. Store as a single JSON list of `{date, time_et, name, tier, agency, source_url}` and regenerate weekly.

---

## 10. Facts that could not be verified

- No fetched source gives a measured average SPY move for NFP, PPI, PCE, GDP, ISM or JOLTS days; tiers for those are by convention.
- CPI vs FOMC impact numbers come from 12-event samples (Rhoads) and a small 2022-era sample (Option Alpha); expect them to drift with the macro regime.
- ISM and UMich release rules are conventions, not fetched from the issuing bodies (ISM's calendar is login-gated).
- The NYSE hours page returned 403; holiday and early-close facts come from a mirror site and the tastytrade futures page.
- Cboe's list of which ETF options trade to 16:15 on half-days (13:15?) was not fetched; confirm on the Nasdaq/Cboe holiday schedule.
- "Post-quarterly-opex Monday outsized moves" (SpotGamma) has no figure attached.

## Sources

- Federal Reserve, FOMC meeting calendars (8 meetings, SEP quarters, minutes +3 weeks): https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- Option Alpha, Trading the FOMC meeting (FOMC-day move statistics): https://optionalpha.com/blog/trading-the-fomc-meeting-0dte-next-day-strategies
- Russell Rhoads, SPX/option price action around CPI and FOMC: https://russellrhoads.substack.com/p/historical-index-and-option-price
- Vol Vibes, CPI straddle results 2023–2024: https://volvibes.substack.com/p/cpi-update-spx-and-spx-options
- BLS release calendar and ICS feed: https://www.bls.gov/schedule/
- BLS Employment Situation schedule (first-Friday pattern, 2026 dates): https://www.bls.gov/schedule/news_release/empsit.htm
- BLS revised release dates after appropriations lapses: https://www.bls.gov/bls/2025-lapse-revised-release-dates.htm
- BEA release schedule (GDP, PCE at 8:30; JSON/ICS): https://www.bea.gov/news/schedule
- CM Elite Group, Initial jobless claims release rule (Thursday 8:30, holiday shifts): https://www.cmelitegroup.com/trends-and-insights/initial-jobless-claims-release-time-schedule-and-what-the-weekly-data-measures/
- FedRateCalc, US economic calendar (release times/agencies): https://fedratecalc.com/us-economic-calendar/
- SpotGamma, OPEX and VIX expiration calendar and rules: https://spotgamma.com/options-expiration-dates-vix-expirations-dates-download/
- Macroption, VIX options settlement (30-day rule, SOQ): https://www.macroption.com/vix-options-settlement/
- TradeStation, Quadruple witching dates 2026: https://www.tradestation.com/insights/2026/01/23/quadruple-witching-dates-2026-stock-futures-trading/
- OptionsTradingIQ, The JPM Collar: https://optionstradingiq.com/jpm-collar-trade/
- SpotGamma Support, JPM Collar: https://support.spotgamma.com/hc/en-us/articles/12763513348243-JPM-Collar
- CME Group OpenMarkets, S&P 500 quarterly rebalance: https://www.cmegroup.com/openmarkets/equity-index/2025/Navigating-the-S-P-500-Rebalance-A-Quarterly-Market-Ritual.html
- LSEG / FTSE Russell, June 2026 semi-annual reconstitution: https://www.lseg.com/en/media-centre/press-releases/ftse-russell/2026/ftse-russell-begins-june-2026-semi-annual-russell-us-indexes-reconstitution
- Nasdaq, Russell reconstitution closing-auction statistics: https://www.nasdaq.com/articles/what-to-know-about-the-annual-russell-index-changes
- StockMarketHours, NYSE holidays 2026 (10 closures, two 1:00 pm early closes): https://stockmarkethours.org/nyse-holidays-2026
- NYSE hours & calendars (official; returned 403 to the fetcher): https://www.nyse.com/trade/hours-calendars
- tastytrade, futures market hours and holiday observance rule: https://tastytrade.com/learn/trading-products/futures/futures-market-hours/
- Cboe SPX specifications (hours, last trading day, half-day 1:00 pm): https://www.cboe.com/tradable_products/sp_500/spx_options/specifications/
- Cboe XSP specifications: https://cboe.com/tradable-products/sp-500/xsp-options/specifications
- Cboe, SPY/QQQ/IWM Tuesday & Thursday weeklies (Nov 2022): https://cdn.cboe.com/resources/product_update/2022/Cboe-Options-to-List-SPY-and-QQQ-Tuesday-and-Thursday-Expiring-Weekly-Options.pdf
- My0DTEOptions, underlyings with Mon–Fri expirations: https://my0dteoptions.com/blog/stocks-with-0dte-options/
- Nasdaq options market hours (4:15 pm ETF list): https://www.nasdaqtrader.com/Trader.aspx?id=optionshours
- Visual Capitalist / YCharts, average S&P 500 return by month since 1950: https://www.visualcapitalist.com/charted-average-sp-500-return-by-month-since-1950/
- Quantpedia, Turn of the Month in Equity Indexes (McConnell & Xu): https://quantpedia.com/strategies/turn-of-the-month-in-equity-indexes
- Macroption, VIX–SPX correlation and weekday pattern: https://www.macroption.com/vix-spx-correlation/
- OptionMetrics, Selling Saturdays (weekend risk premium): https://optionmetrics.com/blog/selling-saturdays-weekend-risk-premia-in-1dte-put-write-strategies/
- TradeThatSwing, SPY gap-fill by weekday: https://tradethatswing.com/sp-500-spy-es-gap-fill-strategy-and-statistics/
- Adam Grimes, What happens after big spikes in the VIX: https://www.adamhgrimes.com/what-happens-after-big-spikes-in-the-vix/
- TrueShares, When the VIX jumps: https://www.true-shares.com/insights/vix-spike
- FINRA, Earnings season: https://www.finra.org/investors/insights/earnings-season
- Investing Engineer, SPY top holdings (May 2026): https://investingengineer.com/top-25-holdings-of-spy-by-weight/
- Apify, Official US Economic and Federal Calendar API (third-party aggregator): https://apify.com/redfoxxie/official-us-economic-release-calendar
