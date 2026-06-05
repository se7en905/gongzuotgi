#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/se7en/ArtProject/platform"
LABEL="com.artproject.platform.git-auto-backup"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${ROOT}/logs"
INTERVAL_SECONDS="${ART_PLATFORM_GIT_BACKUP_INTERVAL:-1800}"

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
    <string>/bin/bash</string>
    <string>${ROOT}/scripts/git-auto-backup.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ART_PLATFORM_ROOT</key>
    <string>${ROOT}</string>
    <key>ART_PLATFORM_BACKUP_REMOTE</key>
    <string>platform-backup</string>
    <key>ART_PLATFORM_BACKUP_BRANCH</key>
    <string>main</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/git-auto-backup.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/git-auto-backup.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "${PLIST}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "installed ${LABEL}"
echo "interval ${INTERVAL_SECONDS}s"
echo "plist ${PLIST}"
