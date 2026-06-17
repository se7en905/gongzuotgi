function cleanText(value = '') {
  return String(value ?? '').trim();
}

function normalizeText(value = '') {
  return cleanText(value).toLowerCase();
}

function normalizeProductName(row = {}) {
  return normalizeText(row.productDisplayName || row.productFileName || row.title || row.id || '');
}

function productKind(row = {}) {
  const directKind = cleanText(row.productKind || row.skillInventoryKind || row.skill?.productKind || row.skill?.inventoryKind);
  if (directKind === 'document') return 'standard';
  if (['skill', 'standard', 'directory'].includes(directKind)) return directKind;
  const text = [
    row.relativePath,
    row.path,
    row.skill?.git?.relativePath,
    row.skill?.relativePath,
    row.skill?.path,
    row.productFileName,
    row.productDisplayName,
    row.title,
    row.description,
    row.skill?.description,
    row.preview,
    row.skill?.preview,
    row.category,
    Array.isArray(row.scenes) ? row.scenes.join(' ') : row.scenes
  ].join('\n');
  if (/(^|\/)SKILL\.md$/i.test(text)) return 'skill';
  if (/规范|规则|模板|说明|指南|标准|交付|命名|清单|流程|design|handoff|template|guide|standard/i.test(text)) return 'standard';
  return 'directory';
}

export function buildSkillInventoryStats(rows = []) {
  const products = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.displayHidden === true) continue;
    const key = normalizeProductName(row);
    if (!key) continue;
    const current = products.get(key);
    if (!current || preferredSkillInventoryProduct(row, current) === row) products.set(key, row);
  }
  const total = [...products.values()];
  const skill = total.filter(row => productKind(row) === 'skill');
  const standard = total.filter(row => productKind(row) === 'standard');
  return {
    total,
    skill,
    standard,
    stats: [
      { key: 'total', label: '产物总计', value: total.length },
      { key: 'skill', label: '技能总数', value: skill.length },
      { key: 'standard', label: '规范总数', value: standard.length }
    ]
  };
}

function preferredSkillInventoryProduct(left = {}, right = {}) {
  const rank = row => {
    const kind = productKind(row);
    if (kind === 'skill') return 3;
    if (kind === 'standard') return 2;
    if (kind === 'directory') return 1;
    return 0;
  };
  const leftRank = rank(left);
  const rightRank = rank(right);
  if (leftRank !== rightRank) return leftRank > rightRank ? left : right;
  return cleanText(left.uploadedAt).localeCompare(cleanText(right.uploadedAt)) >= 0 ? left : right;
}

export function applySkillVersionOverrideRecordState(state = {}, record = {}) {
  const next = {
    skillVersionOverrides: { ...(state.skillVersionOverrides || {}) },
    skillAliasOverrides: { ...(state.skillAliasOverrides || {}) },
    skillAliasHistoryOverrides: { ...(state.skillAliasHistoryOverrides || {}) }
  };
  const recordKey = cleanText(record.key);
  const version = cleanText(record.version);
  const isAliasRecord = recordKey.startsWith('alias:');
  const isDedicatedOverrideRecord = /^(version|owner|name|kind|display):/.test(recordKey);
  const aliasKeys = isAliasRecord ? [recordKey].filter(Boolean) : (isDedicatedOverrideRecord ? [] : [recordKey].filter(Boolean));

  if (version && recordKey.startsWith('version:')) {
    next.skillVersionOverrides[recordKey] = version;
  }
  if (Array.isArray(record.aliases)) {
    for (const key of aliasKeys) next.skillAliasOverrides[key] = [...record.aliases];
  }
  if (Array.isArray(record.aliasHistory) || Array.isArray(record.aliases)) {
    const history = [
      ...(Array.isArray(record.aliasHistory) ? record.aliasHistory : []),
      ...(Array.isArray(record.aliases) ? record.aliases : [])
    ];
    for (const key of aliasKeys) next.skillAliasHistoryOverrides[key] = history;
  }
  return next;
}

export function displayMetricsForSkillInventoryRow(row = {}) {
  if (row.hidden === true) {
    return {
      displayVersionLabel: '1.0',
      usageCountLabel: '-',
      usageRateLabel: '-',
      qualityScoreLabel: '-'
    };
  }
  return {
    displayVersionLabel: cleanText(row.displayVersionOverride || row.version || '1.0') || '1.0',
    usageCountLabel: String(Number(row.usageCount || 0)),
    usageRateLabel: row.usageRateLabel || `${Math.round(Number(row.usageRate || 0) * 100)}%`,
    qualityScoreLabel: row.qualityScoreLabel || String(row.qualityScore ?? row.auditScore90 ?? '-')
  };
}

export function splitProjectDeletionSnapshot(snapshot = {}, projectId = '') {
  const targetProjectId = cleanText(projectId);
  const projects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  const bugs = Array.isArray(snapshot.bugs) ? snapshot.bugs : [];
  const taskReviews = Array.isArray(snapshot.taskReviews) ? snapshot.taskReviews : [];
  const taskProcessingNotes = Array.isArray(snapshot.taskProcessingNotes) ? snapshot.taskProcessingNotes : [];
  const artBriefs = Array.isArray(snapshot.artBriefs) ? snapshot.artBriefs : [];
  const runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];
  const customWorkflows = Array.isArray(snapshot.customWorkflows) ? snapshot.customWorkflows : [];
  return {
    projects: projects.filter(project => cleanText(project.id) !== targetProjectId),
    tasks: tasks.filter(task => cleanText(task.projectId) !== targetProjectId),
    bugs: bugs.filter(bug => cleanText(bug.projectId) !== targetProjectId),
    taskReviews: taskReviews.filter(review => cleanText(review.projectId) !== targetProjectId),
    taskProcessingNotes: taskProcessingNotes.filter(note => cleanText(note.projectId) !== targetProjectId),
    artBriefs: artBriefs.filter(record => cleanText(record.projectId) !== targetProjectId),
    runs,
    customWorkflows,
    retained: {
      runs: runs.filter(run => cleanText(run.projectId) === targetProjectId).length,
      customWorkflows: customWorkflows.filter(workflow => cleanText(workflow.projectId) === targetProjectId).length
    }
  };
}

export function isRunningRunStatus(status = '') {
  return /running|in_progress|claimed/i.test(cleanText(status));
}

export function runMatchesArchiveDeleteFilters(run = {}, filters = {}) {
  const from = filters.from ? Date.parse(filters.from) : 0;
  const to = filters.to ? Date.parse(filters.to) : 0;
  if (!from || !to || from > to) return false;
  const runId = cleanText(filters.runId);
  const sourceType = cleanText(filters.sourceType || filters.executionMode);
  const keyword = normalizeText(filters.keyword);
  const projectId = cleanText(filters.projectId);
  const userId = cleanText(filters.userId);
  const status = normalizeText(filters.status);
  const time = Date.parse(run.createdAt || run.updatedAt || run.finishedAt || run.startedAt || '');
  const inRange = Boolean(time && time >= from && time <= to);
  const matchesRunId = !runId || cleanText(run.id) === runId;
  const matchesProject = !projectId || cleanText(run.projectId) === projectId;
  const matchesSource = !sourceType || run.sourceType === sourceType || run.executionMode === sourceType;
  const matchesUser = !userId || [run.createdBy, run.ownerUserId, run.assignedToUserId, run.startedBy].map(cleanText).includes(userId);
  const matchesStatus = !status || normalizeText(run.status) === status;
  const haystack = [
    run.title,
    run.primarySkillPath,
    run.stage,
    run.assignedToName,
    run.developer,
    run.figmaLinks,
    run.requirement
  ].map(value => normalizeText(value)).join(' ');
  const matchesKeyword = !keyword || haystack.includes(keyword);
  return inRange
    && matchesRunId
    && matchesProject
    && matchesSource
    && matchesUser
    && matchesStatus
    && matchesKeyword
    && !isRunningRunStatus(run.status);
}

export function splitRunsByArchiveDeleteFilters(runs = [], filters = {}) {
  const deleted = [];
  const remaining = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    if (runMatchesArchiveDeleteFilters(run, filters)) deleted.push(run);
    else remaining.push(run);
  }
  return { deleted, remaining };
}

export function applyZentaoAssignResultToTasks(tasks = [], originalTask = {}, updatedTask = null) {
  if (!updatedTask?.id) return Array.isArray(tasks) ? [...tasks] : [];
  return (Array.isArray(tasks) ? tasks : []).map(task => {
    if (task.id === updatedTask.id) return { ...task, ...updatedTask };
    const updatedTaskNo = cleanText(updatedTask.taskNo || updatedTask.zentao?.id);
    const taskNo = cleanText(task.taskNo || task.zentao?.id);
    if (updatedTaskNo && taskNo === updatedTaskNo && cleanText(task.projectId) === cleanText(updatedTask.projectId)) {
      return { ...task, ...updatedTask };
    }
    return task;
  });
}

export function applyTaskRefreshResult(currentTasks = [], apiTasks = null) {
  if (Array.isArray(apiTasks) && apiTasks.length) return [...apiTasks];
  return Array.isArray(currentTasks) ? [...currentTasks] : [];
}

export function shouldReplaceAiMembersBoardHtml(currentHtml = '', nextHtml = '') {
  const text = cleanText(nextHtml);
  if (!text) return false;
  if (/正在加载\s*AI部门看板/i.test(text)) return false;
  if (!/<(?:html|body|section|main|div|table|article|iframe)\b/i.test(text)) return false;
  return text !== cleanText(currentHtml);
}

export function deleteOperationLogRecords(logs = [], predicate = () => false, usageCounters = {}) {
  const kept = [];
  const deleted = [];
  for (const log of Array.isArray(logs) ? logs : []) {
    if (predicate(log)) deleted.push(log);
    else kept.push(log);
  }
  return {
    kept,
    deleted,
    usageCounters
  };
}

export function normalizeTaskArtBriefCumulativeUsageBucket(bucket = {}) {
  const next = {
    ...bucket,
    people: { ...(bucket.people || {}) },
    usagePeople: { ...(bucket.usagePeople || {}) }
  };
  const legacyCount = Math.max(0, Math.round(Number(next.count || 0)));
  const usageCount = Math.max(0, Math.round(Number(next.usageCount || 0)));
  if (legacyCount > usageCount) next.usageCount = legacyCount;
  const peopleTotal = Object.values(next.people || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  const usagePeopleTotal = Object.values(next.usagePeople || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  if (peopleTotal > usagePeopleTotal) {
    next.usagePeople = { ...(next.people || {}) };
    next.usagePeopleCount = Object.keys(next.usagePeople).length;
  }
  return next;
}

export function usageCounterDisplayCountFromBucket(bucket = {}) {
  return Math.max(0, Math.round(Number(bucket.usageCount || 0)));
}

export function mergeUsageCounterRebuildSnapshot(bucket = {}, rebuilt = {}) {
  const usageCount = Math.max(
    0,
    Math.round(Number(bucket.usageCount || 0)),
    Math.round(Number(rebuilt.usageCount || 0))
  );
  const usagePeople = {};
  const addPerson = (person = '', count = 0) => {
    const key = cleanText(person);
    const value = Math.max(0, Math.round(Number(count || 0)));
    if (!key || value <= 0) return;
    usagePeople[key] = Math.max(Number(usagePeople[key] || 0), value);
  };
  Object.entries(bucket.usagePeople || {}).forEach(([person, count]) => addPerson(person, count));
  Object.entries(rebuilt.usagePeople || {}).forEach(([person, count]) => addPerson(person, count));
  return {
    ...bucket,
    usageCount,
    usagePeople,
    usageEventKeys: [
      ...(Array.isArray(bucket.usageEventKeys) ? bucket.usageEventKeys : []),
      ...(Array.isArray(rebuilt.usageEventKeys) ? rebuilt.usageEventKeys : [])
    ].filter((eventKey, index, array) => eventKey && array.indexOf(eventKey) === index)
  };
}

export function comparePermissionCatalogs(backendPermissions = [], frontendPermissions = []) {
  const backend = new Set((Array.isArray(backendPermissions) ? backendPermissions : []).map(cleanText).filter(Boolean));
  const frontend = new Set((Array.isArray(frontendPermissions) ? frontendPermissions : []).map(cleanText).filter(Boolean));
  return {
    missingInFrontend: [...backend].filter(item => !frontend.has(item)).sort(),
    missingInBackend: [...frontend].filter(item => !backend.has(item)).sort()
  };
}
