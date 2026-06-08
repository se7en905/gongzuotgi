import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTasks as listStoredTasks, upsertTasks } from '../server/store.mjs';
import { closeMysqlStore } from '../server/mysql-store.mjs';
import { getZentaoApi, getZentaoModules } from '../server/zentao-adapter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectId = process.env.AWP_PROJECT_ID || 'art_department';
const artDeptId = Number(process.env.ZENTAO_ART_DEPT_ID || 27);
const limitExecutions = Number(process.env.ZENTAO_EXECUTION_LIMIT || 1000);
const taskPageLimit = Number(process.env.ZENTAO_TASK_LIMIT || 1000);
const taskScope = process.env.ZENTAO_TASK_SCOPE || 'all';
const artDashboardDataDir = process.env.ART_DASHBOARD_DATA_DIR || path.join(root, 'data', 'art-dashboard');

const api = await getZentaoApi();
const zentao = await getZentaoModules();
const users = await listZentaoUsers();
const artUsers = users.filter(user => zentaoUserDeptId(user) === artDeptId);
const artAccounts = new Set(artUsers.map(user => zentaoUserAccount(user)).filter(Boolean));
let artUserSource = 'zentao-users';
if (!artAccounts.size) {
  for (const user of await fallbackArtDepartmentUsers()) {
    const account = zentaoUserAccount(user);
    if (account) artAccounts.add(account);
  }
  artUserSource = 'platform-fallback';
}
if (!artAccounts.size) {
  throw new Error(`ZenTao 同步失败：未获取到部门 ID=${artDeptId} 的美术人员，已保留现有任务列表。`);
}
const userNames = new Map([
  ...(await fallbackArtDepartmentUsers()).map(user => [zentaoUserAccount(user), user.realname || user.name || zentaoUserAccount(user)]),
  ...users.map(user => [zentaoUserAccount(user), user.realname || user.name || zentaoUserAccount(user)])
].filter(([account]) => account));

const executionsResult = await zentao.listExecutions(api, { page: 1, limit: limitExecutions });
const executions = executionsResult?.result?.executions || [];
const executionById = new Map(executions.map(execution => [Number(execution.id), execution]));

const existingTasks = await listStoredTasks();
const taskMap = new Map();
for (const task of existingTasks) {
  taskMap.set(mapKey(task), mergeDuplicateTask(taskMap.get(mapKey(task)), task));
}
const syncedAt = new Date().toISOString();
const currentTaskIds = new Set();
const existingZentaoTaskNos = new Set([...taskMap.values()]
  .filter(task => task.projectId === projectId && task.source === 'zentao' && task.taskNo)
  .map(task => String(task.taskNo)));
const artSeenCandidateTaskNos = await listArtSeenCandidateTaskNos({
  maxAgeMs: Number(process.env.ZENTAO_SEEN_CANDIDATE_MAX_AGE_MS || 2 * 24 * 60 * 60 * 1000)
});
for (const taskNo of artSeenCandidateTaskNos) existingZentaoTaskNos.add(String(taskNo));
const existingCurrentZentaoKeys = new Set([...taskMap.entries()]
  .filter(([, task]) => task.projectId === projectId && task.source === 'zentao' && task.taskNo && task.isCurrent !== false && isArtTask(task))
  .map(([key]) => key));
let scanned = 0;
let matched = 0;
let created = 0;
let updated = 0;
const executionErrors = [];
const detailRefreshFailures = [];

for (const execution of executions) {
  let result;
  try {
    result = await zentao.listTasks(api, { execution: execution.id, page: 1, limit: taskPageLimit });
  } catch (error) {
    executionErrors.push({ execution: execution.id, error: error.message || String(error) });
    continue;
  }
  const roots = result?.result?.tasks || [];
  const flatTasks = roots.flatMap(flattenTask);
  scanned += flatTasks.length;

  for (const zentaoTask of flatTasks) {
    const taskNo = String(zentaoTask.id || zentaoTask.taskID || '').trim();
    if (isBugLikeTask(zentaoTask)) continue;
    const existingTask = taskMap.get(`${projectId}:${taskNo}`);
    const currentArtTask = isCurrentArtTask(zentaoTask);
    if (!currentArtTask && !(existingZentaoTaskNos.has(taskNo) && isArtTask(zentaoTask))) continue;
    if (taskScope === 'unfinished' && !isUnfinishedTask(zentaoTask)) continue;
    matched += 1;
    const normalized = normalizeZentaoTask(zentaoTask, executionById.get(Number(zentaoTask.execution)));
    const key = mapKey(normalized);
    if (currentArtTask) currentTaskIds.add(key);
    const existed = taskMap.get(key);
    taskMap.set(key, {
      ...(existed || {}),
      ...normalized,
      id: existed?.id || normalized.id,
      createdAt: existed?.createdAt || normalized.createdAt,
      archivedAt: '',
      updatedAt: syncedAt
    });
    if (existed) updated += 1;
    else created += 1;
  }
}

let detailRefreshed = 0;
for (const taskNo of existingZentaoTaskNos) {
  try {
    const result = await zentao.getTask(api, { id: taskNo });
    const zentaoTask = unwrapZentaoTaskPayload(result);
    if (!zentaoTask || !(zentaoTask.id || zentaoTask.taskID)) throw new Error(`ZenTao 未返回任务详情：${describeZentaoPayloadShape(result)}`);
    for (const detailTask of expandZentaoDetailTasks(zentaoTask)) {
      const detailTaskNo = String(detailTask.id || detailTask.taskID || '').trim();
      const normalized = normalizeZentaoTask(
        {
          ...detailTask,
          executionName: detailTask.executionName || taskMap.get(`${projectId}:${detailTaskNo}`)?.zentao?.executionName || ''
        },
        executionById.get(Number(detailTask.execution))
      );
      const key = mapKey(normalized);
      const existed = taskMap.get(key);
      const currentArtTask = isCurrentArtTask(detailTask);
      if (!currentArtTask) continue;
      taskMap.set(key, {
        ...(existed || {}),
        ...normalized,
        id: existed?.id || normalized.id,
        isCurrent: currentArtTask,
        syncStatus: currentArtTask ? 'current' : 'non_current',
        archivedAt: currentArtTask ? '' : existed?.archivedAt || syncedAt,
        updatedAt: syncedAt
      });
      if (currentArtTask) currentTaskIds.add(key);
      detailRefreshed += 1;
    }
  } catch (error) {
    detailRefreshFailures.push({ taskNo, error: error.message || String(error) });
  }
}

let markedCurrent = 0;
let markedNonCurrent = 0;
const currentSnapshotReliable = hasReliableCurrentSnapshot({
  currentTaskCount: currentTaskIds.size,
  detailRefreshed,
  detailRefreshFailures,
  detailRefreshCandidateCount: existingZentaoTaskNos.size,
  matchedTaskCount: matched,
  executionErrors,
  executionCount: executions.length
});
const preserveExistingCurrentTasks = existingCurrentZentaoKeys.size >= 10
  && !currentSnapshotReliable
  && currentTaskIds.size > 0
  && currentTaskIds.size < Math.ceil(existingCurrentZentaoKeys.size * 0.5);
if (preserveExistingCurrentTasks) {
  for (const key of existingCurrentZentaoKeys) currentTaskIds.add(key);
}
const noReliableIncomingTasks = !currentSnapshotReliable && currentTaskIds.size === 0 && existingCurrentZentaoKeys.size > 0;
if (noReliableIncomingTasks) {
  for (const key of existingCurrentZentaoKeys) currentTaskIds.add(key);
}
for (const [key, task] of taskMap) {
  if (task.projectId !== projectId || task.source !== 'zentao') continue;
  const isCurrent = currentTaskIds.has(key);
  const wasCurrent = task.isCurrent !== false;
  task.isCurrent = isCurrent;
  task.syncStatus = isCurrent ? 'current' : 'non_current';
  task.lastSyncedAt = syncedAt;
  task.archivedAt = isCurrent ? '' : task.archivedAt || syncedAt;
  if (isCurrent && !wasCurrent) markedCurrent += 1;
  if (!isCurrent && wasCurrent) markedNonCurrent += 1;
}

const merged = dedupeForStore([...taskMap.values()])
  .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
await upsertTasks(merged);

console.log(JSON.stringify({
  ok: true,
  projectId,
  artDeptId,
  artUserCount: artUsers.length,
  artAccountCount: artAccounts.size,
  artUserSource,
  artSeenCandidateTasks: artSeenCandidateTaskNos.length,
  executionCount: executions.length,
  scope: taskScope,
  scannedTaskCount: scanned,
  matchedTaskCount: matched,
  executionErrors,
  detailRefreshed,
  detailRefreshFailures,
  preservedExistingCurrentTasks: preserveExistingCurrentTasks,
  preservedExistingTasks: noReliableIncomingTasks,
  markedCurrent,
  markedNonCurrent,
  created,
  updated,
  totalTasks: merged.length
}, null, 2));
await closeMysqlStore();

function flattenTask(task) {
  const children = Array.isArray(task.children) ? task.children.flatMap(flattenTask) : [];
  return [task, ...children];
}

function mapKey(task = {}) {
  if (task.projectId && task.taskNo) return `${task.projectId}:${task.taskNo}`;
  return task.id || `${task.projectId || ''}:${task.title || ''}`;
}

function mergeDuplicateTask(previous, next) {
  if (!previous) return next;
  const previousTime = taskMergeTime(previous);
  const nextTime = taskMergeTime(next);
  const primary = nextTime >= previousTime ? next : previous;
  const secondary = primary === next ? previous : next;
  const isCurrent = Object.prototype.hasOwnProperty.call(primary, 'isCurrent')
    ? primary.isCurrent !== false
    : secondary.isCurrent !== false;
  return {
    ...secondary,
    ...primary,
    id: previous.id || next.id,
    isCurrent,
    syncStatus: isCurrent ? 'current' : 'non_current',
    createdAt: previous.createdAt || next.createdAt,
    updatedAt: latestDate(previous.updatedAt, next.updatedAt),
    lastSyncedAt: latestDate(previous.lastSyncedAt, next.lastSyncedAt),
    archivedAt: isCurrent ? '' : previous.archivedAt || next.archivedAt || ''
  };
}

function taskMergeTime(task = {}) {
  return Math.max(
    parseTaskDate(task.lastSyncedAt),
    parseTaskDate(task.updatedAt),
    parseTaskDate(task.createdAt)
  );
}

function parseTaskDate(value = '') {
  const text = String(value || '').trim();
  if (!text || /^0{4}-0{2}-0{2}/.test(text)) return 0;
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : 0;
}

function hasReliableCurrentSnapshot({
  currentTaskCount = 0,
  detailRefreshed = 0,
  detailRefreshFailures = [],
  detailRefreshCandidateCount = 0,
  matchedTaskCount = 0,
  executionErrors = [],
  executionCount = 0
} = {}) {
  const refreshFailed = Array.isArray(detailRefreshFailures)
    ? detailRefreshFailures.length
    : Number(detailRefreshFailures || 0);
  const detailReliable = Number(detailRefreshCandidateCount || 0) > 0
    && Number(detailRefreshed || 0) > 0
    && refreshFailed < Number(detailRefreshCandidateCount || 0);
  const executionReliable = Number(executionCount || 0) > 0
    && Number(matchedTaskCount || 0) > 0
    && (!Array.isArray(executionErrors) || executionErrors.length < Number(executionCount || 0));
  return Number(currentTaskCount || 0) > 0 && (detailReliable || executionReliable);
}

function unwrapZentaoTaskPayload(payload = {}) {
  const candidates = [
    payload?.result?.task,
    payload?.result,
    payload?.data?.task,
    payload?.data,
    payload?.task,
    payload
  ];
  return candidates.find(candidate => candidate && typeof candidate === 'object' && (candidate.id || candidate.taskID)) || null;
}

function describeZentaoPayloadShape(payload = {}) {
  if (!payload || typeof payload !== 'object') return typeof payload;
  const result = payload.result;
  const data = payload.data;
  return JSON.stringify({
    status: payload.status,
    msg: payload.msg,
    keys: Object.keys(payload).slice(0, 12),
    resultType: Array.isArray(result) ? 'array' : typeof result,
    resultKeys: result && typeof result === 'object' && !Array.isArray(result) ? Object.keys(result).slice(0, 12) : [],
    dataType: Array.isArray(data) ? 'array' : typeof data,
    dataKeys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 12) : []
  });
}

function latestDate(a, b) {
  return String(a || '') > String(b || '') ? a : b;
}

function dedupeForStore(tasks = []) {
  const rows = new Map();
  for (const task of tasks) {
    const key = storeKey(task);
    rows.set(key, mergeDuplicateTask(rows.get(key), task));
  }
  return [...rows.values()];
}

function storeKey(task = {}) {
  const taskNo = String(task.taskNo || task.zentaoId || task.title || '').match(/\b\d{4,8}\b/)?.[0] || '';
  if (task.projectId && taskNo) return `${slugify(task.projectId)}_${taskNo}`;
  return task.id || `${slugify(task.projectId || '')}_${slugify(task.title || '')}`;
}

function slugify(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'item';
}

function isArtTask(task) {
  const assignedToCandidates = [
    task.assignedTo,
    task.zentao?.assignedTo
  ].map(accountOf).filter(Boolean);
  return assignedToCandidates.some(assignedTo => artAccounts.has(assignedTo));
}

function isCurrentArtTask(task = {}) {
  return isUnfinishedTask(task) && isArtTask(task);
}

function isArtAcceptanceOrDesignSyncTask(task = {}, existing = null) {
  const titleText = [
    task.name,
    task.title,
    task.storyTitle,
    task.story?.title,
    task.parentName,
    task.executionName,
    task.execution?.name,
    existing?.title,
    existing?.summary,
    existing?.zentao?.storyTitle,
    existing?.zentao?.parentName,
    existing?.zentao?.executionName
  ].map(value => String(value || '')).join('\n');
  if (isArtSpecialSheetText(titleText)) return true;

  const bodyText = [
    task.desc,
    task.requirement,
    task.type,
    task.taskType,
    existing?.requirement,
    existing?.zentao?.type,
    existing?.zentao?.taskType
  ].map(value => String(value || '')).join('\n');
  return /(?:任务类型|单据类型|流程类型|工单类型|类型)[：:\s]*(?:美术)?(?:验收|验收单|走查|走查单|设计同步|设计同步单)/.test(bodyText);
}

function isArtDepartmentTask(task = {}, existing = null) {
  const ownText = [
    task.name,
    task.title,
    existing?.title
  ].map(value => String(value || '')).join('\n');
  if (isNonArtWorkText(ownText) && !isArtSpecialSheetText(ownText)) return false;
  const text = [
    task.name,
    task.title,
    task.desc,
    task.requirement,
    task.storyTitle,
    task.story?.title,
    task.executionName,
    task.execution?.name,
    task.parentName,
    existing?.title,
    existing?.summary,
    existing?.requirement,
    existing?.zentao?.storyTitle,
    existing?.zentao?.parentName,
    existing?.zentao?.executionName
  ].map(value => String(value || '')).join('\n');
  if (isNonArtWorkText(text) && !isArtSpecialSheetText(text)) return false;
  const artPattern = /美术|制作单|验收单|设计|视觉|UI|UE|交互|图标|入口图|素材|皮肤|弹窗|界面|页面|布局|排版|颜色|字号|间距|圆角|组件|规范|Figma|figma|切图|贴图|资源图|效果图|官网素材|平台入口图|活动入口|导航栏|侧边栏|头像|背景|banner/i;
  if (artPattern.test(text)) return true;
  const assignedTo = accountOf(task.assignedTo || existing?.assignedTo || existing?.zentao?.assignedTo);
  return Boolean(assignedTo && artAccounts.has(assignedTo));
}

function isArtSpecialSheetText(text = '') {
  return /(?:美术)?验收单|美术验收|验收走查|走查单|设计同步单|设计同步/.test(String(text || ''));
}

function isNonArtWorkText(text = '') {
  return /【开发单】|前端|后端|客户端开发|服务端|接口|API|代码|自动化测试|技术代码评审/i.test(String(text || ''));
}

function isUnfinishedTask(task) {
  const status = String(task.status || '').toLowerCase();
  if (['done', 'closed', 'cancel', 'cancelled'].includes(status)) return false;
  if (task.deleted === true || task.deleted === '1') return false;
  return true;
}

function isBugLikeTask(task = {}) {
  const text = [
    task.name,
    task.title,
    task.storyTitle,
    task.desc,
    task.sourceType
  ].filter(Boolean).join('\n');
  return /【\s*(?:内部|线上)?\s*bug\s*】|内部\s*bug|线上\s*bug|sourceType\s*[:：]?\s*bug/i.test(text);
}

async function listArtSeenCandidateTaskNos(options = {}) {
  const names = [
    'zentao_owner_seen_items_zhangqw.json',
    'zentao_seen_items.json',
    'zentao_seen_items_zhangqw.json'
  ];
  const taskNos = new Set();
  const maxAgeMs = Number(options.maxAgeMs || 0);
  const now = Date.now();
  for (const name of names) {
    try {
      const file = path.join(artDashboardDataDir, name);
      if (maxAgeMs > 0) {
        const stat = await fs.stat(file);
        if (now - stat.mtimeMs > maxAgeMs) continue;
      }
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      const seen = data?.seen && typeof data.seen === 'object' ? data.seen : {};
      for (const item of Object.values(seen)) {
        const taskNo = artSeenCandidateTaskNo(item);
        if (taskNo) taskNos.add(taskNo);
      }
    } catch {
      // 旧看板记录只作为禅道详情补刷候选，缺失时忽略。
    }
  }
  return [...taskNos];
}

function artSeenCandidateTaskNo(item = {}) {
  if (!item || String(item.type || '') !== '任务') return '';
  const taskNo = String(item.id || item.taskID || '').trim();
  if (!taskNo) return '';
  const title = item.title || titleFromSeenLabel(item.label) || '';
  const text = [
    title,
    item.label,
    item.executionName,
    item.storyTitle,
    item.parentName
  ].map(value => String(value || '')).join('\n');
  if (!isArtSpecialSheetText(text)) return '';
  if (hasFinishedOrClosedSeenItem(item)) return '';
  return taskNo;
}

function hasFinishedOrClosedSeenItem(item = {}) {
  const finished = String(item.finishedDate || '').trim();
  const closed = String(item.closedDate || '').trim();
  return Boolean(finished && !/^0{4}-0{2}-0{2}/.test(finished))
    || Boolean(closed && !/^0{4}-0{2}-0{2}/.test(closed));
}

function titleFromSeenLabel(label = '') {
  const parts = String(label || '').split('｜');
  return parts.length ? String(parts.at(-1) || '').trim() : '';
}

function expandZentaoDetailTasks(task = {}) {
  const children = Array.isArray(task.children) ? task.children : [];
  if (!children.length) return [task];
  const parentName = task.name || task.title || task.parentName || '';
  const parentExecutionName = task.executionName || task.execution?.name || '';
  const parentStoryTitle = task.storyTitle || task.story?.title || '';
  return [
    task,
    ...children.map(child => ({
      ...child,
      parentName: child.parentName || parentName,
      executionName: child.executionName || parentExecutionName,
      storyTitle: child.storyTitle || parentStoryTitle,
      story: child.story || task.story || task.storyID || '',
      storyID: child.storyID || task.storyID || task.story || ''
    }))
  ];
}

function normalizeZentaoTask(task, execution) {
  const taskNo = String(task.id);
  const title = cleanTitle(task.name || task.storyTitle || `ZenTao task ${taskNo}`);
  const assignee = accountOf(task.assignedTo);
  const finisher = accountOf(task.finishedBy);
  const developer = userNames.get(assignee) || userNames.get(finisher) || task.assignedToRealName || assignee || finisher || '';
  const status = statusFromZentao(task.status, task);
  const completion = status === 'passed'
    ? 100
    : task.progress !== undefined && task.progress !== null
      ? clampPercent(task.progress)
      : status === 'in_progress'
        ? 50
        : 0;
  const description = stripHtml(task.desc || '');
  const executionName = execution?.name || '';
  return {
    id: `zentao_${taskNo}`,
    projectId,
    taskNo,
    title,
    developer,
    source: 'zentao',
    status,
    zentaoStatus: task.status || '',
    isCurrent: true,
    syncStatus: 'current',
    lastSyncedAt: new Date().toISOString(),
    archivedAt: '',
    deadline: normalizeDeadline(task.deadline),
    zentaoCreatedAt: normalizeDate(task.openedDate) || '',
    zentaoProgress: completion,
    completion,
    agentModel: '',
    summary: [
      executionName ? `ZenTao执行：${executionName}` : '',
      task.storyTitle ? `关联需求：${task.storyTitle}` : '',
      task.deadline && task.deadline !== '0000-00-00' ? `截止：${task.deadline}` : ''
    ].filter(Boolean).join('；'),
    issues: task.left && Number(task.left) > 0 ? `剩余工时：${task.left}` : '',
    requirement: description,
    stageChecks: [],
    zentao: {
      id: Number(task.id),
      project: Number(task.project || 0),
      execution: Number(task.execution || 0),
      executionName,
      story: Number(task.story || task.storyID || 0),
      storyTitle: task.storyTitle || '',
      type: task.type || '',
      pri: task.pri || '',
      estimate: Number(task.estimate || 0),
      consumed: Number(task.consumed || 0),
      left: Number(task.left || 0),
      deadline: task.deadline || '',
      originalStatus: task.status || '',
      assignedTo: assignee,
      finishedBy: finisher,
      openedDate: task.openedDate || '',
      assignedDate: task.assignedDate || '',
      finishedDate: task.finishedDate || '',
      realStarted: task.realStarted || ''
    },
    createdAt: normalizeDate(task.openedDate) || new Date().toISOString(),
    updatedAt: normalizeDate(task.lastEditedDate || task.assignedDate || task.finishedDate || task.openedDate) || new Date().toISOString()
  };
}

function accountOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.account || '';
  return String(value);
}

function zentaoUserAccount(user = {}) {
  return accountOf(user.account || user.user || user.username || user.id);
}

function zentaoUserDeptId(user = {}) {
  const raw = user.dept ?? user.deptID ?? user.deptId ?? user.departmentID ?? user.departmentId ?? user.department?.id ?? user.dept?.id ?? '';
  if (raw && typeof raw === 'object') return zentaoUserDeptId(raw);
  if (typeof raw === 'number') return raw;
  const match = String(raw || '').match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

async function fallbackArtDepartmentUsers() {
  const snapshot = await latestArtSnapshot();
  const report = snapshot?.report || {};
  const owner = {
    account: report.owner_account || 'zhangqw',
    realname: report.owner_summary?.name || '张倩文',
    role: 'owner'
  };
  const defaults = [
    owner,
    { account: 'fengshuqi', realname: '冯淑琪' },
    { account: 'yushengwei', realname: '余盛威' },
    { account: 'yejunbo', realname: '叶君博' },
    { account: 'huangjianrong', realname: '黄剑荣' },
    { account: 'lilh', realname: '李华玲' },
    { account: 'zhangzb', realname: '张宗斌' },
    { account: 'lanhj', realname: '兰韩界' }
  ];
  const members = (report.managed_members || report.art_members || defaults)
    .filter(user => user?.account && user.account !== owner.account)
    .map(user => ({
      account: user.account,
      realname: user.realname || user.name || user.account,
      role: 'member'
    }));
  const byAccount = new Map(defaults.map(user => [user.account, user]));
  byAccount.set(owner.account, owner);
  for (const member of members) byAccount.set(member.account, member);
  return [...byAccount.values()];
}

async function latestArtSnapshot() {
  try {
    const files = await fs.readdir(artDashboardDataDir);
    const snapshots = files.filter(name => /^art_tasks_\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
    if (!snapshots.length) return null;
    const snapshotPath = path.join(artDashboardDataDir, snapshots.at(-1));
    const report = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
    return { report, snapshotPath };
  } catch {
    return null;
  }
}

async function listZentaoUsers() {
  const users = [];
  const limit = 1000;
  let page = 1;
  let total = 0;
  while (page <= 20) {
    const payload = await zentao.listUsers(api, { page, limit });
    const result = payload?.result || payload?.data || payload;
    const pageUsers = Array.isArray(result?.users) ? result.users : Array.isArray(result) ? result : [];
    total = Number(result?.total || pageUsers.length || total);
    users.push(...pageUsers);
    if (!pageUsers.length || users.length >= total) break;
    page += 1;
  }
  return users;
}

function mailtoAccounts(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(accountOf).filter(Boolean);
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function statusFromZentao(status = '', task = {}) {
  const value = String(status || '').toLowerCase();
  if (/done|closed|finished|completed|已完成|已关闭|完成/i.test(value)) return 'passed';
  if (Number(task.progress || 0) >= 100 || normalizeDate(task.finishedDate)) return 'passed';
  if (/doing|进行/i.test(value)) return 'in_progress';
  if (/pause|wait|暂停|未开始/i.test(value)) return 'pending';
  if (/cancel|取消/i.test(value)) return 'blocked';
  return 'pending';
}

function cleanTitle(value) {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('0000-00-00')) return '';
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function normalizeDeadline(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('0000-00-00')) return '';
  return raw.slice(0, 10);
}

function clampPercent(value) {
  const number = Number(value || 0);
  if (Number.isNaN(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}
