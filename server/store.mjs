import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeCustomStages, normalizeLevel, normalizeWorkflowId, stagesForWorkflow, workflowForLevel } from './workflow.mjs';
import { normalizeGitConfig } from './repository-config.mjs';
import { isRoutineAccessOperationLog, shouldKeepOperationLog, splitProjectDeletionSnapshot, splitRunsByArchiveDeleteFilters } from './business-regression-rules.mjs';
import {
  ensureMysqlStore,
  readMysqlCollection,
  readMysqlConfig,
  writeMysqlCollection,
  writeMysqlConfig
} from './mysql-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const workspaceDir = path.join(root, 'workspace');
const artifactDir = path.join(workspaceDir, 'artifacts');

export const paths = {
  root,
  dataDir,
  workspaceDir,
  artifactDir,
  projects: path.join(dataDir, 'projects.json'),
  tasks: path.join(dataDir, 'tasks.json'),
  bugs: path.join(dataDir, 'bugs.json'),
  aiFlowRecords: path.join(dataDir, 'ai-flow-records.json'),
  taskReviews: path.join(dataDir, 'task-reviews.json'),
  taskProcessingNotes: path.join(dataDir, 'task-processing-notes.json'),
  artBriefs: path.join(dataDir, 'art-briefs.json'),
  runs: path.join(dataDir, 'runs.json'),
  customWorkflows: path.join(dataDir, 'custom-workflows.json'),
  roles: path.join(dataDir, 'roles.json'),
  users: path.join(dataDir, 'users.json'),
  sessions: path.join(dataDir, 'sessions.json'),
  operationLogs: path.join(dataDir, 'operation-logs.json'),
  codexConfig: path.join(dataDir, 'codex-config.json'),
  taskCenterConfig: path.join(dataDir, 'task-center-config.json'),
  artProgressEvents: path.join(dataDir, 'art-progress-events.json'),
  skillValidations: path.join(dataDir, 'skill-validations.json'),
  usageCounters: path.join(dataDir, 'usage-counters.json'),
  projectScanCache: path.join(dataDir, 'project-scan-cache.json'),
  skillVersionOverrides: path.join(dataDir, 'skill-version-overrides.json'),
  aiMemberScoreSnapshot: path.join(dataDir, 'ai-member-score-snapshot.json'),
  agentWorkers: path.join(dataDir, 'agent-workers.json')
};

const mysqlCollections = new Map([
  [paths.projects, 'projects'],
  [paths.tasks, 'tasks'],
  [paths.bugs, 'bugs'],
  [paths.aiFlowRecords, 'ai_flow_records'],
  [paths.taskReviews, 'task_reviews'],
  [paths.taskProcessingNotes, 'task_processing_notes'],
  [paths.artBriefs, 'art_briefs'],
  [paths.runs, 'runs'],
  [paths.customWorkflows, 'custom_workflows'],
  [paths.roles, 'roles'],
  [paths.users, 'users'],
  [paths.sessions, 'sessions'],
  [paths.operationLogs, 'operation_logs']
]);

const mysqlConfigs = new Map([
  [paths.codexConfig, 'codex-config'],
  [paths.taskCenterConfig, 'task-center-config']
]);

const useMysqlStore = process.env.AWP_USE_MYSQL === '1';
const retentionDays = Math.max(1, Number(process.env.AWP_DATA_RETENTION_DAYS || 2) || 2);
const usageCounterLogicVersion = 'usage-only-v8-reporter-self-usage';
const taskArtBriefUsageCounterKey = 'zentaoartbriefproduct';
const artProgressReporterUsageCounterKey = 'artprogressreporter';
const artProgressReporterUsageTarget = 'art-progress-reporter';
const unknownUsagePersonName = '未识别使用人';
const artDeptAccountNameMap = new Map([
  ['zhangqw', '张倩文'],
  ['fengshuqi', '冯淑琪'],
  ['yushengwei', '余盛威'],
  ['yejunbo', '叶君博'],
  ['huangjianrong', '黄剑荣'],
  ['lilh', '李华玲'],
  ['zhangzb', '张宗斌'],
  ['lanhj', '兰韩界']
]);
const retentionEnabled = process.env.AWP_DATA_RETENTION_ENABLED !== '0';
const runFigmaLogEvidenceCache = new Map();
const staleLocalWorkerRunMs = Math.max(10 * 60 * 1000, Number(process.env.AWP_STALE_LOCAL_WORKER_RUN_MS || 20 * 60 * 1000));
const retentionPaths = new Set([
  paths.aiFlowRecords,
  paths.operationLogs,
  paths.artProgressEvents
]);

export async function ensurePlatformDirs() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });
  if (useMysqlStore) await ensureMysqlStore();
  await enforceRetentionNow();
}

export async function listProjects() {
  return readJson(paths.projects, []);
}

export async function upsertProject(input) {
  const projects = await listProjects();
  const project = normalizeProject(input);
  const index = projects.findIndex(item => item.id === project.id);
  if (index >= 0) {
    const existing = projects[index];
    projects[index] = { ...existing, ...project };
  }
  else projects.push(project);
  await writeJson(paths.projects, projects);
  return index >= 0 ? projects[index] : project;
}

export async function getProject(id) {
  const projects = await listProjects();
  return projects.find(item => item.id === id) || null;
}

export async function deleteProject(id) {
  const projectId = String(id || '').trim();
  if (!projectId) return null;
  const projects = await listProjects();
  const index = projects.findIndex(item => item.id === projectId);
  if (index === -1) return null;
  const [project] = projects.splice(index, 1);

  const [tasks, bugs, reviews, notes, artBriefs, runs, workflows] = await Promise.all([
    readJson(paths.tasks, []),
    readJson(paths.bugs, []),
    readJson(paths.taskReviews, []),
    readJson(paths.taskProcessingNotes, []),
    readJson(paths.artBriefs, []),
    readJson(paths.runs, []),
    readJson(paths.customWorkflows, [])
  ]);
  const deletion = splitProjectDeletionSnapshot({
    projects,
    tasks,
    bugs,
    taskReviews: reviews,
    taskProcessingNotes: notes,
    artBriefs,
    runs,
    customWorkflows: workflows
  }, projectId);

  await Promise.all([
    writeJson(paths.projects, deletion.projects),
    writeJson(paths.tasks, deletion.tasks),
    writeJson(paths.bugs, deletion.bugs),
    writeJson(paths.taskReviews, deletion.taskReviews),
    writeJson(paths.taskProcessingNotes, deletion.taskProcessingNotes),
    writeJson(paths.artBriefs, deletion.artBriefs)
  ]);

  return {
    project,
    removed: {
      tasks: tasks.length - deletion.tasks.length,
      bugs: bugs.length - deletion.bugs.length,
      taskReviews: reviews.length - deletion.taskReviews.length,
      taskProcessingNotes: notes.length - deletion.taskProcessingNotes.length,
      artBriefs: artBriefs.length - deletion.artBriefs.length,
      runs: 0,
      customWorkflows: 0
    },
    retained: {
      runs: deletion.retained.runs,
      customWorkflows: deletion.retained.customWorkflows,
      artifactRoot: path.join(paths.artifactDir, projectId)
    }
  };
}

export async function listCustomWorkflows(filters = {}) {
  const workflows = await readJson(paths.customWorkflows, []);
  return workflows
    .filter(workflow => !filters.projectId || !workflow.projectId || workflow.projectId === filters.projectId)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export async function getCustomWorkflow(id) {
  const workflows = await readJson(paths.customWorkflows, []);
  return workflows.find(item => item.id === id) || null;
}

export async function upsertCustomWorkflow(input = {}) {
  const workflows = await readJson(paths.customWorkflows, []);
  const workflow = normalizeCustomWorkflow(input);
  const index = workflows.findIndex(item => item.id === workflow.id);
  if (index >= 0) workflows[index] = { ...workflows[index], ...workflow, createdAt: workflows[index].createdAt || workflow.createdAt };
  else workflows.push(workflow);
  await writeJson(paths.customWorkflows, workflows);
  return index >= 0 ? workflows[index] : workflow;
}

export async function deleteCustomWorkflow(id) {
  const workflows = await readJson(paths.customWorkflows, []);
  const index = workflows.findIndex(item => item.id === id);
  if (index === -1) return null;
  const [workflow] = workflows.splice(index, 1);
  await writeJson(paths.customWorkflows, workflows);
  return workflow;
}

export async function listTasks(filters = {}) {
  const tasks = await readJson(paths.tasks, []);
  return tasks
    .filter(task => !isBugLikeTaskRecord(task))
    .filter(task => !filters.projectId || task.projectId === filters.projectId)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export async function getTask(id) {
  const tasks = await readJson(paths.tasks, []);
  return tasks.find(item => item.id === id && !isBugLikeTaskRecord(item)) || null;
}

export async function listBugs(filters = {}) {
  const bugs = await readJson(paths.bugs, []);
  return bugs
    .filter(bug => !filters.projectId || bug.projectId === filters.projectId)
    .sort((a, b) => String(bugSortDate(b)).localeCompare(String(bugSortDate(a))));
}

export async function getTaskCenterConfig() {
  return normalizeTaskCenterConfig(await readJson(paths.taskCenterConfig, {}));
}

export async function listTaskProcessingNotes(filters = {}) {
  const notes = await readJson(paths.taskProcessingNotes, []);
  return notes
    .filter(note => !filters.projectId || note.projectId === filters.projectId)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export async function upsertTaskProcessingNote(input = {}) {
  const notes = await readJson(paths.taskProcessingNotes, []);
  const note = normalizeTaskProcessingNote(input);
  const index = notes.findIndex(item => item.id === note.id);
  if (index >= 0) {
    notes[index] = {
      ...notes[index],
      ...note,
      createdAt: notes[index].createdAt || note.createdAt
    };
  } else {
    notes.push(note);
  }
  await writeJson(paths.taskProcessingNotes, notes);
  return index >= 0 ? notes[index] : note;
}

export async function upsertTaskCenterConfig(input = {}) {
  const previous = await getTaskCenterConfig();
  const next = normalizeTaskCenterConfig({
    ...previous,
    ...input,
    memberVisibleColumns: {
      ...(previous.memberVisibleColumns || {}),
      ...(input.memberVisibleColumns || {})
    },
    skillValidationVisibleColumns: input.skillValidationVisibleColumns || previous.skillValidationVisibleColumns || [],
    aiAssetVisibleColumns: input.aiAssetVisibleColumns || previous.aiAssetVisibleColumns || [],
    updatedAt: new Date().toISOString()
  });
  await writeJson(paths.taskCenterConfig, next);
  return next;
}

export async function getAiMemberScoreSnapshot() {
  return normalizeAiMemberScoreSnapshot(await readJson(paths.aiMemberScoreSnapshot, {}));
}

export async function upsertAiMemberScoreSnapshot(input = {}) {
  const previous = await getAiMemberScoreSnapshot();
  const next = normalizeAiMemberScoreSnapshot({
    ...previous,
    ...input,
    monthlyRunScoreBuckets: input.monthlyRunScoreBuckets === undefined
      ? previous.monthlyRunScoreBuckets
      : input.monthlyRunScoreBuckets,
    savedAt: input.savedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  if (!next.rows.length) throw new Error('AI 评分快照不能为空。');
  await writeJson(paths.aiMemberScoreSnapshot, next);
  return next;
}

export async function listAiFlowRecords(filters = {}) {
  const records = await readJson(paths.aiFlowRecords, []);
  const tasks = await readJson(paths.tasks, []);
  const taskByIdentity = new Map(tasks
    .filter(task => task.projectId && task.taskNo)
    .map(task => [`${task.projectId}:${task.taskNo}`, task]));
  return records
    .map(normalizeAiFlowRecord)
    .map(record => hydrateAiFlowRecordZentao(record, taskByIdentity))
    .filter(record => record.status !== 'deleted' || filters.includeDeleted)
    .filter(record => !filters.projectId || record.projectId === filters.projectId)
    .filter(record => !filters.taskId || record.taskId === filters.taskId)
    .filter(record => !filters.taskNo || record.taskNo === String(filters.taskNo))
    .sort((a, b) => String(b.updatedAt || b.importedAt || b.createdAt).localeCompare(String(a.updatedAt || a.importedAt || a.createdAt)));
}

export async function getAiFlowRecord(id = '') {
  const records = await readJson(paths.aiFlowRecords, []);
  const record = records.find(item => item.id === id) || null;
  if (!record) return null;
  const tasks = await readJson(paths.tasks, []);
  const taskByIdentity = new Map(tasks
    .filter(task => task.projectId && task.taskNo)
    .map(task => [`${task.projectId}:${task.taskNo}`, task]));
  return hydrateAiFlowRecordZentao(normalizeAiFlowRecord(record), taskByIdentity);
}

export async function upsertAiFlowRecord(input = {}) {
  const records = await readJson(paths.aiFlowRecords, []);
  const record = normalizeAiFlowRecord(input);
  const index = findAiFlowRecordIndex(records, record);
  if (index >= 0) {
    const previous = normalizeAiFlowRecord(records[index]);
    records[index] = normalizeAiFlowRecord({
      ...previous,
      ...record,
      id: previous.id || record.id,
      source: previous.source === 'sheet-import' && record.source === 'manual' ? 'sheet-import' : record.source || previous.source,
      createdAt: previous.createdAt || record.createdAt,
      importedAt: previous.importedAt || record.importedAt,
      updatedAt: new Date().toISOString()
    });
  } else {
    records.push(record);
  }
  await writeJson(paths.aiFlowRecords, records);
  return index >= 0 ? records[index] : record;
}

export async function upsertAiFlowRecords(inputs = []) {
  let created = 0;
  let updated = 0;
  const saved = [];
  for (const input of inputs) {
    const records = await readJson(paths.aiFlowRecords, []);
    const record = normalizeAiFlowRecord(input);
    const index = findAiFlowRecordIndex(records, record);
    const savedRecord = await upsertAiFlowRecord(record);
    if (index >= 0) updated += 1;
    else created += 1;
    saved.push(savedRecord);
  }
  return { created, updated, total: saved.length, records: saved };
}

export async function deleteAiFlowRecord(id = '', patch = {}) {
  const records = await readJson(paths.aiFlowRecords, []);
  const index = records.findIndex(item => item.id === id);
  if (index === -1) return null;
  records[index] = normalizeAiFlowRecord({
    ...records[index],
    ...patch,
    status: 'deleted',
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await writeJson(paths.aiFlowRecords, records);
  return records[index];
}

export async function listTaskReviews(filters = {}) {
  const reviews = await readJson(paths.taskReviews, []);
  return reviews
    .filter(review => !filters.projectId || review.projectId === filters.projectId)
    .filter(review => !filters.taskId || review.taskId === filters.taskId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function listArtBriefs(filters = {}) {
  const records = await readJson(paths.artBriefs, []);
  return records
    .map(normalizeArtBriefRecord)
    .filter(record => !filters.projectId || record.projectId === filters.projectId)
    .filter(record => !filters.groupKey || record.groupKey === filters.groupKey)
    .sort((a, b) => String(b.generatedAt || b.updatedAt || '').localeCompare(String(a.generatedAt || a.updatedAt || '')));
}

export async function getArtBriefByGroupKey(projectId = '', groupKey = '') {
  const records = await listArtBriefs({ projectId, groupKey });
  return records[0] || null;
}

export async function upsertArtBrief(input = {}) {
  const records = await readJson(paths.artBriefs, []);
  const record = normalizeArtBriefRecord(input);
  const index = records.findIndex(item => item.projectId === record.projectId && item.groupKey === record.groupKey);
  if (index >= 0) records[index] = { ...records[index], ...record, updatedAt: new Date().toISOString() };
  else records.push(record);
  await writeJson(paths.artBriefs, records.map(normalizeArtBriefRecord));
  return index >= 0 ? normalizeArtBriefRecord(records[index]) : record;
}

export async function upsertTask(input) {
  if (isBugLikeTaskRecord(input)) throw new Error('Bug 类型数据不能写入任务列表');
  const tasks = await readJson(paths.tasks, []);
  const task = normalizeTask(input);
  const index = findTaskIndex(tasks, task);
  if (index >= 0) tasks[index] = mergeTask(tasks[index], task, new Date().toISOString());
  else tasks.push(task);
  await writeJson(paths.tasks, tasks);
  return index >= 0 ? tasks[index] : task;
}

export async function upsertTasks(inputs = []) {
  const tasks = await readJson(paths.tasks, []);
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  const saved = [];
  for (const input of inputs) {
    if (isBugLikeTaskRecord(input)) continue;
    const task = normalizeTask(input);
    const index = findTaskIndex(tasks, task);
    if (index >= 0) {
      const changed = taskContentFingerprint(tasks[index]) !== taskContentFingerprint(task);
      tasks[index] = mergeTask(tasks[index], task, now);
      if (changed) updated += 1;
      saved.push(tasks[index]);
    } else {
      tasks.push(task);
      created += 1;
      saved.push(task);
    }
  }
  await writeJson(paths.tasks, tasks);
  return { created, updated, total: saved.length, tasks: saved };
}

export async function deletePlatformTask(id) {
  const targetId = String(id || '').trim();
  if (!targetId) return null;
  const tasks = await readJson(paths.tasks, []);
  const decodedId = decodeURIComponent(targetId);
  const index = tasks.findIndex(task => {
    const keys = [task.id, task.taskNo, task.zentaoId, task.zentao?.id, taskIdentityKey(task)]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    return keys.includes(decodedId);
  });
  if (index === -1) return null;
  const task = tasks[index];
  if (task.source !== 'platform') {
    const error = new Error('只允许删除平台创建任务，禅道同步任务不能删除。');
    error.code = 'TASK_DELETE_FORBIDDEN';
    throw error;
  }
  tasks.splice(index, 1);

  const taskNo = String(task.taskNo || task.zentaoId || task.zentao?.id || '').trim();
  const taskIds = new Set([task.id, taskNo, taskIdentityKey(task)].filter(Boolean));
  const briefKeys = new Set([
    taskNo ? `task:${task.projectId}:${taskNo}` : '',
    task.id ? `task:${task.projectId}:${slugify(task.id)}` : ''
  ].filter(Boolean));
  const sameTask = record => {
    const recordTaskNo = String(record.taskNo || record.zentaoId || record.zentao?.id || '').trim();
    return taskIds.has(record.taskId)
      || taskIds.has(record.id)
      || (taskNo && recordTaskNo === taskNo)
      || (task.projectId && record.projectId === task.projectId && taskNo && recordTaskNo === taskNo)
      || (task.projectId && record.projectId === task.projectId && briefKeys.has(String(record.groupKey || '').trim()));
  };
  const [reviews, notes, artBriefs] = await Promise.all([
    readJson(paths.taskReviews, []),
    readJson(paths.taskProcessingNotes, []),
    readJson(paths.artBriefs, [])
  ]);
  const nextReviews = reviews.filter(record => !sameTask(record));
  const nextNotes = notes.filter(record => !sameTask(record));
  const nextArtBriefs = artBriefs.filter(record => !sameTask(record));

  await Promise.all([
    writeJson(paths.tasks, tasks),
    writeJson(paths.taskReviews, nextReviews),
    writeJson(paths.taskProcessingNotes, nextNotes),
    writeJson(paths.artBriefs, nextArtBriefs)
  ]);

  return {
    task,
    removed: {
      taskReviews: reviews.length - nextReviews.length,
      taskProcessingNotes: notes.length - nextNotes.length,
      artBriefs: artBriefs.length - nextArtBriefs.length
    }
  };
}

function taskContentFingerprint(task = {}) {
  return JSON.stringify({
    title: task.title || '',
    developer: task.developer || '',
    assignedTo: task.assignedTo || task.zentao?.assignedTo || '',
    status: task.status || '',
    zentaoStatus: task.zentaoStatus || '',
    isCurrent: task.isCurrent !== false,
    syncStatus: task.syncStatus || '',
    archivedAt: task.archivedAt || '',
    deadline: task.deadline || '',
    zentaoCreatedAt: task.zentaoCreatedAt || '',
    zentaoProgress: Number(task.zentaoProgress || 0),
    completion: Number(task.completion || 0),
    summary: task.summary || '',
    issues: task.issues || '',
    requirement: task.requirement || '',
    zentao: task.zentao || {}
  });
}

export async function reconcileZentaoTaskSnapshot(projectId, currentTaskIds = [], syncedAt = new Date().toISOString()) {
  const rawTasks = await readJson(paths.tasks, []);
  const taskMap = new Map();
  for (const task of rawTasks) {
    taskMap.set(taskIdentityKey(task), mergeDuplicateTask(taskMap.get(taskIdentityKey(task)), task));
  }
  const tasks = [...taskMap.values()];
  const currentSet = new Set(currentTaskIds.filter(Boolean));
  let markedCurrent = 0;
  let markedNonCurrent = 0;
  for (const task of tasks) {
    if (task.projectId !== projectId || task.source !== 'zentao') continue;
    const wasCurrent = task.isCurrent !== false;
    const isCurrent = currentSet.has(task.id) || currentSet.has(taskIdentityKey(task));
    task.isCurrent = isCurrent;
    task.syncStatus = isCurrent ? 'current' : 'non_current';
    task.lastSyncedAt = syncedAt;
    task.archivedAt = isCurrent ? '' : task.archivedAt || syncedAt;
    task.updatedAt = task.updatedAt || syncedAt;
    if (isCurrent && !wasCurrent) markedCurrent += 1;
    if (!isCurrent && wasCurrent) markedNonCurrent += 1;
  }
  await writeJson(paths.tasks, tasks);
  return { markedCurrent, markedNonCurrent, totalZentaoTasks: tasks.filter(task => task.projectId === projectId && task.source === 'zentao').length };
}

export async function upsertBugs(inputs = []) {
  const bugs = await readJson(paths.bugs, []);
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  const saved = [];
  for (const input of inputs) {
    const bug = normalizeBug(input);
    const index = bugs.findIndex(item => item.id === bug.id);
    if (index >= 0) {
      bugs[index] = { ...bugs[index], ...bug, updatedAt: now };
      updated += 1;
      saved.push(bugs[index]);
    } else {
      bugs.push(bug);
      created += 1;
      saved.push(bug);
    }
  }
  await writeJson(paths.bugs, bugs);
  return { created, updated, total: saved.length, bugs: saved };
}

export async function replaceBugsForProducts(projectId, productIds = [], inputs = []) {
  const bugs = await readJson(paths.bugs, []);
  const now = new Date().toISOString();
  const productSet = new Set(productIds.map(item => String(item)));
  const previousById = new Map(bugs.map(bug => [bug.id, bug]));
  const normalized = inputs.map(input => normalizeBug(input));
  const incomingIds = new Set(normalized.map(bug => bug.id));
  let created = 0;
  let updated = 0;

  normalized.forEach(bug => {
    if (previousById.has(bug.id)) updated += 1;
    else created += 1;
  });

  const kept = bugs.filter(bug => {
    const sameProject = !projectId || bug.projectId === projectId;
    const productId = String(bug.productId || bug.zentao?.product || '');
    const sameProduct = !productSet.size || productSet.has(productId) || (sameProject && !productId && isZentaoBugSnapshot(bug));
    return !(sameProject && sameProduct) || incomingIds.has(bug.id);
  });

  const merged = kept.map(bug => {
    const next = normalized.find(item => item.id === bug.id);
    return next ? { ...bug, ...next, updatedAt: now } : bug;
  });

  normalized.forEach(bug => {
    if (!merged.some(item => item.id === bug.id)) {
      merged.push({ ...bug, updatedAt: bug.updatedAt || now });
    }
  });

  await writeJson(paths.bugs, merged);
  return { created, updated, removed: bugs.length + created - merged.length, total: normalized.length, bugs: normalized };
}

function isZentaoBugSnapshot(bug = {}) {
  return Boolean(
    bug.bugNo ||
    bug.zentao?.id ||
    bug.zentao?.sourceType === 'bug' ||
    /^zentao_bug_/i.test(String(bug.id || ''))
  );
}

export async function createTaskReview(input) {
  const reviews = await readJson(paths.taskReviews, []);
  const review = normalizeTaskReview(input);
  reviews.push(review);
  await writeJson(paths.taskReviews, reviews);
  return review;
}

export async function listOperationLogs(filters = {}) {
  const logs = await readJson(paths.operationLogs, []);
  const keyword = String(filters.keyword || '').trim().toLowerCase();
  const from = filters.from ? Date.parse(filters.from) : 0;
  const to = filters.to ? Date.parse(filters.to) : 0;
  const page = Math.max(1, Number(filters.page || 1));
  const pageSize = Math.max(10, Math.min(200, Number(filters.pageSize || 20)));
  const start = (page - 1) * pageSize;
  const actions = Array.isArray(filters.actions)
    ? filters.actions
    : String(filters.actions || '').split(/[,，、\s]+/).filter(Boolean);
  const items = [];
  let total = 0;
  for (const log of logs) {
    if (!operationLogMatchesFilters(log, filters, { keyword, from, to, actions })) continue;
    if (total >= start && items.length < pageSize) items.push(displayOperationLog(log));
    total += 1;
  }
  return {
    items,
    total,
    page,
    pageSize
  };
}

function operationLogMatchesFilters(log = {}, filters = {}, prepared = {}) {
  if (filters.userId) {
    const userFilter = cleanString(filters.userId);
    const userValues = [log.userId, log.username, log.displayName].map(cleanString).filter(Boolean);
    if (!userValues.includes(userFilter)) return false;
  }
  if (filters.module && log.module !== filters.module) return false;
  if (filters.includeArtProgress !== '1' && log.module === 'art-progress') return false;
  const actions = prepared.actions || [];
  if (actions.length) {
    if (!actions.includes(log.action)) return false;
  } else if (filters.action && log.action !== filters.action) {
    return false;
  }
  if (filters.result && log.result !== filters.result) return false;
  const from = prepared.from || 0;
  const to = prepared.to || 0;
  if (from || to) {
    const time = Date.parse(log.createdAt || '');
    if (from && (!time || time < from)) return false;
    if (to && (!time || time > to)) return false;
  }
  const keyword = prepared.keyword || '';
  if (keyword) {
    const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
    const after = log.after && typeof log.after === 'object' ? log.after : {};
    const haystack = [
      log.username,
      log.displayName,
      log.action,
      log.actionName,
      log.module,
      log.targetType,
      log.targetId,
      log.targetName,
      operationLogDisplayTargetName(log),
      after.artifactName,
      after.researchName,
      after.artifactLocation,
      metadata.productName,
      metadata.artifactName,
      metadata.skillName,
      metadata.path,
      metadata.filePath,
      metadata.skillPath,
      metadata.artifactPath,
      log.description,
      log.errorMessage,
      log.ip
    ].join('\n').toLowerCase();
    if (!haystack.includes(keyword)) return false;
  }
  return true;
}

export async function getOperationLog(id) {
  const logId = String(id || '').trim();
  if (!logId) return null;
  const logs = await readJson(paths.operationLogs, []);
  const log = logs.find(item => String(item.id) === logId);
  return log ? displayOperationLog(log) : null;
}

export async function createOperationLog(input = {}) {
  const log = normalizeOperationLog(input);
  if (!shouldKeepOperationLog(log)) return { ...log, _skipped: true };
  const logs = await readJson(paths.operationLogs, []);
  const maxLogs = Number(process.env.AWP_OPERATION_LOG_MAX_ROWS || 10000);
  const nextLogs = compactOperationLogList([...logs, log], { maxLogs });
  await writeJson(paths.operationLogs, nextLogs);
  return log;
}

export async function compactOperationLogs(options = {}) {
  const logs = await readJson(paths.operationLogs, []);
  const maxLogs = Number(options.maxLogs || process.env.AWP_OPERATION_LOG_MAX_ROWS || 10000);
  const nextLogs = compactOperationLogList(logs, { maxLogs });
  const changed = nextLogs.length !== logs.length || JSON.stringify(nextLogs.map(log => log.id)) !== JSON.stringify(logs.map(log => log.id));
  if (changed) await writeJson(paths.operationLogs, nextLogs);
  return {
    before: logs.length,
    after: nextLogs.length,
    removed: Math.max(0, logs.length - nextLogs.length)
  };
}

function compactOperationLogList(logs = [], options = {}) {
  const maxLogs = Number.isFinite(Number(options.maxLogs)) && Number(options.maxLogs) > 0 ? Number(options.maxLogs) : 10000;
  const latestByKey = new Map();
  const standalone = [];
  for (const rawLog of Array.isArray(logs) ? logs : []) {
    const log = normalizeOperationLog(rawLog);
    const key = operationLogCompactKey(log);
    if (!key) {
      standalone.push(log);
      continue;
    }
    const previous = latestByKey.get(key);
    if (!previous || compareOperationLogTime(log, previous) >= 0) latestByKey.set(key, log);
  }
  return [...standalone, ...latestByKey.values()]
    .sort((a, b) => compareOperationLogTime(b, a))
    .slice(0, maxLogs);
}

function operationLogCompactKey(log = {}) {
  const action = cleanString(log.action);
  const module = cleanString(log.module);
  if (!action || !module) return '';
  const result = cleanString(log.result || 'success');
  const userKey = cleanString(log.userId || log.username || log.displayName);
  if (!userKey) return '';
  if (isRoutineAccessOperationLog(log)) {
    return [
      module,
      action,
      result,
      userKey,
      cleanString(log.targetType),
      cleanString(log.targetId || log.targetName || log.username),
      operationLogDayKey(log)
    ].join('|');
  }
  const targetKey = cleanString(log.targetId || log.targetName);
  if (!targetKey) return '';
  return [
    module,
    action,
    result,
    userKey,
    cleanString(log.targetType),
    targetKey
  ].join('|');
}

function operationLogDayKey(log = {}) {
  const time = Date.parse(log.createdAt || '');
  return time ? new Date(time).toISOString().slice(0, 10) : cleanString(log.createdAt).slice(0, 10);
}

function compareOperationLogTime(left = {}, right = {}) {
  const leftTime = Date.parse(left.createdAt || '') || 0;
  const rightTime = Date.parse(right.createdAt || '') || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return cleanString(left.id).localeCompare(cleanString(right.id));
}

export async function deleteOperationLog(id) {
  const logId = String(id || '').trim();
  if (!logId) return null;
  const logs = await readJson(paths.operationLogs, []);
  const index = logs.findIndex(item => String(item.id) === logId);
  if (index === -1) return null;
  const [log] = logs.splice(index, 1);
  await writeJson(paths.operationLogs, logs);
  return normalizeOperationLog(log);
}

export async function deleteOperationLogsByFilters(filters = {}) {
  const logs = await readJson(paths.operationLogs, []);
  const keyword = String(filters.keyword || '').trim().toLowerCase();
  const from = filters.from ? Date.parse(filters.from) : 0;
  const to = filters.to ? Date.parse(filters.to) : 0;
  const actions = Array.isArray(filters.actions)
    ? filters.actions
    : String(filters.actions || '').split(/[,，、\s]+/).filter(Boolean);
  const deleted = [];
  const kept = [];
  for (const log of logs) {
    if (operationLogMatchesFilters(log, filters, { keyword, from, to, actions })) {
      deleted.push(log);
    } else {
      kept.push(log);
    }
  }
  if (deleted.length) await writeJson(paths.operationLogs, kept);
  return {
    deletedCount: deleted.length,
    deleted: deleted.map(log => normalizeOperationLog(log))
  };
}

export async function previewOperationLogDeletion(filters = {}) {
  const logs = await readJson(paths.operationLogs, []);
  const keyword = String(filters.keyword || '').trim().toLowerCase();
  const from = filters.from ? Date.parse(filters.from) : 0;
  const to = filters.to ? Date.parse(filters.to) : 0;
  const actions = Array.isArray(filters.actions)
    ? filters.actions
    : String(filters.actions || '').split(/[,，、\s]+/).filter(Boolean);
  const matched = [];
  let bytes = 0;
  for (const log of logs) {
    if (!operationLogMatchesFilters(log, filters, { keyword, from, to, actions })) continue;
    matched.push(log);
    bytes += Buffer.byteLength(JSON.stringify(log), 'utf8') + 2;
  }
  return {
    matchedCount: matched.length,
    estimatedBytes: bytes,
    sample: matched.slice(0, 8).map(log => ({
      id: log.id,
      createdAt: log.createdAt,
      module: log.module,
      action: log.action,
      actionName: log.actionName,
      targetName: log.targetName,
      username: log.username || log.displayName
    }))
  };
}

function validateOperationLogMaintenanceFilters(filters = {}) {
  if (!filters.from || !filters.to) {
    const error = new Error('请选择操作日志清理的开始时间和结束时间。');
    error.status = 400;
    throw error;
  }
  const from = Date.parse(filters.from);
  const to = Date.parse(filters.to);
  if (!from || !to || from > to) {
    const error = new Error('操作日志清理时间范围无效。');
    error.status = 400;
    throw error;
  }
}

function validateRunMaintenanceFilters(filters = {}) {
  if (!filters.from || !filters.to) {
    const error = new Error('请选择执行记录清理的开始时间和结束时间。');
    error.status = 400;
    throw error;
  }
  const from = Date.parse(filters.from);
  const to = Date.parse(filters.to);
  if (!from || !to || from > to) {
    const error = new Error('执行记录清理时间范围无效。');
    error.status = 400;
    throw error;
  }
}

function validateArtBriefMaintenanceFilters(filters = {}) {
  const hasRange = Boolean(filters.from && filters.to);
  const hasTaskNo = Boolean(cleanString(filters.taskNo));
  const hasKeyword = Boolean(cleanString(filters.keyword));
  if (!hasRange && !hasTaskNo && !hasKeyword) {
    const error = new Error('请选择摘要产物清理的时间范围、任务号或关键词。');
    error.status = 400;
    throw error;
  }
  if ((filters.from || filters.to) && !hasRange) {
    const error = new Error('摘要产物按时间清理时需要同时选择开始和结束时间。');
    error.status = 400;
    throw error;
  }
  if (hasRange) {
    const from = Date.parse(filters.from);
    const to = Date.parse(filters.to);
    if (!from || !to || from > to) {
      const error = new Error('摘要产物清理时间范围无效。');
      error.status = 400;
      throw error;
    }
  }
}

export async function ensureTaskForRun(input) {
  if (input.taskId) {
    const existing = await getTask(input.taskId);
    if (existing) return existing;
  }
  const taskNo = cleanTaskNo(input.zentaoId || input.taskNo || input.title);
  const title = cleanTaskTitle(input.title || input.requirement || 'Untitled task', taskNo);
  const id = input.taskId || taskIdFor(input.projectId, taskNo, title);
  const existing = await getTask(id);
  const task = {
    ...(existing || {}),
    id,
    projectId: input.projectId,
    taskNo,
    title,
    developer: input.developer || existing?.developer || '',
    source: existing?.source || 'platform',
    status: existing?.status || 'pending',
    zentaoStatus: input.zentaoStatus || existing?.zentaoStatus || '',
    deadline: input.deadline || existing?.deadline || '',
    zentaoCreatedAt: input.zentaoCreatedAt || existing?.zentaoCreatedAt || '',
    zentaoProgress: Number(input.zentaoProgress ?? existing?.zentaoProgress ?? 0),
    completion: Number(input.completion ?? existing?.completion ?? 0),
    agentModel: input.agentModel || existing?.agentModel || '',
    summary: input.summary || existing?.summary || '',
    issues: input.issues || existing?.issues || '',
    stageChecks: normalizeStageChecks(input.stageChecks || existing?.stageChecks || []),
    createdAt: existing?.createdAt || new Date().toISOString()
  };
  return upsertTask(task);
}

const runListTimeFields = ['createdAt', 'queuedAt', 'startedAt', 'finishedAt', 'completedAt', 'updatedAt'];

function compareRunListTimeDesc(a = {}, b = {}) {
  const diff = displayRunListTime(b) - displayRunListTime(a);
  if (diff) return diff;
  return cleanString(b.id).localeCompare(cleanString(a.id));
}

function displayRunListTime(run = {}) {
  for (const field of runListTimeFields) {
    const time = Date.parse(cleanString(run?.[field]));
    if (Number.isFinite(time) && time > 0) return time;
  }
  return 0;
}

export async function listRuns() {
  const runs = await reconcileStaleLocalWorkerRuns();
  const artifactRuns = await Promise.all(runs.map(enrichRunGeneratedArtifactEvidence));
  const hydratedRuns = await Promise.all(artifactRuns.map(hydrateRunStages));
  const figmaEnrichedRuns = await Promise.all(hydratedRuns.map(enrichRunWithFigmaLogEvidence));
  const enrichedRuns = await Promise.all(figmaEnrichedRuns.map(enrichRunWithImageGenerationEvidence));
  const evidenceReconciledRuns = enrichedRuns.map(reconcileFigmaEvidenceRunStatus);
  await persistRunReadReconciliations(runs, evidenceReconciledRuns);
  return evidenceReconciledRuns.sort(compareRunListTimeDesc);
}

export async function getCodexConfig() {
  return normalizeCodexConfig(await readJson(paths.codexConfig, defaultCodexConfig()));
}

export async function getUsageCounters() {
  const counters = normalizeUsageCounters(await readJson(paths.usageCounters, defaultUsageCounters()));
  const normalized = await normalizeHistoricalUsageCounterKinds(counters);
  const output = {
    ...normalized,
    version: 1,
    logicVersion: usageCounterLogicVersion
  };
  const needsPersist = counters.logicVersion !== usageCounterLogicVersion
    || JSON.stringify(counters.buckets || {}) !== JSON.stringify(output.buckets || {});
  if (needsPersist) {
    output.updatedAt = new Date().toISOString();
    await writeJson(paths.usageCounters, output, { skipRetention: true });
  }
  return output;
}

export async function recordUsageCountersForExpiredSkillValidations(records = []) {
  const targets = records.flatMap(record => usageTargetsFromSkillValidation(record));
  if (targets.length) await updateUsageCounters(targets);
}

export async function recordUsageCountersForArtProgressEvent(record = {}) {
  const targets = usageTargetsFromArtProgressEvent(record);
  if (targets.length) await updateUsageCounters(targets);
}

export async function recordUsageCountersForSkillValidation(record = {}) {
  const targets = usageTargetsFromSkillValidation(record);
  if (!targets.length) return { matched: 0 };
  return await updateUsageCounters(targets);
}

export async function recordUsageCountersForSkillValidationOperationLog(log = {}) {
  const inventory = await usageInventoryIdentity();
  const targets = usageTargetsFromSkillValidationOperationLog(log, inventory);
  if (!targets.length) return { matched: 0 };
  return await updateUsageCounters(targets);
}

export async function recordUsageCountersForOperationLog(log = {}) {
  if (log?._deduped === true) return { matched: 0 };
  const inventory = await usageInventoryIdentity();
  const targets = usageTargetsFromOperationLog(log, inventory);
  if (!targets.length) return { matched: 0 };
  return await updateUsageCounters(targets);
}

export async function recordUsageCountersForRun(run = {}, options = {}) {
  const targets = usageTargetsFromRun(run, options);
  if (!targets.length) return { matched: 0 };
  return await updateUsageCounters(targets);
}

export async function recordUsageCountersForDirectSkillRun(run = {}) {
  return recordUsageCountersForRun(run, { source: 'direct-skill-run' });
}

export async function recordUsageCountersForSkillAliases(aliases = [], options = {}) {
  const normalizedAliases = normalizeLineList(aliases)
    .map(cleanString)
    .filter(Boolean);
  if (!normalizedAliases.length) return { matched: 0 };
  const aliasKeys = normalizedAliases
    .map(usageCounterKey)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  if (!aliasKeys.length) return { matched: 0 };
  const usageTarget = cleanString(options.target || options.targetName || normalizedAliases[0]);
  const countKind = cleanString(options.kind || 'usage');
  const afterTime = options.after ? Date.parse(options.after) : 0;
  const targets = [];
  const shouldUseRecord = record => {
    const createdAt = Date.parse(record?.createdAt || record?.updatedAt || '');
    if (afterTime && (!createdAt || createdAt < afterTime)) return false;
    return true;
  };
  const addAliasHit = (record, source = 'art-progress') => {
    if (!shouldUseRecord(record)) return;
    if (source === 'art-progress' && !isUsageCountableArtProgressEvent(record)) return;
    if (source === 'operation-log' && !isHistoricalUsageOperationLog(record)) return;
    const haystack = usageSearchTextFromRecord(record, source);
    if (!haystack) return;
    if (!aliasKeys.some(key => haystack.includes(key))) return;
    const person = source === 'operation-log'
      ? cleanString(record.displayName || record.username)
      : cleanString(record.memberName || record.memberAccount);
    targets.push({
      key: usageTarget,
      target: usageTarget,
      person,
      at: cleanString(record.createdAt || record.updatedAt),
      source: `alias-${source}`,
      kind: countKind,
      eventKey: usageEventKey(`alias-${source}`, [record.id, usageTarget].filter(Boolean).join(':'), record.createdAt || record.updatedAt)
    });
  };
  const events = await readJson(paths.artProgressEvents, []);
  for (const event of Array.isArray(events) ? events : []) addAliasHit(event, 'art-progress');
  const logs = await readJson(paths.operationLogs, []);
  for (const log of Array.isArray(logs) ? logs : []) {
    if (!isUsageLikeOperationLog(log)) continue;
    addAliasHit(log, 'operation-log');
  }
  if (!targets.length) return { matched: 0 };
  return await updateUsageCounters(targets);
}

export async function upsertCodexConfig(input = {}) {
  const existing = await getCodexConfig();
  const apiKeyInput = String(input.apiKey || '').trim();
  const nextApiKey = apiKeyInput ? apiKeyInput : existing.apiKey;
  const next = normalizeCodexConfig({
    ...existing,
    ...input,
    apiKey: nextApiKey,
    keyFingerprint: apiKeyInput ? codexKeyFingerprint(apiKeyInput) : existing.keyFingerprint,
    updatedAt: new Date().toISOString()
  });
  if (input.clearApiKey === true) {
    next.apiKey = '';
    next.keyFingerprint = '';
  }
  await writeJson(paths.codexConfig, next);
  return next;
}

export function redactCodexConfig(config = {}) {
  const normalized = normalizeCodexConfig(config);
  return {
    modelProvider: normalized.modelProvider,
    model: normalized.model,
    baseUrl: normalized.baseUrl,
    wireApi: normalized.wireApi,
    envKeyName: normalized.envKeyName,
    hasApiKey: Boolean(normalized.apiKey),
    keyFingerprint: normalized.keyFingerprint || '',
    updatedAt: normalized.updatedAt || ''
  };
}

export async function getRun(id) {
  const runs = await reconcileStaleLocalWorkerRuns();
  const run = runs.find(item => item.id === id) || null;
  const artifactRun = await enrichRunGeneratedArtifactEvidence(run);
  const hydrated = await hydrateRunStages(artifactRun);
  const enriched = await enrichRunWithFigmaLogEvidence(hydrated);
  const imageReconciled = await enrichRunWithImageGenerationEvidence(enriched);
  const evidenceReconciled = reconcileFigmaEvidenceRunStatus(imageReconciled);
  await persistRunReadReconciliations(run ? [run] : [], evidenceReconciled ? [evidenceReconciled] : []);
  return evidenceReconciled;
}

export async function createRun(input) {
  const now = new Date().toISOString();
  const project = await getProject(input.projectId);
  const task = await resolveTaskForRun(input);
  const workflowLevel = normalizeLevel(input.workflowLevel || input.level);
  const workflow = normalizeWorkflowId(input.workflow || workflowForLevel(workflowLevel));
  const customWorkflow = workflow === 'custom-workflow'
    ? await resolveCustomWorkflowForRun(input)
    : null;
  const taskNo = cleanTaskNo(input.zentaoId || input.taskNo || task?.taskNo || '');
  const title = formatRunTitle(taskNo, input.title || task?.title || 'Untitled task');
  const taskFolderName = sanitizeTaskFolderName(title);
  const runs = await readJson(paths.runs, []);
  const attemptNo = runs.filter(item => {
    if (task?.id && item.taskId === task.id) return true;
    if (taskNo && item.zentaoId === taskNo) return true;
    if (!task?.id && !taskNo) return item.title === title && !item.taskId && !item.zentaoId;
    return false;
  }).length + 1;
  const run = {
    id: randomUUID(),
    taskId: task?.id || '',
    projectId: input.projectId,
    title,
    taskFolderName,
    workflow,
    workflowLevel,
    customWorkflowId: customWorkflow?.id || input.customWorkflowId || '',
    customWorkflowName: customWorkflow?.name || input.customWorkflowName || '',
    customWorkflowDescription: customWorkflow?.description || input.customWorkflowDescription || '',
    customWorkflowStrict: workflow === 'custom-workflow',
    stage: input.stage || '',
    targetPage: input.targetPage || '',
    zentaoId: input.zentaoId || taskNo || '',
    developer: input.developer || task?.developer || '',
    agentModel: input.agentModel || task?.agentModel || '',
    figmaLinks: input.figmaLinks || '',
    attachments: [],
    showdocHints: input.showdocHints || '',
    selectedMaterialHints: normalizeLineList(input.selectedMaterialHints),
    selectedMaterialSnapshots: normalizeRunMaterialSnapshots(input.selectedMaterialSnapshots),
    productName: input.productName || '',
    sourceTitle: input.sourceTitle || '',
    primarySkillPath: input.primarySkillPath || input.skillPath || input.stage || '',
    primarySkillTitle: input.primarySkillTitle || '',
    primarySkillContent: input.primarySkillContent || input.skillContent || '',
    figmaWriteMode: input.figmaWriteMode || '',
    imageGenerationProviderMode: normalizeImageGenerationProviderMode(input.imageGenerationProviderMode),
    assignedToUserId: input.assignedToUserId || input.assigneeUserId || '',
    assignedToName: input.assignedToName || input.assigneeName || input.developer || task?.developer || '',
    claimedByDeviceId: input.claimedByDeviceId || '',
    claimedAt: input.claimedAt || '',
    workerStatus: input.workerStatus || '',
    executionHost: input.executionHost || '',
    workerExecution: input.workerExecution === true,
    queuedForUserId: input.queuedForUserId || '',
    queuedForName: input.queuedForName || '',
    queuedAt: input.queuedAt || '',
    workerCapabilities: normalizeLineList(input.workerCapabilities),
    executionMode: input.executionMode || '',
    codexRequest: normalizeRunCodexRequest(input.codexRequest),
    requirement: input.requirement || '',
    sourceType: input.sourceType || (workflow === 'bug-fix' ? 'bug' : (task?.id ? 'task-center' : 'standalone')),
    status: input.status || (input.workerExecution === true || input.executionHost === 'local-worker' ? 'queued' : 'pending'),
    currentStage: input.currentStage || null,
    stages: workflow === 'custom-workflow' ? normalizeCustomStages(customWorkflow?.stages || input.customStages) : buildStages(workflow, input.stage, workflowLevel),
    createdAt: now,
    updatedAt: now,
    promptPath: '',
    logPath: '',
    artifactRoot: '',
    materialPath: '',
    pid: null,
    exitCode: null,
    blocker: null
  };
  if (input.createdBy) run.createdBy = input.createdBy;
  if (input.ownerUserId) run.ownerUserId = input.ownerUserId;
  run.attemptNo = attemptNo;
  run.artifactRoot = project ? buildRunArtifactRoot(project, run) : '';
  run.materialPath = run.artifactRoot ? path.join(run.artifactRoot, '资料.md') : '';
  if (run.artifactRoot) await prepareInitialRunArtifacts(project, run, task || {});
  if (run.artifactRoot) run.attachments = await saveRunAttachments(run, input.attachments);
  runs.push(run);
  await writeJson(paths.runs, runs);
  await fs.mkdir(getRunWorkspace(run.id), { recursive: true });
  return run;
}

async function resolveTaskForRun(input = {}) {
  if (input.taskId) {
    const existing = await getTask(input.taskId);
    if (existing) return existing;
  }
  const sourceMode = cleanString(input.sourceMode);
  const sourceType = cleanString(input.sourceType);
  const shouldCreateTask = Boolean(input.createTaskForRun)
    || Boolean(input.taskId)
    || sourceType === 'task-linked'
    || sourceType === 'task-center';
  if (!shouldCreateTask) return null;
  return ensureTaskForRun(input);
}

export async function listAgentWorkers(filters = {}) {
  const workers = await readJson(paths.agentWorkers, []);
  return workers
    .map(normalizeAgentWorker)
    .filter(worker => !filters.userId || worker.userId === String(filters.userId))
    .sort((a, b) => String(b.lastHeartbeatAt || '').localeCompare(String(a.lastHeartbeatAt || '')));
}

export async function upsertAgentWorker(input = {}) {
  const workers = await readJson(paths.agentWorkers, []);
  const worker = normalizeAgentWorker(input);
  const index = workers.findIndex(item => item.id === worker.id);
  if (index >= 0) workers[index] = {
    ...workers[index],
    ...worker,
    deviceAlias: worker.deviceAlias || workers[index].deviceAlias || '',
    createdAt: workers[index].createdAt || worker.createdAt
  };
  else workers.push(worker);
  await writeJson(paths.agentWorkers, workers);
  return index >= 0 ? normalizeAgentWorker(workers[index]) : worker;
}

export async function updateAgentWorkerAlias(id, userId, alias = '') {
  const workers = await readJson(paths.agentWorkers, []);
  const workerId = cleanString(decodeURIComponent(String(id || '')));
  const ownerId = cleanString(userId);
  const index = workers.findIndex(item => cleanString(item.id) === workerId && cleanString(item.userId) === ownerId);
  if (index === -1) return null;
  const nextAlias = cleanString(alias).slice(0, 24);
  workers[index] = {
    ...workers[index],
    deviceAlias: nextAlias,
    updatedAt: new Date().toISOString()
  };
  await writeJson(paths.agentWorkers, workers);
  return normalizeAgentWorker(workers[index]);
}

export async function claimNextAgentRun(input = {}) {
  const userId = String(input.userId || '').trim();
  const deviceId = String(input.deviceId || '').trim();
  if (!userId || !deviceId) return null;
  const capabilities = normalizeLineList(input.capabilities);
  if (!capabilities.includes('codex.exec')) return null;
  const allowedProjectIds = normalizeLineList(input.allowedProjectIds);
  const canAccessAllProjects = input.canAccessAllProjects === true || allowedProjectIds.includes('*');
  const runs = await readJson(paths.runs, []);
  const now = new Date().toISOString();
  const candidateIndex = runs.findIndex(run => (
    isClaimableAgentRun(run, userId, { allowedProjectIds, canAccessAllProjects })
    && workerCanExecuteRun(run, capabilities)
  ));
  if (candidateIndex === -1) return null;
  const baseRun = normalizeActiveLocalWorkerRun(runs[candidateIndex], 'claimed');
  const run = {
    ...baseRun,
    status: 'claimed',
    workerStatus: 'claimed',
    assignedToUserId: baseRun.assignedToUserId || userId,
    queuedForUserId: baseRun.queuedForUserId || userId,
    claimedByDeviceId: deviceId,
    claimedAt: now,
    startedBy: userId,
    workerCapabilities: capabilities,
    updatedAt: now
  };
  runs[candidateIndex] = run;
  await writeJson(paths.runs, runs);
  return hydrateRunStages(run);
}

export async function claimRecoverableAgentRun(input = {}) {
  const userId = String(input.userId || '').trim();
  const deviceId = String(input.deviceId || '').trim();
  const runId = cleanString(input.runId);
  if (!userId || !deviceId) return null;
  const capabilities = normalizeLineList(input.capabilities);
  if (!capabilities.includes('codex.exec')) return null;
  const allowedProjectIds = normalizeLineList(input.allowedProjectIds);
  const canAccessAllProjects = input.canAccessAllProjects === true || allowedProjectIds.includes('*');
  const runs = await readJson(paths.runs, []);
  const now = new Date().toISOString();
  const candidateIndex = runs.findIndex(run => (
    (!runId || cleanString(run.id) === runId)
    && isRecoverableAgentRun(run, userId, deviceId, { allowedProjectIds, canAccessAllProjects })
    && workerCanExecuteRun(run, capabilities)
  ));
  if (candidateIndex === -1) return null;
  const existing = runs[candidateIndex];
  const alreadyRunning = isWorkerRunStarted(existing);
  const nextStatus = alreadyRunning ? 'running' : 'claimed';
  const nextClaimedByDeviceId = existing.claimedByDeviceId || deviceId;
  const nextClaimedAt = existing.claimedAt || now;
  const nextStartedBy = existing.startedBy || userId;
  const nextQueuedForUserId = existing.queuedForUserId || userId;
  const normalizedExisting = normalizeActiveLocalWorkerRun(existing, nextStatus);
  const statusUnchanged = stableWorkerRunValue(existing) === stableWorkerRunValue(normalizedExisting)
    && existing.status === nextStatus
    && existing.workerStatus === nextStatus
    && existing.claimedByDeviceId === nextClaimedByDeviceId
    && existing.claimedAt === nextClaimedAt
    && existing.queuedForUserId === nextQueuedForUserId
    && existing.startedBy === nextStartedBy;
  if (statusUnchanged) {
    const hydrated = await hydrateRunStages({
      ...existing,
      _changed: false
    });
    return {
      ...hydrated,
      _changed: false
    };
  }
  const run = {
    ...normalizedExisting,
    status: nextStatus,
    workerStatus: nextStatus,
    assignedToUserId: normalizedExisting.assignedToUserId || userId,
    queuedForUserId: nextQueuedForUserId,
    claimedByDeviceId: nextClaimedByDeviceId,
    claimedAt: nextClaimedAt,
    resumedAt: now,
    startedBy: nextStartedBy,
    workerCapabilities: capabilities,
    updatedAt: now
  };
  runs[candidateIndex] = run;
  await writeJson(paths.runs, runs);
  const hydrated = await hydrateRunStages(run);
  return {
    ...hydrated,
    _changed: true
  };
}

export async function updateAgentRunFromWorker(runId, input = {}) {
  const runs = await readJson(paths.runs, []);
  const index = runs.findIndex(item => item.id === runId);
  if (index === -1) return null;
  const now = new Date().toISOString();
  const existing = runs[index];
  if (isFinalWorkerRunStatus(existing.status || existing.workerStatus) && !isFinalWorkerRunStatus(input.status || input.workerStatus)) {
    const hydrated = await hydrateRunStages(existing);
    return {
      ...hydrated,
      _changed: false
    };
  }
  const incomingStatus = input.status || input.workerStatus || existing.status;
  const activeExisting = isFinalWorkerRunStatus(incomingStatus)
    ? existing
    : normalizeActiveLocalWorkerRun(existing, normalizeWorkerRunStatus(incomingStatus || existing.status || 'running'));
  const timingPatch = normalizeWorkerTimingPatch(input, activeExisting);
  const nextStatus = resolveWorkerRunStatusTransition(activeExisting, incomingStatus);
  const patch = {
    workerStatus: nextStatus,
    status: nextStatus,
    currentStage: input.currentStage ?? activeExisting.currentStage,
    blocker: input.blocker ?? activeExisting.blocker,
    resultSummary: input.resultSummary ?? activeExisting.resultSummary,
    exitCode: input.exitCode ?? activeExisting.exitCode,
    finishedAt: input.finishedAt || timingPatch.finishedAt || (/completed|blocked|failed|cancelled/.test(String(input.status || input.workerStatus || '')) ? now : activeExisting.finishedAt),
    workerResult: input.workerResult ?? activeExisting.workerResult,
    figmaWriteResult: input.figmaWriteResult ?? activeExisting.figmaWriteResult,
    updatedAt: now,
    ...timingPatch
  };
  if (isFinalWorkerRunStatus(nextStatus)) {
    patch.localWorkerStale = false;
    patch.localWorkerStaleDetectedAt = '';
  }
  if (input.pid !== undefined) patch.pid = input.pid;
  if (input.startedAt) patch.startedAt = input.startedAt;
  if (patch.currentStage !== undefined) patch.currentStage = normalizeWorkerStageName(patch.currentStage);
  if (input.logPath) patch.logPath = input.logPath;
  if (input.promptPath) patch.promptPath = input.promptPath;
  if (input.artifactRoot) patch.artifactRoot = input.artifactRoot;
  const workerLocalLogPath = cleanString(input.workerLocalLogPath || input.workerResult?.localLogPath);
  if (workerLocalLogPath) patch.workerLocalLogPath = workerLocalLogPath;
  const workerLocalLogSize = Number(input.workerLocalLogSize ?? input.workerResult?.localLogSize);
  if (Number.isFinite(workerLocalLogSize) && workerLocalLogSize >= 0) patch.workerLocalLogSize = workerLocalLogSize;
  const nextRun = guardFigmaWriteCompletion({ ...activeExisting, ...patch });
  if (!hasWorkerRunMaterialChange(existing, nextRun)) {
    const hydrated = await hydrateRunStages(existing);
    return {
      ...hydrated,
      _changed: false
    };
  }
  runs[index] = nextRun;
  await writeJson(paths.runs, runs);
  const hydrated = await hydrateRunStages(runs[index]);
  return {
    ...hydrated,
    _changed: true
  };
}

export async function saveAgentRunGeneratedArtifacts(runId, input = []) {
  const runs = await readJson(paths.runs, []);
  const index = runs.findIndex(item => item.id === runId);
  if (index === -1) return null;
  const run = ensureRunArtifactRootFromExistingFiles(runs[index]);
  if (!run.artifactRoot) return await hydrateRunStages(run);
  const saved = await saveGeneratedRunArtifacts(run, input);
  if (!saved.length) return await hydrateRunStages(run);
  const now = new Date().toISOString();
  const existingSummary = run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {};
  const existingWorkerResult = run.workerResult && typeof run.workerResult === 'object' ? run.workerResult : {};
  const artifactEvidence = saved.map(item => item.relativePath || item.path).filter(Boolean);
  const nextSummaryArtifacts = [
    ...(Array.isArray(existingSummary.artifacts) ? existingSummary.artifacts : []),
    ...artifactEvidence
  ].filter(Boolean);
  const nextGeneratedArtifacts = dedupeRunArtifacts([
    ...(Array.isArray(existingSummary.generatedArtifacts) ? existingSummary.generatedArtifacts : []),
    ...saved
  ]);
  const nextWorkerGeneratedArtifacts = dedupeRunArtifacts([
    ...(Array.isArray(existingWorkerResult.generatedArtifacts) ? existingWorkerResult.generatedArtifacts : []),
    ...saved
  ]);
  const nextRun = {
    ...run,
    artifactRoot: run.artifactRoot,
    generatedArtifacts: dedupeRunArtifacts([
      ...(Array.isArray(run.generatedArtifacts) ? run.generatedArtifacts : []),
      ...saved
    ]),
    resultSummary: {
      ...existingSummary,
      artifacts: [...new Set(nextSummaryArtifacts)],
      generatedArtifacts: nextGeneratedArtifacts
    },
    workerResult: {
      ...existingWorkerResult,
      generatedArtifacts: nextWorkerGeneratedArtifacts
    },
    updatedAt: now
  };
  runs[index] = nextRun;
  await writeJson(paths.runs, runs);
  const hydrated = await hydrateRunStages(nextRun);
  return {
    ...hydrated,
    savedGeneratedArtifacts: saved
  };
}

async function enrichRunGeneratedArtifactEvidence(run = null) {
  if (!run) return null;
  const withRoot = ensureRunArtifactRootFromExistingFiles(run);
  if (!withRoot.artifactRoot) return withRoot;
  const scanned = await scanRunGeneratedImageArtifacts(withRoot);
  if (!scanned.length) return withRoot;
  return {
    ...withRoot,
    generatedArtifacts: dedupeRunArtifacts([
      ...(Array.isArray(withRoot.generatedArtifacts) ? withRoot.generatedArtifacts : []),
      ...scanned
    ])
  };
}

async function enrichRunWithImageGenerationEvidence(run = null) {
  if (!run || !isImageGenerationRun(run)) return run;
  if (!isFinishedRun(run.status) && !isFinishedRun(run.workerStatus)) return run;
  let workingRun = run;
  const importedArtifacts = await importLocalGeneratedImageArtifactsForRun(workingRun);
  if (importedArtifacts.length) {
    workingRun = mergeGeneratedArtifactsIntoRun(workingRun, importedArtifacts);
  }
  const generatedArtifacts = dedupeRunArtifacts([
    ...(Array.isArray(workingRun.generatedArtifacts) ? workingRun.generatedArtifacts : []),
    ...(Array.isArray(workingRun.resultSummary?.generatedArtifacts) ? workingRun.resultSummary.generatedArtifacts : []),
    ...(Array.isArray(workingRun.workerResult?.generatedArtifacts) ? workingRun.workerResult.generatedArtifacts : [])
  ]);
  const hasGeneratedImage = hasGeneratedImageArtifacts(generatedArtifacts);
  if (isCancelledRunStatus(workingRun.status) || isCancelledRunStatus(workingRun.workerStatus)) {
    return sanitizeNoFigmaImageGenerationRunSummary(workingRun, generatedArtifacts);
  }
  if (hasGeneratedImage) {
    return reconcileGeneratedImageRun(workingRun, generatedArtifacts, {
      summary: '本次生图已检测到真实生成图片产物并归档到工作台；不再按本机阻塞展示，请以产物区图片为准复核和下载。',
      policy: 'generated-image-artifacts-evidence-first',
      originalBlockerReason: cleanString(workingRun.blocker?.reason || workingRun.resultSummary?.blockerReason)
    });
  }
  const imageEvidence = await readRunImageGenerationEvidenceText(workingRun);
  const providerResult = evaluateImageProviderLogEvidence(imageEvidence, generatedArtifacts, workingRun);
  if (providerResult.blocked) {
    if (shouldAcceptLegacyGeneratedImageRun(workingRun, providerResult, generatedArtifacts)) {
      return reconcileLegacyGeneratedImageRun(workingRun, generatedArtifacts, {
        originalBlockerReason: providerResult.reason,
        imageEvidenceText: imageEvidence
      });
    }
    if (hasImage2SuccessfulArtifactEvidence(imageEvidence, generatedArtifacts) && !providerResult.disallowGeneratedArtifacts) {
      return reconcileGeneratedImageRun(workingRun, generatedArtifacts, {
        summary: '已检测到 Image2 / GPT Image 2 成功生成并归档图片产物，按已产出结果展示；请以产物区图片为准复核和下载。',
        policy: 'image2-generated-image-artifacts-accepted',
        originalBlockerReason: providerResult.reason
      });
    }
    return blockRunForImageGenerationEvidence(workingRun, providerResult.reason, {
      generatedArtifacts,
      disallowGeneratedArtifacts: providerResult.disallowGeneratedArtifacts,
      imageEvidenceText: imageEvidence
    });
  }
  const requiresLocalImageArtifact = !cleanString(run.figmaLinks);
  const statusText = `${cleanString(workingRun.status)} ${cleanString(workingRun.workerStatus)}`.toLowerCase();
  if (requiresLocalImageArtifact && /completed|done|success|passed/.test(statusText) && !hasGeneratedImage) {
    return blockRunForImageGenerationEvidence(workingRun, noFigmaImageArtifactMissingReason(), {
      generatedArtifacts,
      imageEvidenceText: imageEvidence
    });
  }
  return sanitizeNoFigmaImageGenerationRunSummary(workingRun, generatedArtifacts);
}

function sanitizeNoFigmaImageGenerationRunSummary(run = {}, generatedArtifacts = []) {
  if (!run || !isImageGenerationRun(run) || cleanString(run.figmaLinks)) return run;
  const summary = run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {};
  const blockerReason = cleanString(summary.blockerReason);
  const nextStep = cleanString(summary.nextStep);
  const blockerMentionsMissingFigma = mentionsMissingFigmaTarget(blockerReason);
  const nextMentionsMissingFigma = mentionsMissingFigmaTarget(nextStep);
  if (!blockerMentionsMissingFigma && !nextMentionsMissingFigma) return run;
  const hasGeneratedImage = hasGeneratedImageArtifacts(generatedArtifacts);
  const sanitizedReason = hasGeneratedImage ? '' : noFigmaImageArtifactMissingReason();
  return {
    ...run,
    resultSummary: {
      ...summary,
      status: hasGeneratedImage ? 'completed' : (summary.status || 'blocked'),
      statusText: hasGeneratedImage ? 'completed' : (summary.statusText || 'blocked'),
      summary: hasGeneratedImage
        ? '本次纯生图生成图片产物已归档到工作台，可在产物区预览、打开和下载。'
        : (summary.summary || '本机 Codex 已结束，但未检测到可归档的生成图片产物。'),
      blockerReason: sanitizedReason,
      nextStep: hasGeneratedImage
        ? ''
        : noFigmaImageArtifactNextStep(),
      generatedArtifacts
    },
    blocker: {
      ...(run.blocker && typeof run.blocker === 'object' ? run.blocker : {}),
      reason: sanitizedReason
    }
  };
}

function noFigmaImageArtifactMissingReason() {
  return '本次纯生图执行结束后未检测到可下载的生成图片产物；不能按本机已完成展示。';
}

function noFigmaImageArtifactNextStep() {
  return '继续执行或重新执行时确认成品图保存到“生成图片/”或“outputs/”目录，工作台会自动归档供预览、打开和下载。';
}

function mentionsMissingFigmaTarget(text = '') {
  const value = cleanString(text);
  if (!value) return false;
  return /缺少\s*Figma|未填(?:写)?\s*Figma|补充.{0,30}Figma|Figma.{0,40}(?:target[-\s]?node|node[-\s]?id|链接|目标)|target[-\s]?node|node[-\s]?id/i.test(value);
}

async function readRunImageGenerationEvidenceText(run = {}) {
  const logChunks = [];
  const logFiles = [
    cleanString(run.logPath),
    run.id ? path.join(getRunWorkspace(run.id), 'run.log') : ''
  ].filter(Boolean);
  for (const file of [...new Set(logFiles)]) {
    const text = await readTextTail(file, 180000).catch(() => '');
    const parsed = text ? parseRunLogImageGenerationEvidence(text) : '';
    if (parsed) logChunks.push(parsed);
  }
  const existingSummary = run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {};
  const generatedByImageReconcile = cleanString(existingSummary.generatedArtifactPolicy) === 'image2-failed-fallback-review'
    || /Image2 \/ GPT Image 2 出图未成功，本次不能按本机已完成展示/.test(cleanString(existingSummary.summary));
  const chunks = [
    generatedByImageReconcile ? '' : existingSummary.summary,
    generatedByImageReconcile ? '' : existingSummary.blockerReason,
    generatedByImageReconcile ? '' : existingSummary.nextStep,
    run.workerResult?.summary,
    run.workerResult?.blockerReason,
    ...logChunks
  ];
  if (!logChunks.length) {
    chunks.push(existingSummary.finalText, run.workerResult?.finalText);
  }
  return chunks.filter(Boolean).join('\n').slice(-260000);
}

function parseRunLogImageGenerationEvidence(text = '') {
  const chunks = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed);
      const item = event?.item || {};
      if (item.type === 'agent_message' && item.text) {
        chunks.push(String(item.text));
        return;
      }
      if (item.type === 'command_execution') {
        const command = String(item.command || '');
        const output = String(item.aggregated_output || '');
        if (!shouldUseCommandForImageGenerationEvidence(command, output)) return;
        chunks.push([
          command,
          output,
          item.exit_code === undefined || item.exit_code === null ? '' : `exit_code=${item.exit_code}`,
          item.status
        ].filter(Boolean).join('\n'));
        return;
      }
      if (event.message || event.text || event.delta) {
        chunks.push(String(event.message || event.text || event.delta));
      }
    } catch {
      if (/(?:APIConnectionError|unsupported_country_region_territory|request_forbidden|billing_hard_limit_reached|gpt[-_\s]?image|GPT Image 2|image2|Pillow|PIL|兜底|已落盘|同主题)/i.test(trimmed)) {
        chunks.push(trimmed);
      }
    }
  });
  return chunks.join('\n').slice(-180000);
}

function shouldUseCommandForImageGenerationEvidence(command = '', output = '') {
  const source = `${command}\n${output}`;
  if (isReadOnlyImageEvidenceCommand(command)) return false;
  if (/(?:gpt[-_\s]?image|GPT Image 2|image2|generate\.py|OPENAI_API_KEY|unsupported_country_region_territory|APIConnectionError|billing_hard_limit_reached|request_forbidden)/i.test(source)) {
    return true;
  }
  if (/(?:Pillow|PIL|Image\.new|ImageDraw|ImageOps|\.save\(|outputs\/|生成图片\/)/i.test(source)
    && !/^\s*\/bin\/(?:z)?sh\s+-lc\s+['"]?(?:cat|sed|grep|rg|wc|find|ls|file)\b/i.test(command)) {
    return true;
  }
  return false;
}

function isReadOnlyImageEvidenceCommand(command = '') {
  const text = String(command || '').replace(/\s+/g, ' ').trim();
  const normalized = text.replace(/^\/bin\/(?:z)?sh\s+-lc\s+['"]?/i, '').trim();
  if (/(?:generate\.py|gpt[-_\s]?image|GPT Image 2|OPENAI_API_KEY|image2|python|node|uv\b|codex\b)/i.test(normalized)) return false;
  return /^(?:cat|sed|grep|rg|wc|find|ls|file|base64)\b/i.test(normalized);
}

function evaluateImageProviderLogEvidence(text = '', generatedArtifacts = [], run = {}) {
  if (normalizeImageGenerationProviderMode(run.imageGenerationProviderMode) === 'fallback') {
    return { blocked: false, reason: '', disallowGeneratedArtifacts: false };
  }
  const source = String(text || '');
  const image2Failed = /(?:gpt[-_\s]?image[-_\s]?2|GPT Image 2|image\s*2|image2).{0,220}(?:APIConnectionError|Connection error|unsupported_country_region_territory|request_forbidden|billing_hard_limit_reached|rate limit|quota|403|401|429|timeout|timed out|failed|失败|不可用|无法|报错|拒绝)/i.test(source)
    || /(?:APIConnectionError|Connection error|unsupported_country_region_territory|request_forbidden|billing_hard_limit_reached|rate limit|quota|403|401|429|timeout|timed out).{0,220}(?:gpt[-_\s]?image[-_\s]?2|GPT Image 2|image\s*2|image2|出图|生图)/i.test(source)
    || /(?:gpt[-_\s]?image|图像生成|生图|出图).{0,220}(?:uv\s*缺失|缺\s*(?:dotenv|openai)|未能执行|无法执行|没有执行|未生成位图文件|未生成成品图)/i.test(source)
    || /正式\s*CLI.{0,120}(?:未能执行|没有执行|无法执行)/i.test(source)
    || /GPT\s*图像生成\s*CLI.{0,120}(?:接口区域限制|拒绝|失败)/i.test(source)
    || /调用\s*GPT Image 2\s*失败/i.test(source);
  if (!image2Failed) return { blocked: false, reason: '', disallowGeneratedArtifacts: false };
  const fallbackGenerated = hasPositiveFallbackImageEvidence(source)
    || generatedArtifacts.some(item => /pillow|pil|fallback|deterministic|兜底|替代/i.test(`${item?.source || ''}\n${item?.name || ''}\n${item?.path || ''}\n${item?.relativePath || ''}`));
  return {
    blocked: true,
    disallowGeneratedArtifacts: fallbackGenerated,
    reason: imageProviderFailureReason(source, { fallbackGenerated })
  };
}

function imageProviderFailureReason(source = '', options = {}) {
  const text = String(source || '');
  const details = [];
  if (/(?:unsupported_country_region_territory|Country,\s*region,\s*or\s*territory\s*not\s*supported|Unable to load site|api\.openai\.com|If you are using a VPN|Ray ID)/i.test(text)) {
    details.push('当前 Worker/Codex 生图请求像是直连官方 OpenAI，被地区、网络或 Cloudflare 拦截，未命中执行人本机中转站 Image2 配置。');
  }
  if (/(?:WindowsApps|Get-Command\s+py|py(?:\.exe)?['"]?\s+不存在|python.{0,80}(?:WindowsApps|占位|not found|无法|不是可用)|python\s+仅指向)/i.test(text)) {
    details.push('执行人 Windows 环境里的 python/py 不可用或指向 WindowsApps 占位程序，不能依赖 Python 版 Image2 CLI。');
  }
  if (/(?:billing_hard_limit_reached|quota|rate limit|429|余额|额度|计费)/i.test(text)) {
    details.push('Image2/API 额度、计费或限流未通过。');
  }
  if (/(?:401|403|permission|denied|unauthorized|invalid_api_key|API key|权限)/i.test(text) && !details.some(item => /地区|Cloudflare|OpenAI/.test(item))) {
    details.push('Image2/API key 或权限未通过。');
  }
  if (options.fallbackGenerated) {
    return [
      'Image2 / GPT Image 2 出图失败后检测到复用旧图、本地绘制、Pillow、脚本或其它替代产物；按当前规则不能算完成。',
      ...details,
      '必须修复执行人本机 Image2 后重新执行。'
    ].join('');
  }
  return [
    'Image2 / GPT Image 2 出图失败。',
    ...details,
    details.length
      ? '请确认执行人本机 Worker 能读取同一套中转 base_url、代理、凭据和 Codex 配置后重启 Worker 再执行。'
      : '必须修复执行人本机连接、代理、地区、额度或权限后重新执行。'
  ].join('');
}

function hasPositiveFallbackImageEvidence(text = '') {
  const source = String(text || '');
  const patterns = [
    /当前交付图为.{0,80}(?:Pillow|PIL|本地|兜底|替代).{0,80}(?:成品|PNG|图片|图)/i,
    /(?:使用|采用|改用).{0,60}(?:Pillow|PIL|Image\.new|ImageDraw|本地脚本|本地绘制|确定性绘制).{0,80}(?:生成|绘制|交付|保存|成品)/i,
    /(?:使用|复用|采用).{0,40}(?:已落盘|已有|历史|同主题).{0,80}(?:成品图|图片|图像|位图|产物)/i,
    /(?:已改用|改用).{0,80}(?:Figma MCP|use_figma|矢量|本机).{0,80}(?:绘制|完成交付|生成|替换)/i
  ];
  return patterns.some(pattern => pattern.test(source));
}

function normalizeImageGenerationProviderMode(value = '') {
  return cleanString(value) === 'fallback' ? 'fallback' : 'image2';
}

async function importLocalGeneratedImageArtifactsForRun(run = {}) {
  if (!run?.artifactRoot || !isPathInsideStore(run.artifactRoot, paths.artifactDir)) return [];
  if (!isImageGenerationRun(run)) return [];
  const cwd = cleanString(run.workerResult?.cwd);
  if (!cwd || !path.isAbsolute(cwd)) return [];
  const cwdStat = await fs.stat(cwd).catch(() => null);
  if (!cwdStat?.isDirectory()) return [];
  const existingLocalPaths = new Set([
    ...(Array.isArray(run.generatedArtifacts) ? run.generatedArtifacts : []),
    ...(Array.isArray(run.resultSummary?.generatedArtifacts) ? run.resultSummary.generatedArtifacts : []),
    ...(Array.isArray(run.workerResult?.generatedArtifacts) ? run.workerResult.generatedArtifacts : [])
  ].flatMap(item => [
    cleanString(item?.localPath),
    cleanString(item?.path),
    cleanString(item?.relativePath)
  ]).filter(Boolean));
  const localFiles = await scanLocalGeneratedImageFiles(cwd);
  const candidates = localFiles.filter(item => {
    const key = cleanString(item.path);
    return key && !existingLocalPaths.has(key);
  });
  if (!candidates.length) return [];
  return copyLocalGeneratedRunArtifacts(run, candidates.map((item, index) => ({
    id: `${cleanString(run.id) || 'run'}-local-generated-${index + 1}-${Math.round(item.mtimeMs || Date.now())}`,
    name: item.name,
    type: item.type,
    size: item.size,
    path: item.path,
    relativePath: item.relativePath,
    createdAt: new Date(item.mtimeMs || Date.now()).toISOString()
  })));
}

async function copyLocalGeneratedRunArtifacts(run = {}, input = []) {
  const items = Array.isArray(input) ? input.slice(0, 12) : [];
  if (!items.length || !run.artifactRoot) return [];
  const dir = path.join(run.artifactRoot, '生成图片');
  await fs.mkdir(dir, { recursive: true });
  const saved = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const sourcePath = cleanString(item.path);
    const sourceStat = sourcePath ? await fs.stat(sourcePath).catch(() => null) : null;
    const ext = sourcePath ? path.extname(sourcePath).replace(/^\./, '').toLowerCase().replace('jpeg', 'jpg') : '';
    const mime = item.type || runAttachmentMimeFromExt(ext);
    if (!sourceStat?.isFile() || sourceStat.size <= 0 || sourceStat.size > 8 * 1024 * 1024 || !mime) continue;
    const title = cleanString(item.name || `生成图片-${index + 1}.${ext}`) || `生成图片-${index + 1}.${ext}`;
    const baseName = safePathSegment(title.replace(/\.[^.]+$/, '')) || `generated-${index + 1}`;
    const fileName = `${String(index + 1).padStart(2, '0')}-${baseName}.${ext || 'png'}`;
    const filePath = await uniqueFilePath(dir, fileName);
    await fs.copyFile(sourcePath, filePath);
    saved.push({
      id: cleanString(item.id) || randomUUID(),
      name: title,
      type: mime,
      size: sourceStat.size,
      path: filePath,
      relativePath: path.relative(paths.root, filePath).replaceAll(path.sep, '/'),
      role: 'generated-image',
      source: 'local-worker-reconciled',
      localPath: sourcePath,
      createdAt: cleanString(item.createdAt) || new Date(sourceStat.mtimeMs || Date.now()).toISOString()
    });
  }
  return saved;
}

async function scanLocalGeneratedImageFiles(cwd = '') {
  const roots = ['生成图片', 'outputs']
    .map(name => path.join(cwd, name))
    .filter(dir => isPathInsideStore(dir, cwd));
  const rows = [];
  for (const dir of roots) {
    await walkLocalGeneratedImageFiles(dir, cwd, rows, 0);
  }
  return rows
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 12);
}

async function walkLocalGeneratedImageFiles(dir = '', cwd = '', rows = [], depth = 0) {
  if (depth > 3 || rows.length >= 48) return rows;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return rows;
  }
  for (const entry of entries) {
    if (!entry?.name || entry.name.startsWith('.DS_Store')) continue;
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkLocalGeneratedImageFiles(filePath, cwd, rows, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).replace(/^\./, '').toLowerCase().replace('jpeg', 'jpg');
    const type = runAttachmentMimeFromExt(ext);
    if (!type) continue;
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0 || stat.size > 8 * 1024 * 1024) continue;
    rows.push({
      name: entry.name,
      type,
      size: stat.size,
      path: filePath,
      relativePath: path.relative(cwd, filePath).replaceAll(path.sep, '/'),
      mtimeMs: stat.mtimeMs
    });
  }
  return rows;
}

function mergeGeneratedArtifactsIntoRun(run = {}, artifacts = []) {
  const saved = dedupeRunArtifacts(artifacts);
  if (!saved.length) return run;
  const existingSummary = run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {};
  const existingWorkerResult = run.workerResult && typeof run.workerResult === 'object' ? run.workerResult : {};
  const artifactPaths = saved.map(item => cleanString(item.relativePath || item.path)).filter(Boolean);
  return {
    ...run,
    generatedArtifacts: dedupeRunArtifacts([
      ...(Array.isArray(run.generatedArtifacts) ? run.generatedArtifacts : []),
      ...saved
    ]),
    resultSummary: {
      ...existingSummary,
      artifacts: [...new Set([
        ...(Array.isArray(existingSummary.artifacts) ? existingSummary.artifacts : []),
        ...artifactPaths
      ])],
      generatedArtifacts: dedupeRunArtifacts([
        ...(Array.isArray(existingSummary.generatedArtifacts) ? existingSummary.generatedArtifacts : []),
        ...saved
      ])
    },
    workerResult: {
      ...existingWorkerResult,
      generatedArtifacts: dedupeRunArtifacts([
        ...(Array.isArray(existingWorkerResult.generatedArtifacts) ? existingWorkerResult.generatedArtifacts : []),
        ...saved
      ])
    },
    updatedAt: new Date().toISOString()
  };
}

function hasImage2SuccessfulArtifactEvidence(text = '', generatedArtifacts = []) {
  if (!hasGeneratedImageArtifacts(generatedArtifacts)) return false;
  const source = String(text || '');
  if (!/(?:gpt[-_\s]?image[-_\s]?2|GPT Image 2|image\s*2|image2)/i.test(source)) return false;
  return /(?:exit_code["':=\s]+0|exit_code=0|成功|已(?:由|通过)?.{0,30}(?:gpt[-_\s]?image[-_\s]?2|GPT Image 2|image2).{0,100}(?:生成|落盘|保存)|(?:gpt[-_\s]?image[-_\s]?2|GPT Image 2|image2).{0,100}(?:成功|生成|落盘|保存)|outputs\/[^\s"'，。；]+?\.(?:png|jpe?g|webp|gif)|生成图片\/[^\s"'，。；]+?\.(?:png|jpe?g|webp|gif))/i.test(source);
}

function hasExplicitImageGenerationProviderMode(run = {}) {
  if (!Object.prototype.hasOwnProperty.call(run || {}, 'imageGenerationProviderMode')) return false;
  return /^(?:image2|fallback)$/.test(cleanString(run.imageGenerationProviderMode));
}

function hasGeneratedImageArtifacts(generatedArtifacts = []) {
  return (Array.isArray(generatedArtifacts) ? generatedArtifacts : [])
    .some(item => !item?.uploadFailed && cleanString(item?.relativePath || item?.path));
}

function shouldAcceptLegacyGeneratedImageRun(run = {}, providerResult = {}, generatedArtifacts = []) {
  if (hasExplicitImageGenerationProviderMode(run)) return false;
  if (!hasGeneratedImageArtifacts(generatedArtifacts)) return false;
  return providerResult?.blocked === true && /(?:Image2|GPT Image 2|image2|gpt[-_\s]?image[-_\s]?2)/i.test(providerResult.reason || '');
}

function reconcileLegacyGeneratedImageRun(run = {}, generatedArtifacts = [], options = {}) {
  return reconcileGeneratedImageRun(run, generatedArtifacts, {
    ...options,
    summary: '历史生图执行已检测到生成图片产物，按已产出结果展示；请以产物区图片为准复核和下载。',
    policy: 'legacy-generated-image-artifacts-accepted',
    nextStep: '查看生成图片产物，按需要人工复核；后续新执行按创建时选择的生图调用方式严格判定。'
  });
}

function reconcileGeneratedImageRun(run = {}, generatedArtifacts = [], options = {}) {
  const now = new Date().toISOString();
  const existingSummary = run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {};
  const existingWorkerResult = run.workerResult && typeof run.workerResult === 'object' ? run.workerResult : {};
  const finishedAt = cleanString(run.finishedAt || run.completedAt || run.updatedAt || now);
  const startedAt = cleanString(run.startedAt || run.claimedAt || run.queuedAt || run.createdAt);
  const durationMs = normalizeDurationMs(run.durationMs, startedAt, finishedAt, run.durationMs);
  const artifactPaths = generatedArtifacts.map(item => cleanString(item.relativePath || item.path)).filter(Boolean);
  const stages = Array.isArray(run.stages)
    ? run.stages.map(stage => {
      const status = cleanString(stage.status).toLowerCase();
      if (!/blocked/.test(status)) return stage;
      return {
        ...stage,
        status: 'completed',
        finishedAt: stage.finishedAt || finishedAt,
        durationMs: normalizeDurationMs(stage.durationMs, stage.startedAt || startedAt, stage.finishedAt || finishedAt, stage.durationMs)
      };
    })
    : run.stages;
  return {
    ...run,
    status: 'completed',
    workerStatus: 'completed',
    currentStage: '生成图片已归档',
    finishedAt,
    ...(durationMs > 0 ? { durationMs } : {}),
    generatedArtifacts,
    blocker: {
      ...(run.blocker && typeof run.blocker === 'object' ? run.blocker : {}),
      reason: '',
      legacyImageProviderReason: options.originalBlockerReason || ''
    },
    resultSummary: {
      ...existingSummary,
      status: 'conditional_pass',
      statusText: 'conditional_pass',
      summary: options.summary || '生图执行已检测到生成图片产物，按已产出结果展示；请以产物区图片为准复核和下载。',
      blockerReason: '',
      needsHumanReview: true,
      generatedArtifacts,
      artifacts: [...new Set([
        ...(Array.isArray(existingSummary.artifacts) ? existingSummary.artifacts : []),
        ...artifactPaths
      ])],
      generatedArtifactPolicy: options.policy || 'generated-image-artifacts-accepted',
      originalBlockerReason: options.originalBlockerReason || '',
      nextStep: options.nextStep || '查看生成图片产物，按需要人工复核；后续新执行按创建时选择的生图调用方式严格判定。',
      parsedAt: now
    },
    workerResult: {
      ...existingWorkerResult,
      generatedArtifacts
    },
    stages,
    localWorkerStale: false,
    localWorkerStaleDetectedAt: '',
    updatedAt: now
  };
}

function blockRunForImageGenerationEvidence(run = {}, reason = '', options = {}) {
  const now = new Date().toISOString();
  const generatedArtifacts = options.generatedArtifacts || run.generatedArtifacts || [];
  const existingSummary = run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {};
  const existingWorkerResult = run.workerResult && typeof run.workerResult === 'object' ? run.workerResult : {};
  const finishedAt = cleanString(run.finishedAt || run.completedAt || run.updatedAt || now);
  const startedAt = cleanString(run.startedAt || run.claimedAt || run.queuedAt || run.createdAt);
  const durationMs = normalizeDurationMs(run.durationMs, startedAt, finishedAt, run.durationMs);
  const stages = Array.isArray(run.stages)
    ? run.stages.map(stage => {
      const status = cleanString(stage.status).toLowerCase();
      if (/failed|blocked|cancelled|canceled/.test(status)) return stage;
      return {
        ...stage,
        status: 'blocked',
        finishedAt: stage.finishedAt || finishedAt,
        durationMs: normalizeDurationMs(stage.durationMs, stage.startedAt || startedAt, stage.finishedAt || finishedAt, stage.durationMs)
      };
    })
    : run.stages;
  return {
    ...run,
    status: 'blocked',
    workerStatus: 'blocked',
    currentStage: 'Image2 出图阻塞',
    finishedAt,
    ...(durationMs > 0 ? { durationMs } : {}),
    generatedArtifacts,
    blocker: {
      ...(run.blocker && typeof run.blocker === 'object' ? run.blocker : {}),
      reason
    },
    resultSummary: {
      ...existingSummary,
      status: 'blocked',
      statusText: 'blocked',
      summary: generatedArtifacts.length
        ? 'Image2 / GPT Image 2 出图未成功，本次不能按本机已完成展示；已归档图片仍保留在产物区供复核和下载。'
        : 'Image2 / GPT Image 2 出图未成功，本次不能按本机已完成展示。',
      blockerReason: reason,
      needsHumanReview: true,
      generatedArtifacts,
      artifacts: Array.isArray(existingSummary.artifacts) ? existingSummary.artifacts : [],
      generatedArtifactPolicy: options.disallowGeneratedArtifacts === true ? 'image2-failed-fallback-review' : 'normal',
      nextStep: '修复当前执行人本机 Image2 / GPT Image 2 连接、代理、地区、额度或权限后重新执行；不要使用 Pillow、本地绘制或其它方式替代。',
      parsedAt: now
    },
    workerResult: {
      ...existingWorkerResult
    },
    figmaWriteResult: run.figmaWriteResult,
    stages,
    localWorkerStale: false,
    localWorkerStaleDetectedAt: '',
    updatedAt: now
  };
}

async function scanRunGeneratedImageArtifacts(run = {}) {
  const rootDir = cleanString(run.artifactRoot);
  if (!rootDir || !isPathInsideStore(rootDir, paths.artifactDir)) return [];
  const rows = [];
  for (const dirName of ['生成图片', 'outputs']) {
    const generatedDir = path.join(rootDir, dirName);
    let entries = [];
    try {
      entries = await fs.readdir(generatedDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry?.isFile?.() || entry.name.startsWith('.DS_Store')) continue;
      const ext = path.extname(entry.name).replace(/^\./, '').toLowerCase().replace('jpeg', 'jpg');
      const type = runAttachmentMimeFromExt(ext);
      if (!type) continue;
      const filePath = path.join(generatedDir, entry.name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile() || stat.size <= 0) continue;
      const relativePath = path.relative(paths.root, filePath).replaceAll(path.sep, '/');
      const key = createHash('sha1').update(relativePath).digest('hex').slice(0, 12);
      rows.push({
        id: `${cleanString(run.id) || 'run'}-generated-${key}`,
        name: entry.name,
        type,
        size: stat.size,
        path: filePath,
        relativePath,
        role: 'generated-image',
        source: 'artifact-root-scan',
        createdAt: new Date(stat.mtimeMs || Date.now()).toISOString()
      });
    }
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
}

function ensureRunArtifactRootFromExistingFiles(run = {}) {
  if (run.artifactRoot) return run;
  const root = inferRunArtifactRootFromExistingFiles(run);
  return root ? { ...run, artifactRoot: root } : run;
}

function inferRunArtifactRootFromExistingFiles(run = {}) {
  const candidates = [
    run.materialPath,
    ...(Array.isArray(run.attachments) ? run.attachments.map(item => item?.path || item?.relativePath) : []),
    ...(Array.isArray(run.generatedArtifacts) ? run.generatedArtifacts.map(item => item?.path || item?.relativePath) : []),
    ...(Array.isArray(run.resultSummary?.generatedArtifacts) ? run.resultSummary.generatedArtifacts.map(item => item?.path || item?.relativePath) : []),
    ...(Array.isArray(run.workerResult?.generatedArtifacts) ? run.workerResult.generatedArtifacts.map(item => item?.path || item?.relativePath) : [])
  ];
  for (const item of candidates) {
    const resolved = resolveRunArtifactSourcePath(item);
    const root = inferRunArtifactRootFromPath(resolved);
    if (root) return root;
  }
  return '';
}

function inferRunArtifactRootFromPath(filePath = '') {
  if (!filePath || !isPathInsideStore(filePath, paths.artifactDir)) return '';
  const parts = path.relative(paths.artifactDir, filePath).split(path.sep);
  const runsIndex = parts.indexOf('runs');
  if (runsIndex < 0 || parts.length <= runsIndex + 1) return '';
  return path.join(paths.artifactDir, ...parts.slice(0, runsIndex + 2));
}

export async function applyAgentRunEvents(runId, input = {}) {
  const runs = await readJson(paths.runs, []);
  const index = runs.findIndex(item => item.id === runId);
  if (index === -1) return null;
  const existing = runs[index];
  const events = Array.isArray(input.events) ? input.events.map(normalizeAgentRunEvent).filter(Boolean) : [];
  const knownIds = new Set(Array.isArray(existing.workerEventIds) ? existing.workerEventIds.map(cleanString).filter(Boolean) : []);
  const newEvents = events.filter(event => event.id && !knownIds.has(event.id));
  if (!newEvents.length) return hydrateRunStages(existing);

  let next = { ...existing };
  let logChunks = [];
  for (const event of newEvents) {
    knownIds.add(event.id);
    if (event.type === 'log') {
      if (event.chunk) logChunks.push(event.chunk);
      continue;
    }
    if (event.type === 'status') {
      next = mergeAgentRunStatusEvent(next, event);
      continue;
    }
    if (event.type === 'stage') {
      next = mergeAgentRunStageEvent(next, event);
      continue;
    }
  }
  const now = new Date().toISOString();
  for (const chunk of logChunks) await appendRunLog(runId, chunk);
  if (logChunks.length) await ensureRunLogPath(runId);
  next = normalizeActiveLocalWorkerRun(next, next.status || next.workerStatus);
  const hasRunEventMaterial = hasWorkerRunMaterialChange(existing, next);
  const nextEventIds = hasRunEventMaterial ? [...knownIds].slice(-500) : (Array.isArray(existing.workerEventIds) ? existing.workerEventIds : []);
  const eventIdsChanged = stableWorkerRunValue(existing.workerEventIds || []) !== stableWorkerRunValue(nextEventIds);
  if (!hasRunEventMaterial && !eventIdsChanged) {
    const hydrated = await hydrateRunStages(existing);
    return {
      ...hydrated,
      _changed: false
    };
  }
  next = {
    ...next,
    workerEventIds: nextEventIds,
    ...(isFinalWorkerRunStatus(next.status || next.workerStatus) ? { localWorkerStale: false, localWorkerStaleDetectedAt: '' } : {}),
    updatedAt: hasRunEventMaterial ? now : existing.updatedAt
  };
  runs[index] = next;
  await writeJson(paths.runs, runs);
  const hydrated = await hydrateRunStages(next);
  return {
    ...hydrated,
    _changed: hasRunEventMaterial
  };
}

export async function listMissingRunIds(runIds = []) {
  const ids = normalizeLineList(runIds);
  if (!ids.length) return [];
  const existingIds = new Set((await readJson(paths.runs, [])).map(run => cleanString(run.id)).filter(Boolean));
  return ids.filter(id => !existingIds.has(id));
}

export async function cloneRunForRetry(id, overrides = {}) {
  const source = await getRun(id);
  if (!source) return null;
  const retryCustomStages = normalizeRetryCustomStages(overrides.customStages || source.stages);
  const safeOverrides = { ...overrides };
  delete safeOverrides.customStages;
  return createRun({
    taskId: source.taskId,
    projectId: source.projectId,
    title: source.title,
    workflow: source.workflow,
    workflowLevel: source.workflowLevel,
    customWorkflowId: source.customWorkflowId,
    customWorkflowName: source.customWorkflowName,
    customWorkflowDescription: source.customWorkflowDescription,
    customStages: retryCustomStages,
    stage: source.stage,
    targetPage: source.targetPage,
    zentaoId: source.zentaoId,
    developer: source.developer,
    agentModel: source.agentModel,
    figmaLinks: source.figmaLinks,
    attachments: source.attachments,
    showdocHints: source.showdocHints,
    selectedMaterialHints: source.selectedMaterialHints,
    selectedMaterialSnapshots: source.selectedMaterialSnapshots,
    productName: source.productName,
    sourceTitle: source.sourceTitle,
    primarySkillPath: source.primarySkillPath,
    primarySkillTitle: source.primarySkillTitle,
    primarySkillContent: source.primarySkillContent,
    figmaWriteMode: source.figmaWriteMode,
    imageGenerationProviderMode: source.imageGenerationProviderMode,
    requirement: source.requirement,
    sourceType: source.sourceType,
    executionMode: source.executionMode,
    createTaskForRun: Boolean(source.taskId),
    codexRequest: normalizeRunCodexRequest(overrides.codexRequest || source.codexRequest),
    ...safeOverrides,
    customStages: retryCustomStages
  });
}

function normalizeRetryCustomStages(stages = []) {
  if (!Array.isArray(stages)) return [];
  return stages.map((stage, index) => ({
    no: index + 1,
    id: stage.id || stage.skillId || stage.name || `stage-${index + 1}`,
    name: stage.name || stage.skillId || `自定义阶段 ${index + 1}`,
    skillId: stage.skillId || '',
    required: stage.required,
    skippable: stage.skippable,
    artifactDir: stage.artifactDir || stage.skillId || stage.id || stage.name || `custom-stage-${index + 1}`,
    description: stage.description || '',
    doneCriteria: stage.doneCriteria || '',
    status: 'pending'
  })).filter(stage => String(stage.name || '').trim());
}

export async function updateRun(id, patch) {
  const runs = await readJson(paths.runs, []);
  const index = runs.findIndex(item => item.id === id);
  if (index === -1) return null;
  runs[index] = { ...runs[index], ...patch, updatedAt: new Date().toISOString() };
  await writeJson(paths.runs, runs);
  return runs[index];
}

export async function queueRunForLocalWorker(id, input = {}) {
  const runs = await readJson(paths.runs, []);
  const index = runs.findIndex(item => item.id === id);
  if (index === -1) return null;
  const now = new Date().toISOString();
  const existing = ensureRunArtifactRootFromExistingFiles(await ensureRunMaterialSnapshotsForQueue(runs[index]));
  const queuedForUserId = cleanString(input.queuedForUserId || input.userId || existing.queuedForUserId || existing.assignedToUserId || existing.ownerUserId);
  const queuedForName = cleanString(input.queuedForName || input.userName || existing.queuedForName || existing.assignedToName || existing.developer);
  const materialSnapshot = await readRunMaterialSnapshot(existing);
  runs[index] = {
    ...existing,
    status: 'queued',
    workerStatus: 'queued',
    executionHost: 'local-worker',
    workerExecution: true,
    queuedForUserId,
    queuedForName,
    queuedAt: now,
    assignedToUserId: queuedForUserId || existing.assignedToUserId || existing.ownerUserId || '',
    assignedToName: queuedForName || existing.assignedToName || existing.developer || '',
    claimedByDeviceId: '',
    claimedAt: '',
    startedBy: queuedForUserId || existing.startedBy || '',
    startedAt: '',
    finishedAt: '',
    completedAt: '',
    startMode: input.startMode || existing.startMode || 'start',
    currentStage: '正在启动本机执行',
    primarySkillContent: existing.primarySkillContent || materialSnapshot,
    blocker: null,
    resultSummary: null,
    workerResult: null,
    figmaWriteResult: null,
    strictCheck: null,
    exitCode: null,
    pid: null,
    workerLocalLogPath: '',
    workerLocalLogSize: 0,
    logPath: '',
    promptPath: '',
    artifactRoot: existing.artifactRoot || '',
    stages: [],
    updatedAt: now
  };
  await writeJson(paths.runs, runs);
  return hydrateRunStages(runs[index]);
}

async function ensureRunMaterialSnapshotsForQueue(run = {}) {
  if (run.sourceType === 'bug' || run.workflow === 'bug-fix') return run;
  const hints = normalizeLineList(run.selectedMaterialHints);
  if (!hints.length && normalizeRunMaterialSnapshots(run.selectedMaterialSnapshots).length) return run;
  const projects = await readJson(paths.projects, []);
  const project = projects.find(item => cleanString(item.id) === cleanString(run.projectId));
  const rootPath = cleanString(project?.rootPath);
  if (!rootPath) return run;
  const existingSnapshots = normalizeRunMaterialSnapshots(run.selectedMaterialSnapshots);
  const snapshots = [...existingSnapshots];
  const snapshotKeys = new Set(snapshots.map(item => normalizeMaterialSnapshotPath(item.path || item.sourceValue)).filter(Boolean));
  const queue = hints.length ? hints : normalizeLineList([run.primarySkillPath, run.stage, run.showdocHints]);
  for (let index = 0; index < queue.length; index += 1) {
    const rawPath = queue[index];
    const relativePath = normalizeKnownMaterialDependencyPath(rawPath);
    if (!relativePath || snapshotKeys.has(relativePath)) continue;
    const snapshot = await readProjectMaterialSnapshot(rootPath, relativePath);
    if (!snapshot) continue;
    snapshots.push(snapshot);
    snapshotKeys.add(relativePath);
    for (const dependency of materialDependenciesFromContent(relativePath, snapshot.content)) {
      const dependencyPath = normalizeKnownMaterialDependencyPath(dependency, path.posix.dirname(relativePath));
      if (dependencyPath && !snapshotKeys.has(dependencyPath) && !queue.includes(dependencyPath)) queue.push(dependencyPath);
    }
  }
  if (!snapshots.length || snapshots.length === existingSnapshots.length) return run;
  const primary = snapshots[0] || {};
  return {
    ...run,
    selectedMaterialSnapshots: snapshots,
    primarySkillPath: run.primarySkillPath || primary.path || '',
    primarySkillTitle: run.primarySkillTitle || primary.title || '',
    primarySkillContent: run.primarySkillContent || primary.content || '',
    showdocHints: run.showdocHints || hints.join('\n')
  };
}

async function readProjectMaterialSnapshot(rootPath = '', relativePath = '') {
  const safePath = normalizeMaterialSnapshotPath(relativePath);
  if (!safePath) return null;
  const abs = path.resolve(rootPath, safePath);
  const root = path.resolve(rootPath);
  if (!abs.startsWith(`${root}${path.sep}`) && abs !== root) return null;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    const content = String(await fs.readFile(abs, 'utf8')).trim();
    if (!content) return null;
    return {
      path: safePath,
      sourceValue: safePath,
      title: materialTitleFromPath(safePath),
      kind: /(?:^|\/)SKILL\.md$/i.test(safePath) ? 'skill' : 'document',
      content: content.slice(0, 60000)
    };
  } catch {
    return null;
  }
}

function materialDependenciesFromContent(relativePath = '', content = '') {
  const sourceDir = path.posix.dirname(normalizeMaterialSnapshotPath(relativePath));
  const text = String(content || '');
  const dependencies = [];
  if (/ui-finalize/i.test(relativePath) || /界面收尾/.test(text)) {
    dependencies.push(
      'skills/figma-layer-cleanup/SKILL.md',
      'skills/平台交互规范skill/SKILL.md',
      'skills/平台交互规范skill/references/平台交互规范2.0.md',
      'skills/界面架构与命名规范.md'
    );
  }
  if (/平台交互规范skill|platform-interaction-spec/i.test(text)) {
    dependencies.push('skills/平台交互规范skill/references/平台交互规范2.0.md');
  }
  const pattern = /(?:^|[\s"'`：:，,。；;（(【\[])([^"'`，,。；;）)\]】\s]+(?:SKILL\.md|README\.md|\.md|\.markdown))/gi;
  let match = pattern.exec(text);
  while (match) {
    const dependency = normalizeKnownMaterialDependencyPath(match[1], sourceDir);
    if (dependency && shouldIncludeMaterialDependency(dependency)) dependencies.push(dependency);
    match = pattern.exec(text);
  }
  return normalizeLineList(dependencies);
}

function shouldIncludeMaterialDependency(relativePath = '') {
  const text = normalizeMaterialSnapshotPath(relativePath);
  if (!text || text === 'SKILL.md' || text === 'README.md') return false;
  return /^skills\/.+\.(?:md|markdown)$/i.test(text);
}

function normalizeKnownMaterialDependencyPath(value = '', sourceDir = '') {
  let text = normalizeMaterialSnapshotPath(value)
    .replace(/^.*?UIdesign\/skills\//i, 'skills/')
    .replace(/^.*?\.codex\/skills\//i, 'skills/');
  if (!text) return '';
  text = text.replace(/^\[+/, '').replace(/\]+$/, '');
  if (/^(?:skills\/)?platform-interaction-spec\/SKILL\.md$/i.test(text)) text = 'skills/平台交互规范skill/SKILL.md';
  if (/^(?:skills\/)?命名规范MD\.md$/i.test(text)) text = 'skills/界面架构与命名规范.md';
  if (/^references\//i.test(text) && sourceDir) {
    const skillRoot = /\/references$/i.test(sourceDir)
      ? sourceDir.replace(/\/references$/i, '')
      : sourceDir;
    text = `${skillRoot}/${text}`;
  }
  if (!/^skills\//i.test(text) && /^(figma-layer-cleanup|平台交互规范skill|ui-finalize|弹窗缩放清洗规则)\/SKILL\.md$/i.test(text)) {
    text = `skills/${text}`;
  }
  return normalizeMaterialSnapshotPath(text);
}

function normalizeMaterialSnapshotPath(value = '') {
  const text = cleanString(value)
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(/^\/+/, '');
  if (!text || text.includes('\0')) return '';
  const normalized = path.posix.normalize(text);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return '';
  return normalized;
}

function materialTitleFromPath(relativePath = '') {
  const parts = normalizeMaterialSnapshotPath(relativePath).split('/').filter(Boolean);
  const fileName = parts.at(-1) || '';
  if (/^(SKILL|README)\.md$/i.test(fileName) && parts.length > 1) return parts.at(-2) || fileName;
  return fileName.replace(/\.(?:md|markdown)$/i, '') || fileName || relativePath;
}

async function readRunMaterialSnapshot(run = {}) {
  const candidates = [run.materialPath, run.promptPath].map(cleanString).filter(Boolean);
  for (const file of candidates) {
    try {
      const text = await fs.readFile(file, 'utf8');
      if (text.trim()) return text.slice(0, 60000);
    } catch {
    }
  }
  return '';
}

export async function listArtProgressEvents(filters = {}) {
  const events = await readJson(paths.artProgressEvents, []);
  return mergeArtProgressEvents(events)
    .map(normalizeArtProgressEvent)
    .filter(event => !filters.projectId || event.projectId === filters.projectId)
    .filter(event => !filters.runId || event.runId === filters.runId)
    .filter(event => !filters.taskNo || event.taskNo === String(filters.taskNo))
    .filter(event => !filters.zentaoTaskId || event.zentaoTaskId === String(filters.zentaoTaskId))
    .filter(event => !filters.memberAccount || event.memberAccount === String(filters.memberAccount))
    .filter(event => !filters.skillId || event.skillId === String(filters.skillId))
    .filter(event => !filters.eventType || event.eventType === String(filters.eventType))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function createArtProgressEvent(input = {}) {
  const event = normalizeArtProgressEvent(input);
  const events = await readJson(paths.artProgressEvents, []);
  const eventKey = artProgressEventMergeKey(event);
  const index = events.findIndex(item => item.id === event.id || (eventKey && artProgressEventMergeKey(item) === eventKey));
  if (index >= 0) events[index] = preferLatestArtProgressEvent(events[index], event);
  else events.push(event);
  await writeJson(paths.artProgressEvents, events);
  return index >= 0 ? events[index] : event;
}

export async function updateArtProgressEvent(id, patch = {}) {
  const events = await readJson(paths.artProgressEvents, []);
  const index = events.findIndex(item => String(item.id) === String(id));
  if (index === -1) return null;
  const next = normalizeArtProgressEvent({
    ...events[index],
    ...patch,
    id: events[index].id,
    createdAt: events[index].createdAt,
    updatedAt: new Date().toISOString()
  });
  events[index] = next;
  await writeJson(paths.artProgressEvents, events);
  return next;
}

export async function deleteArtProgressEvent(id) {
  const events = await readJson(paths.artProgressEvents, []);
  const index = events.findIndex(item => String(item.id) === String(id));
  if (index === -1) return null;
  const [event] = events.splice(index, 1);
  await writeJson(paths.artProgressEvents, events);
  return normalizeArtProgressEvent(event);
}

export async function deleteRun(id) {
  const runs = await readJson(paths.runs, []);
  const index = runs.findIndex(item => item.id === id);
  if (index === -1) return null;
  const [run] = runs.splice(index, 1);
  await writeJson(paths.runs, runs);
  await removeDirectoryIfSafe(getRunWorkspace(id), workspaceDir);
  if (run.artifactRoot) await removeDirectoryIfSafe(run.artifactRoot, paths.artifactDir);
  return run;
}

export async function deleteRunsByFilters(filters = {}) {
  const runs = await readJson(paths.runs, []);
  const { deleted, remaining } = splitRunsByArchiveDeleteFilters(runs, filters);
  if (!deleted.length) return { deleted: [], remaining: runs };
  await writeJson(paths.runs, remaining);
  for (const run of deleted) {
    await removeDirectoryIfSafe(getRunWorkspace(run.id), workspaceDir);
    if (run.artifactRoot) await removeDirectoryIfSafe(run.artifactRoot, paths.artifactDir);
  }
  return { deleted, remaining };
}

export async function previewRunsDeletionByFilters(filters = {}) {
  validateRunMaintenanceFilters(filters);
  const runs = await readJson(paths.runs, []);
  const { deleted } = splitRunsByArchiveDeleteFilters(runs, filters);
  let estimatedBytes = 0;
  const directories = [];
  for (const run of deleted) {
    estimatedBytes += Buffer.byteLength(JSON.stringify(run), 'utf8') + 2;
    const workspacePath = getRunWorkspace(run.id);
    const workspaceSize = await directorySize(workspacePath);
    if (workspaceSize > 0) {
      estimatedBytes += workspaceSize;
      directories.push({ path: workspacePath, bytes: workspaceSize, type: 'workspace' });
    }
    if (run.artifactRoot) {
      const artifactSize = await directorySize(run.artifactRoot);
      if (artifactSize > 0) {
        estimatedBytes += artifactSize;
        directories.push({ path: run.artifactRoot, bytes: artifactSize, type: 'artifact' });
      }
    }
  }
  return {
    matchedCount: deleted.length,
    estimatedBytes,
    directories,
    sample: deleted.slice(0, 8).map(run => ({
      id: run.id,
      title: run.title,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      developer: run.developer,
      assignedToName: run.assignedToName
    }))
  };
}

export async function maintenanceOverview() {
  const [
    operationLogs,
    runs,
    tasks,
    artBriefs,
    artProgressEvents,
    usageCounters,
    safePreview,
    summaryPreview,
    dataSize,
    workspaceSize,
    artifactSize,
    outputsSize,
    artBriefOutputsSize,
    logsSize,
    operationLogsSize,
    runsFileSize,
    tasksFileSize,
    artBriefsFileSize,
    artProgressEventsFileSize,
    usageCountersFileSize
  ] = await Promise.all([
    readJson(paths.operationLogs, []),
    readJson(paths.runs, []),
    readJson(paths.tasks, []),
    readJson(paths.artBriefs, []),
    readJson(paths.artProgressEvents, []),
    readJson(paths.usageCounters, {}),
    previewSafeMaintenanceCleanup(),
    previewArtBriefOutputDeletion({}),
    directorySize(paths.dataDir),
    directorySize(paths.workspaceDir),
    directorySize(paths.artifactDir),
    directorySize(path.join(paths.root, 'outputs')),
    directorySize(path.join(paths.root, 'outputs', 'art-briefs')),
    directorySize(path.join(paths.root, 'logs')),
    fileSize(paths.operationLogs),
    fileSize(paths.runs),
    fileSize(paths.tasks),
    fileSize(paths.artBriefs),
    fileSize(paths.artProgressEvents),
    fileSize(paths.usageCounters)
  ]);
  return {
    generatedAt: new Date().toISOString(),
    storage: [
      { key: 'safeCleanup', label: '安全维护可清理项', path: paths.root, bytes: safePreview.estimatedBytes || 0, count: safePreview.matchedCount || 0, protected: false, cleanupLevel: 'safe', cleanupLevelLabel: '可以直接删，不影响工作台', maintenanceType: 'safe-clean', cleanupActionLabel: '删除这些垃圾数据', cleanupActionHint: '可以直接清理：只删系统垃圾，不影响任务、模板、执行历史、AI档案和统计。', fileActionLabel: '打开项目根目录', actionLabel: '定位安全清理', note: '删的是系统垃圾：.DS_Store、过期临时 JSON、已经没有执行记录对应的空工作区；不会影响任务、模板、AI档案和统计。' },
      { key: 'data', label: '平台业务数据 data', path: paths.dataDir, bytes: dataSize, protected: true, cleanupLevel: 'protected', cleanupLevelLabel: '不要删，会影响功能', fileActionLabel: '打开 data 目录', actionLabel: '仅查看体量', note: '这里放账号、任务、缓存、调用次数和看板状态；手动删目录会让工作台数据缺失或统计不准。' },
      { key: 'workspace', label: '执行工作区 workspace', path: paths.workspaceDir, bytes: workspaceSize, protected: true, cleanupLevel: 'caution', cleanupLevelLabel: '慎重删，会少历史材料', maintenanceType: 'runs', cleanupActionLabel: '按范围删除执行历史', cleanupActionHint: '推荐范围删除：先选时间、状态或执行人，只删确认不用追查的旧执行；不会删除任务中心任务。', route: '/ai-archive', fileActionLabel: '打开 workspace', actionLabel: '查看 AI档案', note: '这里是执行过程材料和本机工作区；删了不会删除任务中心任务，但会让对应执行过程材料以后看不到。' },
      { key: 'artifacts', label: '执行产物归档 workspace/artifacts', path: paths.artifactDir, bytes: artifactSize, protected: true, cleanupLevel: 'caution', cleanupLevelLabel: '慎重删，会少产物证据', maintenanceType: 'runs', cleanupActionLabel: '按范围删除执行产物', cleanupActionHint: '推荐范围删除：必须跟执行记录一起预览删除；不会删任务，但会少执行结果证据。', route: '/ai-archive', fileActionLabel: '打开产物归档', actionLabel: '查看 AI档案', note: '这里是美术执行台和 AI档案会查看的归档产物；删了不影响任务本身，但以后可能看不到执行结果证据。' },
      { key: 'artBriefOutputs', label: '美术摘要 outputs/art-briefs', path: path.join(paths.root, 'outputs', 'art-briefs'), bytes: artBriefOutputsSize, protected: false, cleanupLevel: 'range', cleanupLevelLabel: '能删，但要先选范围', maintenanceType: 'art-briefs', cleanupActionLabel: '按范围删除摘要文件', cleanupActionHint: '推荐范围删除：按任务号、关键词或时间预览后再删；不会影响禅道任务和任务量级，但对应摘要以后看不到。', fileActionLabel: '打开摘要目录', actionLabel: '定位摘要清理', note: '这里是任务中心生成的摘要 HTML 和 AI 工作说明；删了不影响禅道任务、任务中心任务和量级，但对应摘要文件以后看不到。' },
      { key: 'outputs', label: '输出目录 outputs', path: path.join(paths.root, 'outputs'), bytes: outputsSize, protected: true, cleanupLevel: 'caution', cleanupLevelLabel: '慎重删，别删整个目录', maintenanceType: 'art-briefs', cleanupActionLabel: '按范围删除摘要产物', cleanupActionHint: '推荐范围删除：只允许删 outputs/art-briefs 的摘要范围，不会删除整个 outputs。', fileActionLabel: '打开 outputs', actionLabel: '定位摘要清理', note: '这里可能混有正式输出和业务产物；不要手动删整个 outputs，只能在维护中心按明确业务类型清理。' },
      { key: 'logs', label: '运行日志 logs', path: path.join(paths.root, 'logs'), bytes: logsSize, protected: false, cleanupLevel: 'range', cleanupLevelLabel: '能删，但排障后再删', route: '/operation-logs', fileActionLabel: '打开 logs', actionLabel: '查看操作日志', note: '这里主要用于排查问题；删了不会影响工作台业务数据，但会少本机排障线索。日志文件建议排障结束后归档或截断。' }
    ],
    records: [
      { key: 'operationLogs', label: '操作日志', count: Array.isArray(operationLogs) ? operationLogs.length : 0, bytes: operationLogsSize, file: paths.operationLogs, cleanupLevel: 'range', cleanupLevelLabel: '能删旧日志，不影响任务', maintenanceType: 'operation-logs', cleanupActionLabel: '按范围删除旧日志', cleanupActionHint: '推荐范围删除：先选开始和结束时间；不会影响执行模板、任务量级、新建执行任务和 AI 调用统计。', route: '/operation-logs', fileActionLabel: '打开日志文件目录', actionLabel: '查看日志', note: '删了只是少一段操作审计记录；不会影响执行模板、任务量级、新建执行任务，也不会扣减 AI 产物调用次数。' },
      { key: 'runs', label: '执行记录 / AI档案', count: Array.isArray(runs) ? runs.length : 0, bytes: runsFileSize, file: paths.runs, cleanupLevel: 'caution', cleanupLevelLabel: '慎重删，会少执行历史', maintenanceType: 'runs', cleanupActionLabel: '按范围删除执行记录', cleanupActionHint: '推荐范围删除：先按时间、状态、执行人预览；不会删除任务中心任务，但会少这段执行历史和产物证据。', route: '/ai-archive', fileActionLabel: '打开 runs 文件目录', actionLabel: '查看 AI档案', note: '删了会移除非运行中的执行档案、工作区和产物归档；不会删任务中心任务，但以后可能查不到这次执行过程。' },
      { key: 'tasks', label: '任务中心记录', count: Array.isArray(tasks) ? tasks.length : 0, bytes: tasksFileSize, file: paths.tasks, protected: true, cleanupLevel: 'protected', cleanupLevelLabel: '不要删，会影响任务', route: '/tasks', fileActionLabel: '打开任务数据目录', actionLabel: '查看任务中心', note: '这里是任务大厅正在使用的业务数据；维护中心不提供范围删除，避免影响指派、量级和任务状态。' },
      { key: 'artBriefs', label: '美术摘要索引', count: Array.isArray(artBriefs) ? artBriefs.length : 0, bytes: artBriefsFileSize, file: paths.artBriefs, cleanupLevel: 'range', cleanupLevelLabel: '能删，但要连文件一起删', maintenanceType: 'art-briefs', cleanupActionLabel: '按范围删除摘要索引', cleanupActionHint: '推荐范围删除：索引必须和摘要文件一起删；不会影响任务和禅道，但对应摘要列表记录会消失。', fileActionLabel: '打开索引文件目录', actionLabel: '定位摘要清理', note: '这是摘要列表索引；必须和 outputs/art-briefs 命中的摘要目录同步删。删了不影响任务中心和禅道，但对应摘要入口会消失。' },
      { key: 'artProgressEvents', label: '研究同步记录', count: Array.isArray(artProgressEvents) ? artProgressEvents.length : 0, bytes: artProgressEventsFileSize, file: paths.artProgressEvents, protected: true, cleanupLevel: 'caution', cleanupLevelLabel: '慎重删，会少沉淀记录', route: '/skills/events', fileActionLabel: '打开研究同步数据目录', actionLabel: '查看研究同步', note: '这里关联 AI 产物研究沉淀和同步记录；当前不放进维护中心硬删除，避免误删团队复盘资料。' },
      { key: 'usageCounters', label: '累计调用指标桶', count: usageCounters && typeof usageCounters === 'object' ? Object.keys(usageCounters.buckets || usageCounters).length : 0, bytes: usageCountersFileSize, file: paths.usageCounters, protected: true, cleanupLevel: 'protected', cleanupLevelLabel: '不要删，会影响统计', fileActionLabel: '打开指标文件目录', actionLabel: '仅查看体量', note: '这是 AI 产物累计调用次数的事实来源；无论删除什么明细，都不能回退、清零或重算这里。' }
    ],
    safeCleanup: safePreview,
    artBriefOutputs: summaryPreview
  };
}

export async function previewMaintenanceAction(input = {}) {
  const type = cleanString(input.type);
  const filters = input.filters && typeof input.filters === 'object' ? input.filters : {};
  if (type === 'safe-clean') return { type, ...(await previewSafeMaintenanceCleanup()) };
  if (type === 'operation-logs') {
    validateOperationLogMaintenanceFilters(filters);
    return { type, ...(await previewOperationLogDeletion(filters)) };
  }
  if (type === 'runs') return { type, ...(await previewRunsDeletionByFilters(filters)) };
  if (type === 'art-briefs') {
    validateArtBriefMaintenanceFilters(filters);
    return { type, ...(await previewArtBriefOutputDeletion(filters)) };
  }
  const error = new Error('不支持的维护类型。');
  error.status = 400;
  throw error;
}

export async function applyMaintenanceAction(input = {}) {
  const type = cleanString(input.type);
  const filters = input.filters && typeof input.filters === 'object' ? input.filters : {};
  if (type === 'safe-clean') return { type, ...(await applySafeMaintenanceCleanup()) };
  if (type === 'operation-logs') {
    validateOperationLogMaintenanceFilters(filters);
    return { type, ...(await deleteOperationLogsByFilters(filters)) };
  }
  if (type === 'runs') {
    validateRunMaintenanceFilters(filters);
    const result = await deleteRunsByFilters(filters);
    return { type, deletedCount: result.deleted.length, deletedIds: result.deleted.map(run => run.id), deleted: result.deleted };
  }
  if (type === 'art-briefs') return { type, ...(await deleteArtBriefOutputsByFilters(filters)) };
  const error = new Error('不支持的维护类型。');
  error.status = 400;
  throw error;
}

export async function previewSafeMaintenanceCleanup() {
  const items = [
    ...await findDsStoreFiles(paths.root),
    ...await findStaleJsonTmpFiles(paths.dataDir),
    ...await findOrphanRunWorkspaces()
  ];
  return {
    matchedCount: items.length,
    estimatedBytes: items.reduce((total, item) => total + Number(item.bytes || 0), 0),
    items
  };
}

export async function applySafeMaintenanceCleanup() {
  const preview = await previewSafeMaintenanceCleanup();
  const deleted = [];
  const skipped = [];
  for (const item of preview.items) {
    try {
      if (item.kind === 'orphan-run-workspace') await removeDirectoryIfSafe(item.path, paths.workspaceDir);
      else if (['ds-store', 'json-tmp'].includes(item.kind)) await fs.unlink(item.path);
      else {
        skipped.push({ ...item, reason: '未知安全清理类型。' });
        continue;
      }
      deleted.push(item);
    } catch (error) {
      skipped.push({ ...item, reason: error.message || '清理失败。' });
    }
  }
  return {
    matchedCount: preview.matchedCount,
    deletedCount: deleted.length,
    skippedCount: skipped.length,
    estimatedBytes: preview.estimatedBytes,
    releasedBytes: deleted.reduce((total, item) => total + Number(item.bytes || 0), 0),
    deleted,
    skipped
  };
}

export async function previewArtBriefOutputDeletion(filters = {}) {
  const candidates = await artBriefOutputCandidates(filters);
  return {
    matchedCount: candidates.length,
    estimatedBytes: candidates.reduce((total, item) => total + Number(item.bytes || 0), 0),
    items: candidates.slice(0, 20)
  };
}

export async function deleteArtBriefOutputsByFilters(filters = {}) {
  validateArtBriefMaintenanceFilters(filters);
  const candidates = await artBriefOutputCandidates(filters);
  const outputDirs = new Set(candidates.map(item => item.outputDir).filter(Boolean));
  const deleted = [];
  const skipped = [];
  for (const item of candidates) {
    try {
      await removeDirectoryIfSafe(item.outputDir, path.join(paths.root, 'outputs', 'art-briefs'));
      deleted.push(item);
    } catch (error) {
      skipped.push({ ...item, reason: error.message || '摘要目录删除失败。' });
    }
  }

  const records = await readJson(paths.artBriefs, []);
  const nextRecords = (Array.isArray(records) ? records : []).filter(record => {
    const enriched = artBriefRecordOutputIdentity(record);
    if (enriched.outputDir && outputDirs.has(enriched.outputDir)) return false;
    if (enriched.reportDir && outputDirs.has(enriched.reportDir)) return false;
    return true;
  });
  if (nextRecords.length !== (Array.isArray(records) ? records : []).length) {
    await writeJson(paths.artBriefs, nextRecords.map(normalizeArtBriefRecord));
  }
  await rebuildArtBriefSummaryIndex();

  return {
    matchedCount: candidates.length,
    deletedCount: deleted.length,
    skippedCount: skipped.length,
    removedArtBriefRecords: (Array.isArray(records) ? records.length : 0) - nextRecords.length,
    estimatedBytes: candidates.reduce((total, item) => total + Number(item.bytes || 0), 0),
    releasedBytes: deleted.reduce((total, item) => total + Number(item.bytes || 0), 0),
    deleted,
    skipped
  };
}

export async function listUsersRaw() {
  return readJson(paths.users, []);
}

export async function writeUsersRaw(users = []) {
  return writeJson(paths.users, users);
}

export async function listRolesRaw() {
  return readJson(paths.roles, []);
}

export async function writeRolesRaw(roles = []) {
  return writeJson(paths.roles, roles);
}

export async function listSessionsRaw() {
  return readJson(paths.sessions, []);
}

export async function writeSessionsRaw(sessions = []) {
  return writeJson(paths.sessions, sessions);
}

export function getRunWorkspace(id) {
  return path.join(workspaceDir, id);
}

async function removeDirectoryIfSafe(target, parent) {
  const resolvedTarget = path.resolve(target || '');
  const resolvedParent = path.resolve(parent || '');
  if (!resolvedTarget || resolvedTarget === resolvedParent || !resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) return;
  await fs.rm(resolvedTarget, { recursive: true, force: true });
}

async function findDsStoreFiles(dir) {
  const ignored = new Set(['.git', 'node_modules', 'dist']);
  const results = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) await walk(target);
        continue;
      }
      if (!entry.isFile() || entry.name !== '.DS_Store') continue;
      const stat = await fs.stat(target).catch(() => null);
      if (!stat) continue;
      results.push({
        kind: 'ds-store',
        label: '.DS_Store',
        path: target,
        relativePath: path.relative(paths.root, target),
        bytes: stat.size,
        reason: 'macOS Finder 元数据文件。'
      });
    }
  }
  await walk(dir);
  return results;
}

async function findStaleJsonTmpFiles(dir) {
  const results = [];
  const minAgeMs = Math.max(60_000, Number(process.env.AWP_SAFE_CLEAN_TMP_MIN_AGE_MS || 10 * 60 * 1000));
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^(.+\.json)\.(\d+)\.[0-9a-f-]+\.tmp$/i);
      if (!match) continue;
      const baseFile = path.join(current, match[1]);
      const [tmpStat, baseStat] = await Promise.all([
        fs.stat(target).catch(() => null),
        fs.stat(baseFile).catch(() => null)
      ]);
      if (!tmpStat || !baseStat?.isFile()) continue;
      if (Date.now() - tmpStat.mtimeMs < minAgeMs) continue;
      results.push({
        kind: 'json-tmp',
        label: '过期 JSON 临时文件',
        path: target,
        relativePath: path.relative(paths.root, target),
        bytes: tmpStat.size,
        reason: '原子写入留下的过期临时文件。'
      });
    }
  }
  await walk(dir);
  return results;
}

async function findOrphanRunWorkspaces() {
  const runs = await readJson(paths.runs, []);
  const runIds = new Set((Array.isArray(runs) ? runs : []).map(run => cleanString(run?.id)).filter(Boolean));
  const entries = await fs.readdir(paths.workspaceDir, { withFileTypes: true }).catch(() => []);
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'artifacts') continue;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name)) continue;
    if (runIds.has(entry.name)) continue;
    const target = path.join(paths.workspaceDir, entry.name);
    results.push({
      kind: 'orphan-run-workspace',
      label: '孤儿执行工作区',
      path: target,
      relativePath: path.relative(paths.root, target),
      bytes: await directorySize(target),
      reason: 'runs.json 已不存在的执行工作区目录。'
    });
  }
  return results;
}

async function artBriefOutputCandidates(filters = {}) {
  const artBriefRoot = path.join(paths.root, 'outputs', 'art-briefs');
  const entries = await fs.readdir(artBriefRoot, { withFileTypes: true }).catch(() => []);
  const records = await readJson(paths.artBriefs, []);
  const recordByOutputDir = new Map((Array.isArray(records) ? records : [])
    .map(record => artBriefRecordOutputIdentity(record))
    .filter(record => record.outputDir || record.reportDir)
    .flatMap(record => [
      record.outputDir ? [record.outputDir, record] : null,
      record.reportDir ? [record.reportDir, record] : null
    ].filter(Boolean)));
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const outputDir = path.join(artBriefRoot, entry.name);
    if (entry.name.startsWith('_')) continue;
    const manifest = await readArtBriefManifest(path.join(outputDir, 'summary-manifest.json'));
    const record = recordByOutputDir.get(outputDir) || {};
    const item = {
      outputDir,
      relativePath: path.relative(paths.root, outputDir),
      taskNo: cleanString(manifest.taskId || record.taskNo),
      title: cleanString(manifest.title || record.title || record.groupTitle || entry.name),
      generatedAt: cleanString(manifest.generatedAt || record.generatedAt || record.updatedAt),
      bytes: await directorySize(outputDir),
      manifestPath: path.join(outputDir, 'summary-manifest.json')
    };
    if (artBriefOutputMatchesFilters(item, filters)) candidates.push(item);
  }
  return candidates.sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')));
}

function artBriefOutputMatchesFilters(item = {}, filters = {}) {
  const taskNo = cleanString(filters.taskNo);
  if (taskNo && item.taskNo !== taskNo) return false;
  const keyword = cleanString(filters.keyword).toLowerCase();
  if (keyword) {
    const haystack = [item.taskNo, item.title, item.relativePath].join('\n').toLowerCase();
    if (!haystack.includes(keyword)) return false;
  }
  const from = filters.from ? Date.parse(filters.from) : 0;
  const to = filters.to ? Date.parse(filters.to) : 0;
  if (from || to) {
    const time = Date.parse(item.generatedAt || '');
    if (from && (!time || time < from)) return false;
    if (to && (!time || time > to)) return false;
  }
  return true;
}

function artBriefRecordOutputIdentity(record = {}) {
  const normalized = normalizeArtBriefRecord(record);
  const raw = record.raw && typeof record.raw === 'object' ? record.raw : {};
  const reportFile = cleanString(normalized.reportFile || raw.htmlPath || raw.reportFile);
  const outputDir = cleanString(raw.outputDir || (reportFile ? path.dirname(reportFile) : ''));
  return {
    ...normalized,
    outputDir: outputDir ? path.resolve(outputDir) : '',
    reportDir: reportFile ? path.resolve(path.dirname(reportFile)) : ''
  };
}

async function readArtBriefManifest(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

async function rebuildArtBriefSummaryIndex() {
  const artBriefRoot = path.join(paths.root, 'outputs', 'art-briefs');
  const candidates = await artBriefOutputCandidates({});
  const items = [];
  for (const candidate of candidates) {
    const manifest = await readArtBriefManifest(candidate.manifestPath);
    if (manifest && Object.keys(manifest).length) {
      items.push({ ...manifest, manifestPath: candidate.manifestPath });
    }
  }
  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: items.length,
    items
  };
  await fs.mkdir(artBriefRoot, { recursive: true });
  await fs.writeFile(path.join(artBriefRoot, 'summary-index.json'), `${JSON.stringify(index, null, 2)}\n`);
}

async function directorySize(dir) {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    total += await directorySize(path.join(dir, entry.name));
  }
  return total;
}

async function fileSize(file) {
  const stat = await fs.stat(file).catch(() => null);
  return stat?.isFile() ? stat.size : 0;
}

export async function appendRunLog(runId, chunk) {
  const file = path.join(getRunWorkspace(runId), 'run.log');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, chunk);
  return file;
}

export async function ensureRunLogPath(runId) {
  const runs = await readJson(paths.runs, []);
  const index = runs.findIndex(item => item.id === runId);
  if (index === -1) return '';
  const file = path.join(getRunWorkspace(runId), 'run.log');
  if (runs[index].logPath === file) return file;
  runs[index] = {
    ...runs[index],
    logPath: file,
    updatedAt: new Date().toISOString()
  };
  await writeJson(paths.runs, runs);
  return file;
}

export function buildStages(workflow, requestedStage = '', workflowLevel = '') {
  return stagesForWorkflow(workflow, requestedStage, workflowLevel);
}

async function resolveCustomWorkflowForRun(input = {}) {
  if (Array.isArray(input.customStages) && input.customStages.length) {
    return {
      id: input.customWorkflowId || '',
      name: input.customWorkflowName || '临时自定义流程',
      description: input.customWorkflowDescription || '',
      stages: normalizeCustomStages(input.customStages)
    };
  }
  if (input.customWorkflowId) {
    const workflow = await getCustomWorkflow(input.customWorkflowId);
    if (workflow) return workflow;
  }
  throw new Error('custom workflow requires customWorkflowId or customStages');
}

async function prepareInitialRunArtifacts(project, run, task) {
  await fs.mkdir(run.artifactRoot, { recursive: true });
  await fs.writeFile(run.materialPath, await buildRunMaterial(project, run, task));
}

async function saveRunAttachments(run = {}, input = []) {
  const items = Array.isArray(input) ? input.slice(0, 6) : [];
  if (!items.length || !run.artifactRoot) return [];
  const dir = path.join(run.artifactRoot, '执行附件');
  await fs.mkdir(dir, { recursive: true });
  const saved = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const parsed = parseRunAttachmentDataUrl(item.dataUrl || '');
    const sourcePath = parsed ? '' : resolveRunAttachmentSourcePath(item.path || item.relativePath || '');
    const sourceStat = sourcePath ? await fs.stat(sourcePath).catch(() => null) : null;
    const sourceExt = sourcePath ? path.extname(sourcePath).replace(/^\./, '').toLowerCase().replace('jpeg', 'jpg') : '';
    const ext = parsed ? runAttachmentExt(parsed.mime) : sourceExt;
    const mime = parsed?.mime || runAttachmentMimeFromExt(ext);
    const size = parsed?.buffer?.length || Number(sourceStat?.size || 0);
    if (!ext || !mime || !['png', 'jpg', 'webp', 'gif'].includes(ext) || size <= 0 || size > 8 * 1024 * 1024) continue;
    const title = cleanString(item.name || `粘贴截图-${index + 1}.${ext}`) || `粘贴截图-${index + 1}.${ext}`;
    const baseName = safePathSegment(title.replace(/\.[^.]+$/, '')) || `attachment-${index + 1}`;
    const fileName = `${String(index + 1).padStart(2, '0')}-${baseName}.${ext}`;
    const filePath = path.join(dir, fileName);
    if (parsed) await fs.writeFile(filePath, parsed.buffer);
    else await fs.copyFile(sourcePath, filePath);
    saved.push({
      id: cleanString(item.id) || randomUUID(),
      name: title,
      type: mime,
      size,
      path: filePath,
      relativePath: path.relative(paths.root, filePath).replaceAll(path.sep, '/'),
      role: 'reference-or-instruction',
      source: 'run-create-paste',
      createdAt: run.createdAt || new Date().toISOString()
    });
  }
  return saved;
}

async function saveGeneratedRunArtifacts(run = {}, input = []) {
  const items = Array.isArray(input) ? input.slice(0, 12) : [];
  if (!items.length || !run.artifactRoot) return [];
  const dir = path.join(run.artifactRoot, '生成图片');
  await fs.mkdir(dir, { recursive: true });
  const saved = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const parsed = parseRunAttachmentDataUrl(item.dataUrl || '');
    const sourcePath = parsed ? '' : resolveRunGeneratedArtifactSourcePath(item.path || item.relativePath || '');
    const sourceStat = sourcePath ? await fs.stat(sourcePath).catch(() => null) : null;
    const sourceExt = sourcePath ? path.extname(sourcePath).replace(/^\./, '').toLowerCase().replace('jpeg', 'jpg') : '';
    const ext = parsed ? runAttachmentExt(parsed.mime) : sourceExt;
    const mime = parsed?.mime || runAttachmentMimeFromExt(ext);
    const size = parsed?.buffer?.length || Number(sourceStat?.size || item.size || 0);
    if (!ext || !mime || !['png', 'jpg', 'webp', 'gif'].includes(ext) || size <= 0 || size > 8 * 1024 * 1024) continue;
    const title = cleanString(item.name || `生成图片-${index + 1}.${ext}`) || `生成图片-${index + 1}.${ext}`;
    const baseName = safePathSegment(title.replace(/\.[^.]+$/, '')) || `generated-${index + 1}`;
    const fileName = `${String(index + 1).padStart(2, '0')}-${baseName}.${ext}`;
    const filePath = await uniqueFilePath(dir, fileName);
    if (parsed) await fs.writeFile(filePath, parsed.buffer);
    else await fs.copyFile(sourcePath, filePath);
    saved.push({
      id: cleanString(item.id) || randomUUID(),
      name: title,
      type: mime,
      size,
      path: filePath,
      relativePath: path.relative(paths.root, filePath).replaceAll(path.sep, '/'),
      role: 'generated-image',
      source: 'local-worker',
      localPath: cleanString(item.path || item.relativePath),
      createdAt: cleanString(item.createdAt) || new Date().toISOString()
    });
  }
  return saved;
}

async function uniqueFilePath(dir = '', fileName = '') {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext) || 'image';
  let target = path.join(dir, fileName);
  for (let index = 2; await fileExists(target); index += 1) {
    target = path.join(dir, `${base}-${index}${ext}`);
  }
  return target;
}

async function fileExists(file = '') {
  if (!file) return false;
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function resolveRunGeneratedArtifactSourcePath(value = '') {
  return resolveRunArtifactSourcePath(value);
}

function dedupeRunArtifacts(input = []) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(input) ? input : []) {
    if (!item) continue;
    const artifact = typeof item === 'object'
      ? item
      : { path: String(item || ''), relativePath: String(item || ''), name: String(item || '').split('/').pop() || String(item || '') };
    const key = cleanString(artifact.relativePath || artifact.path || artifact.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(artifact);
  }
  return result;
}

function resolveRunAttachmentSourcePath(value = '') {
  return resolveRunArtifactSourcePath(value);
}

function resolveRunArtifactSourcePath(value = '') {
  const text = String(value || '').trim();
  if (!text || /^https?:\/\//i.test(text) || text.includes('\0')) return '';
  const normalized = text.replaceAll('\\', '/').replace(/^\/+/, '');
  const abs = path.isAbsolute(text)
    ? path.resolve(text)
    : path.resolve(paths.root, normalized);
  const relativeArtifact = normalized.startsWith('platform-artifacts/')
    ? path.resolve(paths.artifactDir, normalized.replace(/^platform-artifacts\/+/, ''))
    : '';
  const target = relativeArtifact || abs;
  return isPathInsideStore(target, paths.artifactDir) || isPathInsideStore(target, paths.workspaceDir) ? target : '';
}

function isPathInsideStore(target, rootDir) {
  if (!target || !rootDir) return false;
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(rootDir);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseRunAttachmentDataUrl(value = '') {
  const match = String(value || '').match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) return null;
  return { mime, buffer };
}

function runAttachmentExt(mime = '') {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return '';
}

function runAttachmentMimeFromExt(ext = '') {
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return '';
}

async function buildRunMaterial(project = {}, run = {}, task = {}) {
  const isBug = run.sourceType === 'bug' || run.workflow === 'bug-fix';
  const linkedTask = Boolean(run.taskId || task.id);
  const figmaItems = parseLineItems(run.figmaLinks);
  const specSkillItems = parseLineItems(run.showdocHints);
  const materialSnapshots = Array.isArray(run.selectedMaterialSnapshots) ? run.selectedMaterialSnapshots : [];
  const themes = await detectProjectThemes(project);
  const themeStrategy = inferThemeStrategy(project, run, figmaItems, themes);
  const requirementText = String(run.requirement || task.requirement || task.summary || '').trim();
  return [
    '## 最小必填资料',
    '',
    `### ${linkedTask ? '任务来源' : '执行来源'}`,
    '',
    `- 任务中心关联：${run.taskId || task.id ? '已关联' : '未关联，作为独立执行记录追溯'}`,
    `- 禅道 ID / 线索：${run.zentaoId || task.taskNo || '无'}`,
    `- 类型：${isBug ? 'Bug 修复' : '美术执行'}`,
    `- 负责人 / 执行人：${run.developer || task.developer || '待补充'}`,
    '',
    `### ${isBug ? 'Bug 概述' : '需求概述'}`,
    '',
    requirementText || `- ${run.title || task.title || '待补充任务说明'}`,
    '',
    isBug ? buildBugMaterialSection(run) : '',
    '---',
    '',
    '## Figma 设计资料',
    '',
    `- 是否涉及 Figma：${figmaItems.length ? '有' : '待确认'}`,
    `- 多主题策略：${themeStrategy}`,
    `- 设计状态：${figmaItems.length ? '待核对' : '待补充'}`,
    '',
    buildFigmaTable(figmaItems, themeStrategy),
    '',
    '## 规范 md / Skill 线索',
    '',
    `- 是否提供线索：${specSkillItems.length ? '有' : '待确认'}`,
    `- 规范 / Skill 线索：${specSkillItems.length ? '见下表' : '待补充'}`,
    `- 已下发内容快照：${materialSnapshots.length ? `${materialSnapshots.length} 份` : (run.primarySkillContent ? '1 份' : '无')}`,
    '',
    buildSpecSkillTable(specSkillItems),
    '',
    buildMaterialSnapshotTable(materialSnapshots, run),
    '',
    '## 美术执行约束',
    '',
    '| 字段 | 内容 |',
    '| --- | --- |',
    `| 目标项目 | ${project.name || project.id || run.projectId || '待补充'} |`,
    `| 目标页面 / Figma 放置位置 | ${run.targetPage || '待补充'} |`,
    `| 目标端 | ${inferTargetClient(project, run)} |`,
    `| 目标主题 | ${themes.length ? themes.join('、') : '按项目配置确认'} |`,
    '',
    '### 目标主题覆盖矩阵',
    '',
    buildThemeMatrix(themes),
    '',
    '### 执行要点',
    '',
    '- 优先遵循目标项目 AGENTS.md、.agent-hub/config.md、命中的 SKILL.md 和规范 md。',
    '- 涉及 Figma 写入时，必须记录页面、Frame、node-id 或无法写入的原因。',
    '- 涉及多主题或多状态时，需要按影响范围覆盖对应主题、状态和尺寸。',
    '- 无法读取 Figma、规范 md、Skill 或运行环境时，必须在阶段报告中写明失败原因和影响范围。',
    '',
    '## 其他注意事项',
    '',
    '- 不要运行项目禁止的全量 TypeScript 检查或本地构建命令。',
    '- 报告、截图、日志和阶段材料只写入平台侧 artifactRoot。',
    ''
  ].filter(line => line !== null && line !== undefined).join('\n');
}

function buildBugMaterialSection(run = {}) {
  return [
    '### 修复范围',
    '',
    `- 影响页面：${run.targetPage || '待补充'}`,
    '- 复现方式：待补充或按禅道 Bug 描述确认。',
    '- 期望结果：修复当前 Bug，不扩展为完整开发流程。',
    '- 回归重点：复查受影响页面、主题、端、语言和相关入口。',
    ''
  ].join('\n');
}

function buildFigmaTable(items = [], strategy = '待确认') {
  const hasTheme = /按主题/.test(strategy);
  const header = hasTheme
    ? ['| 编号 | 主题 | 页面 / 模块 / 状态 | Figma 链接 / node-id | 关联需求项 | 说明 |', '| --- | --- | --- | --- | --- | --- |']
    : ['| 编号 | 页面 / 模块 / 状态 | Figma 链接 / node-id | 关联需求项 | 说明 |', '| --- | --- | --- | --- | --- |'];
  const rows = items.length ? items.map((item, index) => {
    const no = `F-${String(index + 1).padStart(3, '0')}`;
    return hasTheme
      ? `| ${no} | 待确认 | 待确认 | ${escapeTableCell(item)} |  |  |`
      : `| ${no} | 待确认 | ${escapeTableCell(item)} |  |  |`;
  }) : [
    hasTheme ? '| F-001 | 待确认 | 待确认 | 待补充 |  |  |' : '| F-001 | 待确认 | 待补充 |  |  |'
  ];
  return [...header, ...rows].join('\n');
}

function buildSpecSkillTable(items = []) {
  const rows = items.length ? items.map((item, index) => (
    `| S-${String(index + 1).padStart(3, '0')} | 待确认 | ${escapeTableCell(item)} | 待读取 | 待验证 |  |`
  )) : ['| S-001 | 待确认 | 待补充 | 待读取 | 待验证 |  |'];
  return [
    '| 编号 | 类型 | 规范 md / Skill / 关键词 | 读取状态 | 验证状态 | 说明 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows
  ].join('\n');
}

function buildMaterialSnapshotTable(snapshots = [], run = {}) {
  const items = snapshots.length
    ? snapshots
    : (run.primarySkillContent ? [{
      path: run.primarySkillPath || run.stage || '主执行 Skill / md',
      title: run.primarySkillTitle || run.primarySkillPath || run.stage || '主执行 Skill / md',
      content: run.primarySkillContent
    }] : []);
  const rows = items.length ? items.map((item, index) => {
    const contentLength = String(item.content || '').length;
    return `| C-${String(index + 1).padStart(3, '0')} | ${escapeTableCell(item.title || item.path || item.sourceValue || '未命名')} | ${escapeTableCell(item.path || item.sourceValue || '')} | ${contentLength ? `${contentLength} 字符` : '无'} |`;
  }) : ['| C-001 | 未下发 |  | 无 |'];
  return [
    '### 已下发 Skill / md 内容快照',
    '',
    '| 编号 | 名称 | 本机落地路径 | 内容长度 |',
    '| --- | --- | --- | --- |',
    ...rows
  ].join('\n');
}

function buildThemeMatrix(themes = []) {
  const rows = (themes.length ? themes : ['待确认']).map(theme => `| ${theme} | 待确认 | 待验证 |  |`);
  return [
    '| 主题 | 是否涉及 | 验证状态 | 说明 |',
    '| --- | --- | --- | --- |',
    ...rows
  ].join('\n');
}

function parseLineItems(value = '') {
  return String(value || '')
    .split(/\n|,|，/)
    .map(item => item.trim())
    .filter(Boolean);
}

async function detectProjectThemes(project = {}) {
  if (!project.rootPath) return [];
  try {
    const themeRoot = path.join(project.rootPath, 'src', 'themes');
    const entries = await fs.readdir(themeRoot, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && /^theme_\d+(?:\.\d+)?$/.test(entry.name))
      .map(entry => entry.name)
      .sort(compareThemeName);
  } catch {
    return [];
  }
}

function inferThemeStrategy(project = {}, run = {}, figmaItems = [], themes = []) {
  const text = `${project.name || ''}\n${run.title || ''}\n${run.requirement || ''}\n${figmaItems.join('\n')}`;
  if (/按主题|多主题|theme_\d|Web5|web5/i.test(text) && (themes.length > 1 || figmaItems.length > 1)) return '按主题区分';
  if (figmaItems.length > 1) return '多节点统一设计';
  if (figmaItems.length === 1) return '统一设计';
  return themes.length > 1 ? '按项目多主题范围确认' : '待确认';
}

function inferTargetClient(project = {}, run = {}) {
  const text = `${project.name || ''} ${run.title || ''} ${run.requirement || ''}`;
  if (/Web5|web5|H5|移动端|PC/i.test(text)) return 'Web5：H5 / PC，按需求影响范围确认';
  return '按项目配置确认';
}

function compareThemeName(a, b) {
  const pa = String(a).replace('theme_', '').split('.').map(Number);
  const pb = String(b).replace('theme_', '').split('.').map(Number);
  return (pa[0] - pb[0]) || ((pa[1] || 0) - (pb[1] || 0));
}

function buildRunArtifactRoot(project, run) {
  return path.join(
    paths.artifactDir,
    safePathSegment(project.id || 'project'),
    safePathSegment(run.taskFolderName || run.title || run.id),
    'runs',
    runArtifactFolderName(run)
  );
}

function runArtifactFolderName(run = {}) {
  const stamp = String(run.createdAt || new Date().toISOString())
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
    .replace(/[TZ]/g, '-')
    .replace(/-$/, '');
  const attempt = Number(run.attemptNo || 0);
  const attemptLabel = attempt > 0 ? `第${attempt}次执行` : '执行记录';
  return safePathSegment(`${attemptLabel}-${stamp}-${String(run.id || '').slice(0, 8) || 'run'}`);
}

function safePathSegment(value = '') {
  return String(value || 'item')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'item';
}

function escapeTableCell(value = '') {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

async function hydrateRunStages(run) {
  if (!run) return null;
  const normalizedActive = normalizeActiveLocalWorkerRun(run, run.status || run.workerStatus);
  if (normalizedActive !== run) return normalizedActive;
  const stages = Array.isArray(run.stages) ? run.stages : [];
  if (!stages.length || !isFinishedRun(run.status)) return run;
  if (!stages.some(stage => isPendingStage(stage.status))) return run;

  const reportStages = await readStageReportStages(run.artifactRoot);
  const updatedStages = stages.map(stage => {
    const matched = matchReportStage(stage, reportStages);
    if (matched) {
      const reportStatus = normalizeStageStatus(matched.status);
      const shouldKeepStageStatus = hasStageDurationEvidence(stage) && isPendingStage(reportStatus) && !isPendingStage(stage.status);
      const nextStatus = shouldKeepStageStatus ? stage.status : reportStatus;
      return {
        ...stage,
        name: stage.name || matched.name,
        status: reconcileStageStatusWithDuration({ ...stage, status: nextStatus }, run),
        output: stage.output || matched.output || ''
      };
    }
    return { ...stage, status: reconcileStageStatusWithDuration({ ...stage, status: fallbackFinishedStageStatus(run.status, run) }, run) };
  });
  return {
    ...run,
    stages: updatedStages,
    currentStage: run.currentStage && isFinishedRun(run.status) ? null : run.currentStage
  };
}

async function reconcileStaleLocalWorkerRuns() {
  const runs = await readJson(paths.runs, []);
  const workers = await readJson(paths.agentWorkers, []);
  const workerByDevice = new Map(workers.map(worker => [cleanString(worker.deviceId), worker]));
  const now = new Date();
  let changed = false;
  const nextRuns = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    const normalizedFinal = normalizeFinalWorkerStatusConflict(run, now);
    if (normalizedFinal !== run) {
      nextRuns.push(normalizedFinal);
      changed = true;
    } else {
      const normalizedActive = normalizeActiveLocalWorkerRun(run, run.status || run.workerStatus);
      if (stableWorkerRunValue(run) !== stableWorkerRunValue(normalizedActive)) {
        nextRuns.push(normalizedActive);
        changed = true;
      } else if (await shouldMarkLocalWorkerRunStale(run, workerByDevice, now)) {
        nextRuns.push(markLocalWorkerRunStale(run, workerByDevice.get(cleanString(run.claimedByDeviceId)), now));
        changed = true;
      } else if (run.localWorkerStale === true && /当前已空闲/.test(cleanString(run.resultSummary?.summary))) {
        nextRuns.push(normalizeLocalWorkerStaleSummary(run, now));
        changed = true;
      } else {
        nextRuns.push(run);
      }
    }
  }
  if (changed) await writeJson(paths.runs, nextRuns);
  return nextRuns;
}

function normalizeFinalWorkerStatusConflict(run = {}, now = new Date()) {
  const finalStatus = normalizeCanonicalFinalWorkerStatus(run.status);
  if (!finalStatus) return run;
  const workerStatus = cleanString(run.workerStatus).toLowerCase();
  const clearStalePatch = run.localWorkerStale || run.localWorkerStaleDetectedAt
    ? { localWorkerStale: false, localWorkerStaleDetectedAt: '', updatedAt: now.toISOString() }
    : null;
  if (!workerStatus || workerStatus === finalStatus) return clearStalePatch ? { ...run, ...clearStalePatch } : run;
  if (finalStatus === 'cancelled' && isFinalWorkerRunStatus(workerStatus)) {
    return {
      ...run,
      status: finalStatus,
      workerStatus: finalStatus,
      currentStage: '已中断',
      ...(run.blocker ? { blocker: null } : {}),
      resultSummary: {
        ...(run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {}),
        status: finalStatus,
        statusText: finalStatus,
        summary: '执行已中断。',
        blockerReason: ''
      },
      ...clearStalePatch,
      updatedAt: now.toISOString()
    };
  }
  if (isFinalWorkerRunStatus(workerStatus)) return clearStalePatch ? { ...run, ...clearStalePatch } : run;
  if (!/running|claimed|in_progress|queued|pending|created/.test(workerStatus)) return clearStalePatch ? { ...run, ...clearStalePatch } : run;
  return {
    ...run,
    status: finalStatus,
    workerStatus: finalStatus,
    currentStage: finalStatus === 'cancelled' ? '已中断' : run.currentStage,
    ...(finalStatus === 'cancelled' && !run.finishedAt ? { finishedAt: cleanString(run.updatedAt || run.startedAt || run.claimedAt || run.createdAt || now.toISOString()) } : {}),
    ...clearStalePatch,
    updatedAt: now.toISOString()
  };
}

function normalizeCanonicalFinalWorkerStatus(value = '') {
  const status = cleanString(value).toLowerCase();
  if (/cancelled|canceled/.test(status)) return 'cancelled';
  if (/partial_write/.test(status)) return 'partial_write';
  if (/completed|done|success|passed/.test(status)) return 'completed';
  if (/blocked/.test(status)) return 'blocked';
  if (/failed|error/.test(status)) return 'failed';
  return '';
}

async function shouldMarkLocalWorkerRunStale(run = {}, workerByDevice = new Map(), now = new Date()) {
  if (!isWorkerExecutableRun(run)) return false;
  if (!isActiveWorkerRun(run)) return false;
  if (!cleanString(run.claimedByDeviceId) || !cleanString(run.startedAt || run.claimedAt)) return false;
  const hasCodexOutput = await hasServerCodexOutput(run);
  const lastActivityMs = hasCodexOutput
    ? await localWorkerRunLastActivityMs(run)
    : localWorkerRunStartedMs(run);
  if (!lastActivityMs || now.getTime() - lastActivityMs < staleLocalWorkerRunMs) return false;
  const worker = workerByDevice.get(cleanString(run.claimedByDeviceId));
  const workerOnline = isAgentWorkerOnline(worker, now);
  const workerCurrentRunId = cleanString(worker?.currentRunId);
  const workerStillReportsThisRun = workerCurrentRunId && workerCurrentRunId === cleanString(run.id);
  if (!workerOnline) return true;
  if (workerStillReportsThisRun && hasCodexOutput) return false;
  return true;
}

function normalizeLocalWorkerStaleSummary(run = {}, now = new Date()) {
  return {
    ...run,
    resultSummary: {
      ...(run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {}),
      summary: '本机 Worker 领取后长期未回传可验证的 Codex 输出、最终状态或产物结果，平台判定为本机回传失联。'
    },
    updatedAt: run.updatedAt || now.toISOString()
  };
}

function markLocalWorkerRunStale(run = {}, worker = null, now = new Date()) {
  const detectedAt = now.toISOString();
  const lastActivityAt = cleanString(run.updatedAt || run.startedAt || run.claimedAt || run.createdAt) || detectedAt;
  const finishedAt = lastActivityAt;
  const startedAt = cleanString(run.startedAt || run.claimedAt || run.createdAt);
  const durationMs = normalizeDurationMs(run.durationMs, startedAt, finishedAt, run.durationMs);
  const reason = [
    'Worker 已领取并回传 running，但长时间没有可验证的 Codex 输出、最终状态或产物结果。',
    describeStaleLocalWorker(worker, now),
    '平台已判定为本机回传失联，不再按普通执行中展示。'
  ].filter(Boolean).join(' ');
  const stages = Array.isArray(run.stages)
    ? run.stages.map(stage => {
      const status = cleanString(stage.status).toLowerCase();
      if (!/running|in_progress|claimed|pending|queued|created/.test(status)) return stage;
      return {
        ...stage,
        status: 'blocked',
        finishedAt: stage.finishedAt || finishedAt,
        durationMs: normalizeDurationMs(stage.durationMs, stage.startedAt || startedAt, stage.finishedAt || finishedAt, stage.durationMs)
      };
    })
    : run.stages;
  return {
    ...run,
    status: 'blocked',
    workerStatus: 'blocked',
    finishedAt,
    ...(durationMs > 0 ? { durationMs, durationEstimated: true } : {}),
    currentStage: '本机回传失联',
    blocker: {
      ...(run.blocker && typeof run.blocker === 'object' ? run.blocker : {}),
      reason,
      staleDetectedAt: detectedAt,
      lastWorkerHeartbeatAt: cleanString(worker?.lastHeartbeatAt),
      workerCurrentRunId: cleanString(worker?.currentRunId),
      workerOnline: worker ? isAgentWorkerOnline(worker, now) : false
    },
    resultSummary: {
      ...(run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {}),
      status: 'blocked',
      statusText: 'blocked',
      summary: '本机 Worker 领取后长期未回传可验证的 Codex 输出、最终状态或产物结果，平台判定为本机回传失联。',
      blockerReason: reason,
      needsHumanReview: true,
      nextStep: '请执行人检查本机 Codex 是否曾启动、Worker 本机 state/runs 日志是否存在；确认后使用继续执行或重新执行，不要按本次记录视为已完成。',
      parsedAt: detectedAt
    },
    figmaWriteResult: {
      ...(run.figmaWriteResult && typeof run.figmaWriteResult === 'object' ? run.figmaWriteResult : {}),
      required: runRequiresFigmaWriteEvidence(run),
      written: false,
      evidence: [],
      blockerReason: reason
    },
    stages,
    localWorkerStale: true,
    localWorkerStaleDetectedAt: detectedAt,
    updatedAt: detectedAt
  };
}

function describeStaleLocalWorker(worker = null, now = new Date()) {
  if (!worker) return '领取设备没有可用的 Worker 心跳记录。';
  const currentRunId = cleanString(worker.currentRunId) || '空';
  const lastHeartbeatAt = cleanString(worker.lastHeartbeatAt);
  if (isAgentWorkerOnline(worker, now)) {
    return `领取设备最近心跳在线，currentRunId 为「${currentRunId}」。`;
  }
  return `领取设备最近心跳已超时，最后心跳为「${lastHeartbeatAt || '无'}」，currentRunId 为「${currentRunId}」。`;
}

function isActiveWorkerRun(run = {}) {
  const status = `${run.status || ''} ${run.workerStatus || ''}`;
  return /running|claimed|in_progress/i.test(status) && !/completed|failed|blocked|cancelled|canceled|done|success|passed/i.test(status);
}

function isAgentWorkerOnline(worker = null, now = new Date()) {
  if (!worker?.lastHeartbeatAt) return false;
  const lastHeartbeatMs = Date.parse(worker.lastHeartbeatAt);
  if (!lastHeartbeatMs) return false;
  const heartbeat = Math.max(Number(worker.heartbeatIntervalMs || 0), 60000);
  const grace = Math.min(Math.max(Number(worker.onlineGraceMs || 0), heartbeat * 3, 180000), 900000);
  return now.getTime() - lastHeartbeatMs < grace;
}

async function localWorkerRunLastActivityMs(run = {}) {
  const candidates = [
    Date.parse(run.updatedAt || ''),
    Date.parse(run.startedAt || ''),
    Date.parse(run.claimedAt || ''),
    Date.parse(run.createdAt || ''),
    await fileMtimeMs(cleanString(run.logPath)),
    run.id ? await fileMtimeMs(path.join(getRunWorkspace(run.id), 'run.log')) : 0,
    await artifactRootMtimeMs(run.artifactRoot)
  ].filter(value => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(...candidates) : 0;
}

function localWorkerRunStartedMs(run = {}) {
  const candidates = [
    Date.parse(run.startedAt || ''),
    Date.parse(run.claimedAt || ''),
    Date.parse(run.createdAt || '')
  ].filter(value => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.min(...candidates) : 0;
}

async function hasServerCodexOutput(run = {}) {
  const logPaths = [
    cleanString(run.logPath),
    run.id ? path.join(getRunWorkspace(run.id), 'run.log') : ''
  ].filter(Boolean);
  for (const file of [...new Set(logPaths)]) {
    const text = await readTextTail(file, 30000).catch(() => '');
    if (text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .some(line => !line.startsWith('[worker]'))) return true;
  }
  return false;
}

async function readTextTail(file = '', maxChars = 30000) {
  const target = cleanString(file);
  if (!target) return '';
  const info = await fs.stat(target);
  if (!info.isFile() || info.size <= 0) return '';
  const size = Math.min(info.size, Math.max(1000, Number(maxChars || 30000)));
  const handle = await fs.open(target, 'r');
  try {
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, info.size - size);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

async function fileMtimeMs(file = '') {
  const target = cleanString(file);
  if (!target) return 0;
  try {
    const info = await fs.stat(target);
    return info.isFile() && info.size > 0 ? info.mtimeMs : 0;
  } catch {
    return 0;
  }
}

async function artifactRootMtimeMs(rootDir = '') {
  const rootPath = cleanString(rootDir);
  if (!rootPath) return 0;
  return artifactDirMtimeMs(rootPath, 0);
}

async function artifactDirMtimeMs(dir = '', depth = 0) {
  if (depth > 3) return 0;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let latest = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, await artifactDirMtimeMs(full, depth + 1));
      continue;
    }
    if (!entry.isFile() || entry.name === '资料.md') continue;
    try {
      const info = await fs.stat(full);
      if (info.size > 0) latest = Math.max(latest, info.mtimeMs);
    } catch {
    }
  }
  return latest;
}

async function enrichRunWithFigmaLogEvidence(run) {
  if (!run || !shouldDeriveFigmaEvidenceFromLog(run)) return run;
  const evidence = await deriveFigmaLogEvidence(run);
  if (!evidence?.written) return run;
  const blockerReason = evidence.blockerReason || 'Figma 已有部分写入，但写入后的最终回读/截图验收未闭环，不能判定整条任务完整完成。';
  const restoredStatus = evidence.verifiedAfterWrite && Number(run.exitCode) === 0 ? 'completed' : (run.status || 'blocked');
  const restoredWorkerStatus = evidence.verifiedAfterWrite && Number(run.exitCode) === 0 ? 'completed' : (run.workerStatus || restoredStatus);
  const restoredStages = Array.isArray(run.stages)
    ? run.stages.map(stage => ({
      ...stage,
      status: evidence.verifiedAfterWrite && Number(run.exitCode) === 0 && /failed|blocked|error/i.test(cleanString(stage.status))
        ? 'completed'
        : stage.status
    }))
    : run.stages;
  return guardFigmaWriteCompletion({
    ...run,
    status: restoredStatus,
    workerStatus: restoredWorkerStatus,
    stages: restoredStages,
    figmaWriteResult: {
      required: true,
      written: true,
      createdNodeIds: evidence.createdNodeIds,
      mutatedNodeIds: evidence.mutatedNodeIds,
      evidence: evidence.evidence,
      postWriteVerificationRequired: true,
      verifiedAfterWrite: evidence.verifiedAfterWrite,
      verificationEvidence: evidence.verificationEvidence,
      postWriteBlockers: evidence.postWriteBlockers,
      partialWrite: !evidence.verifiedAfterWrite,
      blockerReason: evidence.verifiedAfterWrite ? '' : blockerReason,
      derivedFromLog: true
    },
    resultSummary: {
      ...(run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {}),
      figmaWritten: true,
      figmaVerifiedAfterWrite: evidence.verifiedAfterWrite,
      status: evidence.verifiedAfterWrite ? 'completed' : 'blocked',
      statusText: evidence.verifiedAfterWrite ? 'completed' : 'blocked',
      summary: evidence.verifiedAfterWrite
        ? '本机直接执行已完成，并从日志识别到 Figma 写入和写入后验收证据。'
        : 'Figma 已有部分写入，但最终回读/截图验收未闭环，本次不能判定完整完成。',
      blockerReason: evidence.verifiedAfterWrite ? '' : blockerReason,
      needsHumanReview: true
    }
  });
}

function reconcileFigmaEvidenceRunStatus(run = {}) {
  if (!run || !hasFigmaWriteEvidence(run)) return run;
  if (isCancelledRunStatus(run.status) || isCancelledRunStatus(run.workerStatus)) return run;
  const hasVerification = hasFigmaPostWriteVerification(run);
  const existingSummary = run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {};
  const existingResult = run.figmaWriteResult && typeof run.figmaWriteResult === 'object' ? run.figmaWriteResult : {};
  const status = hasVerification ? 'completed' : 'partial_write';
  const blockerReason = hasVerification
    ? ''
    : (existingResult.blockerReason || existingSummary.blockerReason || 'Figma 已有放置、替换或写入证据，但最终回读/截图验收未闭环，本次不能判定完整完成。');
  const finishedAt = cleanString(run.finishedAt || run.completedAt || run.updatedAt || new Date().toISOString());
  const stages = Array.isArray(run.stages)
    ? run.stages.map(stage => {
      const rawStatus = cleanString(stage.status).toLowerCase();
      if (hasVerification && /failed|blocked|error|partial_write/i.test(rawStatus)) {
        return { ...stage, status: 'completed', finishedAt: stage.finishedAt || finishedAt };
      }
      if (!hasVerification && /failed|blocked|error/i.test(rawStatus)) {
        return { ...stage, status: 'partial_write', finishedAt: stage.finishedAt || finishedAt };
      }
      return stage;
    })
    : run.stages;
  return {
    ...run,
    status,
    workerStatus: status,
    currentStage: hasVerification ? 'Figma 写入已验收' : 'Figma 已部分写入',
    blocker: {
      ...(run.blocker && typeof run.blocker === 'object' ? run.blocker : {}),
      reason: '',
      legacyFigmaBlockerReason: cleanString(run.blocker?.reason || existingSummary.blockerReason)
    },
    figmaWriteResult: {
      ...existingResult,
      required: true,
      written: true,
      partialWrite: !hasVerification,
      blockerReason
    },
    resultSummary: {
      ...existingSummary,
      status,
      statusText: status,
      summary: hasVerification
        ? '已检测到 Figma 真实写入和写入后验收证据；不再按本机阻塞展示。'
        : 'Figma 已有真实写入证据，但最终回读/截图验收未闭环；按部分写入展示，不再按本机阻塞展示。',
      blockerReason,
      needsHumanReview: !hasVerification,
      figmaWritten: true,
      figmaVerifiedAfterWrite: hasVerification,
      nextStep: hasVerification
        ? ''
        : '让执行人继续执行补齐最终回读、截图验收和剩余未完成项。'
    },
    stages,
    localWorkerStale: false,
    localWorkerStaleDetectedAt: '',
    updatedAt: new Date().toISOString()
  };
}

async function persistRunReadReconciliations(beforeRuns = [], afterRuns = []) {
  const changedById = new Map();
  const beforeById = new Map((Array.isArray(beforeRuns) ? beforeRuns : [])
    .filter(run => run?.id)
    .map(run => [run.id, run]));
  for (const after of Array.isArray(afterRuns) ? afterRuns : []) {
    if (!after?.id) continue;
    const before = beforeById.get(after.id);
    if (!before || !hasRunReadReconciliationChange(before, after)) continue;
    changedById.set(after.id, after);
  }
  if (!changedById.size) return;
  const runs = await readJson(paths.runs, []);
  let changed = false;
  const next = runs.map(run => {
    const replacement = changedById.get(run.id);
    if (!replacement) return run;
    changed = true;
    return {
      ...run,
      ...replacement,
      updatedAt: replacement.updatedAt || new Date().toISOString()
    };
  });
  if (changed) await writeJson(paths.runs, next);
}

function hasRunReadReconciliationChange(before = {}, after = {}) {
  const keys = [
    'status',
    'workerStatus',
    'artifactRoot',
    'generatedArtifacts',
    'blocker',
    'resultSummary',
    'workerResult',
    'figmaWriteResult',
    'stages',
    'finishedAt',
    'durationMs',
    'durationEstimated'
  ];
  return keys.some(key => stableWorkerRunValue(before[key]) !== stableWorkerRunValue(after[key]));
}

function shouldDeriveFigmaEvidenceFromLog(run = {}) {
  if (!runRequiresFigmaWriteEvidence(run)) return false;
  if (!isFinishedRun(run.status) && !isFinishedRun(run.workerStatus)) return false;
  const result = run.figmaWriteResult && typeof run.figmaWriteResult === 'object' ? run.figmaWriteResult : {};
  const statusText = `${cleanString(run.status)} ${cleanString(run.workerStatus)}`.toLowerCase();
  if (hasFigmaWriteEvidence(run) && !(result.partialWrite === true || /blocked|failed/.test(statusText))) return false;
  if (result.written === false && !/blocked|failed/.test(statusText)) return false;
  return Boolean(cleanString(run.logPath) || cleanString(run.id));
}

async function deriveFigmaLogEvidence(run = {}) {
  const logPath = cleanString(run.logPath) || (run.id ? path.join(getRunWorkspace(run.id), 'run.log') : '');
  if (!logPath) return null;
  const stat = await fs.stat(logPath).catch(() => null);
  if (!stat?.isFile()) return null;
  const cacheKey = `${logPath}:${stat.size}:${stat.mtimeMs}`;
  if (runFigmaLogEvidenceCache.has(cacheKey)) return runFigmaLogEvidenceCache.get(cacheKey);
  const maxBytes = 512 * 1024;
  const handle = await fs.open(logPath, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const start = stat.size > maxBytes ? stat.size - maxBytes : 0;
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const evidence = parseFigmaLogEvidence(buffer.toString('utf8'));
    runFigmaLogEvidenceCache.set(cacheKey, evidence);
    if (runFigmaLogEvidenceCache.size > 200) {
      const firstKey = runFigmaLogEvidenceCache.keys().next().value;
      runFigmaLogEvidenceCache.delete(firstKey);
    }
    return evidence;
  } finally {
    await handle.close().catch(() => {});
  }
}

function parseFigmaLogEvidence(text = '') {
  const source = String(text || '');
  const writeEvidenceText = figmaLogEvidenceWriteText(source);
  const createdNodeIds = extractFigmaNodeIdsFromLog(writeEvidenceText, 'createdNodeIds').slice(0, 80);
  const mutatedNodeIds = extractFigmaNodeIdsFromLog(writeEvidenceText, 'mutatedNodeIds').slice(0, 120);
  const imagePlacementLines = extractAffirmativeFigmaImagePlacementLines(source);
  const written = createdNodeIds.length > 0 || mutatedNodeIds.length > 0 || imagePlacementLines.length > 0;
  const evidence = [];
  if (createdNodeIds.length) evidence.push(`日志识别到 createdNodeIds：${createdNodeIds.slice(0, 12).join('、')}`);
  if (mutatedNodeIds.length) evidence.push(`日志识别到 mutatedNodeIds：${mutatedNodeIds.slice(0, 12).join('、')}`);
  imagePlacementLines.slice(0, 8).forEach(item => evidence.push(item.line.slice(0, 500)));
  const postWriteBlockers = written ? extractPostWriteBlockersFromLog(source) : [];
  if (written && !postWriteBlockers.length && /Auth required/i.test(source)) {
    postWriteBlockers.push('Figma 写入后验收失败：Auth required，执行人本机 Figma MCP OAuth 或文件权限需要恢复。');
  }
  const verificationEvidence = written ? extractPostWriteVerificationFromLog(source) : [];
  const verifiedAfterWrite = Boolean(written && verificationEvidence.length && !postWriteBlockers.length);
  const blockerReason = !written
    ? ''
    : verifiedAfterWrite
      ? ''
      : postWriteBlockers[0] || 'Figma 已写入，但日志里未检测到最后一次写入后的最终回读或截图验收证据。';
  return {
    written,
    createdNodeIds,
    mutatedNodeIds,
    evidence,
    verifiedAfterWrite,
    verificationEvidence,
    postWriteBlockers,
    blockerReason
  };
}

function extractAffirmativeFigmaImagePlacementLines(source = '') {
  const results = [];
  String(source || '').split(/\r?\n/).forEach((line, index) => {
    for (const text of figmaLogEvidenceLineTexts(line)) {
      if (!hasAffirmativeFigmaImagePlacementText(text)) continue;
      results.push({ line: text, index });
      if (results.length >= 8) return;
    }
  });
  return results.slice(0, 8);
}

function hasAffirmativeFigmaImagePlacementText(text = '') {
  const value = cleanString(text);
  if (!value) return false;
  if (/未(?:完成|检测到|放置|替换|上传|写入)|没有(?:完成|放置|替换|上传|写入)|失败|error|failed|blocked|阻塞|不可用|no\s+(?:placement|upload|mutation)/i.test(value)) return false;
  return /(?:upload_assets|use_figma|Figma|节点|目标).{0,120}(?:图片|成品图|位图|image|asset).{0,120}(?:已|成功|完成).{0,120}(?:放置|替换|填充|插入|上传|落到|写入)|(?:图片|成品图|位图|image|asset).{0,120}(?:已|成功|完成).{0,120}(?:放置|替换|填充|插入|上传|落到|写入).{0,120}(?:Figma|节点|目标)|(?:放置|替换|填充|插入).{0,80}(?:Figma|目标|节点).{0,80}(?:成功|完成|已)/i.test(value);
}

function figmaLogEvidenceWriteText(source = '') {
  return String(source || '')
    .split(/\r?\n/)
    .map(figmaLogEvidenceWriteChunk)
    .filter(Boolean)
    .filter(hasAffirmativeFigmaWriteEvidenceText)
    .join('\n');
}

function figmaLogEvidenceWriteChunk(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) return '';
  try {
    const event = JSON.parse(trimmed);
    const item = event?.item || {};
    if (item.type === 'command_execution') return '';
    if (item.type === 'agent_message') return String(item.text || '').trim();
    if (item.type === 'mcp_tool_call') {
      if (item.status !== 'completed' || item.error) return '';
      const resultText = figmaLogToolResultText(item.result);
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
  const hasNodeIds = extractFigmaNodeIdsFromLog(value, 'createdNodeIds').length > 0
    || extractFigmaNodeIdsFromLog(value, 'mutatedNodeIds').length > 0;
  if (!hasNodeIds) return false;
  if (/未生成|未检测到|未完成\s*Figma\s*写入|没有执行写入|没有实际写入|无，本次未完成|no mutation|no canvas mutation/i.test(value)) return false;
  return /^__FIGMA_WRITE_EVENT__\b/.test(value)
    || /写入成功|Figma 写入证据|figmaWriteResult\s*[:=]\s*["']?(?:rename_applied|applied|written|true)|mutationCount/i.test(value);
}

function extractFigmaNodeIdsFromLog(text = '', field = '') {
  const values = new Set();
  const source = String(text || '');
  const arrayPattern = new RegExp(`"${field}"\\s*:\\s*\\[([^\\]]*)\\]`, 'gi');
  let match = arrayPattern.exec(source);
  while (match) {
    String(match[1] || '')
      .split(/,|\s/)
      .map(item => item.replace(/[\\"'`]/g, '').trim())
      .filter(isLikelyFigmaNodeId)
      .forEach(item => values.add(item));
    match = arrayPattern.exec(source);
  }
  const loosePattern = new RegExp(`${field}[^\\n\\[]*\\[([^\\]]*)\\]`, 'gi');
  match = loosePattern.exec(source);
  while (match) {
    String(match[1] || '')
      .split(/,|\s/)
      .map(item => item.replace(/[\\"'`]/g, '').trim())
      .filter(isLikelyFigmaNodeId)
      .forEach(item => values.add(item));
    match = loosePattern.exec(source);
  }
  const equalsPattern = new RegExp(`${field}[^\\n:=]*[:=]\\s*(?!\\[)([^\\n\\r]+)`, 'gi');
  match = equalsPattern.exec(source);
  while (match) {
    String(match[1] || '')
      .split(/,|\s|；|、/)
      .map(item => item.replace(/[\\"'`\[\]]/g, '').trim())
      .filter(isLikelyFigmaNodeId)
      .forEach(item => values.add(item));
    match = equalsPattern.exec(source);
  }
  return [...values];
}

function isLikelyFigmaNodeId(value = '') {
  const text = String(value || '').trim();
  return text.includes(':') && /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)(?:;[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+))*$/.test(text);
}

function extractPostWriteBlockersFromLog(text = '') {
  const lines = String(text || '').split(/\r?\n/).flatMap(figmaLogEvidenceLineTexts);
  const lastWriteIndex = findLastFigmaWriteLineIndex(lines);
  if (lastWriteIndex < 0) return [];
  const blockers = [];
  for (let index = lastWriteIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isFigmaPostWriteBlockerLine(line)) continue;
    blockers.push(`Figma 写入后验收失败：${compactEvidenceReason(line)}`);
    if (blockers.length >= 5) break;
  }
  return [...new Set(blockers)].slice(0, 5);
}

function extractPostWriteVerificationFromLog(text = '') {
  const lines = String(text || '').split(/\r?\n/).flatMap(figmaLogEvidenceLineTexts);
  const lastWriteIndex = findLastFigmaWriteLineIndex(lines);
  if (lastWriteIndex < 0) return [];
  const evidence = [];
  for (let index = lastWriteIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFigmaVerificationSuccessLine(line)) {
      evidence.push(compactEvidenceReason(line));
    }
    if (evidence.length >= 5) break;
  }
  if (!evidence.length) {
    const firstWriteIndex = findFirstFigmaWriteLineIndex(lines);
    if (firstWriteIndex >= 0 && firstWriteIndex < lastWriteIndex) {
      for (let index = firstWriteIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (isFigmaVerificationSuccessLine(line)) evidence.push(compactEvidenceReason(line));
        if (evidence.length >= 5) break;
      }
    }
  }
  return [...new Set(evidence)].slice(0, 5);
}

function findLastFigmaWriteLineIndex(lines = []) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^__FIGMA_WRITE_EVENT__\b/.test(lines[index] || '')) return index;
  }
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/createdNodeIds|mutatedNodeIds/i.test(lines[index] || '') || hasAffirmativeFigmaImagePlacementText(lines[index])) return index;
  }
  return -1;
}

function findFirstFigmaWriteLineIndex(lines = []) {
  for (let index = 0; index < lines.length; index += 1) {
    if (/^__FIGMA_WRITE_EVENT__\b/.test(lines[index] || '')) return index;
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (/createdNodeIds|mutatedNodeIds/i.test(lines[index] || '') || hasAffirmativeFigmaImagePlacementText(lines[index])) return index;
  }
  return -1;
}

function isNegatedFigmaBlockerLine(line = '') {
  const text = compactEvidenceReason(line);
  if (!text) return false;
  return /(?:^|[，。；\s])阻塞原因\s*[:：]\s*(?:无|没有|未发现)|无最终阻塞|无硬阻塞|无阻塞|没有阻塞|未发现阻塞|不构成阻塞|不作为阻塞/i.test(text);
}

function isNonBlockingFigmaNoteLine(line = '') {
  const text = compactEvidenceReason(line);
  if (!text) return false;
  return /(?:Figma MCP|MCP|截图工具).*(?:截图已生成|截图.*返回|内联截图|可见)|(?:shell|curl|本机).*(?:无法|不能).*(?:下载|解析|保存).*(?:figma\.com|截图|图片|本地)|(?:平台产物目录|产物目录|报告).*(?:不可写|只可读|未能落盘|不能落盘)/i.test(text);
}

function isFigmaPostWriteBlockerLine(line = '') {
  const text = compactEvidenceReason(line);
  if (!text || isNegatedFigmaBlockerLine(text) || isNonBlockingFigmaNoteLine(text)) return false;
  if (/Auth required|OAuth|permission|denied|Transport send error|tool call failed/i.test(text)) return true;
  if (/(?:最终|回读|截图|验证|验收|复扫).{0,120}(?:失败|阻塞|未完成|不可用|无权限|没有权限)/i.test(text)) return true;
  if (/Figma MCP.{0,120}(?:失败|阻塞|未完成|不可用|Auth required|OAuth|permission|denied|Transport send error|tool call failed)/i.test(text)) return true;
  return false;
}

function isFigmaVerificationSuccessLine(line = '') {
  const text = compactEvidenceReason(line);
  if (!text) return false;
  if (isNegatedFigmaBlockerLine(text)) return true;
  if (isFigmaPostWriteBlockerLine(text)) return false;
  if (/^\d+\.\s*每批执行后回读|^\d+\.\s*每完成一个有意义的批次|`(?:已验证|部分验证|未验证)`|按以下|成功标准|工作流|必须|不要|不得|只允许/i.test(text)) return false;
  return /最终.*(?:回读|截图|验证|验收).*(?:完成|通过|成功|已完成|已生成|已返回|已保存|已验证)|(?:回读|截图|视觉|复核|验证|验收).*(?:完成|通过|成功|已完成|已生成|已返回|已保存|已验证|可见|确认)|(?:已回读|回读确认|截图复核已通过|视觉复核通过|内联截图可见|截图工具.*返回|MCP.*截图.*已生成|未见换行、遮挡、截断|画面无空白|无明显(?:遮挡|错位|截断|异常换行)|同类复扫.*(?:未发现|清零|无残留))/i.test(text);
}

function figmaLogEvidenceLineTexts(line = '') {
  return figmaLogEvidenceLineText(line)
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
}

function figmaLogEvidenceLineText(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) return '';
  try {
    const event = JSON.parse(trimmed);
    const item = event?.item || {};
    if (item.type === 'command_execution') return '';
    if (item.type === 'agent_message') return String(item.text || '').trim();
    if (item.type === 'mcp_tool_call') {
      if (item.status === 'completed' && !item.error) {
        const resultText = figmaLogToolResultText(item.result);
        if (/figma/i.test(`${item.server || ''} ${item.tool || ''}`) && /createdNodeIds|mutatedNodeIds/i.test(resultText)) {
          return `__FIGMA_WRITE_EVENT__ ${item.tool || 'use_figma'} ${item.arguments?.description || ''} ${resultText}`.trim();
        }
        return '';
      }
      return [
        item.server,
        item.tool,
        compactEvidenceReason(JSON.stringify(item.error || item.result || ''))
      ].filter(Boolean).join(' ');
    }
    return String(event.message || event.text || event.delta || '').trim();
  } catch {
    return trimmed;
  }
}

function figmaLogToolResultText(result = null) {
  if (!result || typeof result !== 'object') return '';
  const chunks = [];
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (item?.type === 'text' && item.text) chunks.push(String(item.text));
  }
  if (typeof result === 'string') chunks.push(result);
  return chunks.join('\n').slice(0, 20000);
}

function compactEvidenceReason(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function isFinishedRun(status = '') {
  return /conditional|partial_write|done|success|passed|completed|failed|blocked|cancelled|canceled/i.test(String(status || ''));
}

function isCancelledRunStatus(status = '') {
  return /cancelled|canceled/i.test(String(status || ''));
}

function isPendingStage(status = '') {
  return !status || /pending|created|queued|wait|未执行|待执行/i.test(String(status || ''));
}

function hasStageDurationEvidence(stage = {}) {
  return Number(stage.durationMs || 0) > 0
    || Boolean(stage.startedAt && stage.finishedAt)
    || Boolean(stage.durationEstimated);
}

function reconcileStageStatusWithDuration(stage = {}, run = {}) {
  if (!hasStageDurationEvidence(stage) || !isPendingStage(stage.status)) return stage.status;
  if (/cancelled|canceled/i.test(String(run.status || '')) && !stage.finishedAt) return 'cancelled';
  if (/failed|blocked/i.test(String(run.status || '')) && !stage.finishedAt) return 'skipped';
  return 'conditional_pass';
}

async function readStageReportStages(artifactRoot = '') {
  if (!artifactRoot) return [];
  const file = path.join(artifactRoot, '阶段执行报告.md');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return parseStageReportRows(raw);
  } catch {
    return [];
  }
}

function parseStageReportRows(raw = '') {
  const rows = [];
  const re = /^\|\s*(?:\d+\.?\s*)?\|?\s*(?:\d+\s*\|)?\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm;
  let match;
  while ((match = re.exec(raw))) {
    const first = match[1].trim();
    if (!first || /阶段|----/.test(first)) continue;
    const maybeNo = Number(first);
    const name = Number.isFinite(maybeNo) ? match[2].trim() : first;
    const status = Number.isFinite(maybeNo) ? match[3].trim() : match[2].trim();
    const output = Number.isFinite(maybeNo) ? '' : match[3].trim();
    rows.push({
      no: Number.isFinite(maybeNo) ? maybeNo : rows.length + 1,
      name,
      status,
      output
    });
  }
  return rows;
}

function matchReportStage(stage, reportStages) {
  const targetName = normalizeStageName(stage.name);
  return reportStages.find(item => normalizeStageName(item.name) === targetName)
    || reportStages.find(item => {
      const reportName = normalizeStageName(item.name);
      return reportName.includes(targetName) || targetName.includes(reportName);
    })
    || reportStages.find(item => Number(item.no) === Number(stage.no))
    || null;
}

function normalizeStageName(value = '') {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[\/]/g, '')
    .replace(/api/ig, '')
    .toLowerCase();
}

function normalizeStageStatus(status = '') {
  const value = String(status || '');
  if (/未执行|待执行|pending|created|queued|wait/i.test(value)) return 'pending';
  if (/取消|中断|cancelled|canceled/i.test(value)) return 'cancelled';
  if (/阻塞|失败|❌|failed|error/i.test(value)) return 'failed';
  if (/有条件|⚠️|conditional/i.test(value)) return 'conditional_pass';
  if (/跳过|未触发|⏭️|skipped|skip/i.test(value)) return 'skipped';
  if (/通过|完成|✅|passed|success|done/i.test(value)) return 'passed';
  if (/运行中|执行中|running|in_progress/i.test(value)) return 'running';
  return status || 'pending';
}

function fallbackFinishedStageStatus(runStatus = '', run = {}) {
  if ((run.sourceType === 'direct-skill' || run.executionMode === 'direct-skill') && /failed|error/i.test(String(runStatus || ''))) return 'failed';
  if (/failed|blocked|cancelled|canceled/i.test(String(runStatus || ''))) return 'skipped';
  if (/conditional/i.test(String(runStatus || ''))) return 'conditional_pass';
  return 'passed';
}

function normalizeTask(input) {
  if (!input.projectId) throw new Error('projectId is required');
  const now = new Date().toISOString();
  const taskNo = cleanTaskNo(input.taskNo || input.zentaoId || input.title);
  const title = cleanTaskTitle(input.title || input.name || 'Untitled task', taskNo);
  const id = taskIdFor(input.projectId, taskNo, title);
  return {
    id,
    projectId: input.projectId,
    taskNo,
    title,
    developer: input.developer || '',
    assignedTo: input.assignedTo || input.zentao?.assignedTo || '',
    source: input.source || 'manual',
    status: input.status || 'pending',
    zentaoStatus: input.zentaoStatus || '',
    isCurrent: input.isCurrent !== false,
    syncStatus: input.syncStatus || (input.isCurrent === false ? 'non_current' : 'current'),
    lastSyncedAt: input.lastSyncedAt || '',
    archivedAt: input.archivedAt || '',
    deadline: input.deadline || '',
    zentaoCreatedAt: input.zentaoCreatedAt || '',
    zentaoProgress: Number(input.zentaoProgress || 0),
    completion: Number(input.completion || 0),
    agentModel: input.agentModel || '',
    summary: input.summary || '',
    issues: input.issues || '',
    requirement: input.requirement || '',
    workloadLevel: normalizeTaskWorkloadLevel(input.workloadLevel || input.workloadEstimate?.level || input.zentao?.workloadLevel || input.zentao?.workloadEstimate?.level),
    workloadEstimate: normalizeTaskWorkloadEstimate(input.workloadEstimate || input.zentao?.workloadEstimate),
    stageChecks: normalizeStageChecks(input.stageChecks || []),
    zentao: input.zentao || {},
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

function normalizeTaskWorkloadLevel(value = '') {
  const text = String(value || '').trim().toUpperCase();
  return ['XS', 'S', 'M', 'L'].includes(text) ? text : '';
}

function normalizeTaskWorkloadEstimate(input = null) {
  if (!input || typeof input !== 'object') return null;
  const level = normalizeTaskWorkloadLevel(input.level);
  if (!level) return null;
  return {
    ...input,
    level
  };
}

function normalizeTaskCenterConfig(input = {}) {
  const columns = input.memberVisibleColumns || input.memberColumns || {};
  return {
    memberVisibleColumns: {
      task: normalizeColumnKeys(columns.task),
      bug: normalizeColumnKeys(columns.bug),
      merge: normalizeColumnKeys(columns.merge)
    },
    skillValidationVisibleColumns: normalizeColumnKeys(input.skillValidationVisibleColumns || []),
    aiAssetVisibleColumns: normalizeColumnKeys(input.aiAssetVisibleColumns || []),
    updatedAt: input.updatedAt || ''
  };
}

function normalizeColumnKeys(value = []) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

function normalizeArtBriefRecord(input = {}) {
  const now = new Date().toISOString();
  return {
    id: cleanString(input.id) || `art_brief_${slugify(input.projectId || 'project')}_${slugify(input.groupKey || input.taskNo || now)}`,
    projectId: cleanString(input.projectId),
    groupKey: cleanString(input.groupKey),
    groupType: cleanString(input.groupType),
    groupTitle: cleanString(input.groupTitle),
    taskId: cleanString(input.taskId),
    taskNo: cleanString(input.taskNo),
    title: cleanString(input.title),
    generatedBy: cleanString(input.generatedBy),
    generatedByName: cleanString(input.generatedByName),
    generatedAt: cleanString(input.generatedAt) || now,
    updatedAt: cleanString(input.updatedAt) || now,
    reusedAt: cleanString(input.reusedAt),
    reusedFromTaskId: cleanString(input.reusedFromTaskId),
    reportFile: cleanString(input.reportFile),
    reportUrl: cleanString(input.reportUrl),
    aiWorkFile: cleanString(input.aiWorkFile),
    aiWorkUrl: cleanString(input.aiWorkUrl),
    manifestFile: cleanString(input.manifestFile),
    summaryText: cleanString(input.summaryText),
    needs: Array.isArray(input.needs) ? input.needs.map(cleanString).filter(Boolean) : [],
    avoid: Array.isArray(input.avoid) ? input.avoid.map(cleanString).filter(Boolean) : [],
    confirm: Array.isArray(input.confirm) ? input.confirm.map(cleanString).filter(Boolean) : [],
    stderr: cleanString(input.stderr),
    raw: input.raw && typeof input.raw === 'object' ? input.raw : {}
  };
}

function normalizeOperationLog(input = {}) {
  const user = input.user || {};
  const target = input.target || {};
  const now = new Date().toISOString();
  const action = String(input.action || '').trim() || 'UNKNOWN_ACTION';
  const module = String(input.module || '').trim() || 'system';
  const result = input.result === 'fail' ? 'fail' : 'success';
  const targetName = String(input.targetName || target.name || target.title || target.username || '').trim();
  const description = String(input.description || buildOperationDescription(action, targetName, result)).trim();
  const before = compactOperationLogPayload(input.before, action);
  const after = compactOperationLogPayload(input.after, action);
  const metadata = compactOperationLogPayload(input.metadata || {}, action);
  return {
    id: input.id || randomUUID(),
    userId: String(input.userId || user.id || '').trim(),
    username: String(input.username || user.username || '').trim(),
    displayName: String(input.displayName || user.displayName || user.username || '').trim(),
    action,
    actionName: String(input.actionName || '').trim(),
    module,
    targetType: String(input.targetType || target.type || '').trim(),
    targetId: String(input.targetId || target.id || '').trim(),
    targetName,
    description,
    result,
    errorMessage: String(input.errorMessage || '').trim(),
    ip: String(input.ip || '').trim(),
    userAgent: String(input.userAgent || '').trim(),
    requestId: String(input.requestId || '').trim(),
    before: redactSensitive(before),
    after: redactSensitive(after),
    metadata: redactSensitive(metadata),
    createdAt: input.createdAt || now
  };
}

function displayOperationLog(input = {}) {
  const log = normalizeOperationLog(input);
  const targetName = operationLogDisplayTargetName(log);
  if (!targetName || targetName === log.targetName) return log;
  return {
    ...log,
    targetName,
    description: rewriteOperationLogDescriptionTarget(log.description, log.targetName, targetName)
  };
}

function rewriteOperationLogDescriptionTarget(description = '', previousTarget = '', nextTarget = '') {
  const text = cleanString(description);
  const previous = cleanString(previousTarget);
  const next = cleanString(nextTarget);
  if (!text || !previous || !next || previous === next) return text;
  if (text.includes(`「${previous}」`)) return text.replace(`「${previous}」`, `「${next}」`);
  return text;
}

function operationLogDisplayTargetName(log = {}) {
  if (!isSkillValidationOperationLog(log)) return cleanString(log.targetName);
  return preferredSkillValidationUsageTarget(log.after) || cleanString(log.targetName);
}

function preferredSkillValidationUsageTarget(record = {}) {
  const values = [
    ...skillValidationEmbeddedArtifactTargets(record.researchName),
    ...skillValidationEmbeddedArtifactTargets(record.artifactName),
    ...skillValidationEmbeddedArtifactTargets(record.artifactLocation),
    record.artifactLocation,
    record.artifactName,
    record.researchName,
    record.sourceRef
  ].map(cleanString).filter(Boolean);
  const preferred = values.find(value => /(^|\/)SKILL\.md(?:$|[?#])/i.test(value))
    || values.find(value => /(^|\/)skills?\//i.test(value))
    || values.find(value => /\.(md|markdown)$/i.test(value) && !/(^|\/)(?:AGENTS|README|MEMORY)\.md$/i.test(value))
    || values.find(value => usageCounterKey(value));
  return usageTargetDisplayName(preferred);
}

function usageTargetDisplayName(value = '') {
  const text = cleanString(value).replace(/\\/g, '/').replace(/[?#].*$/, '');
  if (!text) return '';
  const parts = text.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || text;
  if (/^SKILL\.md$/i.test(last) && parts.length > 1) return parts[parts.length - 2];
  if (/^(AGENTS|README|MEMORY)\.md$/i.test(last) && parts.length <= 1) return '';
  return cleanUsageTargetLabel(last.replace(/\.(md|markdown)$/i, ''));
}

function compactOperationLogPayload(value, action = '') {
  if (!shouldCompactOperationPayload(action)) return value;
  return compactSyncPayload(value);
}

function shouldCompactOperationPayload(action = '') {
  return new Set(['SYNC_ZENTAO_TASKS', 'SYNC_ZENTAO_BUGS']).has(String(action || '').trim());
}

function compactSyncPayload(value) {
  if (Array.isArray(value)) return value.map(compactSyncPayload);
  if (!value || typeof value !== 'object') return value ?? null;
  const output = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === 'tasks' && Array.isArray(val)) {
      output.taskCount = val.length;
      continue;
    }
    if (key === 'bugs' && Array.isArray(val)) {
      output.bugCount = val.length;
      continue;
    }
    output[key] = compactSyncPayload(val);
  }
  return output;
}

function buildOperationDescription(action, targetName, result) {
  const suffix = targetName ? `：${targetName}` : '';
  return `${action}${suffix}${result === 'fail' ? '失败' : ''}`;
}

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value ?? null;
  const sensitive = /password|token|secret|credential|cookie|authorization|private|key/i;
  return Object.fromEntries(Object.entries(value).map(([key, val]) => {
    if (sensitive.test(key)) return [key, '[REDACTED]'];
    return [key, redactSensitive(val)];
  }));
}

function findTaskIndex(tasks = [], task = {}) {
  const direct = tasks.findIndex(item => item.id === task.id);
  if (direct >= 0) return direct;
  if (!task.projectId || !task.taskNo) return -1;
  return tasks.findIndex(item => item.projectId === task.projectId && item.taskNo === task.taskNo);
}

function mergeTask(previous = {}, next = {}, updatedAt = new Date().toISOString()) {
  const preserveManualWorkload = hasManualTaskWorkload(previous) && !hasManualTaskWorkload(next);
  const merged = {
    ...previous,
    ...next,
    id: taskIdFor(next.projectId || previous.projectId, next.taskNo || previous.taskNo, next.title || previous.title),
    source: previous.source === 'zentao' || next.source === 'zentao' ? 'zentao' : next.source || previous.source,
    createdAt: previous.createdAt || next.createdAt,
    archivedAt: next.isCurrent === false ? previous.archivedAt || next.archivedAt : next.archivedAt || '',
    updatedAt
  };
  if (preserveManualWorkload) {
    merged.workloadLevel = previous.workloadLevel || previous.workloadEstimate?.level || '';
    merged.workloadEstimate = previous.workloadEstimate || null;
  }
  return merged;
}

function hasManualTaskWorkload(task = {}) {
  return Boolean(
    normalizeTaskWorkloadLevel(task.workloadLevel || task.workloadEstimate?.level)
    && (!task.workloadEstimate || task.workloadEstimate.source === 'manual')
  );
}

function taskIdentityKey(task = {}) {
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
    createdAt: previous.createdAt || next.createdAt,
    updatedAt: String(previous.updatedAt || '') > String(next.updatedAt || '') ? previous.updatedAt : next.updatedAt,
    lastSyncedAt: String(previous.lastSyncedAt || '') > String(next.lastSyncedAt || '') ? previous.lastSyncedAt : next.lastSyncedAt,
    isCurrent,
    syncStatus: isCurrent ? 'current' : 'non_current',
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

function normalizeBug(input) {
  const now = new Date().toISOString();
  const bugNo = String(input.bugNo || input.id || '').trim();
  return {
    id: input.id || `zentao_bug_${bugNo}`,
    projectId: input.projectId || '',
    bugNo,
    title: input.title || `ZenTao bug ${bugNo}`,
    developer: input.developer || '',
    assignedTo: input.assignedTo || '',
    productId: input.productId || '',
    status: input.status || '',
    severity: input.severity || '',
    pri: input.pri || '',
    deadline: input.deadline || '',
    openedAt: input.openedAt || '',
    updatedAt: input.updatedAt || now,
    createdAt: input.createdAt || input.openedAt || now,
    zentao: input.zentao || {}
  };
}

function normalizeAiFlowRecord(input = {}) {
  const now = new Date().toISOString();
  const taskNameAndNo = String(input.taskNameAndNo || input.rawTaskName || input.title || input.taskTitle || '').trim();
  const taskNo = cleanTaskNo(input.taskNo || taskNameAndNo);
  const id = input.id || aiFlowRecordIdFor(input.projectId, taskNo, taskNameAndNo, input.sheetRowNumber);
  const completion = parsePercent(input.flowCompletion ?? input.completion ?? input.fullFlowCompletion);
  const status = normalizeAiFlowStatus(input.status);
  return {
    id,
    projectId: input.projectId || '',
    taskId: input.taskId || '',
    taskNo,
    taskNameAndNo,
    taskTitle: cleanTaskTitle(input.taskTitle || taskNameAndNo || '未命名 AI 任务', taskNo),
    zentaoStatus: input.zentaoStatus || input.zentao?.originalStatus || '',
    zentao: input.zentao || {},
    developer: input.developer || '',
    agentModel: input.agentModel || '',
    requirementDoc: input.requirementDoc || '',
    dataModelBuild: input.dataModelBuild || '',
    figmaToPage: input.figmaToPage || '',
    apiOrchestration: input.apiOrchestration || '',
    autoCodeQuality: input.autoCodeQuality || '',
    devQualityReport: input.devQualityReport || '',
    qualificationAssessment: input.qualificationAssessment || '',
    autoFix: input.autoFix || '',
    flowCompletion: completion,
    totalDuration: input.totalDuration || '',
    summaryIssues: input.summaryIssues || '',
    status,
    source: input.source || 'manual',
    sheetSourceUrl: input.sheetSourceUrl || '',
    sheetRowNumber: Number(input.sheetRowNumber || 0),
    importedAt: input.importedAt || '',
    createdBy: input.createdBy || '',
    updatedBy: input.updatedBy || '',
    deletedBy: input.deletedBy || '',
    deletedAt: input.deletedAt || '',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

function normalizeArtProgressEvent(input = {}) {
  const now = new Date().toISOString();
  const eventType = cleanString(input.eventType || 'task_progress');
  return {
    id: cleanString(input.id) || randomUUID(),
    eventType,
    runId: cleanString(input.runId || input.taskRunId),
    projectId: cleanString(input.projectId),
    projectName: cleanString(input.projectName),
    zentaoTaskId: cleanString(input.zentaoTaskId || input.zentaoId || input.taskNo),
    zentaoBugId: cleanString(input.zentaoBugId || input.bugId),
    taskId: cleanString(input.taskId),
    taskNo: cleanString(input.taskNo || input.zentaoTaskId || input.zentaoId),
    title: cleanString(input.title || input.taskTitle),
    memberAccount: cleanString(input.memberAccount || input.operatorAccount),
    memberName: cleanString(input.memberName || input.operatorName),
    skillId: cleanString(input.skillId),
    skillName: cleanString(input.skillName),
    repoPath: cleanString(input.repoPath),
    stage: cleanString(input.stage),
    status: cleanString(input.status || statusForArtEventType(eventType)),
    summary: cleanString(input.summary),
    source: cleanString(input.source) || 'workbench',
    metadata: isPlainObject(input.metadata) ? input.metadata : {},
    createdAt: cleanString(input.createdAt) || now
  };
}

function cleanString(value = '') {
  return String(value ?? '').trim();
}

function canonicalUsagePersonName(value = '') {
  const text = cleanString(value);
  if (!text) return '';
  return artDeptAccountNameMap.get(text.toLowerCase()) || text;
}

function samePersonName(left = '', right = '') {
  const a = normalizePersonLoose(left);
  const b = normalizePersonLoose(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function normalizePersonLoose(value = '') {
  return String(value || '').toLowerCase().replace(/[\s._@-]+/g, '').replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

function statusForArtEventType(eventType = '') {
  if (eventType === 'task_started' || eventType === 'task_progress' || eventType === 'skill_called') return 'running';
  if (eventType === 'task_blocked') return 'blocked';
  if (eventType === 'task_completed') return 'completed';
  if (eventType === 'task_failed') return 'failed';
  if (eventType === 'research_started' || eventType === 'research_progress' || eventType === 'tool_used') return 'running';
  if (eventType === 'research_blocked') return 'blocked';
  if (eventType === 'research_finding' || eventType === 'research_summary' || eventType === 'research_artifact') return 'completed';
  if (eventType === 'reporter_installed' || eventType === 'reporter_test') return 'connected';
  return 'running';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hydrateAiFlowRecordZentao(record = {}, taskByIdentity = new Map()) {
  if (record.zentaoStatus || !record.projectId || !record.taskNo) return record;
  const task = taskByIdentity.get(`${record.projectId}:${record.taskNo}`);
  if (!task) return record;
  return {
    ...record,
    taskId: record.taskId || task.id || '',
    zentaoStatus: task.zentaoStatus || task.zentao?.originalStatus || '',
    zentao: {
      ...(record.zentao || {}),
      ...(task.zentao || {}),
      originalStatus: task.zentaoStatus || task.zentao?.originalStatus || ''
    }
  };
}

function findAiFlowRecordIndex(records = [], record = {}) {
  const direct = records.findIndex(item => item.id === record.id);
  if (direct >= 0) return direct;
  if (!record.projectId || !record.taskNo) return -1;
  return records.findIndex(item => item.projectId === record.projectId && item.taskNo === record.taskNo);
}

function aiFlowRecordIdFor(projectId = '', taskNo = '', title = '', sheetRowNumber = 0) {
  const identity = taskNo || (sheetRowNumber ? `sheet-row-${sheetRowNumber}` : title) || randomUUID();
  return `ai_flow_${safeRecordId(projectId || 'project')}_${safeRecordId(identity)}`;
}

function normalizeAiFlowStatus(status = '') {
  const value = String(status || '').trim();
  if (/deleted|删除/.test(value)) return 'deleted';
  if (/draft|草稿/.test(value)) return 'draft';
  if (/confirmed|确认|正式/.test(value)) return 'confirmed';
  return 'draft';
}

function parsePercent(value) {
  if (value === null || value === undefined || value === '') return 0;
  const matched = String(value).match(/-?\d+(?:\.\d+)?/);
  const number = matched ? Number(matched[0]) : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function safeRecordId(value = '') {
  return String(value || '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || randomUUID();
}

function normalizeTaskReview(input) {
  const now = new Date().toISOString();
  return {
    id: input.id || randomUUID(),
    projectId: input.projectId || '',
    taskId: input.taskId || '',
    taskNo: input.taskNo || '',
    runId: input.runId || '',
    decision: input.decision || 'approved',
    score: clampScore(input.score, 80),
    requirementScore: clampScore(input.requirementScore, 80),
    qualityScore: clampScore(input.qualityScore, 80),
    uiScore: clampScore(input.uiScore, 80),
    validationScore: clampScore(input.validationScore, 80),
    needsRework: Boolean(input.needsRework),
    bugCount: Math.max(0, Number(input.bugCount || 0)),
    criticalBugCount: Math.max(0, Number(input.criticalBugCount || 0)),
    comment: input.comment || '',
    reviewer: input.reviewer || '人工验收',
    createdAt: input.createdAt || now
  };
}

function normalizeTaskProcessingNote(input = {}) {
  const now = new Date().toISOString();
  const projectId = String(input.projectId || '').trim();
  const taskId = String(input.taskId || '').trim();
  const id = input.id || [projectId, taskId].filter(Boolean).join(':') || randomUUID();
  return {
    id,
    projectId,
    taskId,
    taskNo: String(input.taskNo || '').trim(),
    title: String(input.title || '').trim(),
    note: String(input.note || '').trim(),
    updatedBy: String(input.updatedBy || '').trim(),
    updatedByName: String(input.updatedByName || '').trim(),
    updatedAt: input.updatedAt || now,
    createdAt: input.createdAt || now
  };
}

function clampScore(value, fallback = 0) {
  const number = Number(value ?? fallback);
  if (Number.isNaN(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function bugSortDate(bug) {
  return bug.updatedAt || bug.openedAt || bug.createdAt || '';
}

function isBugLikeTaskRecord(input = {}) {
  const text = [
    input.title,
    input.displayTitle,
    input.name,
    input.summary,
    input.requirement,
    input.sourceType,
    input.zentao?.sourceType
  ].filter(Boolean).join('\n');
  return /【\s*(?:内部|线上)?\s*bug\s*】|内部\s*bug|线上\s*bug|sourceType\s*[:：]?\s*bug/i.test(text);
}

function normalizeStageChecks(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([name, status]) => ({ name, status }));
  }
  return [];
}

function cleanTaskNo(value = '') {
  const matched = String(value).match(/\b\d{4,8}\b/);
  return matched ? matched[0] : '';
}

function cleanTaskTitle(value = '', taskNo = '') {
  return String(value || 'Untitled task')
    .replace(new RegExp(`^\\s*${taskNo}\\s*[-_：:]*\\s*`), '')
    .trim() || 'Untitled task';
}

function formatRunTitle(taskNo = '', title = '') {
  const cleanTitle = cleanTaskTitle(title, taskNo);
  return [taskNo, cleanTitle].filter(Boolean).join(' ');
}

function sanitizeTaskFolderName(value = '') {
  return String(value || 'Untitled task')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || randomUUID();
}

function taskIdFor(projectId, taskNo, title) {
  if (taskNo) return `${slugify(projectId)}_${taskNo}`;
  return `${slugify(projectId)}_${slugify(title)}`;
}

function normalizeProject(input) {
  const now = new Date().toISOString();
  const sourceType = normalizeRepositorySourceType(input.sourceType);
  const gitConfig = normalizeGitConfig(input.git || {});
  const rootPath = input.rootPath
    ? path.resolve(normalizeLocalPathInput(input.rootPath))
    : sourceType === 'git' && gitConfig.remoteUrl
      ? path.join(paths.dataDir, 'repositories', gitRepositoryFolderName(gitConfig.remoteUrl))
      : '';
  if (!input.name && !rootPath && !gitConfig.remoteUrl) {
    throw new Error('name or rootPath is required');
  }
  const id = input.id || slugify(input.name || path.basename(rootPath) || gitRepositoryFolderName(gitConfig.remoteUrl));
  return {
    id,
    name: input.name || id,
    sourceType,
    relatedProjectName: String(input.relatedProjectName || input.businessProjectName || '').trim(),
    figmaProjectUrl: String(input.figmaProjectUrl || input.figmaUrl || input.figmaLinks || '').trim(),
    rootPath,
    framework: input.framework || 'unknown',
    agentConfigPath: input.agentConfigPath || 'AGENTS.md',
    skillConfigPath: input.skillConfigPath || '.agent-hub/config.md',
    taskDir: input.taskDir || '.task',
    devCommand: input.devCommand || '',
    devFallbackCommand: input.devFallbackCommand || '',
    git: gitConfig,
    forbiddenCommands: Array.isArray(input.forbiddenCommands) ? input.forbiddenCommands : [],
    createdAt: input.createdAt || now
  };
}

function normalizeLocalPathInput(value = '') {
  const text = String(value || '').trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!text) return '';
  if (text === '~') return os.homedir();
  if (text.startsWith('~/')) return path.join(os.homedir(), text.slice(2));
  return text;
}

function normalizeRepositorySourceType(value = '') {
  const text = String(value || '').trim();
  if (['local', 'git', 'shared', 'research'].includes(text)) return text;
  return 'local';
}

function gitRepositoryFolderName(remoteUrl = '') {
  const text = String(remoteUrl || '').trim().replace(/\/+$/, '');
  const base = text.split(/[/:]/).filter(Boolean).pop() || 'repository';
  return slugify(base.replace(/\.git$/i, '')) || 'repository';
}

function defaultCodexConfig() {
  return {
    modelProvider: '',
    model: 'gpt-5.5',
    baseUrl: '',
    wireApi: '',
    envKeyName: 'OPENAI_API_KEY',
    apiKey: '',
    keyFingerprint: '',
    updatedAt: ''
  };
}

function normalizeCodexConfig(input = {}) {
  const envKeyName = String(input.envKeyName || 'OPENAI_API_KEY').trim();
  const apiKey = String(input.apiKey || '').trim();
  return {
    modelProvider: String(input.modelProvider || '').trim(),
    model: String(input.model || 'gpt-5.5').trim() || 'gpt-5.5',
    baseUrl: String(input.baseUrl || '').trim().replace(/\/+$/, ''),
    wireApi: String(input.wireApi || '').trim(),
    envKeyName: /^[A-Z_][A-Z0-9_]*$/.test(envKeyName) ? envKeyName : 'OPENAI_API_KEY',
    apiKey,
    keyFingerprint: String(input.keyFingerprint || (apiKey ? codexKeyFingerprint(apiKey) : '')).trim(),
    updatedAt: input.updatedAt || ''
  };
}

function normalizeAiMemberScoreSnapshot(input = {}) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const normalizedRows = rows
    .filter(row => row && typeof row === 'object')
    .map(row => ({
      name: cleanString(row.name),
      account: cleanString(row.account),
      level: cleanString(row.level),
      status: cleanString(row.status),
      score: clampNumber(row.score, 0, 100),
      productScore: clampNumber(row.productScore, 0, 100),
      usageScore: clampNumber(row.usageScore, 0, 100),
      runScore: clampNumber(row.runScore, 0, 100),
      penalty: clampNumber(row.penalty, 0, 100),
      productCount: clampNumber(row.productCount, 0, 10000),
      productValueScore: clampNumber(row.productValueScore, 0, 10000),
      productValueLevel: cleanString(row.productValueLevel),
      monthUsageCount: clampNumber(row.monthUsageCount, 0, 10000),
      monthUsageResultCount: clampNumber(row.monthUsageResultCount, 0, 10000),
      monthUsagePeopleCount: clampNumber(row.monthUsagePeopleCount, 0, 10000),
      monthUsageCoverageRate: clampNumber(row.monthUsageCoverageRate, 0, 100),
      monthValidationCount: clampNumber(row.monthValidationCount, 0, 10000),
      monthRunCount: clampNumber(row.monthRunCount, 0, 10000),
      monthRunSkillCount: clampNumber(row.monthRunSkillCount, 0, 10000),
      blockedCount: clampNumber(row.blockedCount, 0, 10000),
      topProducts: Array.isArray(row.topProducts)
        ? row.topProducts.map(item => cleanString(item)).filter(Boolean).slice(0, 5)
        : [],
      latestActivityAt: cleanString(row.latestActivityAt),
      reason: cleanString(row.reason)
    }))
    .filter(row => row.name || row.account);
  const month = cleanString(input.month);
  const monthlyRunScoreBuckets = mergeAiMemberMonthlyRunScoreBuckets(
    normalizeAiMemberMonthlyRunScoreBuckets(input.monthlyRunScoreBuckets),
    aiMemberMonthlyRunScoreBucketsFromSnapshotRows(normalizedRows, month)
  );
  return {
    rows: normalizedRows,
    monthlyRunScoreBuckets,
    key: cleanString(input.key),
    month,
    savedAt: cleanString(input.savedAt),
    updatedAt: cleanString(input.updatedAt),
    savedBy: {
      id: cleanString(input.savedBy?.id),
      username: cleanString(input.savedBy?.username),
      displayName: cleanString(input.savedBy?.displayName)
    }
  };
}

function aiMemberMonthlyRunScoreBucketsFromSnapshotRows(rows = [], month = '') {
  const monthKey = cleanString(month);
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return {};
  const people = {};
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const personKey = cleanString(row.account || row.name);
    if (!personKey) return;
    const completedRunCount = clampNumber(row.monthRunCount, 0, 10000);
    const completedRunSkillCount = clampNumber(row.monthRunSkillCount, 0, 10000);
    const blockedCount = clampNumber(row.blockedCount, 0, 10000);
    people[personKey] = {
      runIds: [],
      completedRunCount,
      completedRunSkillKeys: [],
      completedRunSkillCount,
      blockedRunIds: [],
      blockedCount,
      latestActivityAt: cleanString(row.latestActivityAt)
    };
  });
  return normalizeAiMemberMonthlyRunScoreBuckets({ [monthKey]: people });
}

function normalizeAiMemberMonthlyRunScoreBuckets(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return Object.fromEntries(Object.entries(source)
    .map(([month, people]) => {
      const monthKey = cleanString(month);
      if (!/^\d{4}-\d{2}$/.test(monthKey) || !people || typeof people !== 'object' || Array.isArray(people)) return null;
      const normalizedPeople = Object.fromEntries(Object.entries(people)
        .map(([person, bucket]) => {
          const personKey = cleanString(person);
          const value = bucket && typeof bucket === 'object' ? bucket : {};
          if (!personKey) return null;
          return [personKey, {
            runIds: Array.isArray(value.runIds) ? [...new Set(value.runIds.map(cleanString).filter(Boolean))].slice(0, 5000) : [],
            completedRunCount: Math.max(clampNumber(value.completedRunCount, 0, 10000), Array.isArray(value.runIds) ? value.runIds.map(cleanString).filter(Boolean).length : 0),
            completedRunSkillKeys: Array.isArray(value.completedRunSkillKeys) ? [...new Set(value.completedRunSkillKeys.map(cleanString).filter(Boolean))].slice(0, 10000) : [],
            completedRunSkillCount: Math.max(clampNumber(value.completedRunSkillCount, 0, 10000), Array.isArray(value.completedRunSkillKeys) ? value.completedRunSkillKeys.map(cleanString).filter(Boolean).length : 0),
            blockedRunIds: Array.isArray(value.blockedRunIds) ? [...new Set(value.blockedRunIds.map(cleanString).filter(Boolean))].slice(0, 5000) : [],
            blockedCount: Math.max(clampNumber(value.blockedCount, 0, 10000), Array.isArray(value.blockedRunIds) ? value.blockedRunIds.map(cleanString).filter(Boolean).length : 0),
            latestActivityAt: cleanString(value.latestActivityAt)
          }];
        })
        .filter(Boolean));
      return [monthKey, normalizedPeople];
    })
    .filter(Boolean));
}

function mergeAiMemberMonthlyRunScoreBuckets(existing = {}, incoming = {}) {
  const next = normalizeAiMemberMonthlyRunScoreBuckets(existing);
  const add = normalizeAiMemberMonthlyRunScoreBuckets(incoming);
  Object.entries(add).forEach(([month, people]) => {
    if (!next[month]) next[month] = {};
    Object.entries(people).forEach(([person, bucket]) => {
      const current = next[month][person] || {
        runIds: [],
        completedRunCount: 0,
        completedRunSkillKeys: [],
        completedRunSkillCount: 0,
        blockedRunIds: [],
        blockedCount: 0,
        latestActivityAt: ''
      };
      const runIds = [...new Set([...current.runIds, ...bucket.runIds])].slice(0, 5000);
      const completedRunSkillKeys = [...new Set([...current.completedRunSkillKeys, ...bucket.completedRunSkillKeys])].slice(0, 10000);
      const blockedRunIds = [...new Set([...current.blockedRunIds, ...bucket.blockedRunIds])].slice(0, 5000);
      next[month][person] = {
        runIds,
        completedRunCount: Math.max(runIds.length, Number(current.completedRunCount || 0), Number(bucket.completedRunCount || 0)),
        completedRunSkillKeys,
        completedRunSkillCount: Math.max(completedRunSkillKeys.length, Number(current.completedRunSkillCount || 0), Number(bucket.completedRunSkillCount || 0)),
        blockedRunIds,
        blockedCount: Math.max(blockedRunIds.length, Number(current.blockedCount || 0), Number(bucket.blockedCount || 0)),
        latestActivityAt: [current.latestActivityAt, bucket.latestActivityAt].filter(Boolean).sort().pop() || ''
      };
    });
  });
  return next;
}

function clampNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function normalizeRunCodexRequest(input = {}) {
  const allowedReasoning = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
  const reasoningEffort = String(input.reasoningEffort || input.modelReasoningEffort || '').trim();
  return {
    model: String(input.model || '').trim(),
    reasoningEffort: allowedReasoning.has(reasoningEffort) ? reasoningEffort : '',
    requestStandard: String(input.requestStandard || '').trim().slice(0, 2000),
    source: String(input.source || '').trim().slice(0, 80)
  };
}

function normalizeRunMaterialSnapshots(input = []) {
  const source = Array.isArray(input) ? input : [];
  const seen = new Set();
  const snapshots = [];
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const snapshot = {
      path: cleanString(item.path || item.relativePath || item.sourceValue).replaceAll('\\', '/').replace(/^\/+/, '').slice(0, 500),
      sourceValue: cleanString(item.sourceValue || item.path || item.relativePath).slice(0, 500),
      title: cleanString(item.title || item.name).slice(0, 200),
      kind: cleanString(item.kind || item.inventoryKind).slice(0, 40),
      content: String(item.content || '').trim().slice(0, 60000)
    };
    const key = snapshot.path || snapshot.sourceValue || snapshot.title;
    if (!key || !snapshot.content || seen.has(key)) continue;
    seen.add(key);
    snapshots.push(snapshot);
  }
  return snapshots;
}

function codexKeyFingerprint(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return `key_${createHash('sha256').update(text).digest('hex').slice(0, 12)}`;
}

export async function enforceRetentionNow() {
  if (!retentionEnabled) return;
  for (const file of retentionPaths) {
    const current = await readJson(file, null);
    if (current === null || current === undefined) continue;
    const next = await applyRetentionToValue(file, current);
    if (next !== current) await writeJson(file, next, { skipRetention: true });
  }
}

async function applyRetentionToValue(file, value) {
  if (!retentionEnabled || !retentionPaths.has(file)) return value;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  if (Array.isArray(value)) {
    const { kept, expired } = splitRetentionRecords(value, cutoff, file);
    if (!expired.length) return value;
    await accumulateUsageCountersFromExpiredRecords(file, expired);
    return kept;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next = { ...value };
    for (const key of ['items', 'records', 'manualRecords', 'googleRecords', 'events', 'logs']) {
      if (!Array.isArray(value[key])) continue;
      const { kept, expired } = splitRetentionRecords(value[key], cutoff, file);
      if (!expired.length) continue;
      await accumulateUsageCountersFromExpiredRecords(file, expired);
      next[key] = kept;
      changed = true;
    }
    if (changed) next.retention = recordRetentionTime(next.retention);
    return changed ? next : value;
  }
  return value;
}

function splitRetentionRecords(records = [], cutoff = 0, file = '') {
  const kept = [];
  const expired = [];
  for (const record of records) {
    if (shouldKeepRecordForRetention(file, record)) {
      kept.push(record);
      continue;
    }
    const time = retentionRecordTime(record);
    if (time && time < cutoff) expired.push(record);
    else kept.push(record);
  }
  return { kept, expired };
}

function shouldKeepRecordForRetention(file = '', record = {}) {
  if (!record || typeof record !== 'object') return false;
  if (file === paths.tasks && record.source === 'zentao' && record.isCurrent !== false) return true;
  if (file === paths.bugs && record.source === 'zentao' && !/deleted|closed|done|completed|cancelled|canceled|passed|resolved/i.test(String(record.status || record.zentao?.status || ''))) return true;
  if (file === paths.operationLogs && !isMemberReportOperationLog(record)) return true;
  return false;
}

function isMemberReportOperationLog(record = {}) {
  const module = cleanString(record.module);
  const action = cleanString(record.action);
  const targetType = cleanString(record.targetType);
  const targetId = cleanString(record.targetId);
  if (module === 'art-progress') return true;
  if (targetType === 'art-progress-event') return true;
  if (['REPORT_ART_PROGRESS', 'UPDATE_ART_PROGRESS', 'DELETE_ART_PROGRESS'].includes(action)) return true;
  if (action === 'AUTO_UPSERT_SKILL_VALIDATION') return true;
  return /^skill-validation-from-art-progress-/i.test(targetId);
}

function retentionRecordTime(record = {}) {
  const candidates = [
    record.lastSyncedAt,
    record.updatedAt,
    record.createdAt,
    record.reportedAt,
    record.submittedAt,
    record.importedAt,
    record.generatedAt,
    record.openedAt,
    record.lastSyncedAt
  ];
  for (const value of candidates) {
    const time = Date.parse(String(value || '').trim());
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function recordRetentionTime(input = {}) {
  return {
    ...(input && typeof input === 'object' ? input : {}),
    days: retentionDays,
    lastAppliedAt: new Date().toISOString()
  };
}

function defaultUsageCounters() {
  const now = new Date().toISOString();
  return {
    version: 1,
    logicVersion: usageCounterLogicVersion,
    retentionDays,
    updatedAt: now,
    buckets: {}
  };
}

function normalizeUsageCounters(input = {}) {
  const fallback = defaultUsageCounters();
  const rawBuckets = input && typeof input === 'object' && input.buckets && typeof input.buckets === 'object'
    ? input.buckets
    : {};
  const buckets = {};
  for (const [key, value] of Object.entries(rawBuckets)) {
    const bucket = normalizeUsageCounterBucket(value, key);
    if (!bucket.key) continue;
    if (buckets[bucket.key]) mergeUsageCounterBucket(buckets[bucket.key], bucket);
    else buckets[bucket.key] = bucket;
  }
  return {
    ...fallback,
    ...input,
    version: 1,
    logicVersion: input.logicVersion || '',
    retentionDays,
    updatedAt: input.updatedAt || fallback.updatedAt,
    buckets
  };
}

function normalizeUsageCounterBucket(input = {}, fallbackKey = '') {
  const key = usageCounterBucketCanonicalKey(input, fallbackKey);
  if (!key) return { key: '' };
  const people = input.people && typeof input.people === 'object' ? input.people : {};
  const normalizedPeople = {};
  for (const [person, count] of Object.entries(people)) {
    const personKey = cleanString(person);
    if (!personKey) continue;
    normalizedPeople[personKey] = Math.max(0, Number(count || 0));
  }
  const count = Math.max(0, Number(input.count ?? input.usageCount ?? 0));
  const researchSyncCount = Math.max(0, Number(input.researchSyncCount || input.researchCount || 0));
  const validationCount = Math.max(0, Number(input.validationCount || 0));
  const hasExplicitUsageCount = ['usageOnlyCount', 'directUsageCount', 'usageCount'].some(field => Object.prototype.hasOwnProperty.call(input, field));
  const hasTypedNonUsageCount = Object.prototype.hasOwnProperty.call(input, 'researchSyncCount')
    || Object.prototype.hasOwnProperty.call(input, 'researchCount')
    || Object.prototype.hasOwnProperty.call(input, 'validationCount');
  const rawUsageCount = hasExplicitUsageCount
    ? input.usageOnlyCount ?? input.directUsageCount ?? input.usageCount
    : (hasTypedNonUsageCount ? 0 : input.count);
  const usageCount = Math.max(0, Number(rawUsageCount || 0));
  const usagePeopleSource = input.usagePeople && typeof input.usagePeople === 'object' ? input.usagePeople : null;
  const normalizedUsagePeople = {};
  if (usagePeopleSource) {
    for (const [person, personCount] of Object.entries(usagePeopleSource)) {
      const personKey = cleanString(person);
      if (!personKey) continue;
      normalizedUsagePeople[personKey] = Math.max(0, Number(personCount || 0));
    }
  }
  return {
    key,
    target: cleanString(input.target || input.targetName || fallbackKey),
    count,
    usageCount,
    researchSyncCount,
    validationCount,
    eventKeys: Array.isArray(input.eventKeys) ? input.eventKeys.map(cleanString).filter(Boolean) : [],
    usageEventKeys: Array.isArray(input.usageEventKeys) ? input.usageEventKeys.map(cleanString).filter(Boolean) : [],
    aliases: normalizeLineList([
      ...(Array.isArray(input.aliases) ? input.aliases : normalizeLineList(input.aliases || [])),
      ...(Array.isArray(input.aliasHistory) ? input.aliasHistory : normalizeLineList(input.aliasHistory || [])),
      ...(Array.isArray(input.historicalAliases) ? input.historicalAliases : normalizeLineList(input.historicalAliases || []))
    ]),
    people: normalizedPeople,
    usagePeople: normalizedUsagePeople,
    peopleCount: Number(input.peopleCount || Object.keys(normalizedPeople).length),
    usagePeopleCount: Number(input.usagePeopleCount || Object.keys(normalizedUsagePeople).length),
    firstAt: cleanString(input.firstAt),
    lastAt: cleanString(input.lastAt),
    updatedAt: cleanString(input.updatedAt)
  };
}

function usageCounterBucketCanonicalKey(input = {}, fallbackKey = '') {
  const values = [
    input.target,
    input.targetName,
    ...(Array.isArray(input.aliases) ? input.aliases : normalizeLineList(input.aliases || [])),
    ...(Array.isArray(input.aliasHistory) ? input.aliasHistory : normalizeLineList(input.aliasHistory || [])),
    ...(Array.isArray(input.historicalAliases) ? input.historicalAliases : normalizeLineList(input.historicalAliases || [])),
    input.key,
    fallbackKey
  ];
  for (const value of values) {
    const key = usageCounterKey(value);
    if (key) return key;
  }
  return '';
}

let usageCounterKindFixCache = null;

async function normalizeHistoricalUsageCounterKinds(counters = defaultUsageCounters()) {
  if (!counters?.buckets || typeof counters.buckets !== 'object') return counters;
  const inventoryIdentity = await usageInventoryIdentity();
  const usageBucketRebuildMap = await historicalUsageBucketRebuildMap(inventoryIdentity);
  const nonUsageLogs = await historicalNonUsageOperationLogs();
  const usageSources = await historicalUsageEventSources();
  const ownerMap = await historicalUsageEventOwnerMap();
  const buckets = {};
  let changed = false;
  for (const [key, inputBucket] of Object.entries(counters.buckets)) {
    const bucket = normalizeUsageCounterBucket(inputBucket, key);
    if (isTechnicalUsageCounterBucket(bucket) || isNonInventoryUsageCounterBucket(bucket, inventoryIdentity)) {
      changed = true;
      continue;
    }
    if (applyHistoricalUsageBucketRebuild(bucket, usageBucketRebuildMap)) changed = true;
    if (normalizeTaskArtBriefLegacyUsageBucket(bucket)) changed = true;
    if (normalizeArtProgressReporterSelfUsageBucket(bucket, ownerMap)) changed = true;
    if (normalizeUsageBucketAliases(bucket)) changed = true;
    const eventKeys = Array.isArray(bucket.eventKeys) ? bucket.eventKeys.filter(Boolean) : [];
    const misclassified = historicalNonUsageEventKeySetForBucket(bucket, nonUsageLogs);
    const badCount = misclassified.size ? eventKeys.filter(eventKey => misclassified.has(eventKey)).length : 0;
    if (badCount > 0) {
      const currentUsage = Number(bucket.usageCount || 0);
      bucket.usageCount = Math.max(0, currentUsage - badCount);
      bucket.count = Math.max(
        bucket.usageCount + Number(bucket.validationCount || 0) + Number(bucket.researchSyncCount || 0),
        Number(bucket.count || 0) - badCount
      );
      if (currentUsage !== bucket.usageCount) changed = true;
    }
    if (rebuildHistoricalUsagePeople(bucket, usageSources)) changed = true;
    if (remapProxyUsagePeople(bucket, ownerMap)) changed = true;
    if (normalizeUsageBucketTotals(bucket)) changed = true;
    if (buckets[bucket.key]) {
      mergeUsageCounterBucket(buckets[bucket.key], bucket);
      changed = true;
    } else {
      buckets[bucket.key] = bucket;
    }
  }
  for (const [key, item] of usageBucketRebuildMap.entries()) {
    if (buckets[key]) continue;
    const sourceSet = item.sources instanceof Set ? item.sources : new Set();
    const canCreateHistoricalBucket = sourceSet.has('skill-validation')
      || (inventoryIdentity?.keys instanceof Set && inventoryIdentity.keys.has(key) && sourceSet.has('run'))
      || (inventoryIdentity?.keys instanceof Set && inventoryIdentity.keys.has(key) && sourceSet.has('operation-log'))
      || (key === taskArtBriefUsageCounterKey && sourceSet.has('task-art-brief'));
    if (!canCreateHistoricalBucket) continue;
    const usageEventKeys = [...(item.usageEventKeys || [])];
    if (!usageEventKeys.length) continue;
    const bucket = normalizeUsageCounterBucket({
      key,
      target: item.target || key,
      count: usageEventKeys.length,
      usageCount: usageEventKeys.length,
      usagePeople: item.usagePeople || {},
      people: item.usagePeople || {},
      eventKeys: [...(item.eventKeys || [])],
      usageEventKeys,
      firstAt: item.firstAt || '',
      lastAt: item.lastAt || '',
      updatedAt: item.lastAt || item.firstAt || ''
    }, key);
    if (normalizeUsageBucketTotals(bucket)) changed = true;
    buckets[bucket.key] = bucket;
    changed = true;
  }
  if (!changed) return counters;
  return {
    ...counters,
    buckets
  };
}

let usageInventoryIdentityCache = null;

async function usageInventoryIdentity() {
  const signature = await usageInventoryIdentitySignature();
  if (usageInventoryIdentityCache?.signature === signature) return usageInventoryIdentityCache;
  const [projectScanCache, versionOverrides] = await Promise.all([
    readJson(paths.projectScanCache, {}),
    readJson(paths.skillVersionOverrides, {})
  ]);
  const keys = new Set([taskArtBriefUsageCounterKey]);
  const texts = new Set(['zentao-art-brief-product']);
  const addValue = value => {
    const text = cleanString(value);
    if (!text || !isInventoryUsageIdentityValue(text)) return;
    for (const candidate of usageInventoryIdentityCandidates(text)) {
      const key = usageCounterKey(candidate);
      if (!key || isGenericUsageTarget(key) || isTechnicalUsageTarget(candidate)) continue;
      keys.add(key);
      texts.add(compactUsageTargetText(candidate));
    }
  };
  const addSkill = skill => {
    if (!skill || typeof skill !== 'object') return;
    [
      skill.id,
      skill.title,
      skill.productDisplayName,
      skill.productFileName,
      skill.displayName,
      skill.commonName,
      skill.originalTitle,
      skill.path,
      skill.relativePath,
      skill.git?.relativePath,
      skill.productGroupPath,
      ...(Array.isArray(skill.aliases) ? skill.aliases : []),
      ...(Array.isArray(skill.manualAliases) ? skill.manualAliases : []),
      ...(Array.isArray(skill.aliasHistory) ? skill.aliasHistory : [])
    ].forEach(addValue);
  };
  for (const rawScan of Object.values(projectScanCache && typeof projectScanCache === 'object' ? projectScanCache : {})) {
    const scan = rawScan?.scan && typeof rawScan.scan === 'object' ? rawScan.scan : rawScan;
    for (const skill of Array.isArray(scan?.skills) ? scan.skills : []) addSkill(skill);
  }
  for (const record of Object.values(versionOverrides && typeof versionOverrides === 'object' ? versionOverrides : {})) {
    if (!record || typeof record !== 'object') continue;
    [
      record.key,
      record.id,
      record.title,
      record.relativePath,
      record.path,
      ...(Array.isArray(record.aliases) ? record.aliases : [])
    ].forEach(addValue);
  }
  usageInventoryIdentityCache = { signature, keys, texts };
  return usageInventoryIdentityCache;
}

async function usageInventoryIdentitySignature() {
  const values = await Promise.all([
    fs.stat(paths.projectScanCache).catch(() => null),
    fs.stat(paths.skillVersionOverrides).catch(() => null)
  ]);
  return values.map(stat => stat ? `${Math.round(stat.mtimeMs)}:${stat.size}` : '0:0').join('|');
}

function usageInventoryIdentityCandidates(value = '') {
  const text = cleanString(value).replace(/\\/g, '/').replace(/[?#].*$/, '');
  if (!text) return [];
  const parts = text.split('/').map(part => cleanString(part)).filter(Boolean);
  const candidates = [text];
  if (parts.length) {
    const last = parts[parts.length - 1];
    candidates.push(last, last.replace(/\.(md|markdown)$/i, ''));
    if (/^SKILL\.md$/i.test(last) && parts.length > 1) candidates.push(parts[parts.length - 2]);
    if (/^(README|AGENTS|MEMORY)\.md$/i.test(last)) {
      return candidates;
    }
    for (const part of parts.slice(0, -1).reverse()) {
      if (!/^(skills?|references?|runs?|generated|assets|data|art-git)$/i.test(part)) candidates.push(part);
      if (candidates.length >= 8) break;
    }
  }
  return candidates.filter((item, index, array) => item && array.indexOf(item) === index);
}

function isInventoryUsageIdentityValue(value = '') {
  const text = cleanString(value).replace(/\\/g, '/');
  if (!text || isTechnicalUsageTarget(text)) return false;
  if (looksLikeTaskOrProjectIdentifier(text)) return false;
  if (looksLikeUrlTarget(text)) return false;
  if (looksLikePlatformScriptTarget(text)) return false;
  if (looksLikeLongUsageSummaryTarget(text)) return false;
  const key = usageCounterKey(text);
  return Boolean(key && !isGenericUsageTarget(key));
}

function usageBucketMatchesInventory(bucket = {}, inventoryIdentity = {}) {
  if (bucket?.key === taskArtBriefUsageCounterKey) return true;
  const keys = inventoryIdentity?.keys instanceof Set ? inventoryIdentity.keys : new Set();
  const texts = inventoryIdentity?.texts instanceof Set ? inventoryIdentity.texts : new Set();
  const values = bucketUsageTargetValues(bucket);
  return values.filter(isInventoryUsageIdentityValue).some(value => {
    const key = usageCounterKey(value);
    if (key && keys.has(key)) return true;
    const compact = compactUsageTargetText(value);
    return Boolean(compact && [...texts].some(text => {
      if (!text) return false;
      if (compact === text) return true;
      return (text.length >= 8 && compact.includes(text)) || (compact.length >= 8 && text.includes(compact));
    }));
  });
}

let usageInventoryMatcherCache = null;

function targetMatchesUsageInventory(value = '', inventoryIdentity = null) {
  const inventory = inventoryIdentity || usageInventoryIdentityCache;
  const signature = inventory?.signature || '';
  if (!usageInventoryMatcherCache || usageInventoryMatcherCache.signature !== signature) {
    usageInventoryMatcherCache = {
      signature,
      keys: inventory?.keys instanceof Set ? inventory.keys : new Set([taskArtBriefUsageCounterKey]),
      texts: inventory?.texts instanceof Set ? inventory.texts : new Set(['zentao-art-brief-product'])
    };
  }
  return usageBucketMatchesInventory({
    key: usageCounterKey(value),
    target: value,
    aliases: [value]
  }, usageInventoryMatcherCache);
}

function isNonInventoryUsageCounterBucket(bucket = {}, inventoryIdentity = {}) {
  if (!bucket?.key || bucket.key === taskArtBriefUsageCounterKey) return false;
  if (usageBucketMatchesInventory(bucket, inventoryIdentity)) return false;
  const values = normalizeLineList([
    bucket.key,
    bucket.target,
    ...(Array.isArray(bucket.aliases) ? bucket.aliases : normalizeLineList(bucket.aliases || []))
  ]);
  if (values.some(value => looksLikeTaskOrProjectIdentifier(value) || looksLikeUrlTarget(value) || looksLikePlatformScriptTarget(value) || looksLikeLongUsageSummaryTarget(value))) return true;
  if (values.some(value => looksLikeSkillOrMarkdownMaterial(value) && !isGenericUsageTarget(value))) return false;
  return true;
}

function normalizeTaskArtBriefLegacyUsageBucket(bucket = {}) {
  if (!bucket || bucket.key !== taskArtBriefUsageCounterKey) return false;
  let changed = false;
  const legacyCount = Math.max(0, Math.round(Number(bucket.count || 0)));
  const currentUsage = Math.max(0, Math.round(Number(bucket.usageCount || 0)));
  if (legacyCount > currentUsage) {
    bucket.usageCount = legacyCount;
    changed = true;
  }
  const people = bucket.people && typeof bucket.people === 'object' ? bucket.people : {};
  const usagePeople = bucket.usagePeople && typeof bucket.usagePeople === 'object' ? bucket.usagePeople : {};
  const usageTotal = Object.values(usagePeople).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  const peopleTotal = Object.values(people).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  if (peopleTotal > usageTotal) {
    bucket.usagePeople = { ...people };
    bucket.usagePeopleCount = Object.keys(bucket.usagePeople).length;
    changed = true;
  }
  return changed;
}

function normalizeArtProgressReporterSelfUsageBucket(bucket = {}, ownerMap = new Map()) {
  if (!bucket || bucket.key !== artProgressReporterUsageCounterKey) return false;
  let changed = false;
  const researchCount = Math.max(0, Math.round(Number(bucket.researchSyncCount || 0)));
  const existingUsage = Math.max(0, Math.round(Number(bucket.usageCount || 0)));
  const eventKeys = Array.isArray(bucket.eventKeys) ? bucket.eventKeys.map(cleanString).filter(Boolean) : [];
  const usageEventKeys = Array.isArray(bucket.usageEventKeys) ? bucket.usageEventKeys.map(cleanString).filter(Boolean) : [];
  const historicalEventKeySet = new Set(eventKeys);
  const additionalUsageEventKeys = usageEventKeys.filter(eventKey => eventKey && !historicalEventKeySet.has(eventKey));
  const usageCount = Math.max(existingUsage, researchCount + additionalUsageEventKeys.length, usageEventKeys.length);
  if (usageCount > existingUsage) {
    bucket.usageCount = usageCount;
    changed = true;
  }
  const people = bucket.people && typeof bucket.people === 'object' ? bucket.people : {};
  const usagePeople = bucket.usagePeople && typeof bucket.usagePeople === 'object' ? bucket.usagePeople : {};
  const additionalPeople = {};
  for (const eventKey of additionalUsageEventKeys) {
    const owners = ownerMap.get(eventKey) || [];
    const uniqueOwners = owners
      .map(canonicalUsagePersonName)
      .filter(owner => owner && !isUsageProxyPerson(owner) && !looksLikeUuid(owner))
      .filter((owner, index, array) => array.findIndex(item => samePersonName(item, owner)) === index);
    for (const owner of uniqueOwners.length ? uniqueOwners : [unknownUsagePersonName]) {
      additionalPeople[owner] = Number(additionalPeople[owner] || 0) + 1;
    }
  }
  const mergedUsagePeople = mergeArtProgressReporterSelfUsagePeople(people, additionalPeople, usagePeople, usageCount);
  if (usageCount > 0 && JSON.stringify(usagePeople) !== JSON.stringify(mergedUsagePeople)) {
    bucket.usagePeople = mergedUsagePeople;
    bucket.usagePeopleCount = Object.keys(mergedUsagePeople).length;
    changed = true;
  }
  if (usageCount > 0 && eventKeys.length && usageEventKeys.length < Math.min(usageCount, eventKeys.length)) {
    const mergedUsageEventKeys = [...usageEventKeys, ...eventKeys]
      .filter((eventKey, index, array) => eventKey && array.indexOf(eventKey) === index)
      .slice(-500);
    if (JSON.stringify(usageEventKeys) !== JSON.stringify(mergedUsageEventKeys)) {
      bucket.usageEventKeys = mergedUsageEventKeys;
      changed = true;
    }
  }
  if (!bucket.target || usageCounterKey(bucket.target) !== artProgressReporterUsageCounterKey) {
    bucket.target = artProgressReporterUsageTarget;
    changed = true;
  }
  return changed;
}

function mergeArtProgressReporterSelfUsagePeople(basePeople = {}, additionalPeople = {}, existingUsagePeople = {}, usageCount = 0) {
  const next = {};
  const add = (person = '', count = 0, mode = 'sum') => {
    const key = canonicalUsagePersonName(person);
    const value = Math.max(0, Math.round(Number(count || 0)));
    if (!key || isUsageProxyPerson(key) || value <= 0) return;
    if (mode === 'max') next[key] = Math.max(Number(next[key] || 0), value);
    else next[key] = Number(next[key] || 0) + value;
  };
  Object.entries(basePeople || {}).forEach(([person, count]) => add(person, count, 'sum'));
  Object.entries(additionalPeople || {}).forEach(([person, count]) => add(person, count, 'sum'));
  Object.entries(existingUsagePeople || {})
    .filter(([person]) => canonicalUsagePersonName(person) !== unknownUsagePersonName)
    .forEach(([person, count]) => add(person, count, 'max'));
  const limit = Math.max(0, Math.round(Number(usageCount || 0)));
  const total = Object.values(next).reduce((sum, value) => sum + Number(value || 0), 0);
  if (limit && total < limit) next[unknownUsagePersonName] = Number(next[unknownUsagePersonName] || 0) + (limit - total);
  return limit && total > limit ? capUsagePeopleCounts(next, limit) : next;
}

function normalizeUsageBucketAliases(bucket = {}) {
  if (!bucket || typeof bucket !== 'object') return false;
  const rawAliases = Array.isArray(bucket.aliases) ? bucket.aliases : normalizeLineList(bucket.aliases || []);
  const aliases = rawAliases
    .map(cleanString)
    .filter(Boolean)
    .filter(value => isCleanUsageBucketAlias(value, bucket.key))
    .filter((value, index, array) => array.findIndex(item => usageCounterKey(item) === usageCounterKey(value)) === index)
    .slice(-50);
  const changed = JSON.stringify(rawAliases) !== JSON.stringify(aliases);
  bucket.aliases = aliases;
  return changed;
}

function isCleanUsageBucketAlias(value = '', bucketKey = '') {
  const text = cleanString(value).replace(/\\/g, '/');
  if (!text) return false;
  if (!isStrongUsageTargetValue(text)) return false;
  if (looksLikeTaskOrProjectIdentifier(text)) return false;
  if (looksLikeUrlTarget(text)) return false;
  if (looksLikePlatformScriptTarget(text)) return false;
  if (looksLikeLongUsageSummaryTarget(text)) return false;
  const key = usageCounterKey(text);
  if (!key) return false;
  if (key !== bucketKey && !isInventoryUsageIdentityValue(text)) return false;
  const parts = text.split('/').filter(Boolean);
  if (parts.length >= 3 && !looksLikePrimaryArtifactTarget(text)) return false;
  return true;
}

function mergeUsageCounterBucket(target = {}, source = {}) {
  target.count = Math.max(0, Math.round(Number(target.count || 0))) + Math.max(0, Math.round(Number(source.count || 0)));
  target.usageCount = Math.max(0, Math.round(Number(target.usageCount || 0))) + Math.max(0, Math.round(Number(source.usageCount || 0)));
  target.validationCount = Math.max(0, Math.round(Number(target.validationCount || 0))) + Math.max(0, Math.round(Number(source.validationCount || 0)));
  target.researchSyncCount = Math.max(0, Math.round(Number(target.researchSyncCount || 0))) + Math.max(0, Math.round(Number(source.researchSyncCount || 0)));
  target.aliases = [...(Array.isArray(target.aliases) ? target.aliases : []), source.target, ...(Array.isArray(source.aliases) ? source.aliases : [])]
    .map(cleanString)
    .filter(Boolean)
    .filter(value => isCleanUsageBucketAlias(value, target.key))
    .filter((value, index, array) => array.findIndex(item => usageCounterKey(item) === usageCounterKey(value)) === index)
    .slice(-80);
  target.eventKeys = [...(Array.isArray(target.eventKeys) ? target.eventKeys : []), ...(Array.isArray(source.eventKeys) ? source.eventKeys : [])]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(-500);
  target.usageEventKeys = [...(Array.isArray(target.usageEventKeys) ? target.usageEventKeys : []), ...(Array.isArray(source.usageEventKeys) ? source.usageEventKeys : [])]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(-500);
  target.people = mergeUsageCounterPeople(target.people, source.people);
  target.usagePeople = mergeUsageCounterPeople(target.usagePeople, source.usagePeople);
  target.peopleCount = Object.keys(target.people || {}).length;
  target.usagePeopleCount = Object.keys(target.usagePeople || {}).length;
  if (source.firstAt) target.firstAt = target.firstAt ? (String(target.firstAt).localeCompare(String(source.firstAt)) <= 0 ? target.firstAt : source.firstAt) : source.firstAt;
  if (source.lastAt) target.lastAt = target.lastAt ? (String(target.lastAt).localeCompare(String(source.lastAt)) >= 0 ? target.lastAt : source.lastAt) : source.lastAt;
  if (source.updatedAt) target.updatedAt = target.updatedAt ? (String(target.updatedAt).localeCompare(String(source.updatedAt)) >= 0 ? target.updatedAt : source.updatedAt) : source.updatedAt;
  normalizeUsageBucketTotals(target);
  return target;
}

function mergeUsageCounterPeople(left = {}, right = {}) {
  const output = {};
  for (const source of [left, right]) {
    for (const [person, count] of Object.entries(source && typeof source === 'object' ? source : {})) {
      const key = canonicalUsagePersonName(person);
      const value = Math.max(0, Math.round(Number(count || 0)));
      if (!key || value <= 0) continue;
      output[key] = Number(output[key] || 0) + value;
    }
  }
  return output;
}

let usageCounterRebuildMapCache = null;

function storedSkillValidationRows(input = {}) {
  const rows = [
    ...(Array.isArray(input.records) ? input.records : []),
    ...(Array.isArray(input.googleRecords) ? input.googleRecords : []),
    ...(Array.isArray(input.manualRecords) ? input.manualRecords : [])
  ];
  const seen = new Set();
  const output = [];
  for (const record of rows) {
    if (!record || typeof record !== 'object') continue;
    const key = cleanString(record.id)
      || [
        record.sourceRef,
        record.artifactName,
        record.researchName,
        record.validator,
        record.submittedAt,
        record.createdAt,
        record.importedAt
      ].map(cleanString).join('::');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(record);
  }
  return output;
}

async function historicalUsageBucketRebuildMap(inventoryIdentity = null) {
  const inventory = inventoryIdentity || await usageInventoryIdentity();
  if (usageCounterRebuildMapCache?.signature === inventory.signature) return usageCounterRebuildMapCache.map;
  const [artProgressEvents, operationLogs, runs, validations] = await Promise.all([
    readJson(paths.artProgressEvents, []),
    readJson(paths.operationLogs, []),
    readJson(paths.runs, []),
    readJson(paths.skillValidations, {})
  ]);
  const map = new Map();
  const addTarget = (target = '', owners = [], eventKey = '', at = '', source = '') => {
    const key = usageCounterKey(target);
    if (!key || !eventKey) return;
    const ownerList = (Array.isArray(owners) ? owners : [owners])
      .flatMap(value => normalizeLineList(value))
      .map(canonicalUsagePersonName)
      .filter(owner => owner && !isUsageProxyPerson(owner) && !looksLikeUuid(owner));
    if (!ownerList.length) return;
    const bucket = map.get(key) || {
      key,
      target: cleanString(target),
      usageCount: 0,
      usagePeople: {},
      eventKeys: new Set(),
      usageEventKeys: new Set(),
      sources: new Set(),
      firstAt: '',
      lastAt: ''
    };
    if (source) bucket.sources.add(source);
    if (bucket.eventKeys.has(eventKey)) {
      map.set(key, bucket);
      return;
    }
    const isUsageSource = source !== 'skill-validation' || inventory?.keys?.has(key);
    bucket.eventKeys.add(eventKey);
    if (isUsageSource) {
      bucket.usageEventKeys.add(eventKey);
      bucket.usageCount += 1;
      ownerList
        .filter((owner, index, array) => array.findIndex(item => samePersonName(item, owner)) === index)
        .forEach(owner => {
          bucket.usagePeople[owner] = Number(bucket.usagePeople[owner] || 0) + 1;
        });
    }
    if (at) {
      bucket.firstAt = bucket.firstAt ? (String(bucket.firstAt).localeCompare(String(at)) <= 0 ? bucket.firstAt : at) : at;
      bucket.lastAt = bucket.lastAt ? (String(bucket.lastAt).localeCompare(String(at)) >= 0 ? bucket.lastAt : at) : at;
    }
    map.set(key, bucket);
  };

  for (const event of Array.isArray(artProgressEvents) ? artProgressEvents : []) {
    for (const target of usageTargetsFromArtProgressEvent(event)) {
      if (cleanString(target.kind) !== 'usage') continue;
      addTarget(target.target, [event.memberName, event.memberAccount], target.eventKey, target.at || event.createdAt || event.updatedAt || event.reportedAt || '', 'art-progress');
    }
  }

  for (const log of Array.isArray(operationLogs) ? operationLogs : []) {
    const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
    const at = cleanString(log.createdAt || log.updatedAt);
    const owners = usageOwnersFromOperationLog(log);
    const eventKey = usageEventKey('operation-log', log.id || log.targetId || log.targetName, at);
    if (isSkillValidationOperationLog(log)) {
      for (const target of usageTargetsFromSkillValidationOperationLog(log, inventory)) {
        addTarget(target.target, [target.person, ...owners], target.eventKey || eventKey, at, 'operation-log');
      }
      continue;
    }
    if (isArtProgressReporterSelfUsageOperationLog(log)) {
      for (const target of artProgressReporterSelfUsageTargetsFromOperationLog(log)) {
        addTarget(target.target, [target.person, ...owners], target.eventKey || eventKey, at, 'operation-log');
      }
      continue;
    }
    if (!isHistoricalUsageOperationLog(log)) continue;
    if (isTaskArtBriefUsageOperationLog(log)) {
      addTarget('zentao-art-brief-product', owners.length ? owners : [unknownUsagePersonName], eventKey, at, 'task-art-brief');
      continue;
    }
    for (const target of usageTargetsFromOperationLog(log, inventory)) {
      addTarget(target.target, target.person ? [target.person] : owners, target.eventKey || eventKey, at, 'operation-log');
    }
  }

  for (const run of Array.isArray(runs) ? runs : []) {
    if (!isUsageLikeRun(run)) continue;
    const at = cleanString(run.startedAt || run.createdAt);
    const owners = usageOwnersFromRun(run);
    const eventKey = usageEventKey('run-usage', run.id || run.primarySkillPath || run.stage || run.title, '');
    const values = runUsageTargetValues(run);
    for (const target of values.flatMap(usageTargetCandidates)) addTarget(target, owners, eventKey, at, 'run');
  }

  for (const record of storedSkillValidationRows(validations)) {
    if (!isPositiveSkillValidationUsage(record)) continue;
    const at = skillValidationUsageAt(record);
    const owners = usageOwnersFromSkillValidation(record);
    const eventKey = skillValidationUsageEventKey(record);
    for (const target of skillValidationUsageTargets(record).flatMap(usageTargetCandidates)) {
      addTarget(target, owners, eventKey, at, 'skill-validation');
    }
  }

  usageCounterRebuildMapCache = { signature: inventory.signature, map };
  return map;
}

function applyHistoricalUsageBucketRebuild(bucket = {}, rebuildMap = new Map()) {
  if (!bucket?.key || !rebuildMap?.size) return false;
  const targetValues = bucketUsageTargetValues(bucket);
  const matched = new Map();
  const addMatch = key => {
    const normalized = usageCounterKey(key);
    if (!normalized || !rebuildMap.has(normalized)) return;
    matched.set(normalized, rebuildMap.get(normalized));
  };
  addMatch(bucket.key);
  for (const target of targetValues) addMatch(target);
  if (!matched.size) return false;
  const existingUsageCount = Math.max(0, Math.round(Number(bucket.usageCount || 0)));
  const existingUsagePeople = bucket.usagePeople && typeof bucket.usagePeople === 'object' ? bucket.usagePeople : {};
  const usagePeople = {};
  const eventKeys = new Set();
  const usageEventKeys = new Set();
  let rebuiltUsageCount = 0;
  let firstAt = '';
  let lastAt = '';
  for (const item of matched.values()) {
    for (const eventKey of item.eventKeys || []) {
      if (!eventKey || eventKeys.has(eventKey)) continue;
      eventKeys.add(eventKey);
      rebuiltUsageCount += 1;
    }
    for (const eventKey of item.usageEventKeys || []) {
      if (eventKey) usageEventKeys.add(eventKey);
    }
    for (const [person, count] of Object.entries(item.usagePeople || {})) {
      if (!person || isUsageProxyPerson(person)) continue;
      usagePeople[person] = Number(usagePeople[person] || 0) + Number(count || 0);
    }
    if (item.firstAt) firstAt = firstAt ? (String(firstAt).localeCompare(String(item.firstAt)) <= 0 ? firstAt : item.firstAt) : item.firstAt;
    if (item.lastAt) lastAt = lastAt ? (String(lastAt).localeCompare(String(item.lastAt)) >= 0 ? lastAt : item.lastAt) : item.lastAt;
  }
  rebuiltUsageCount = Math.max(0, rebuiltUsageCount);
  const usageEventKeyList = [
    ...(Array.isArray(bucket.usageEventKeys) ? bucket.usageEventKeys.map(cleanString).filter(Boolean) : []),
    ...usageEventKeys
  ].filter((eventKey, index, array) => array.indexOf(eventKey) === index);
  const usageCount = Math.max(existingUsageCount, rebuiltUsageCount, usageEventKeyList.length);
  const nextUsagePeople = mergeHistoricalUsagePeople(existingUsagePeople, usagePeople, usageCount);
  const changed = Number(bucket.usageCount || 0) !== usageCount
    || JSON.stringify(bucket.usagePeople || {}) !== JSON.stringify(nextUsagePeople)
    || Number(bucket.usagePeopleCount || 0) !== Object.keys(nextUsagePeople).length
    || JSON.stringify(bucket.usageEventKeys || []) !== JSON.stringify(usageEventKeyList);
  bucket.usageCount = usageCount;
  bucket.usagePeople = nextUsagePeople;
  bucket.usagePeopleCount = Object.keys(nextUsagePeople).length;
  bucket.usageEventKeys = usageEventKeyList;
  if (firstAt && (!bucket.firstAt || String(firstAt).localeCompare(String(bucket.firstAt)) < 0)) bucket.firstAt = firstAt;
  if (lastAt && (!bucket.lastAt || String(lastAt).localeCompare(String(bucket.lastAt)) > 0)) bucket.lastAt = lastAt;
  return changed;
}

function mergeHistoricalUsagePeople(existing = {}, rebuilt = {}, usageCount = 0) {
  const next = {};
  const add = (person = '', count = 0) => {
    const key = canonicalUsagePersonName(person);
    const value = Math.max(0, Math.round(Number(count || 0)));
    if (!key || isUsageProxyPerson(key) || value <= 0) return;
    next[key] = Math.max(Number(next[key] || 0), value);
  };
  for (const [person, count] of Object.entries(existing || {})) add(person, count);
  for (const [person, count] of Object.entries(rebuilt || {})) add(person, count);
  const limit = Math.max(0, Math.round(Number(usageCount || 0)));
  const total = Object.values(next).reduce((sum, value) => sum + Number(value || 0), 0);
  return limit && total > limit ? capUsagePeopleCounts(next, limit) : next;
}

let usageCounterSourceCache = null;

async function historicalUsageEventSources() {
  if (usageCounterSourceCache) return usageCounterSourceCache;
  const [artProgressEvents, operationLogs, runs, validations] = await Promise.all([
    readJson(paths.artProgressEvents, []),
    readJson(paths.operationLogs, []),
    readJson(paths.runs, []),
    readJson(paths.skillValidations, {})
  ]);
  usageCounterSourceCache = {
    artProgressEvents: (Array.isArray(artProgressEvents) ? artProgressEvents : []).filter(isUsageCountableArtProgressEvent),
    operationLogs: (Array.isArray(operationLogs) ? operationLogs : []).filter(log => isHistoricalUsageOperationLog(log) || isSkillValidationOperationLog(log)),
    runs: (Array.isArray(runs) ? runs : []).filter(isUsageLikeRun),
    skillValidations: storedSkillValidationRows(validations).filter(isPositiveSkillValidationUsage)
  };
  return usageCounterSourceCache;
}

function isUsageCountableArtProgressEvent(event = {}) {
  const type = cleanString(event.eventType);
  if (!['skill_called', 'tool_used', 'task_completed'].includes(type)) return false;
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  if (metadata.countAsSkillUsage === false || metadata.countAsProductUsage === false) return false;
  return hasStrongArtProgressUsageTarget(event);
}

function isHistoricalUsageOperationLog(log = {}) {
  const action = cleanString(log.action);
  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  if (metadata.countAsSkillUsage === false || metadata.countAsProductUsage === false) return false;
  if ([
    'GENERATE_ZENTAO_ART_BRIEF',
    'REUSE_ZENTAO_ART_BRIEF',
    'REGENERATE_ZENTAO_ART_BRIEF'
  ].includes(action)) return true;
  if (['UPDATE_LOCAL_WORKER_RUN', 'UPDATE_DIRECT_SKILL_RUN'].includes(action)) return isUsageLikeOperationLog(log);
  return metadata.countAsSkillUsage === true || metadata.countAsProductUsage === true;
}

function isSkillValidationOperationLog(log = {}) {
  if (!log || typeof log !== 'object') return false;
  if (cleanString(log.result).toLowerCase() === 'fail') return false;
  const action = cleanString(log.action);
  return [
    'AUTO_UPSERT_SKILL_VALIDATION',
    'UPSERT_SKILL_VALIDATION',
    'BACKFILL_SKILL_VALIDATION'
  ].includes(action);
}

function bucketUsageTargetValues(bucket = {}) {
  return normalizeLineList([
    bucket.target,
    ...(Array.isArray(bucket.aliases) ? bucket.aliases : [])
  ])
    .filter(value => usageCounterKey(value))
    .filter((value, index, array) => array.findIndex(item => usageCounterKey(item) === usageCounterKey(value)) === index)
    .slice(0, 80);
}

function isTechnicalUsageCounterBucket(bucket = {}) {
  if (!bucket?.key || bucket.key === taskArtBriefUsageCounterKey) return false;
  const values = normalizeLineList([
    bucket.key,
    bucket.target,
    ...(Array.isArray(bucket.aliases) ? bucket.aliases : normalizeLineList(bucket.aliases || []))
  ]);
  if (!values.length) return true;
  return !values.some(value => isStrongUsageTargetValue(value));
}

function rebuildHistoricalUsagePeople(bucket = {}, sources = {}) {
  if (!bucket || typeof bucket !== 'object') return false;
  const existingUsagePeople = bucket.usagePeople && typeof bucket.usagePeople === 'object' ? bucket.usagePeople : {};
  if (Object.keys(existingUsagePeople).some(person => person && !isUsageProxyPerson(person))) return false;
  const eventKeys = new Set(Array.isArray(bucket.eventKeys) ? bucket.eventKeys.filter(Boolean) : []);
  if (!eventKeys.size || Number(bucket.usageCount || 0) <= 0) return false;
  const targetValues = bucketUsageTargetValues(bucket);
  const usagePeople = {};
  const seen = new Set();
  const addHit = (hitKey = '', owners = []) => {
    if (!hitKey || !eventKeys.has(hitKey) || seen.has(hitKey)) return;
    const ownerList = (Array.isArray(owners) ? owners : [owners])
      .flatMap(value => normalizeLineList(value))
      .map(canonicalUsagePersonName)
      .filter(owner => owner && !isUsageProxyPerson(owner));
    if (!ownerList.length) return;
    seen.add(hitKey);
    ownerList
      .filter((owner, index, array) => array.findIndex(item => samePersonName(item, owner)) === index)
      .forEach(owner => {
        usagePeople[owner] = Number(usagePeople[owner] || 0) + 1;
      });
  };

  for (const event of sources.artProgressEvents || []) {
    const owners = [event.memberName, event.memberAccount];
    const baseId = event.id || event.skillName || event.title;
    const at = event.createdAt || event.updatedAt || event.reportedAt || '';
    addHit(usageEventKey('art-progress', baseId, at), owners);
    for (const target of targetValues) {
      addHit(usageEventKey('alias-art-progress', [baseId, target].filter(Boolean).join(':'), at), owners);
    }
    for (let index = 0; index < 8; index += 1) {
      addHit(usageEventKey('art-progress-artifact', `${baseId}:${index}`, at), owners);
    }
  }

  for (const log of sources.operationLogs || []) {
    const owners = usageOwnersFromOperationLog(log);
    const baseId = log.id || log.targetId || log.targetName;
    const at = log.createdAt || log.updatedAt || '';
    addHit(usageEventKey('operation-log', baseId, at), owners);
    for (const target of targetValues) {
      addHit(usageEventKey('alias-operation-log', [baseId, target].filter(Boolean).join(':'), at), owners);
    }
  }

  for (const run of sources.runs || []) {
    const owners = usageOwnersFromRun(run);
    const baseId = run.id || run.primarySkillPath || run.stage || run.title;
    const at = run.startedAt || run.createdAt || '';
    ['run-start', 'run-restart', 'run-resume', 'direct-skill-run'].forEach(source => {
      addHit(usageEventKey(source, baseId, at), owners);
    });
  }

  for (const record of sources.skillValidations || []) {
    addHit(skillValidationUsageEventKey(record), usageOwnersFromSkillValidation(record));
  }

  if (!Object.keys(usagePeople).length) return false;
  const usageCount = Math.max(0, Math.round(Number(bucket.usageCount || 0)));
  bucket.usagePeople = mergeHistoricalUsagePeople({}, usagePeople, usageCount);
  bucket.usagePeopleCount = Object.keys(bucket.usagePeople).length;
  return true;
}

let usageCounterNonUsageLogCache = null;

async function historicalNonUsageOperationLogs() {
  if (usageCounterNonUsageLogCache) return usageCounterNonUsageLogCache;
  const logs = await readJson(paths.operationLogs, []);
  usageCounterNonUsageLogCache = (Array.isArray(logs) ? logs : []).filter(isNonUsageOperationLog);
  return usageCounterNonUsageLogCache;
}

function historicalNonUsageEventKeySetForBucket(bucket = {}, logs = []) {
  const set = new Set();
  const targetValues = bucketUsageTargetValues(bucket);
  for (const log of Array.isArray(logs) ? logs : []) {
    const baseId = log.id || log.targetId || log.targetName;
    const eventKey = usageEventKey('operation-log', baseId, log.createdAt);
    if (eventKey) set.add(eventKey);
    const at = log.createdAt || log.updatedAt || '';
    for (const target of targetValues) {
      const aliasEventKey = usageEventKey('alias-operation-log', [baseId, target].filter(Boolean).join(':'), at);
      if (aliasEventKey) set.add(aliasEventKey);
    }
  }
  return set;
}

async function historicalNonUsageEventKeySet() {
  if (usageCounterKindFixCache) return usageCounterKindFixCache;
  const logs = await historicalNonUsageOperationLogs();
  const set = new Set();
  for (const log of Array.isArray(logs) ? logs : []) {
    const eventKey = usageEventKey('operation-log', log.id || log.targetId || log.targetName, log.createdAt);
    if (eventKey) set.add(eventKey);
  }
  usageCounterKindFixCache = set;
  return set;
}

let usageCounterOwnerMapCache = null;

async function historicalUsageEventOwnerMap() {
  if (usageCounterOwnerMapCache) return usageCounterOwnerMapCache;
  const map = new Map();
  const add = (eventKey = '', owners = []) => {
    const key = cleanString(eventKey);
    if (!key) return;
    const list = (Array.isArray(owners) ? owners : [owners])
      .flatMap(value => normalizeLineList(value))
      .map(canonicalUsagePersonName)
      .filter(owner => owner && !isUsageProxyPerson(owner));
    if (!list.length) return;
    const existing = map.get(key) || [];
    map.set(key, [...existing, ...list].filter((item, index, array) => array.findIndex(other => samePersonName(other, item)) === index));
  };
  const artProgressEvents = await readJson(paths.artProgressEvents, []);
  for (const event of Array.isArray(artProgressEvents) ? artProgressEvents : []) {
    const owners = [event.memberName, event.memberAccount, event.validator, event.walkthroughOwner];
    const baseId = event.id || event.skillName || event.title;
    const at = event.createdAt || event.updatedAt || event.reportedAt || '';
    add(usageEventKey('art-progress', baseId, at), owners);
    for (const target of usageTargetsFromArtProgressEvent(event)) {
      add(usageEventKey('alias-art-progress', [baseId, target.target].filter(Boolean).join(':'), at), owners);
    }
    for (let index = 0; index < 8; index += 1) {
      add(usageEventKey('art-progress-artifact', `${baseId}:${index}`, at), owners);
    }
  }
  const validations = await readJson(paths.skillValidations, {});
  for (const record of storedSkillValidationRows(validations)) {
    add(skillValidationUsageEventKey(record), usageOwnersFromSkillValidation(record));
  }
  const logs = await readJson(paths.operationLogs, []);
  for (const log of Array.isArray(logs) ? logs : []) {
    const ownerFromDescription = extractOwnerFromResearchSyncDescription(log.description || log.targetName || '');
    const owners = [ownerFromDescription, ...usageOwnersFromOperationLog(log)].filter(owner => !isUsageProxyPerson(owner));
    const baseId = log.id || log.targetId || log.targetName;
    add(usageEventKey('operation-log', baseId, log.createdAt), owners);
    if (isArtProgressReporterSelfUsageOperationLog(log)) {
      const after = log.after && typeof log.after === 'object' ? log.after : {};
      const reporterOwners = [
        after.memberName,
        after.memberAccount,
        ownerFromDescription,
        ...owners
      ].filter(owner => !isUsageProxyPerson(owner));
      add(usageEventKey('operation-log-reporter-self', log.targetId || after.id || log.id || log.targetName, log.createdAt || after.createdAt || log.updatedAt), reporterOwners);
    }
    if (isUsageLikeOperationLog(log)) {
      for (const target of usageTargetsFromOperationLog(log)) {
        add(usageEventKey('alias-operation-log', [baseId, target.target].filter(Boolean).join(':'), log.createdAt || log.updatedAt), owners);
      }
    }
  }
  usageCounterOwnerMapCache = map;
  return map;
}

function remapProxyUsagePeople(bucket = {}, ownerMap = new Map()) {
  if (!bucket.people || typeof bucket.people !== 'object') return false;
  const proxyEntries = Object.entries(bucket.people).filter(([person]) => isUsageProxyPerson(person));
  const usageProxyEntries = Object.entries(bucket.usagePeople || {}).filter(([person]) => isUsageProxyPerson(person));
  if (!proxyEntries.length && !usageProxyEntries.length) return false;
  const eventKeys = Array.isArray(bucket.eventKeys) ? bucket.eventKeys.filter(Boolean) : [];
  const ownerHits = new Map();
  for (const eventKey of eventKeys) {
    const owners = ownerMap.get(eventKey) || [];
    for (const owner of owners) {
      if (!owner || isUsageProxyPerson(owner)) continue;
      ownerHits.set(owner, Number(ownerHits.get(owner) || 0) + 1);
    }
  }
  const nextPeople = { ...bucket.people };
  const nextUsagePeople = { ...(bucket.usagePeople && typeof bucket.usagePeople === 'object' ? bucket.usagePeople : {}) };
  const distributeProxyCount = (target, proxyCount) => {
    if (!ownerHits.size) return;
    const totalHits = [...ownerHits.values()].reduce((sum, value) => sum + Number(value || 0), 0) || 1;
    let remaining = Math.max(0, Number(proxyCount || 0));
    const entries = [...ownerHits.entries()].sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
    for (const [owner, hitCount] of entries) {
      if (remaining <= 0) break;
      const isLast = owner === entries[entries.length - 1]?.[0];
      const value = isLast
        ? remaining
        : Math.max(0, Math.min(remaining, Math.round(Number(proxyCount || 0) * (Number(hitCount || 0) / totalHits))));
      if (value <= 0) continue;
      target[owner] = Number(target[owner] || 0) + value;
      remaining -= value;
    }
  };
  for (const [proxyPerson, proxyCount] of proxyEntries) {
    delete nextPeople[proxyPerson];
    distributeProxyCount(nextPeople, proxyCount);
  }
  for (const [proxyPerson, proxyCount] of usageProxyEntries) {
    delete nextUsagePeople[proxyPerson];
    distributeProxyCount(nextUsagePeople, proxyCount);
  }
  bucket.people = nextPeople;
  bucket.usagePeople = nextUsagePeople;
  bucket.peopleCount = Object.keys(nextPeople).length;
  bucket.usagePeopleCount = Object.keys(bucket.usagePeople || {}).length;
  return true;
}

function normalizeUsageBucketTotals(bucket = {}) {
  if (!bucket || typeof bucket !== 'object') return false;
  let changed = false;
  const usagePeople = {};
  for (const [person, personCount] of Object.entries(bucket.usagePeople || {})) {
    if (!person || isUsageProxyPerson(person)) {
      changed = true;
      continue;
    }
    const count = Math.max(0, Number(personCount || 0));
    if (count <= 0) {
      changed = true;
      continue;
    }
    usagePeople[person] = Number(usagePeople[person] || 0) + count;
  }
  const usageTotal = Object.values(usagePeople).reduce((sum, value) => sum + Number(value || 0), 0);
  let usageCount = Math.max(0, Math.round(Number(bucket.usageCount || 0)));
  const usageEventKeyCount = Array.isArray(bucket.usageEventKeys)
    ? bucket.usageEventKeys.map(cleanString).filter(Boolean).filter((value, index, array) => array.indexOf(value) === index).length
    : 0;
  if (usageEventKeyCount > usageCount) {
    usageCount = usageEventKeyCount;
    bucket.usageCount = usageCount;
    changed = true;
  }
  if (usageCount <= 0) {
    if (usageCount !== 0 || usageTotal !== 0 || Object.keys(bucket.usagePeople || {}).length) changed = true;
    bucket.usageCount = 0;
    bucket.usagePeople = {};
  } else if (usageTotal > usageCount) {
    changed = true;
    bucket.usagePeople = capUsagePeopleCounts(usagePeople, usageCount);
  } else {
    if (usageTotal < usageCount) {
      usagePeople[unknownUsagePersonName] = Number(usagePeople[unknownUsagePersonName] || 0) + (usageCount - usageTotal);
      changed = true;
    }
    bucket.usagePeople = usagePeople;
  }
  const usagePeopleCount = Object.keys(bucket.usagePeople || {}).length;
  if (Number(bucket.usagePeopleCount || 0) !== usagePeopleCount) {
    bucket.usagePeopleCount = usagePeopleCount;
    changed = true;
  }
  if (normalizeUsageBucketPeopleTotals(bucket)) changed = true;
  return changed;
}

function capUsagePeopleCounts(usagePeople = {}, limit = 0) {
  const remainingLimit = Math.max(0, Math.round(Number(limit || 0)));
  if (!remainingLimit) return {};
  let remaining = remainingLimit;
  const output = {};
  Object.entries(usagePeople)
    .map(([person, count]) => ({ person, count: Math.max(0, Math.round(Number(count || 0))) }))
    .filter(item => item.person && item.count > 0)
    .sort((left, right) => right.count - left.count || cleanString(left.person).localeCompare(cleanString(right.person)))
    .forEach(item => {
      if (remaining <= 0) return;
      const value = Math.min(item.count, remaining);
      if (value <= 0) return;
      output[item.person] = value;
      remaining -= value;
    });
  return output;
}

function normalizeUsageBucketPeopleTotals(bucket = {}) {
  if (!bucket || typeof bucket !== 'object') return false;
  const rawPeople = bucket.people && typeof bucket.people === 'object' ? bucket.people : {};
  const people = {};
  for (const [person, personCount] of Object.entries(rawPeople)) {
    if (!person || isUsageProxyPerson(person)) continue;
    const count = Math.max(0, Math.round(Number(personCount || 0)));
    if (count > 0) people[person] = Number(people[person] || 0) + count;
  }
  const peopleEntries = Object.entries(people).sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0) || cleanString(left[0]).localeCompare(cleanString(right[0])));
  const evidenceTotal = Math.max(
    0,
    Math.round(Number(bucket.usageCount || 0))
      + Math.round(Number(bucket.validationCount || 0))
      + Math.round(Number(bucket.researchSyncCount || 0))
  );
  const totalLimit = Math.max(0, Math.round(Number(bucket.count || 0)), evidenceTotal);
  let remaining = totalLimit;
  const nextPeople = {};
  for (const [person, personCount] of peopleEntries) {
    if (remaining <= 0) break;
    const value = Math.min(Math.max(0, Math.round(Number(personCount || 0))), remaining);
    if (value <= 0) continue;
    nextPeople[person] = value;
    remaining -= value;
  }
  const changed = JSON.stringify(rawPeople) !== JSON.stringify(nextPeople)
    || Number(bucket.peopleCount || 0) !== Object.keys(nextPeople).length;
  bucket.people = nextPeople;
  bucket.peopleCount = Object.keys(nextPeople).length;
  return changed;
}

function isUsageProxyPerson(person = '') {
  const text = cleanString(person).toLowerCase();
  return samePersonName(text, '研究同步助手')
    || samePersonName(text, '同步助手')
    || samePersonName(text, '系统同步助手')
    || text === 'art-progress-sync'
    || text === 'art-progress-reporter'
    || text === 'member-art-reporter'
    || text === 'art-workbench-sync-reporter';
}

function usageOwnersFromOperationLog(log = {}) {
  const action = cleanString(log.action);
  const before = log.before && typeof log.before === 'object' ? log.before : {};
  const after = log.after && typeof log.after === 'object' ? log.after : {};
  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  const primaryRunOwner = [
    after.assignedToName,
    after.developer,
    before.assignedToName,
    before.developer,
    metadata.assignedToName,
    metadata.developer,
    after.createdByName,
    before.createdByName,
    metadata.createdByName
  ].map(cleanString).find(owner => owner && !isUsageProxyPerson(owner));
  if (['START_RUN', 'RETRY_RUN', 'CREATE_DIRECT_SKILL_RUN', 'UPDATE_LOCAL_WORKER_RUN', 'UPDATE_DIRECT_SKILL_RUN'].includes(action) && primaryRunOwner) {
    return [primaryRunOwner];
  }
  const primaryLogOwner = [
    log.memberName,
    log.displayName,
    log.username
  ].map(cleanString).find(owner => owner && !isUsageProxyPerson(owner));
  return primaryLogOwner ? [primaryLogOwner] : [];
}

function primaryUsageOwnerFromOperationLog(log = {}, record = null) {
  const recordOwners = record && typeof record === 'object'
    ? [
        record.memberName,
        record.memberAccount,
        record.validator,
        record.walkthroughOwner,
        record.assignedToName,
        record.developer,
        record.createdByName,
        record.ownerName,
        record.username,
        record.displayName
      ]
    : [];
  const owner = [
    ...recordOwners,
    ...usageOwnersFromOperationLog(log)
  ]
    .flatMap(value => normalizeLineList(value))
    .map(cleanString)
    .find(value => value && !isUsageProxyPerson(value) && !looksLikeUuid(value));
  return owner || unknownUsagePersonName;
}

function usageOwnersFromRun(run = {}) {
  const owner = [
    run.assignedToName,
    run.developer,
    run.createdByName,
    run.ownerName
  ].map(cleanString).find(value => value && !isUsageProxyPerson(value));
  if (owner) return [owner];
  const fallback = [run.createdBy, run.ownerUserId]
    .map(cleanString)
    .find(value => value && !isUsageProxyPerson(value) && !looksLikeUuid(value));
	  return fallback ? [fallback] : [];
}

function usageOwnersFromSkillValidation(record = {}) {
  return [
    record.validator,
    record.walkthroughOwner,
    record.owner,
    record.updatedBy
  ]
    .flatMap(value => normalizeLineList(value))
    .map(cleanString)
    .filter(owner => owner && !isUsageProxyPerson(owner) && !looksLikeUuid(owner))
    .filter((owner, index, array) => array.findIndex(item => samePersonName(item, owner)) === index);
}

function looksLikeUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanString(value));
}

function extractOwnerFromResearchSyncDescription(value = '') {
  const match = cleanString(value).match(/([\u4e00-\u9fa5A-Za-z0-9_.-]{2,20})\s+同步\s+research/i);
  return cleanString(match?.[1] || '');
}

async function accumulateUsageCountersFromExpiredRecords(file, records = []) {
  const inventory = file === paths.operationLogs ? await usageInventoryIdentity().catch(() => null) : null;
  const targets = records.flatMap(record => usageTargetsFromRecord(file, record, inventory));
  if (!targets.length) return;
  await updateUsageCounters(targets);
}

async function updateUsageCounters(targets = []) {
  const normalizedTargets = normalizeUsageTargets(targets);
  if (!normalizedTargets.length) return { matched: 0 };
  const counters = await getUsageCounters();
  const now = new Date().toISOString();
  let matched = 0;
  for (const target of normalizedTargets) {
    const key = usageCounterKey(target.key || target.target);
    if (!key) continue;
    const bucket = normalizeUsageCounterBucket(counters.buckets[key] || { key, target: target.target }, key);
    const eventKey = cleanString(target.eventKey);
    if (eventKey && bucket.eventKeys.includes(eventKey)) continue;
    matched += 1;
    bucket.target = bucket.target || target.target || key;
    bucket.aliases = [
      ...(Array.isArray(bucket.aliases) ? bucket.aliases : []),
      target.target,
      target.key
    ]
      .map(cleanString)
      .filter(Boolean)
      .filter(value => isCleanUsageBucketAlias(value, key))
      .filter((value, index, array) => array.findIndex(item => usageCounterKey(item) === usageCounterKey(value)) === index)
      .slice(-50);
    bucket.count = Number(bucket.count || 0) + Number(target.count || 1);
    const kind = cleanString(target.kind || target.source);
    if (kind === 'validation' || kind === 'skill-validation') {
      bucket.validationCount = Number(bucket.validationCount || 0) + Number(target.count || 1);
    } else if (kind === 'research-sync' || kind === 'art-progress') {
      bucket.researchSyncCount = Number(bucket.researchSyncCount || 0) + Number(target.count || 1);
    } else {
      bucket.usageCount = Number(bucket.usageCount || 0) + Number(target.count || 1);
    }
    if (target.person) {
      bucket.people[target.person] = Number(bucket.people[target.person] || 0) + Number(target.count || 1);
      if (kind !== 'validation' && kind !== 'skill-validation' && kind !== 'research-sync' && kind !== 'art-progress') {
        bucket.usagePeople[target.person] = Number(bucket.usagePeople[target.person] || 0) + Number(target.count || 1);
      }
    }
    if (eventKey) bucket.eventKeys = [...bucket.eventKeys, eventKey].slice(-500);
    if (eventKey && kind !== 'validation' && kind !== 'skill-validation' && kind !== 'research-sync' && kind !== 'art-progress') {
      bucket.usageEventKeys = [...(Array.isArray(bucket.usageEventKeys) ? bucket.usageEventKeys : []), eventKey].slice(-500);
    }
    bucket.peopleCount = Object.keys(bucket.people).length;
    bucket.usagePeopleCount = Object.keys(bucket.usagePeople || {}).length;
    const at = target.at || '';
    bucket.firstAt = bucket.firstAt && at ? (String(bucket.firstAt).localeCompare(String(at)) <= 0 ? bucket.firstAt : at) : (bucket.firstAt || at);
    bucket.lastAt = bucket.lastAt && at ? (String(bucket.lastAt).localeCompare(String(at)) >= 0 ? bucket.lastAt : at) : (bucket.lastAt || at);
    bucket.updatedAt = now;
    counters.buckets[key] = bucket;
  }
  if (matched > 0) {
    counters.updatedAt = now;
    await writeJson(paths.usageCounters, counters, { skipRetention: true });
  }
  return { matched };
}

function usageTargetsFromRecord(file, record = {}, inventoryIdentity = null) {
  if (file === paths.artProgressEvents) return usageTargetsFromArtProgressEvent(record);
  if (file === paths.operationLogs) return usageTargetsFromOperationLog(record, inventoryIdentity);
  if (file === paths.skillValidations) return usageTargetsFromSkillValidation(record);
  return [];
}

function usageTargetsFromSkillValidation(record = {}) {
  if (!isPositiveSkillValidationUsage(record)) return [];
  const targetValues = skillValidationUsageTargets(record);
  return buildUsageTargets(targetValues, {
    person: usageOwnersFromSkillValidation(record)[0] || '',
    at: skillValidationUsageAt(record),
    source: 'skill-validation',
    kind: 'usage',
    eventKey: skillValidationUsageEventKey(record)
  });
}

function usageTargetsFromSkillValidationOperationLog(log = {}, inventoryIdentity = null) {
  if (!isSkillValidationOperationLog(log)) return [];
  const record = log.after && typeof log.after === 'object' ? log.after : {};
  if (!isPositiveSkillValidationUsage(record)) return [];
  const values = skillValidationOperationLogTargetValues(log);
  if (!values.length) return [];
  return buildUsageTargets(values, {
    person: usageOwnersFromSkillValidation(record)[0] || primaryUsageOwnerFromOperationLog(log, record),
    at: skillValidationUsageAt(record) || cleanString(log.createdAt || log.updatedAt),
    source: 'operation-log',
    kind: 'usage',
    eventKey: skillValidationUsageEventKey(record)
  }).filter(target => targetMatchesUsageInventory(target.target, inventoryIdentity));
}

function skillValidationOperationLogTargetValues(log = {}) {
  const record = log.after && typeof log.after === 'object' ? log.after : {};
  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  return [
    log.targetName,
    metadata.productName,
    metadata.artifactName,
    metadata.skillName,
    metadata.alias,
    metadata.path,
    metadata.filePath,
    metadata.skillPath,
    metadata.artifactPath,
    ...(Array.isArray(metadata.aliases) ? metadata.aliases : []),
    ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : []),
    ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : []),
    ...skillValidationUsageTargets(record),
    ...skillValidationEmbeddedArtifactTargets(record.researchName),
    ...skillValidationEmbeddedArtifactTargets(record.artifactName),
    ...skillValidationEmbeddedArtifactTargets(log.targetName)
  ]
    .map(cleanString)
    .filter(Boolean)
    .filter((value, index, array) => array.findIndex(item => usageCounterKey(item) === usageCounterKey(value)) === index);
}

function skillValidationEmbeddedArtifactTargets(value = '') {
  const text = cleanString(value).replace(/\\/g, '/');
  if (!text) return [];
  const matches = [
    ...text.matchAll(/(?:^|[\s"'「『【《(\[])([^"'「『【《)\]\s，,。；;、]*(?:skills?|SKILL)\/[^"'「『【《)\]\s，,。；;、]+\/SKILL\.md)(?=$|[\s"'」』】》)\]，,。；;、])/ig),
    ...text.matchAll(/(?:^|[\s"'「『【《(\[])([^"'「『【《)\]\s，,。；;、]+\.md)(?=$|[\s"'」』】》)\]，,。；;、])/ig)
  ].map(match => cleanString(match[1]).replace(/^[#\[]+|[\]]+$/g, ''));
  return matches.filter(Boolean);
}

function skillValidationUsageTargets(record = {}) {
  return [
    record.artifactName,
    record.researchName,
    record.artifactLocation,
    record.sourceRef
  ];
}

function skillValidationUsageAt(record = {}) {
  return cleanString(record.createdAt || record.submittedAt || record.importedAt || record.updatedAt);
}

function skillValidationUsageEventKey(record = {}) {
  return usageEventKey(
    'skill-validation',
    record.id || record.sourceRef || record.artifactName || record.researchName || record.artifactLocation,
    skillValidationUsageAt(record)
  );
}

function isPositiveSkillValidationUsage(record = {}) {
  if (!record || typeof record !== 'object') return false;
  if (record.deleted === true) return false;
  const validationText = cleanValidationUsageText([
    record.validationResult,
    record.status
  ]);
  const adviceText = cleanValidationUsageText(record.reuseAdvice);
  const evidenceText = cleanValidationUsageText([
    record.notes,
    record.summary,
    record.description,
    record.suggestion,
    record.issues
  ]);
  const resultText = `${validationText} ${adviceText}`.trim();
  const fullText = `${resultText} ${evidenceText}`.trim();
  if (!fullText) return false;
  if (/场景不匹配|不适用|无法复用|不可用|失败|未完成|取消|资料不完整|无效|不通过|待填写|待记录|待评估|待判断|暂不判断/.test(resultText)) return false;
  if (/可直接复用|部分可用|可用|可复用|建议.{0,12}复用|通过|已验证|验证完成|复用/.test(resultText)) return true;
  if (/已完成.{0,12}验证|实任务验证/.test(fullText)) return true;
  return record.walkthroughDone === true && /验证|回填|结论|结果/.test(fullText);
}

function cleanValidationUsageText(value = '') {
  return (Array.isArray(value) ? value : [value])
    .map(item => cleanString(item))
    .filter(item => item && item !== '-')
    .join(' ');
}

function usageTargetsFromArtProgressEvent(event = {}) {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  const defaultCount = Math.max(1, Number(metadata.usageCount || metadata.count || 1) || 1);
  const reporterSelfTargets = artProgressReporterSelfUsageTargetsFromEvent(event, defaultCount);
  if (!isUsageLikeArtProgressEvent(event)) return reporterSelfTargets;
  const kind = isUsageCountableArtProgressEvent(event) ? 'usage' : 'research-sync';
  const targetValues = artProgressStrongUsageTargetValues(event);
  const targets = buildUsageTargets(targetValues, {
    person: canonicalUsagePersonName(event.memberName || event.memberAccount),
    at: cleanString(event.createdAt),
    source: 'art-progress',
    kind,
    count: defaultCount,
    eventKey: usageEventKey('art-progress', event.id || event.skillName || event.title, event.createdAt)
  });
  const artifactTargets = [
    ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts : []),
    ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts : [])
  ].filter(item => isStrongUsageTargetValue(item?.path || item?.name || item?.id))
    .flatMap((item, index) => buildUsageTargets([item?.path, item?.name, item?.id], {
    person: canonicalUsagePersonName(event.memberName || event.memberAccount),
    at: cleanString(event.createdAt),
    source: 'art-progress',
    kind,
    count: Math.max(1, Number(item?.count || defaultCount) || 1),
    eventKey: usageEventKey('art-progress-artifact', `${event.id || event.skillName || event.title}:${index}`, event.createdAt)
  }));
  return [...targets, ...artifactTargets, ...reporterSelfTargets];
}

function artProgressReporterSelfUsageTargetsFromEvent(event = {}, defaultCount = 1) {
  if (!isArtProgressReporterSelfUsageEvent(event)) return [];
  return buildUsageTargets([artProgressReporterUsageTarget], {
    person: canonicalUsagePersonName(event.memberName || event.memberAccount),
    at: cleanString(event.createdAt),
    source: 'art-progress-reporter-self',
    kind: 'usage',
    count: Math.max(1, Number(defaultCount || 1) || 1),
    eventKey: artProgressReporterSelfUsageEventKey(event)
  });
}

function artProgressReporterSelfUsageEventKey(event = {}) {
  return usageEventKey('art-progress-reporter-self', event.id || event.targetId || event.skillName || event.title, event.createdAt || event.updatedAt);
}

function isArtProgressReporterSelfUsageEvent(event = {}) {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  if (metadata.reportedByArtProgressReporter !== true && metadata.countAsReporterSelfUsage !== true) return false;
  if (['reporter_test', 'reporter_installed'].includes(cleanString(event.eventType))) return false;
  if (metadata.countAsSkillUsage === false || metadata.countAsProductUsage === false || metadata.countAsReporterSelfUsage === false) return false;
  const person = canonicalUsagePersonName(event.memberName || event.memberAccount);
  return Boolean(person && !isUsageProxyPerson(person) && !looksLikeUuid(person));
}

function usageTargetsFromOperationLog(log = {}, inventoryIdentity = null) {
  if (isSkillValidationOperationLog(log)) return usageTargetsFromSkillValidationOperationLog(log, inventoryIdentity);
  const reporterSelfTargets = artProgressReporterSelfUsageTargetsFromOperationLog(log);
  if (reporterSelfTargets.length) return reporterSelfTargets;
  if (!isUsageLikeOperationLog(log)) return [];
  if (isTaskArtBriefUsageOperationLog(log)) {
    return buildUsageTargets(['zentao-art-brief-product'], {
      person: primaryUsageOwnerFromOperationLog(log),
      at: cleanString(log.createdAt),
      source: 'operation-log',
      kind: 'usage',
      eventKey: usageEventKey('operation-log', log.id || log.targetId || log.targetName, log.createdAt)
    });
  }
  const records = operationLogEmbeddedUsageRecords(log);
  const recordList = records.length ? records : [null];
  const targets = recordList.flatMap(record => buildUsageTargets(operationLogUsageTargetValues(log, record), {
    person: primaryUsageOwnerFromOperationLog(log, record),
    at: operationLogUsageRecordTime(log, record),
    source: 'operation-log',
    kind: 'usage',
    eventKey: operationLogUsageEventKey(log, record)
  }));
  return normalizeUsageTargets(targets.filter(target => targetMatchesUsageInventory(target.target, inventoryIdentity)));
}

function artProgressReporterSelfUsageTargetsFromOperationLog(log = {}) {
  if (!isArtProgressReporterSelfUsageOperationLog(log)) return [];
  const after = log.after && typeof log.after === 'object' ? log.after : {};
  const person = canonicalUsagePersonName(after.memberName || after.memberAccount || extractOwnerFromResearchSyncDescription(log.description || log.targetName || ''));
  return buildUsageTargets([artProgressReporterUsageTarget], {
    person,
    at: cleanString(log.createdAt || after.createdAt || log.updatedAt),
    source: 'operation-log-reporter-self',
    kind: 'usage',
    eventKey: usageEventKey('operation-log-reporter-self', log.targetId || after.id || log.id || log.targetName, cleanString(log.createdAt || after.createdAt || log.updatedAt))
  });
}

function isArtProgressReporterSelfUsageOperationLog(log = {}) {
  if (cleanString(log.result).toLowerCase() === 'fail') return false;
  if (cleanString(log.action) !== 'REPORT_ART_PROGRESS') return false;
  if (cleanString(log.module) !== 'art-progress' && cleanString(log.targetType) !== 'art-progress-event') return false;
  const after = log.after && typeof log.after === 'object' ? log.after : {};
  const actor = cleanString(log.username || log.displayName);
  const metadata = after.metadata && typeof after.metadata === 'object' ? after.metadata : {};
  if (metadata.countAsReporterSelfUsage === false) return false;
  if (['reporter_test', 'reporter_installed'].includes(cleanString(after.eventType))) return false;
  return actor === 'art-progress-reporter'
    || samePersonName(actor, '研究同步助手')
    || metadata.reportedByArtProgressReporter === true;
}

function operationLogEmbeddedUsageRecords(log = {}) {
  const after = log.after && typeof log.after === 'object' ? log.after : {};
  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  const fields = [
    'records',
    'items',
    'events',
    'logs',
    'results',
    'validations',
    'savedRecords',
    'usageRecords',
    'artifacts',
    'calledArtifacts',
    'matchedArtifacts',
    'artifactRecords'
  ];
  const records = [];
  for (const container of [after, metadata]) {
    for (const field of fields) {
      const value = container?.[field];
      if (!Array.isArray(value)) continue;
      value.forEach(item => {
        if (item && typeof item === 'object') records.push(item);
      });
    }
  }
  const seen = new Set();
  return records.filter(record => {
    const key = [
      record.id,
      record.sourceRef,
      record.eventId,
      record.runId,
      record.path,
      record.filePath,
      record.skillPath,
      record.artifactPath,
      record.name,
      record.title,
      record.artifactName,
      record.skillName
    ].map(cleanString).filter(Boolean).join('|');
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function operationLogUsageRecordTime(log = {}, record = null) {
  return cleanString(log.createdAt || log.updatedAt || record?.createdAt || record?.updatedAt || record?.reportedAt || record?.submittedAt);
}

function operationLogUsageEventKey(log = {}, record = null) {
  const action = cleanString(log.action);
  const after = log.after && typeof log.after === 'object' ? log.after : {};
  if (['UPDATE_LOCAL_WORKER_RUN', 'UPDATE_DIRECT_SKILL_RUN'].includes(action)) {
    return usageEventKey('run-usage', after.id || record?.id || log.targetId || after.primarySkillPath || after.stage || after.title || log.targetName, '');
  }
  const recordId = record && typeof record === 'object'
    ? cleanString(record.id || record.sourceRef || record.eventId || record.runId || record.path || record.filePath || record.skillPath || record.artifactPath || record.name || record.title || record.artifactName || record.skillName)
    : '';
  return usageEventKey('operation-log', [log.id || log.targetId || log.targetName, recordId].filter(Boolean).join(':'), cleanString(log.createdAt || log.updatedAt));
}

function operationLogUsageTargetValues(log = {}, record = null) {
  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  const after = log.after && typeof log.after === 'object' ? log.after : {};
  return [
    ...operationLogStructuredUsageValues(metadata),
    ...operationLogStructuredUsageValues(after),
    ...(record && typeof record === 'object' ? operationLogStructuredUsageValues(record) : []),
    operationLogDisplayTargetName(log),
    log.targetName
  ]
    .map(cleanString)
    .filter(Boolean)
    .filter((value, index, array) => array.findIndex(item => usageCounterKey(item) === usageCounterKey(value)) === index);
}

function operationLogStructuredUsageValues(input = {}) {
  if (!input || typeof input !== 'object') return [];
  const artifactItems = [
    ...(Array.isArray(input.selectedMaterialSnapshots) ? input.selectedMaterialSnapshots : []),
    ...(Array.isArray(input.materials) ? input.materials : []),
    ...(Array.isArray(input.referenceItems) ? input.referenceItems : []),
    ...(Array.isArray(input.calledArtifacts) ? input.calledArtifacts : []),
    ...(Array.isArray(input.matchedArtifacts) ? input.matchedArtifacts : []),
    ...(Array.isArray(input.artifacts) ? input.artifacts : [])
  ];
  const artifactValues = artifactItems.flatMap(item => {
    if (!item || typeof item !== 'object') return [item];
    return [
      item.path,
      item.filePath,
      item.relativePath,
      item.skillPath,
      item.artifactPath,
      item.sourceValue,
      item.id,
      item.name,
      item.title,
      item.skillName,
      item.artifactName
    ];
  });
  return [
    input.productName,
    input.productDisplayName,
    input.productFileName,
    input.sourceTitle,
    input.primarySkillPath,
    input.primarySkillTitle,
    input.skillPath,
    input.stage,
    input.skillName,
    input.artifactName,
    input.researchName,
    input.artifactLocation,
    input.operationName,
    input.alias,
    input.path,
    input.filePath,
    input.relativePath,
    input.repoPath,
    input.finalPath,
    input.artifactPath,
    input.sourceRef,
    input.title,
    ...normalizeLineList(input.showdocHints),
    ...normalizeLineList(input.selectedMaterialHints),
    ...(Array.isArray(input.aliases) ? input.aliases : []),
    ...(Array.isArray(input.artifactNames) ? input.artifactNames : []),
    ...(Array.isArray(input.artifactPaths) ? input.artifactPaths : []),
    ...(Array.isArray(input.skillPaths) ? input.skillPaths : []),
    ...artifactValues
  ];
}

function usageTargetsFromRun(run = {}, options = {}) {
  if (!isUsageLikeRun(run)) return [];
  const source = cleanString(options.source || 'run');
  const at = cleanString(options.at || run.startedAt || run.createdAt);
  const values = runUsageTargetValues(run);
  return buildUsageTargets(values, {
    person: cleanString(usageOwnersFromRun(run)[0] || ''),
    at,
    source,
    kind: 'usage',
    eventKey: usageEventKey('run-usage', run.id || run.primarySkillPath || run.stage || run.title, '')
  });
}

function isUsageLikeRun(run = {}) {
  if (!run || typeof run !== 'object') return false;
  const status = cleanString(run.status || run.workerStatus || run.platformStatus).toLowerCase();
  if (/cancel|canceled|cancelled|pending|queued|draft|deleted|void|running|claim|start/.test(status)) return false;
  if (!/completed|done|success|passed|conditional_pass|finished|blocked|failed/.test(status)) return false;
  if (run.sourceType === 'direct-skill' || run.executionMode === 'direct-skill') return true;
  if (normalizeWorkflowId(run.workflow || '') === 'art-single-skill') return true;
  if (cleanString(run.executionMode) === 'single-skill') return true;
  const values = [
    run.primarySkillPath,
    run.skillPath,
    run.stage,
    run.showdocHints,
    ...(Array.isArray(run.selectedMaterialHints) ? run.selectedMaterialHints : [])
  ].map(cleanString).filter(Boolean);
  if (!values.length) return false;
  return values.some(looksLikeSkillOrMarkdownMaterial);
}

function looksLikeSkillOrMarkdownMaterial(value = '') {
  const text = cleanString(value).replace(/\\/g, '/');
  if (!text) return false;
  return /(^|\/)SKILL\.md(?:$|[?#])/i.test(text)
    || /\.(md|markdown)(?:$|[?#])/i.test(text)
    || /\/(skills?|\.codex|\.claude|规范|资料库|references)\//i.test(text);
}

function runUsageTargetValues(run = {}) {
  const materialValues = [
    run.primarySkillPath,
    run.skillPath,
    run.stage,
    ...(Array.isArray(run.selectedMaterialHints) ? run.selectedMaterialHints : []),
    ...(Array.isArray(run.materials) ? run.materials.flatMap(item => [item?.path, item?.name, item?.title]) : []),
    ...(Array.isArray(run.referenceItems) ? run.referenceItems.flatMap(item => [item?.path, item?.name, item?.title]) : [])
  ]
    .map(cleanString)
    .filter(value => value && looksLikeSkillOrMarkdownMaterial(value) && isStrongUsageTargetValue(value));
  if (materialValues.length) return materialValues;
  return [
    run.productName,
    run.sourceTitle
  ]
    .map(cleanString)
    .filter(value => value && isStrongUsageTargetValue(value));
}

function artProgressStrongUsageTargetValues(event = {}) {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  const isSessionSummary = metadata.source === 'codex-session-summary';
  const structuredTargets = [
    ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts : []),
    ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts : [])
  ]
    .flatMap(item => [item?.path, item?.name, item?.id])
    .map(cleanString)
    .filter(value => value && isStrongUsageTargetValue(value) && (!isSessionSummary || looksLikePrimaryArtifactTarget(value)));
  const directTargets = [
    event.skillId,
    event.repoPath,
    metadata.path,
    metadata.filePath,
    metadata.finalPath,
    metadata.skillPath,
    metadata.artifactPath,
    metadata.artifactLocation,
    ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : [])
  ]
    .map(cleanString)
    .filter(value => value && isStrongUsageTargetValue(value) && (!isSessionSummary || looksLikePrimaryArtifactTarget(value)));
  if (isSessionSummary) return [...directTargets, ...structuredTargets];
  return [
    ...directTargets,
    ...structuredTargets,
    metadata.artifactName,
    metadata.skillName,
    event.skillName
  ]
    .map(cleanString)
    .filter(value => value && isStrongUsageTargetValue(value));
}

function hasStrongArtProgressUsageTarget(event = {}) {
  return artProgressStrongUsageTargetValues(event).length > 0;
}

function isStrongUsageTargetValue(value = '') {
  const text = cleanString(value).replace(/\\/g, '/').replace(/^[#\[]+|[\]]+$/g, '').trim();
  if (!text) return false;
  if (isTechnicalUsageTarget(text)) return false;
  if (looksLikeTaskOrProjectIdentifier(text)) return false;
  if (looksLikeUrlTarget(text)) return false;
  if (looksLikePlatformScriptTarget(text)) return false;
  if (looksLikeLongUsageSummaryTarget(text)) return false;
  if (/(^|\/)(references?|runs?)\//i.test(text)) return false;
  if (looksLikeSkillOrMarkdownMaterial(text)) {
    return text.split('/').filter(Boolean).some(part => {
      const cleaned = part.replace(/\.(md|markdown)$/i, '').replace(/^[#\[]+|[\]]+$/g, '').trim();
      return cleaned && !isTechnicalUsageTarget(cleaned) && !isGenericUsageTarget(cleaned) && !looksLikePlatformScriptTarget(cleaned);
    });
  }
  const compact = compactUsageTargetText(text);
  if (!compact || compact.length < 4) return false;
  return !isGenericUsageTarget(compact) && !isTechnicalUsageTarget(compact);
}

function looksLikePrimaryArtifactTarget(value = '') {
  const text = cleanString(value).replace(/\\/g, '/').replace(/^[#\[]+|[\]]+$/g, '').trim();
  if (!text || /(^|\/)(references?|runs?)\//i.test(text)) return false;
  if (/(^|\/)SKILL\.md$/i.test(text)) {
    const parts = text.split('/').filter(Boolean);
    const parent = parts.length > 1 ? parts[parts.length - 2] : '';
    return Boolean(parent && !isGenericUsageTarget(parent) && !isTechnicalUsageTarget(parent));
  }
  if (/\.(md|markdown)$/i.test(text)) {
    const base = text.split('/').filter(Boolean).pop() || '';
    return !/^(AGENTS|README|MEMORY|资料)\.md$/i.test(base);
  }
  return false;
}

function usageSearchTextFromRecord(record = {}, source = 'art-progress') {
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const after = record.after && typeof record.after === 'object' ? record.after : {};
  const values = source === 'operation-log'
    ? [
        record.action,
        record.actionName,
        record.targetName,
        operationLogDisplayTargetName(record),
        record.description,
        ...operationLogStructuredUsageValues(after),
        metadata.productName,
        metadata.artifactName,
        metadata.skillName,
        metadata.operationName,
        metadata.alias,
        metadata.path,
        metadata.filePath,
        metadata.skillPath,
        metadata.artifactPath,
        ...(Array.isArray(metadata.aliases) ? metadata.aliases : []),
        ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : []),
        ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : [])
      ]
    : [
        record.eventType,
        record.skillId,
        record.skillName,
        record.repoPath,
        record.title,
        record.stage,
        record.summary,
        metadata.path,
        metadata.filePath,
        metadata.finalPath,
        metadata.skillPath,
        metadata.artifactPath,
        metadata.artifactLocation,
        ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : []),
        ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : []),
        ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts.flatMap(item => [item?.id, item?.name, item?.path]) : []),
        ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts.flatMap(item => [item?.id, item?.name, item?.path]) : [])
      ];
  return values
    .map(value => usageCounterKey(value))
    .filter(Boolean)
    .join('\n');
}

function isUsageLikeArtProgressEvent(event = {}) {
  const type = cleanString(event.eventType);
  if (['reporter_test', 'reporter_installed'].includes(type)) return false;
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  if (metadata.source === 'codex-session-summary') return false;
  if (['skill_called', 'tool_used', 'research_artifact', 'research_summary', 'research_finding', 'task_completed'].includes(type)) return true;
  const text = `${event.skillId || ''} ${event.skillName || ''} ${event.summary || ''} ${event.title || ''}`;
  if (/member-art-reporter|art-progress-reporter|art-workbench-sync-reporter|美术工作台 AI 研究沉淀|研究沉淀安装|安装测试|安装完成|自动整理|Codex 研究整理/i.test(text)) return false;
  return /使用|调用|验证|复用|产物|skill|tool/i.test(text);
}

function isTaskArtBriefUsageOperationLog(log = {}) {
  if (cleanString(log.result).toLowerCase() === 'fail') return false;
  const action = cleanString(log.action);
  const text = `${log.actionName || ''} ${log.description || ''} ${log.targetName || ''}`;
  return ['GENERATE_ZENTAO_ART_BRIEF', 'REUSE_ZENTAO_ART_BRIEF', 'REGENERATE_ZENTAO_ART_BRIEF'].includes(action)
    || /禅道美术摘要|美术摘要/.test(text);
}

function isUsageLikeOperationLog(log = {}) {
  if (cleanString(log.result).toLowerCase() === 'fail') return false;
  if (isTaskArtBriefUsageOperationLog(log)) return true;
  const action = cleanString(log.action);
  const actionName = cleanString(log.actionName);
  const targetType = cleanString(log.targetType);
  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  if (isNonUsageOperationLog(log)) return false;
  if (metadata.countAsSkillUsage === true || metadata.countAsProductUsage === true) return true;
  if (metadata.countAsSkillUsage === false || metadata.countAsProductUsage === false) return false;
  if (['UPDATE_LOCAL_WORKER_RUN', 'UPDATE_DIRECT_SKILL_RUN'].includes(action)) {
    const after = log.after && typeof log.after === 'object' ? log.after : {};
    return isUsageLikeRun(after);
  }
  const text = `${action} ${actionName} ${targetType} ${log.targetName || ''} ${log.description || ''}`;
  return /(生成|执行|启动|复用|调用|使用|generate|execute|start|reuse|run)/i.test(text)
    && !/(删除|作废|恢复|隐藏|展示|编辑|修改|保存|登录|退出|同步任务|同步 Bug|刷新库存)/i.test(text);
}

function isNonUsageOperationLog(log = {}) {
  const action = cleanString(log.action);
  const module = cleanString(log.module);
  const targetType = cleanString(log.targetType);
  if ([
    'VIEW_PAGE',
    'LOGIN',
    'LOGOUT',
    'SESSION_EXPIRED',
    'CREATE_RUN',
    'START_RUN',
    'RETRY_RUN',
    'CANCEL_RUN',
    'DELETE_RUN',
    'CLAIM_LOCAL_WORKER_RUN',
    'QUEUE_RUN_LOCAL_WORKER',
    'RECOVER_LOCAL_WORKER_RUN',
    'CLAIM_DIRECT_SKILL_RUN',
    'UPDATE_SKILL_ALIAS',
    'UPDATE_SKILL_VERSION',
    'HIDE_SKILL_ASSET',
    'HIDE_SCAN_SOURCE_PRODUCT',
    'SHOW_SCAN_SOURCE_PRODUCT',
    'UPDATE_PROJECT',
    'UPDATE_ROLE',
    'UPSERT_TASK_CENTER_CONFIG',
    'UPDATE_AGENT_WORKER_ALIAS',
    'REPORT_ART_PROGRESS',
    'UPDATE_SKILL_VALIDATION',
    'TRIGGER_ZENTAO_TASK_SYNC',
    'TRIGGER_ZENTAO_TASK_SYNC_ONLY',
    'SYNC_ZENTAO_TASKS',
    'SYNC_ZENTAO_TASKS_ONLY',
    'SYNC_ZENTAO_BUGS'
  ].includes(action)) return true;
  if (module === 'workbench' && targetType === 'view') return true;
  return false;
}

function buildUsageTargets(values = [], common = {}) {
  return normalizeUsageTargets(values.flatMap(value => usageTargetCandidates(value)).map(target => ({ ...common, target })));
}

function usageTargetCandidates(value = '') {
  const text = cleanString(value).replace(/\\/g, '/');
  if (!text || !isStrongUsageTargetValue(text)) return [];
  const parts = text.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || text;
  const withoutExt = cleanUsageTargetLabel(last.replace(/\.(md|markdown)$/i, ''));
  const parentForSkill = /^SKILL\.md$/i.test(last) && parts.length > 1 ? parts[parts.length - 2] : '';
  return [text, last, withoutExt, parentForSkill]
    .map(item => cleanString(item))
    .filter(item => item && item.length >= 3 && isStrongUsageTargetValue(item) && !isGenericUsageTarget(item));
}

function normalizeUsageTargets(targets = []) {
  const seen = new Set();
  const output = [];
  for (const item of targets) {
    const target = cleanString(item.target || item.key);
    const key = usageCounterKey(target);
    if (!key) continue;
    const person = canonicalUsagePersonName(item.person);
    const at = cleanString(item.at);
    const dedupeKey = [key, person, at, item.source || ''].join('::');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    output.push({ key, target, person, at, count: Math.max(1, Number(item.count || 1)), kind: cleanString(item.kind || item.source), eventKey: cleanString(item.eventKey) });
  }
  return output;
}

function usageEventKey(source = '', id = '', at = '') {
  const text = [source, id, at].map(cleanString).join('::');
  if (!text.replace(/:/g, '')) return '';
  return createHash('sha1').update(text).digest('hex').slice(0, 24);
}

function cleanUsageTargetLabel(value = '') {
  return cleanString(value)
    .replace(/^只执行一个规范\s*\/\s*Skill[：:\s]*/i, '')
    .replace(/^Skill[：:\s]+/i, '')
    .replace(/^skill([a-z0-9_-]+)$/i, '$1')
    .replace(/^直接执行\s+/i, '')
    .trim();
}

function mergeArtProgressEvents(records = []) {
  const map = new Map();
  const passthrough = [];
  for (const raw of Array.isArray(records) ? records : []) {
    const record = normalizeArtProgressEvent(raw);
    const key = artProgressEventMergeKey(record);
    if (!key) {
      passthrough.push(record);
      continue;
    }
    const previous = map.get(key);
    if (!previous) {
      map.set(key, record);
      continue;
    }
    map.set(key, preferLatestArtProgressEvent(previous, record));
  }
  return [...passthrough, ...map.values()];
}

function preferLatestArtProgressEvent(left = {}, right = {}) {
  const leftTime = retentionRecordTime(left);
  const rightTime = retentionRecordTime(right);
  const latest = rightTime >= leftTime ? right : left;
  const older = latest === right ? left : right;
  return {
    ...older,
    ...latest,
    createdAt: latest.createdAt || older.createdAt,
    updatedAt: latest.updatedAt || older.updatedAt,
    metadata: {
      ...(older.metadata && typeof older.metadata === 'object' ? older.metadata : {}),
      ...(latest.metadata && typeof latest.metadata === 'object' ? latest.metadata : {}),
      mergedCount: Number(older.metadata?.mergedCount || 1) + Number(latest.metadata?.mergedCount || 1),
      latestSubmittedAt: latest.createdAt || latest.updatedAt || older.createdAt || older.updatedAt || ''
    }
  };
}

function artProgressEventMergeKey(input = {}) {
  const record = normalizeArtProgressEvent(input);
  if (record.eventType === 'reporter_installed' || record.eventType === 'reporter_test') return '';
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const target = usageCounterKey(record.skillName || record.skillId || metadata.artifactName || metadata.artifactPath || metadata.filePath || record.title || record.stage);
  const member = cleanString(record.memberName || record.memberAccount).toLowerCase();
  const summary = cleanString(record.summary).replace(/\s+/g, '').slice(0, 120);
  if (!target || !member || !summary) return '';
  return [member, record.eventType, target, summary].join('::');
}

function usageCounterKey(value = '') {
  const text = usageCounterKeySourceText(value)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.(md|markdown)$/i, '')
    .toLowerCase()
    .replace(/[_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '') || '';
  if (!text || text.length < 3 || isGenericUsageTarget(text) || isTechnicalUsageTarget(text)) return '';
  return text;
}

function usageCounterKeySourceText(value = '') {
  const raw = cleanUsageTargetLabel(value).replace(/\\/g, '/');
  const parts = raw.split('/').map(part => cleanString(part)).filter(Boolean);
  if (parts.length >= 2 && /^SKILL\.md$/i.test(parts[parts.length - 1])) {
    return parts[parts.length - 2] || raw;
  }
  return raw;
}

function normalizeAgentWorker(input = {}) {
  const now = new Date().toISOString();
  const userId = cleanString(input.userId);
  const deviceId = cleanString(input.deviceId || input.id);
  const id = [userId, deviceId].filter(Boolean).join(':') || cleanString(input.id) || randomUUID();
  const capabilities = normalizeLineList(input.capabilities);
  const checks = input.checks && typeof input.checks === 'object' ? input.checks : {};
  const heartbeatIntervalMs = Math.max(0, Number(input.heartbeatIntervalMs || 0));
  const pollIntervalMs = Math.max(0, Number(input.pollIntervalMs || 0));
  const onlineGraceMs = Math.max(0, Number(input.onlineGraceMs || 0));
  const image2Configured = input.image2Configured === true
    || capabilities.includes('image2.config.detected')
    || checks.image2Configured === true
    || input.image2Ready === true;
  const image2NetworkReady = input.image2NetworkReady === false || checks.image2NetworkReady === false
    ? false
    : (input.image2NetworkReady === true
      || capabilities.includes('image2.network.ready')
      || capabilities.includes('image2.ready')
      || checks.image2NetworkReady === true
        ? true
        : null);
  const image2Ready = capabilities.includes('image2.ready')
    || (input.image2Ready === true && image2NetworkReady)
    || (checks.image2Ready === true && image2NetworkReady);
  return {
    id,
    userId,
    userName: cleanString(input.userName || input.displayName),
    deviceId,
    deviceAlias: cleanString(input.deviceAlias),
    deviceName: cleanString(input.deviceName || input.hostname || os.hostname()),
    hostname: cleanString(input.hostname || os.hostname()),
    platform: cleanString(input.platform || os.platform()),
    codexReady: input.codexReady === true || capabilities.includes('codex.exec'),
    figmaMcpReady: input.figmaMcpReady === true || capabilities.includes('figma.mcp.write'),
    image2Ready,
    image2Configured,
    image2NetworkReady,
    capabilities,
    checks,
    currentRunId: cleanString(input.currentRunId),
    pid: Number(input.pid || 0) || 0,
    workerStartedAt: cleanString(input.workerStartedAt),
    workerHome: cleanString(input.workerHome),
    runStateDir: cleanString(input.runStateDir),
    heartbeatIntervalMs,
    pollIntervalMs,
    onlineGraceMs,
    status: cleanString(input.status || 'online'),
    lastHeartbeatAt: cleanString(input.lastHeartbeatAt || now),
    createdAt: cleanString(input.createdAt || now),
    updatedAt: now
  };
}

function normalizeLineList(value = []) {
  if (Array.isArray(value)) return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
  return String(value || '')
    .split(/\n|,|，/)
    .map(item => item.trim())
    .filter(Boolean);
}

function isClaimableAgentRun(run = {}, userId = '', access = {}) {
  if (!isWorkerExecutableRun(run)) return false;
  if (!['pending', 'queued'].includes(String(run.status || '').toLowerCase())) return false;
  const assignee = String(run.queuedForUserId || run.assignedToUserId || run.ownerUserId || '').trim();
  if (assignee && assignee !== userId) return false;
  if (access.canAccessAllProjects) return true;
  return normalizeLineList(access.allowedProjectIds).includes(String(run.projectId || '').trim());
}

function isRecoverableAgentRun(run = {}, userId = '', deviceId = '', access = {}) {
  if (!isWorkerExecutableRun(run)) return false;
  if (!/claimed|running|in_progress/i.test(String(run.status || run.workerStatus || ''))) return false;
  const assignee = String(run.queuedForUserId || run.assignedToUserId || run.ownerUserId || '').trim();
  if (assignee && assignee !== userId) return false;
  const claimedDevice = cleanString(run.claimedByDeviceId);
  if (claimedDevice && claimedDevice !== deviceId) return false;
  if (access.canAccessAllProjects) return true;
  return normalizeLineList(access.allowedProjectIds).includes(String(run.projectId || '').trim());
}

function isWorkerExecutableRun(run = {}) {
  return run.sourceType === 'direct-skill'
    || run.executionMode === 'direct-skill'
    || run.executionHost === 'local-worker'
    || run.workerExecution === true;
}

function workerCanExecuteRun(run = {}, capabilities = []) {
  if (!normalizeLineList(capabilities).includes('codex.exec')) return false;
  if (!runRequiresFigmaWriteEvidence(run)) return true;
  return normalizeLineList(capabilities).includes('figma.mcp.write');
}

function normalizeWorkerRunStatus(value = '') {
  const status = String(value || '').trim().toLowerCase();
  if (['running', 'claimed', 'completed', 'partial_write', 'blocked', 'failed', 'cancelled', 'pending'].includes(status)) return status;
  if (status === 'done' || status === 'success') return 'completed';
  if (status === 'error') return 'failed';
  return status || 'running';
}

function isFinalWorkerRunStatus(status = '') {
  return /completed|partial_write|blocked|failed|cancelled|canceled/i.test(String(status || ''));
}

function isWorkerRunStarted(run = {}) {
  return Boolean(run.startedAt || /running|in_progress/i.test(`${run.status || ''} ${run.workerStatus || ''}`));
}

function normalizeActiveLocalWorkerRun(run = {}, statusHint = '') {
  if (!isWorkerExecutableRun(run)) return run;
  const statusText = normalizeWorkerRunStatus(statusHint || run.status || run.workerStatus);
  if (!/queued|pending|created|claimed|running|in_progress/.test(statusText)) return run;
  const workerResult = run.workerResult && typeof run.workerResult === 'object' ? run.workerResult : null;
  const currentDeviceId = cleanString(run.claimedByDeviceId);
  const workerResultDeviceId = cleanString(workerResult?.deviceId);
  const keepWorkerResult = Boolean(
    workerResult
    && workerResultDeviceId
    && currentDeviceId
    && workerResultDeviceId === currentDeviceId
    && /running|in_progress/.test(statusText)
    && !workerResult.exitCode
  );
  const next = {
    ...run,
    blocker: null,
    resultSummary: null,
    figmaWriteResult: null,
    strictCheck: null,
    exitCode: null,
    finishedAt: '',
    completedAt: '',
    durationEstimated: false,
    localWorkerStale: false,
    localWorkerStaleDetectedAt: '',
    stages: activeLocalWorkerStages(run, statusText)
  };
  if (!/running|in_progress/.test(statusText)) {
    next.startedAt = '';
    next.durationMs = 0;
    next.pid = null;
    next.workerResult = null;
    next.workerLocalLogPath = '';
    next.workerLocalLogSize = 0;
    next.logPath = '';
    next.promptPath = '';
    next.workerEventIds = [];
  } else if (!keepWorkerResult) {
    next.workerResult = null;
    next.workerLocalLogPath = '';
    next.workerLocalLogSize = 0;
    next.pid = null;
  }
  return next;
}

function activeLocalWorkerStages(run = {}, status = '') {
  const stageName = '本机 Codex 执行';
  if (/queued|pending|created|claimed/.test(status)) return [];
  return [{
    no: 1,
    name: stageName || '本机 Codex 执行',
    status: 'running',
    startedAt: cleanString(run.startedAt || run.claimedAt || run.queuedAt || ''),
    finishedAt: '',
    durationMs: 0
  }];
}

function resolveWorkerRunStatusTransition(run = {}, incoming = '') {
  const current = normalizeWorkerRunStatus(run.status || run.workerStatus || '');
  const next = normalizeWorkerRunStatus(incoming || current);
  if (isFinalWorkerRunStatus(current)) return current;
  if (isWorkerRunStarted(run) && /claimed|pending|queued|created/.test(next)) return 'running';
  return next;
}

function hasWorkerRunMaterialChange(existing = {}, nextRun = {}) {
  const keys = [
    'status',
    'workerStatus',
    'currentStage',
    'startedAt',
    'finishedAt',
    'exitCode',
    'blocker',
    'resultSummary',
    'workerResult',
    'figmaWriteResult',
    'generatedArtifacts',
    'workerLocalLogPath',
    'workerLocalLogSize',
    'logPath',
    'promptPath',
    'artifactRoot',
    'stages'
  ];
  return keys.some(key => stableWorkerRunValue(existing[key]) !== stableWorkerRunValue(nextRun[key]));
}

function stableWorkerRunValue(value) {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value !== 'object') return String(value);
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObjectKeys(value[key]);
    return result;
  }, {});
}

function runRequiresFigmaWriteEvidence(run = {}) {
  if (!cleanString(run.figmaLinks)) return false;
  if (['cancelled', 'canceled'].includes(cleanString(run.status).toLowerCase())) return false;
  if (!(isWorkerExecutableRun(run) || run.executionMode === 'single-skill' || run.workflow === 'art-single-skill' || run.workflow === 'custom-workflow')) return false;
  if (runExplicitlySkipsFigmaWrite(run)) return false;
  if (runFigmaTargetIsImagePlacement(run)) return true;
  const text = [
    run.requirement,
    run.title,
    run.sourceTitle,
    run.customWorkflowName,
    run.figmaWriteMode
  ].filter(Boolean).join('\n');
  if (!cleanString(text)) return false;
  if (/报告|说明|总结|提示词|prompt|参考|分析|复盘/i.test(text)) return false;
  return /写入|修改|改名|重命名|清理|整理|创建|新建|更新|覆盖|替换|应用|落到|同步到|放置|插入|填充|上传|还原|复刻|生成.*(?:Figma|Frame|节点|图层)|Figma.*(?:写入|修改|创建|新建|更新|节点|图层|Frame|页面|放置|替换|填充)|use_figma|upload_assets|createdNodeIds|mutatedNodeIds/i.test(text);
}

function runFigmaTargetIsImagePlacement(run = {}) {
  return Boolean(cleanString(run.figmaLinks) && isImageGenerationRun(run) && !runExplicitlySkipsFigmaWrite(run));
}

function isImageGenerationRun(run = {}) {
  const text = [
    run.requirement,
    run.title,
    run.sourceTitle,
    run.customWorkflowName,
    run.customWorkflowDescription,
    run.primarySkillPath,
    run.primarySkillTitle,
    run.stage,
    run.primarySkillContent,
    ...(Array.isArray(run.selectedMaterialHints) ? run.selectedMaterialHints : []),
    ...(Array.isArray(run.selectedMaterialSnapshots)
      ? run.selectedMaterialSnapshots.flatMap(item => [item?.path, item?.title, item?.name, item?.content])
      : [])
  ].filter(Boolean).join('\n');
  return /纯生图|生成图片|生图|出图|图片生成|文生图|以图生图|图生图|同\s*IP\s*生图|same[-_\s]*ip[-_\s]*image|sameipimage|gpt[-_\s]?image|imagegen|image[-_\s]*gen|image\s*2|image2|image_gen|图片产物|生成.*(?:海报|插画|角色|icon|图标|banner|KV|贴图|头像|素材)|(?:main|key)[-_\s]*visual|concept[-_\s]*art|character[-_\s]*(?:design|art)|image[-_\s]*(?:generation|creation|editing)|text[-_\s]*to[-_\s]*image|img2img|image[-_\s]*to[-_\s]*image|visual[-_\s]*asset|game[-_\s]*asset|poster[-_\s]*(?:design|generation)|banner[-_\s]*(?:design|generation)|(?:generate|create|make|design).{0,40}(?:image|poster|banner|illustration|character|avatar|asset|texture|visual)/i.test(text);
}

function runExplicitlySkipsFigmaWrite(run = {}) {
  const text = [
    run.requirement,
    run.title,
    run.sourceTitle,
    run.customWorkflowName,
    run.figmaWriteMode
  ].filter(Boolean).join('\n');
  return /不写入\s*Figma|无需写入\s*Figma|不需要写入\s*Figma|不要写入\s*Figma|不放(?:入|到)\s*Figma|无需放(?:入|到)\s*Figma|不要替换\s*Figma|仅(?:生成|输出|保存).{0,20}(?:本地|文件|产物)|只(?:生成|输出|保存).{0,20}(?:本地|文件|产物)/i.test(text);
}

function hasFigmaWriteEvidence(run = {}) {
  const result = run.figmaWriteResult && typeof run.figmaWriteResult === 'object' ? run.figmaWriteResult : {};
  if (result.written === true) return true;
  if (Array.isArray(result.createdNodeIds) && result.createdNodeIds.length) return true;
  if (Array.isArray(result.mutatedNodeIds) && result.mutatedNodeIds.length) return true;
  if (Array.isArray(result.evidence) && result.evidence.some(isFigmaWriteEvidenceText)) return true;
  return false;
}

function isFigmaWriteEvidenceText(value = '') {
  const text = cleanString(value);
  if (!text) return false;
  return /createdNodeIds|mutatedNodeIds|figmaWriteResult.*written["']?\s*[:=]\s*true|use_figma\s+写入成功|日志识别到\s*(?:createdNodeIds|mutatedNodeIds)|(?:图片|成品图|位图).{0,80}(?:放置|替换|填充|插入).{0,80}(?:成功|完成|已)|(?:放置|替换|填充|插入).{0,80}(?:Figma|目标|节点).{0,80}(?:成功|完成|已)/i.test(text);
}

function hasFigmaPostWriteVerification(run = {}) {
  const result = run.figmaWriteResult && typeof run.figmaWriteResult === 'object' ? run.figmaWriteResult : {};
  if (!result.written && !hasFigmaWriteEvidence(run)) return false;
  if (result.partialWrite === true) return false;
  if (Array.isArray(result.postWriteBlockers) && result.postWriteBlockers.length) return false;
  if (cleanString(result.blockerReason)) return false;
  if (result.verifiedAfterWrite === true) return true;
  if (Array.isArray(result.verificationEvidence) && result.verificationEvidence.some(Boolean)) return true;
  if (run.resultSummary?.figmaVerifiedAfterWrite === true) return true;
  return false;
}

function guardFigmaWriteCompletion(run = {}) {
  if (!runRequiresFigmaWriteEvidence(run)) return run;
  const status = cleanString(run.status).toLowerCase();
  if (!/completed|done|success|passed/.test(status)) return run;
  const hasWriteEvidence = hasFigmaWriteEvidence(run);
  const hasVerification = hasFigmaPostWriteVerification(run);
  if (hasWriteEvidence && hasVerification) return run;
  const blockerReason = hasWriteEvidence
    ? (run.figmaWriteResult?.blockerReason || 'Figma 已有放置、替换或写入证据，但最终回读/截图验收未闭环，本次不能判定完整完成。')
    : 'Codex 进程结束，但平台未检测到 Figma 放置、替换或写入证据。必须有 createdNodeIds / mutatedNodeIds，或等价图片放置/替换工具证据后才算完成。';
  return {
    ...run,
    status: hasWriteEvidence ? 'partial_write' : 'failed',
    workerStatus: hasWriteEvidence ? 'partial_write' : 'failed',
    blocker: {
      ...(run.blocker && typeof run.blocker === 'object' ? run.blocker : {}),
      reason: hasWriteEvidence ? '' : blockerReason,
      legacyFigmaBlockerReason: hasWriteEvidence ? cleanString(run.blocker?.reason || blockerReason) : ''
    },
    figmaWriteResult: {
      ...(run.figmaWriteResult && typeof run.figmaWriteResult === 'object' ? run.figmaWriteResult : {}),
      written: hasWriteEvidence,
      required: true,
      partialWrite: hasWriteEvidence,
      blockerReason
    },
    resultSummary: {
      ...(run.resultSummary && typeof run.resultSummary === 'object' ? run.resultSummary : {}),
      status: hasWriteEvidence ? 'partial_write' : 'failed',
      statusText: hasWriteEvidence ? 'partial_write' : 'failed',
      summary: hasWriteEvidence
        ? 'Figma 已有部分写入，但最终回读/截图验收未闭环，本次不能判定完整完成。'
        : '本机 Codex 已结束，但未检测到 Figma 真实写入证据，本次不能判定完成。',
      blockerReason,
      needsHumanReview: true,
      figmaWritten: hasWriteEvidence,
      figmaVerifiedAfterWrite: hasVerification,
      nextStep: hasWriteEvidence
        ? '恢复执行人本机 Figma MCP 授权后继续执行，优先补齐最终回读、截图验收和剩余未完成项。'
        : '检查执行人本机 Figma MCP 写入工具和授权后重新执行。'
    }
  };
}

function normalizeAgentRunEvent(input = {}) {
  if (!input || typeof input !== 'object') return null;
  const id = cleanString(input.id || input.eventId);
  const type = cleanString(input.type || input.eventType);
  if (!id || !type) return null;
  return {
    ...input,
    id,
    type,
    at: cleanString(input.at || input.createdAt || input.updatedAt || new Date().toISOString()),
    stageName: cleanString(input.stageName || input.name || input.currentStage),
    status: cleanString(input.status || input.workerStatus),
    chunk: String(input.chunk || input.text || '').slice(0, 20000)
  };
}

function normalizeWorkerStageName(value = '') {
  const text = cleanString(value);
  if (text === '本机 Codex 执行中') return '本机 Codex 执行';
  return text;
}

function mergeAgentRunStatusEvent(run = {}, event = {}) {
  const status = resolveWorkerRunStatusTransition(run, event.status || run.status);
  const timingPatch = normalizeWorkerTimingPatch(event, run);
  return guardFigmaWriteCompletion({
    ...run,
    status,
    workerStatus: status,
    currentStage: normalizeWorkerStageName(event.currentStage ?? run.currentStage),
    blocker: event.blocker ?? run.blocker,
    resultSummary: event.resultSummary ?? run.resultSummary,
    exitCode: event.exitCode ?? run.exitCode,
    workerResult: event.workerResult ?? run.workerResult,
    figmaWriteResult: event.figmaWriteResult ?? run.figmaWriteResult,
    ...timingPatch
  });
}

function mergeAgentRunStageEvent(run = {}, event = {}) {
  const stageName = normalizeWorkerStageName(event.stageName);
  if (!stageName) return run;
  const status = normalizeWorkerRunStatus(event.status || (event.phase === 'end' ? 'completed' : 'running'));
  const stages = normalizeRunStagesForWorkerEvents(run.stages, stageName, status);
  const index = findRunStageIndex(stages, stageName);
  const eventAt = cleanString(event.at);
  const previous = stages[index] || { no: index + 1, name: stageName };
  const startedAt = event.startedAt || previous.startedAt || (event.phase === 'start' ? eventAt : '');
  const finishedAt = event.finishedAt || (event.phase === 'end' || /completed|failed|blocked|cancelled/.test(status) ? eventAt : previous.finishedAt || '');
  const durationMs = normalizeDurationMs(event.durationMs, startedAt, finishedAt, previous.durationMs);
  stages[index] = {
    ...previous,
    name: previous.name || stageName,
    status,
    startedAt,
    finishedAt,
    durationMs
  };
  return {
    ...run,
    stages,
    currentStage: /running|in_progress/.test(status) ? resolveWorkerStageEventCurrentStage(run.currentStage, stageName) : run.currentStage
  };
}

function resolveWorkerStageEventCurrentStage(currentStage = '', stageName = '') {
  const current = normalizeWorkerStageName(currentStage);
  const next = normalizeWorkerStageName(stageName);
  if (!current || /等待本机 Worker 领取|正在启动本机执行|待启动|待领取/.test(current)) return next || current;
  if (current === '本机 Codex 执行') return current;
  return current || next;
}

function normalizeWorkerTimingPatch(input = {}, existing = {}) {
  const startedAt = cleanString(input.startedAt || existing.startedAt);
  const finishedAt = cleanString(input.finishedAt || existing.finishedAt);
  const durationMs = normalizeDurationMs(input.durationMs, startedAt, finishedAt, existing.durationMs);
  const stages = Array.isArray(input.stages)
    ? mergeWorkerStages(existing.stages, input.stages)
    : existing.stages;
  return {
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(durationMs > 0 ? { durationMs } : {}),
    ...(Array.isArray(stages) ? { stages } : {})
  };
}

function normalizeRunStagesForWorkerEvents(stages = [], fallbackName = '', incomingStatus = '') {
  let rows = Array.isArray(stages) && stages.length ? stages.map((stage, index) => ({ no: stage.no || index + 1, ...stage })) : [];
  const matched = findRunStage(rows, fallbackName);
  if (!matched) rows.push({ no: rows.length + 1, name: fallbackName, status: 'pending' });
  if (isLocalWorkerExecutionStageName(fallbackName) || isFinalWorkerRunStatus(incomingStatus)) {
    rows = mergeDuplicateLocalWorkerExecutionStages(rows, fallbackName);
  }
  return renumberRunStages(rows);
}

function mergeWorkerStages(existingStages = [], inputStages = []) {
  let stages = Array.isArray(existingStages) ? existingStages.map((stage, index) => ({ no: stage.no || index + 1, ...stage })) : [];
  for (const raw of Array.isArray(inputStages) ? inputStages : []) {
    const name = cleanString(raw?.name || raw?.stageName);
    if (!name) continue;
    stages = normalizeRunStagesForWorkerEvents(stages, name, raw.status);
    const index = findRunStageIndex(stages, name);
    const previous = stages[index] || {};
    stages[index] = {
      ...previous,
      ...raw,
      name: previous.name || name,
      status: raw.status || previous.status || 'pending',
      durationMs: normalizeDurationMs(raw.durationMs, raw.startedAt || previous.startedAt, raw.finishedAt || previous.finishedAt, previous.durationMs)
    };
  }
  return stages;
}

function renumberRunStages(stages = []) {
  return (Array.isArray(stages) ? stages : []).map((stage, index) => ({ ...stage, no: index + 1 }));
}

function mergeDuplicateLocalWorkerExecutionStages(stages = [], fallbackName = '') {
  const rows = Array.isArray(stages) ? stages : [];
  const indexes = rows
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage }) => isLocalWorkerExecutionStage(stage, fallbackName));
  if (indexes.length <= 1) return rows;
  const best = indexes
    .map(({ stage, index }) => ({ stage, index, score: localWorkerStageEvidenceScore(stage, fallbackName) }))
    .sort((a, b) => b.score - a.score)[0];
  const merged = indexes.reduce((acc, { stage }) => mergeLocalWorkerStage(acc, stage, fallbackName), { ...best.stage });
  const duplicateIndexes = new Set(indexes.map(item => item.index));
  return rows
    .map((stage, index) => index === best.index ? merged : stage)
    .filter((stage, index) => index === best.index || !duplicateIndexes.has(index));
}

function mergeLocalWorkerStage(base = {}, stage = {}, fallbackName = '') {
  const startedAt = earliestIso(base.startedAt, stage.startedAt);
  const finishedAt = latestIso(base.finishedAt, stage.finishedAt);
  const status = isFinalWorkerRunStatus(stage.status) ? stage.status : isFinalWorkerRunStatus(base.status) ? base.status : (stage.status || base.status || 'running');
  return {
    ...base,
    ...stage,
    name: isLocalWorkerExecutionStageName(base.name) ? base.name : isLocalWorkerExecutionStageName(stage.name) ? stage.name : fallbackName || base.name || stage.name || '本机 Codex 执行',
    status,
    startedAt,
    finishedAt,
    durationMs: normalizeDurationMs(Math.max(Number(base.durationMs || 0), Number(stage.durationMs || 0)), startedAt, finishedAt)
  };
}

function localWorkerStageEvidenceScore(stage = {}, fallbackName = '') {
  return (isLocalWorkerExecutionStageName(stage.name) ? 10 : 0)
    + (normalizeStageName(stage.name) === normalizeStageName(fallbackName) ? 5 : 0)
    + (Number(stage.durationMs || 0) > 0 ? 4 : 0)
    + (stage.finishedAt ? 3 : 0)
    + (stage.startedAt ? 1 : 0);
}

function isLocalWorkerExecutionStage(stage = {}, fallbackName = '') {
  return isLocalWorkerExecutionStageName(stage.name)
    || normalizeStageName(stage.name) === normalizeStageName(fallbackName)
    || (isLocalWorkerExecutionStageName(fallbackName) && looksLikeMaterialStageName(stage.name) && Number(stage.durationMs || 0) > 0);
}

function isLocalWorkerExecutionStageName(value = '') {
  return /本机\s*Codex\s*执行|本机执行|local\s*worker|codex/i.test(cleanString(value));
}

function looksLikeMaterialStageName(value = '') {
  const text = cleanString(value).replace(/\\/g, '/');
  return /^skills\/.+\/SKILL\.md$/i.test(text) || /^skills\/.+\.md$/i.test(text) || /\.(md|markdown)$/i.test(text);
}

function earliestIso(a = '', b = '') {
  const left = Date.parse(a || '');
  const right = Date.parse(b || '');
  if (left && right) return left <= right ? a : b;
  return a || b || '';
}

function latestIso(a = '', b = '') {
  const left = Date.parse(a || '');
  const right = Date.parse(b || '');
  if (left && right) return left >= right ? a : b;
  return a || b || '';
}

function findRunStage(stages = [], name = '') {
  const index = findRunStageIndex(stages, name);
  return index >= 0 ? stages[index] : null;
}

function findRunStageIndex(stages = [], name = '') {
  const target = normalizeStageName(name);
  return (Array.isArray(stages) ? stages : []).findIndex(stage => normalizeStageName(stage?.name) === target);
}

function normalizeDurationMs(value, startedAt = '', finishedAt = '', fallback = 0) {
  const explicit = Number(value || 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const start = Date.parse(startedAt || '');
  const finish = Date.parse(finishedAt || '');
  if (start && finish && finish >= start) return finish - start;
  const previous = Number(fallback || 0);
  return Number.isFinite(previous) && previous > 0 ? Math.round(previous) : 0;
}

function isGenericUsageTarget(value = '') {
  const text = cleanString(value)
    .toLowerCase()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.(md|markdown)$/i, '')
    .replace(/[_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '') || '';
  return /^(figma|mcp|codex|markdown|md|skill|skills|readme|agents|agent|memory|references|reference|data|design|git|ai|artgit|users|user|se7en|artproject|platform|project|projects|volumes|volume|private|tmp|temp|outputs|output|downloads|download|desktop|documents|runs|agentworkers|美术执行台|本机执行状态|安装说明|安装包|同步器|上报器|执行|试用|文件|文件本体|内容执行|快照执行|已读取|说明|执行契约|或规范|规范文件路径|中的提醒文字替代这些文件|codex实任务验证|实任务验证|资料|ip|默认|default)$/i.test(text);
}

function compactUsageTargetText(value = '') {
  return cleanString(value)
    .toLowerCase()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.(md|markdown)$/i, '')
    .replace(/[_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '') || '';
}

function isTechnicalUsageTarget(value = '') {
  const raw = cleanString(value);
  const compact = compactUsageTargetText(raw);
  return looksLikeUuid(raw)
    || /^[0-9a-f]{32}$/i.test(compact)
    || /^(untitledtask|undefined|null|nan)$/i.test(compact);
}

function looksLikeUrlTarget(value = '') {
  const text = cleanString(value);
  return /^https?:\/\//i.test(text)
    || /^www\./i.test(text)
    || /figma\.com\/(?:design|file|board|slides|make)\//i.test(text)
    || /node-id=/i.test(text);
}

function looksLikeTaskOrProjectIdentifier(value = '') {
  const text = cleanString(value);
  const compact = compactUsageTargetText(text);
  if (!text || !compact) return false;
  return /^artdepartment\d+$/i.test(compact)
    || /^art[_-]?department[_-]?\d+$/i.test(text)
    || /^(zentao|task|bug|story|project)?\d{4,}$/i.test(compact)
    || /^【?(制作单|验收单|需求|任务|缺陷|bug|story|task)】?/i.test(text)
    || /美术(验收)?$/.test(text) && /(制作单|验收单|需求|任务|活动|弹窗|页面|优化|新增|调整|web\d+)/i.test(text);
}

function looksLikePlatformScriptTarget(value = '') {
  const text = cleanString(value).replace(/\\/g, '/');
  const base = text.split('/').filter(Boolean).pop() || text;
  const compact = compactUsageTargetText(base);
  if (!compact) return false;
  if (/\.(?:js|mjs|cjs|ts|tsx|vue|py|sh|bash|ps1|bat|json|ya?ml|png|jpe?g|webp|gif|svg)$/i.test(base)) {
    if (!/\.(?:md|markdown)$/i.test(base)) return true;
  }
  return /^(artdirectworker|server|store|appvue|packagejson|assets|index|main|viteconfig|launchagent|install|installer|script|scripts|plugin|plugin代码|插件代码)$/i.test(compact);
}

function looksLikeLongUsageSummaryTarget(value = '') {
  const text = cleanString(value).replace(/\\/g, '/');
  const compact = compactUsageTargetText(text);
  if (!text || !compact) return false;
  if (/AGENTS\.md\s*\/\s*试用/i.test(text)) return true;
  if (text.split('/').filter(Boolean).length >= 5 && /(要求|已经|先把|前者|后者|快照|规则|内容|文本|代码|可用|完整|节点|截图)/.test(text)) return true;
  if (text.length > 80 && !looksLikeSkillOrMarkdownMaterial(text)) return true;
  return /^(先把指定|插件代码|已确认可用|要求这类文本不能直接改|前者拿节点结构和截图|快照已经给出了完整规范|文件内容能读到|基于完成的界面设计生成对应套系页面|批量改图标色值和大小间距|用来让同一个角色在多次生图)$/i.test(compact);
}

function normalizeCustomWorkflow(input = {}) {
  const now = new Date().toISOString();
  const name = String(input.name || '').trim();
  if (!name) throw new Error('workflow name is required');
  const stages = normalizeCustomStages(input.stages);
  return {
    id: input.id || slugify(name),
    name,
    description: String(input.description || '').trim(),
    projectId: String(input.projectId || '').trim(),
    stages,
    tags: Array.isArray(input.tags) ? input.tags.map(item => String(item).trim()).filter(Boolean) : [],
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || randomUUID();
}

async function ensureJson(file, fallback) {
  await readJson(file, fallback);
}

async function readJson(file, fallback) {
  if (useMysqlStore) {
    const configKey = mysqlConfigs.get(file);
    if (configKey) return readMysqlConfig(configKey, fallback);
    const table = mysqlCollections.get(file);
    if (table) return readMysqlCollection(table, fallback);
  }
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, value, options = {}) {
  const payloadValue = options.skipRetention ? value : await applyRetentionToValue(file, value);
  if (useMysqlStore) {
    const configKey = mysqlConfigs.get(file);
    if (configKey) {
      await writeMysqlConfig(configKey, payloadValue);
      return;
    }
    const table = mysqlCollections.get(file);
    if (table) {
      await writeMysqlCollection(table, payloadValue);
      return;
    }
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payloadValue, null, 2)}\n`);
  await fs.rename(tmp, file);
}
