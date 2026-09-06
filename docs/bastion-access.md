# Bastion Access (DB + API tunnels)

The service has **no public ingress** (no ALB, security group closed) and RDS is
**private**. To reach either from your laptop, use the optional SSM bastion — a
tiny `t4g.nano` jump host defined in the CDK stack behind a flag. It has **no SSH
key and no inbound ports**; you connect only via `aws ssm start-session`, which
port-forwards a VPC host's port to your local machine.

```
your laptop ──SSM──► bastion (EC2) ──VPC──► RDS :5432  or  ECS task :3100
   localhost:5432/3100                        (both private)
```

## Prerequisite (one-time)

Install the Session Manager plugin (the tunnel won't work without it):

```bash
brew install --cask session-manager-plugin
```

All commands below assume region `us-east-1` and profile creds already loaded
(`aws sso login --profile macbook` if your SSO session expired).

## 1. Stand up the bastion

The bastion is off by default. Deploy it with the context flag:

```bash
cd infra
npx cdk deploy -c bastion=true --require-approval never
```

Takes ~2–3 min (the EC2 instance + the security-group rules that let it reach the
task on 3100 and RDS on 5432). It registers with SSM ~1–2 min after launch — if a
`start-session` says the instance isn't connected, wait and retry.

> **Always pass `-c bastion=true` on every manual `cdk deploy`**, or the bastion
> is torn down. (CI deploys via GitHub Actions don't run `cdk`, so they never
> touch it — only manual `cdk deploy` does.)

**Tear it down** when you're done (saves ~$3/mo): deploy once **without** the flag:

```bash
npx cdk deploy --require-approval never
```

## 2. Grab the bastion ID and the current task IP

```bash
BASTION=$(aws cloudformation describe-stacks --stack-name OsaiTraderStack \
  --query "Stacks[0].Outputs[?OutputKey=='BastionId'].OutputValue" \
  --output text --region us-east-1)

TASK_IP=$(aws ecs describe-tasks --cluster osai-trader \
  --tasks $(aws ecs list-tasks --cluster osai-trader --service-name osai-trader \
    --desired-status RUNNING --query 'taskArns[0]' --output text --region us-east-1) \
  --query "tasks[0].attachments[0].details[?name=='privateIPv4Address'].value" \
  --output text --region us-east-1)

echo "bastion=$BASTION  task_ip=$TASK_IP"
```

> The task's private IP is **ephemeral** — it changes on every deploy/restart, so
> re-run the `TASK_IP` line before tunnelling to the API. (RDS's endpoint is
> stable, so the DB tunnel below doesn't have this problem.)

## 3. Tunnel to the API service (port 3100)

```bash
aws ssm start-session --target "$BASTION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$TASK_IP\"],\"portNumber\":[\"3100\"],\"localPortNumber\":[\"3100\"]}" \
  --region us-east-1
```

Leave that running; it forwards **localhost:3100 → bastion → task:3100**. Then:

- **Swagger:** open <http://localhost:3100/swagger> (loads without a key — it's
  public). Click **Authorize**, paste the API key, and the protected endpoints
  work from the UI.
- **curl:**
  ```bash
  curl http://localhost:3100/health                           # 200, no key needed
  curl -i http://localhost:3100/tt/whoami                      # 401 without the key
  curl -H "X-API-Key: <key>" http://localhost:3100/tt/whoami   # 200 with the key
  ```

Get the API key:

```bash
aws secretsmanager get-secret-value --secret-id osai-trader/api-key \
  --query SecretString --output text --region us-east-1
```

## 4. Tunnel to the database (port 5432)

Same bastion, different remote host. RDS's endpoint is stable, so grab it once:

```bash
DB_HOST=$(aws cloudformation describe-stacks --stack-name OsaiTraderStack \
  --query "Stacks[0].Outputs[?OutputKey=='DbEndpoint'].OutputValue" \
  --output text --region us-east-1 | cut -d: -f1)

aws ssm start-session --target "$BASTION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$DB_HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"5432\"]}" \
  --region us-east-1
```

Then point a client (DBeaver, TablePlus, `psql`) at **localhost:5432**. Get the
credentials from the RDS-managed secret:

```bash
aws secretsmanager get-secret-value --secret-id osai-trader/db \
  --query SecretString --output text --region us-east-1
```

The secret JSON has `username`, `password`, and `dbname` (`osaitrader`). Enable
SSL in the client (RDS enforces it); "require" without cert verification is fine.

> Only one local port can be bound at a time per port number, so run the API
> tunnel and the DB tunnel in **separate terminals** (they use different local
> ports — 3100 vs 5432 — so both can be open at once).
