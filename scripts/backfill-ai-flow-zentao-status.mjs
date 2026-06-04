import { listAiFlowRecords, listTasks, upsertAiFlowRecord, upsertTasks } from '../server/store.mjs';
import { closeMysqlStore } from '../server/mysql-store.mjs';
import { getZentaoApi, getZentaoModules } from '../server/zentao-adapter.mjs';

const projectId = process.env.AWP_PROJECT_ID || '';
const records = await listAiFlowRecords({ projectId });
const tasks = await listTasks({ projectId });
const api = await getZentaoApi();
const zentao = await getZentaoModules();
const usersResult = await zentao.listUsers(api, { page: 1, limit: 1000 });
const users = usersResult?.result?.users || [];
const userNames = new Map(users.map(user => [user.account, user.realname || user.account]));
const taskByIdentity = new Map(tasks
  .filter(task => task.projectId && task.taskNo)
  .map(task => [`${task.projectId}:${task.taskNo}`, task]));

let recordsUpdated = 0;
let tasksCreated = 0;
let tasksUpdated = 0;
const missing = [];

for (const record of records) {
  if (!record.projectId || !record.taskNo) continue;
  const identity = `${record.projectId}:${record.taskNo}`;
  const task = taskByIdentity.get(identity);
  let zentaoStatus = task?.zentaoStatus || task?.zentao?.originalStatus || '';
  let zentaoDetail = task?.zentao || {};
  let taskId = task?.id || record.taskId || '';
  let normalizedTask = null;
  try {
    const result = await zentao.getTask(api, { id: record.taskNo });
    const zentaoTask = result?.result?.task || result?.result || result?.data?.task || result?.data || result;
    if (!zentaoTask || !(zentaoTask.id || zentaoTask.taskID || record.taskNo)) throw new Error('ZenTao 未返回任务详情');
    normalizedTask = normalizeZentaoTask(record.projectId, zentaoTask, task, record);
    const saved = await upsertTasks([normalizedTask]);
    const savedTask = saved.tasks?.[0] || normalizedTask;
    if (saved.created) tasksCreated += saved.created;
    if (saved.updated) tasksUpdated += saved.updated;
    taskByIdentity.set(identity, savedTask);
    taskId = savedTask.id || normalizedTask.id || taskId;
    zentaoStatus = savedTask.zentaoStatus || savedTask.zentao?.originalStatus || zentaoTask.status || zentaoStatus;
    zentaoDetail = savedTask.zentao || normalizedTask.zentao || zentaoDetail;
  } catch (error) {
    missing.push({ taskNo: record.taskNo, error: error.message || String(error) });
    if (!zentaoStatus) continue;
  }
  if (!zentaoStatus) continue;
  await upsertAiFlowRecord({
    ...record,
    taskId,
    zentaoStatus,
    zentao: {
      ...(record.zentao || {}),
      ...zentaoDetail,
      originalStatus: zentaoStatus
    },
    updatedAt: new Date().toISOString()
  });
  recordsUpdated += 1;
}

console.log(JSON.stringify({
  ok: true,
  projectId: projectId || 'all',
  checked: records.length,
  recordsUpdated,
  tasksCreated,
  tasksUpdated,
  missing: dedupeMissing(missing)
}, null, 2));
await closeMysqlStore();

function accountOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.account || value.realname || value.name || '';
  return String(value);
}

function normalizeZentaoTask(recordProjectId, task = {}, existingTask = {}, record = {}) {
  const now = new Date().toISOString();
  const taskNo = String(task.id || task.taskID || record.taskNo || '').trim();
  const assignee = accountOf(task.assignedTo);
  const finisher = accountOf(task.finishedBy);
  const developer = userNames.get(assignee) || userName(task.assignedTo) || task.assignedToRealName || userNames.get(finisher) || assignee || finisher || existingTask.developer || '';
  const estimate = Number(task.estimate || 0);
  const consumed = Number(task.consumed || 0);
  const left = Number(task.left || 0);
  const zentaoStatus = task.status || existingTask.zentaoStatus || '';
  const status = platformTaskStatus(zentaoStatus, task);
  const progress = status === 'passed'
    ? 100
    : Number(task.progress ?? (estimate ? Math.round((consumed / Math.max(estimate, consumed + left)) * 100) : existingTask.completion || 0));
  const executionName = task.executionName || task.execution?.name || existingTask.zentao?.executionName || '';
  const storyTitle = task.storyTitle || task.story?.title || existingTask.zentao?.storyTitle || '';
  return {
    ...existingTask,
    id: existingTask.id || `${recordProjectId}_${taskNo}`,
    projectId: recordProjectId,
    taskNo,
    title: task.name || task.title || record.taskTitle || record.taskNameAndNo || existingTask.title || `ZenTao task ${taskNo}`,
    developer,
    source: 'zentao',
    status,
    zentaoStatus,
    isCurrent: existingTask.isCurrent !== false,
    syncStatus: existingTask.syncStatus || (existingTask.isCurrent === false ? 'non_current' : 'current'),
    lastSyncedAt: now,
    archivedAt: existingTask.archivedAt || '',
    deadline: validDate(task.deadline) || existingTask.deadline || '',
    zentaoCreatedAt: toIsoDate(task.openedDate) || existingTask.zentaoCreatedAt || '',
    zentaoProgress: progress,
    completion: progress,
    summary: [
      executionName ? `ZenTao执行：${executionName}` : task.execution ? `ZenTao执行ID：${task.execution}` : '',
      storyTitle ? `关联需求：${storyTitle}` : '',
      task.deadline && !/^0{4}-0{2}-0{2}/.test(String(task.deadline)) ? `截止：${task.deadline}` : ''
    ].filter(Boolean).join('；') || existingTask.summary || '',
    issues: left ? `剩余工时：${left}` : existingTask.issues || '',
    requirement: stripHtml(task.desc || existingTask.requirement || ''),
    stageChecks: existingTask.stageChecks || [],
    zentao: {
      ...(existingTask.zentao || {}),
      id: Number(taskNo),
      project: task.project || existingTask.zentao?.project || '',
      execution: task.execution || existingTask.zentao?.execution || '',
      executionName,
      story: task.story || task.storyID || existingTask.zentao?.story || '',
      storyTitle,
      type: task.type || existingTask.zentao?.type || '',
      pri: task.pri || existingTask.zentao?.pri || '',
      estimate,
      consumed,
      left,
      deadline: validDate(task.deadline),
      originalStatus: zentaoStatus,
      assignedTo: assignee,
      assignedToName: developer,
      finishedBy: finisher,
      openedDate: task.openedDate || existingTask.zentao?.openedDate || '',
      assignedDate: task.assignedDate || existingTask.zentao?.assignedDate || '',
      finishedDate: task.finishedDate || existingTask.zentao?.finishedDate || '',
      realStarted: task.realStarted || existingTask.zentao?.realStarted || ''
    },
    createdAt: existingTask.createdAt || toIsoDate(task.openedDate) || now,
    updatedAt: now
  };
}

function userName(value) {
  if (!value) return '';
  if (typeof value === 'string') return '';
  return value.realname || value.name || value.account || '';
}

function platformTaskStatus(status = '', task = {}) {
  const value = String(status || '').toLowerCase();
  if (/done|closed|finished|completed|已完成|已关闭|完成/.test(value)) return 'passed';
  if (Number(task.progress || 0) >= 100 || validDate(task.finishedDate)) return 'passed';
  if (/doing|进行/.test(value)) return 'in_progress';
  if (/pause|cancel|暂停|取消/.test(value)) return 'blocked';
  return 'pending';
}

function validDate(value) {
  const text = String(value || '');
  if (!text || /^0{4}-0{2}-0{2}/.test(text)) return '';
  return text.slice(0, 10);
}

function toIsoDate(value) {
  const text = String(value || '');
  if (!text || /^0{4}-0{2}-0{2}/.test(text)) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeMissing(items = []) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.taskNo}:${item.error}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
