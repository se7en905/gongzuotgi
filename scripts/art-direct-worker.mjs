#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { access, appendFile, mkdir, readFile, writeFile, readdir, rename, rm, stat } from 'node:fs/promises';
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
const codexNoOutputTimeoutMs = Math.max(5 * 60 * 1000, Number(process.env.ART_WORKER_CODEX_NO_OUTPUT_TIMEOUT_MS || 15 * 60 * 1000));
const codexMaxRunMs = Math.max(codexNoOutputTimeoutMs, Number(process.env.ART_WORKER_CODEX_MAX_RUN_MS || 6 * 60 * 60 * 1000));
const workerHome = process.env.ART_WORKER_HOME || path.join(os.homedir(), 'ArtDirectWorker');
const codexPath = resolveCodexPath();
const defaultProjectRoot = process.env.ART_WORKER_PROJECT_ROOT || workerHome || process.cwd();
const offlineQueuePath = process.env.ART_WORKER_OFFLINE_QUEUE_PATH || path.join(workerHome, 'state', 'offline-run-updates.json');
const runStateDir = process.env.ART_WORKER_RUN_STATE_DIR || path.join(workerHome, 'state', 'runs');
const workerLockPath = process.env.ART_WORKER_LOCK_PATH || path.join(workerHome, 'state', 'worker.lock');
const offlineQueueMaxItems = Math.max(20, Number(process.env.ART_WORKER_OFFLINE_QUEUE_MAX_ITEMS || 200));
const offlineLogChunkMaxChars = Math.max(1000, Number(process.env.ART_WORKER_OFFLINE_LOG_CHUNK_MAX_CHARS || 8000));
const runEventQueueMaxItems = Math.max(20, Number(process.env.ART_WORKER_RUN_EVENT_QUEUE_MAX_ITEMS || 500));
const fullLogSyncMaxChars = Math.max(20000, Number(process.env.ART_WORKER_FULL_LOG_SYNC_MAX_CHARS || 180000));
const onlineHeartbeatGraceMs = Math.max(180000, Number(process.env.ART_WORKER_ONLINE_GRACE_MS || 720000));
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
let workerStartedAt = new Date().toISOString();
let currentRunId = '';
let lockOwned = false;
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
  await acquireWorkerLock();
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
      const updated = await checkSelfUpdate();
      if (updated || selfRestartScheduled) {
        await heartbeat(true).catch(error => {
          logOfflineNotice(`自更新重启前心跳回传失败：${error.message}`);
        });
        await sleep(5000);
        continue;
      }
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
  await refreshLocalChecks(true);
  if (!localChecks.codexReady) return null;
  const result = await fetchJson('/api/agent-runs/next', {
    method: 'POST',
    body: workerPayload()
  });
  return result.run || null;
}

async function claimRecoverableRun(runId = '') {
  await refreshLocalChecks(true);
  if (!localChecks.codexReady) return null;
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
    const localLog = await localRunLogInfo(state.runId);
    const hasEvents = Array.isArray(state.events) && state.events.length > 0;
    const hasRecoverableEvidence = hasEvents || Number(localLog.size || 0) > 0 || Number(state.durationMs || 0) > 0;
    if (!hasRecoverableEvidence) {
      await removeRunState(state.runId);
      continue;
    }
    const localLogText = await readLocalRunLogForSync(state.runId);
    const hasCodexOutput = localLogText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .some(line => !line.startsWith('[worker]'));
    const stateAgeMs = Date.now() - Date.parse(state.updatedAt || state.startedAt || state.createdAt || '');
    if (!hasEvents && !hasCodexOutput && stateAgeMs > Math.max(codexNoOutputTimeoutMs, 10 * 60 * 1000)) {
      await removeRunState(state.runId);
      logOfflineNotice(`已跳过无 Codex 输出的旧执行恢复：${state.runId}`);
      continue;
    }
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
      currentRunId = run.id || '';
      try {
        await executeRun(run);
      } finally {
        currentRunId = '';
      }
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
  const runQueuedAt = Date.parse(run.queuedAt || run.updatedAt || run.claimedAt || '');
  const stateStartedAt = Date.parse(runState.startedAt || '');
  const canResumeLocalState = Boolean(
    runState.startedAt
    && !runState.finishedAt
    && (!runQueuedAt || !stateStartedAt || stateStartedAt >= runQueuedAt)
  );
  if (!canResumeLocalState && (runState.startedAt || runState.finishedAt || runState.status)) {
    runState.startedAt = '';
    runState.finishedAt = '';
    runState.durationMs = 0;
    runState.events = [];
    runState.syncedEventIds = [];
  }
  const resume = canResumeLocalState;
  const startedAt = resume ? runState.startedAt : new Date().toISOString();
  const stageName = workerStageName(run);
  runState.startedAt = startedAt;
  runState.status = 'running';
  runState.finishedAt = '';
  runState.durationMs = 0;
  runState.localLogPath = runLogPath(run.id);
  await writeRunState(run.id, runState);
  await appendLocalRunLog(run.id, `\n[worker] ${resume ? '恢复' : '领取'}本机执行：${run.title} (${run.id})\n`);
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
  await appendLocalRunLog(run.id, `\n[worker] 执行目录：${cwd}\n[worker] 本机日志：${runLogPath(run.id)}\n`);
  await safeAppendRunLog(run.id, `\n[worker] 已在执行人本机启动任务。\n[worker] 执行目录：${cwd}\n[worker] 本机日志：${runLogPath(run.id)}\n`);
  const cwdExists = await pathExists(cwd);
  if (!cwdExists) {
    await failRunBeforeCodex(run, `执行目录不存在：${cwd}`);
    return;
  }
  const args = [
    'exec',
    ...codexRunArgs(run),
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
    await appendLocalRunLog(run.id, `[worker] Codex 进程已启动，pid=${child.pid || 'unknown'}\n`);
    await safeUpdateRunStatus(run.id, {
      status: 'running',
      workerStatus: 'running',
      currentStage: '本机 Codex 执行',
      workerResult: {
        deviceId,
        hostname: os.hostname(),
        pid: child.pid || null,
        cwd,
        localLogPath: runLogPath(run.id),
        localLogSize: (await localRunLogInfo(run.id)).size
      },
      workerLocalLogPath: runLogPath(run.id),
      workerLocalLogSize: (await localRunLogInfo(run.id)).size
    });
  } catch (error) {
    await failRunBeforeCodex(run, `Codex 启动失败：${error.message}`);
    return;
  }
  let lastOutputAt = Date.now();
  let sawCodexOutput = false;
  let killedByWatchdog = '';
  child.on('error', error => {
    stderrText += `\nCodex 启动失败：${error.message}\n`;
  });
  child.stdout.on('data', chunk => {
    lastOutputAt = Date.now();
    sawCodexOutput = true;
    const text = chunk.toString();
    rawStdoutText += text;
    if (rawStdoutText.length > 200000) rawStdoutText = rawStdoutText.slice(-200000);
    finalText += collectReadableJsonl(text);
    void appendLocalRunLog(run.id, text);
    void safeAppendRunLog(run.id, text);
    process.stdout.write(text);
  });
  child.stderr.on('data', chunk => {
    lastOutputAt = Date.now();
    sawCodexOutput = true;
    const text = chunk.toString();
    stderrText += text;
    void appendLocalRunLog(run.id, text);
    void safeAppendRunLog(run.id, text);
    process.stderr.write(text);
  });
  try {
    child.stdin.end(prompt);
  } catch (error) {
    stderrText += `\nCodex 输入失败：${error.message}\n`;
  }

  const heartbeatTimer = startExecutionHeartbeat(run.id);
  const watchdogTimer = setInterval(() => {
    if (killedByWatchdog) return;
    const now = Date.now();
    const silentForMs = now - lastOutputAt;
    const runningForMs = now - Date.parse(startedAt);
    const reason = !sawCodexOutput && silentForMs >= codexNoOutputTimeoutMs
      ? `Codex 启动后 ${Math.round(silentForMs / 60000)} 分钟没有任何 stdout/stderr 输出`
      : runningForMs >= codexMaxRunMs
        ? `Codex 执行超过最大时长 ${Math.round(codexMaxRunMs / 60000)} 分钟`
        : '';
    if (!reason) return;
    killedByWatchdog = reason;
    stderrText += `\n[worker watchdog] ${reason}，已终止本次执行并回传失败。\n`;
    try {
      child.kill('SIGTERM');
    } catch {
    }
    setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
        }
      }
    }, 5000).unref?.();
  }, Math.max(30000, Math.min(60000, codexNoOutputTimeoutMs)));
  const exitCode = await waitForChild(child);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const localLogInfo = await localRunLogInfo(run.id);
  const localLogText = await readLocalRunLogForSync(run.id);
  const combinedText = [finalText, rawStdoutText, localLogText, stderrText].filter(Boolean).join('\n');
  const figmaWriteResult = extractFigmaWriteEvidence(combinedText, run);
  const effectiveExitCode = killedByWatchdog ? -1 : exitCode;
  const status = resolveWorkerFinalStatus(effectiveExitCode, figmaWriteResult);
  if (localLogText) {
    await safeAppendRunLog(run.id, `\n\n[worker local full log ${finishedAt}]\n${localLogText}\n[/worker local full log]\n`);
  }
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
    exitCode: effectiveExitCode,
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
    resultSummary: buildResultSummary(status, effectiveExitCode, killedByWatchdog ? `${combinedText}\n${killedByWatchdog}` : combinedText, figmaWriteResult),
    workerResult: {
      deviceId,
      hostname: os.hostname(),
      exitCode: effectiveExitCode,
      cwd,
      materialPath: workspace.materialPath,
      snapshotPaths: workspace.snapshotPaths,
      localLogPath: localLogInfo.path,
      localLogSize: localLogInfo.size,
      localLogSyncedChars: localLogText.length,
      finalText: finalText.slice(-8000),
      stderrText: stderrText.slice(-8000),
      watchdogReason: killedByWatchdog
    },
    workerLocalLogPath: localLogInfo.path,
    workerLocalLogSize: localLogInfo.size,
    figmaWriteResult
  });
  await appendLocalRunLog(run.id, `\n[worker] 执行结束：${run.title} (${status})\n`);
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
  runState.localLogPath = runLogPath(run.id);
  await writeRunState(run.id, runState);
  await appendLocalRunLog(run.id, `\n[worker blocked] ${reason}\n`);
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
      localLogPath: runLogPath(run.id),
      finalText: '',
      stderrText: reason
    },
    workerLocalLogPath: runLogPath(run.id),
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
  const attachmentPaths = await downloadRunAttachments(run, cwd);
  await writeFile(materialPath, buildLocalTaskMaterial(run, snapshots, snapshotPaths, attachmentPaths), 'utf8');
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
  return { cwd, materialPath, snapshotPaths, attachmentPaths };
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

async function downloadRunAttachments(run = {}, cwd = '') {
  const items = Array.isArray(run.attachments) ? run.attachments : [];
  if (!items.length || !cwd) return [];
  const dir = path.join(cwd, '执行附件');
  await mkdir(dir, { recursive: true });
  const saved = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const source = String(item.relativePath || item.path || '').trim();
    if (!source) continue;
    const ext = path.extname(item.name || source) || '.png';
    const targetName = `${String(index + 1).padStart(2, '0')}-${safeFileName(item.name || `附件${index + 1}${ext}`)}`;
    const targetPath = path.join(dir, targetName);
    try {
      const buffer = await fetchBinary(`/api/artifact?path=${encodeURIComponent(source)}`);
      await writeFile(targetPath, buffer);
      saved.push({
        name: item.name || targetName,
        path: targetPath,
        relativePath: path.relative(cwd, targetPath).replace(/\\/g, '/'),
        type: item.type || '',
        size: buffer.length
      });
    } catch (error) {
      await appendLocalRunLog(run.id, `[worker] 执行附件下载失败：${source} ${error.message}\n`);
    }
  }
  return saved;
}

function safeFileName(value = '') {
  return String(value || 'attachment')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'attachment.png';
}

function buildLocalTaskMaterial(run = {}, snapshots = [], snapshotPaths = [], attachmentPaths = []) {
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
    '## 粘贴图片附件',
    '',
    attachmentPaths.length
      ? [
        '以下图片来自新建美术执行时粘贴的截图，可能是参考图，也可能是修改说明图；必须结合“给 Codex 的执行要求”判断用途。',
        ...attachmentPaths.map((item, index) => `${index + 1}. ${item.relativePath || item.path}（${item.name || '未命名图片'}）`)
      ].join('\n')
      : '- 无',
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
  const materialPaths = workspace.snapshotPaths || [];
  const attachmentPaths = Array.isArray(workspace.attachmentPaths) ? workspace.attachmentPaths : [];
  const primaryMaterial = run.primarySkillPath || run.stage || materialPaths[0] || '';
  const materialInstruction = buildClientEquivalentMaterialInstruction(run, materialPaths, primaryMaterial);
  const figmaLinks = String(run.figmaLinks || '').trim();
  const figmaWriteRequired = requiresFigmaWriteEvidence(run);
  const imagePlacementRequired = figmaTargetIsImagePlacement(run);
  const editableFigmaRequested = requestsEditableFigmaOutput(run);
  return [
    '# Codex 客户端等价执行',
    '',
    '把本次任务当成用户在本机 Codex 客户端里直接引用 Skill / md 后发起的一次对话来执行。不要把工作台当成另一个流程引擎，不要自行降级为摘要执行。',
    '先完整理解并执行被引用的 Skill / md；用户没有额外写上下文时，就只按 Skill / md 与本次执行要求处理。',
    '',
    '## 本次用户指令',
    '',
    materialInstruction,
    '',
    run.requirement || '按上方引用的 Skill / md 执行本次任务。',
    '',
    figmaLinks ? `Figma 链接：${figmaLinks}` : 'Figma 链接：未填写，本次不强制读取或写入 Figma。',
    '',
    '## 必读本地文件',
    '',
    [
      workspace.materialPath ? `- ${workspace.materialPath}` : '',
      ...materialPaths.map(item => `- ${item}`),
      ...attachmentPaths.map(item => `- ${item.path || item.relativePath}`)
    ].filter(Boolean).join('\n') || '- 平台未下发 Skill / md 快照，必须停止并回传阻塞原因。',
    '',
    attachmentPaths.length ? '## 粘贴图片附件' : '',
    attachmentPaths.length
      ? [
        '这些图片来自新建美术执行时粘贴的截图，可能是参考图，也可能是修改说明图；必须结合“本次用户指令”和图片内容判断用途。',
        ...attachmentPaths.map((item, index) => `${index + 1}. ${item.path || item.relativePath}（${item.name || '未命名图片'}）`)
      ].join('\n')
      : '',
    '',
    '## 执行口径',
    '',
    '- 按 Codex 客户端直接使用该 Skill / md 的方式执行：该读文件就读文件，该生成图就生成图，该写 Figma 就写 Figma。',
    '- 不要因为这是工作台任务就额外套用未被用户选择的流程、模板、阶段或其它 Skill。',
    '- 如果引用的是单个 Skill / md，只执行这个 Skill / md；如果引用的是模板或自定义流程，才按下方顺序执行。',
    '- Skill / md 中提到的 references、scripts、assets 如已在本地文件中出现，必须按其说明继续读取和使用。',
    '',
    stages.length > 1 ? '## 模板 / 自定义流程顺序' : '',
    stages.length > 1 ? stageText : '',
    '',
    '## 工作台回传要求',
    '',
    `- runId：${run.id}`,
    `- 本机执行目录：${workspace.cwd || ''}`,
    `- 平台产物目录记录：${run.artifactRoot || ''}`,
    figmaLinks ? `- 写入方式：${run.figmaWriteMode || 'target-node'}` : '',
    figmaLinks ? '- 如需读取或写入 Figma，必须使用当前操作人本机 Codex 会话里的 Figma MCP 和 Figma 授权。' : '',
    figmaLinks ? '- 不得依赖负责人电脑、本机 figma-write-local 插件或平台服务器 Figma token。' : '',
    figmaLinks ? '- 如果当前 Codex 工具列表缺少 Figma 写入工具、Figma OAuth 失效、目标文件无权限或快照缺失，必须停止并说明具体阻塞原因。' : '',
    imagePlacementRequired ? '- 本次是纯生图并填写了 Figma 链接：生成完成后，必须把成品图作为图片放置或替换到该 Figma 目标；该链接不是默认转可编辑图层的要求。' : '',
    imagePlacementRequired ? '- 图片落到 Figma 时必须保持成品图比例和视觉效果，不得拉伸变形；默认不拆成可编辑图层。' : '',
    imagePlacementRequired && !editableFigmaRequested ? '- 除非用户明确要求“转为可编辑 / 可编辑图层 / 矢量重建”，否则保留位图成品展示。' : '',
    figmaWriteRequired ? '- 涉及 Figma 写入、图片放置或图片替换时，必须回传 createdNodeIds / mutatedNodeIds，或可证明图片已放置/替换到目标 Figma 的等价工具证据。' : '',
    !figmaLinks ? '- 本次没有 Figma 链接时，不要因为缺少 Figma MCP、Figma OAuth 或 Figma 写入工具而判定阻塞。' : '',
    imagePlacementRequired
      ? '- 最终报告必须写明生成图片产物路径、Figma 放置/替换目标、使用的 Skill / md 和复核点。'
      : '- 如果 Skill / md 任务本身是生成图片或本地产物且本次没有要求落到 Figma，不强制要求 Figma 写入完成；最终报告写明产物路径、使用的 Skill / md 和复核点。',
    figmaLinks ? '- 如果已经写入 Figma，最后必须尽量回读目标节点或截图确认；如果回读失败，说明写入证据和回读失败原因。' : '',
    '- 最终回答用中文简短总结结果，必须写明：使用的 Skill / md、Figma 链接、产物或写入节点、阻塞原因或复核建议。',
    '',
    '## 快照内容兜底',
    '',
    run.primarySkillContent || '平台未提供主 Skill / md 内容快照。若本机无法读取任务中的路径线索，必须停止并回传阻塞原因。',
  ].filter(line => line !== '').join('\n');
}

function buildClientEquivalentMaterialInstruction(run = {}, materialPaths = [], primaryMaterial = '') {
  const paths = [...new Set([primaryMaterial, ...materialPaths].map(item => String(item || '').trim()).filter(Boolean))];
  const display = paths.length ? paths.join('、') : '当前选择的 Skill / md';
  if (run.workflow === 'custom-workflow' && paths.length > 1) {
    return [
      `请按顺序使用这些 Skill / md：${display}`,
      '每一步都按它原本在 Codex 客户端里被引用时的要求执行。'
    ].join('\n');
  }
  return `请使用 ${display}。`;
}

function codexRunArgs(run = {}) {
  const request = run.codexRequest && typeof run.codexRequest === 'object' ? run.codexRequest : {};
  const args = [];
  const model = String(request.model || process.env.ART_WORKER_CODEX_MODEL || '').trim();
  const reasoningEffort = String(request.reasoningEffort || request.modelReasoningEffort || process.env.ART_WORKER_CODEX_REASONING_EFFORT || '').trim();
  if (model) args.push('-m', model);
  if (reasoningEffort) args.push('-c', `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
  return args;
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
    pid: process.pid,
    workerStartedAt,
    currentRunId,
    workerHome,
    runStateDir,
    heartbeatIntervalMs,
    pollIntervalMs,
    onlineGraceMs: onlineHeartbeatGraceMs,
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
  return '本机 Codex 执行';
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
  const parts = splitLogChunk(String(chunk), Math.min(offlineLogChunkMaxChars, 18000));
  for (const part of parts) {
    try {
      await fetchJson(`/api/agent-runs/${encodeURIComponent(runId)}/log`, {
        method: 'POST',
        body: { chunk: part }
      });
    } catch (error) {
      await enqueueRunEvent(runId, {
        type: 'log',
        at: new Date().toISOString(),
        chunk: part
      });
      logOfflineNotice(`日志回传失败，已暂存在本机：${error.message}`);
    }
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

function splitLogChunk(text = '', maxChars = 8000) {
  const value = String(text || '');
  const size = Math.max(1000, Number(maxChars || 8000));
  if (value.length <= size) return value ? [value] : [];
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
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

async function appendLocalRunLog(runId = '', chunk = '') {
  if (!runId || !chunk) return;
  const target = runLogPath(runId);
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, chunk, 'utf8').catch(error => {
    console.error(`[worker] 本机日志写入失败：${error.message}`);
  });
}

async function localRunLogInfo(runId = '') {
  const target = runLogPath(runId);
  try {
    const info = await stat(target);
    return { path: target, size: info.size };
  } catch {
    return { path: target, size: 0 };
  }
}

async function readLocalRunLogForSync(runId = '') {
  const target = runLogPath(runId);
  try {
    const text = await readFile(target, 'utf8');
    if (text.length <= fullLogSyncMaxChars) return text;
    return [
      `[worker] 本机完整日志过长，平台只补传最后 ${fullLogSyncMaxChars} 字符。完整日志仍保留在执行人电脑：${target}`,
      text.slice(-fullLogSyncMaxChars)
    ].join('\n');
  } catch {
    return '';
  }
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

function runLogPath(runId) {
  return path.join(runStateDir, safePathSegment(runId), 'worker-full.log');
}

async function acquireWorkerLock() {
  await mkdir(path.dirname(workerLockPath), { recursive: true });
  while (true) {
    const payload = {
      pid: process.pid,
      deviceId,
      username,
      hostname: os.hostname(),
      workerHome,
      startedAt: workerStartedAt
    };
    try {
      await writeFile(workerLockPath, JSON.stringify(payload, null, 2), { flag: 'wx' });
      lockOwned = true;
      registerLockCleanup();
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readWorkerLock();
      if (!existing?.pid || !isProcessAlive(existing.pid)) {
        await rm(workerLockPath, { force: true }).catch(() => {});
        continue;
      }
      console.error(`[worker] 已有本机 Worker 正在运行：pid=${existing.pid}，device=${existing.deviceId || deviceId}。当前进程等待锁释放，避免重复领取任务。`);
      await sleep(60000);
    }
  }
}

async function readWorkerLock() {
  try {
    const text = await readFile(workerLockPath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  const value = Number(pid || 0);
  if (!value || value === process.pid) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function registerLockCleanup() {
  const cleanup = () => {
    if (!lockOwned) return;
    lockOwned = false;
    void rm(workerLockPath, { force: true });
  };
  process.once('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      cleanup();
      process.exit(0);
    });
  }
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
    ? figmaWriteResult.blockerReason || '未检测到 Figma 放置、替换或写入证据。'
    : '';
  const failureReason = status === 'completed' ? '' : figmaBlocker || extractFailureReason(finalText) || `Codex 退出码：${exitCode}`;
  const completedSummary = figmaWriteResult.required
    ? '本机直接执行已完整完成，已检测到 Figma 放置、替换或写入证据，以及写入后的回读/截图验收证据。'
    : '本机直接执行已完成。';
  const failedSummary = figmaWriteResult.partialWrite
    ? 'Figma 已有部分放置、替换或写入，但最终回读/截图验收未闭环，请恢复授权后继续执行。'
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
  if (!String(run.figmaLinks || '').trim()) return false;
  if (explicitlySkipsFigmaWrite(run)) return false;
  if (figmaTargetIsImagePlacement(run)) return true;
  const text = [
    run.requirement,
    run.title,
    run.sourceTitle,
    run.customWorkflowName,
    run.figmaWriteMode
  ].filter(Boolean).join('\n');
  if (!text.trim()) return false;
  if (/报告|说明|总结|提示词|prompt|参考|分析|复盘/i.test(text)) return false;
  return /写入|修改|改名|重命名|清理|整理|创建|新建|更新|覆盖|替换|应用|落到|同步到|放置|插入|填充|上传|还原|复刻|生成.*(?:Figma|Frame|节点|图层)|Figma.*(?:写入|修改|创建|新建|更新|节点|图层|Frame|页面|放置|替换|填充)|use_figma|upload_assets|createdNodeIds|mutatedNodeIds/i.test(text);
}

function figmaTargetIsImagePlacement(run = {}) {
  return Boolean(String(run.figmaLinks || '').trim() && isImageGenerationRun(run) && !explicitlySkipsFigmaWrite(run));
}

function isImageGenerationRun(run = {}) {
  const text = [
    run.requirement,
    run.title,
    run.sourceTitle,
    run.customWorkflowName,
    run.primarySkillPath,
    run.stage,
    ...(Array.isArray(run.selectedMaterialHints) ? run.selectedMaterialHints : [])
  ].filter(Boolean).join('\n');
  return /纯生图|生成图片|生图|出图|图片生成|文生图|以图生图|图生图|同\s*IP\s*生图|gpt[-_\s]?image|image\s*2|image2|image_gen|图片产物|生成.*(?:海报|插画|角色|icon|图标|banner|KV|贴图|头像|素材)/i.test(text);
}

function explicitlySkipsFigmaWrite(run = {}) {
  const text = [
    run.requirement,
    run.title,
    run.sourceTitle,
    run.customWorkflowName,
    run.figmaWriteMode
  ].filter(Boolean).join('\n');
  return /不写入\s*Figma|无需写入\s*Figma|不需要写入\s*Figma|不要写入\s*Figma|不放(?:入|到)\s*Figma|无需放(?:入|到)\s*Figma|不要替换\s*Figma|仅(?:生成|输出|保存).{0,20}(?:本地|文件|产物)|只(?:生成|输出|保存).{0,20}(?:本地|文件|产物)/i.test(text);
}

function requestsEditableFigmaOutput(run = {}) {
  const text = [
    run.requirement,
    run.title,
    run.sourceTitle,
    run.customWorkflowName
  ].filter(Boolean).join('\n');
  return /转(?:成|为)?可编辑|可编辑图层|可编辑结构|矢量(?:化|重建)?|vector|拆(?:成|为).{0,12}图层|重建.{0,12}(?:Figma|图层|节点)|还原.{0,12}(?:Figma|图层|节点)/i.test(text);
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
  const affirmativeWriteText = extractAffirmativeFigmaWriteText(source);
  const createdSet = new Set(extractArrayLikeValues(affirmativeWriteText, 'createdNodeIds'));
  const mutatedSet = new Set(extractArrayLikeValues(affirmativeWriteText, 'mutatedNodeIds'));
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
  const imagePlacementLines = extractAffirmativeFigmaImagePlacementLines(source);
  for (const item of imagePlacementLines) {
    evidence.push(item.line.slice(0, 500));
    lastWriteOrder = Math.max(lastWriteOrder, item.index);
    if (evidence.length >= 8) break;
  }
  const lines = affirmativeWriteText.split(/\r?\n/).map((line, index) => ({ line: line.trim(), index })).filter(item => item.line);
  for (const line of lines) {
    if (!/createdNodeIds|mutatedNodeIds|figmaWriteResult|use_figma/i.test(line.line)) continue;
    if (/未检测|没有|无写入|缺少|失败|error|failed|blocked|阻塞|不可用/i.test(line.line) && !/createdNodeIds|mutatedNodeIds/.test(line.line)) continue;
    evidence.push(line.line.slice(0, 500));
    if (evidence.length >= 8) break;
  }
  const createdNodeIds = [...createdSet].slice(0, 80);
  const mutatedNodeIds = [...mutatedSet].slice(0, 120);
  const written = createdNodeIds.length > 0 || mutatedNodeIds.length > 0 || evidence.some(line => /figmaWriteResult.*written["']?\s*[:=]\s*true|(?:图片|成品图|位图).{0,80}(?:放置|替换|填充|插入).{0,80}(?:成功|完成|已)|(?:放置|替换|填充|插入).{0,80}(?:Figma|目标|节点).{0,80}(?:成功|完成|已)/i.test(line));
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
    ? 'Codex 进程结束，但未检测到 Figma 写入、图片放置或图片替换证据。必须有 createdNodeIds / mutatedNodeIds，或等价图片放置/替换工具证据后才算完成。'
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

function extractAffirmativeFigmaImagePlacementLines(source = '') {
  const lines = String(source || '').split(/\r?\n/);
  const results = [];
  lines.forEach((line, index) => {
    for (const text of figmaEvidenceLineTexts(line)) {
      if (!hasAffirmativeFigmaImagePlacementText(text)) continue;
      results.push({ line: text, index });
      if (results.length >= 8) return;
    }
  });
  return results.slice(0, 8);
}

function hasAffirmativeFigmaImagePlacementText(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/未(?:完成|检测到|放置|替换|上传|写入)|没有(?:完成|放置|替换|上传|写入)|失败|error|failed|blocked|阻塞|不可用|no\s+(?:placement|upload|mutation)/i.test(value)) return false;
  return /(?:upload_assets|use_figma|Figma|节点|目标).{0,120}(?:图片|成品图|位图|image|asset).{0,120}(?:已|成功|完成).{0,120}(?:放置|替换|填充|插入|上传|落到|写入)|(?:图片|成品图|位图|image|asset).{0,120}(?:已|成功|完成).{0,120}(?:放置|替换|填充|插入|上传|落到|写入).{0,120}(?:Figma|节点|目标)|(?:放置|替换|填充|插入).{0,80}(?:Figma|目标|节点).{0,80}(?:成功|完成|已)/i.test(value);
}

function extractAffirmativeFigmaWriteText(source = '') {
  return String(source || '')
    .split(/\r?\n/)
    .map(figmaWriteEvidenceChunk)
    .filter(Boolean)
    .filter(hasAffirmativeFigmaWriteEvidenceText)
    .join('\n');
}

function figmaWriteEvidenceChunk(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) return '';
  try {
    const event = JSON.parse(trimmed);
    const item = event?.item || {};
    if (item.type === 'command_execution') return '';
    if (item.type === 'agent_message') return String(item.text || '').trim();
    if (item.type === 'mcp_tool_call') {
      if (item.status !== 'completed' || item.error) return '';
      const resultText = figmaToolResultText(item.result);
      if (!/figma/i.test(`${item.server || ''} ${item.tool || ''}`)) return '';
      if (!/createdNodeIds|mutatedNodeIds/i.test(resultText)) return '';
      return `__FIGMA_WRITE_EVENT__ ${item.tool || 'use_figma'} ${item.arguments?.description || ''} ${resultText}`.trim();
    }
    return String(event.message || event.text || event.delta || '').trim();
  } catch {
    return trimmed;
  }
}

function hasAffirmativeFigmaWriteEvidenceText(text = '') {
  const value = String(text || '');
  if (!/createdNodeIds|mutatedNodeIds|figmaWriteResult/i.test(value)) return false;
  const hasNodeIds = extractArrayLikeValues(value, 'createdNodeIds').length > 0
    || extractArrayLikeValues(value, 'mutatedNodeIds').length > 0;
  if (!hasNodeIds) return false;
  if (/未生成|未检测到|未完成\s*Figma\s*写入|没有执行写入|没有实际写入|无，本次未完成|no mutation|no canvas mutation/i.test(value)) return false;
  return /^__FIGMA_WRITE_EVENT__\b/.test(value)
    || /写入成功|Figma 写入证据|figmaWriteResult\s*[:=]\s*["']?(?:rename_applied|applied|written|true)|mutationCount/i.test(value);
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
  const equalsPattern = new RegExp(`${field}[^\\n:=]*[:=]\\s*(?!\\[)([^\\n\\r]+)`, 'gi');
  match = equalsPattern.exec(text);
  while (match) {
    String(match[1] || '')
      .split(/,|\\s|；|、/)
      .map(item => item.replace(/["'`\\[\\]]/g, '').trim())
      .filter(isLikelyFigmaNodeId)
      .forEach(item => values.add(item));
    match = equalsPattern.exec(text);
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
  const effectiveLastWriteOrder = findEffectiveLastFigmaWriteOrder(source, toolEvents, lastWriteOrder);
  for (const event of toolEvents) {
    if (event.order <= effectiveLastWriteOrder || event.success) continue;
    const reason = event.errorText || event.resultText;
    if (!reason) continue;
    blockers.push(`Figma 写入后 ${event.tool || 'MCP'} 验证失败：${compactReason(reason)}`);
  }
  const lines = String(source || '').split(/\r?\n/);
  for (let index = Math.max(effectiveLastWriteOrder + 1, 0); index < lines.length; index += 1) {
    for (const line of figmaEvidenceLineTexts(lines[index])) {
      if (!isFigmaPostWriteBlockerLine(line)) continue;
      blockers.push(compactReason(line));
      if (blockers.length >= 5) break;
    }
    if (blockers.length >= 5) break;
  }
  return [...new Set(blockers)].slice(0, 5);
}

function extractPostWriteVerificationEvidence(source = '', toolEvents = [], lastWriteOrder = -1) {
  if (lastWriteOrder < 0) return [];
  const evidence = [];
  const effectiveLastWriteOrder = findEffectiveLastFigmaWriteOrder(source, toolEvents, lastWriteOrder);
  for (const event of toolEvents) {
    if (event.order <= effectiveLastWriteOrder || !event.success) continue;
    if (event.tool === 'get_screenshot' || /截图|screenshot/i.test(event.description)) {
      evidence.push(`写入后截图验收成功：${event.tool}`);
      continue;
    }
    if (event.tool === 'use_figma' && /回读|复扫|验证|验收|检查|read|verify|validation/i.test(event.description)) {
      evidence.push(`写入后回读验收成功：${event.description || event.tool}`);
    }
  }
  const lines = String(source || '').split(/\r?\n/);
  for (let index = Math.max(effectiveLastWriteOrder + 1, 0); index < lines.length; index += 1) {
    for (const line of figmaEvidenceLineTexts(lines[index])) {
      if (isFigmaVerificationSuccessLine(line)) evidence.push(compactReason(line));
      if (evidence.length >= 5) break;
    }
    if (evidence.length >= 5) break;
  }
  if (!evidence.length) {
    const firstWriteOrder = findFirstFigmaWriteOrder(source, toolEvents, lastWriteOrder);
    if (firstWriteOrder >= 0 && firstWriteOrder < effectiveLastWriteOrder) {
      for (let index = firstWriteOrder + 1; index < lines.length; index += 1) {
        for (const line of figmaEvidenceLineTexts(lines[index])) {
          if (isFigmaVerificationSuccessLine(line)) evidence.push(compactReason(line));
          if (evidence.length >= 5) break;
        }
        if (evidence.length >= 5) break;
      }
    }
  }
  return [...new Set(evidence)].slice(0, 5);
}

function findEffectiveLastFigmaWriteOrder(source = '', toolEvents = [], fallbackOrder = -1) {
  const toolWriteOrders = toolEvents
    .filter(event => event.createdNodeIds.length || event.mutatedNodeIds.length)
    .map(event => event.order);
  if (toolWriteOrders.length) return Math.max(...toolWriteOrders);
  const imagePlacementOrders = extractAffirmativeFigmaImagePlacementLines(source).map(item => item.index);
  if (imagePlacementOrders.length) return Math.max(...imagePlacementOrders);
  return fallbackOrder;
}

function findFirstFigmaWriteOrder(source = '', toolEvents = [], fallbackOrder = -1) {
  const toolWriteOrders = toolEvents
    .filter(event => event.createdNodeIds.length || event.mutatedNodeIds.length)
    .map(event => event.order);
  if (toolWriteOrders.length) return Math.min(...toolWriteOrders);
  const imagePlacementOrders = extractAffirmativeFigmaImagePlacementLines(source).map(item => item.index);
  if (imagePlacementOrders.length) return Math.min(...imagePlacementOrders);
  const lines = String(source || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (/createdNodeIds|mutatedNodeIds/i.test(lines[index] || '') || hasAffirmativeFigmaImagePlacementText(lines[index])) return index;
  }
  return fallbackOrder;
}

function isNegatedFigmaBlockerLine(line = '') {
  const text = compactReason(line);
  if (!text) return false;
  return /(?:^|[，。；\s])阻塞原因\s*[:：]\s*(?:无|没有|未发现)|无最终阻塞|无硬阻塞|无阻塞|没有阻塞|未发现阻塞|不构成阻塞|不作为阻塞/i.test(text);
}

function isNonBlockingFigmaNoteLine(line = '') {
  const text = compactReason(line);
  if (!text) return false;
  return /(?:Figma MCP|MCP|截图工具).*(?:截图已生成|截图.*返回|内联截图|可见)|(?:shell|curl|本机).*(?:无法|不能).*(?:下载|解析|保存).*(?:figma\.com|截图|图片|本地)|(?:平台产物目录|产物目录|报告).*(?:不可写|只可读|未能落盘|不能落盘)/i.test(text);
}

function isFigmaPostWriteBlockerLine(line = '') {
  const text = compactReason(line);
  if (!text || isNegatedFigmaBlockerLine(text) || isNonBlockingFigmaNoteLine(text)) return false;
  if (/Auth required|OAuth|permission|denied|Transport send error|tool call failed/i.test(text)) return true;
  if (/(?:最终|回读|截图|验证|验收|复扫).{0,120}(?:失败|阻塞|未完成|不可用|无权限|没有权限)/i.test(text)) return true;
  if (/Figma MCP.{0,120}(?:失败|阻塞|未完成|不可用|Auth required|OAuth|permission|denied|Transport send error|tool call failed)/i.test(text)) return true;
  return false;
}

function isFigmaVerificationSuccessLine(line = '') {
  const text = compactReason(line);
  if (!text) return false;
  if (isNegatedFigmaBlockerLine(text)) return true;
  if (isFigmaPostWriteBlockerLine(text)) return false;
  if (/^\d+\.\s*每批执行后回读|^\d+\.\s*每完成一个有意义的批次|`(?:已验证|部分验证|未验证)`|按以下|成功标准|工作流|必须|不要|不得|只允许/i.test(text)) return false;
  return /最终.*(?:回读|截图|验证|验收).*(?:完成|通过|成功|已完成|已生成|已返回|已保存|已验证)|(?:回读|截图|视觉|复核|验证|验收).*(?:完成|通过|成功|已完成|已生成|已返回|已保存|已验证|可见|确认)|(?:已回读|回读确认|截图复核已通过|视觉复核通过|内联截图可见|截图工具.*返回|MCP.*截图.*已生成|未见换行、遮挡、截断|画面无空白|无明显(?:遮挡|错位|截断|异常换行)|同类复扫.*(?:未发现|清零|无残留))/i.test(text);
}

function figmaEvidenceLineTexts(line = '') {
  return figmaEvidenceLineText(line)
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
}

function figmaEvidenceLineText(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) return '';
  try {
    const event = JSON.parse(trimmed);
    const item = event?.item || {};
    if (item.type === 'command_execution') return '';
    if (item.type === 'agent_message') return String(item.text || '').trim();
    if (item.type === 'mcp_tool_call') {
      if (item.status === 'completed' && !item.error) return '';
      return [
        item.server,
        item.tool,
        figmaToolErrorText(item.error),
        figmaToolResultText(item.result)
      ].filter(Boolean).join(' ');
    }
    return String(event.message || event.text || event.delta || '').trim();
  } catch {
    return trimmed;
  }
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

async function fetchBinary(pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    const url = /^https?:\/\//i.test(pathname) ? pathname : `${apiBase}${pathname}`;
    response = await fetch(url, {
      headers: cookie ? { Cookie: cookie } : {},
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`平台请求超时 ${requestTimeoutMs}ms：${pathname}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

function parseSetCookie(value = '') {
  return String(value || '').split(',').map(item => item.split(';')[0]).filter(Boolean).join('; ');
}

function normalizeBaseUrl(value = '') {
  return String(value || '').replace(/\/+$/, '');
}
