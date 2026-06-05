import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const artDashboardDir = path.join(dataDir, 'art-dashboard');
const projectId = process.env.ART_PLATFORM_PROJECT_ID || process.env.ZENTAO_AUTO_SYNC_PROJECT_ID || 'art_department';

const activeStatuses = new Set(['wait', 'doing', 'testing', 'pause', 'waittest']);

const snapshot = await latestArtSnapshot();
if (!snapshot) {
  console.error('未找到 data/art-dashboard/art_tasks_YYYY-MM-DD.json 快照。');
  process.exit(1);
}

const tasks = (snapshot.report.art_open_tasks || [])
  .filter(task => activeStatuses.has(String(task.status || '')) && task.currentOnArtMember !== false)
  .map(task => artTaskToPlatformTask(snapshot.report, task));

const bugs = [];
for (const bucket of snapshot.report.bugs_by_person || []) {
  for (const bug of bucket.bugs || []) bugs.push(artBugToPlatformBug(bug, bucket));
}

const activeBugs = bugs.filter(bug => /active|激活|opened/i.test(bug.status || 'active'));

await writeJson(path.join(dataDir, 'tasks.json'), tasks);
await writeJson(path.join(dataDir, 'bugs.json'), activeBugs);

console.log(JSON.stringify({
  snapshot: path.basename(snapshot.path),
  taskCount: tasks.length,
  bugCount: activeBugs.length,
  people: [...new Set(tasks.map(task => task.developer).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}, null, 2));

async function latestArtSnapshot() {
  const files = (await fs.readdir(artDashboardDir))
    .filter(name => /^art_tasks_\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  if (!files.length) return null;
  const file = path.join(artDashboardDir, files.at(-1));
  return { path: file, report: JSON.parse(await fs.readFile(file, 'utf8')) };
}

function artTaskToPlatformTask(report = {}, task = {}) {
  const taskNo = String(task.id || '').trim();
  const deadline = validDate(task.deadline || task._due);
  return {
    id: taskNo ? `${slugify(projectId)}_${taskNo}` : `${slugify(projectId)}_${slugify(task.name || 'art-task')}`,
    projectId,
    taskNo,
    title: task.name || `美术任务 ${taskNo}`,
    developer: task.assignedToRealName || task.assignedTo || '',
    assignedTo: task.assignedTo || '',
    source: 'zentao-art-snapshot',
    status: platformTaskStatus(task.status, task),
    zentaoStatus: task.status || '',
    isCurrent: true,
    syncStatus: 'current',
    lastSyncedAt: report.generated_at || report.today || new Date().toISOString(),
    archivedAt: '',
    deadline,
    zentaoCreatedAt: toIsoDate(task.openedDate || task.assignedDate || ''),
    zentaoProgress: Number(task.progress || 0),
    completion: Number(task.progress || 0),
    agentModel: '',
    summary: [task.parentName, task.storyTitle].filter(Boolean).join(' / '),
    issues: artTaskRisks(task, report.today).join('、'),
    requirement: [task.parentName, task.storyTitle, task.executionName].filter(Boolean).join('\n'),
    stageChecks: [],
    zentao: {
      id: taskNo,
      taskUrl: task.taskUrl || `${report.zentao_base_url || 'https://cd.baa360.cc:20088'}/index.php?m=task&f=view&taskID=${taskNo}`,
      originalStatus: task.status || '',
      assignedTo: task.assignedTo || '',
      assignedToName: task.assignedToRealName || '',
      deadline,
      executionName: task.executionName || '',
      parentName: task.parentName || '',
      storyTitle: task.storyTitle || '',
      periodLabel: artPeriodLabel(task, report.today),
      risks: artTaskRisks(task, report.today)
    },
    createdAt: toIsoDate(task.openedDate || '') || new Date().toISOString(),
    updatedAt: toIsoDate(task.lastEditedDate || task.assignedDate || '') || new Date().toISOString()
  };
}

function artBugToPlatformBug(bug = {}, bucket = {}) {
  const bugNo = String(bug.id || bug.bugNo || '').trim();
  return {
    id: bugNo ? `art_bug_${bugNo}` : `art_bug_${bucket.account || 'unknown'}_${Math.random().toString(16).slice(2)}`,
    projectId,
    bugNo,
    title: bug.title || bug.name || `美术 Bug ${bugNo}`,
    developer: bucket.realname || bucket.name || bucket.account || bug.assignedToRealName || bug.assignedTo || '',
    assignedTo: bug.assignedTo || bucket.account || '',
    productId: bug.product || bug.productId || '',
    status: bug.status || 'active',
    severity: bug.severity || '',
    pri: bug.pri || '',
    deadline: validDate(bug.deadline),
    openedAt: toIsoDate(bug.openedDate || bug.openedAt || ''),
    updatedAt: toIsoDate(bug.lastEditedDate || bug.updatedAt || '') || new Date().toISOString(),
    createdAt: toIsoDate(bug.openedDate || bug.createdAt || '') || new Date().toISOString(),
    zentao: {
      task: bug.task || bug.taskNo || '',
      assignedToName: bug.assignedToRealName || bucket.realname || ''
    }
  };
}

function artPeriodLabel(task = {}, today = '') {
  if (task.overdue) return '已逾期';
  if (task.nearDeadline) return '本周';
  const deadline = validDate(task.deadline || task._due);
  if (!deadline || !today) return '-';
  if (deadline < today) return '已逾期';
  const deltaDays = Math.round((Date.parse(`${deadline}T00:00:00+08:00`) - Date.parse(`${today}T00:00:00+08:00`)) / 86400000);
  if (deltaDays <= 7) return '本周';
  if (deltaDays <= 14) return '下周';
  return '后续';
}

function artTaskRisks(task = {}, today = '') {
  const risks = [];
  const deadline = validDate(task.deadline || task._due);
  if (task.overdue || (deadline && today && deadline < today)) risks.push('已逾期');
  if (task.nearDeadline) risks.push('临期');
  if (task.status === 'wait') risks.push('未开始');
  if (task.status === 'pause') risks.push('暂停');
  if (task.splitRisk) risks.push('需拆分');
  return [...new Set(risks)];
}

function platformTaskStatus(status = '', task = {}) {
  const value = String(status || '').toLowerCase();
  if (/done|closed|finished|completed|已完成|已关闭|完成/.test(value)) return 'passed';
  if (Number(task.progress || 0) >= 100 || validDate(task.finishedDate)) return 'passed';
  if (/doing|testing|进行|测试/.test(value)) return 'in_progress';
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

function slugify(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'item';
}

async function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, file);
}
