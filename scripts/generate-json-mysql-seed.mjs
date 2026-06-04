import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const schemaFile = path.join(root, 'database', 'schema.sql');

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

const output = process.argv[2] || path.join(root, 'output', 'mysql-seed.sql');
await fs.mkdir(path.dirname(output), { recursive: true });

const lines = [
  await fs.readFile(schemaFile, 'utf8'),
  'SET NAMES utf8mb4;',
  'SET FOREIGN_KEY_CHECKS=0;'
];

const summary = [];
for (const collection of collections) {
  const records = await readJsonFile(collection.file, collection.defaults);
  const rows = Array.isArray(records) ? records.map(collection.map).filter(row => row.id) : [];
  lines.push(`TRUNCATE TABLE ${quoteIdent(collection.table)};`);
  for (const row of rows) lines.push(insertSql(collection.table, row));
  summary.push({ table: collection.table, rows: rows.length });
}

const configFiles = ['codex-config.json'];
lines.push('TRUNCATE TABLE `platform_kv_config`;');
for (const file of configFiles) {
  const value = await readJsonFile(file, {});
  lines.push(insertSql('platform_kv_config', {
    config_key: file.replace(/\.json$/, ''),
    config_value: json(value)
  }));
}
summary.push({ table: 'platform_kv_config', rows: configFiles.length });

lines.push('SET FOREIGN_KEY_CHECKS=1;');
await fs.writeFile(output, `${lines.join('\n')}\n`);
console.table(summary);
console.log(output);

async function readJsonFile(file, fallback) {
  try {
    const raw = await fs.readFile(path.join(dataDir, file), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function insertSql(table, row) {
  const columns = Object.keys(row);
  return `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns.map(column => sqlValue(row[column])).join(', ')});`;
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
