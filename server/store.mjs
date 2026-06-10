import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeCustomStages, normalizeLevel, normalizeWorkflowId, stagesForWorkflow, workflowForLevel } from './workflow.mjs';
import { normalizeGitConfig } from './repository-config.mjs';
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
  usageCounters: path.join(dataDir, 'usage-counters.json'),
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
const retentionEnabled = process.env.AWP_DATA_RETENTION_ENABLED !== '0';
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

  const [tasks, bugs, reviews, runs, workflows] = await Promise.all([
    readJson(paths.tasks, []),
    readJson(paths.bugs, []),
    readJson(paths.taskReviews, []),
    readJson(paths.runs, []),
    readJson(paths.customWorkflows, [])
  ]);
  const projectRuns = runs.filter(run => run.projectId === projectId);
  const nextTasks = tasks.filter(task => task.projectId !== projectId);
  const nextBugs = bugs.filter(bug => bug.projectId !== projectId);
  const nextReviews = reviews.filter(review => review.projectId !== projectId);
  const nextRuns = runs.filter(run => run.projectId !== projectId);
  const nextWorkflows = workflows.filter(workflow => workflow.projectId !== projectId);

  await Promise.all([
    writeJson(paths.projects, projects),
    writeJson(paths.tasks, nextTasks),
    writeJson(paths.bugs, nextBugs),
    writeJson(paths.taskReviews, nextReviews),
    writeJson(paths.runs, nextRuns),
    writeJson(paths.customWorkflows, nextWorkflows)
  ]);

  await Promise.all(projectRuns.map(async run => {
    await removeDirectoryIfSafe(getRunWorkspace(run.id), workspaceDir);
    if (run.artifactRoot) await removeDirectoryIfSafe(run.artifactRoot, paths.artifactDir);
  }));
  await removeDirectoryIfSafe(path.join(paths.artifactDir, projectId), paths.artifactDir);

  return {
    project,
    removed: {
      tasks: tasks.length - nextTasks.length,
      bugs: bugs.length - nextBugs.length,
      taskReviews: reviews.length - nextReviews.length,
      runs: projectRuns.length,
      customWorkflows: workflows.length - nextWorkflows.length
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
    if (total >= start && items.length < pageSize) items.push(log);
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
    const haystack = [
      log.username,
      log.displayName,
      log.action,
      log.actionName,
      log.module,
      log.targetType,
      log.targetId,
      log.targetName,
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
  return log ? normalizeOperationLog(log) : null;
}

export async function createOperationLog(input = {}) {
  const log = normalizeOperationLog(input);
  const logs = await readJson(paths.operationLogs, []);
  logs.push(log);
  const maxLogs = Number(process.env.AWP_OPERATION_LOG_MAX_ROWS || 10000);
  const nextLogs = logs
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Number.isFinite(maxLogs) && maxLogs > 0 ? maxLogs : 10000);
  await writeJson(paths.operationLogs, nextLogs);
  return log;
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

export async function listRuns() {
  const runs = await readJson(paths.runs, []);
  const hydratedRuns = await Promise.all(runs.map(hydrateRunStages));
  return hydratedRuns.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getCodexConfig() {
  return normalizeCodexConfig(await readJson(paths.codexConfig, defaultCodexConfig()));
}

export async function getUsageCounters() {
  const counters = normalizeUsageCounters(await readJson(paths.usageCounters, defaultUsageCounters()));
  return await normalizeHistoricalUsageCounterKinds(counters);
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
  if (targets.length) await updateUsageCounters(targets);
}

export async function recordUsageCountersForOperationLog(log = {}) {
  const targets = usageTargetsFromOperationLog(log);
  if (targets.length) await updateUsageCounters(targets);
}

export async function recordUsageCountersForRun(run = {}, options = {}) {
  const targets = usageTargetsFromRun(run, options);
  if (targets.length) await updateUsageCounters(targets);
  return { matched: targets.length };
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
  if (targets.length) await updateUsageCounters(targets);
  return { matched: targets.length };
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
  const runs = await readJson(paths.runs, []);
  const run = runs.find(item => item.id === id) || null;
  return hydrateRunStages(run);
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
    customWorkflowStrict: workflow === 'custom-workflow',
    stage: input.stage || '',
    targetPage: input.targetPage || '',
    zentaoId: input.zentaoId || taskNo || '',
    developer: input.developer || task?.developer || '',
    agentModel: input.agentModel || task?.agentModel || '',
    figmaLinks: input.figmaLinks || '',
    showdocHints: input.showdocHints || '',
    selectedMaterialHints: normalizeLineList(input.selectedMaterialHints),
    productName: input.productName || '',
    sourceTitle: input.sourceTitle || '',
    primarySkillPath: input.primarySkillPath || input.skillPath || input.stage || '',
    primarySkillContent: input.primarySkillContent || input.skillContent || '',
    figmaWriteMode: input.figmaWriteMode || '',
    assignedToUserId: input.assignedToUserId || input.assigneeUserId || '',
    assignedToName: input.assignedToName || input.assigneeName || input.developer || task?.developer || '',
    claimedByDeviceId: input.claimedByDeviceId || '',
    claimedAt: input.claimedAt || '',
    workerStatus: input.workerStatus || '',
    workerCapabilities: normalizeLineList(input.workerCapabilities),
    executionMode: input.executionMode || '',
    codexRequest: normalizeRunCodexRequest(input.codexRequest),
    requirement: input.requirement || '',
    sourceType: input.sourceType || (workflow === 'bug-fix' ? 'bug' : (task?.id ? 'task-center' : 'standalone')),
    status: 'pending',
    currentStage: null,
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
  if (!capabilities.includes('codex.exec') || !capabilities.includes('figma.mcp.write')) return null;
  const allowedProjectIds = normalizeLineList(input.allowedProjectIds);
  const canAccessAllProjects = input.canAccessAllProjects === true || allowedProjectIds.includes('*');
  const runs = await readJson(paths.runs, []);
  const now = new Date().toISOString();
  const candidateIndex = runs.findIndex(run => isClaimableAgentRun(run, userId, { allowedProjectIds, canAccessAllProjects }));
  if (candidateIndex === -1) return null;
  const run = {
    ...runs[candidateIndex],
    status: 'claimed',
    workerStatus: 'claimed',
    assignedToUserId: runs[candidateIndex].assignedToUserId || userId,
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

export async function updateAgentRunFromWorker(runId, input = {}) {
  const runs = await readJson(paths.runs, []);
  const index = runs.findIndex(item => item.id === runId);
  if (index === -1) return null;
  const now = new Date().toISOString();
  const existing = runs[index];
  const patch = {
    workerStatus: input.workerStatus || input.status || existing.workerStatus || '',
    status: normalizeWorkerRunStatus(input.status || input.workerStatus || existing.status),
    currentStage: input.currentStage ?? existing.currentStage,
    blocker: input.blocker ?? existing.blocker,
    resultSummary: input.resultSummary ?? existing.resultSummary,
    exitCode: input.exitCode ?? existing.exitCode,
    finishedAt: input.finishedAt || (/completed|blocked|failed|cancelled/.test(String(input.status || input.workerStatus || '')) ? now : existing.finishedAt),
    workerResult: input.workerResult ?? existing.workerResult,
    figmaWriteResult: input.figmaWriteResult ?? existing.figmaWriteResult,
    updatedAt: now
  };
  if (input.pid !== undefined) patch.pid = input.pid;
  if (input.startedAt) patch.startedAt = input.startedAt;
  if (input.logPath) patch.logPath = input.logPath;
  if (input.promptPath) patch.promptPath = input.promptPath;
  if (input.artifactRoot) patch.artifactRoot = input.artifactRoot;
  runs[index] = { ...existing, ...patch };
  await writeJson(paths.runs, runs);
  return hydrateRunStages(runs[index]);
}

export async function cloneRunForRetry(id, overrides = {}) {
  const source = await getRun(id);
  if (!source) return null;
  return createRun({
    taskId: source.taskId,
    projectId: source.projectId,
    title: source.title,
    workflow: source.workflow,
    workflowLevel: source.workflowLevel,
    customWorkflowId: source.customWorkflowId,
    customWorkflowName: source.customWorkflowName,
    customStages: source.stages,
    stage: source.stage,
    targetPage: source.targetPage,
    zentaoId: source.zentaoId,
    developer: source.developer,
    agentModel: source.agentModel,
    figmaLinks: source.figmaLinks,
    showdocHints: source.showdocHints,
    requirement: source.requirement,
    sourceType: source.sourceType,
    executionMode: source.executionMode,
    createTaskForRun: Boolean(source.taskId),
    codexRequest: normalizeRunCodexRequest(overrides.codexRequest || source.codexRequest),
    ...overrides
  });
}

export async function updateRun(id, patch) {
  const runs = await readJson(paths.runs, []);
  const index = runs.findIndex(item => item.id === id);
  if (index === -1) return null;
  runs[index] = { ...runs[index], ...patch, updatedAt: new Date().toISOString() };
  await writeJson(paths.runs, runs);
  return runs[index];
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
  const from = filters.from ? Date.parse(filters.from) : 0;
  const to = filters.to ? Date.parse(filters.to) : 0;
  if (!from || !to || from > to) return { deleted: [], remaining: runs };
  const sourceType = cleanString(filters.sourceType || filters.executionMode);
  const keyword = cleanString(filters.keyword).toLowerCase();
  const userId = cleanString(filters.userId);
  const status = cleanString(filters.status).toLowerCase();
  const deleted = [];
  const remaining = [];
  for (const run of runs) {
    const time = Date.parse(run.createdAt || run.updatedAt || run.finishedAt || run.startedAt || '');
    const inRange = Boolean(time && time >= from && time <= to);
    const matchesSource = !sourceType || run.sourceType === sourceType || run.executionMode === sourceType;
    const matchesUser = !userId || [run.createdBy, run.ownerUserId, run.assignedToUserId, run.startedBy].map(cleanString).includes(userId);
    const matchesStatus = !status || cleanString(run.status).toLowerCase() === status;
    const haystack = [
      run.title,
      run.primarySkillPath,
      run.stage,
      run.assignedToName,
      run.developer,
      run.figmaLinks,
      run.requirement
    ].map(value => cleanString(value).toLowerCase()).join(' ');
    const matchesKeyword = !keyword || haystack.includes(keyword);
    if (inRange && matchesSource && matchesUser && matchesStatus && matchesKeyword && !isRunningRunStatus(run.status)) deleted.push(run);
    else remaining.push(run);
  }
  if (!deleted.length) return { deleted: [], remaining: runs };
  await writeJson(paths.runs, remaining);
  for (const run of deleted) {
    await removeDirectoryIfSafe(getRunWorkspace(run.id), workspaceDir);
    if (run.artifactRoot) await removeDirectoryIfSafe(run.artifactRoot, paths.artifactDir);
  }
  return { deleted, remaining };
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
  if (input.customWorkflowId) {
    const workflow = await getCustomWorkflow(input.customWorkflowId);
    if (workflow) return workflow;
  }
  if (Array.isArray(input.customStages) && input.customStages.length) {
    return {
      id: input.customWorkflowId || '',
      name: input.customWorkflowName || '临时自定义流程',
      stages: normalizeCustomStages(input.customStages)
    };
  }
  throw new Error('custom workflow requires customWorkflowId or customStages');
}

async function prepareInitialRunArtifacts(project, run, task) {
  await fs.mkdir(run.artifactRoot, { recursive: true });
  await fs.writeFile(run.materialPath, await buildRunMaterial(project, run, task));
}

async function buildRunMaterial(project = {}, run = {}, task = {}) {
  const isBug = run.sourceType === 'bug' || run.workflow === 'bug-fix';
  const linkedTask = Boolean(run.taskId || task.id);
  const figmaItems = parseLineItems(run.figmaLinks);
  const specSkillItems = parseLineItems(run.showdocHints);
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
    '',
    buildSpecSkillTable(specSkillItems),
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
  const stages = Array.isArray(run.stages) ? run.stages : [];
  if (!stages.length || !isFinishedRun(run.status)) return run;
  if (!stages.some(stage => isPendingStage(stage.status))) return run;

  const reportStages = await readStageReportStages(run.artifactRoot);
  const updatedStages = stages.map(stage => {
    const matched = matchReportStage(stage, reportStages);
    if (matched) {
      return {
        ...stage,
        name: stage.name || matched.name,
        status: normalizeStageStatus(matched.status),
        output: stage.output || matched.output || ''
      };
    }
    return { ...stage, status: fallbackFinishedStageStatus(run.status, run) };
  });
  return {
    ...run,
    stages: updatedStages,
    currentStage: run.currentStage && isFinishedRun(run.status) ? null : run.currentStage
  };
}

function isFinishedRun(status = '') {
  return /conditional|done|success|passed|completed|failed|blocked|cancelled|canceled/i.test(String(status || ''));
}

function isPendingStage(status = '') {
  return !status || /pending|created|queued|wait/i.test(String(status || ''));
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
    stageChecks: normalizeStageChecks(input.stageChecks || []),
    zentao: input.zentao || {},
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
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
  return {
    ...previous,
    ...next,
    id: taskIdFor(next.projectId || previous.projectId, next.taskNo || previous.taskNo, next.title || previous.title),
    source: previous.source === 'zentao' || next.source === 'zentao' ? 'zentao' : next.source || previous.source,
    createdAt: previous.createdAt || next.createdAt,
    archivedAt: next.isCurrent === false ? previous.archivedAt || next.archivedAt : next.archivedAt || '',
    updatedAt
  };
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
  return {
    rows: rows
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
      .filter(row => row.name || row.account),
    key: cleanString(input.key),
    month: cleanString(input.month),
    savedAt: cleanString(input.savedAt),
    updatedAt: cleanString(input.updatedAt),
    savedBy: {
      id: cleanString(input.savedBy?.id),
      username: cleanString(input.savedBy?.username),
      displayName: cleanString(input.savedBy?.displayName)
    }
  };
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
    if (bucket.key) buckets[bucket.key] = bucket;
  }
  return {
    ...fallback,
    ...input,
    version: 1,
    retentionDays,
    updatedAt: input.updatedAt || fallback.updatedAt,
    buckets
  };
}

function normalizeUsageCounterBucket(input = {}, fallbackKey = '') {
  const key = usageCounterKey(input.key || fallbackKey || input.target || input.targetName || '');
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
  const usageCount = Math.max(0, Number(input.usageOnlyCount ?? input.directUsageCount ?? input.usageCount ?? input.count ?? 0));
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

let usageCounterKindFixCache = null;

async function normalizeHistoricalUsageCounterKinds(counters = defaultUsageCounters()) {
  if (!counters?.buckets || typeof counters.buckets !== 'object') return counters;
  const nonUsageLogs = await historicalNonUsageOperationLogs();
  const usageSources = await historicalUsageEventSources();
  const ownerMap = await historicalUsageEventOwnerMap();
  const buckets = {};
  let changed = false;
  for (const [key, inputBucket] of Object.entries(counters.buckets)) {
    const bucket = normalizeUsageCounterBucket(inputBucket, key);
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
    buckets[bucket.key] = bucket;
  }
  if (!changed) return counters;
  return {
    ...counters,
    buckets
  };
}

let usageCounterSourceCache = null;

async function historicalUsageEventSources() {
  if (usageCounterSourceCache) return usageCounterSourceCache;
  const [artProgressEvents, operationLogs, runs] = await Promise.all([
    readJson(paths.artProgressEvents, []),
    readJson(paths.operationLogs, []),
    readJson(paths.runs, [])
  ]);
  usageCounterSourceCache = {
    artProgressEvents: (Array.isArray(artProgressEvents) ? artProgressEvents : []).filter(isUsageCountableArtProgressEvent),
    operationLogs: (Array.isArray(operationLogs) ? operationLogs : []).filter(isHistoricalUsageOperationLog),
    runs: (Array.isArray(runs) ? runs : []).filter(isUsageLikeRun)
  };
  return usageCounterSourceCache;
}

function isUsageCountableArtProgressEvent(event = {}) {
  const type = cleanString(event.eventType);
  return ['skill_called', 'tool_used', 'task_completed'].includes(type);
}

function isHistoricalUsageOperationLog(log = {}) {
  const action = cleanString(log.action);
  if ([
    'START_RUN',
    'RETRY_RUN',
    'CREATE_DIRECT_SKILL_RUN',
    'GENERATE_ZENTAO_ART_BRIEF',
    'REUSE_ZENTAO_ART_BRIEF',
    'REGENERATE_ZENTAO_ART_BRIEF'
  ].includes(action)) return true;
  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  return metadata.countAsSkillUsage === true || metadata.countAsProductUsage === true;
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
      .map(cleanString)
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

  if (!Object.keys(usagePeople).length) return false;
  bucket.usagePeople = usagePeople;
  bucket.usagePeopleCount = Object.keys(usagePeople).length;
  bucket.usageCount = Object.values(usagePeople).reduce((sum, value) => sum + Number(value || 0), 0);
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
      .map(cleanString)
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
  const validationRows = [
    ...(Array.isArray(validations.records) ? validations.records : []),
    ...(Array.isArray(validations.googleRecords) ? validations.googleRecords : []),
    ...(Array.isArray(validations.manualRecords) ? validations.manualRecords : [])
  ];
  for (const record of validationRows) {
    const owners = [record.validator, record.walkthroughOwner, record.owner, record.updatedBy];
    const ids = [record.id, record.sourceRef, record.artifactName, record.researchName, record.artifactLocation, record.workflowScene].filter(Boolean);
    const times = [record.createdAt, record.submittedAt, record.importedAt, record.updatedAt].filter(Boolean);
    for (const id of ids) {
      for (const at of times) add(usageEventKey('validation', id, at), owners);
    }
  }
  const logs = await readJson(paths.operationLogs, []);
  for (const log of Array.isArray(logs) ? logs : []) {
    const ownerFromDescription = extractOwnerFromResearchSyncDescription(log.description || log.targetName || '');
    const owners = [ownerFromDescription, ...usageOwnersFromOperationLog(log)].filter(owner => !isUsageProxyPerson(owner));
    const baseId = log.id || log.targetId || log.targetName;
    add(usageEventKey('operation-log', baseId, log.createdAt), owners);
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
  if (usageCount <= 0 || usageTotal <= 0) {
    if (usageCount !== 0 || usageTotal !== 0 || Object.keys(bucket.usagePeople || {}).length) changed = true;
    bucket.usageCount = 0;
    bucket.usagePeople = {};
  } else if (usageTotal !== usageCount) {
    changed = true;
    bucket.usageCount = usageTotal;
    bucket.usagePeople = usagePeople;
  } else {
    bucket.usagePeople = usagePeople;
  }
  const usagePeopleCount = Object.keys(bucket.usagePeople || {}).length;
  if (Number(bucket.usagePeopleCount || 0) !== usagePeopleCount) {
    bucket.usagePeopleCount = usagePeopleCount;
    changed = true;
  }
  return changed;
}

function isUsageProxyPerson(person = '') {
  const text = cleanString(person).toLowerCase();
  return samePersonName(text, '研究同步助手')
    || samePersonName(text, '同步助手')
    || samePersonName(text, '系统同步助手')
    || text === 'art-progress-sync';
}

function usageOwnersFromOperationLog(log = {}) {
  const action = cleanString(log.action);
  const before = log.before && typeof log.before === 'object' ? log.before : {};
  const after = log.after && typeof log.after === 'object' ? log.after : {};
  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  const runOwners = normalizeLineList([
    before.assignedToName,
    before.developer,
    before.createdByName,
    after.assignedToName,
    after.developer,
    after.createdByName,
    metadata.assignedToName,
    metadata.developer,
    metadata.createdByName
  ]).filter(owner => owner && !isUsageProxyPerson(owner));
  if (['START_RUN', 'RETRY_RUN', 'CREATE_DIRECT_SKILL_RUN'].includes(action) && runOwners.length) {
    return runOwners;
  }
  return normalizeLineList([
    log.memberName,
    log.displayName,
    log.username
  ]).filter(owner => owner && !isUsageProxyPerson(owner));
}

function usageOwnersFromRun(run = {}) {
  const owners = normalizeLineList([
    run.assignedToName,
    run.developer,
    run.createdByName,
    run.ownerName
  ]).filter(owner => owner && !isUsageProxyPerson(owner));
  if (owners.length) return owners;
  return normalizeLineList([run.createdBy, run.ownerUserId])
    .filter(owner => owner && !isUsageProxyPerson(owner) && !looksLikeUuid(owner));
}

function looksLikeUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanString(value));
}

function extractOwnerFromResearchSyncDescription(value = '') {
  const match = cleanString(value).match(/([\u4e00-\u9fa5A-Za-z0-9_.-]{2,20})\s+同步\s+research/i);
  return cleanString(match?.[1] || '');
}

async function accumulateUsageCountersFromExpiredRecords(file, records = []) {
  const targets = records.flatMap(record => usageTargetsFromRecord(file, record));
  if (!targets.length) return;
  await updateUsageCounters(targets);
}

async function updateUsageCounters(targets = []) {
  const normalizedTargets = normalizeUsageTargets(targets);
  if (!normalizedTargets.length) return;
  const counters = await getUsageCounters();
  const now = new Date().toISOString();
  for (const target of normalizedTargets) {
    const key = usageCounterKey(target.key || target.target);
    if (!key) continue;
    const bucket = normalizeUsageCounterBucket(counters.buckets[key] || { key, target: target.target }, key);
    const eventKey = cleanString(target.eventKey);
    if (eventKey && bucket.eventKeys.includes(eventKey)) continue;
    bucket.target = bucket.target || target.target || key;
    bucket.aliases = [
      ...(Array.isArray(bucket.aliases) ? bucket.aliases : []),
      target.target,
      target.key
    ]
      .map(cleanString)
      .filter(Boolean)
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
    bucket.peopleCount = Object.keys(bucket.people).length;
    bucket.usagePeopleCount = Object.keys(bucket.usagePeople || {}).length;
    const at = target.at || '';
    bucket.firstAt = bucket.firstAt && at ? (String(bucket.firstAt).localeCompare(String(at)) <= 0 ? bucket.firstAt : at) : (bucket.firstAt || at);
    bucket.lastAt = bucket.lastAt && at ? (String(bucket.lastAt).localeCompare(String(at)) >= 0 ? bucket.lastAt : at) : (bucket.lastAt || at);
    bucket.updatedAt = now;
    counters.buckets[key] = bucket;
  }
  counters.updatedAt = now;
  await writeJson(paths.usageCounters, counters, { skipRetention: true });
}

function usageTargetsFromRecord(file, record = {}) {
  if (file === paths.artProgressEvents) return usageTargetsFromArtProgressEvent(record);
  if (file === paths.operationLogs) return usageTargetsFromOperationLog(record);
  return [];
}

function usageTargetsFromSkillValidation(record = {}) {
  const targetValues = [
    record.artifactName,
    record.researchName,
    record.artifactLocation,
    record.sourceRef,
    record.workflowScene
  ];
  return buildUsageTargets(targetValues, {
    person: cleanString(record.validator || record.walkthroughOwner),
    at: cleanString(record.createdAt || record.submittedAt || record.importedAt),
    source: 'skill-validation',
    kind: 'validation',
    eventKey: usageEventKey('validation', record.id || record.sourceRef || record.artifactName, record.createdAt || record.submittedAt || record.importedAt)
  });
}

function usageTargetsFromArtProgressEvent(event = {}) {
  if (!isUsageLikeArtProgressEvent(event)) return [];
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  const defaultCount = Math.max(1, Number(metadata.usageCount || metadata.count || 1) || 1);
  const targetValues = [
    event.skillId,
    event.skillName,
    event.repoPath,
    metadata.path,
    metadata.filePath,
    metadata.finalPath,
    metadata.skillPath,
    metadata.artifactPath,
    metadata.artifactLocation,
    ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : []),
    ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : [])
  ];
  const targets = buildUsageTargets(targetValues, {
    person: cleanString(event.memberName || event.memberAccount),
    at: cleanString(event.createdAt),
    source: 'art-progress',
    kind: 'research-sync',
    count: defaultCount,
    eventKey: usageEventKey('art-progress', event.id || event.skillName || event.title, event.createdAt)
  });
  const artifactTargets = [
    ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts : []),
    ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts : [])
  ].flatMap((item, index) => buildUsageTargets([item?.id, item?.name, item?.path], {
    person: cleanString(event.memberName || event.memberAccount),
    at: cleanString(event.createdAt),
    source: 'art-progress',
    kind: 'research-sync',
    count: Math.max(1, Number(item?.count || defaultCount) || 1),
    eventKey: usageEventKey('art-progress-artifact', `${event.id || event.skillName || event.title}:${index}`, event.createdAt)
  }));
  return [...targets, ...artifactTargets];
}

function usageTargetsFromOperationLog(log = {}) {
  if (!isUsageLikeOperationLog(log)) return [];
  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  const values = [
    isTaskArtBriefUsageOperationLog(log) ? 'zentao-art-brief-product' : '',
    log.targetName,
    log.targetId,
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
  ];
  return buildUsageTargets(values, {
    person: cleanString(usageOwnersFromOperationLog(log)[0] || ''),
    at: cleanString(log.createdAt),
    source: 'operation-log',
    kind: 'usage',
    eventKey: usageEventKey('operation-log', log.id || log.targetId || log.targetName, log.createdAt)
  });
}

function usageTargetsFromRun(run = {}, options = {}) {
  if (!isUsageLikeRun(run)) return [];
  const source = cleanString(options.source || 'run');
  const at = cleanString(options.at || run.startedAt || run.createdAt);
  const values = [
    run.primarySkillPath,
    run.skillPath,
    run.stage,
    run.title,
    run.sourceTitle,
    run.productName,
    ...(Array.isArray(run.selectedMaterialHints) ? run.selectedMaterialHints : []),
    ...(Array.isArray(run.materials) ? run.materials.flatMap(item => [item?.path, item?.name, item?.title]) : []),
    ...(Array.isArray(run.referenceItems) ? run.referenceItems.flatMap(item => [item?.path, item?.name, item?.title]) : [])
  ];
  return buildUsageTargets(values, {
    person: cleanString(usageOwnersFromRun(run)[0] || ''),
    at,
    source,
    kind: 'usage',
    eventKey: usageEventKey(source, run.id || run.primarySkillPath || run.stage || run.title, at)
  });
}

function isUsageLikeRun(run = {}) {
  if (!run || typeof run !== 'object') return false;
  const status = cleanString(run.status || run.workerStatus || run.platformStatus).toLowerCase();
  if (/cancel|canceled|cancelled|pending|queued|draft|deleted|void/.test(status)) return false;
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

function usageSearchTextFromRecord(record = {}, source = 'art-progress') {
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const values = source === 'operation-log'
    ? [
        record.action,
        record.actionName,
        record.targetName,
        record.description,
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
  if (['START_RUN', 'RETRY_RUN'].includes(action)) return true;
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
    'CANCEL_RUN',
    'DELETE_RUN',
    'CLAIM_DIRECT_SKILL_RUN',
    'UPDATE_DIRECT_SKILL_RUN',
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
    'AUTO_UPSERT_SKILL_VALIDATION',
    'UPSERT_SKILL_VALIDATION',
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
  if (!text) return [];
  const parts = text.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || text;
  const withoutExt = last.replace(/\.(md|markdown)$/i, '');
  const parentForSkill = /^SKILL\.md$/i.test(last) && parts.length > 1 ? parts[parts.length - 2] : '';
  return [text, last, withoutExt, parentForSkill]
    .map(item => cleanString(item))
    .filter(item => item && item.length >= 3 && !isGenericUsageTarget(item));
}

function normalizeUsageTargets(targets = []) {
  const seen = new Set();
  const output = [];
  for (const item of targets) {
    const target = cleanString(item.target || item.key);
    const key = usageCounterKey(target);
    if (!key) continue;
    const person = cleanString(item.person);
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
  const text = cleanString(value)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.(md|markdown)$/i, '')
    .toLowerCase()
    .replace(/[_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '') || '';
  if (!text || text.length < 3 || isGenericUsageTarget(text)) return '';
  return text;
}

function normalizeAgentWorker(input = {}) {
  const now = new Date().toISOString();
  const userId = cleanString(input.userId);
  const deviceId = cleanString(input.deviceId || input.id);
  const id = [userId, deviceId].filter(Boolean).join(':') || cleanString(input.id) || randomUUID();
  const capabilities = normalizeLineList(input.capabilities);
  const checks = input.checks && typeof input.checks === 'object' ? input.checks : {};
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
    capabilities,
    checks,
    currentRunId: cleanString(input.currentRunId),
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
  if (run.sourceType !== 'direct-skill' && run.executionMode !== 'direct-skill') return false;
  if (!['pending', 'queued'].includes(String(run.status || '').toLowerCase())) return false;
  const assignee = String(run.assignedToUserId || run.ownerUserId || '').trim();
  if (assignee && assignee !== userId) return false;
  if (access.canAccessAllProjects) return true;
  return normalizeLineList(access.allowedProjectIds).includes(String(run.projectId || '').trim());
}

function isRunningRunStatus(status = '') {
  return /running|in_progress|claimed/i.test(String(status || ''));
}

function normalizeWorkerRunStatus(value = '') {
  const status = String(value || '').trim().toLowerCase();
  if (['running', 'claimed', 'completed', 'blocked', 'failed', 'cancelled', 'pending'].includes(status)) return status;
  if (status === 'done' || status === 'success') return 'completed';
  if (status === 'error') return 'failed';
  return status || 'running';
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
  return /^(skill|skills|readme|agents|agent|memory|data|artgit|安装说明|安装包|同步器|上报器|执行|试用|文件本体|ip|默认|default)$/i.test(text);
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
