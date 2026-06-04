#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

loadEnvFile();

const args = parseArgs(process.argv.slice(2));
const apiBases = resolveApiBases(args);
const eventKey = String(args.eventKey || process.env.ART_WORKBENCH_EVENT_KEY || '').trim();

if (!eventKey) {
  fail('缺少 ART_WORKBENCH_EVENT_KEY 或 --event-key，无法同步到美术工作台。');
}

if (args.flushOnly) {
  const queueResult = await flushPendingEvents();
  if (queueResult.ok) {
    console.log('待补传队列检查完成。');
    process.exit(0);
  }
  console.log(`工作台暂时无法连接，待补传：${queueResult.pendingCount} 条。`);
  process.exit(0);
}

const payload = {
  eventType: args.eventType || args.type || 'task_progress',
  runId: args.runId || '',
  projectId: args.projectId || '',
  zentaoTaskId: args.zentaoTaskId || args.zentaoId || args.taskNo || '',
  zentaoBugId: args.zentaoBugId || args.bugId || '',
  taskNo: args.taskNo || args.zentaoTaskId || args.zentaoId || '',
  title: args.title || '',
  memberAccount: args.memberAccount || process.env.ART_MEMBER_ACCOUNT || process.env.USER || '',
  memberName: args.memberName || process.env.ART_MEMBER_NAME || '',
  skillId: args.skillId || '',
  skillName: args.skillName || '',
  repoPath: args.repoPath || '',
  stage: args.stage || '',
  status: args.status || '',
  summary: args.summary || '',
  metadata: await metadataFromArgs(args)
};

if (!payload.summary) fail('缺少 --summary，同步内容需要说明本次研究过程或验证结论。');

await flushPendingEvents();
const result = await sendEventToAll(payload);
if (result.failed.length) {
  for (const item of result.failed) await enqueuePendingEvent(item.event, item.apiBase);
  console.log(`已同步 ${result.sent.length} 个工作台；${result.failed.length} 个地址暂时无法连接，已加入自动补传。待补传：${await pendingCount()} 条。`);
  process.exit(0);
}
console.log(JSON.stringify({ ok: true, sent: result.sent }, null, 2));

function resolveApiBases(input = {}) {
  const values = [];
  const push = value => {
    for (const item of String(value || '').split(',')) {
      const normalized = item.trim().replace(/\/+$/, '');
      if (normalized && !values.includes(normalized)) values.push(normalized);
    }
  };
  push(input.apiBase);
  push(process.env.ART_WORKBENCH_API_BASES);
  push(process.env.ART_WORKBENCH_API_BASE);
  push('http://192.168.21.206:4288');
  push('http://192.168.21.42:4288');
  return values;
}

async function sendEventToAll(event, targets = apiBases) {
  const sent = [];
  const failed = [];
  for (const apiBase of targets) {
    try {
      const result = await sendEventToBase(event, apiBase);
      sent.push({ apiBase, id: result.event?.id || result.id || '' });
    } catch (error) {
      if (!shouldQueueError(error)) throw error;
      failed.push({ apiBase, event, error: error.message || String(error) });
    }
  }
  return { sent, failed };
}

async function sendEventToBase(event, apiBase) {
  const response = await fetch(`${apiBase}/api/art-progress-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Art-Event-Key': eventKey
    },
    body: JSON.stringify(event)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || `同步失败：HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

async function flushPendingEvents() {
  const file = pendingQueueFile();
  if (!existsSync(file)) return { ok: true, pendingCount: 0 };
  const rows = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (!rows.length) {
    await writePendingRows([]);
    return { ok: true, pendingCount: 0 };
  }
  const remaining = [];
  let sentCount = 0;
  for (const line of rows) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const event = item.event || item;
    const target = item.apiBase || item.targetApiBase || '';
    const targets = target ? [target] : apiBases;
    const result = await sendEventToAll(event, targets);
    sentCount += result.sent.length;
    for (const failed of result.failed) {
      remaining.push(JSON.stringify({ apiBase: failed.apiBase, event: failed.event, queuedAt: item.queuedAt || new Date().toISOString() }));
    }
  }
  await writePendingRows(remaining);
  if (sentCount) console.log(`已自动补传 ${sentCount} 条目标记录。`);
  return { ok: remaining.length === 0, pendingCount: remaining.length };
}

async function enqueuePendingEvent(event, apiBase) {
  const queued = { apiBase, event, queuedAt: new Date().toISOString() };
  const file = pendingQueueFile();
  await import('node:fs/promises').then(fs => fs.mkdir(path.dirname(file), { recursive: true }));
  await import('node:fs/promises').then(fs => fs.appendFile(file, `${JSON.stringify(queued)}\n`, 'utf8'));
}

async function pendingCount() {
  const file = pendingQueueFile();
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim()).length;
}

async function writePendingRows(rows) {
  const file = pendingQueueFile();
  await import('node:fs/promises').then(fs => fs.mkdir(path.dirname(file), { recursive: true }));
  await import('node:fs/promises').then(fs => fs.writeFile(file, rows.length ? `${rows.join('\n')}\n` : '', 'utf8'));
}

function pendingQueueFile() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'pending-events.jsonl');
}

function shouldQueueError(error) {
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403 || status === 400) return false;
  return true;
}

async function metadataFromArgs(input) {
  const metadata = {};
  if (input.metadata) {
    try { Object.assign(metadata, JSON.parse(input.metadata)); }
    catch { metadata.raw = String(input.metadata); }
  }
  if (input.metadataFile) {
    const file = path.resolve(String(input.metadataFile));
    Object.assign(metadata, JSON.parse(await readFile(file, 'utf8')));
  }
  if (input.evidence) metadata.evidence = input.evidence;
  if (input.savedMinutes) metadata.savedMinutes = Number(input.savedMinutes);
  if (input.accepted != null) metadata.accepted = input.accepted === true || input.accepted === 'true' || input.accepted === '1';
  return metadata;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = camelCase(item.slice(2));
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}

function camelCase(value) {
  return String(value || '').replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadEnvFile() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
