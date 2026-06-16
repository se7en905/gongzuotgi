#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { access, mkdir, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const apiBase = normalizeBaseUrl(process.env.ART_PLATFORM_API || process.env.API_BASE || 'http://127.0.0.1:4288');
const username = process.env.ART_PLATFORM_USERNAME || process.env.AWP_USERNAME || '';
const password = process.env.ART_PLATFORM_PASSWORD || process.env.AWP_PASSWORD || '';
const deviceId = process.env.ART_WORKER_DEVICE_ID || `${os.hostname()}-${os.userInfo().username}`;
const pollIntervalMs = Math.max(60000, Number(process.env.ART_WORKER_POLL_INTERVAL_MS || 300000));
const heartbeatIntervalMs = Math.max(60000, Number(process.env.ART_WORKER_HEARTBEAT_INTERVAL_MS || 300000));
const localCheckTimeoutMs = Math.max(5000, Number(process.env.ART_WORKER_CHECK_TIMEOUT_MS || 15000));
const localCheckIntervalMs = Math.max(60000, Number(process.env.ART_WORKER_LOCAL_CHECK_INTERVAL_MS || 2400000));
const requestTimeoutMs = Math.max(5000, Number(process.env.ART_WORKER_API_TIMEOUT_MS || 15000));
const workerHome = process.env.ART_WORKER_HOME || path.join(os.homedir(), 'ArtDirectWorker');
const codexPath = resolveCodexPath();
const defaultProjectRoot = process.env.ART_WORKER_PROJECT_ROOT || workerHome || process.cwd();
const offlineQueuePath = process.env.ART_WORKER_OFFLINE_QUEUE_PATH || path.join(workerHome, 'state', 'offline-run-updates.json');
const runStateDir = process.env.ART_WORKER_RUN_STATE_DIR || path.join(workerHome, 'state', 'runs');
const offlineQueueMaxItems = Math.max(20, Number(process.env.ART_WORKER_OFFLINE_QUEUE_MAX_ITEMS || 200));
const offlineLogChunkMaxChars = Math.max(1000, Number(process.env.ART_WORKER_OFFLINE_LOG_CHUNK_MAX_CHARS || 8000));
const runEventQueueMaxItems = Math.max(20, Number(process.env.ART_WORKER_RUN_EVENT_QUEUE_MAX_ITEMS || 500));
const selfUpdateEnabled = !['0', 'false', 'no'].includes(String(process.env.ART_WORKER_SELF_UPDATE || '1').toLowerCase());
const selfUpdateIntervalMs = Math.max(300000, Number(process.env.ART_WORKER_SELF_UPDATE_INTERVAL_MS || 1800000));
const selfUpdateUrl = process.env.ART_WORKER_SELF_UPDATE_URL || `${apiBase}/worker/art-direct-worker.mjs`;
const selfScriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

let cookie = '';
let currentUser = null;
let lastHeartbeatAt = 0;
let checkingRuns = false;
let eventSyncStarted = false;
let lastLocalCheckAt = 0;
let lastOfflineNoticeAt = 0;
let lastSelfUpdateAt = 0;
let selfUpdateRunning = false;
let selfRestartScheduled = false;
let offlineQueueOperation = Promise.resolve();
let localChecks = {
  codexReady: false,
  figmaMcpReady: false,
  codexMessage: '',
  figmaMessage: ''
};

main().catch(error => {
  console.error(`[worker] 启动失败：${error.message}`);
  process.exitCode = 1;
});

async function main() {
  await mkdir(runStateDir, { recursive: true });
  await waitForLogin();
  console.log(`[worker] 已登录 ${apiBase}，当前账号：${currentUser?.displayName || currentUser?.username || username}`);
  await heartbeat(true);
  localChecks = await refreshLocalChecks(true);
  console.log(`[worker] 已连接 ${apiBase}，当前账号：${currentUser?.displayName || currentUser?.username || username}`);
  console.log(`[worker] Codex: ${localChecks.codexMessage}`);
  console.log(`[worker] Figma MCP: ${localChecks.figmaMessage}`);
  await heartbeat(true);
  startPlatformEventSync();
  while (true) {
    try {
      await refreshLocalChecks();
      await flushOfflineQueue();
      await syncLocalRunState();
      await checkSelfUpdate();
      await heartbeat();
      await checkAndExecuteNextRun();
    } catch (error) {
      console.error(`[worker] ${error.message}`);
      if (/401|登录态|认证/.test(error.message)) await relogin();
    }
    await sleep(pollIntervalMs);
  }
}

async function waitForLogin() {
  while (true) {
    try {
      await login();
      return;
    } catch (error) {
      console.error(`[worker] 平台登录失败，30 秒后重试：${error.message}`);
      await sleep(30000);
    }
  }
}

async function relogin() {
  try {
    await login();
    await heartbeat(true);
  } catch (error) {
    console.error(`[worker] 平台重新登录失败，稍后继续重试：${error.message}`);
  }
}

async function login() {
  if (!username || !password) throw new Error('缺少 ART_PLATFORM_USERNAME / ART_PLATFORM_PASSWORD。');
  const response = await fetchJson('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    includeRaw: true
  });
  cookie = parseSetCookie(response.raw.headers.get('set-cookie'));
  currentUser = response.value.user;
  if (!cookie || !currentUser) throw new Error('平台登录失败，未获得有效登录态。');
}

async function heartbeat(force = false) {
  const now = Date.now();
  if (!force && now - lastHeartbeatAt < heartbeatIntervalMs) return;
  await fetchJson('/api/agent-workers/heartbeat', {
    method: 'POST',
    body: workerPayload()
  });
  lastHeartbeatAt = now;
}

async function claimNextRun() {
  if (!localChecks.codexReady || !localChecks.figmaMcpReady) return null;
  const result = await fetchJson('/api/agent-runs/next', {
    method: 'POST',
    body: workerPayload()
  });
  return result.run || null;
}

async function claimRecoverableRun(runId = '') {
  if (!localChecks.codexReady || !localChecks.figmaMcpReady) return null;
  const result = await fetchJson('/api/agent-runs/recover', {
    method: 'POST',
    body: {
      ...workerPayload(),
      runId
    }
  });
  return result.run || null;
}

async function claimLocalRecoverableRun() {
  const states = await listRunStates();
  const pending = states.filter(state => state?.runId && state.startedAt && !state.finishedAt);
  for (const state of pending) {
    const run = await claimRecoverableRun(state.runId).catch(error => {
      if (/404|not found/i.test(error.message)) void removeRunState(state.runId);
      else logOfflineNotice(`本机执行恢复查询失败，稍后重试：${error.message}`);
      return null;
    });
    if (run) return run;
  }
  return null;
}

async function refreshLocalChecks(force = false) {
  const now = Date.now();
  if (!force && now - lastLocalCheckAt < localCheckIntervalMs) return localChecks;
  localChecks = await runLocalChecks();
  lastLocalCheckAt = now;
  return localChecks;
}

async function checkSelfUpdate(force = false) {
  const now = Date.now();
  if (!selfUpdateEnabled || !selfScriptPath || selfUpdateRunning || selfRestartScheduled) return false;
  if (!force && now - lastSelfUpdateAt < selfUpdateIntervalMs) return false;
  selfUpdateRunning = true;
  lastSelfUpdateAt = now;
  const tempPath = `${selfScriptPath}.next-${Date.now()}`;
  try {
    const latest = await fetchText(`${selfUpdateUrl}${selfUpdateUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
    if (!isValidWorkerScript(latest)) throw new Error('服务端返回的 Worker 脚本内容不完整，已跳过自更新。');
    const current = await readFile(selfScriptPath, 'utf8').catch(() => '');
    if (normalizeScriptForCompare(current) === normalizeScriptForCompare(latest)) return false;
    await writeFile(tempPath, latest, 'utf8');
    await rename(tempPath, selfScriptPath);
    console.log('[worker] 已自动更新 Worker 脚本，准备重启以载入新版本。');
    scheduleSelfRestart();
    return true;
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    logOfflineNotice(`Worker 自更新失败，稍后重试：${error.message}`);
    return false;
  } finally {
    selfUpdateRunning = false;
  }
}

function isValidWorkerScript(text = '') {
  const value = String(text || '');
  return value.includes('art-direct-worker')
    && value.includes('async function main()')
    && value.includes('ART_WORKER_SELF_UPDATE_INTERVAL_MS')
    && value.includes('/api/agent-runs/next');
}

function normalizeScriptForCompare(text = '') {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function scheduleSelfRestart() {
  if (selfRestartScheduled) return;
  selfRestartScheduled = true;
  setTimeout(() => {
    const supervised = process.env.ART_WORKER_SUPERVISED === '1';
    if (!supervised) {
      try {
        const child = spawn(process.execPath, process.argv.slice(1), {
          cwd: process.cwd(),
          env: process.env,
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
      } catch (error) {
        console.error(`[worker] 自更新后重启失败：${error.message}`);
      }
    }
    process.exit(0);
  }, 1000);
}

async function checkAndExecuteNextRun() {
  if (checkingRuns) return;
  checkingRuns = true;
  try {
    await flushOfflineQueue();
    while (true) {
      const run = await claimLocalRecoverableRun() || await claimNextRun();
      if (!run) break;
      await executeRun(run);
      await flushOfflineQueue();
      await syncLocalRunState();
      await heartbeat(true);
    }
  } finally {
    checkingRuns = false;
  }
}

async function wakeForRunChange(event = null) {
  if (!shouldWakeForRunEvent(event)) return;
  await refreshLocalChecks(false).catch(error => {
    console.error(`[worker] 本机自检失败，稍后重试：${error.message}`);
    return localChecks;
  });
  await heartbeat(true).catch(error => {
    logOfflineNotice(`心跳恢复失败，稍后重试：${error.message}`);
  });
  await checkAndExecuteNextRun();
}

function startPlatformEventSync() {
  if (eventSyncStarted) return;
  eventSyncStarted = true;
  void platformEventLoop();
}

async function platformEventLoop() {
  while (true) {
    try {
      await readPlatformEvents();
    } catch (error) {
      console.error(`[worker] 平台事件监听断开：${error.message}`);
      if (/401|登录态|认证/.test(error.message)) await relogin();
      await sleep(30000);
    }
  }
}

async function readPlatformEvents() {
  const response = await fetch(`${apiBase}/api/platform-events`, {
    headers: cookie ? { Cookie: cookie } : {}
  });
  if (!response.ok) throw new Error(`平台事件连接失败：HTTP ${response.status}`);
  if (!response.body) throw new Error('平台事件连接不可读。');
  await heartbeat(true).catch(error => {
    logOfflineNotice(`平台事件连接后心跳恢复失败，稍后重试：${error.message}`);
  });
  void checkAndExecuteNextRun();
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      handlePlatformEventBlock(block);
      boundary = buffer.indexOf('\n\n');
    }
  }
}

function handlePlatformEventBlock(block = '') {
  const dataLine = String(block || '').split(/\r?\n/).find(line => line.startsWith('data:'));
  if (!dataLine) return;
  let event = null;
  try {
    event = JSON.parse(dataLine.slice(5).trim());
  } catch {
    return;
  }
  if (event?.type === 'runs.changed') void wakeForRunChange(event);
}

function shouldWakeForRunEvent(event = null) {
  if (!event || event.type !== 'runs.changed') return false;
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const targetUserId = String(payload.targetUserId || payload.queuedForUserId || payload.assignedToUserId || '').trim();
  if (targetUserId && targetUserId !== String(currentUser?.id || '').trim()) return false;
  return payload.wakeWorker === true || !targetUserId;
}

async function executeRun(run) {
  const runState = await loadOrCreateRunState(run);
  const resume = Boolean(runState.startedAt && !runState.finishedAt);
  const startedAt = runState.startedAt || new Date().toISOString();
  const stageName = workerStageName(run);
  runState.startedAt = startedAt;
  runState.status = 'running';
  runState.finishedAt = '';
  runState.durationMs = 0;
  await writeRunState(run.id, runState);
  console.log(`[worker] ${resume ? '恢复' : '领取'}本机执行：${run.title} (${run.id})`);
  await enqueueRunEvent(run.id, {
    type: 'stage',
    phase: 'start',
    stageName,
    status: 'running',
    at: startedAt,
    startedAt
  });
  await safeUpdateRunStatus(run.id, {
    status: 'running',
    workerStatus: 'running',
    startedAt,
    currentStage: '本机 Codex 执行'
  });

  let workspace = null;
  try {
    workspace = await prepareRunWorkspace(run);
  } catch (error) {
    await failRunBeforeCodex(run, `本机执行资料准备失败：${error.message}`);
    return;
  }
  const prompt = buildPrompt(run, workspace);
  const cwd = workspace.cwd;
  const cwdExists = await pathExists(cwd);
  if (!cwdExists) {
    await failRunBeforeCodex(run, `执行目录不存在：${cwd}`);
    return;
  }
  const args = [
    'exec',
    '--json',
    '--cd',
    cwd,
    '--skip-git-repo-check',
    '--sandbox',
    'workspace-write',
    '-'
  ];
  let finalText = '';
  let rawStdoutText = '';
  let stderrText = '';
  let child = null;
  try {
    child = spawn(codexPath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    await failRunBeforeCodex(run, `Codex 启动失败：${error.message}`);
    return;
  }
  child.on('error', error => {
    stderrText += `\nCodex 启动失败：${error.message}\n`;
  });
  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    rawStdoutText += text;
    if (rawStdoutText.length > 200000) rawStdoutText = rawStdoutText.slice(-200000);
    finalText += collectReadableJsonl(text);
    void safeAppendRunLog(run.id, text);
    process.stdout.write(text);
  });
  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    stderrText += text;
    void safeAppendRunLog(run.id, text);
    process.stderr.write(text);
  });
  try {
    child.stdin.end(prompt);
  } catch (error) {
    stderrText += `\nCodex 输入失败：${error.message}\n`;
  }

  const heartbeatTimer = startExecutionHeartbeat(run.id);
  const exitCode = await waitForChild(child);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const combinedText = [finalText, rawStdoutText, stderrText].filter(Boolean).join('\n');
  const figmaWriteResult = extractFigmaWriteEvidence(combinedText, run);
  const status = resolveWorkerFinalStatus(exitCode, figmaWriteResult);
  await enqueueRunEvent(run.id, {
    type: 'stage',
    phase: 'end',
    stageName,
    status,
    at: finishedAt,
    startedAt,
    finishedAt,
    durationMs
  });
  runState.status = status;
  runState.finishedAt = finishedAt;
  runState.durationMs = durationMs;
  await writeRunState(run.id, runState);
  await safeUpdateRunStatus(run.id, {
    status,
    workerStatus: status,
    exitCode,
    startedAt,
    finishedAt,
    durationMs,
    stages: [
      {
        name: stageName,
        status,
        startedAt,
        finishedAt,
        durationMs
      }
    ],
    resultSummary: buildResultSummary(status, exitCode, combinedText, figmaWriteResult),
    workerResult: {
      deviceId,
      hostname: os.hostname(),
      exitCode,
      cwd,
      materialPath: workspace.materialPath,
      snapshotPaths: workspace.snapshotPaths,
      finalText: finalText.slice(-8000),
      stderrText: stderrText.slice(-8000)
    },
    figmaWriteResult
  });
  console.log(`[worker] 执行结束：${run.title} (${status})`);
}

async function failRunBeforeCodex(run, reason) {
  console.error(`[worker] ${reason}`);
  const runState = await loadOrCreateRunState(run);
  const startedAt = runState.startedAt || new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const stageName = workerStageName(run);
  runState.startedAt = startedAt;
  runState.finishedAt = finishedAt;
  runState.durationMs = durationMs;
  runState.status = 'failed';
  await writeRunState(run.id, runState);
  await enqueueRunEvent(run.id, {
    type: 'stage',
    phase: 'end',
    stageName,
    status: 'failed',
    at: finishedAt,
    startedAt,
    finishedAt,
    durationMs
  });
  await safeAppendRunLog(run.id, `\n[worker blocked] ${reason}\n`);
  await safeUpdateRunStatus(run.id, {
    status: 'failed',
    workerStatus: 'failed',
    exitCode: -1,
    startedAt,
    finishedAt,
    durationMs,
    stages: [
      {
        name: stageName,
        status: 'failed',
        startedAt,
        finishedAt,
        durationMs
      }
    ],
    currentStage: '本机 Codex 执行',
    resultSummary: buildResultSummary('failed', -1, reason, {
      required: requiresFigmaWriteEvidence(run),
      written: false,
      evidence: [],
      blockerReason: reason
    }),
    workerResult: {
      deviceId,
      hostname: os.hostname(),
      exitCode: -1,
      finalText: '',
      stderrText: reason
    },
    figmaWriteResult: {
      required: requiresFigmaWriteEvidence(run),
      written: false,
      evidence: [],
      blockerReason: reason
    }
  });
}

async function prepareRunWorkspace(run = {}) {
  const cwd = runWorkspacePath(run.id);
  await mkdir(cwd, { recursive: true });
  const snapshots = normalizeRunMaterialSnapshots(run);
  if (!snapshots.length && run.primarySkillPath && run.primarySkillContent) {
    snapshots.push({
      path: run.primarySkillPath,
      title: run.primarySkillTitle || run.primarySkillPath,
      content: run.primarySkillContent
    });
  }
  const snapshotPaths = [];
  for (const snapshot of snapshots) {
    const relativePath = safeRelativePath(snapshot.path || snapshot.sourceValue || snapshot.title || `materials/${snapshotPaths.length + 1}.md`);
    if (!relativePath) continue;
    const targetPath = path.join(cwd, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, String(snapshot.content || '').trim(), 'utf8');
    snapshotPaths.push(relativePath);
  }
  const materialPath = path.join(cwd, '任务资料.md');
  await writeFile(materialPath, buildLocalTaskMaterial(run, snapshots, snapshotPaths), 'utf8');
  if (run.primarySkillPath && !snapshotPaths.includes(safeRelativePath(run.primarySkillPath))) {
    const primaryPath = safeRelativePath(run.primarySkillPath);
    if (primaryPath && run.primarySkillContent) {
      const targetPath = path.join(cwd, primaryPath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, String(run.primarySkillContent || '').trim(), 'utf8');
      snapshotPaths.unshift(primaryPath);
    }
  }
  if (requiresFigmaWriteEvidence(run) && !snapshotPaths.length) {
    throw new Error('平台未下发可用 Skill / md 内容快照。');
  }
  return { cwd, materialPath, snapshotPaths };
}

function normalizeRunMaterialSnapshots(run = {}) {
  const input = Array.isArray(run.selectedMaterialSnapshots) ? run.selectedMaterialSnapshots : [];
  return input
    .map(item => ({
      path: String(item?.path || item?.relativePath || item?.sourceValue || '').trim(),
      sourceValue: String(item?.sourceValue || item?.path || item?.relativePath || '').trim(),
      title: String(item?.title || item?.name || '').trim(),
      content: String(item?.content || '').trim()
    }))
    .filter(item => item.content);
}

function buildLocalTaskMaterial(run = {}, snapshots = [], snapshotPaths = []) {
  return [
    '# 美术工作台本机执行资料',
    '',
    `- runId: ${run.id || ''}`,
    `- 标题: ${run.title || ''}`,
    `- Figma 链接: ${run.figmaLinks || ''}`,
    `- Figma 写入方式: ${run.figmaWriteMode || 'target-node'}`,
    `- 主执行 Skill / md: ${run.primarySkillPath || run.stage || ''}`,
    `- 执行人: ${run.queuedForName || run.assignedToName || run.developer || ''}`,
    '',
    '## 已落地 Skill / md 快照',
    '',
    snapshotPaths.length
      ? snapshotPaths.map((item, index) => `${index + 1}. ${item}`).join('\n')
      : '- 未落地，必须回传阻塞原因。',
    '',
    '## 给 Codex 的执行要求',
    '',
    run.requirement || '',
    '',
    '## 快照摘要',
    '',
    snapshots.length
      ? snapshots.map((item, index) => `- ${index + 1}. ${item.title || item.path || item.sourceValue || snapshotPaths[index] || '未命名'}：${String(item.content || '').length} 字符`).join('\n')
      : '- 无'
  ].join('\n');
}

function runWorkspacePath(runId = '') {
  return path.join(runStateDir, safePathSegment(runId), 'workspace');
}

function safeRelativePath(value = '') {
  const text = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!text || text.includes('\0')) return '';
  const normalized = path.posix.normalize(text);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) return '';
  return normalized;
}

function startExecutionHeartbeat(runId = '') {
  const intervalMs = Math.max(30000, Math.min(heartbeatIntervalMs, 60000));
  return setInterval(() => {
    void heartbeat(true).catch(error => {
      logOfflineNotice(`执行中心跳回传失败，稍后重试：${error.message}`);
    });
    if (runId) {
      void enqueueRunEvent(runId, {
        type: 'status',
        status: 'running',
        workerStatus: 'running',
        currentStage: '本机 Codex 执行中',
        at: new Date().toISOString()
      }).catch(() => {});
    }
  }, intervalMs);
}

function buildPrompt(run = {}, workspace = {}) {
  const stages = Array.isArray(run.stages) ? run.stages.filter(stage => stage?.name || stage?.description || stage?.doneCriteria) : [];
  const stageText = stages.length
    ? stages.map((stage, index) => [
      `${index + 1}. ${stage.name || stage.id || `阶段 ${index + 1}`}`,
      stage.description ? `   - 说明：${stage.description}` : '',
      stage.doneCriteria ? `   - 完成标准：${stage.doneCriteria}` : ''
    ].filter(Boolean).join('\n')).join('\n')
    : '- 平台未提供阶段列表，按本次执行要求完成。';
  return [
    '# 美术工作台本机执行任务',
    '',
    '你正在执行一个由当前操作人电脑领取的美术执行台任务。必须严格按输入操作，不扩展无关范围。',
    '',
    '## 输入',
    '',
    `- runId: ${run.id}`,
    `- 标题: ${run.title}`,
    `- 执行模式: ${run.workflow || run.executionMode || ''}`,
    `- 主执行 Skill / md: ${run.primarySkillPath || run.stage || ''}`,
    `- Figma 链接: ${run.figmaLinks || ''}`,
    `- 写入方式: ${run.figmaWriteMode || 'target-node'}`,
    `- 本机任务资料: ${workspace.materialPath || '任务资料.md'}`,
    `- 本机执行目录: ${workspace.cwd || ''}`,
    `- 本机已落地 Skill / md: ${(workspace.snapshotPaths || []).join('、') || '无'}`,
    `- 平台产物目录记录: ${run.artifactRoot || ''}`,
    `- 排队给: ${run.queuedForName || run.assignedToName || run.developer || currentUser?.displayName || currentUser?.username || ''}`,
    '',
    '## 执行步骤',
    '',
    stageText,
    '',
    '## 平台任务资料 / Skill / md 内容快照',
    '',
    [
      `请先读取本机任务资料：${workspace.materialPath || '任务资料.md'}`,
      ...(workspace.snapshotPaths || []).map(item => `请读取并执行：${item}`),
      '',
      run.primarySkillContent || '平台未提供主 Skill / md 内容快照。若本机无法读取任务中的路径线索，必须停止并回传阻塞原因。'
    ].join('\n'),
    '',
    '## 执行要求',
    '',
    run.requirement || '',
    '',
    '## 本机授权规则',
    '',
    '- 必须使用当前操作人本机 Codex 会话里的 Figma MCP。',
    '- 必须使用当前操作人自己的 Figma 授权和 Figma 文件权限。',
    '- 不得依赖负责人电脑、本机 figma-write-local 插件或平台服务器 Figma token。',
    '- 如果当前 Codex 工具列表缺少 Figma 写入工具，或者 Figma OAuth 失效，必须停止并说明阻塞原因。',
    '- 必须优先使用上方平台任务资料和 Skill / md 内容快照执行，不要求组员电脑存在负责人本机项目目录。',
    '- 如果是自定义流程，必须按“执行步骤”从前到后逐个完整执行。',
    '- 只有 Figma 写入工具成功返回 createdNodeIds 或 mutatedNodeIds，才算写入完成；没有这些证据时不得报告完成。',
    '- 每次 Figma 写入后必须做回读验证；最后一次写入后必须再次回读目标节点，并尽量截图确认没有遮挡、截断、换行或漏改。',
    '- 如果写入后最终回读、复扫或截图因为 Auth required、OAuth、权限、MCP 断开等原因失败，即使前面已经返回 mutatedNodeIds，也必须报告为阻塞，不能声称整条任务完成。',
    '- 最终回答必须原文写出 Figma 写入证据，例如 createdNodeIds、mutatedNodeIds 或 figmaWriteResult，并明确写出“最终回读/截图验收：已完成/未完成”。',
    '',
    '## 交付',
    '',
    '- 如果本机能访问平台产物目录，可以把报告写入该目录；否则必须在最终回答中完整输出报告，Worker 会回传到平台日志。',
    '- 报告必须包含：读取的 Skill/md、Figma 链接、写入节点、阻塞原因、人工复核建议。',
    '- 最终回答用中文简短总结结果。'
  ].join('\n');
}

async function resolveExecutionCwd(run = {}) {
  const candidates = [
    run.projectRoot,
    process.env.ART_WORKER_PROJECT_ROOT,
    defaultProjectRoot,
    workerHome,
    os.homedir()
  ].map(value => String(value || '').trim()).filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return defaultProjectRoot;
}

function workerPayload() {
  return {
    deviceId,
    deviceName: deviceId,
    hostname: os.hostname(),
    platform: os.platform(),
    capabilities: [
      localChecks.codexReady ? 'codex.exec' : '',
      localChecks.figmaMcpReady ? 'figma.mcp.write' : ''
    ].filter(Boolean),
    codexReady: localChecks.codexReady,
    figmaMcpReady: localChecks.figmaMcpReady,
    checks: localChecks
  };
}

function resolveCodexPath() {
  const configured = String(process.env.CODEX_CLI_PATH || '').trim();
  if (configured && !/\\WindowsApps\\/i.test(configured)) return configured;
  if (configured && /\\WindowsApps\\/i.test(configured)) {
    console.error('[worker] 已忽略 WindowsApps Codex 应用别名路径，改用真实 Codex CLI 候选路径。');
  }
  const windowsBundled = path.join(workerHome, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  if (os.platform() === 'win32') return windowsBundled;
  return 'codex';
}

function workerStageName(run = {}) {
  const firstStage = Array.isArray(run.stages) ? run.stages.find(stage => stage?.name) : null;
  return firstStage?.name || run.stage || run.primarySkillPath || '本机执行';
}

async function runLocalChecks() {
  const codex = await runCommand(codexPath, ['--help'], { timeoutMs: localCheckTimeoutMs });
  const mcp = codex.code === 0
    ? await runCommand(codexPath, ['mcp', 'list'], { timeoutMs: localCheckTimeoutMs })
    : { code: -1, stdout: '', stderr: '', error: 'Codex 不可用，跳过 Figma MCP 自检' };
  const figmaReady = mcp.code === 0 && /figma/i.test(`${mcp.stdout}\n${mcp.stderr}`);
  return {
    codexReady: codex.code === 0,
    figmaMcpReady: figmaReady,
    codexMessage: codex.code === 0 ? '可用' : `不可用：${codex.stderr || codex.error || codex.code}`,
    figmaMessage: figmaReady ? '已发现 figma MCP 配置' : '未发现 figma MCP 配置，请先在本机 Codex 完成 Figma MCP 授权'
  };
}

function runCommand(command, args = [], options = {}) {
  return new Promise(resolve => {
    const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));
    let settled = false;
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timer = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    if (timeoutMs) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
        }
        finish({ code: -1, stdout, stderr, error: `命令超时 ${timeoutMs}ms：${command} ${args.join(' ')}` });
      }, timeoutMs);
    }
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => finish({ code: -1, stdout, stderr, error: error.message }));
    child.on('close', code => finish({ code: Number(code || 0), stdout, stderr }));
  });
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function appendRunLog(runId, chunk) {
  if (!chunk) return;
  await fetchJson(`/api/agent-runs/${encodeURIComponent(runId)}/log`, {
    method: 'POST',
    body: { chunk }
  }).catch(error => console.error(`[worker] 日志回传失败：${error.message}`));
}

async function updateRunStatus(runId, body) {
  await fetchJson(`/api/agent-runs/${encodeURIComponent(runId)}/status`, {
    method: 'POST',
    body
  });
}

async function safeAppendRunLog(runId, chunk) {
  if (!chunk) return;
  try {
    await fetchJson(`/api/agent-runs/${encodeURIComponent(runId)}/log`, {
      method: 'POST',
      body: { chunk }
    });
  } catch (error) {
    await enqueueRunEvent(runId, {
      type: 'log',
      at: new Date().toISOString(),
      chunk: String(chunk).slice(-offlineLogChunkMaxChars)
    });
    logOfflineNotice(`日志回传失败，已暂存在本机：${error.message}`);
  }
}

async function safeUpdateRunStatus(runId, body) {
  try {
    await updateRunStatus(runId, body);
  } catch (error) {
    await enqueueRunEvent(runId, {
      type: 'status',
      at: new Date().toISOString(),
      ...body
    });
    logOfflineNotice(`状态回传失败，已暂存在本机：${error.message}`);
  }
}

async function flushOfflineQueue() {
  return withOfflineQueueLock(async () => {
    const queue = await readOfflineQueue();
    if (!queue.length) return;
    const remaining = [];
    let flushed = 0;
    for (const item of queue) {
      try {
        if (item.type === 'log') {
          await fetchJson(`/api/agent-runs/${encodeURIComponent(item.runId)}/log`, {
            method: 'POST',
            body: item.body
          });
        } else if (item.type === 'status') {
          await updateRunStatus(item.runId, item.body);
        }
        flushed += 1;
      } catch (error) {
        if (/404|not found/i.test(error.message)) {
          await removeRunState(item.runId);
          flushed += 1;
          continue;
        }
        remaining.push(item);
        const tail = queue.slice(queue.indexOf(item) + 1);
        remaining.push(...tail);
        logOfflineNotice(`离线回传队列同步失败，稍后重试：${error.message}`);
        break;
      }
    }
    if (flushed) console.log(`[worker] 已补回离线执行数据 ${flushed} 条`);
    await writeOfflineQueue(remaining.slice(-offlineQueueMaxItems));
  });
}

async function enqueueOfflineUpdate(item) {
  return withOfflineQueueLock(async () => {
    const queue = await readOfflineQueue();
    queue.push(item);
    await writeOfflineQueue(queue.slice(-offlineQueueMaxItems));
  });
}

async function readOfflineQueue() {
  try {
    const text = await readFile(offlineQueuePath, 'utf8');
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function writeOfflineQueue(queue) {
  await mkdir(path.dirname(offlineQueuePath), { recursive: true });
  await writeFile(offlineQueuePath, JSON.stringify(queue, null, 2), 'utf8');
}

function withOfflineQueueLock(task) {
  offlineQueueOperation = offlineQueueOperation.then(task, task);
  return offlineQueueOperation;
}

function logOfflineNotice(message) {
  const now = Date.now();
  if (now - lastOfflineNoticeAt < 30000) return;
  lastOfflineNoticeAt = now;
  console.error(`[worker] ${message}；本机 Codex/Figma 执行不会因此中断。`);
}

async function loadOrCreateRunState(run = {}) {
  const existing = await readRunState(run.id);
  if (existing) return {
    ...existing,
    snapshot: existing.snapshot || run
  };
  const state = {
    runId: run.id,
    title: run.title || '',
    status: run.status || 'claimed',
    startedAt: run.startedAt || '',
    finishedAt: run.finishedAt || '',
    durationMs: Number(run.durationMs || 0),
    snapshot: run,
    events: [],
    syncedEventIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await writeRunState(run.id, state);
  return state;
}

async function readRunState(runId) {
  if (!runId) return null;
  try {
    const text = await readFile(runStatePath(runId), 'utf8');
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function writeRunState(runId, state = {}) {
  if (!runId) return;
  const dir = path.dirname(runStatePath(runId));
  await mkdir(dir, { recursive: true });
  const next = {
    ...state,
    runId,
    events: Array.isArray(state.events) ? state.events.slice(-runEventQueueMaxItems) : [],
    syncedEventIds: Array.isArray(state.syncedEventIds) ? state.syncedEventIds.slice(-runEventQueueMaxItems) : [],
    updatedAt: new Date().toISOString()
  };
  await writeFile(runStatePath(runId), JSON.stringify(next, null, 2), 'utf8');
}

async function enqueueRunEvent(runId, event = {}) {
  if (!runId || !event.type) return;
  const state = await readRunState(runId) || {
    runId,
    status: '',
    startedAt: '',
    finishedAt: '',
    durationMs: 0,
    snapshot: {},
    events: [],
    syncedEventIds: [],
    createdAt: new Date().toISOString()
  };
  const item = {
    ...event,
    id: event.id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    at: event.at || new Date().toISOString()
  };
  state.events = [...(Array.isArray(state.events) ? state.events : []), item].slice(-runEventQueueMaxItems);
  await writeRunState(runId, state);
}

async function syncLocalRunState() {
  const states = await listRunStates();
  if (!states.length) return;
  await cleanupDeletedPlatformRuns(states);
  for (const state of states) {
    const events = Array.isArray(state.events) ? state.events : [];
    if (!events.length) continue;
    try {
      await fetchJson(`/api/agent-runs/${encodeURIComponent(state.runId)}/sync`, {
        method: 'POST',
        body: { events }
      });
      state.syncedEventIds = [...(Array.isArray(state.syncedEventIds) ? state.syncedEventIds : []), ...events.map(event => event.id).filter(Boolean)].slice(-runEventQueueMaxItems);
      state.events = [];
      await writeRunState(state.runId, state);
      if (/completed|failed|blocked|cancelled/.test(String(state.status || ''))) await cleanupCompletedRunState(state.runId);
    } catch (error) {
      if (/404|not found/i.test(error.message)) {
        await removeRunState(state.runId);
      } else {
        logOfflineNotice(`本机执行事件同步失败，稍后重试：${error.message}`);
      }
      break;
    }
  }
}

async function cleanupDeletedPlatformRuns(states = []) {
  const runIds = states.map(state => state.runId).filter(Boolean);
  if (!runIds.length) return;
  try {
    const result = await fetchJson('/api/agent-runs/missing', {
      method: 'POST',
      body: { runIds }
    });
    const missing = Array.isArray(result?.missingRunIds) ? result.missingRunIds : [];
    for (const runId of missing) await removeRunState(runId);
  } catch (error) {
    if (!/401|登录态|认证/.test(error.message)) logOfflineNotice(`本机执行清理对账失败，稍后重试：${error.message}`);
  }
}

async function cleanupCompletedRunState(runId) {
  const state = await readRunState(runId);
  if (!state || (Array.isArray(state.events) && state.events.length)) return;
  await removeRunState(runId);
}

async function listRunStates() {
  try {
    const entries = await readdir(runStateDir, { withFileTypes: true });
    const states = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const state = await readRunState(entry.name);
      if (state?.runId) states.push(state);
    }
    return states;
  } catch {
    return [];
  }
}

async function removeRunState(runId) {
  if (!runId) return;
  await rm(path.dirname(runStatePath(runId)), { recursive: true, force: true }).catch(() => {});
}

function runStatePath(runId) {
  return path.join(runStateDir, safePathSegment(runId), 'state.json');
}

function safePathSegment(value = '') {
  return String(value || 'run')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'run';
}

function buildResultSummary(status, exitCode, finalText, figmaWriteResult = {}) {
  const figmaBlocker = figmaWriteResult.required && (!figmaWriteResult.written || figmaWriteResult.partialWrite)
    ? figmaWriteResult.blockerReason || '未检测到 Figma 写入证据。'
    : '';
  const failureReason = status === 'completed' ? '' : figmaBlocker || extractFailureReason(finalText) || `Codex 退出码：${exitCode}`;
  const completedSummary = figmaWriteResult.required
    ? '本机直接执行已完整完成，已检测到 Figma 写入证据和写入后的回读/截图验收证据。'
    : '本机直接执行已完成。';
  const failedSummary = figmaWriteResult.partialWrite
    ? 'Figma 已有部分写入，但写入后的最终回读/截图验收未闭环，请恢复授权后继续执行。'
    : '本机直接执行失败，请查看阻塞原因和原始日志。';
  return {
    status,
    statusText: status,
    summary: status === 'completed'
      ? completedSummary
      : failedSummary,
    blockerReason: failureReason,
    needsHumanReview: true,
    validationCommands: ['codex exec --json'],
    artifacts: figmaWriteResult.evidence?.length ? figmaWriteResult.evidence : [],
    figmaWritten: figmaWriteResult.written === true,
    figmaVerifiedAfterWrite: figmaWriteResult.verifiedAfterWrite === true,
    nextStep: status === 'blocked'
      ? '恢复执行人本机 Figma MCP 授权后继续执行，优先补齐最终回读、截图验收和剩余未完成项。'
      : '',
    finalText: String(finalText || '').slice(-4000),
    parsedAt: new Date().toISOString()
  };
}

function requiresFigmaWriteEvidence(run = {}) {
  return Boolean(String(run.figmaLinks || '').trim());
}

function resolveWorkerFinalStatus(exitCode, figmaWriteResult = {}) {
  if (Number(exitCode) !== 0) return 'failed';
  if (figmaWriteResult.required && !figmaWriteResult.written) return 'failed';
  if (figmaWriteResult.required && figmaWriteResult.partialWrite) return 'blocked';
  return 'completed';
}

function extractFigmaWriteEvidence(text = '', run = {}) {
  const required = requiresFigmaWriteEvidence(run);
  const source = String(text || '');
  const toolEvents = extractFigmaToolEvents(source);
  const createdSet = new Set(extractArrayLikeValues(source, 'createdNodeIds'));
  const mutatedSet = new Set(extractArrayLikeValues(source, 'mutatedNodeIds'));
  const evidence = [];
  let lastWriteOrder = -1;
  for (const event of toolEvents) {
    event.createdNodeIds.forEach(id => createdSet.add(id));
    event.mutatedNodeIds.forEach(id => mutatedSet.add(id));
    if (event.createdNodeIds.length || event.mutatedNodeIds.length) {
      lastWriteOrder = Math.max(lastWriteOrder, event.order);
      evidence.push(formatFigmaWriteEvidence(event));
    }
  }
  const lines = source.split(/\r?\n/).map((line, index) => ({ line: line.trim(), index })).filter(item => item.line);
  for (const line of lines) {
    if (!/createdNodeIds|mutatedNodeIds|figmaWriteResult|use_figma/i.test(line.line)) continue;
    if (/未检测|没有|无写入|缺少|失败|error|failed|blocked|阻塞|不可用/i.test(line.line) && !/createdNodeIds|mutatedNodeIds/.test(line.line)) continue;
    evidence.push(line.line.slice(0, 500));
    if (evidence.length >= 8) break;
  }
  const createdNodeIds = [...createdSet].slice(0, 80);
  const mutatedNodeIds = [...mutatedSet].slice(0, 120);
  const written = createdNodeIds.length > 0 || mutatedNodeIds.length > 0 || evidence.some(line => /figmaWriteResult.*written["']?\s*[:=]\s*true/i.test(line));
  const postWriteVerificationRequired = Boolean(required && written);
  const postWriteBlockers = postWriteVerificationRequired
    ? extractPostWriteFigmaBlockers(source, toolEvents, lastWriteOrder)
    : [];
  const verificationEvidence = postWriteVerificationRequired
    ? extractPostWriteVerificationEvidence(source, toolEvents, lastWriteOrder)
    : [];
  const verifiedAfterWrite = postWriteVerificationRequired
    ? verificationEvidence.length > 0 && postWriteBlockers.length === 0
    : false;
  const partialWrite = Boolean(postWriteVerificationRequired && !verifiedAfterWrite);
  const blockerReason = required && !written
    ? 'Codex 进程结束，但未检测到 Figma 写入证据。必须有 use_figma 返回 createdNodeIds 或 mutatedNodeIds 后才算完成。'
    : partialWrite
      ? (postWriteBlockers[0] || 'Figma 已写入，但写入后未检测到最终回读或截图验收证据，不能判定整条任务完成。')
      : '';
  return {
    required,
    written: required ? written : false,
    createdNodeIds,
    mutatedNodeIds,
    evidence,
    postWriteVerificationRequired,
    verifiedAfterWrite,
    verificationEvidence,
    postWriteBlockers,
    partialWrite,
    blockerReason
  };
}

function extractArrayLikeValues(text = '', field = '') {
  const values = new Set();
  const pattern = new RegExp(`${field}[^\\n\\[]*\\[([^\\]]*)\\]`, 'gi');
  let match = pattern.exec(text);
  while (match) {
    String(match[1] || '')
      .split(/,|\s/)
      .map(item => item.replace(/["'`]/g, '').trim())
      .filter(isLikelyFigmaNodeId)
      .forEach(item => values.add(item));
    match = pattern.exec(text);
  }
  const singlePattern = new RegExp(`${field}[^\\n:=]*[:=]\\s*["']?([A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?(?:;[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?)*)`, 'gi');
  match = singlePattern.exec(text);
  while (match) {
    if (match[1] && isLikelyFigmaNodeId(match[1])) values.add(match[1]);
    match = singlePattern.exec(text);
  }
  return [...values].slice(0, 50);
}

function isLikelyFigmaNodeId(value = '') {
  const text = String(value || '').trim();
  return text.includes(':') && /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)(?:;[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+))*$/.test(text);
}

function extractFigmaToolEvents(text = '') {
  const events = [];
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    let event = null;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    const item = event?.item || {};
    if (item.type !== 'mcp_tool_call') return;
    const server = String(item.server || '').trim();
    const tool = String(item.tool || '').trim();
    if (!/figma/i.test(`${server} ${tool}`)) return;
    const resultText = figmaToolResultText(item.result);
    const errorText = figmaToolErrorText(item.error);
    const createdNodeIds = [
      ...extractArrayLikeValues(resultText, 'createdNodeIds'),
      ...extractNodeIdsFromJsonText(resultText, 'createdNodeIds')
    ].filter(isLikelyFigmaNodeId);
    const mutatedNodeIds = [
      ...extractArrayLikeValues(resultText, 'mutatedNodeIds'),
      ...extractNodeIdsFromJsonText(resultText, 'mutatedNodeIds')
    ].filter(isLikelyFigmaNodeId);
    events.push({
      order: index,
      server,
      tool,
      description: String(item.arguments?.description || '').trim(),
      status: String(item.status || '').trim(),
      success: item.status === 'completed' && !item.error,
      errorText,
      resultText,
      createdNodeIds: [...new Set(createdNodeIds)],
      mutatedNodeIds: [...new Set(mutatedNodeIds)]
    });
  });
  return events;
}

function figmaToolResultText(result = null) {
  if (!result || typeof result !== 'object') return '';
  const chunks = [];
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (item?.type === 'text' && item.text) chunks.push(String(item.text));
  }
  if (typeof result === 'string') chunks.push(result);
  return chunks.join('\n').slice(0, 20000);
}

function figmaToolErrorText(error = null) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(error.message || error.error || JSON.stringify(error)).trim();
}

function extractNodeIdsFromJsonText(text = '', field = '') {
  const values = new Set();
  const candidates = String(text || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  for (const candidate of candidates) {
    try {
      collectNodeIdsFromValue(JSON.parse(candidate), field, values);
    } catch {
      // Ignore non-JSON text chunks; regex extraction already handles them.
    }
  }
  return [...values];
}

function collectNodeIdsFromValue(value, field, values) {
  if (Array.isArray(value)) {
    value.forEach(item => collectNodeIdsFromValue(item, field, values));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === field) {
      const list = Array.isArray(child) ? child : [child];
      list.map(item => String(item || '').trim()).filter(isLikelyFigmaNodeId).forEach(item => values.add(item));
    } else {
      collectNodeIdsFromValue(child, field, values);
    }
  }
}

function formatFigmaWriteEvidence(event = {}) {
  const ids = [
    event.createdNodeIds.length ? `createdNodeIds=${event.createdNodeIds.join(',')}` : '',
    event.mutatedNodeIds.length ? `mutatedNodeIds=${event.mutatedNodeIds.join(',')}` : ''
  ].filter(Boolean).join('；');
  return `${event.tool || 'figma'} 写入成功：${ids}`.slice(0, 500);
}

function extractPostWriteFigmaBlockers(source = '', toolEvents = [], lastWriteOrder = -1) {
  if (lastWriteOrder < 0) return [];
  const blockers = [];
  for (const event of toolEvents) {
    if (event.order <= lastWriteOrder || event.success) continue;
    const reason = event.errorText || event.resultText;
    if (!reason) continue;
    blockers.push(`Figma 写入后 ${event.tool || 'MCP'} 验证失败：${compactReason(reason)}`);
  }
  const lines = String(source || '').split(/\r?\n/);
  for (let index = Math.max(lastWriteOrder + 1, 0); index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (!/(Auth required|OAuth|permission|denied|Transport send error|tool call failed|figma\/(?:use_figma|get_screenshot)|Figma MCP|最终.*(?:失败|阻塞|未完成)|回读.*(?:失败|阻塞|未完成)|截图.*(?:失败|阻塞|未完成)|复扫.*(?:失败|阻塞|未完成))/i.test(line)) continue;
    blockers.push(compactReason(line));
    if (blockers.length >= 5) break;
  }
  return [...new Set(blockers)].slice(0, 5);
}

function extractPostWriteVerificationEvidence(source = '', toolEvents = [], lastWriteOrder = -1) {
  if (lastWriteOrder < 0) return [];
  const evidence = [];
  for (const event of toolEvents) {
    if (event.order <= lastWriteOrder || !event.success) continue;
    if (event.tool === 'get_screenshot' || /截图|screenshot/i.test(event.description)) {
      evidence.push(`写入后截图验收成功：${event.tool}`);
      continue;
    }
    if (event.tool === 'use_figma' && /回读|复扫|验证|验收|检查|read|verify|validation/i.test(event.description)) {
      evidence.push(`写入后回读验收成功：${event.description || event.tool}`);
    }
  }
  const lines = String(source || '').split(/\r?\n/);
  for (let index = Math.max(lastWriteOrder + 1, 0); index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || /失败|阻塞|未完成|Auth required|error|failed|blocked/i.test(line)) continue;
    if (/最终.*(?:回读|截图|验证|验收).*(?:完成|通过|成功)|(?:回读|截图|验证|验收).*已完成/i.test(line)) evidence.push(compactReason(line));
    if (evidence.length >= 5) break;
  }
  return [...new Set(evidence)].slice(0, 5);
}

function compactReason(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function extractFailureReason(text = '') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const preferred = lines.find(line => /not inside a trusted directory|skip-git-repo-check|figma|mcp|oauth|permission|denied|error|failed|失败|阻塞|不可用/i.test(line));
  return (preferred || lines[0] || '').slice(0, 300);
}

function collectReadableJsonl(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => {
      try {
        const event = JSON.parse(line);
        return event.message || event.text || event.delta || event.type || '';
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

function waitForChild(child) {
  return new Promise(resolve => {
    let settled = false;
    const finish = code => {
      if (settled) return;
      settled = true;
      resolve(Number(code ?? -1));
    };
    child.on('error', () => finish(-1));
    child.on('close', code => finish(Number(code || 0)));
  });
}

async function fetchJson(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetch(`${apiBase}${pathname}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`平台请求超时 ${requestTimeoutMs}ms：${pathname}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${response.status} ${value?.error || response.statusText}`);
  return options.includeRaw ? { value, raw: response } : value;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetch(url, {
      headers: cookie ? { Cookie: cookie } : {},
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`平台请求超时 ${requestTimeoutMs}ms：${url}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return text;
}

function parseSetCookie(value = '') {
  return String(value || '').split(',').map(item => item.split(';')[0]).filter(Boolean).join('; ');
}

function normalizeBaseUrl(value = '') {
  return String(value || '').replace(/\/+$/, '');
}
