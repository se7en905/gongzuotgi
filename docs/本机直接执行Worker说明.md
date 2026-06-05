# 本机直接执行 Worker 说明

本说明用于第一版“选择 Skill / md 后直接操作 Figma”的无对话执行场景。

## 执行边界

- 平台只负责任务派发、日志归档和结果展示。
- Codex 执行发生在组员自己的电脑上。
- Figma 写入使用组员本机 Codex 里配置的 Figma MCP。
- Figma 授权使用组员自己的 Figma 账号。
- 平台不保存 Figma OAuth token，也不使用负责人本机插件或负责人 Figma 权限。

## 组员本机前置条件

1. 已安装并登录 Codex CLI。
2. Codex CLI 已能正常运行 `codex exec`。
3. 已按团队要求配置 Figma MCP。
4. Figma MCP 已完成组员本人 Figma OAuth 授权。
5. 组员本人对目标 Figma 文件具备写入权限。
6. 能访问美术工作台平台地址。

## 启动方式

在平台项目目录执行：

```bash
ART_PLATFORM_API=http://127.0.0.1:4288 \
ART_PLATFORM_USERNAME=组员账号 \
ART_PLATFORM_PASSWORD=组员密码 \
node scripts/art-direct-worker.mjs
```

如果平台部署在局域网服务器，将 `ART_PLATFORM_API` 改成服务器地址。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `ART_PLATFORM_API` | 美术工作台 API 地址 |
| `ART_PLATFORM_USERNAME` | 组员平台账号 |
| `ART_PLATFORM_PASSWORD` | 组员平台密码 |
| `ART_WORKER_DEVICE_ID` | 可选，本机设备标识 |
| `ART_WORKER_POLL_INTERVAL_MS` | 可选，领取任务轮询间隔，默认 10000 |
| `CODEX_CLI_PATH` | 可选，Codex CLI 路径 |
| `ART_WORKER_PROJECT_ROOT` | 可选，Codex 执行根目录，默认当前目录 |

## 直接执行流程

1. 负责人或组员在平台创建“直接执行”。
2. 平台记录 Figma 链接、Skill / md 路径、执行人和要求。
3. 对应组员本机 Worker 领取任务。
4. Worker 在本机调用 `codex exec --json`。
5. Codex 使用组员本机 Figma MCP 写入 Figma。
6. Worker 回传执行日志和最终状态。
7. 平台执行台展示结果、阻塞原因和报告入口。

## 常见阻塞

- `codex` 命令不可用：检查 Codex CLI 安装和 PATH。
- Figma MCP 未配置：按团队 Figma MCP 配置说明重新接入。
- Figma OAuth 失效：在组员本机重新授权。
- Figma 链接无 `node-id`：第一版建议提供明确 Frame 或节点链接。
- Figma 文件无编辑权限：让文件所有者给组员开通编辑权限。

