import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

let api;
let modules;

export async function getZentaoApi() {
  if (!api) {
    const loaded = await loadZentaoModules();
    api = loaded.createClientFromCli({ argv: [], env: zentaoEnv() });
  }
  return api;
}

export function resetZentaoApi() {
  api = null;
}

export async function getZentaoModules() {
  return loadZentaoModules();
}

function zentaoEnv() {
  return {
    ...loadStoredZentaoEnv(),
    ...process.env
  };
}

function loadStoredZentaoEnv() {
  const config = readZentaoCliConfig();
  const env = {};
  if (config.zentaoUrl) env.ZENTAO_URL = config.zentaoUrl;
  if (config.zentaoAccount) env.ZENTAO_ACCOUNT = config.zentaoAccount;
  if (config.zentaoPassword) env.ZENTAO_PASSWORD = config.zentaoPassword;
  return env;
}

function readZentaoCliConfig() {
  const candidates = [
    process.env.ZENTAO_CONFIG_FILE,
    path.join(os.homedir(), '.config', 'zentao', 'config.toml'),
    path.join(os.homedir(), '.zentao-config', '.config', 'zentao', 'config.toml')
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const text = readFileSyncUtf8(file);
      const config = {};
      for (const key of ['zentaoUrl', 'zentaoAccount', 'zentaoPassword']) {
        const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\n]+)["']?`, 'm'));
        if (match) config[key] = match[1].trim();
      }
      if (config.zentaoUrl || config.zentaoAccount || config.zentaoPassword) return config;
    } catch {
      // CLI 配置不存在时继续使用环境变量或 zentao-mcp 自身读取逻辑。
    }
  }
  return {};
}

function readFileSyncUtf8(file) {
  return readFileSync(file, 'utf8');
}

async function loadZentaoModules() {
  if (modules) return modules;
  const root = await resolveZentaoMcpRoot();
  const [client, bugs, executions, products, tasks, users] = await Promise.all([
    importModule(root, 'src/zentao/client.js'),
    importModule(root, 'src/zentao/bugs.js'),
    importModule(root, 'src/zentao/executions.js'),
    importModule(root, 'src/zentao/products.js'),
    importModule(root, 'src/zentao/tasks.js'),
    importModule(root, 'src/zentao/users.js')
  ]);
  modules = {
    createClientFromCli: client.createClientFromCli,
    getBug: bugs.getBug,
    listBugs: bugs.listBugs,
    listExecutions: executions.listExecutions,
    listProducts: products.listProducts,
    getTask: tasks.getTask,
    listTasks: tasks.listTasks,
    listUsers: users.listUsers
  };
  return modules;
}

async function importModule(root, relativePath) {
  return import(pathToFileURL(path.join(root, relativePath)).href);
}

async function resolveZentaoMcpRoot() {
  const candidates = [
    process.env.ZENTAO_MCP_ROOT,
    path.join(process.cwd(), 'node_modules', '@leeguoo', 'zentao-mcp'),
    await npmRootCandidate(),
    path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '@leeguoo', 'zentao-mcp'),
    '/opt/homebrew/lib/node_modules/@leeguoo/zentao-mcp',
    '/usr/local/lib/node_modules/@leeguoo/zentao-mcp'
  ].filter(Boolean);

  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (await exists(path.join(root, 'src', 'zentao', 'client.js'))) return root;
  }

  throw new Error(
    'Cannot find @leeguoo/zentao-mcp. Install it globally or set ZENTAO_MCP_ROOT to the package directory.'
  );
}

async function npmRootCandidate() {
  try {
    const root = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return path.join(root, '@leeguoo', 'zentao-mcp');
  } catch {
    return '';
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
