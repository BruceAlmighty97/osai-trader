# Market Hours & Scheduling

Requirements for the cron/orchestration layer (not built yet). The watchlist is ETFs trading standard US equity hours.

## Trading window (options-driven)

- **Options trade the regular session only: 9:30 AM – 4:00 PM ET.** No extended-hours options (the ETF *shares* trade pre/after-hours, but the options don't). Orders can only fire in this window.
- Broad-based ETF options (SPY/QQQ/IWM) historically close ~4:15 PM ET vs 4:00 for GLD/TLT/SLV — don't rely on it; verify contract specs if trading near the bell.
- **Avoid the edges:** skip the first ~15–30 min (opening auction, wide spreads) and the last ~15 min (closing volatility). Practical window ≈ **10:00 AM – 3:45 PM ET** (tightest spreads, most reliable pricing).

## Scheduler requirements

- Run in **Eastern Time** and handle **DST** — schedule in ET, not fixed-offset UTC, or it drifts an hour twice a year.
- Gate on a real **NYSE trading-calendar check** — full holidays AND early-close half-days (1:00 PM ET: day after Thanksgiving, Christmas Eve, sometimes July 3). "Is it a weekday" is insufficient. (July 3 2026 being a holiday is literally why our first market-data tests came back dead.)

## Two cadences

1. **Frequent — position management:** deterministic exit-rule checks on open positions (from our DB + live quotes). Runs often (e.g. every 15–30 min).
2. **Infrequent — watchlist scan:** the AI entry pipeline, 1–2×/day.

## Sandbox data caveat

The tastytrade sandbox feed is **~15-min delayed** and only live during regular trading hours — quotes are stale/frozen outside RTH and on holidays. That's a data limitation, not a bug. It's fine for validating the flow; delayed prices just mean the AI reasons over ~15-min-old data.
