#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-}"
if [[ -z "$BASE" ]]; then
  echo "用法：bash scripts/set_figma_plugin_public_base.sh https://你的真实工作台地址"
  exit 1
fi

if [[ ! "$BASE" =~ ^https:// ]]; then
  echo "Figma 插件稳定真实链接必须使用 https:// 开头。"
  exit 1
fi

PLIST="$HOME/Library/LaunchAgents/com.artproject.platform.plist"
if [[ ! -f "$PLIST" ]]; then
  echo "未找到 $PLIST，请先安装工作台 LaunchAgent。"
  exit 1
fi

/usr/libexec/PlistBuddy -c "Delete :EnvironmentVariables:AWP_FIGMA_PLUGIN_BASES" "$PLIST" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:AWP_FIGMA_PLUGIN_BASES string $BASE" "$PLIST"

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"

echo "已设置 Figma 插件真实链接：$BASE"
echo "请重新登录/刷新工作台后重新下载 Figma 插件包。"
