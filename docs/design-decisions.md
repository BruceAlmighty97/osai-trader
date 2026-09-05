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
- **ECS Fargate**, single container (NestJS only — the tastytrade pivot removed the
  IB Gateway sidecar; the app talks to tastytrade over plain REST).
- **Secrets Manager** for tastytrade credentials and the Anthropic API key.
- **RDS Postgres** for decisions, orders, position snapshots, audit logging.
- **CloudWatch** for logs/monitoring (risk breaches, run failures).
- **EventBridge Scheduler** for the market-hours run cadence (see below).

### Hosting platform: stay on AWS, Fargate over App Runner / PaaS / ALB
Decided 2026-09 after revisiting it (the service had no reachable API or DB path yet).

- **Stay in AWS**, not Render/Railway — chosen for single-vendor breadth a trading
  system will grow into (EventBridge, Timestream/S3 for tick history, Bedrock, SNS
  alerts) and one IAM/network/IaC model. A PaaS is simpler but makes private access
  to AWS data services awkward and splits the stack across two vendors.
- **App Runner rejected** for this workload: its instances only get CPU while
  handling a request, so an in-process cron won't fire reliably; and reaching a
  *private* RDS needs a VPC connector, which routes **all** egress through the VPC
  and forces a NAT gateway (~$32/mo) for the outbound tastytrade/Anthropic calls —
  more cost/complexity than the ALB it was meant to avoid. Great for plain request/
  response web apps; wrong shape for a private-DB background worker.
- **No ALB** — a single trading bot needs no load balancer or public endpoint. It's
  a scheduled worker, not a request-driven web app.
- **Chosen runtime shape:** EventBridge Scheduler → `ecs:RunTask` launches
  short-lived Fargate tasks (`scan` / `manage` command overrides on the same image)
  that run one cycle and exit. Billed per task-second, fully private, no inbound.
  Human access on demand via CloudWatch Logs, `aws ecs run-task`, and an optional
  SSM bastion for DB GUI. Full write-up + cost in `docs/aws-infrastructure.md`
  ("Planned: scheduling & access model").

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
