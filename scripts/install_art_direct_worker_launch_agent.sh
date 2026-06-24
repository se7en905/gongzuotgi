#!/usr/bin/env bash
set -euo pipefail

ROOT="${ART_WORKER_HOME:-${HOME}/ArtDirectWorker}"
LABEL="com.artproject.art-direct-worker.${ART_PLATFORM_USERNAME:-user}"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
NODE_BIN="$(command -v node)"
DEFAULT_CODEX_CLI="/Applications/Codex.app/Contents/Resources/codex"
WORKER_PATH="${ART_WORKER_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
LOG_DIR="${ROOT}/logs"
RUNNER="${ROOT}/scripts/run-art-direct-worker.sh"

if [[ -z "${ART_PLATFORM_API:-}" ]]; then
  echo "缺少 ART_PLATFORM_API，例如：http://127.0.0.1:4288" >&2
  exit 1
fi

if [[ -z "${ART_PLATFORM_USERNAME:-}" ]]; then
  echo "缺少 ART_PLATFORM_USERNAME" >&2
  exit 1
fi

if [[ -z "${ART_PLATFORM_PASSWORD:-}" ]]; then
  echo "缺少 ART_PLATFORM_PASSWORD" >&2
  exit 1
fi

mkdir -p "${ROOT}/scripts" "${LOG_DIR}" "${HOME}/Library/LaunchAgents"

if [[ ! -f "${ROOT}/scripts/art-direct-worker.mjs" ]]; then
  echo "缺少 ${ROOT}/scripts/art-direct-worker.mjs，请先通过工作台复制命令下载 Worker。" >&2
  exit 1
fi

cat > "${RUNNER}" <<'RUNNER'
#!/usr/bin/env bash
set -u

: "${ART_PLATFORM_API:?missing ART_PLATFORM_API}"
: "${ART_PLATFORM_USERNAME:?missing ART_PLATFORM_USERNAME}"
: "${ART_PLATFORM_PASSWORD:?missing ART_PLATFORM_PASSWORD}"
: "${ART_WORKER_HOME:=${HOME}/ArtDirectWorker}"

NODE_BIN="${NODE_BIN:-node}"
WORKER="${ART_WORKER_HOME}/scripts/art-direct-worker.mjs"
LOG_DIR="${ART_WORKER_HOME}/logs"
mkdir -p "${ART_WORKER_HOME}/scripts" "${LOG_DIR}"

export ART_WORKER_PROJECT_ROOT="${ART_WORKER_PROJECT_ROOT:-${ART_WORKER_HOME}}"
export ART_WORKER_SUPERVISED=1
export PATH="${ART_WORKER_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}:${PATH:-}"

while true; do
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${ART_PLATFORM_API%/}/worker/art-direct-worker.mjs" -o "${WORKER}" \
      || echo "[$(date -Iseconds)] worker update download failed" >> "${LOG_DIR}/art-direct-worker.${ART_PLATFORM_USERNAME}.err.log"
  fi
  "${NODE_BIN}" "${WORKER}"
  sleep 5
done
RUNNER
chmod +x "${RUNNER}"

cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${RUNNER}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ART_PLATFORM_API</key>
    <string>${ART_PLATFORM_API}</string>
    <key>ART_PLATFORM_USERNAME</key>
    <string>${ART_PLATFORM_USERNAME}</string>
    <key>ART_PLATFORM_PASSWORD</key>
    <string>${ART_PLATFORM_PASSWORD}</string>
    <key>ART_WORKER_PROJECT_ROOT</key>
    <string>${ART_WORKER_PROJECT_ROOT:-${ROOT}}</string>
    <key>ART_WORKER_POLL_INTERVAL_MS</key>
    <string>${ART_WORKER_POLL_INTERVAL_MS:-300000}</string>
    <key>ART_WORKER_HEARTBEAT_INTERVAL_MS</key>
    <string>${ART_WORKER_HEARTBEAT_INTERVAL_MS:-300000}</string>
    <key>ART_WORKER_LOCAL_CHECK_INTERVAL_MS</key>
    <string>${ART_WORKER_LOCAL_CHECK_INTERVAL_MS:-2400000}</string>
    <key>ART_WORKER_HOME</key>
    <string>${ROOT}</string>
    <key>ART_WORKER_PATH</key>
    <string>${WORKER_PATH}</string>
    <key>PATH</key>
    <string>${WORKER_PATH}</string>
    <key>NODE_BIN</key>
    <string>${NODE_BIN}</string>
    <key>CODEX_CLI_PATH</key>
    <string>${CODEX_CLI_PATH:-${DEFAULT_CODEX_CLI}}</string>
    <key>OPENAI_BASE_URL</key>
    <string>${OPENAI_BASE_URL:-}</string>
    <key>OPENAI_API_BASE_URL</key>
    <string>${OPENAI_API_BASE_URL:-}</string>
    <key>OPENAI_API_BASE</key>
    <string>${OPENAI_API_BASE:-}</string>
    <key>HTTP_PROXY</key>
    <string>${HTTP_PROXY:-${http_proxy:-}}</string>
    <key>HTTPS_PROXY</key>
    <string>${HTTPS_PROXY:-${https_proxy:-}}</string>
    <key>ALL_PROXY</key>
    <string>${ALL_PROXY:-${all_proxy:-}}</string>
    <key>NO_PROXY</key>
    <string>${NO_PROXY:-${no_proxy:-}}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/art-direct-worker.${ART_PLATFORM_USERNAME}.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/art-direct-worker.${ART_PLATFORM_USERNAME}.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "${PLIST}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "installed ${LABEL}"
echo "plist ${PLIST}"
