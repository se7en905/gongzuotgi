#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const codexHomeDir = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const legacyToolDir = path.join(codexHomeDir, 'art-workbench');

loadEnvFiles([
  path.join(scriptDir, '.env'),
  path.join(legacyToolDir, '.env')
]);

const args = parseArgs(process.argv.slice(2));
const apiBases = resolveApiBases(args);
const eventKey = String(args.eventKey || process.env.ART_WORKBENCH_EVENT_KEY || '').trim();

if (args.retireLegacy !== '0') {
  await retireLegacyReporter({ quiet: !args.retireLegacyOnly && !args.verbose });
}

if (args.retireLegacyOnly) {
  console.log('旧版 member-art-reporter 废弃检查完成。');
  process.exit(0);
}

if (!eventKey) fail('缺少 ART_WORKBENCH_EVENT_KEY 或 --event-key，无法同步到美术工作台。');

if (args.flushOnly) {
  const result = await flushPendingEvents();
  console.log(result.pendingCount ? `补传完成，仍待补传 ${result.pendingCount} 条。` : '待补传队列已清空。');
  process.exit(0);
}

const items = normalizeUsageItems(args);
if (!items.length) fail('缺少 --path 或 --items-json，无法记录调用次数。');

await flushPendingEvents();

const results = [];
for (const item of items) {
  const event = buildEvent(item, args);
  const result = await sendEventToAll(event);
  for (const failed of result.failed) await enqueuePendingEvent(failed.event, failed.apiBase);
  results.push({
    target: event.repoPath || event.skillName,
    count: item.count,
    sent: result.sent.length,
    queued: result.failed.length
  });
}

console.log(JSON.stringify({ ok: true, results, pendingCount: await pendingCount() }, null, 2));

function normalizeUsageItems(input = {}) {
  const rows = [];
  if (input.itemsJson) {
    try {
      const parsed = JSON.parse(String(input.itemsJson));
      if (Array.isArray(parsed)) rows.push(...parsed);
      else if (parsed && typeof parsed === 'object') rows.push(parsed);
    } catch (error) {
      fail(`--items-json 不是合法 JSON：${error.message}`);
    }
  }
  if (input.itemsFile) {
    const file = path.resolve(String(input.itemsFile));
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) rows.push(...parsed);
      else if (parsed && typeof parsed === 'object') rows.push(parsed);
    } catch (error) {
      fail(`无法读取 --items-file：${error.message}`);
    }
  }
  if (input.path || input.name || input.skillId || input.skillName) {
    rows.push({
      path: input.path || input.repoPath || '',
      name: input.name || input.skillName || '',
      skillId: input.skillId || '',
      count: input.count || 1
    });
  }
  return rows.map(row => {
    const resourcePath = cleanPath(row.path || row.repoPath || row.filePath || row.skillPath || '');
    const name = cleanString(row.name || row.skillName || row.title || path.basename(resourcePath || ''));
    const count = Math.max(1, Math.floor(Number(row.count || row.usageCount || 1)));
    return {
      path: resourcePath,
      name,
      skillId: cleanString(row.skillId || slugFromPath(resourcePath || name)),
      count
    };
  }).filter(row => row.path || row.name || row.skillId);
}

function buildEvent(item = {}, input = {}) {
  const date = normalizeDate(input.date || new Date());
  const memberAccount = cleanString(input.memberAccount || process.env.ART_MEMBER_ACCOUNT || os.userInfo().username || process.env.USER || '');
  const memberName = cleanString(input.memberName || process.env.ART_MEMBER_NAME || memberAccount);
  const displayName = item.name || path.basename(item.path || '') || item.skillId || '未命名资源';
  const eventId = dailyEventId(date, memberAccount, item.path || displayName);
  return {
    id: eventId,
    eventType: 'skill_called',
    title: `每日调用汇总：${displayName}`,
    memberAccount,
    memberName,
    skillId: item.skillId,
    skillName: displayName,
    repoPath: item.path,
    projectId: cleanString(input.projectId || process.env.ART_PLATFORM_PROJECT_ID || ''),
    projectName: cleanString(input.projectName || ''),
    status: 'completed',
    summary: `${memberName || memberAccount || '成员'} 在 ${date} 调用 ${displayName} ${item.count} 次。`,
    metadata: {
      source: 'report-skill-usage',
      dailyUsageReport: true,
      usageDate: date,
      usageCount: item.count,
      artifactName: displayName,
      artifactPath: item.path,
      skillPath: item.path,
      calledArtifacts: [{ id: item.skillId, name: displayName, path: item.path, count: item.count }],
      skipValidationAutoBackfill: true
    }
  };
}

async function sendEventToAll(event, targets = apiBases) {
  const sent = [];
  const failed = [];
  for (const apiBase of targets) {
    try {
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
      sent.push({ apiBase, id: result.event?.id || result.id || event.id });
    } catch (error) {
      if (!shouldQueueError(error)) fail(error.message || String(error));
      failed.push({ apiBase, event, error: error.message || String(error) });
    }
  }
  return { sent, failed };
}

async function flushPendingEvents() {
  const file = pendingQueueFile();
  if (!existsSync(file)) return { pendingCount: 0 };
  const rows = readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!rows.length) {
    await writePendingRows([]);
    return { pendingCount: 0 };
  }
  const remaining = [];
  for (const line of rows) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const event = item.event || item;
    const targets = item.apiBase ? [item.apiBase] : apiBases;
    const result = await sendEventToAll(event, targets);
    for (const failed of result.failed) {
      remaining.push(JSON.stringify({ apiBase: failed.apiBase, event: failed.event, queuedAt: item.queuedAt || new Date().toISOString() }));
    }
  }
  await writePendingRows(remaining);
  return { pendingCount: remaining.length };
}

async function enqueuePendingEvent(event, apiBase) {
  await mkdir(path.dirname(pendingQueueFile()), { recursive: true });
  await appendFile(pendingQueueFile(), `${JSON.stringify({ apiBase, event, queuedAt: new Date().toISOString() })}\n`, 'utf8');
}

async function pendingCount() {
  const file = pendingQueueFile();
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim()).length;
}

async function writePendingRows(rows = []) {
  await mkdir(path.dirname(pendingQueueFile()), { recursive: true });
  await writeFile(pendingQueueFile(), rows.length ? `${rows.join('\n')}\n` : '', 'utf8');
}

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
  if (!values.length) push('http://127.0.0.1:4288');
  return values;
}

function pendingQueueFile() {
  return path.join(scriptDir, 'pending-skill-usage.jsonl');
}

function dailyEventId(date = '', member = '', target = '') {
  const hash = createHash('sha1').update([date, member, target].join('::')).digest('hex').slice(0, 24);
  return `skill-usage-${hash}`;
}

function slugFromPath(value = '') {
  return cleanString(value)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join('-')
    .replace(/\.(md|markdown)$/i, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function cleanPath(value = '') {
  return cleanString(value).replace(/\\/g, '/').replace(/^\/+/, '');
}

function cleanString(value = '') {
  return String(value ?? '').trim();
}

function normalizeDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cleanString(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function shouldQueueError(error) {
  const status = Number(error?.status || 0);
  if (status === 400 || status === 401 || status === 403) return false;
  return true;
}

function parseArgs(argv = []) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = camelCase(item.slice(2));
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function camelCase(value = '') {
  return String(value).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

async function retireLegacyReporter(options = {}) {
  const markerFile = path.join(legacyToolDir, '.member-art-reporter-retired.json');
  const legacyPaths = [
    path.join(codexHomeDir, 'skills', 'art-progress-reporter'),
    path.join(codexHomeDir, 'skills', 'art-workbench-sync-reporter'),
    path.join(codexHomeDir, 'skills', 'codex-progress-reporter')
  ];
  const launchAgent = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.artworkbench.researchsync.plist');
  const legacyToolFiles = [
    'auto-sync-art-workbench.mjs',
    'report-codex-today.mjs',
    'report-art-progress-event.mjs',
    'report-test.sh',
    'report-research.sh',
    'report-codex-today.sh',
    'report-test.ps1',
    'report-research.ps1',
    'report-codex-today.ps1',
    'auto-sync-hidden.vbs',
    'auto-sync-loop-hidden.vbs'
  ].map(name => path.join(legacyToolDir, name));
  const found = [
    ...legacyPaths,
    launchAgent,
    ...legacyToolFiles
  ].some(item => existsSync(item)) || legacyRulesExist();
  if (!found && existsSync(markerFile)) return;

  const actions = [];
  if (process.platform === 'darwin' && existsSync(launchAgent)) {
    runQuiet('launchctl', ['bootout', `gui/${process.getuid?.() || ''}`, launchAgent]);
    runQuiet('launchctl', ['unload', launchAgent]);
    await removePath(launchAgent, actions);
  }
  if (process.platform === 'win32') {
    runQuiet('schtasks.exe', ['/Delete', '/TN', 'ArtWorkbenchResearchSync', '/F']);
    const startupDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    await removePath(path.join(startupDir, 'ArtWorkbenchResearchSync.lnk'), actions);
    await removePath(path.join(startupDir, 'ArtWorkbenchResearchSync.cmd'), actions);
  }
  for (const target of legacyPaths) await removePath(target, actions);
  for (const target of legacyToolFiles) await removePath(target, actions);
  await removeLegacyAgentRules(actions);
  await mkdir(legacyToolDir, { recursive: true });
  await writeFile(markerFile, JSON.stringify({
    retiredAt: new Date().toISOString(),
    retiredBy: 'report-skill-usage',
    actions
  }, null, 2), 'utf8');
  if (!options.quiet) console.log(`旧版 member-art-reporter 已废弃：${actions.length} 项。`);
}

async function removePath(target, actions = []) {
  if (!target || !existsSync(target)) return;
  await rm(target, { recursive: true, force: true });
  actions.push(`removed ${target}`);
}

function legacyRulesExist() {
  const agentsFile = path.join(codexHomeDir, 'AGENTS.md');
  if (!existsSync(agentsFile)) return false;
  const raw = readFileSync(agentsFile, 'utf8');
  return /ART_WORKBENCH_RESEARCH_SYNC_START|CODEX_PROGRESS_REPORTER_START|美术工作台 AI 研究沉淀|art-progress-reporter|art-workbench-sync-reporter/.test(raw);
}

async function removeLegacyAgentRules(actions = []) {
  const agentsFile = path.join(codexHomeDir, 'AGENTS.md');
  if (!existsSync(agentsFile)) return;
  const raw = readFileSync(agentsFile, 'utf8');
  const next = raw
    .replace(/<!-- ART_WORKBENCH_RESEARCH_SYNC_START -->[\s\S]*?<!-- ART_WORKBENCH_RESEARCH_SYNC_END -->\s*/g, '')
    .replace(/<!-- CODEX_PROGRESS_REPORTER_START -->[\s\S]*?<!-- CODEX_PROGRESS_REPORTER_END -->\s*/g, '')
    .replace(/^# Codex 进度[\s\S]*?(?=^# |\s*$)/gm, '')
    .trimEnd();
  if (next !== raw.trimEnd()) {
    await writeFile(agentsFile, `${next}\n`, 'utf8');
    actions.push(`updated ${agentsFile}`);
  }
}

function runQuiet(command, argv = []) {
  try {
    spawnSync(command, argv.filter(Boolean), { stdio: 'ignore' });
  } catch {
    // 清理旧安装时忽略系统命令失败，后续删除文件仍会继续。
  }
}

function loadEnvFiles(files = []) {
  for (const envPath of files) {
    if (!existsSync(envPath)) continue;
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
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
