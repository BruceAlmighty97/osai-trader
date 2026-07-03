# OsaiTrader Build Plan

Each phase builds on the previous one. A phase is complete when its "done when" criteria are met.

## Phase 1: IBKR Connection (Foundation) ✅

Everything depends on talking to IBKR. Build the `ibkr` module first.

- Install `@stoqey/ib` dependency
- Implement connection service: connect, disconnect, automatic reconnect with exponential backoff
- Handle IB Gateway daily restart (~11:45 PM ET)
- Request rate limiting / queue to stay within IBKR throttle limits
- Manage order ID sequencing (IBKR requires unique, incrementing IDs)
- Configuration: host, port (4001 live / 4002 paper), client ID, market data type

**Done when**: service connects to paper trading IB Gateway and retrieves account summary.

## Phase 2: Market Data + Portfolio (Read-Only Data) ✅

Once connected, start reading data from IBKR.

### Market Data
- Request quotes for equities and indices (delayed or real-time based on subscription)
- Request options chains filtered by expiration and strike range
- Subscribe to greeks (delta, gamma, theta, vega) and implied volatility
- Normalize raw IBKR data into clean internal types/interfaces
- Data freshness tracking (timestamp each update)

### Portfolio
- Fetch current positions and contract details
- Fetch account balances, buying power, margin usage
- P&L tracking per position and portfolio-wide
- Aggregate portfolio-level greeks
- State reconciliation on startup (sync internal state with IBKR)

**Done when**: can pull an options chain for a given underlying and display account balance/positions.

## Phase 3: Risk Management (Guardrails Before Any Trading) ✅

Before the system can place a single order, the guardrails must exist.

- Database-backed risk configuration (PostgreSQL + TypeORM, JSONB column)
- API endpoints to view, update, and reset risk config at runtime
- Pre-trade validation checks:
  - Position size within limits
  - Sufficient buying power / margin
  - Portfolio greeks within bounds after proposed trade
  - No conflicting open orders
  - Market data freshness validated
  - Daily/weekly loss limits not breached
- Portfolio-level exposure monitoring
- Circuit breaker: kill switch that halts all activity (`tradingEnabled` flag)
- Defaults seeded on first startup, calibrated for ~$50k portfolio

**Done when**: can pass a hypothetical trade through validation and get approve/reject with reasoning.

See [risk-parameters.md](risk-parameters.md) for full parameter documentation.

## Phase 4: Order Management (Write Path)

With guardrails in place, enable order execution.

- Translate trade decisions into IBKR order objects
- Submit orders (market, limit, stop, combo/spread orders for options strategies)
- Track order lifecycle: pending → submitted → filled / partial / cancelled
- Handle partial fills and order amendments
- Duplicate order detection
- Integrate with risk management for pre-trade checks on every order
- Persist order history and fill details to database

**Done when**: can place a limit order on paper trading, track its status, and cancel it.

## Phase 5: Strategy Engine — Claude Agent (The Brain)

With all plumbing in place, wire up the AI decision-making layer.

- Define agent tools that map to existing modules:
  - `getOptionsChain(underlying, expirationRange, strikeRange)`
  - `getPortfolioPositions()`
  - `getAccountSummary()`
  - `evaluateRisk(proposedTrade)`
  - `submitOrder(order)`
  - `getMarketData(symbol)`
- Build system prompt encoding strategy preferences and constraints
- Implement two-agent pattern:
  - **Analysis Agent**: receives market state → generates trade ideas
  - **Execution Review Agent**: validates proposed trades against risk parameters
- Context management: keep token usage efficient, cache system prompt
- Decision audit logging: full prompt, reasoning, tool calls, and outcome

**Done when**: Claude can analyze current market conditions, propose a trade, pass it through risk checks, and execute it on paper trading.

## Phase 6: AWS Infrastructure + CI/CD

Deploy the application to AWS so it can run autonomously.

### AWS Infrastructure
- **ECS Fargate**: task definition with two containers (NestJS service + IB Gateway sidecar)
- **ECR**: container registry for Docker images
- **RDS Postgres**: managed database (replaces local Docker Postgres)
- **Secrets Manager**: IBKR credentials, Anthropic API key, database credentials
- **CloudWatch**: log aggregation, metrics, alerting (connectivity loss, risk breaches, errors)
- **VPC / Security Groups**: network isolation for the service

### Docker
- Dockerfile for the NestJS service (multi-stage build)
- IB Gateway container configuration (headless mode)
- Docker Compose for local development matching production topology

### CI/CD (GitHub Actions)
- **On PR**: lint, type-check, test
- **On merge to main**: build Docker image, push to ECR, deploy to ECS
- **Environment promotion**: paper trading environment first, separate live environment later

### Environments
- **Paper**: deployed to AWS, connected to IBKR paper trading — for validation
- **Live**: separate deployment, connected to live IBKR account — production

**Done when**: service is deployed to AWS, running against paper trading, with automated deploys on merge.

## Phase 7: Scheduling + Orchestration

Make the system run autonomously in the cloud.

- Cron-driven triggers:
  - Pre-market scan (e.g., 9:00 AM ET)
  - Market open strategy execution (9:30 AM ET)
  - Midday portfolio review
  - End-of-day P&L summary and position review
  - Weekly expiration management (Thursday/Friday)
- Event-driven triggers:
  - IV spike detection
  - Price alerts / threshold breaches
  - Fill notifications
- Market hours awareness: trading hours, early close days, holidays
- Notification / approval workflow:
  - Notify on proposed trades (Slack, Discord, or other)
  - Optional approval gate with configurable timeout
  - Alert on risk limit breaches or connectivity issues
- Graceful shutdown: close or hedge positions before planned downtime

**Done when**: system runs unattended during market hours, executes strategies, and sends notifications.

---

## Prerequisites

- IB Gateway or TWS installed and running with paper trading enabled
- IBKR paper trading account credentials
- Anthropic API key for Claude SDK
- Local Postgres instance (Docker Compose provided)
- AWS account for deployment (Phase 6+)
- GitHub repository for CI/CD (Phase 6+)
