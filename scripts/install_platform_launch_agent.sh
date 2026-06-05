#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/se7en/ArtProject/platform"
LABEL="com.artproject.platform"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
NODE_BIN="$(command -v node)"
CODEX_CLI_PATH="/Applications/Codex.app/Contents/Resources/codex"
LOG_DIR="${ROOT}/logs"

mkdir -p "${LOG_DIR}" "${HOME}/Library/LaunchAgents"

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
    <string>${ROOT}/scripts/start-api.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>API_PORT</key>
    <string>4288</string>
    <key>PORT</key>
    <string>4288</string>
    <key>STATIC_DIR</key>
    <string>dist</string>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>ZENTAO_AUTO_SYNC</key>
    <string>0</string>
    <key>ZENTAO_ART_DEPT_ID</key>
    <string>27</string>
    <key>CODEX_CLI_PATH</key>
    <string>${CODEX_CLI_PATH}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/platform-launch-agent.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/platform-launch-agent.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "${PLIST}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "installed ${LABEL}"
echo "plist ${PLIST}"
