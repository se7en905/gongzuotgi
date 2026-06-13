#!/usr/bin/env bash
set -euo pipefail

ROOT="${ART_WORKER_HOME:-${HOME}/ArtDirectWorker}"
LABEL="com.artproject.art-direct-worker.${ART_PLATFORM_USERNAME:-user}"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
NODE_BIN="$(command -v node)"
DEFAULT_CODEX_CLI="/Applications/Codex.app/Contents/Resources/codex"
LOG_DIR="${ROOT}/logs"

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
    <string>${NODE_BIN}</string>
    <string>${ROOT}/scripts/art-direct-worker.mjs</string>
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
    <key>CODEX_CLI_PATH</key>
    <string>${CODEX_CLI_PATH:-${DEFAULT_CODEX_CLI}}</string>
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
