# 04 — Market Signals for Short-DTE Defined-Risk Spreads

Scope: the pre-trade and in-trade environment checks an automated agent should run before opening or holding 7–14 DTE credit spreads, debit spreads, iron condors and butterflies on SPY / QQQ / IWM / SPX-XSP. Every threshold below is tagged with its source; where sources disagree the range is given and the **rule the bot uses is stated explicitly**.

Signal priority (highest first): 1. VIX level + term structure, 2. IV rank / VRP of the specific underlying, 3. dealer gamma regime, 4. scheduled events, 5. trend/breadth, 6. everything else. A "no-trade" from any of items 1–4 overrides a "go" from lower-priority signals.

---

## 1. VIX level regimes

VIX = 30-day implied volatility of SPX options, annualised. Daily 1-SD move of SPX ≈ VIX / √252 (VIX 16 → ~1.0 %/day).

| VIX band | Regime (Volatility Box) | Historical frequency | Typical SPX daily move | What premium selling looks like | Bot rule |
|---|---|---|---|---|---|
| < 15 | Low / complacent | ~35 % of days | < 0.5 % | Thin credits; 16Δ strikes sit very close to price in $ terms; trend persistence strong | **Caution for condors** (credit/width often < 25 % → fails 02 T4 / 03 R12). Prefer directional debit spreads / butterflies (cheap vega), or 10–16Δ verticals only when VRP still > 3 pts |
| 15–20 | Normal | ~30 % | 0.5–1.0 % | "Sweet spot for premium selling"; VRP near historical average | **Go** for credit spreads and condors at 16Δ |
| 20–30 | Elevated | ~25 % | 1.0–2.0 % | Bigger credits, but gaps and reversals common; correlations rise | **Go with reduced size**, defined-risk only (Volatility Box: "iron condors over naked strangles"), widen to 10–12Δ or 1.5-SD; require VIX term structure in contango (§2) |
| > 30 | Crisis | ~10 % | 3–8 % possible | Mean reversion is fastest here (VIX 30+ → sub-25 typically within 3–4 weeks per Volatility Box), but entries *during the rise* get run over | **No new short-premium entries while VIX is rising** (VIX above its 5-day SMA or VIX9D > VIX). Enter only after VIX has peaked and closed lower for ≥ 2 sessions and term structure is flattening; then 10Δ, half size, 7–10 DTE max |

Additional VIX rules:
- **VIX change rule:** a 1-day VIX rise ≥ +20 % or ≥ +5 points = no new entries that session, review open short-vega positions (03-greeks R10).
- VIX-regime interaction with management: projectfinance's condor study found the 30Δ setup outperformed in high-VIX regimes across all management rules and the 16Δ setup did best in high VIX with loss management + high profit targets — i.e. **high VIX is where the loss stop (2× credit) matters most**.
- Do not use the VIX for QQQ or IWM directly: use VXN (Nasdaq-100) and RVX (Russell 2000), or the underlying's own IV, for those. The regime bands are similar in spirit but the absolute levels differ (VXN and RVX run structurally higher than VIX).

---

## 2. VIX term structure and vol-of-vol

### 2.1 VIX / VIX3M (30-day vs 93-day) — regime stress gauge

| Reading | State | Source facts | Bot rule |
|---|---|---|---|
| VIX/VIX3M < 1.0 (VIX3M/VIX − 1 > 0) | **Contango** — normal | Contango is the default: ~92 % of days since 2010 (thetrading.tools) vs ">80 % of the time since 2010" (Raven Quant, for the *futures* curve). Range: 80–92 % | Premium selling allowed |
| VIX/VIX3M ≥ 1.0 | **Backwardation** — near-term stress | Since 2010: ~7.6 % of days, 103 episodes, median length 2 days, mean 3.1 days; SPY averaged −0.67 % during episodes (thetrading.tools). Backwardation persisting 5+ days is a "structural headwind" for short vol | **No new short-premium entries** while VIX/VIX3M ≥ 1.0. Re-enable after 2 consecutive closes < 0.95 |
| VIX/VIX3M < 0.80 | Steep contango / complacency | No sourced threshold; steep contango coincides with the low-VIX regime in §1 | Allowed, but apply the low-VIX credit-quality checks |

Sanity check: thetrading.tools states "VIX9D is too noisy for regime detection" — use VIX/VIX3M for the *regime*, VIX9D/VIX for the *fast* event signal below.

### 2.2 VIX9D / VIX — fast event/stress crossover

- Normal range 0.80–1.20 over an 8-year sample; rarely outside it (Volatility Trading Strategies).
- VIX9D > VIX (ratio > 1.0) means the next 9 days are priced more volatile than the next 30 — either an event (FOMC, CPI, NFP, major earnings cluster) inside the 9-day window or a sell-off underway.
- **Bot rule:** ratio > 1.0 → treat the coming 7–9 days as "event-loaded": either skip short-premium entries that expire inside the window, or require short strikes beyond the event-implied move (ATM straddle of the expiry containing the event). Ratio > 1.10 → no new short-premium entries. Ratio < 0.90 after an event → IV crush has occurred; new credits will be thin but gamma risk is lower.

### 2.3 VVIX — volatility of VIX

| VVIX | Interpretation (SpotGamma; Cboe) | Bot rule |
|---|---|---|
| < 80 | Very low vol-of-vol; VIX options cheap; complacency. Cboe: VVIX has "rarely dropped below 80" since May 2010 | Allowed; low VVIX + low VIX = expect thin credits |
| 80–100 | Normal (long-run mean ≈ 85–95 SpotGamma; ≈ 86 mean, 60–145 range 2006–2012 per Cboe) | Go |
| 100–120 | Elevated — hedgers buying VIX upside | Caution: reduce size 50 %, 10–12Δ strikes |
| > 125 | High stress; "options market pricing significant VIX swings". SpotGamma stat: after VVIX > 125 closes, SPY was positive 70 % of the time over 5–20 days and VIX fell ~80 % of the time | **No new entries on the day VVIX crosses > 125.** Once VVIX has *fallen* back below 120 from a >125 print with VIX also declining, this is historically a favourable short-premium entry (mean reversion) — allow at half size |
| > 150 | Rare, acute stress | No new entries |

A VVIX spike while VIX is flat is a divergence: hedgers are pre-positioning. Treat as "caution" even if VIX looks calm.

---

## 3. IV rank, IV percentile, and the variance risk premium

### 3.1 Definitions (TradingBlock; Volatility Box; tastytrade default)

- **IV Rank (IVR)** = (Current IV − 52-week IV low) ÷ (52-week IV high − 52-week IV low) × 100. Sensitive to a single spike: after a crash, IVR reads low for a year even when IV is above normal.
- **IV Percentile (IV%ile)** = (number of days in the past year with IV below today's IV) ÷ (total trading days) × 100. Smoother; not distorted by one extreme.
- tastytrade shows IVR and IV% on the platform; its default guidance (as summarised by Volatility Box) is **sell premium when IVR > 50, buy when IVR < 30**. TradingBlock: IVR > 50 sell / < 25 buy; IV%ile > 75 sell / < 25 buy. Volatility Box: require **IVR > 30 AND IV%ile > 50** for any short premium; IVR > 50 & IV%ile > 50 for condors.

### 3.2 Evidence — disagreement, stated

| Source | Finding |
|---|---|
| Volatility Box backtest (595 symbols) | Iron condors entered with IVR > 50 and IV%ile > 50: **56.8 % win rate vs 48.2 %** unfiltered |
| SJ Options (SPX 10Δ/7Δ put spreads, 30 DTE, 2005–2015, held to expiry) | **Low IVR entries lost 27 % less** on average losers, winners ~unchanged; "no advantage to high IV rank entry signals"; rising IV came with more directional risk |
| SJ Options (tastytrade-style SPX verticals, 45 DTE, IVR 50–100, 50 % winners, 2× stop, 2005–2016) | 61 % win rate but net losses in 7 of 11 years |
| Cboe (VRP white paper) | VIX averaged 19.3 vs S&P realized 15.1, 1990–2018 → **4.2-pt average VRP** — the structural reason selling premium works at all |

Bot interpretation: IVR is a **credit-adequacy filter** (high IVR = enough premium to meet the ≥ 15–25 % credit/width test), not a proven stand-alone edge. The edge is the VRP; the risk is that high IVR often coincides with trending/gapping markets. Therefore combine IVR with the VRP check (§3.3) and the trend/gamma filters (§5, §7).

### 3.3 Implied vs realized — the VRP check

VRP = 30-day IV (or VIX for SPY) − trailing 20–30-day realized vol (annualised close-to-close std × √252). Thresholds (GEXRadar; long-run VRP ≈ 3–5 pts on SPX; Cboe 4.2 pts):

| VRP (IV − RV, pts) | Meaning | Bot rule |
|---|---|---|
| > 6 | Wide — "short-vol setup"; high historical hit rate | **Go** (sell premium) |
| 3–6 | Normal — no edge from VRP alone | Go if other filters pass |
| 0–3 | Narrow — premium eroded; "better to be flat than short" | **No new credit spreads/condors**; debit spreads allowed |
| < 0 | Inverted — realized > implied; long-vol setup | **No short premium.** Debit spreads / long butterflies only |

Realized-vol trend rule: if 5-day realized vol > 30-day implied vol, the market is currently moving *more* than priced → treat as VRP < 0 for entry purposes even if the 30-day VRP looks positive.

### 3.4 Bot IV rules (combined)

| Structure | Required |
|---|---|
| Credit spread | IVR ≥ 30 **and** IV%ile ≥ 50 **and** VRP ≥ 3 |
| Iron condor | IVR ≥ 30 (prefer ≥ 50) **and** IV%ile ≥ 50 **and** VRP ≥ 3 **and** trend filter = range (§5) |
| Debit spread / long butterfly | IVR ≤ 30 preferred (≤ 50 allowed) and a directional/level thesis |
| Any short premium | Reject if IV%ile ≥ 95 (top-5 % IV = active crisis; wait for the VIX-peaked condition in §1) |

---

## 4. Expected move and strike placement

EM(1 SD) = S × IV × √(DTE/365) (StrikeWatch; projectoption). Straddle shortcut: EM ≈ ATM straddle, or 0.85 × straddle for a skew-corrected 1 SD. Full table and worked example in 03-greeks §6.

| DTE | SPY 650, IV 16 % — 1-SD EM |
|---|---|
| 14 | ± $20.37 (3.13 %) |
| 7 | ± $14.40 (2.22 %) |
| 3 | ± $9.43 (1.45 %) |

Rules:
- Credit spreads / condor short strikes **at or outside 1 SD** (Δ ≈ 0.16, ~84 % OTM); in VIX 20–30 use 1.5 SD (Δ ≈ 0.07).
- If a scheduled event falls inside the hold, the relevant EM is the **event-inclusive straddle** for that expiry, and strikes must be outside it.
- Re-evaluate each session with the EM of the **remaining** DTE.
- Sanity check the chain: if the chain's 16Δ strike is inside the calculated 1-SD, skew/term structure is inflating deltas — use the further strike.

---

## 5. Trend / regime filters (which structure to use)

Sources: CrossTrade and Option Samurai for ADX bands; StockCharts and thetrading.tools for MA-based breadth; structural logic for MA stack.

### 5.1 Price vs moving averages (daily, on the traded underlying)

| Condition | Regime label | Structure bias |
|---|---|---|
| Price > 20-SMA > 50-SMA > 200-SMA, higher highs & higher lows over last 10 sessions | **Uptrend** | Put credit spreads (bullish), call debit spreads. Call credit spreads / condors only with call side ≥ 1.5 SD |
| Price < 20-SMA < 50-SMA, lower highs & lower lows | **Downtrend** | Call credit spreads, put debit spreads. Put credit spreads only after VIX-peaked condition (§1) |
| 20-SMA and 50-SMA within ±1 % of each other and price crossing them repeatedly (≥ 3 crosses in 10 sessions) | **Range** | Iron condors, iron butterflies, neutral butterflies |
| Price > 200-SMA but < 50-SMA | Pullback in uptrend | Put credit spreads at 1–1.5 SD after a down-day close ≥ 1 SD (mean-reversion entry); no call credit spreads |
| Price < 200-SMA and 50-SMA < 200-SMA ("death cross") | Bear regime | Halve size on all short premium; VIX rules dominate |

### 5.2 ADX(14) (CrossTrade bands; Option Samurai uses 20 as the trend/range line)

| ADX | State | Structure bias |
|---|---|---|
| < 20 | No trend / range-bound | **Iron condors favoured** (Option Samurai: low-ADX periods lasted ~10–11 days on their examples, price typically within ±2 %) |
| 20–25 | Emerging trend | Condors allowed with the trending side at 1.5 SD; verticals in the +DI/−DI direction |
| 25–40 | Established trend | Directional verticals in trend direction; **no condors** |
| > 40 | Strong trend — "don't fade it" | Only trend-direction credit spreads (e.g. put credit spreads in a strong uptrend); no counter-trend credit spreads |
| > 50 | Extreme / often exhausting | Reduce size; no new entries until ADX turns down |

Bot rule: condors require ADX < 25 **and** the MA-stack "Range" or shallow-trend label; a condor in an ADX > 25 market must instead be expressed as a single vertical on the side away from the trend.

---

## 6. Breadth, sentiment and positioning

### 6.1 Market breadth (S&P 500 constituents)

| Indicator | Thresholds (sources) | Bot use |
|---|---|---|
| % of S&P 500 stocks above 50-day MA | StockCharts: > 70 % overbought, < 30 % oversold, 50 % = bull/bear line. thetrading.tools: > ~80 % overbought (precedes consolidation), < ~20 % washout (precedes durable lows), 40–60 % = no signal. Schwab: 80 % = broad rally, < 10 % = selling exhaustion. **Range across sources: overbought 70–80 %, oversold 20–30 %** | > 75 %: avoid new put credit spreads at < 1.5 SD (upside crowded, but mean-reversion risk is *down*); condors OK. < 25 %: washout — no new call credit spreads; put credit spreads only after a VIX-peaked confirmation. 40–60 %: ignore |
| % above 200-day MA | > 50 % supports long exposure; < 40 % rallies are narrow and prone to failure (thetrading.tools) | < 40 %: downgrade any "Uptrend" label to "Pullback/Bear" for structure selection |
| Advance/Decline line vs index | Divergence (index up, A/D down) = "underlying weakness" (StockCharts); A/D measures direction, MA-breadth measures level; both deteriorating together is the strong signal (thetrading.tools) | Index at new 20-day high with A/D line below its own 20-day high for ≥ 5 sessions → treat as "Range/late-trend": no new put credit spreads inside 1.5 SD |
| New 52-week highs vs lows | New lows > new highs while index is near highs = fragility (Schwab framing) | Same as A/D divergence rule |
| Forward-return context | 50d/200d breadth ratio < 0.50 (washout): SPX +2.5 % median over 20 days, 85 % of episodes positive; ratio > 1.50 (thrust): +5.4 % median, 80 % positive (thetrading.tools) | After washouts and thrusts, favour **bullish** verticals over condors — the market tends to trend up out of both |

### 6.2 Put/call ratio (CBOE)

| Series | Thresholds (StockCharts) | Reading |
|---|---|---|
| Total P/C ($CPC) | < 0.70 = excessive bullishness (bearish extreme); > 1.20 = excessive bearishness (bullish extreme); 200-day avg ≈ 0.91. 10-day SMA: > 0.95 then back below = bullish; < 0.80 then back above = bearish, "wait for confirmation" | Contrarian, slow. > 1.20 spike days often mark short-term lows — favours put credit spreads once VIX also stops rising. < 0.70 = complacency — avoid tight call credit spreads? No: complacency risk is *downside*; keep put side ≥ 1 SD and prefer condors |
| Equity-only ($CPCE) | 200-day avg ≈ 0.61 (call-skewed); no fixed extremes published by StockCharts; extremes "change over time" | Use 1-year percentile: > 90th %ile = fear extreme; < 10th %ile = greed extreme |
| Index ($CPCI) | 200-day avg ≈ 1.41 (hedging-skewed) | Institutional hedging gauge; a sharp rise with VIX rising = risk-off confirmation |

Bot rule: P/C is a **tie-breaker only**. Never override VIX/term-structure/gamma rules with it.

### 6.3 CBOE SKEW index and put skew

- SKEW prices the relative cost of far-OTM SPX puts. 100 = lognormal; historical average ≈ 123; 1990s baseline ~115; **since 2014 it lives in the 140s–150s**; record high 183 (Feb 2025), record low 101 (thetrading.tools). Sept 2026 print 154.5 = 96th percentile trailing year.
- Predictive value for drawdowns: thetrading.tools' per-era analysis found the sign of the relationship flips by decade — "It is not a signal." Schaeffer's has made the same point about the "Black Swan indicator". **Bot: do not use SKEW level as a go/no-go.**
- What skew *does* change: put-spread credits and deltas. High skew fattens far-OTM put premium → 10–16Δ put spreads pay relatively more and call spreads relatively less. Practical rule: when SKEW > 150, favour put credit spreads at ≥ 1.5 SD over symmetric condors (the put side is where the premium is; the call side pays little).

### 6.4 Dealer gamma exposure (GEX) — SpotGamma framework

Definitions (SpotGamma): **Zero Gamma / gamma flip** = "the stock price at which dealers are estimated to switch from a net positive gamma position to a net negative gamma position". **Volatility Trigger™** = SpotGamma's level *above* zero gamma where "dealers flip to short gamma" and amplification begins — described as their most actionable level.

| Regime | Dealer behaviour | Market character (SpotGamma; Options Analysis Suite) | Bot rule for 7–14 DTE spreads |
|---|---|---|---|
| **Positive gamma** (spot above Vol Trigger / Zero Gamma) | Counter-cyclical: "sell the rip, buy the dip" | "Intraday ranges compress", VIX drifts lower, "Breakouts fade quickly" — mean-reverting | **Go** for condors and 16Δ credit spreads. Short strikes may sit at 1 SD; call wall / put wall are useful strike anchors (place short strikes beyond them) |
| **Negative gamma** (spot below Vol Trigger) | Pro-cyclical: sell into declines, buy into rallies | "Intraday ranges expand sharply", "VIX spikes are common", "Breakouts and breakdowns accelerate"; realized vol "structurally higher" and tends to exceed priced vol (OAS) | **No new iron condors.** Credit spreads only in the direction of the trend, ≥ 1.5 SD, half size, and only if VIX/VIX3M < 1.0. Loss stop at mark ≥ 1.5× credit (loss = 0.5× credit) instead of the standard 2× |
| Spot within ±0.5 % of the flip level | Fragile / regime boundary | Distance from spot to flip is the fragility metric (OAS) | No new entries until spot is ≥ 1 % clear on either side |

Why it matters: in negative gamma, short-gamma spreads face exactly the days the Black-Scholes model under-prices (large ranges, gap continuation). In positive gamma, dealer hedging suppresses the realized vol — that is the regime where the VRP is most reliably harvested. Note 0DTE flows now exceed 50 % of SPX volume (SpotGamma), so intraday gamma regimes can flip faster than daily models suggest.

Data sources for the bot: SpotGamma (paid), or compute a proxy GEX from open interest × gamma per strike (many free implementations; sign convention assumptions vary — treat any home-built GEX as approximate and use the *sign* and the *flip level*, not the magnitude).

---

## 7. Key levels, volume, and expiration pinning

### 7.1 Levels the bot records daily

| Level | Use |
|---|---|
| Prior day high / low; prior week high / low | A short strike inside the prior week's range is "inside the noise" — require ≥ 1 SD *and* outside prior-week range for credit spreads |
| Weekly / monthly open | Mean-reversion reference in range regimes |
| Round numbers (SPY $5/$10 increments, SPX 50/100) and high-OI strikes (call wall / put wall) | Dealer hedging clusters here; prefer short strikes just *beyond* a wall, not just inside it |
| 20/50/200-day SMA | Trend labels (§5); also act as support/resistance — avoid a short put strike sitting 0.5–1 % above a rising 50-SMA (price tends to test it) |
| Expected-move boundaries for the current and next expiry | Strike placement (§4) |

### 7.2 Max pain near expiration

Evidence (Advanced AutoTrades, 100 SPX expirations): SPX settled within ±1 % of max pain 48 % of the time (±0.5 %: 22 %; ±2 %: 68 %); SPY only 37 %; accuracy fell from 57 % (VIX < 15) to 29 % (VIX > 22). Their conclusion: a "soft gravitational pull", useful only as a secondary filter for defined-risk spreads.

Bot rule: max pain is a **tie-breaker for butterfly body placement in the last 3 DTE only** and is ignored when VIX > 22. It is never a reason to hold a short strike that is tested.

### 7.3 Volume / relative volume

RVOL = current volume ÷ 50-period average volume (StockCharts). 1.1 = not significant; ≥ 2.0 = the level many day traders require to act; ≥ 4.0 = spike, "may signal a trend reversal rather than continuation".

Bot rule: a session with RVOL ≥ 2.0 on SPY **and** a close outside the prior day's range = an expansion day → no new condor entries that session and the next; re-check the gamma regime (§6.4). RVOL < 0.7 (holiday-type sessions) → wider bid/ask; require mid-price fills or skip.

---

## 8. Cross-asset risk-off signals (brief)

| Signal | Source facts | Bot rule |
|---|---|---|
| High-yield OAS (FRED BAMLH0A0HYM2) | thetrading.tools uses rolling z-scores rather than fixed bps: TIGHT ≥ +1σ (risk-on), NORMAL ±1σ, WIDE −1σ to −2σ (risk-off, spreads widening), STRESS ≤ −2σ. HY OAS 2.70 % on 2026-09-10; GFC peak ≈ 21.8 % (Nov 2008); OAS started widening months before the Oct-2007 equity peak | HY OAS rising ≥ 50 bps over 10 sessions, or z-score crossing below −1σ, = risk-off: halve short-premium size, no put credit spreads inside 1.5 SD. HY and CCC widening together strengthens the signal |
| 10-year yield / dollar (DXY) | No thresholds fetched; direction matters more than level for 7–14 DTE | A 10-session move in 10-yr yield ≥ +40 bps or DXY ≥ +3 % → expect QQQ/IWM to underperform; downgrade to "caution" on those underlyings |
| Sector rotation / correlation | SPY–QQQ correlation ≈ 0.93 (0.87–0.94 across horizons); SPY–IWM ≈ 0.79 (0.78–0.85) (PortfoliosLab). Correlations "rise meaningfully" in the elevated-VIX regime (Volatility Box) | **Treat SPY, QQQ and IWM condors as one position** for the theta/vega/delta caps in 03-greeks §4.2. A "diversified" book of three index condors is one condor sized 3×. When VIX > 20 assume correlation → 1 |

---

## 9. Scheduled-event calendar (binary events inside the 7–14 DTE hold)

| Event | Rule |
|---|---|
| FOMC decision (and press conference), CPI, NFP, PCE | No new short-premium entries in the 24 h before; open positions must have short strikes beyond the event straddle or be closed before. Expect VIX9D/VIX > 1.0 ahead of these (§2.2) |
| Monthly OPEX (3rd Friday), quarterly triple witching | Gamma regime shifts as large OI expires; re-run §6.4 on the Monday after |
| Index rebalances, holiday half-days | Low RVOL → wide markets; skip entries |
| Single-stock earnings | Not applicable to index ETFs, but mega-cap earnings weeks raise QQQ realized vol — apply "caution" on QQQ structures |

---

## 10. Pre-trade market checklist

Run in order; stop at the first NO-TRADE.

| # | Check | GO | CAUTION (half size, 10–12Δ / 1.5 SD, credit spreads only) | NO-TRADE |
|---|---|---|---|---|
| 1 | VIX level | 15–20 | 12–15 or 20–30 | > 30 while rising (above 5-day SMA); or 1-day change ≥ +20 % / +5 pts |
| 2 | VIX / VIX3M | < 0.95 | 0.95–1.0 | ≥ 1.0 (backwardation) |
| 3 | VIX9D / VIX | < 1.0 | 1.0–1.10 with strikes beyond event straddle | > 1.10 |
| 4 | VVIX | < 100 | 100–120 | > 125 on the crossing day; > 150 always |
| 5 | Underlying IVR / IV%ile | IVR ≥ 30 & IV%ile ≥ 50 (short premium) ; IVR ≤ 30 (debit) | IVR 20–30 for short premium only if VRP > 6 | IV%ile ≥ 95 |
| 6 | VRP (IV − 20-day RV) | ≥ 3 pts and 5-day RV < IV | 0–3 pts | < 0, or 5-day RV > IV |
| 7 | Dealer gamma regime | Positive (above Vol Trigger) and ≥ 1 % away from flip | Negative but trend-aligned vertical only | Within ±0.5 % of flip; negative gamma + backwardation |
| 8 | Scheduled events in hold window | None | Event present but short strikes beyond event straddle | Entry within 24 h before FOMC/CPI/NFP |
| 9 | Trend / ADX | Structure matches regime table (§5) | Mixed signals → use the more conservative structure | Condor requested while ADX > 25 |
| 10 | Breadth extremes | 30–70 % above 50-SMA | > 75 % or < 25 % (bias structure per §6.1) | — (breadth alone never blocks) |
| 11 | Credit quality | Credit ≥ 33 % of width | 25–33 % (allowed only with IVR ≥ 30 and short Δ ≤ 0.20, per 02 T4) | < 25 % of width |
| 12 | Portfolio caps (03-greeks §4.2) | Within caps after this trade | — | Any cap breached (Δ > 4, Θ > $12.50/day, vega > $15/pt, correlated-book rule) |
| 13 | Liquidity / RVOL | Bid/ask ≤ 10 % of spread mid; RVOL 0.7–2.0 | RVOL 2–4 (wait a session for condors) | RVOL < 0.5 (illiquid session) or bid/ask > 20 % of mid |

---

## 11. Regime → strategy mapping

| Regime (composite) | Definition | Preferred structures | Strike / size | Avoid |
|---|---|---|---|---|
| **Calm range** | VIX < 15, contango, ADX < 20, positive gamma, VRP 3–6 | Iron condor (only if credit ≥ 25 % of wing width), iron butterfly, neutral butterfly | 16Δ, full size; use the 12–14 DTE end of the window to get enough credit | Any credit structure paying < 25 % of width |
| **Normal range** | VIX 15–20, contango, ADX < 25, positive gamma | Iron condor, 16Δ credit spreads on the side away from any mild trend | 16Δ / 1 SD, full size, 50 % profit, 2× loss stop, close ≤ 2 DTE | Debit spreads (vega too rich relative to low-IVR regime — unless IVR < 30) |
| **Normal uptrend** | VIX 15–20, ADX 25–40, price > 20 > 50 > 200 SMA | Put credit spreads at 1–1.5 SD; call debit spreads on pullbacks to 20-SMA | 16Δ put side; call side of condors ≥ 1.5 SD or omitted | Symmetric condors; call credit spreads inside 1.5 SD |
| **Normal downtrend** | VIX 18–25, ADX 25–40, price < 20 < 50 SMA, negative gamma likely | Call credit spreads at 1–1.5 SD; put debit spreads | 10–16Δ call side, half size | Put credit spreads until VIX peaks; condors |
| **Elevated vol, contango holds** | VIX 20–30, VIX/VIX3M < 1.0, VRP > 6 | Credit spreads at 1.5 SD; condors only if ADX < 20 and positive gamma | 7–10Δ, half size, loss stop at mark ≥ 1.5× credit | Full-size anything; 30Δ "aggressive" spreads |
| **Stress** | VIX/VIX3M ≥ 1.0 or VVIX > 125 rising or VIX > 30 rising | **Nothing new.** Manage existing per 03-greeks §5 | — | All entries |
| **Post-peak recovery** | VIX has closed lower ≥ 2 sessions from a > 30 print, VVIX falling below 120, term structure flattening toward contango, VRP > 10 | Put credit spreads at 1.5 SD (VRP is largest here), 7–10 DTE | 10Δ, half size, 50 % profit target reached quickly as IV mean-reverts | Call credit spreads (rip risk); condors until VIX/VIX3M < 1.0 |
| **Low-IV grind** | VIX < 13, IVR < 20, VRP 0–3 | Debit spreads / long butterflies at levels; or stand aside | Debit ≤ 50 % of width; net Δ within cap | Credit spreads (credit fails R12; VRP absent) |
| **Event week** | FOMC/CPI/NFP inside hold, VIX9D/VIX > 1.0 | Only if strikes beyond the event straddle; otherwise wait for post-event IV crush and enter the day after | 10Δ | Entries within 24 h before the event |

---

## Sources

- Volatility Box — Volatility regimes explained (VIX bands, frequencies, strategies per regime): https://volatilitybox.com/research/volatility-regimes-explained/
- thetrading.tools — VIX term structure tracker (VIX/VIX3M definition, 92 % contango, 7.6 % backwardation days, 103 episodes, SPY −0.67 %, VIX9D "too noisy"): https://www.thetrading.tools/vix-term-structure
- Raven Quant — VIX term structure (VIX3M/VIX − 1 slope; contango > 80 % of time since 2010): https://ravenquant.com/vix-term-structure/
- Volatility Trading Strategies — VIX9D:VIX ratio (0.80–1.20 normal range, > 1.0 = rising vol): https://www.volatilitytradingstrategies.com/blog/vts-volatility-dashboard-metric-7-vix9d-vix-ratio-fast-crossover
- SpotGamma — VVIX explained (80/100/125/150 bands; VVIX > 125 forward stats): https://spotgamma.com/vvix-explained-what-the-volatility-index-tells-traders/
- Cboe — Double the Fun with Cboe's VVIX Index (VVIX 60–145 range, mean 86; rarely < 80 since 2010): https://cdn.cboe.com/resources/indices/documents/vvix-termstructure.pdf
- TradingBlock — IV rank vs IV percentile (formulas; IVR > 50 sell / < 25 buy; IV%ile > 75 sell): https://www.tradingblock.com/blog/iv-rank-vs-iv-percentile
- Volatility Box — IV rank vs IV percentile (dual-filter rule; 56.8 % vs 48.2 % condor win rate; tastytrade default IVR > 50 / < 30): https://volatilitybox.com/research/iv-rank-vs-iv-percentile/
- SJ Options — High vs low IV rank credit spreads (low IVR losers 27 % smaller; no high-IVR advantage): https://www.sjoptions.com/high-iv-rank-vs-low-iv-rank-credit-spreads/
- SJ Options — Tastytrade credit spreads 11-year backtest (61 % win rate, negative returns): https://www.sjoptions.com/tastytrade-credit-spreads-do-they-work/
- Cboe — Volatility risk premium white paper (VIX 19.3 vs realized 15.1, 1990–2018): https://www.cboe.com/insights/posts/white-paper-shows-volatility-risk-premium-facilitated-higher-risk-adjusted-returns-for-put-index/
- GEXRadar — Realized vs implied vol / VRP thresholds (> 6 sell, 3–6 neutral, 0–3 avoid, < 0 buy; long-run 3–5 pts): https://gexradar.io/blog/realized-vs-implied-vol-premium
- StrikeWatch — Expected move formula and SD/delta table: https://www.strike-watch.com/lab/expected-move-options-implied-volatility-range
- projectoption — Expected move calculator: https://projectoption.com/expected-move-calculator
- projectfinance — Iron condor management, 71,417 trades (VIX-regime results): https://www.projectfinance.com/iron-condor-management/
- CrossTrade — ADX bands (< 20 range, 20–25 emerging, 25–40 established, > 40 strong, > 50 extreme): https://crosstrade.io/learn/technical-indicators/adx
- Option Samurai — Backtesting iron condors with ADX (ADX 20 as trend/range line): https://optionsamurai.com/blog/backtesting-iron-condor-strategies-with-the-adx-indicator/
- StockCharts ChartSchool — Percent above moving average (70/30 overbought-oversold, 50 % line): https://chartschool.stockcharts.com/table-of-contents/market-indicators/percent-above-moving-average
- thetrading.tools — Market breadth (80/20 on 50-day, 50/40 on 200-day, A/D cross-check, washout/thrust forward returns): https://www.thetrading.tools/market-breadth
- Charles Schwab — Breadth check (80 % above 50-day = broad rally; < 10 % = exhaustion): https://www.schwab.com/learn/story/breadth-check-strength-and-weakness-trend-tracker
- StockCharts ChartSchool — Put/Call ratio (0.70 / 1.20 extremes; 10-day SMA 0.80/0.95; 200-day averages by series): https://chartschool.stockcharts.com/table-of-contents/market-indicators/put-call-ratio
- thetrading.tools — CBOE SKEW index (average 123, modern 140s–150s, record 183/101, no reliable predictive signal): https://www.thetrading.tools/skew-index
- SpotGamma — Gamma exposure explained (positive/negative gamma regimes, Volatility Trigger, Zero Gamma, 0DTE > 50 % SPX volume): https://spotgamma.com/gamma-exposure-explained/
- SpotGamma Support — Gamma Flip definition: https://support.spotgamma.com/hc/en-us/articles/15413261162387-Gamma-Flip
- Options Analysis Suite — Negative gamma documentation (realized vol structurally higher; distance-to-flip as fragility): https://www.optionsanalysissuite.com/documentation/negative-gamma
- Advanced AutoTrades — Max pain tested on 100 SPX expirations (48 % within ±1 %; 57/49/29 % by VIX band; SPY 37 %): https://advancedautotrades.com/does-max-pain-really-work/
- StockCharts ChartSchool — Relative Volume (RVOL formula; 1.1 / 2.0 / 4.0 levels): https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-volume-rvol
- thetrading.tools — Credit spreads tracker (HY OAS z-score regimes; 2.70 % on 2026-09-10; GFC lead and peak): https://www.thetrading.tools/credit-spreads
- PortfoliosLab — SPY vs QQQ correlation 0.93: https://portfolioslab.com/tools/stock-comparison/SPY/QQQ
- PortfoliosLab — IWM vs SPY correlation 0.79: https://portfolioslab.com/tools/stock-comparison/IWM/SPY
- tastylive — How much delta and theta (portfolio caps referenced from 03-greeks): https://www.tastylive.com/news-insights/how-to-put-delta-and-theta-to-work

Unsourced / structural rules in this file (author's operational choices, not cited): the VIX "+20 % / +5 pt" one-day change rule; the "2 consecutive closes < 0.95" re-enable rule; the 24-hour pre-event blackout; the 10-yr yield +40 bps / DXY +3 % thresholds; the "±0.5 % / 1 % from gamma flip" bands; the RVOL 0.5/0.7 illiquidity cut-offs; the 50-bps/10-session HY OAS rule; and the MA-stack regime labels. They are conservative defaults meant to be tuned by backtest.
