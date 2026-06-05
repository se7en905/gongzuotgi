#!/usr/bin/env bash
set -euo pipefail

# 自动备份只依赖本机 Git/GitHub 凭据，不使用 AI、Codex 或 OpenAI 环境变量。
unset OPENAI_API_KEY OPENAI_BASE_URL ANTHROPIC_API_KEY CODEX_API_KEY CODEX_AUTH_TOKEN

ROOT="${ART_PLATFORM_ROOT:-/Users/se7en/ArtProject/platform}"
REMOTE="${ART_PLATFORM_BACKUP_REMOTE:-platform-backup}"
BRANCH="${ART_PLATFORM_BACKUP_BRANCH:-main}"
LOCK_DIR="${ART_PLATFORM_BACKUP_LOCK_DIR:-${ROOT}/logs/git-auto-backup.lock}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

if [[ ! -d "${ROOT}/.git" ]]; then
  log "跳过：${ROOT} 不是 Git 仓库"
  exit 0
fi

mkdir -p "$(dirname "${LOCK_DIR}")"

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  log "跳过：已有自动备份流程在运行"
  exit 0
fi

cleanup() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

cd "${ROOT}"

if ! git remote get-url "${REMOTE}" >/dev/null 2>&1; then
  log "跳过：找不到远端 ${REMOTE}"
  exit 0
fi

current_branch="$(git branch --show-current)"
if [[ "${current_branch}" != "${BRANCH}" ]]; then
  log "跳过：当前分支是 ${current_branch:-detached}，只自动备份 ${BRANCH}"
  exit 0
fi

git_dir="$(git rev-parse --git-dir)"
if [[ -f "${git_dir}/MERGE_HEAD" || -f "${git_dir}/CHERRY_PICK_HEAD" || -d "${git_dir}/rebase-merge" || -d "${git_dir}/rebase-apply" ]]; then
  log "跳过：仓库正在合并、变基或 cherry-pick"
  exit 0
fi

fetch_ok=0
if git fetch "${REMOTE}" "${BRANCH}" --quiet; then
  fetch_ok=1
  remote_ref="${REMOTE}/${BRANCH}"
  if git rev-parse --verify --quiet "${remote_ref}" >/dev/null; then
    if ! git merge-base --is-ancestor "${remote_ref}" HEAD; then
      log "跳过：远端 ${remote_ref} 含有本地没有的提交，请先人工同步"
      exit 0
    fi
  fi
else
  log "提示：远端拉取失败，本次仍会保留本地快照并尝试推送"
fi

status_before="$(git status --porcelain=v1)"
if [[ -n "${status_before}" ]]; then
  git add -A -- .

  if git diff --cached --quiet; then
    log "跳过：没有需要提交的有效变更"
  else
    timestamp="$(date '+%Y-%m-%d %H:%M')"
    git commit -m "自动备份 ${timestamp}" >/dev/null
    log "已创建自动备份提交：自动备份 ${timestamp}"
  fi
else
  log "检查：没有新的文件变更"
fi

ahead_count=0
if [[ "${fetch_ok}" -eq 1 ]] && git rev-parse --verify --quiet "${REMOTE}/${BRANCH}" >/dev/null; then
  ahead_count="$(git rev-list --count "${REMOTE}/${BRANCH}..HEAD")"
fi

if [[ -n "${status_before}" || "${ahead_count}" -gt 0 ]]; then
  if git push "${REMOTE}" "${BRANCH}"; then
    log "已推送到 ${REMOTE}/${BRANCH}"
  else
    log "推送失败：本地提交已保留，稍后会再次尝试"
    exit 0
  fi
else
  log "完成：无需推送"
fi
