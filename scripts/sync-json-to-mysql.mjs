import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const schemaFile = path.join(root, 'database', 'schema.sql');

const config = {
  host: process.env.MYSQL_HOST || '192.168.23.55',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'agent_workflow',
  password: process.env.MYSQL_PASSWORD || 'AgentWorkflow@123',
  database: process.env.MYSQL_DATABASE || 'agent_workflow_platform'
};

const collections = [
  {
    file: 'projects.json',
    table: 'projects',
    defaults: [],
    map: item => ({
      id: str(item.id),
      name: str(item.name || item.id),
      root_path: str(item.rootPath),
      framework: str(item.framework || 'unknown'),
      agent_config_path: str(item.agentConfigPath || 'AGENTS.md'),
      skill_config_path: str(item.skillConfigPath || '.agent-hub/config.md'),
      task_dir: str(item.taskDir || '.task'),
      created_at: mysqlDate(item.createdAt),
      raw_json: json(item)
    })
  },
  {
    file: 'tasks.json',
    table: 'tasks',
    defaults: [],
    map: item => ({
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
      raw_json: json(item)
    })
  },
  {
    file: 'bugs.json',
    table: 'bugs',
    defaults: [],
    map: item => ({
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
      raw_json: json(item)
    })
  },
  {
    file: 'runs.json',
    table: 'runs',
    defaults: [],
    map: item => ({
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
      raw_json: json(item)
    })
  },
  {
    file: 'users.json',
    table: 'users',
    defaults: [],
    map: item => ({
      id: str(item.id),
      username: str(item.username),
      display_name: str(item.displayName),
      role_id: str(item.role),
      last_login_at: mysqlDate(item.lastLoginAt),
      created_at: mysqlDate(item.createdAt),
      updated_at: mysqlDate(item.updatedAt),
      raw_json: json(item)
    })
  },
  {
    file: 'roles.json',
    table: 'roles',
    defaults: [],
    map: item => ({
      id: str(item.id),
      name: str(item.name),
      level: int(item.level),
      system_role: item.system ? 1 : 0,
      disabled: item.disabled ? 1 : 0,
      created_at: mysqlDate(item.createdAt),
      updated_at: mysqlDate(item.updatedAt),
      raw_json: json(item)
    })
  },
  {
    file: 'sessions.json',
    table: 'sessions',
    defaults: [],
    map: item => ({
      id: str(item.id),
      token: str(item.token),
      user_id: str(item.userId),
      created_at: mysqlDate(item.createdAt),
      expires_at: mysqlDate(item.expiresAt),
      raw_json: json(item)
    })
  },
  {
    file: 'custom-workflows.json',
    table: 'custom_workflows',
    defaults: [],
    map: item => ({
      id: str(item.id),
      name: str(item.name),
      project_id: str(item.projectId),
      created_at: mysqlDate(item.createdAt),
      updated_at: mysqlDate(item.updatedAt),
      raw_json: json(item)
    })
  },
  {
    file: 'task-reviews.json',
    table: 'task_reviews',
    defaults: [],
    map: item => ({
      id: str(item.id),
      project_id: str(item.projectId),
      task_id: str(item.taskId),
      run_id: str(item.runId),
      decision: str(item.decision),
      score: int(item.score),
      reviewer: str(item.reviewer),
      created_at: mysqlDate(item.createdAt),
      raw_json: json(item)
    })
  },
  {
    file: 'operation-logs.json',
    table: 'operation_logs',
    defaults: [],
    map: item => ({
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
      raw_json: json(item)
    })
  }
];

const configFiles = [
  'codex-config.json'
];

await checkTcp(config.host, config.port);
await applySchema();

const summary = [];
for (const collection of collections) {
  const records = await readJsonFile(collection.file, collection.defaults);
  const rows = Array.isArray(records) ? records.map(collection.map).filter(row => row.id) : [];
  if (rows.length) {
    await replaceRows(collection.table, rows);
  } else {
    await truncateTable(collection.table);
  }
  summary.push({ table: collection.table, rows: rows.length });
}

for (const file of configFiles) {
  const value = await readJsonFile(file, {});
  await replaceRows('platform_kv_config', [{
    config_key: file.replace(/\.json$/, ''),
    config_value: json(value)
  }]);
  summary.push({ table: 'platform_kv_config', key: file.replace(/\.json$/, ''), rows: 1 });
}

console.table(summary);

async function applySchema() {
  const schema = await fs.readFile(schemaFile, 'utf8');
  await runMysql(schema);
}

async function replaceRows(table, rows) {
  await runMysql(`SET FOREIGN_KEY_CHECKS=0;\nTRUNCATE TABLE ${quoteIdent(table)};\nSET FOREIGN_KEY_CHECKS=1;`);
  if (!rows.length) return;
  for (const row of rows) {
    const columns = Object.keys(row);
    const sql = [
      `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES`,
      `(${columns.map(column => sqlValue(row[column])).join(', ')});`
    ].join('\n');
    await runMysql(sql);
  }
}

async function truncateTable(table) {
  await runMysql(`SET FOREIGN_KEY_CHECKS=0;\nTRUNCATE TABLE ${quoteIdent(table)};\nSET FOREIGN_KEY_CHECKS=1;`);
}

async function readJsonFile(file, fallback) {
  try {
    const raw = await fs.readFile(path.join(dataDir, file), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function runMysql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('mysql', [
      '--protocol=TCP',
      `--host=${config.host}`,
      `--port=${config.port}`,
      `--user=${config.user}`,
      `--password=${config.password}`,
      '--default-character-set=utf8mb4',
      '--binary-mode=1'
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `mysql exited with ${code}`));
    });
    child.stdin.end(sql);
  });
}

function checkTcp(host, port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port, timeout: 5000 });
    socket.once('connect', () => {
      socket.end();
      resolve();
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`Cannot connect to ${host}:${port}`));
    });
    socket.once('error', reject);
  });
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

function json(value) {
  return JSON.stringify(value ?? null);
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

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}
