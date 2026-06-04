#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.remote}"
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      if [[ -n "${!key+x}" && -n "${!key}" ]]; then
        continue
      fi
      export "$key=$value"
    fi
  done < "$ENV_FILE"
fi

export NODE_ENV="${NODE_ENV:-production}"
export APP_NAME="${APP_NAME:-agent-workflow-platform}"
export API_PORT="${API_PORT:-${PORT:-4288}}"
export PORT="$API_PORT"
export STATIC_DIR="${STATIC_DIR:-dist}"

SKIP_PM2_SAVE="${SKIP_PM2_SAVE:-0}"
DRY_RUN="${DRY_RUN:-0}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${API_PORT}/}"

log() {
  printf '[remote-start] %s\n' "$*"
}

run() {
  log "$*"
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi
  "$@"
}

ensure_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    log "Missing command: $command_name"
    exit 1
  fi
}

ensure_command node

mkdir -p "$ROOT_DIR/logs"

if command -v pm2 >/dev/null 2>&1; then
  PM2_CMD=(pm2)
else
  log "Missing command: pm2"
  log "Install PM2 on the remote host before running this service script."
  exit 1
fi

run "${PM2_CMD[@]}" startOrReload ecosystem.config.cjs --only "$APP_NAME" --update-env

if [[ "$SKIP_PM2_SAVE" != "1" ]]; then
  run "${PM2_CMD[@]}" save
fi

if [[ "$DRY_RUN" == "1" ]]; then
  log "Dry run finished."
  exit 0
fi

log "Waiting for service: $HEALTH_URL"
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    log "Service is ready: $HEALTH_URL"
    "${PM2_CMD[@]}" status "$APP_NAME" || true
    exit 0
  fi
  sleep 1
done

log "Service did not become ready in time. Recent logs:"
"${PM2_CMD[@]}" logs "$APP_NAME" --lines 80 --nostream || true
exit 1
