#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const apiBase = normalizeBaseUrl(process.env.ART_PLATFORM_API || process.env.API_BASE || 'http://127.0.0.1:4288');
const username = process.env.ART_PLATFORM_USERNAME || process.env.AWP_USERNAME || '';
const password = process.env.ART_PLATFORM_PASSWORD || process.env.AWP_PASSWORD || '';
const deviceId = process.env.ART_WORKER_DEVICE_ID || `${os.hostname()}-${os.userInfo().username}`;
const pollIntervalMs = Math.max(60000, Number(process.env.ART_WORKER_POLL_INTERVAL_MS || 300000));
const heartbeatIntervalMs = Math.max(60000, Number(process.env.ART_WORKER_HEARTBEAT_INTERVAL_MS || 300000));
const codexPath = process.env.CODEX_CLI_PATH || 'codex';
const defaultProjectRoot = process.env.ART_WORKER_PROJECT_ROOT || process.env.ART_WORKER_HOME || process.cwd();

let cookie = '';
let currentUser = null;
let lastHeartbeatAt = 0;
let checkingRuns = false;
let eventSyncStarted = false;
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
  await login();
  localChecks = await runLocalChecks();
  console.log(`[worker] 已连接 ${apiBase}，当前账号：${currentUser?.displayName || currentUser?.username || username}`);
  console.log(`[worker] Codex: ${localChecks.codexMessage}`);
  console.log(`[worker] Figma MCP: ${localChecks.figmaMessage}`);
  await heartbeat(true);
  startPlatformEventSync();
  while (true) {
    try {
      await heartbeat();
      await checkAndExecuteNextRun();
    } catch (error) {
      console.error(`[worker] ${error.message}`);
      if (/401|登录态|认证/.test(error.message)) await login();
    }
    await sleep(pollIntervalMs);
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

async function checkAndExecuteNextRun() {
  if (checkingRuns) return;
  checkingRuns = true;
  try {
    while (true) {
      const run = await claimNextRun();
      if (!run) break;
      await executeRun(run);
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
      if (/401|登录态|认证/.test(error.message)) await login();
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
  console.log(`[worker] 领取直接执行：${run.title} (${run.id})`);
  await updateRunStatus(run.id, {
    status: 'running',
    workerStatus: 'running',
    startedAt: new Date().toISOString(),
    currentStage: '本机 Codex 执行'
  });

  const prompt = buildPrompt(run);
  const args = [
    'exec',
    '--json',
    '--cd',
    run.projectRoot || defaultProjectRoot,
    '--sandbox',
    'workspace-write',
    '-'
  ];
  const child = spawn(codexPath, args, {
    cwd: run.projectRoot || defaultProjectRoot,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let finalText = '';
  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    finalText += collectReadableJsonl(text);
    void appendRunLog(run.id, text);
    process.stdout.write(text);
  });
  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    void appendRunLog(run.id, text);
    process.stderr.write(text);
  });
  child.stdin.end(prompt);

  const exitCode = await waitForChild(child);
  const status = exitCode === 0 ? 'completed' : 'failed';
  await updateRunStatus(run.id, {
    status,
    workerStatus: status,
    exitCode,
    finishedAt: new Date().toISOString(),
    resultSummary: buildResultSummary(status, exitCode, finalText),
    workerResult: {
      deviceId,
      hostname: os.hostname(),
      exitCode,
      finalText: finalText.slice(-8000)
    }
  });
  console.log(`[worker] 执行结束：${run.title} (${status})`);
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

async function runLocalChecks() {
  const codex = await runCommand(codexPath, ['--help']);
  const mcp = await runCommand(codexPath, ['mcp', 'list']);
  const figmaReady = mcp.code === 0 && /figma/i.test(`${mcp.stdout}\n${mcp.stderr}`);
  return {
    codexReady: codex.code === 0,
    figmaMcpReady: figmaReady,
    codexMessage: codex.code === 0 ? '可用' : `不可用：${codex.stderr || codex.error || codex.code}`,
    figmaMessage: figmaReady ? '已发现 figma MCP 配置' : '未发现 figma MCP 配置，请先在本机 Codex 完成 Figma MCP 授权'
  };
}

function runCommand(command, args = []) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => resolve({ code: -1, stdout, stderr, error: error.message }));
    child.on('close', code => resolve({ code: Number(code || 0), stdout, stderr }));
  });
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

function buildResultSummary(status, exitCode, finalText) {
  return {
    status,
    statusText: status,
    summary: status === 'completed' ? '本机直接执行已完成，具体 Figma 写入结果请查看执行日志和报告。' : '本机直接执行失败，请查看阻塞原因和原始日志。',
    blockerReason: status === 'completed' ? '' : `Codex 退出码：${exitCode}`,
    needsHumanReview: true,
    validationCommands: ['codex exec --json'],
    artifacts: [],
    finalText: String(finalText || '').slice(-4000),
    parsedAt: new Date().toISOString()
  };
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
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve(Number(code || 0)));
  });
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
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
