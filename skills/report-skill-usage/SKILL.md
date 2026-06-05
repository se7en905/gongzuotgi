---
name: report-skill-usage
description: 轻量记录并每天汇总上报部门成员对 git 中 md、markdown、SKILL.md 或 Codex skill 的调用次数到美术工作台。Use when Codex needs to report that a member used a repository document, specification md, AI asset, SKILL.md, or skill resource, and only the invocation/count matters rather than output quality.
---

# Skill 调用上报

## 执行原则

当成员使用 git 仓库里的任意 `.md`、`.markdown`、`SKILL.md` 或 skill 目录完成任务时，调用 `scripts/report-skill-usage.mjs` 记录次数。上报只表示“发生过调用”，不评价产物质量、不上传文件正文、不读取大段内容。

每天按 `日期 + 成员 + 资源路径` 汇总一次到美术工作台；同一天重复执行脚本会用同一个事件键覆盖为当天总次数，避免重复加平台调用次数。

脚本启动时会自动废弃旧版 `member-art-reporter` 安装：停用旧自动同步任务，移除旧 `art-progress-reporter` / `art-workbench-sync-reporter` skill，清理旧 `~/.codex/AGENTS.md` 规则块，并复用旧 `.env` 中的工作台地址、密钥和成员信息。

通过 Codex 的 `skill-installer` 从 Git 安装后，立即运行一次旧包废弃检查：

```bash
node ~/.codex/skills/report-skill-usage/scripts/report-skill-usage.mjs --retire-legacy-only
```

## 快速上报

优先使用环境变量配置工作台地址、上报密钥和成员信息：

```bash
export ART_WORKBENCH_API_BASE="http://工作台地址:4288"
export ART_WORKBENCH_EVENT_KEY="工作台上报密钥"
export ART_MEMBER_ACCOUNT="成员账号"
export ART_MEMBER_NAME="成员姓名"
```

记录一次调用：

```bash
node scripts/report-skill-usage.mjs \
  --path "skills/ui-finalize/SKILL.md" \
  --name "UI 终稿检查" \
  --count 1
```

批量汇总多个资源：

```bash
node scripts/report-skill-usage.mjs \
  --items-json '[{"path":"规范类/入口图规范.md","name":"入口图规范","count":2},{"path":"skills/figma-review/SKILL.md","count":1}]'
```

只补传本地队列：

```bash
node scripts/report-skill-usage.mjs --flush-only
```

只执行旧包废弃检查：

```bash
node scripts/report-skill-usage.mjs --retire-legacy-only
```

## 字段口径

- `--path`：git 内相对路径或可识别路径，优先填真实 md / SKILL.md 路径。
- `--name`：工作台展示名称；不填时使用文件名。
- `--count`：当天调用次数，默认 `1`。
- `--date`：统计日期，默认今天，格式 `YYYY-MM-DD`。
- `--api-base`：覆盖 `ART_WORKBENCH_API_BASE`，支持逗号分隔多个工作台地址。
- `--member-account` / `--member-name`：覆盖成员身份环境变量。
- `--retire-legacy 0`：跳过旧版 `member-art-reporter` 废弃检查，仅在排障时使用。

## 失败处理

工作台不可达时，脚本把待上报内容写入 `scripts/pending-skill-usage.jsonl`，下次正常上报或执行 `--flush-only` 时自动补传。401/403/400 视为配置错误，不进入补传队列。
