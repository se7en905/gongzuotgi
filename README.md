# 美术部工作台

面向美术部门任务管理、AI 协作、资源沉淀和验证回填的可视化平台。当前版本以美术负责人和组员协作视角为主，只保留美术工作台需要的任务、执行、资源、验证、研究同步和权限治理能力。

## 项目定位

- 作为美术部门新版工作台运行，不替代禅道，不默认回写禅道原字段。
- 以“禅道任务 -> 成员负载 -> 卡点识别 -> 美术摘要 -> AI 执行 -> 研究同步 -> AI 资源沉淀 -> 验证回填”为主线组织页面。
- 兼容 Codex 驱动的单次执行、多阶段协作流程和组员本地上报。
- 适合管理美术项目、AI 资源清单、成员产物、验证记录和历史任务沉淀。

## 当前能力

- 任务中心
  - 展示禅道任务和 Bug。
  - 支持同步禅道任务、Bug，并保留已有列表缓存。
  - 展示成员任务卡片、人员承接评估、任务明细和执行入口。
- AI 资源与产物
  - 从配置的资料库和 `data/art-git` 扫描 Skill、MD、成员产物与项目资料。
  - 支持刷新库存、查看资源详情、维护别名、统计调用次数。
  - 按成员归档产物，负责人可查看部门累计和成员明细。
- 验证回填
  - 支持从部门验证表和组员上报记录归档验证信息。
  - 只展示能映射到 AI 资源清单或成员产物的验证记录。
  - 不符合验证范畴的内容收纳到明细日志，便于负责人追溯。
- 研究同步
  - 接收组员本地 Codex 使用过程中的研究进展、工具调用和阶段产物。
  - 支持查看、编辑、删除研究记录和操作日志。
  - 操作日志默认仅负责人可见。
- 执行协作
  - 通过 `codex exec` 在目标项目根目录真实执行任务。
  - 通过 SSE 展示实时日志、状态流转和产物。
  - 支持执行记录、产物预览、人工复核和任务备注。
- 平台治理
  - 账号、角色、权限管理。
  - 平台操作日志审计。
  - 工作台中涉及负责人视角的日志和管理入口均通过权限控制。

## 技术架构

- 界面：Vue 3 + Vite + Element Plus
- 后端：Node.js HTTP API + SSE
- 存储：默认本地 JSON，可按需切换 MySQL
- 运行模式：开发环境前后端分离，生产环境由 Node 服务同时提供 API 和静态资源

关键入口：

- 界面入口：[src/main.js](/Users/se7en/ArtProject/platform/src/main.js)
- 应用壳与路由视图切换：[src/App.vue](/Users/se7en/ArtProject/platform/src/App.vue)
- API 服务入口：[server/server.mjs](/Users/se7en/ArtProject/platform/server/server.mjs)
- 数据访问层：[server/store.mjs](/Users/se7en/ArtProject/platform/server/store.mjs)
- MySQL 访问层：[server/mysql-store.mjs](/Users/se7en/ArtProject/platform/server/mysql-store.mjs)

## 目录说明

```text
platform/
├── src/                    # Vue 页面与组件
├── server/                 # Node API、SSE、鉴权、任务执行、集成逻辑
├── scripts/                # 启动、同步、迁移、补录脚本
├── database/               # MySQL schema 与补充 SQL
├── workspace/              # 运行工作区与平台归档产物
├── data/                   # 本地运行数据、AI 资源缓存、组员上报记录
├── public/                 # 静态资源
└── README.md
```

常见页面与组件位于 `src/views/` 和 `src/components/`：

- `src/App.vue`：应用壳、导航、全局状态、权限判断和核心数据调度。
- `TaskCenterView.vue`：任务中心。
- `SkillInventoryView.vue`：AI 产物清单。
- `AiMembersView.vue`：AI 部门看板。
- `AiArchiveView.vue`：AI 档案。
- `RunsView.vue` / `TaskResultView.vue`：美术执行台与执行产物。
- `AgentWorkersView.vue`：本机执行状态。
- `RoleManagementView.vue`：角色管理。
- `UserAccessView.vue`：账号管理。
- `OperationLogView.vue`：操作日志。
- `src/components/dialogs/`：新建执行、任务同步、Skill 预览、项目接入等弹窗。

项目清理边界参考：[docs/项目清理边界说明.md](/Users/se7en/ArtProject/platform/docs/项目清理边界说明.md)。
低影响维护优化清单参考：[docs/维护优化清单.md](/Users/se7en/ArtProject/platform/docs/维护优化清单.md)。

清理前可先运行只读巡检：

```bash
npm run audit:cleanup
```

这个命令只输出清理候选、数据体量和外部配置线索，不会删除、移动或修改任何文件。

## 环境要求

- Node.js `>= 20`
- pnpm
- 本机可用的 `codex` 命令
- 如需同步禅道，需要禅道网络与账号权限
- 如需启用 MySQL，需要可访问的 MySQL 实例

安装依赖：

```bash
pnpm install
```

## 开发启动

先启动 API：

```bash
pnpm dev:api
```

再启动界面：

```bash
pnpm dev
```

默认地址：

```text
界面：http://127.0.0.1:5173
API：http://127.0.0.1:4288
```

Vite 会把 `/api` 代理到 `http://127.0.0.1:4288`。如需改代理目标，可设置：

```bash
API_PROXY_TARGET=http://127.0.0.1:4288 pnpm dev
```

## 生产启动

```bash
pnpm build
pnpm start
```

`pnpm start` 会启动 [scripts/start-api.mjs](/Users/se7en/ArtProject/platform/scripts/start-api.mjs)，该脚本会清理当前端口上旧的本项目 API 进程，再拉起 [server/server.mjs](/Users/se7en/ArtProject/platform/server/server.mjs) 并服务 `dist/`。

## 远程部署后启动

部署到远程机器后，在项目根目录执行：

```bash
pnpm remote:start
```

等价于：

```bash
bash scripts/start-remote-service.sh
```

这个脚本负责：

- 加载远程环境变量文件
- 用 PM2 启动或重载服务
- 做本机健康检查

默认端口是 `4288`，可覆盖：

```bash
API_PORT=3200 pnpm remote:start
```

可选环境变量：

```bash
ENV_FILE=/path/to/.env.remote
SKIP_PM2_SAVE=1
HEALTH_URL=http://127.0.0.1:3200/
STATIC_DIR=dist
```

## 核心环境变量

### 平台与服务

```bash
API_PORT=4288
PORT=4288
STATIC_DIR=dist
AWP_SESSION_MAX_AGE_MS=604800000
```

### 默认管理员

首次启动且系统内还没有用户时，会自动创建管理员账号：

```bash
AWP_ADMIN_USERNAME=admin
AWP_ADMIN_PASSWORD=请在首次启动前设置
```

如果未设置 `AWP_ADMIN_PASSWORD`，服务启动时会在日志里打印一次随机密码。

### 数据存储

默认使用当前项目内的本地 JSON 数据：`data/*.json`、`data/art-dashboard`、`data/art-git`。

只有明确需要迁移或联调 MySQL 时，才设置：

```bash
AWP_USE_MYSQL=1
```

### MySQL（默认关闭）

```bash
AWP_USE_MYSQL=0
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=agent_workflow
MYSQL_PASSWORD=AgentWorkflow@123
MYSQL_DATABASE=agent_workflow_platform
MYSQL_CONNECTION_LIMIT=10
```

实际表结构与补充 SQL 可参考：

- [database/schema.sql](/Users/se7en/ArtProject/platform/database/schema.sql)
- [database/comments.sql](/Users/se7en/ArtProject/platform/database/comments.sql)

### 禅道自动同步

API 服务启动后会自动同步美术部门未结束任务到任务中心：

- 启动后约 5 秒执行首轮同步
- 默认每 30 分钟同步一次
- 同步项目默认是 `art_department`

常用变量：

```bash
ZENTAO_AUTO_SYNC=0
ZENTAO_AUTO_SYNC_INTERVAL_MS=1800000
ZENTAO_AUTO_SYNC_INITIAL_DELAY_MS=5000
ZENTAO_AUTO_SYNC_PROJECT_ID=art_department
ZENTAO_ART_DEPT_ID=27
ZENTAO_BUG_PRODUCT_IDS=all
```

手动执行同步：

```bash
node scripts/sync-zentao-art-tasks.mjs
node scripts/sync-zentao-art-bugs.mjs
```

## 数据与存储

主要数据包括：

- 项目/资料库
- 禅道任务
- Bug
- AI 档案记录
- AI 资源清单
- 验证回填
- 研究同步记录
- 执行记录
- 自定义工作流
- 角色、用户、会话
- 操作日志
- 平台配置

运行期目录：

- `workspace/<run_id>/`：单次执行工作区
- `workspace/artifacts/`：归档产物
- `data/`：本地数据、缓存和兼容路径
- `outputs/art-briefs/`：任务中心生成的正式美术需求摘要和 AI 工作说明
- `logs/`：平台服务、LaunchAgent 和自动备份日志

手动清理前应先运行 `npm run audit:cleanup`。`data/`、`workspace/`、`workspace/artifacts/`、`outputs/art-briefs/` 不得通过文件系统手动删除；业务数据必须通过工作台页面或对应 API 处理。

如果需要把历史 JSON 数据同步进 MySQL，可执行：

```bash
pnpm db:sync
```

## 账户、角色与权限

平台使用 HTTP-only Cookie 保存会话，默认 Cookie 名称为 `awp_session`。

当前内置角色：

- `admin`：管理员
- `developer`：协作成员
- `reviewer`：美术验证人
- `viewer`：只读

权限模型分三层：

- 菜单权限：如 `menu.workspace`、`menu.tasks`、`menu.operationLogs`
- 按钮权限：如 `project.create`、`run.start`、`role.manage`
- API 权限：如 `api.runs.execute`、`api.roles.manage`、`api.operationLogs.read`

项目级访问通过用户的 `projectIds` 控制；管理员默认拥有全部项目权限。

## 页面与功能分布

- 工作台：整体概览、关键入口
- 任务资产
  - 项目/资料库
  - 任务中心
- AI 与沉淀
  - AI 部门看板
  - AI 资源清单
  - 验证回填
  - 研究同步
  - AI 档案
- 执行协作
  - 任务执行
  - 工作流编排
- 用户管理
  - 账户管理
  - 角色管理
  - 操作日志

这个仓库当前采用“`src/App.vue` 作为应用壳和状态桥接，页面级视图放在 `src/views/*.vue`”的结构，新功能尽量沿用这个边界。

## 常用脚本

```bash
pnpm dev           # 启动界面开发服务
pnpm dev:api       # 启动 API 开发服务
pnpm build         # 构建界面
pnpm start         # 生产方式启动 API + 静态资源
pnpm remote:start  # 远程环境 PM2 启动/重载
pnpm smoke         # 本地冒烟
pnpm db:sync       # JSON 同步到 MySQL
npm run audit:cleanup # 只读清理巡检
```

## 接口概览

README 只列核心分组，完整行为以 [server/server.mjs](/Users/se7en/ArtProject/platform/server/server.mjs) 为准。

### 鉴权与账号

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `GET /api/auth/me`

### 项目与扫描

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id/scan`

### 任务、Bug、执行

- `GET /api/tasks`
- `GET /api/bugs`
- `POST /api/tasks/sync-zentao`
- `POST /api/bugs/sync-zentao`
- `GET /api/runs`
- `POST /api/runs`
- `POST /api/runs/:id/start`
- `POST /api/runs/:id/cancel`
- `GET /api/runs/:id/events`
- `GET /api/runs/:id/artifacts`

### AI 资源、验证与研究同步

- `GET /api/skills/assets`
- `POST /api/skills/assets/refresh`
- `GET /api/skill-validations`
- `POST /api/skill-validations/import-sheet`
- `GET /api/art-progress-events`
- `POST /api/art-progress-events`

### 产物访问

- `GET /api/artifact?path=<absolute-path>`

### 审计

- `GET /api/operation-logs`

## 本地验证

### 冒烟

```bash
pnpm smoke
```

冒烟会验证默认项目至少能扫描到：

- `AGENTS.md`
- `.agent-hub/skills`
- 历史任务沉淀

### 建议验证方式

这个仓库默认更适合做轻量验证，而不是一上来跑全量 TypeScript 检查。常见做法：

- 启动 `pnpm dev:api` + `pnpm dev`
- 登录平台检查主要页面能否打开
- 验证目标功能相关的接口与交互
- 检查执行流、产物预览、SSE 日志是否正常

## 安全约束

平台生成 Codex prompt 时会默认加入禁止命令：

- `pnpm lint:ts`
- `vue-tsc --noEmit`
- `pnpm tsc --noEmit`
- `nuxi typecheck`
- `pnpm build:local`

业务项目自身定义的 `forbiddenCommands` 也会继续合并进 prompt。

另外需要注意：

- Codex 执行会真实运行任务，不是纯模拟。
- 启动执行前应确认目标项目、任务内容和工作流模板。
- 生产环境请替换默认数据库账号密码，不要直接沿用仓库内默认值。

## 当前边界

- 不做拖拽式流程设计器。
- 不主动改业务项目目录结构。
- 不自动把平台状态回写到业务项目仓库。
- 运行自动化能力建立在本机或远程环境已有权限和工具链之上。
