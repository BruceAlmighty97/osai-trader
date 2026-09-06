---
name: tunnels
description: Open, close, or check background SSM tunnels through the OsaiTrader bastion to the deployed AWS service (localhost:3101) and RDS database (localhost:5433). Use when the user wants to reach the deployed service's API or the production database from their laptop — e.g. "open the tunnels", "start the db tunnel", "close the tunnels", "are the tunnels up?".
---

# OsaiTrader bastion tunnels

Manages two background SSM port-forwarding sessions through the bastion:

| Tunnel | Local | → Remote | Notes |
|---|---|---|---|
| **db** | `localhost:5433` | RDS `:5432` | 5433 so it won't clash with local Postgres |
| **service** | `localhost:3101` | ECS task `:3100` | 3101 so it won't clash with local `start:dev` |

The tunnels run in the **background** and survive across turns; the script tracks
PIDs in `~/.osaitrader/tunnels.pids` and logs to `~/.osaitrader/logs/`.

## How to run

Pick the action from what the user asked, then run the script from the repo root:

- **Start / open / up** → `bash .claude/skills/tunnels/tunnels.sh start`
- **Stop / close / down** → `bash .claude/skills/tunnels/tunnels.sh stop`
- **Status / check** → `bash .claude/skills/tunnels/tunnels.sh status`

Then report the result to the user: which tunnels came up and their local ports,
or the specific error.

## Prerequisites (the script checks and reports these)

1. **`session-manager-plugin`** installed locally (`brew install --cask session-manager-plugin`).
2. **The bastion must be deployed** — it's flag-gated and off by default, so a plain
   `cdk deploy` tears it down. If the script reports "no bastion deployed", stand it
   back up: `cd infra && npx cdk deploy -c bastion=true --require-approval never`.
3. **A running service task** for the service tunnel (the db tunnel works regardless).

## Notes

- The **task's private IP is ephemeral** — it changes on every deploy/restart. The
  script re-resolves it on each `start`, so after a redeploy: `stop` then `start`.
- After `start`, use the tunnels like: `curl -H "X-API-Key: <key>" localhost:3101/paper/account`
  for the API, or point a DB client at `localhost:5433` (creds in the `osai-trader/db` secret).
- Requires valid AWS creds in the shell (`aws sso login --profile macbook` if expired).
