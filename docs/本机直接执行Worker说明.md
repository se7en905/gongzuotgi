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

直接执行任务不会出现平台服务器侧的“开始”按钮。负责人创建任务后，执行人本机 Worker 在线并通过 Codex / Figma MCP 自检，任务会自动从“待领取”变成“已领取 / 执行中”。

组员当前以 Windows 电脑为主，后续如换成 macOS 使用 macOS 对应命令即可。所有命令都必须在执行人自己的电脑运行。

如果平台地址显示为 `127.0.0.1`，组员 Windows 电脑不能直接使用；需要改成组员能访问的工作台服务器 IP 或域名，例如 `http://192.168.x.x:4288`。

工作台页面上的 `复制手动启动` 和 `复制开机自启` 是双平台命令，复制后会同时包含 Windows PowerShell 段和 macOS 终端段。组员只执行自己电脑系统对应的那一段。

### Windows 手动启动

在执行人 Windows 电脑的 PowerShell 中执行；命令会下载 Worker 到该电脑的用户目录，不需要本机有平台项目代码：

```powershell
$root = "$env:USERPROFILE\ArtDirectWorker"
New-Item -ItemType Directory -Force -Path "$root\scripts" | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri 'http://工作台服务器IP:4288/worker/art-direct-worker.mjs' -OutFile "$root\scripts\art-direct-worker.mjs"
$env:ART_PLATFORM_API = 'http://工作台服务器IP:4288'
$env:ART_PLATFORM_USERNAME = '组员账号'
$env:ART_PLATFORM_PASSWORD = '组员密码'
$env:ART_WORKER_HOME = $root
node "$root\scripts\art-direct-worker.mjs"
```

手动启动适合临时实验或当天手动执行。PowerShell 窗口保持运行，关闭后 Worker 停止。

### macOS 手动启动

在执行人 macOS 电脑执行：

```bash
mkdir -p "$HOME/ArtDirectWorker/scripts"
curl -fsSL 'http://工作台服务器IP:4288/worker/art-direct-worker.mjs' -o "$HOME/ArtDirectWorker/scripts/art-direct-worker.mjs"
ART_PLATFORM_API=http://工作台服务器IP:4288 \
ART_PLATFORM_USERNAME=组员账号 \
ART_PLATFORM_PASSWORD=组员密码 \
ART_WORKER_HOME="$HOME/ArtDirectWorker" \
node "$HOME/ArtDirectWorker/scripts/art-direct-worker.mjs"
```

## 开机自启安装

### Windows 开机自启

在执行人 Windows 电脑的 PowerShell 中执行；命令会下载 Worker 和安装脚本到该电脑的用户目录，并写入当前 Windows 用户的启动项，不需要管理员权限：

```powershell
$root = "$env:USERPROFILE\ArtDirectWorker"
New-Item -ItemType Directory -Force -Path "$root\scripts" | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri 'http://工作台服务器IP:4288/worker/art-direct-worker.mjs' -OutFile "$root\scripts\art-direct-worker.mjs"
Invoke-WebRequest -UseBasicParsing -Uri 'http://工作台服务器IP:4288/worker/install_art_direct_worker_windows.ps1' -OutFile "$root\scripts\install_art_direct_worker_windows.ps1"
$env:ART_PLATFORM_API = 'http://工作台服务器IP:4288'
$env:ART_PLATFORM_USERNAME = '组员账号'
$env:ART_PLATFORM_PASSWORD = '组员密码'
$env:ART_WORKER_HOME = $root
powershell -NoProfile -ExecutionPolicy Bypass -File "$root\scripts\install_art_direct_worker_windows.ps1"
```

安装后会写入当前 Windows 用户启动项，组员登录 Windows 时自动启动本机 Worker。重复执行同一段开机自启命令会覆盖同一个启动项，不会创建多份启动配置。

### macOS 开机自启

在执行人 macOS 电脑执行：

```bash
mkdir -p "$HOME/ArtDirectWorker/scripts"
curl -fsSL 'http://工作台服务器IP:4288/worker/art-direct-worker.mjs' -o "$HOME/ArtDirectWorker/scripts/art-direct-worker.mjs"
curl -fsSL 'http://工作台服务器IP:4288/worker/install_art_direct_worker_launch_agent.sh' -o "$HOME/ArtDirectWorker/scripts/install_art_direct_worker_launch_agent.sh"
ART_PLATFORM_API=http://工作台服务器IP:4288 \
ART_PLATFORM_USERNAME=组员账号 \
ART_PLATFORM_PASSWORD=组员密码 \
ART_WORKER_HOME="$HOME/ArtDirectWorker" \
bash "$HOME/ArtDirectWorker/scripts/install_art_direct_worker_launch_agent.sh"
```

安装后，组员登录 macOS 时会自动启动本机 Worker。状态会显示在工作台的 `本机执行状态` 页面。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `ART_PLATFORM_API` | 美术工作台 API 地址 |
| `ART_PLATFORM_USERNAME` | 组员平台账号 |
| `ART_PLATFORM_PASSWORD` | 组员平台密码 |
| `ART_WORKER_DEVICE_ID` | 可选，本机设备标识 |
| `ART_WORKER_POLL_INTERVAL_MS` | 可选，兜底任务轮询间隔，默认 300000 |
| `ART_WORKER_HEARTBEAT_INTERVAL_MS` | 可选，最近心跳刷新间隔，默认 300000 |
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

## 心跳与轮询频率

- Worker 启动后先上报一次本机准备状态。
- Worker 会监听工作台实时事件；平台创建或更新直接执行时，优先通过事件唤醒 Worker 立即检查任务。
- 默认每 5 分钟兜底检查一次是否有分配给自己的直接执行任务，用于实时事件断线或网络抖动后的补偿。
- 默认每 5 分钟刷新一次最近心跳，避免频繁写入工作台数据文件。
- 工作台前端按 10 分钟内有心跳判断为在线，避免低频心跳被误判离线。
- 空轮询没有任务时不追加数据，也不反复刷新最近心跳；只有定时心跳或实际领取任务时才更新 Worker 状态。

## 常见阻塞

- `codex` 命令不可用：检查 Codex CLI 安装和 PATH。
- Figma MCP 未配置：按团队 Figma MCP 配置说明重新接入。
- Figma OAuth 失效：在组员本机重新授权。
- Figma 链接无 `node-id`：第一版建议提供明确 Frame 或节点链接。
- Figma 文件无编辑权限：让文件所有者给组员开通编辑权限。
