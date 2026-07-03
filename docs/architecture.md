# OsaiTrader Architecture

## Overview

OsaiTrader is an automated options strategy trading system that connects to Interactive Brokers (IBKR) and uses Claude AI as a decision-making agent. It runs as a containerized service in AWS.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                    AWS ECS Fargate                   │
│                                                     │
│  ┌──────────────────────┐  ┌─────────────────────┐  │
│  │   NestJS Service     │  │   IB Gateway        │  │
│  │                      │  │   (Sidecar)         │  │
│  │  ┌────────────────┐  │  │                     │  │
│  │  │ Market Data    │◄─┼──┤  TWS API Socket     │  │
│  │  │ Module         │  │  │  (port 4001/4002)   │  │
│  │  ├────────────────┤  │  │                     │  │
│  │  │ Strategy       │  │  └─────────────────────┘  │
│  │  │ Engine (Claude)│  │                           │
│  │  ├────────────────┤  │  ┌─────────────────────┐  │
│  │  │ Order Mgmt     │──┼─►│  RDS Postgres       │  │
│  │  ├────────────────┤  │  │  (Trade History,    │  │
│  │  │ Risk Mgmt      │  │  │   Audit Log,        │  │
│  │  ├────────────────┤  │  │   Positions)        │  │
│  │  │ Portfolio       │  │  └─────────────────────┘  │
│  │  ├────────────────┤  │                           │
│  │  │ Scheduling      │  │  ┌─────────────────────┐  │
│  │  └────────────────┘  │  │  CloudWatch         │  │
│  │                      │  │  (Monitoring/Alerts) │  │
│  └──────────────────────┘  └─────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Core Modules

### Market Data Module
- Streams real-time quotes, options chains, greeks, and implied volatility from IBKR
- Normalizes raw IBKR data into clean internal formats
- Validates data freshness before passing to the strategy engine
- Handles IBKR API rate limiting with request queuing

### Strategy Engine Module (Claude Agent)
- Uses Claude SDK with tool use to reason about market conditions and make trade decisions
- Receives: market state, current positions, P&L, account info, greeks
- Outputs: trade decisions (open, close, adjust positions)
- Two-agent pattern:
  - **Analysis Agent**: generates trade ideas based on market conditions and strategy rules
  - **Execution Review Agent**: validates proposed trades against risk parameters

### Order Management Module
- Translates AI decisions into IBKR order objects
- Submits orders and tracks status (pending, filled, partial, cancelled)
- Handles partial fills, amendments, and cancellations
- Manages order lifecycle events

### Risk Management Module
- Hard guardrails independent of the AI agent — can veto any trade
- Enforces: max position size, max daily loss, max portfolio delta/gamma, buying power limits
- Circuit breaker: kills all activity if thresholds are breached
- Runs pre-trade and post-trade checks

### Portfolio/Position Module
- Tracks current positions and calculates real-time P&L
- Aggregates portfolio-level greeks (delta, gamma, theta, vega)
- Monitors expiration calendar and upcoming events (earnings, dividends)
- Reconciles internal state with IBKR on startup/reconnect

### Scheduling Module
- Cron-driven triggers: market open prep, end-of-day review, weekly expiration management
- Event-driven triggers: IV spike detection, price alerts, fill notifications
- Market hours awareness: respects trading hours, early close days, holidays
