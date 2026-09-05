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

## Estimated monthly cost

Fargate ~$7 + RDS ~$12 + storage ~$2.50 + public IPv4 ~$4 + secrets ~$1 ≈ **$26–28/mo**.

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
