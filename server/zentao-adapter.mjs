import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

let api;
let modules;

export async function getZentaoApi() {
  if (!api) {
    const loaded = await loadZentaoModules();
    api = loaded.createClientFromCli({ argv: [], env: process.env });
  }
  return api;
}

export async function getZentaoModules() {
  return loadZentaoModules();
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
