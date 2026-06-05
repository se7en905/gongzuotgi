---
name: art-progress-reporter
description: 美术工作台研究沉淀同步技能。Use when Codex or a group member needs to share AI research topics, tools or Skills used, tested inputs/outputs, findings, blockers, and reusable conclusions back to the local art workbench for team reuse.
author: platform
tags: 美术工作台, 研究沉淀, Skill 使用, AI 工具, 团队复用
triggers: 研究同步, 工具使用同步, Skill 使用记录, 同步工作台, AI 研究同步, 研究结论, 卡点同步, 产物沉淀
---

# 美术工作台研究沉淀同步

## 用途

把 Codex 里的 AI 研究过程、工具试用结果、输入输出材料、问题边界和可复用结论同步到美术工作台，方便团队后续复用和继续完善。

本技能用于团队研究沉淀，不作为禅道任务进度记录，不修改禅道任务字段，不修改任务标题、状态、截止日、工时、父任务或关联需求。

## 同步接口

默认接口：

```text
POST /api/art-progress-events
```

组员电脑默认工作台地址：

```text
http://192.168.21.42:4288/api/art-progress-events
```

环境变量：

```bash
ART_WORKBENCH_API_BASE=http://192.168.21.42:4288
ART_WORKBENCH_EVENT_KEY=团队研究同步密钥
ART_MEMBER_ACCOUNT=组员账号
ART_MEMBER_NAME=组员姓名
```

## 同步脚本

安装后在组员电脑执行：

```bash
~/.codex/art-workbench/report-research.sh tool_used "AI资源命名研究" figma-layer-cleanup "Figma 图层整理" "测试 Figma 切图命名场景，输入 web5-cocos10 页面，发现 icon 容易被识别成 img，需要补充命名反例。"
```

## 类型

- `research_started`：开始一个研究方向。
- `research_progress`：阶段性研究过程。
- `tool_used`：试用了某个 AI 工具、Skill、脚本或流程。
- `research_finding`：形成可沉淀的发现、规则、适用边界或反例。
- `research_blocked`：研究卡住，需要补材料或补样例。
- `research_summary`：一次研究的阶段总结。

## 每次同步建议写清

- 研究主题：例如“AI资源命名研究”“Figma 切图命名规范”“入口图生成流程”。
- 使用工具：例如 Codex、Figma MCP、某个 Skill、脚本、表格、图像生成工具。
- 输入材料：例如 Figma 链接、PSD、资源目录、参考图、需求说明。
- 输出结果：例如文档、规则、截图、脚本、测试结论。
- 发现问题：误识别、漏识别、不稳定、缺少样例、需要人工判断的边界。
- 复用建议：可直接复用、建议小范围复用、需要补材料后再验证。

## 推荐摘要格式

```text
研究主题：
使用工具/Skill：
输入材料：
输出结果：
发现问题：
适用场景：
不适用场景：
下一步：
```

## 禁止事项

- 不得把研究沉淀同步当成任务完成记录。
- 不得借同步接口回写或修改禅道原字段。
- 不得代替他人提交研究内容。
- 未验证通过的结论不得描述为稳定可用。
