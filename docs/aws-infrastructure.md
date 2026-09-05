# AWS Infrastructure (Phase 6)

CDK app in `infra/` defines everything as one stack (`OsaiTraderStack`, us-east-1):

| Resource | Detail |
|---|---|
| VPC | 2 AZs, **public subnets only, no NAT gateway** (saves ~$32/mo) |
| ECR | `osai-trader` repo, keeps last 10 images |
| RDS | Postgres 16, `db.t4g.micro`, 20 GB gp3, single-AZ, 7-day backups, deletion protection ON |
| Secrets | `osai-trader/db` (RDS-managed creds) + `osai-trader/app` (TT creds, Anthropic key) |
| ECS | Fargate cluster/service `osai-trader`, 0.25 vCPU / 512 MB, **ARM64**, desired count 1 |
| Logs | CloudWatch `/osai-trader/service`, 30-day retention |
| IAM | `osai-trader-github-deploy` role, assumable only by GitHub Actions via OIDC from `BruceAlmighty97/osai-trader` |

Design notes:

- **No ALB.** The task gets a public IP (needed for egress without NAT anyway). The API is unreachable unless you pass your IP at deploy time: `-c allowedIngressCidr=<your-ip>/32`. The IP changes on each deploy — look it up in the ECS console or via `aws ecs describe-tasks`.
- **RDS is in public subnets but not publicly accessible** — no public IP, and its security group only accepts 5432 from the service's security group.
- **Never two bots at once:** the service deploys with min 0% / max 100% healthy, so ECS stops the old task before starting the new one.
- **TLS to RDS:** the app connects with `DB_SSL=true` (encrypts, skips CA verification since we don't bundle the RDS cert).
- **Deploys are `:latest`-based:** CI pushes `:latest` + `:<sha>` and forces a new deployment; no task-definition re-registration.

## Planned: scheduling & access model (EventBridge Scheduler + RunTask)

> Status: **target design, not yet built.** The current stack runs an always-on
> service (`desiredCount: 1`) with no scheduler. This section is the direction we
> chose after weighing App Runner / Render / ALB (see `docs/design-decisions.md`):
> **stay in AWS, drop the ALB, drive the bot with EventBridge Scheduler.**

### Why this shape

A trading bot is a **scheduled background worker**, not a web app. It doesn't need
a server sitting up 24/7 or a public endpoint — it needs work to happen at the
right times. So instead of an always-on service you have to reach, EventBridge
Scheduler launches a **short-lived Fargate task** that runs one cycle and exits.

```
EventBridge Scheduler                          ┌─ you (occasional) ─┐
(market-hours cron, ET/DST, NYSE-gated)        │                    │
   ├── 10:00,12:00,14:00 ET → RunTask "scan"    SSM tunnel      CloudWatch
   └── every ~10 min        → RunTask "manage"  (via bastion)      Logs
              │                                     │                │
              ▼                                     ▼                ▼
   short-lived Fargate task ──────────────►   RDS Postgres     audit trail
   (same image, CMD override:                 (private, SG-only)  + reasoning
    scan / manage → run once → exit)
              │
              └──► tastytrade + Anthropic (outbound via public IP, no NAT)
```

Benefits vs. the always-on service + ALB:

- **Minimal compute** — billed per task-second, not 24/7. ~40 short runs/day × ~30s
  ≈ pennies/mo, vs ~$7/mo for the always-on task.
- **Nothing to expose** — no ALB, no inbound rule, no public API. The "how do I
  reach the API" problem disappears; the bot is trigger-driven, not request-driven.
- **AWS-native scheduling** — EventBridge Scheduler handles the ET/DST /
  market-hours / NYSE-calendar logic (see `docs/market-hours-scheduling.md`).
- **No scaling machinery** — just scheduled one-shot tasks.

### Two cadences, two schedules

| Schedule | Cadence (ET) | Task command | Does |
|---|---|---|---|
| Entry scan | a few times/day, e.g. 10:00 / 12:00 / 14:00 | `scan` | watchlist → rank → propose/enter |
| Position management | every ~10 min during the window | `manage` | read holdings, apply exit rules (50% / 21 DTE / 2× loss), close |

Both target the **same container image** with a different command override, so
there's one thing to build and deploy.

### Prerequisites (not yet built)

1. **One-shot mode in the app.** Today the image only boots the NestJS web server
   (`CMD ["node","dist/main"]`). RunTask needs `node dist/main scan` / `manage` to
   run a single cycle and exit non-zero on failure. Ties to roadmap #1
   (`/strategy/scan`) and #5 (position management).
2. **Scheduler IAM.** EventBridge Scheduler needs a role allowed to `ecs:RunTask`
   on the task definition and to `iam:PassRole` the task's execution + task roles.
3. **Whether to keep the always-on service.** Two viable end states:
   - **Fully scheduled (leanest):** drop the long-running service (`desiredCount: 0`
     or remove it); everything is RunTask. Cheapest, but no live API to poke.
   - **Hybrid:** keep `desiredCount: 1` for the REST API + an always-warm intraday
     loop, add EventBridge only for the entry scan. Simpler code, ~$7/mo floor.

   Recommendation: start **fully scheduled** — it matches "minimal compute, no
   24/7" — and only add a warm service if the intraday loop needs sub-minute latency.

### Human access (when you actually need it)

With no always-on server, you reach things on demand:

| Want | How |
|---|---|
| See what it did | **CloudWatch Logs** `/osai-trader/service` + the `decisions` table |
| Query the DB (GUI) | tiny **SSM bastion** (t4g.nano ~$3/mo) + `aws ssm start-session … AWS-StartPortForwardingSessionToRemoteHost` → point DBeaver at `localhost:5432` |
| Trigger a run manually | `aws ecs run-task … --overrides '{"containerOverrides":[{"name":"service","command":["node","dist/main","scan"]}]}'` |
| Poke the REST API | run an ad-hoc task with the default (web) command, then SSM port-forward 3100 — or just run the service locally against the prod DB over the SSM tunnel |

The SSM bastion is optional — only add it when you want a SQL GUI. Log +
`run-task` inspection needs nothing extra.

### Bastion: one tunnel for DB + API

You can't port-forward *directly* into a Fargate task — ECS Exec
(`aws ecs execute-command`) only gives you a **shell inside the container**, not a
TCP tunnel. SSM port-forwarding (`AWS-StartPortForwardingSessionToRemoteHost`) runs
on an **SSM-managed EC2 instance** and forwards to any host it can reach in the VPC.
So the DB tunnel already hops through a bastion — and that *same* bastion can forward
to the task's `3100` too (RDS and the task are both just "remote hosts"):

```bash
# DB (stable endpoint)
aws ssm start-session --target <bastion-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<rds-endpoint>"],"portNumber":["5432"],"localPortNumber":["5432"]}'

# API (task private IP — changes every deploy; look it up first)
aws ecs describe-tasks --cluster osai-trader \
  --tasks $(aws ecs list-tasks --cluster osai-trader --service-name osai-trader --query 'taskArns[0]' --output text) \
  --query 'tasks[0].attachments[0].details[?name==`privateIPv4Address`].value' --output text
aws ssm start-session --target <bastion-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<task-private-ip>"],"portNumber":["3100"],"localPortNumber":["3100"]}'
```

Caveats: the task's private IP is **ephemeral** (RDS's endpoint is stable), and in
the fully-scheduled model there's usually **no long-running task** to tunnel to — so
the API tunnel mainly matters if you keep an always-on service.

**Do it in CDK, flag-gated (off by default).** Don't hand-create it in the console —
put it in the stack behind `-c bastion=true` so the default deploy stays lean and the
tunnel is reproducible/teardownable. Minimal shape:

```ts
// after dbSg / serviceSg are defined
if (this.node.tryGetContext('bastion') === 'true') {
  const bastionSg = new ec2.SecurityGroup(this, 'BastionSg', {
    vpc, description: 'osai-trader SSM bastion', allowAllOutbound: true,
  }); // no inbound rules — SSM works via the agent's outbound polling
  dbSg.addIngressRule(bastionSg, ec2.Port.tcp(5432), 'bastion to Postgres');
  serviceSg.addIngressRule(bastionSg, ec2.Port.tcp(CONTAINER_PORT), 'bastion to API');

  const bastion = new ec2.Instance(this, 'Bastion', {
    vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }, // public IP so the SSM agent reaches SSM without a NAT
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
    machineImage: ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.ARM_64, // SSM agent preinstalled
    }),
    securityGroup: bastionSg,
  });
  bastion.role.addManagedPolicy(
    iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
  );
  new cdk.CfnOutput(this, 'BastionId', { value: bastion.instanceId });
}
```

`t4g.nano` ≈ **$3/mo** while it exists. No SSH key and no inbound port — access is
purely via SSM (`start-session`), so there's no public attack surface. Tear it down
by deploying without the flag.

## Estimated monthly cost

**Current (always-on service):** Fargate ~$7 + RDS ~$12 + storage ~$2.50 +
public IPv4 ~$4 + secrets ~$1 ≈ **$26–28/mo**.

**Planned (fully scheduled):** RDS ~$12 + storage ~$2.50 + secrets ~$1 +
task-seconds ~$1 + (optional SSM bastion ~$3) ≈ **$16–20/mo** — the Fargate
always-on line collapses to near-zero.

## First deploy (one-time, from your machine)

```bash
# 1. Fresh AWS credentials in your shell, then bootstrap CDK (once per account/region)
cd infra
npm install
npx cdk bootstrap

# 2. Deploy the stack (RDS takes ~10 min). The service will flap until an image exists — that's fine.
npx cdk deploy -c allowedIngressCidr=$(curl -s ifconfig.me)/32

# 3. Put real values in the app secret
aws secretsmanager put-secret-value --secret-id osai-trader/app \
  --secret-string '{"TT_USERNAME":"...","TT_PASSWORD":"...","ANTHROPIC_API_KEY":"..."}'

# 4. Push the first image (Apple Silicon builds ARM64 natively)
aws ecr get-login-password | docker login --username AWS \
  --password-stdin <EcrRepoUri output, host part>
docker build -t <EcrRepoUri>:latest ../tastytrade-service
docker push <EcrRepoUri>:latest

# 5. Restart the service so it picks up the image + secrets
aws ecs update-service --cluster osai-trader --service osai-trader --force-new-deployment
```

## CI/CD

`.github/workflows/deploy.yml` runs on pushes to `main` touching `tastytrade-service/`:
build ARM64 image (QEMU) → push to ECR → `update-service --force-new-deployment` → wait stable.

One-time setup: add a **repository variable** `AWS_DEPLOY_ROLE_ARN` in GitHub
(Settings → Secrets and variables → Actions → Variables) with the `DeployRoleArn` stack output.

## Gotchas

- The account can only have **one** GitHub OIDC provider. If `cdk deploy` fails with
  `EntityAlreadyExists` on the provider, swap the construct for
  `iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(...)` in `infra/lib/osai-trader-stack.ts`.
- Switching to live trading: `cdk deploy -c ttEnv=production` (and put production TT creds in the secret).
- Tearing down: RDS has deletion protection on; flip `deletionProtection` to false, deploy, then destroy. A final snapshot is taken (`removalPolicy: SNAPSHOT`).
