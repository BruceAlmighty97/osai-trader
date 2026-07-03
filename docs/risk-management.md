# Risk Management

## Hard Guardrails (Non-Negotiable, AI Cannot Override)

### Position Limits
- Max position size per underlying (contracts)
- Max notional exposure per trade
- Max number of open positions

### Portfolio Limits
- Max portfolio delta exposure
- Max portfolio gamma exposure
- Max buying power utilization percentage
- Max total portfolio margin usage

### Loss Limits
- Max daily realized loss — halt all new trades for the day
- Max weekly realized loss — halt and notify for manual review
- Max unrealized loss per position — trigger auto-close
- Max drawdown from peak equity — full stop, close all positions

### Operational Safeguards
- Circuit breaker: kill switch that closes all activity immediately
- Stale data guard: reject trades if market data is older than N seconds
- Duplicate order detection: prevent double-submissions
- Market hours enforcement: no orders outside trading hours
- Assignment handling: detect and respond to early assignment events

## Pre-Trade Checks
1. Position size within limits
2. Sufficient buying power / margin
3. Portfolio greeks within bounds after proposed trade
4. No conflicting open orders
5. Market data freshness validated
6. Daily loss limit not breached

## Post-Trade Monitoring
1. Fill confirmation and reconciliation
2. Updated portfolio greeks calculation
3. P&L tracking and limit checks
4. Position expiration monitoring

## Audit Trail
- Every AI decision logged with full context (prompt, reasoning, tool calls)
- Every order logged with timestamps and status changes
- Every risk check logged with pass/fail and values
- Daily summary reports
