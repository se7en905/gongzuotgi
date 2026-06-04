import mysql from 'mysql2/promise';

const config = {
  host: process.env.MYSQL_HOST || '192.168.23.55',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'agent_workflow',
  password: process.env.MYSQL_PASSWORD || 'AgentWorkflow@123',
  database: process.env.MYSQL_DATABASE || 'agent_workflow_platform',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  charset: 'utf8mb4'
};

let pool;

export function getMysqlPool() {
  if (!pool) pool = mysql.createPool(config);
  return pool;
}

export async function closeMysqlStore() {
  if (!pool) return;
  const target = pool;
  pool = null;
  await target.end();
}

export async function ensureMysqlStore() {
  await getMysqlPool().query('SELECT 1');
  await ensureOperationLogsTable();
  await ensureAiFlowRecordsTable();
  await ensureArtBriefsTable();
}

export async function readMysqlCollection(table, fallback = []) {
  const [rows] = await getMysqlPool().query(`SELECT raw_json FROM ${quoteIdent(table)}`);
  if (!rows.length) return fallback;
  return rows.map(row => parseJson(row.raw_json)).filter(Boolean);
}

export async function writeMysqlCollection(table, values = []) {
  const rows = Array.isArray(values) ? values : [];
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SET FOREIGN_KEY_CHECKS=0');
    await connection.query(`TRUNCATE TABLE ${quoteIdent(table)}`);
    for (const value of rows) {
      await insertRow(connection, table, value);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS=1');
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function readMysqlConfig(key, fallback = {}) {
  const [rows] = await getMysqlPool().execute(
    'SELECT config_value FROM platform_kv_config WHERE config_key = ? LIMIT 1',
    [key]
  );
  if (!rows.length) return fallback;
  return parseJson(rows[0].config_value) ?? fallback;
}

export async function writeMysqlConfig(key, value = {}) {
  await getMysqlPool().execute(
    `INSERT INTO platform_kv_config (config_key, config_value)
     VALUES (?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = CURRENT_TIMESTAMP(3)`,
    [key, JSON.stringify(value ?? null)]
  );
}

async function ensureOperationLogsTable() {
  await getMysqlPool().query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台操作审计日志表'
  `);
}

async function ensureAiFlowRecordsTable() {
  await getMysqlPool().query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 任务全流程人工记录表'
  `);
}

async function ensureArtBriefsTable() {
  await getMysqlPool().query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='禅道美术摘要复用表'
  `);
}

async function insertRow(connection, table, value) {
  const row = rowForTable(table, value);
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  await connection.execute(
    `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES (${placeholders})`,
    columns.map(column => row[column])
  );
}

function rowForTable(table, item = {}) {
  const raw_json = JSON.stringify(item ?? {});
  const maps = {
    projects: {
      id: str(item.id),
      name: str(item.name || item.id),
      root_path: str(item.rootPath),
      framework: str(item.framework || 'unknown'),
      agent_config_path: str(item.agentConfigPath || 'AGENTS.md'),
      skill_config_path: str(item.skillConfigPath || '.agent-hub/config.md'),
      task_dir: str(item.taskDir || '.task'),
      created_at: mysqlDate(item.createdAt),
      raw_json
    },
    tasks: {
      id: str(item.id),
      project_id: str(item.projectId),
      task_no: str(item.taskNo),
      title: str(item.title),
      developer: str(item.developer),
      source: str(item.source),
      status: str(item.status),
      zentao_status: str(item.zentaoStatus),
      is_current: item.isCurrent === false ? 0 : 1,
      deadline: str(item.deadline),
      completion: int(item.completion),
      created_at: mysqlDate(item.createdAt),
      updated_at: mysqlDate(item.updatedAt),
      raw_json
    },
    bugs: {
      id: str(item.id),
      project_id: str(item.projectId),
      bug_no: str(item.bugNo),
      title: str(item.title),
      developer: str(item.developer),
      assigned_to: str(item.assignedTo),
      product_id: str(item.productId),
      status: str(item.status),
      severity: str(item.severity),
      priority: str(item.pri),
      deadline: str(item.deadline),
      opened_at: mysqlDate(item.openedAt),
      created_at: mysqlDate(item.createdAt),
      updated_at: mysqlDate(item.updatedAt),
      raw_json
    },
    ai_flow_records: {
      id: str(item.id),
      project_id: str(item.projectId),
      task_id: str(item.taskId),
      task_no: str(item.taskNo),
      task_title: str(item.taskTitle || item.taskNameAndNo),
      developer: str(item.developer),
      agent_model: str(item.agentModel),
      status: str(item.status),
      source: str(item.source),
      flow_completion: int(item.flowCompletion),
      total_duration: str(item.totalDuration),
      synced_at: mysqlDate(item.importedAt || item.updatedAt),
      created_at: mysqlDate(item.createdAt),
      updated_at: mysqlDate(item.updatedAt),
      raw_json
    },
    task_reviews: {
      id: str(item.id),
      project_id: str(item.projectId),
      task_id: str(item.taskId),
      run_id: str(item.runId),
      decision: str(item.decision),
      score: int(item.score),
      reviewer: str(item.reviewer),
      created_at: mysqlDate(item.createdAt),
      raw_json
    },
    art_briefs: {
      id: str(item.id),
      project_id: str(item.projectId),
      group_key: str(item.groupKey),
      group_type: str(item.groupType),
      group_title: str(item.groupTitle),
      task_id: str(item.taskId),
      task_no: str(item.taskNo),
      title: str(item.title),
      generated_by: str(item.generatedBy),
      generated_at: mysqlDate(item.generatedAt),
      updated_at: mysqlDate(item.updatedAt),
      report_file: str(item.reportFile),
      raw_json
    },
    runs: {
      id: str(item.id),
      task_id: str(item.taskId),
      project_id: str(item.projectId),
      title: str(item.title),
      workflow: str(item.workflow),
      workflow_level: str(item.workflowLevel),
      source_type: str(item.sourceType),
      status: str(item.status),
      developer: str(item.developer),
      zentao_id: str(item.zentaoId),
      attempt_no: int(item.attemptNo),
      created_at: mysqlDate(item.createdAt),
      started_at: mysqlDate(item.startedAt),
      finished_at: mysqlDate(item.finishedAt),
      updated_at: mysqlDate(item.updatedAt),
      raw_json
    },
    custom_workflows: {
      id: str(item.id),
      name: str(item.name),
      project_id: str(item.projectId),
      created_at: mysqlDate(item.createdAt),
      updated_at: mysqlDate(item.updatedAt),
      raw_json
    },
    roles: {
      id: str(item.id),
      name: str(item.name),
      level: int(item.level),
      system_role: item.system ? 1 : 0,
      disabled: item.disabled ? 1 : 0,
      created_at: mysqlDate(item.createdAt),
      updated_at: mysqlDate(item.updatedAt),
      raw_json
    },
    users: {
      id: str(item.id),
      username: str(item.username),
      display_name: str(item.displayName),
      role_id: str(item.role),
      last_login_at: mysqlDate(item.lastLoginAt),
      created_at: mysqlDate(item.createdAt),
      updated_at: mysqlDate(item.updatedAt),
      raw_json
    },
    sessions: {
      id: str(item.id),
      token: str(item.token),
      user_id: str(item.userId),
      created_at: mysqlDate(item.createdAt),
      expires_at: mysqlDate(item.expiresAt),
      raw_json
    },
    operation_logs: {
      id: str(item.id),
      user_id: str(item.userId),
      username: str(item.username),
      action: str(item.action),
      module: str(item.module),
      target_type: str(item.targetType),
      target_id: str(item.targetId),
      target_name: str(item.targetName),
      result: str(item.result),
      ip: str(item.ip),
      created_at: mysqlDate(item.createdAt),
      raw_json
    }
  };
  const row = maps[table];
  if (!row) throw new Error(`No MySQL table mapping for ${table}`);
  return row;
}

function parseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function str(value) {
  return value === null || value === undefined ? '' : String(value);
}

function int(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function nullableInt(value) {
  if (value === null || value === undefined || value === '') return null;
  return int(value);
}

function mysqlDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function quoteIdent(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}
