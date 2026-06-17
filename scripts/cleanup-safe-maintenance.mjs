import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const workspaceDir = path.join(root, 'workspace');
const apply = !process.argv.includes('--dry-run');
const minAgeMs = Math.max(60_000, Number(process.env.AWP_SAFE_CLEAN_TMP_MIN_AGE_MS || 10 * 60 * 1000));
const ignoredDirs = new Set(['.git', 'node_modules', 'dist']);

const deleted = [];
const skipped = [];

await cleanDsStores(root);
await cleanStaleJsonTmp(dataDir);
await cleanOrphanRunWorkspaces();

console.log(apply ? '安全维护清理完成' : '安全维护清理预览');
for (const item of deleted) {
  console.log(`- 已${apply ? '清理' : '匹配'}：${path.relative(root, item.file)}，${formatBytes(item.size)}。${item.reason}`);
}
for (const item of skipped) {
  console.log(`- 跳过：${path.relative(root, item.file)}。${item.reason}`);
}
if (!deleted.length && !skipped.length) console.log('- 暂无可清理项。');
console.log('说明：本脚本只处理 .DS_Store、过期 JSON 写入临时文件，以及 runs.json 已不存在的孤儿执行工作区；不会删除业务 JSON、有效执行工作区、artifacts 或正式产物。');

async function cleanDsStores(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) await cleanDsStores(target);
      continue;
    }
    if (entry.isFile() && entry.name === '.DS_Store') {
      await removeSafeFile(target, 'macOS Finder 元数据文件');
    }
  }
}

async function cleanStaleJsonTmp(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) await cleanStaleJsonTmp(target);
      continue;
    }
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(.+\.json)\.(\d+)\.[0-9a-f-]+\.tmp$/i);
    if (!match) continue;
    const baseFile = path.join(dir, match[1]);
    const pid = Number(match[2]);
    const [tmpStat, baseExists] = await Promise.all([
      fs.stat(target).catch(() => null),
      fileExists(baseFile)
    ]);
    if (!tmpStat) continue;
    if (!baseExists) {
      skipped.push({ file: target, reason: '未找到对应正式 JSON，避免误删。' });
      continue;
    }
    const ageMs = Date.now() - tmpStat.mtimeMs;
    if (ageMs < minAgeMs) {
      skipped.push({ file: target, reason: `临时文件未超过 ${Math.round(minAgeMs / 60000)} 分钟。` });
      continue;
    }
    if (pid && processAlive(pid)) {
      skipped.push({ file: target, reason: `写入进程 ${pid} 仍可能存在。` });
      continue;
    }
    await removeSafeFile(target, '过期 JSON 原子写入临时文件', tmpStat.size);
  }
}

async function cleanOrphanRunWorkspaces() {
  const runs = await readJson(path.join(dataDir, 'runs.json'), []);
  const runIds = new Set((Array.isArray(runs) ? runs : []).map(run => String(run?.id || '').trim()).filter(Boolean));
  const entries = await fs.readdir(workspaceDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'artifacts') continue;
    if (!isUuid(entry.name) || runIds.has(entry.name)) continue;
    const target = path.join(workspaceDir, entry.name);
    const size = await directorySize(target);
    if (apply) await fs.rm(target, { recursive: true, force: true });
    deleted.push({ file: target, reason: '已不在 runs.json 中的孤儿执行工作区目录', size });
  }
}

async function removeSafeFile(file, reason, knownSize = 0) {
  const stat = knownSize ? { size: knownSize } : await fs.stat(file).catch(() => null);
  if (!stat) return;
  if (apply) await fs.unlink(file);
  deleted.push({ file, reason, size: stat.size || 0 });
}

async function fileExists(file) {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function directorySize(dir) {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(target);
    else if (entry.isFile()) total += (await fs.stat(target)).size;
  }
  return total;
}

function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function formatBytes(value = 0) {
  const size = Number(value || 0);
  if (size < 1024) return `${size}B`;
  const units = ['KB', 'MB', 'GB'];
  let current = size / 1024;
  for (const unit of units) {
    if (current < 1024 || unit === units.at(-1)) return `${current.toFixed(current >= 10 ? 1 : 2)}${unit}`;
    current /= 1024;
  }
  return `${size}B`;
}
