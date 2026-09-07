#!/usr/bin/env bash
# Background SSM tunnels through the OsaiTrader bastion.
#   db:      localhost:5433 -> RDS:5432        (avoids local Postgres on 5432)
#   service: localhost:3101 -> ECS task:3100   (avoids local service on 3100)
# Usage: tunnels.sh {start|stop|status}
set -uo pipefail

REGION=us-east-1
STACK=OsaiTraderStack
CLUSTER=osai-trader
SERVICE=osai-trader
CONTAINER_PORT=3100
LOCAL_SERVICE_PORT=3101
DB_REMOTE_PORT=5432
LOCAL_DB_PORT=5433

STATE_DIR="$HOME/.osaitrader"
PID_FILE="$STATE_DIR/tunnels.pids"
LOG_DIR="$STATE_DIR/logs"

cmd="${1:-status}"

err() { echo "ERROR: $*" >&2; }

ensure_plugin() {
  if ! command -v session-manager-plugin >/dev/null 2>&1; then
    err "session-manager-plugin not installed. Run: brew install --cask session-manager-plugin"
    exit 1
  fi
}

get_output() { # $1 = output key
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null
}

get_task_ip() {
  local task
  task=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" \
    --desired-status RUNNING --region "$REGION" --query 'taskArns[0]' --output text 2>/dev/null)
  [ -z "$task" ] || [ "$task" = "None" ] && return 1
  aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --region "$REGION" \
    --query "tasks[0].attachments[0].details[?name=='privateIPv4Address'].value" \
    --output text 2>/dev/null
}

start_tunnel() { # host remote local label bastion
  local host=$1 remote=$2 local=$3 label=$4 bastion=$5
  # nohup + disown so the session detaches from the launching shell and keeps
  # running in the background after this script (or the caller) exits.
  nohup aws ssm start-session --target "$bastion" --region "$REGION" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"$host\"],\"portNumber\":[\"$remote\"],\"localPortNumber\":[\"$local\"]}" \
    >"$LOG_DIR/$label.log" 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid $label localhost:$local->$host:$remote" >>"$PID_FILE"
  echo "  started $label: localhost:$local -> $host:$remote (pid $pid)"
}

case "$cmd" in
  start)
    ensure_plugin
    mkdir -p "$STATE_DIR" "$LOG_DIR"
    if [ -s "$PID_FILE" ]; then
      # Only block if something is genuinely still running. A stale pidfile from
      # tunnels killed by a deploy shouldn't force a manual 'stop' first.
      alive=0
      while read -r pid _rest; do
        [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null && alive=$((alive + 1))
      done <"$PID_FILE"
      if [ "$alive" -gt 0 ]; then
        err "$alive tunnel(s) already running — run 'stop' first."
        exit 1
      fi
      echo "  (clearing stale pidfile — previous tunnels are gone)"
      : >"$PID_FILE"
    fi
    bastion=$(get_output BastionId)
    if [ -z "$bastion" ] || [ "$bastion" = "None" ]; then
      err "no bastion deployed. Stand it up: cd infra && npx cdk deploy -c bastion=true"
      exit 1
    fi
    : >"$PID_FILE"
    db_host=$(get_output DbEndpoint | cut -d: -f1)
    if [ -n "$db_host" ] && [ "$db_host" != "None" ]; then
      start_tunnel "$db_host" "$DB_REMOTE_PORT" "$LOCAL_DB_PORT" db "$bastion"
    else
      echo "  WARN: no DbEndpoint output; skipped db tunnel."
    fi
    if task_ip=$(get_task_ip) && [ -n "$task_ip" ] && [ "$task_ip" != "None" ]; then
      start_tunnel "$task_ip" "$CONTAINER_PORT" "$LOCAL_SERVICE_PORT" service "$bastion"
    else
      echo "  WARN: no running service task; skipped service tunnel."
    fi
    echo "waiting for sessions to establish..."
    sleep 4
    exec "$0" status
    ;;
  stop)
    if [ ! -f "$PID_FILE" ]; then echo "no tunnels running."; exit 0; fi
    while read -r pid label rest; do
      [ -z "${pid:-}" ] && continue
      if kill -0 "$pid" 2>/dev/null; then
        pkill -P "$pid" 2>/dev/null || true   # kill the session-manager-plugin child
        kill "$pid" 2>/dev/null || true
        echo "  stopped $label (pid $pid)"
      fi
    done <"$PID_FILE"
    rm -f "$PID_FILE"
    echo "all tunnels closed."
    ;;
  status)
    if [ ! -s "$PID_FILE" ]; then echo "no tunnels running."; exit 0; fi
    while read -r pid label rest; do
      [ -z "${pid:-}" ] && continue
      if kill -0 "$pid" 2>/dev/null; then
        echo "  UP    $label  $rest  (pid $pid)"
      else
        echo "  DOWN  $label  $rest  (pid $pid — dead; check $LOG_DIR/$label.log)"
      fi
    done <"$PID_FILE"
    ;;
  *)
    err "usage: tunnels.sh {start|stop|status}"; exit 1 ;;
esac
