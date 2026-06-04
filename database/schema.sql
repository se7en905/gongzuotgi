CREATE DATABASE IF NOT EXISTS agent_workflow_platform
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE agent_workflow_platform;

CREATE TABLE IF NOT EXISTS platform_kv_config (
  config_key VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '配置键，例如 codex-config',
  config_value JSON NOT NULL COMMENT '配置内容 JSON 原文',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台键值配置表，保存非列表型配置';

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '项目唯一标识',
  name VARCHAR(255) NOT NULL COMMENT '项目显示名称',
  root_path VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '项目在服务器或本机的根目录路径',
  framework VARCHAR(64) NOT NULL DEFAULT 'unknown' COMMENT '项目技术框架，例如 nuxt、vue、react',
  agent_config_path VARCHAR(255) NOT NULL DEFAULT 'AGENTS.md' COMMENT '项目 AGENTS.md 配置文件路径',
  skill_config_path VARCHAR(255) NOT NULL DEFAULT '.agent-hub/config.md' COMMENT '技能配置文件路径',
  task_dir VARCHAR(255) NOT NULL DEFAULT '.task' COMMENT '任务产物目录',
  created_at DATETIME(3) NULL COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  raw_json JSON NOT NULL COMMENT '项目完整 JSON 原文，保留所有扩展字段'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='接入项目表';

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '任务唯一标识',
  project_id VARCHAR(128) NOT NULL COMMENT '所属项目 ID',
  task_no VARCHAR(64) NOT NULL DEFAULT '' COMMENT '禅道任务号或业务任务编号',
  title VARCHAR(1024) NOT NULL COMMENT '任务标题',
  developer VARCHAR(255) NOT NULL DEFAULT '' COMMENT '开发负责人',
  source VARCHAR(64) NOT NULL DEFAULT '' COMMENT '任务来源，例如 zentao、manual、platform',
  status VARCHAR(64) NOT NULL DEFAULT '' COMMENT '平台内任务状态',
  zentao_status VARCHAR(64) NOT NULL DEFAULT '' COMMENT '禅道原始状态',
  is_current TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否当前有效任务，1 是，0 已归档',
  deadline VARCHAR(64) NOT NULL DEFAULT '' COMMENT '截止日期',
  completion INT NOT NULL DEFAULT 0 COMMENT '完成度百分比',
  created_at DATETIME(3) NULL COMMENT '创建时间',
  updated_at DATETIME(3) NULL COMMENT '更新时间',
  raw_json JSON NOT NULL COMMENT '任务完整 JSON 原文，包含需求、禅道详情、阶段检查等',
  KEY idx_tasks_project (project_id),
  KEY idx_tasks_task_no (task_no),
  KEY idx_tasks_status (status),
  KEY idx_tasks_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务中心表';

CREATE TABLE IF NOT EXISTS bugs (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT 'Bug 唯一标识',
  project_id VARCHAR(128) NOT NULL COMMENT '所属项目 ID',
  bug_no VARCHAR(64) NOT NULL DEFAULT '' COMMENT '禅道 Bug 编号',
  title VARCHAR(1024) NOT NULL COMMENT 'Bug 标题',
  developer VARCHAR(255) NOT NULL DEFAULT '' COMMENT '开发负责人',
  assigned_to VARCHAR(255) NOT NULL DEFAULT '' COMMENT '当前指派人',
  product_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '禅道产品 ID',
  status VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'Bug 状态',
  severity VARCHAR(64) NOT NULL DEFAULT '' COMMENT '严重程度',
  priority VARCHAR(64) NOT NULL DEFAULT '' COMMENT '优先级',
  deadline VARCHAR(64) NOT NULL DEFAULT '' COMMENT '截止日期',
  opened_at DATETIME(3) NULL COMMENT 'Bug 创建或打开时间',
  created_at DATETIME(3) NULL COMMENT '平台记录创建时间',
  updated_at DATETIME(3) NULL COMMENT '平台记录更新时间',
  raw_json JSON NOT NULL COMMENT 'Bug 完整 JSON 原文，包含禅道详情',
  KEY idx_bugs_project (project_id),
  KEY idx_bugs_bug_no (bug_no),
  KEY idx_bugs_status (status),
  KEY idx_bugs_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Bug 列表表';

CREATE TABLE IF NOT EXISTS runs (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '执行记录唯一标识',
  task_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '关联任务 ID',
  project_id VARCHAR(128) NOT NULL COMMENT '所属项目 ID',
  title VARCHAR(1024) NOT NULL COMMENT '执行标题',
  workflow VARCHAR(128) NOT NULL DEFAULT '' COMMENT '工作流类型',
  workflow_level VARCHAR(32) NOT NULL DEFAULT '' COMMENT '工作量或流程等级',
  source_type VARCHAR(64) NOT NULL DEFAULT '' COMMENT '来源类型，例如 task、bug',
  status VARCHAR(64) NOT NULL DEFAULT '' COMMENT '执行状态',
  developer VARCHAR(255) NOT NULL DEFAULT '' COMMENT '执行人或开发负责人',
  zentao_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '关联禅道 ID',
  attempt_no INT NOT NULL DEFAULT 0 COMMENT '第几次执行',
  created_at DATETIME(3) NULL COMMENT '创建时间',
  started_at DATETIME(3) NULL COMMENT '开始执行时间',
  finished_at DATETIME(3) NULL COMMENT '结束执行时间',
  updated_at DATETIME(3) NULL COMMENT '更新时间',
  raw_json JSON NOT NULL COMMENT '执行记录完整 JSON 原文，包含阶段、路径、日志、产物等',
  KEY idx_runs_project (project_id),
  KEY idx_runs_task (task_id),
  KEY idx_runs_status (status),
  KEY idx_runs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 执行记录表';

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '用户唯一标识',
  username VARCHAR(128) NOT NULL COMMENT '登录用户名',
  display_name VARCHAR(255) NOT NULL DEFAULT '' COMMENT '显示名称',
  role_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '角色 ID',
  last_login_at DATETIME(3) NULL COMMENT '最后登录时间',
  created_at DATETIME(3) NULL COMMENT '创建时间',
  updated_at DATETIME(3) NULL COMMENT '更新时间',
  raw_json JSON NOT NULL COMMENT '用户完整 JSON 原文，包含项目权限、密码哈希等',
  UNIQUE KEY uk_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台用户表';

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '角色唯一标识',
  name VARCHAR(255) NOT NULL COMMENT '角色名称',
  level INT NOT NULL DEFAULT 0 COMMENT '角色等级，数值越大权限越高',
  system_role TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否系统内置角色，1 是，0 否',
  disabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否禁用，1 禁用，0 启用',
  created_at DATETIME(3) NULL COMMENT '创建时间',
  updated_at DATETIME(3) NULL COMMENT '更新时间',
  raw_json JSON NOT NULL COMMENT '角色完整 JSON 原文，包含权限列表'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色权限表';

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '登录会话唯一标识',
  token VARCHAR(255) NOT NULL COMMENT '登录令牌',
  user_id VARCHAR(128) NOT NULL COMMENT '用户 ID',
  created_at DATETIME(3) NULL COMMENT '创建时间',
  expires_at DATETIME(3) NULL COMMENT '过期时间',
  raw_json JSON NOT NULL COMMENT '会话完整 JSON 原文',
  UNIQUE KEY uk_sessions_token (token),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录会话表';

CREATE TABLE IF NOT EXISTS operation_logs (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '操作日志唯一标识',
  user_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '操作用户 ID，登录失败等场景可为空',
  username VARCHAR(128) NOT NULL DEFAULT '' COMMENT '操作用户名',
  action VARCHAR(128) NOT NULL DEFAULT '' COMMENT '操作动作编码',
  module VARCHAR(64) NOT NULL DEFAULT '' COMMENT '业务模块',
  target_type VARCHAR(64) NOT NULL DEFAULT '' COMMENT '操作对象类型',
  target_id VARCHAR(255) NOT NULL DEFAULT '' COMMENT '操作对象 ID',
  target_name VARCHAR(512) NOT NULL DEFAULT '' COMMENT '操作对象名称',
  result VARCHAR(32) NOT NULL DEFAULT 'success' COMMENT '操作结果 success/fail',
  ip VARCHAR(128) NOT NULL DEFAULT '' COMMENT '客户端 IP',
  created_at DATETIME(3) NULL COMMENT '操作时间',
  raw_json JSON NOT NULL COMMENT '操作日志完整 JSON 原文，包含描述、差异、请求信息等',
  KEY idx_operation_logs_user (user_id),
  KEY idx_operation_logs_module_action (module, action),
  KEY idx_operation_logs_target (target_type, target_id),
  KEY idx_operation_logs_result (result),
  KEY idx_operation_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台操作审计日志表';

CREATE TABLE IF NOT EXISTS custom_workflows (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '自定义工作流唯一标识',
  name VARCHAR(255) NOT NULL COMMENT '工作流名称',
  project_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '绑定项目 ID，空表示通用',
  created_at DATETIME(3) NULL COMMENT '创建时间',
  updated_at DATETIME(3) NULL COMMENT '更新时间',
  raw_json JSON NOT NULL COMMENT '自定义工作流完整 JSON 原文，包含阶段配置'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='自定义工作流表';

CREATE TABLE IF NOT EXISTS task_reviews (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '人工复核记录唯一标识',
  project_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '所属项目 ID',
  task_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '关联任务 ID',
  run_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '关联执行记录 ID',
  decision VARCHAR(64) NOT NULL DEFAULT '' COMMENT '复核结论',
  score INT NOT NULL DEFAULT 0 COMMENT '总评分',
  reviewer VARCHAR(255) NOT NULL DEFAULT '' COMMENT '复核人',
  created_at DATETIME(3) NULL COMMENT '创建时间',
  raw_json JSON NOT NULL COMMENT '人工复核完整 JSON 原文',
  KEY idx_task_reviews_project (project_id),
  KEY idx_task_reviews_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务人工复核表';

CREATE TABLE IF NOT EXISTS art_briefs (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT '美术摘要唯一标识',
  project_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '所属项目 ID',
  group_key VARCHAR(255) NOT NULL DEFAULT '' COMMENT '主单复用键，优先需求 ID',
  group_type VARCHAR(64) NOT NULL DEFAULT '' COMMENT '主单类型 story/parent/storyTitle/task',
  group_title VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '主单或需求标题',
  task_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '首次生成时关联任务 ID',
  task_no VARCHAR(64) NOT NULL DEFAULT '' COMMENT '首次生成时禅道任务号',
  title VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '首次生成任务标题',
  generated_by VARCHAR(128) NOT NULL DEFAULT '' COMMENT '生成人账号 ID',
  generated_at DATETIME(3) NULL COMMENT '生成时间',
  updated_at DATETIME(3) NULL COMMENT '更新时间',
  report_file VARCHAR(2048) NOT NULL DEFAULT '' COMMENT '摘要 HTML 文件路径',
  raw_json JSON NOT NULL COMMENT '美术摘要完整 JSON 原文',
  UNIQUE KEY uk_art_briefs_project_group (project_id, group_key),
  KEY idx_art_briefs_task_no (task_no),
  KEY idx_art_briefs_generated_at (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='禅道美术摘要复用表';

CREATE TABLE IF NOT EXISTS ai_flow_records (
  id VARCHAR(128) NOT NULL PRIMARY KEY COMMENT 'AI 全流程人工记录唯一标识',
  project_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '所属项目 ID',
  task_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '关联平台任务 ID，可为空',
  task_no VARCHAR(64) NOT NULL DEFAULT '' COMMENT '禅道任务号或业务任务编号',
  task_title VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '任务标题',
  developer VARCHAR(255) NOT NULL DEFAULT '' COMMENT '执行开发人员',
  agent_model VARCHAR(512) NOT NULL DEFAULT '' COMMENT '使用智能体和模型',
  status VARCHAR(64) NOT NULL DEFAULT 'draft' COMMENT '记录状态 draft/confirmed/deleted',
  source VARCHAR(64) NOT NULL DEFAULT 'manual' COMMENT '来源 manual/sheet-import',
  flow_completion INT NOT NULL DEFAULT 0 COMMENT '全流程完成度百分比',
  total_duration VARCHAR(255) NOT NULL DEFAULT '' COMMENT '生成总时长',
  synced_at DATETIME(3) NULL COMMENT '表格导入或最近同步时间',
  created_at DATETIME(3) NULL COMMENT '创建时间',
  updated_at DATETIME(3) NULL COMMENT '更新时间',
  raw_json JSON NOT NULL COMMENT 'AI 全流程人工记录完整 JSON 原文',
  KEY idx_ai_flow_project (project_id),
  KEY idx_ai_flow_task_no (task_no),
  KEY idx_ai_flow_developer (developer),
  KEY idx_ai_flow_status (status),
  KEY idx_ai_flow_completion (flow_completion),
  KEY idx_ai_flow_synced_at (synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 任务全流程人工记录表';
