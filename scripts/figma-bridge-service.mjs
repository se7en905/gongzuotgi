#!/usr/bin/env node
import http from 'node:http';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const host = process.env.FIGMA_BRIDGE_HOST || '127.0.0.1';
const port = Number(process.env.FIGMA_BRIDGE_PORT || 9530);
const taskTimeoutMs = Math.max(5000, Number(process.env.FIGMA_BRIDGE_TASK_TIMEOUT_MS || 45000));
const pluginStaleMs = Math.max(5000, Number(process.env.FIGMA_BRIDGE_PLUGIN_STALE_MS || 15000));
const platformBases = normalizeBaseList(process.env.ART_PLATFORM_BASES || process.env.ART_PLATFORM_API || process.env.API_BASE || '');
const platformHeartbeatMinIntervalMs = Math.max(1000, Number(process.env.ART_PLATFORM_HEARTBEAT_MIN_INTERVAL_MS || 5000));
const pluginBinding = {
  token: cleanString(process.env.ART_PLUGIN_BINDING_TOKEN || ''),
  userId: cleanString(process.env.ART_PLUGIN_BOUND_USER_ID || ''),
  username: cleanString(process.env.ART_PLUGIN_BOUND_USERNAME || ''),
  displayName: cleanString(process.env.ART_PLUGIN_BOUND_DISPLAY_NAME || '')
};
const pendingTasks = [];
const taskResults = new Map();
let lastPlatformHeartbeatAt = 0;
let lastPlatformHeartbeat = {
  ok: false,
  base: '',
  error: '',
  forwardedAt: ''
};

let pluginState = {
  connected: false,
  lastSeenAt: '',
  fileKey: '',
  fileName: '',
  pageName: '',
  pluginVersion: ''
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
    if (req.method === 'OPTIONS') return sendEmpty(res, 204);
    if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, bridgeHealth());
    if (req.method === 'GET' && url.pathname === '/plugin/next') return handlePluginNext(req, res, url);
    if (req.method === 'POST' && url.pathname === '/plugin/result') return handlePluginResult(req, res);
    if (req.method === 'POST' && url.pathname === '/tasks') return handleCreateTask(req, res, url);
    if (req.method === 'POST' && url.pathname === '/test/create-text') return handleCreateTextTest(req, res, url);
    if (req.method === 'GET' && url.pathname.startsWith('/tasks/')) return handleGetTaskResult(res, url.pathname);
    sendJson(res, 404, { ok: false, error: 'figma bridge route not found' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`[figma-bridge] listening on http://${host}:${port}`);
});

function bridgeHealth() {
  const lastSeenMs = Date.parse(pluginState.lastSeenAt || '') || 0;
  const pluginConnected = Boolean(lastSeenMs && Date.now() - lastSeenMs < pluginStaleMs);
  return {
    ok: true,
    ready: pluginConnected,
    service: 'art-platform-figma-bridge',
    host,
    port,
    pid: process.pid,
    hostname: os.hostname(),
    pendingTaskCount: pendingTasks.length,
    resultCount: taskResults.size,
    platformBases,
    platformHeartbeat: lastPlatformHeartbeat,
    pluginConnected,
    plugin: {
      ...pluginState,
      connected: pluginConnected
    },
    checkedAt: new Date().toISOString()
  };
}

async function handlePluginNext(req, res, url) {
  pluginState = {
    connected: true,
    lastSeenAt: new Date().toISOString(),
    fileKey: cleanString(url.searchParams.get('fileKey')),
    fileName: cleanString(url.searchParams.get('fileName')),
    pageName: cleanString(url.searchParams.get('pageName')),
    pluginVersion: cleanString(url.searchParams.get('version'))
  };
  forwardPlatformHeartbeat(pluginState).catch(error => {
    lastPlatformHeartbeat = {
      ok: false,
      base: '',
      error: error.message || String(error),
      forwardedAt: new Date().toISOString()
    };
  });
  const task = pendingTasks.shift() || null;
  sendJson(res, 200, { ok: true, task });
}

async function handlePluginResult(req, res) {
  const body = await readJson(req);
  const taskId = cleanString(body.id || body.taskId);
  if (!taskId) return sendJson(res, 400, { ok: false, error: 'missing task id' });
  const result = {
    id: taskId,
    ok: body.ok === true,
    error: cleanString(body.error),
    createdNodeIds: normalizeStringList(body.createdNodeIds),
    mutatedNodeIds: normalizeStringList(body.mutatedNodeIds),
    fileKey: cleanString(body.fileKey),
    fileName: cleanString(body.fileName),
    pageName: cleanString(body.pageName),
    completedAt: new Date().toISOString()
  };
  taskResults.set(taskId, result);
  await forwardPlatformHeartbeat({
    ...pluginState,
    ...result,
    ok: result.ok,
    error: result.error || ''
  }, { force: true }).catch(error => {
    lastPlatformHeartbeat = {
      ok: false,
      base: '',
      error: error.message || String(error),
      forwardedAt: new Date().toISOString()
    };
  });
  sendJson(res, 200, { ok: true, result });
}

async function handleCreateTask(req, res, url) {
  const body = await readJson(req);
  const task = normalizeTask(body);
  pendingTasks.push(task);
  const waitMs = Math.min(Math.max(Number(url.searchParams.get('waitMs') || 0), 0), taskTimeoutMs);
  if (!waitMs) return sendJson(res, 202, { ok: true, taskId: task.id, task });
  const result = await waitForTaskResult(task.id, waitMs);
  if (!result) return sendJson(res, 202, { ok: true, taskId: task.id, pending: true });
  sendJson(res, result.ok ? 200 : 500, { ok: result.ok, taskId: task.id, result, error: result.error || '' });
}

async function handleCreateTextTest(req, res, url) {
  const body = await readJson(req).catch(() => ({}));
  const task = normalizeTask({
    type: 'create-text',
    text: cleanString(body.text) || 'mcp_test_figma_bridge',
    x: Number(body.x ?? 120),
    y: Number(body.y ?? 120)
  });
  pendingTasks.push(task);
  const waitMs = Math.min(Math.max(Number(url.searchParams.get('waitMs') || 30000), 1000), taskTimeoutMs);
  const result = await waitForTaskResult(task.id, waitMs);
  if (!result) return sendJson(res, 202, { ok: true, taskId: task.id, pending: true, message: '任务已发送，请确认 Figma 插件窗口保持打开。' });
  sendJson(res, result.ok ? 200 : 500, { ok: result.ok, taskId: task.id, result, error: result.error || '' });
}

function handleGetTaskResult(res, pathname) {
  const taskId = decodeURIComponent(pathname.split('/').filter(Boolean)[1] || '');
  const result = taskResults.get(taskId);
  if (!result) return sendJson(res, 404, { ok: false, error: 'task result not found', taskId });
  sendJson(res, 200, { ok: result.ok, taskId, result });
}

function normalizeTask(input = {}) {
  return {
    id: cleanString(input.id) || randomUUID(),
    type: cleanString(input.type || 'create-text'),
    text: cleanString(input.text || 'mcp_test_figma_bridge'),
    x: Number.isFinite(Number(input.x)) ? Number(input.x) : 120,
    y: Number.isFinite(Number(input.y)) ? Number(input.y) : 120,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    createdAt: new Date().toISOString()
  };
}

async function forwardPlatformHeartbeat(status = {}, options = {}) {
  if (!platformBases.length) {
    lastPlatformHeartbeat = {
      ok: false,
      base: '',
      error: '未配置工作台地址',
      forwardedAt: new Date().toISOString()
    };
    return lastPlatformHeartbeat;
  }
  const now = Date.now();
  if (!options.force && lastPlatformHeartbeatAt && now - lastPlatformHeartbeatAt < platformHeartbeatMinIntervalMs) {
    return lastPlatformHeartbeat;
  }
  lastPlatformHeartbeatAt = now;
  const payload = {
    service: 'art-platform-figma-local-bridge',
    relayHost: host,
    relayPort: port,
    relayHostname: os.hostname(),
    fileKey: cleanString(status.fileKey),
    fileName: cleanString(status.fileName),
    pageName: cleanString(status.pageName),
    pluginVersion: cleanString(status.pluginVersion),
    bindingToken: pluginBinding.token,
    boundUserId: pluginBinding.userId,
    boundUsername: pluginBinding.username,
    boundDisplayName: pluginBinding.displayName,
    createdNodeIds: normalizeStringList(status.createdNodeIds),
    mutatedNodeIds: normalizeStringList(status.mutatedNodeIds),
    ok: status.ok === true,
    error: cleanString(status.error)
  };
  let lastError = '';
  for (const base of platformBases) {
    try {
      const response = await fetch(`${base}/api/figma-plugin/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok === true) {
        lastPlatformHeartbeat = {
          ok: true,
          base,
          error: '',
          forwardedAt: new Date().toISOString()
        };
        return lastPlatformHeartbeat;
      }
      lastError = data.error || `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  lastPlatformHeartbeat = {
    ok: false,
    base: '',
    error: lastError || '所有工作台地址都不可访问',
    forwardedAt: new Date().toISOString()
  };
  return lastPlatformHeartbeat;
}

async function waitForTaskResult(taskId, waitMs) {
  const started = Date.now();
  while (Date.now() - started < waitMs) {
    if (taskResults.has(taskId)) return taskResults.get(taskId);
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  return null;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(res, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true'
  });
  res.end(body);
}

function sendEmpty(res, status) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true'
  });
  res.end();
}

function cleanString(value = '') {
  return String(value || '').trim();
}

function normalizeBaseList(value = '') {
  return String(value || '')
    .split(/[\s,，]+/)
    .map(item => item.trim().replace(/\/+$/, ''))
    .filter(item => /^https?:\/\//i.test(item));
}

function normalizeStringList(value = []) {
  if (Array.isArray(value)) return value.map(item => cleanString(item)).filter(Boolean);
  return cleanString(value).split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
}
