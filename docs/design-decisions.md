# Design Decisions

## Decisions Made

### IBKR Connectivity
- **IB Gateway in headless mode** as an ECS sidecar container alongside the NestJS service
- **`@stoqey/ib`** Node.js library for TWS API communication
- Must handle daily connection drops and periodic IB Gateway restarts
- Request queuing to stay within IBKR API rate limits

### AI Agent Architecture
- **Claude SDK with tool use** — agent calls tools like `getOptionsChain`, `getPortfolioPositions`, `submitOrder`, `getAccountSummary`
- **System prompt** encodes strategy preferences and constraints
- **Token cost management**: cache system prompt, keep market data context concise, avoid dumping full options chains into context
- **Two-agent pattern** preferred: analysis agent + execution review agent

### AWS Infrastructure
- **ECS Fargate** with two containers per task (NestJS + IB Gateway)
- **Secrets Manager** for IBKR credentials and Anthropic API keys
- **RDS Postgres** for trade history, position snapshots, audit logging
- **CloudWatch** for monitoring and alerting (connectivity loss, risk breaches)
- **SQS or EventBridge** to decouple market data ingestion from decision engine (evaluate later)

## Decisions To Make

### Strategy Scope
- **Open question**: Is the AI choosing which strategies to run, or executing a predefined playbook?
- Recommendation: start constrained (predefined strategies) and expand AI autonomy over time

### Approval Workflow
- **Open question**: Fully autonomous, or notify-and-wait-for-approval?
- Recommendation: start with notification + approval with a timeout, move to autonomous for lower-risk trades

### Notification/Dashboard
- **Open question**: Slack bot, Discord bot, web dashboard, or mobile notifications?
- Need a way to monitor agent activity and override decisions in real-time

### State Reconciliation
- On service restart, must reconcile internal state with IBKR actual positions
- Need to define reconciliation strategy and conflict resolution
