USE agent_workflow_platform;

ALTER TABLE platform_kv_config
  MODIFY config_key VARCHAR(128) NOT NULL COMMENT '配置键，例如 codex-config',
  MODIFY config_value JSON NOT NULL COMMENT '配置内容 JSON 原文',
  MODIFY updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  COMMENT='平台键值配置表，保存非列表型配置';

ALTER TABLE projects
  MODIFY id VARCHAR(128) NOT NULL COMMENT '项目唯一标识',
  MODIFY name VARCHAR(255) NOT NULL COMMENT '项目显示名称',
  MODIFY root_path VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '项目在服务器或本机的根目录路径',
  MODIFY framework VARCHAR(64) NOT NULL DEFAULT 'unknown' COMMENT '项目技术框架，例如 nuxt、vue、react',
  MODIFY agent_config_path VARCHAR(255) NOT NULL DEFAULT 'AGENTS.md' COMMENT '项目 AGENTS.md 配置文件路径',
  MODIFY skill_config_path VARCHAR(255) NOT NULL DEFAULT '.agent-hub/config.md' COMMENT '技能配置文件路径',
  MODIFY task_dir VARCHAR(255) NOT NULL DEFAULT '.task' COMMENT '任务产物目录',
  MODIFY created_at DATETIME(3) NULL COMMENT '创建时间',
  MODIFY updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  MODIFY raw_json JSON NOT NULL COMMENT '项目完整 JSON 原文，保留所有扩展字段',
  COMMENT='接入项目表';

ALTER TABLE tasks
  MODIFY id VARCHAR(128) NOT NULL COMMENT '任务唯一标识',
  MODIFY project_id VARCHAR(128) NOT NULL COMMENT '所属项目 ID',
  MODIFY task_no VARCHAR(64) NOT NULL DEFAULT '' COMMENT '禅道任务号或业务任务编号',
  MODIFY title VARCHAR(1024) NOT NULL COMMENT '任务标题',
  MODIFY developer VARCHAR(255) NOT NULL DEFAULT '' COMMENT '开发负责人',
  MODIFY source VARCHAR(64) NOT NULL DEFAULT '' COMMENT '任务来源，例如 zentao、manual、platform',
  MODIFY status VARCHAR(64) NOT NULL DEFAULT '' COMMENT '平台内任务状态',
  MODIFY zentao_status VARCHAR(64) NOT NULL DEFAULT '' COMMENT '禅道原始状态',
  MODIFY is_current TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否当前有效任务，1 是，0 已归档',
  MODIFY deadline VARCHAR(64) NOT NULL DEFAULT '' COMMENT '截止日期',
  MODIFY completion INT NOT NULL DEFAULT 0 COMMENT '完成度百分比',
  MODIFY created_at DATETIME(3) NULL COMMENT '创建时间',
  MODIFY updated_at DATETIME(3) NULL COMMENT '更新时间',
  MODIFY raw_json JSON NOT NULL COMMENT '任务完整 JSON 原文，包含需求、禅道详情、阶段检查等',
  COMMENT='任务中心表';

ALTER TABLE bugs
  MODIFY id VARCHAR(128) NOT NULL COMMENT 'Bug 唯一标识',
  MODIFY project_id VARCHAR(128) NOT NULL COMMENT '所属项目 ID',
  MODIFY bug_no VARCHAR(64) NOT NULL DEFAULT '' COMMENT '禅道 Bug 编号',
  MODIFY title VARCHAR(1024) NOT NULL COMMENT 'Bug 标题',
  MODIFY developer VARCHAR(255) NOT NULL DEFAULT '' COMMENT '开发负责人',
  MODIFY assigned_to VARCHAR(255) NOT NULL DEFAULT '' COMMENT '当前指派人',
  MODIFY product_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '禅道产品 ID',
  MODIFY status VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'Bug 状态',
  MODIFY severity VARCHAR(64) NOT NULL DEFAULT '' COMMENT '严重程度',
  MODIFY priority VARCHAR(64) NOT NULL DEFAULT '' COMMENT '优先级',
  MODIFY deadline VARCHAR(64) NOT NULL DEFAULT '' COMMENT '截止日期',
  MODIFY opened_at DATETIME(3) NULL COMMENT 'Bug 创建或打开时间',
  MODIFY created_at DATETIME(3) NULL COMMENT '平台记录创建时间',
  MODIFY updated_at DATETIME(3) NULL COMMENT '平台记录更新时间',
  MODIFY raw_json JSON NOT NULL COMMENT 'Bug 完整 JSON 原文，包含禅道详情',
  COMMENT='Bug 列表表';

ALTER TABLE runs
  MODIFY id VARCHAR(128) NOT NULL COMMENT '执行记录唯一标识',
  MODIFY task_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '关联任务 ID',
  MODIFY project_id VARCHAR(128) NOT NULL COMMENT '所属项目 ID',
  MODIFY title VARCHAR(1024) NOT NULL COMMENT '执行标题',
  MODIFY workflow VARCHAR(128) NOT NULL DEFAULT '' COMMENT '工作流类型',
  MODIFY workflow_level VARCHAR(32) NOT NULL DEFAULT '' COMMENT '工作量或流程等级',
  MODIFY source_type VARCHAR(64) NOT NULL DEFAULT '' COMMENT '来源类型，例如 task、bug',
  MODIFY status VARCHAR(64) NOT NULL DEFAULT '' COMMENT '执行状态',
  MODIFY developer VARCHAR(255) NOT NULL DEFAULT '' COMMENT '执行人或开发负责人',
  MODIFY zentao_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '关联禅道 ID',
  MODIFY attempt_no INT NOT NULL DEFAULT 0 COMMENT '第几次执行',
  MODIFY created_at DATETIME(3) NULL COMMENT '创建时间',
  MODIFY started_at DATETIME(3) NULL COMMENT '开始执行时间',
  MODIFY finished_at DATETIME(3) NULL COMMENT '结束执行时间',
  MODIFY updated_at DATETIME(3) NULL COMMENT '更新时间',
  MODIFY raw_json JSON NOT NULL COMMENT '执行记录完整 JSON 原文，包含阶段、路径、日志、产物等',
  COMMENT='AI 执行记录表';

ALTER TABLE users
  MODIFY id VARCHAR(128) NOT NULL COMMENT '用户唯一标识',
  MODIFY username VARCHAR(128) NOT NULL COMMENT '登录用户名',
  MODIFY display_name VARCHAR(255) NOT NULL DEFAULT '' COMMENT '显示名称',
  MODIFY role_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '角色 ID',
  MODIFY last_login_at DATETIME(3) NULL COMMENT '最后登录时间',
  MODIFY created_at DATETIME(3) NULL COMMENT '创建时间',
  MODIFY updated_at DATETIME(3) NULL COMMENT '更新时间',
  MODIFY raw_json JSON NOT NULL COMMENT '用户完整 JSON 原文，包含项目权限、密码哈希等',
  COMMENT='平台用户表';

ALTER TABLE roles
  MODIFY id VARCHAR(128) NOT NULL COMMENT '角色唯一标识',
  MODIFY name VARCHAR(255) NOT NULL COMMENT '角色名称',
  MODIFY level INT NOT NULL DEFAULT 0 COMMENT '角色等级，数值越大权限越高',
  MODIFY system_role TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否系统内置角色，1 是，0 否',
  MODIFY disabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否禁用，1 禁用，0 启用',
  MODIFY created_at DATETIME(3) NULL COMMENT '创建时间',
  MODIFY updated_at DATETIME(3) NULL COMMENT '更新时间',
  MODIFY raw_json JSON NOT NULL COMMENT '角色完整 JSON 原文，包含权限列表',
  COMMENT='角色权限表';

ALTER TABLE sessions
  MODIFY id VARCHAR(128) NOT NULL COMMENT '登录会话唯一标识',
  MODIFY token VARCHAR(255) NOT NULL COMMENT '登录令牌',
  MODIFY user_id VARCHAR(128) NOT NULL COMMENT '用户 ID',
  MODIFY created_at DATETIME(3) NULL COMMENT '创建时间',
  MODIFY expires_at DATETIME(3) NULL COMMENT '过期时间',
  MODIFY raw_json JSON NOT NULL COMMENT '会话完整 JSON 原文',
  COMMENT='登录会话表';

ALTER TABLE custom_workflows
  MODIFY id VARCHAR(128) NOT NULL COMMENT '自定义工作流唯一标识',
  MODIFY name VARCHAR(255) NOT NULL COMMENT '工作流名称',
  MODIFY project_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '绑定项目 ID，空表示通用',
  MODIFY created_at DATETIME(3) NULL COMMENT '创建时间',
  MODIFY updated_at DATETIME(3) NULL COMMENT '更新时间',
  MODIFY raw_json JSON NOT NULL COMMENT '自定义工作流完整 JSON 原文，包含阶段配置',
  COMMENT='自定义工作流表';

ALTER TABLE task_reviews
  MODIFY id VARCHAR(128) NOT NULL COMMENT '人工复核记录唯一标识',
  MODIFY project_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '所属项目 ID',
  MODIFY task_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '关联任务 ID',
  MODIFY run_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '关联执行记录 ID',
  MODIFY decision VARCHAR(64) NOT NULL DEFAULT '' COMMENT '复核结论',
  MODIFY score INT NOT NULL DEFAULT 0 COMMENT '总评分',
  MODIFY reviewer VARCHAR(255) NOT NULL DEFAULT '' COMMENT '复核人',
  MODIFY created_at DATETIME(3) NULL COMMENT '创建时间',
  MODIFY raw_json JSON NOT NULL COMMENT '人工复核完整 JSON 原文',
  COMMENT='任务人工复核表';

ALTER TABLE ai_flow_records
  MODIFY id VARCHAR(128) NOT NULL COMMENT 'AI 全流程人工记录唯一标识',
  MODIFY project_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '所属项目 ID',
  MODIFY task_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '关联平台任务 ID，可为空',
  MODIFY task_no VARCHAR(64) NOT NULL DEFAULT '' COMMENT '禅道任务号或业务任务编号',
  MODIFY task_title VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '任务标题',
  MODIFY developer VARCHAR(255) NOT NULL DEFAULT '' COMMENT '执行开发人员',
  MODIFY agent_model VARCHAR(512) NOT NULL DEFAULT '' COMMENT '使用智能体和模型',
  MODIFY status VARCHAR(64) NOT NULL DEFAULT 'draft' COMMENT '记录状态 draft/confirmed/deleted',
  MODIFY source VARCHAR(64) NOT NULL DEFAULT 'manual' COMMENT '来源 manual/sheet-import',
  MODIFY flow_completion INT NOT NULL DEFAULT 0 COMMENT '全流程完成度百分比',
  MODIFY total_duration VARCHAR(255) NOT NULL DEFAULT '' COMMENT '生成总时长',
  MODIFY synced_at DATETIME(3) NULL COMMENT '表格导入或最近同步时间',
  MODIFY created_at DATETIME(3) NULL COMMENT '创建时间',
  MODIFY updated_at DATETIME(3) NULL COMMENT '更新时间',
  MODIFY raw_json JSON NOT NULL COMMENT 'AI 全流程人工记录完整 JSON 原文',
  COMMENT='AI 任务全流程人工记录表';
