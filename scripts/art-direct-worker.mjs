#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { access, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const apiBase = normalizeBaseUrl(process.env.ART_PLATFORM_API || process.env.API_BASE || 'http://127.0.0.1:4288');
const username = process.env.ART_PLATFORM_USERNAME || process.env.AWP_USERNAME || '';
const password = process.env.ART_PLATFORM_PASSWORD || process.env.AWP_PASSWORD || '';
const deviceId = process.env.ART_WORKER_DEVICE_ID || `${os.hostname()}-${os.userInfo().username}`;
const pollIntervalMs = Math.max(60000, Number(process.env.ART_WORKER_POLL_INTERVAL_MS || 300000));
const heartbeatIntervalMs = Math.max(60000, Number(process.env.ART_WORKER_HEARTBEAT_INTERVAL_MS || 300000));
const localCheckTimeoutMs = Math.max(5000, Number(process.env.ART_WORKER_CHECK_TIMEOUT_MS || 15000));
const localCheckIntervalMs = Math.max(60000, Number(process.env.ART_WORKER_LOCAL_CHECK_INTERVAL_MS || 300000));
const requestTimeoutMs = Math.max(5000, Number(process.env.ART_WORKER_API_TIMEOUT_MS || 15000));
const codexPath = process.env.CODEX_CLI_PATH || 'codex';
const workerHome = process.env.ART_WORKER_HOME || path.join(os.homedir(), 'ArtDirectWorker');
const defaultProjectRoot = process.env.ART_WORKER_PROJECT_ROOT || workerHome || process.cwd();
const offlineQueuePath = process.env.ART_WORKER_OFFLINE_QUEUE_PATH || path.join(workerHome, 'state', 'offline-run-updates.json');
const runStateDir = process.env.ART_WORKER_RUN_STATE_DIR || path.join(workerHome, 'state', 'runs');
const offlineQueueMaxItems = Math.max(20, Number(process.env.ART_WORKER_OFFLINE_QUEUE_MAX_ITEMS || 200));
const offlineLogChunkMaxChars = Math.max(1000, Number(process.env.ART_WORKER_OFFLINE_LOG_CHUNK_MAX_CHARS || 8000));
const runEventQueueMaxItems = Math.max(20, Number(process.env.ART_WORKER_RUN_EVENT_QUEUE_MAX_ITEMS || 500));

let cookie = '';
let currentUser = null;
let lastHeartbeatAt = 0;
let checkingRuns = false;
let eventSyncStarted = false;
let lastLocalCheckAt = 0;
let lastOfflineNoticeAt = 0;
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
  if (event?.type === 'runs.changed') void checkAndExecuteNextRun();
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
  console.log(`[worker] ${resume ? '恢复' : '领取'}直接执行：${run.title} (${run.id})`);
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

  const prompt = buildPrompt(run);
  const cwd = run.projectRoot || defaultProjectRoot;
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

  const exitCode = await waitForChild(child);
  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const status = exitCode === 0 ? 'completed' : 'failed';
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
    resultSummary: buildResultSummary(status, exitCode, [finalText, stderrText].filter(Boolean).join('\n')),
    workerResult: {
      deviceId,
      hostname: os.hostname(),
      exitCode,
      finalText: finalText.slice(-8000),
      stderrText: stderrText.slice(-8000)
    }
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
    resultSummary: buildResultSummary('failed', -1, reason),
    workerResult: {
      deviceId,
      hostname: os.hostname(),
      exitCode: -1,
      finalText: '',
      stderrText: reason
    }
  });
}

function buildPrompt(run = {}) {
  return [
    '# 美术工作台直接执行任务',
    '',
    '你正在执行一个无多轮对话的直接执行任务。必须严格按输入操作，不扩展无关范围。',
    '',
    '## 输入',
    '',
    `- runId: ${run.id}`,
    `- 标题: ${run.title}`,
    `- 主执行 Skill / md: ${run.primarySkillPath || run.stage || ''}`,
    `- Figma 链接: ${run.figmaLinks || ''}`,
    `- 写入方式: ${run.figmaWriteMode || 'target-node'}`,
    `- 资料路径: ${run.materialPath || ''}`,
    `- 平台产物目录记录: ${run.artifactRoot || ''}`,
    '',
    '## Skill / md 内容快照',
    '',
    run.primarySkillContent || '平台未提供 Skill / md 内容快照。若本机无法读取任务中的路径线索，必须停止并回传阻塞原因。',
    '',
    '## 执行要求',
    '',
    run.requirement || '',
    '',
    '## 本机授权规则',
    '',
    '- 必须使用当前组员本机 Codex 会话里的 Figma MCP。',
    '- 必须使用当前组员自己的 Figma 授权和 Figma 文件权限。',
    '- 不得依赖负责人电脑、本机 figma-write-local 插件或平台服务器 Figma token。',
    '- 如果当前 Codex 工具列表缺少 Figma 写入工具，或者 Figma OAuth 失效，必须停止并说明阻塞原因。',
    '- 必须优先使用上方 Skill / md 内容快照执行，不要求组员电脑存在负责人本机项目目录。',
    '- 只有 Figma 写入工具成功返回 createdNodeIds 或 mutatedNodeIds，才算写入完成。',
    '',
    '## 交付',
    '',
    '- 如果本机能访问平台产物目录，可以把报告写入该目录；否则必须在最终回答中完整输出报告，Worker 会回传到平台日志。',
    '- 报告必须包含：读取的 Skill/md、Figma 链接、写入节点、阻塞原因、人工复核建议。',
    '- 最终回答用中文简短总结结果。'
  ].join('\n');
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

function buildResultSummary(status, exitCode, finalText) {
  const failureReason = status === 'completed' ? '' : extractFailureReason(finalText) || `Codex 退出码：${exitCode}`;
  return {
    status,
    statusText: status,
    summary: status === 'completed' ? '本机直接执行已完成，具体 Figma 写入结果请查看执行日志和报告。' : '本机直接执行失败，请查看阻塞原因和原始日志。',
    blockerReason: failureReason,
    needsHumanReview: true,
    validationCommands: ['codex exec --json'],
    artifacts: [],
    finalText: String(finalText || '').slice(-4000),
    parsedAt: new Date().toISOString()
  };
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

function parseSetCookie(value = '') {
  return String(value || '').split(',').map(item => item.split(';')[0]).filter(Boolean).join('; ');
}

function normalizeBaseUrl(value = '') {
  return String(value || '').replace(/\/+$/, '');
}
