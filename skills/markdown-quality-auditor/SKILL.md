---
name: markdown-quality-auditor
description: 美术部门 Markdown 文档质量评分技能。Use when evaluating non-Skill Markdown files in the art department inventory, including art standards, UI/skin/resource guidelines, workflow notes, AI research summaries, production checklists, and reusable documentation. Outputs a structured Markdown document quality score, not a Skill score.
author: platform
tags: 美术部门, Markdown, 文档质量分, 规范文档, 产物清单, AI产物评分
triggers: Markdown质量分, 文档质量评分, md文档评分, 非Skill文档评分, 美术规范评分, 文档沉淀质量
---

# Markdown 文档质量评分

## 核心工作流

整个过程按阶段推进，每个阶段都有明确输入和输出；不属于美术部门 Markdown 文档或已经是 Skill 的内容，不进入评分。

```text
标准输入
  ↓
fileName / path / title / content / source / owner / updatedAt / contentHash
  ↓
阶段一：适用性判断
  输入：文件扩展名、inventoryKind、路径、标题、正文
  输出：applicable、not_applicable 原因、是否继续评分
  ↓
阶段二：美术部门相关性识别
  输入：正文、路径、来源、标题
  输出：美术生产信号、文档类型、负责人可判断价值
  ↓
阶段三：正文结构与信息提取
  输入：Markdown 正文
  输出：标题、章节、列表、步骤、资源路径、验收点、风险限制、维护线索
  ↓
阶段四：六维分项评分
  输入：阶段三提取结果
  输出：structure / completeness / reusability / validation / maintainability / readability
  ↓
阶段五：扣分与等级判定
  输入：分项得分、正文长度、缺失项、过期或临时记录风险
  输出：score、level、deduction、deductions
  ↓
阶段六：生成标准 JSON
  输出：Markdown 文档质量分 JSON，可供工作台缓存和质量分列展示
```

标准输出只允许 JSON，核心字段为：

```text
applicable / score / level / scoreName / breakdown / deduction / summary / strengths / deductions / suggestions / evidence / needsReview / notApplicableReason
```

## 用途

本 Skill 专门评估美术部门产物清单里的非 Skill Markdown 文档质量，例如规范、流程、资源说明、UI/皮肤文档、AI 研究沉淀、复用清单和制作指引。

它只产出“Markdown 文档质量分”，不把被评估的 Markdown 改造成 Skill，不计算调用次数，不修改版本，不修改源文件。

## 适用范围

适用：

- 文件类型为 `.md` 或 `.markdown`。
- `inventoryKind` 为 `document`，或明确不是 `SKILL.md` 的普通 Markdown。
- 内容服务于美术部门生产、验收、资源复用、规范执行、AI 产物沉淀或负责人判断。

不适用：

- `SKILL.md` 或已明确作为 Skill 工作流使用的文档。
- 纯代码 README、安装说明、提交日志、临时备忘、空白占位文件。
- 与美术部门生产无关的通用技术文档。

不适用时仍输出 JSON，`applicable` 设为 `false`，`score` 设为 `0`，并说明原因。

## 输入

评分时尽量读取以下字段：

- `fileName`：文件名。
- `path`：仓库相对路径或来源路径。
- `title`：扫描到的标题。
- `content`：Markdown 正文。
- `source`：Git、本地路径或共享盘来源。
- `owner`：贡献人，可为空。
- `updatedAt`：提交或扫描更新时间，可为空。
- `contentHash`：正文内容指纹，可为空；平台用于判断是否需要重新评分。

不得要求额外读取用户电脑外的实时数据；如果正文缺失，只能按已提供内容评分。

## 平台接入契约

工作台接入此 Skill 时按缓存优先执行，避免列表打开或普通刷新造成卡顿。

- 只对 `inventoryKind === "document"` 且扩展名为 `.md` 或 `.markdown` 的产物调用本 Skill。
- `SKILL.md`、疑似 Skill 工作流文档、Git 安装 README、纯代码说明文档不进入质量统计。
- 平台缓存建议写入产物对象的 `markdownQuality` 字段，保留 `score`、`level`、`breakdown`、`summary`、`updatedAt`、`contentHash`。
- 只有负责人点击 `刷新库存`、源内容 `contentHash` 变化、或该文档从无评分变为需要评分时，才重新调用本 Skill。
- 页面进入、切换账号、普通浏览器刷新、打开内容预览、修改贡献人或修改别名时，默认读取上次 `markdownQuality` 缓存，不实时重算。
- 评分失败、正文读取失败或输出 JSON 无法解析时，不得用空分覆盖旧缓存；旧缓存存在时继续展示旧分数，并标记 `needsReview: true`。
- 本 Skill 的结果只作为 Markdown 文档质量分，不参与调用次数来源判断，不改变产物版本、贡献人、作废状态或展示状态。

## 评分总则

总分 100 分，所有分项必须给整数分。评分应从美术负责人视角判断“别人能否直接复用、执行、验收或做决策”，不要因为字数多就给高分。

### 1. 结构清晰度 15 分

- 有明确标题：3 分。
- 有用途、适用对象或适用场景：4 分。
- 有清楚的章节层级：4 分。
- 有路径、来源、资源范围或业务范围说明：4 分。

### 2. 内容完整度 25 分

- 写清背景或问题来源：4 分。
- 写清目标、交付物或要解决的问题：5 分。
- 写清输入材料、资源位置、依赖条件或前置准备：5 分。
- 写清输出结果、预期状态或适用边界：5 分。
- 对美术生产相关信息完整，例如尺寸、状态、规范、资源类型、负责人判断点：6 分。

### 3. 可复用性 20 分

- 有可执行步骤、流程或检查清单：6 分。
- 有示例、模板、反例或截图/资源说明：5 分。
- 有明确判断标准，别人能照着做：5 分。
- 能被多个任务、多人或后续项目复用：4 分。

### 4. 验证闭环 20 分

- 有验收方式、检查点或验证步骤：6 分。
- 有成功标准和失败标准：5 分。
- 有常见问题、风险、限制或不适用场景：5 分。
- 有人工确认点，尤其是美术与开发/产品边界不清时：4 分。

### 5. 维护性 10 分

- 有更新时间、版本、来源提交、负责人或维护线索：3 分。
- 有关联资源、关联任务、关联规范或后续维护入口：3 分。
- 内容不过期，路径和口径没有明显失效：4 分。

### 6. 可读性 10 分

- 语言简洁准确，不堆砌：3 分。
- 列表、表格、代码块或段落组织便于扫描：3 分。
- 关键结论突出，负责人能快速判断价值：2 分。
- 没有大量无关内容、重复内容或无意义占位：2 分。

## 扣分规则

在分项得分基础上扣分，扣分后总分不得低于 0。

- 正文少于 100 个中文字或 60 个英文词：扣 15 分。
- 只有标题、链接或路径，没有解释：扣 25 分。
- 缺少适用场景：扣 10 分。
- 缺少步骤、标准或检查点：扣 10 分。
- 没有任何美术部门生产相关信息：扣 20 分。
- 明显是临时记录、聊天摘录、未整理草稿：扣 10 分。
- 路径、资源名、尺寸、状态或关键引用明显缺失，影响复用：扣 5 到 15 分。
- 内容存在互相矛盾或过期风险但未说明：扣 10 分。

## 异常处理

遇到异常时仍输出可解析 JSON，不输出解释性 Markdown。

- 正文为空或无法读取，但文件确认为 Markdown 文档：`applicable` 为 `true`，`score` 不高于 `30`，`level` 为 `weak`，扣分原因写 `content_missing`。
- 只有标题、链接、路径或一句话占位：`applicable` 为 `true`，按弱文档评分，扣分原因写 `placeholder_content`。
- 疑似 Skill 文档，例如包含 `name:`、`description:`、`triggers:`、`## 工作流` 且用于指导 Agent 执行：`applicable` 为 `false`，`notApplicableReason` 写 `skill_like_document`。
- 非美术部门文档，例如通用代码 README、依赖安装说明、提交日志：`applicable` 为 `false`，`notApplicableReason` 写 `not_art_department_document`。
- 文档内容互相矛盾、路径失效或标准冲突：保持适用，按可读内容评分，并在 `deductions` 和 `evidence` 中说明冲突点。
- 证据不足但分数计算超过 `89`：总分封顶 `89`，除非 `evidence` 能覆盖结构、完整度、复用性和验证闭环。
- JSON 字段缺失或 `score` 与分项不一致时，输出前必须自检并补齐字段。

## 人工卡口

本 Skill 只负责打分和给出改进建议，不能替负责人自动处置文档。

- `score < 55` 时设置 `needsReview: true`，`reviewReason` 写明需要人工复核的主因。
- `score >= 90` 时必须至少提供 3 条有效 `evidence`；证据不足时按异常处理封顶。
- `applicable: false` 的文档不计入 Markdown 文档质量统计，也不作为低分文档处罚贡献人。
- 疑似源文件损坏、正文读取异常、路径权限异常时设置 `needsReview: true`，但不得删除缓存或隐藏产物。
- 不得因为低分自动隐藏、作废、改贡献人、改版本或修改源文件；这些动作只能由负责人在工作台明确操作。

## 等级

- `excellent`：85 到 100，文档可稳定复用。
- `good`：70 到 84，文档可用，局部需要补强。
- `watch`：55 到 69，有沉淀价值，但复用或验收闭环不足。
- `weak`：1 到 54，质量不足，建议补写或暂不作为有效沉淀。
- `not_applicable`：不适用本 Skill。

## 输出格式

必须只输出 JSON，不输出 Markdown 解释，不加代码围栏。

```json
{
  "applicable": true,
  "score": 78,
  "level": "good",
  "scoreName": "Markdown 文档质量分",
  "notApplicableReason": null,
  "needsReview": false,
  "reviewReason": "",
  "breakdown": {
    "structure": 12,
    "completeness": 19,
    "reusability": 16,
    "validation": 13,
    "maintainability": 6,
    "readability": 8
  },
  "deduction": {
    "total": 0,
    "items": []
  },
  "summary": "文档结构基本完整，能支持美术成员复用，但验证闭环和维护信息不足。",
  "strengths": [
    "适用场景清楚",
    "资源位置说明明确"
  ],
  "deductions": [
    "缺少成功/失败判断标准",
    "缺少更新时间或维护线索"
  ],
  "suggestions": [
    "补充验收检查点",
    "补充不适用场景",
    "补充关联资源路径或维护负责人"
  ],
  "evidence": [
    {
      "dimension": "reusability",
      "text": "文档包含可执行步骤和资源命名示例"
    }
  ]
}
```

字段要求：

- `score` 必须等于各分项总和减扣分后的结果。
- `breakdown` 六个字段必须都存在。
- `deduction.total` 必须是所有扣分项之和。
- `notApplicableReason` 适用时为 `null`，不适用时必须写明确原因。
- `needsReview` 必须是布尔值，低分、异常、高分证据不足或读取异常时设为 `true`。
- `reviewReason` 在 `needsReview` 为 `true` 时必须有内容。
- `deductions` 写扣分原因，最多 6 条。
- `suggestions` 写可执行改进建议，最多 6 条。
- `evidence` 写评分依据片段，最多 5 条，每条不要超过 40 个中文字。

## 工作流

1. 判断是否适用本 Skill。
2. 提取标题、章节、列表、路径、资源、步骤、标准、风险和维护信息。
3. 按六个分项评分。
4. 按扣分规则扣分。
5. 输出严格 JSON。

## 自检与验证提示词

修改或接入本 Skill 后，用以下提示词做最小验证，确认输出都能稳定解析成 JSON。

- `请用 markdown-quality-auditor 评分：一份完整的角色皮肤制作规范，包含适用场景、资源路径、尺寸、流程、验收标准和维护负责人。`
- `请用 markdown-quality-auditor 评分：一个只有标题和共享盘链接的 Markdown 文件。`
- `请用 markdown-quality-auditor 评分：一个普通前端项目 README，只包含 npm install、npm run build 和依赖说明。`
- `请用 markdown-quality-auditor 评分：一个包含 frontmatter、触发词和 Agent 工作流的 SKILL.md。`
- `请用 markdown-quality-auditor 评分：一份美术资源整理说明，有路径和资源名，但没有验收标准、失败标准和维护人。`

## 禁止事项

- 不得把普通 Markdown 判定为 Skill。
- 不得因为文档被调用过就提高质量分。
- 不得因为贡献人身份、团队成员身份或来源路径给额外加分。
- 不得输出无法解析的自然语言。
- 不得修改 Markdown 正文、源文件、版本、贡献人或调用次数。
- 不得在评分失败时清空或覆盖平台旧缓存。
