import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTasks as listStoredTasks, upsertTasks } from '../server/store.mjs';
import { closeMysqlStore } from '../server/mysql-store.mjs';
import { getZentaoApi, getZentaoModules } from '../server/zentao-adapter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectId = process.env.AWP_PROJECT_ID || 'qp_lobby_5_2';
const artDeptId = Number(process.env.ZENTAO_ART_DEPT_ID || 27);
const artDeptIds = normalizeArtDeptIds(process.env.ZENTAO_ART_DEPT_IDS || process.env.ZENTAO_ART_DEPT_ID || '27');
const limitExecutions = Number(process.env.ZENTAO_EXECUTION_LIMIT || 1000);
const taskPageLimit = Number(process.env.ZENTAO_TASK_LIMIT || 1000);
const taskScope = process.env.ZENTAO_TASK_SCOPE || 'all';
const artDashboardDataDir = process.env.ART_DASHBOARD_DATA_DIR || path.join(root, 'data', 'art-dashboard');

const api = await getZentaoApi();
const zentao = await getZentaoModules();
const usersResult = await zentao.listUsers(api, { page: 1, limit: 1000 });
const users = usersResult?.result?.users || [];
const artUsers = users.filter(user => artDeptIds.has(Number(user.dept)));
const artAccounts = new Set([
  'zhangqw',
  'fengshuqi',
  'yushengwei',
  'yejunbo',
  'huangjianrong',
  'lilh',
  'lihl',
  'zhangzb',
  'lanhj',
  ...artUsers.map(user => user.account).filter(Boolean)
]);
const userNames = new Map(users.map(user => [user.account, user.realname || user.account]));

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
const artSeenCandidateTaskNos = await listArtSeenCandidateTaskNos();
for (const taskNo of artSeenCandidateTaskNos) existingZentaoTaskNos.add(String(taskNo));
const existingCurrentZentaoKeys = new Set([...taskMap.entries()]
  .filter(([, task]) => task.projectId === projectId && task.source === 'zentao' && task.taskNo && task.isCurrent !== false)
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
    const currentArtTask = isCurrentArtTask(zentaoTask, existingTask);
    if (!currentArtTask && !(existingZentaoTaskNos.has(taskNo) && (isArtTask(zentaoTask) || isArtDepartmentTask(zentaoTask, existingTask)))) continue;
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
    const zentaoTask = result?.result?.task || result?.result || result?.data?.task || result?.data || result;
    if (!zentaoTask || !(zentaoTask.id || zentaoTask.taskID)) throw new Error('ZenTao 未返回任务详情');
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
      const currentArtTask = isCurrentArtTask(detailTask, existed);
      if (!currentArtTask && !isArtDepartmentTask(detailTask, existed)) continue;
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
const preserveExistingCurrentTasks = existingCurrentZentaoKeys.size >= 10
  && currentTaskIds.size > 0
  && currentTaskIds.size < Math.ceil(existingCurrentZentaoKeys.size * 0.5);
if (preserveExistingCurrentTasks) {
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
  artSeenCandidateTasks: artSeenCandidateTaskNos.length,
  executionCount: executions.length,
  scope: taskScope,
  scannedTaskCount: scanned,
  matchedTaskCount: matched,
  executionErrors,
  detailRefreshed,
  detailRefreshFailures,
  preservedExistingCurrentTasks: preserveExistingCurrentTasks,
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
  return {
    ...previous,
    ...next,
    id: previous.id || next.id,
    isCurrent: previous.isCurrent !== false || next.isCurrent !== false,
    syncStatus: previous.isCurrent !== false || next.isCurrent !== false ? 'current' : next.syncStatus || previous.syncStatus,
    createdAt: previous.createdAt || next.createdAt,
    updatedAt: latestDate(previous.updatedAt, next.updatedAt),
    lastSyncedAt: latestDate(previous.lastSyncedAt, next.lastSyncedAt),
    archivedAt: previous.isCurrent !== false || next.isCurrent !== false ? '' : previous.archivedAt || next.archivedAt || ''
  };
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
  const assignedTo = accountOf(task.assignedTo);
  return Boolean(assignedTo && artAccounts.has(assignedTo));
}

function isCurrentArtTask(task = {}, existing = null) {
  return isUnfinishedTask(task)
    && (
      isArtTask(task)
      || (isArtAcceptanceOrDesignSyncTask(task, existing) && isArtDepartmentTask(task, existing))
    );
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

function normalizeArtDeptIds(value = '') {
  const ids = String(value || '')
    .split(',')
    .map(item => Number(String(item || '').trim()))
    .filter(Number.isFinite);
  if (!ids.length) ids.push(artDeptId || 27);
  return new Set(ids);
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

async function listArtSeenCandidateTaskNos() {
  const names = [
    'zentao_owner_seen_items_zhangqw.json',
    'zentao_seen_items.json',
    'zentao_seen_items_zhangqw.json'
  ];
  const taskNos = new Set();
  for (const name of names) {
    try {
      const file = path.join(artDashboardDataDir, name);
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
