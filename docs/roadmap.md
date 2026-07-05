# Roadmap & Open Items

## Next build steps (in order)

1. **`/strategy/scan`** — turn the single-symbol `suggest` into the candidate pipeline: watchlist (start hardcoded: SPY, QQQ, IWM, GLD, TLT, SLV) → parallel `suggest` per symbol → deterministic ranking (credit/risk, correlation bucketing) → return top-N candidates. *Makes candidate + strategy selection tangible; cheap (reuses `suggest`).*

2. **Persistence layer** — the durable memory. `decisions` / `orders` / `positions` entities → `npm run migration:generate --name=InitPersistence` → `migration:run`. Port field designs from the old IBKR entities in git history (`git show 1197b3b:service/src/modules/strategy-engine/strategy-decision.entity.ts`, etc.). *Foundation for management, P&L, and the cron loop.*

3. **Risk gate** — deterministic pre-trade validation (position size, portfolio limits, loss limits, buying power, kill switch). Port the concept + parameters from the IBKR risk module (`git show 1197b3b:service/...`) and `docs/risk-parameters.md`. Re-seed limits for the actual account size (e.g. $1k → max 1–2 positions, ~$80 max risk/trade). *The layer the AI can never override.*

4. **Execution** — wire the real multi-leg order submit behind a `TT_ALLOW_LIVE_ORDERS` flag (dry-run is already proven). Sandbox first.

5. **Position management** — the frequent exit loop: read holdings from our DB, fetch live leg quotes, apply exit rules (50% profit / 21 DTE / 2× loss), close via DB update + order. Handle the sandbox "broker doesn't have this position" case.

6. **Cron orchestration** — the market-hours-aware scheduler (see market-hours-scheduling.md): ET/DST, 10:00–3:45 window, NYSE calendar gate, two cadences.

7. **AWS ECS deployment** + OAuth2 auth for production.

## Open items / watch-outs

- **Push pending:** commit `cd1f20c` is committed but not pushed to `origin/main`.
- **Stray file:** an empty `README.md` at repo root (untracked) — delete or fill it.
- **market-metrics 502s in sandbox** — IV rank unavailable until production; the pre-filter that needs it is deferred.
- **No earnings calendar** — blocks adding single-name (mega-cap) candidates safely. Needed before expanding past ETFs.
- **Real-time market data** — sandbox is ~15-min delayed; production trading needs a real-time subscription (was a known requirement in the IBKR era too).
- **OAuth2** — replace session auth for unattended production (avoids MFA/session friction — the whole reason we left IBKR).
- **Legacy `service/`** — removed from working tree, lives in git history at `1197b3b`; use it as reference, don't revive it.

## Reference: what's in the old IBKR `service/` (git history) worth porting

- `risk-management/` module + `docs/risk-parameters.md` → the risk gate.
- `strategy-decision.entity.ts`, `strategy-tool-call.entity.ts`, `order.entity.ts` → persistence table designs.
- `portfolio/` reconciliation approach → position management.
- Two-agent pattern (analysis + execution review) — deferred; single agent first.
