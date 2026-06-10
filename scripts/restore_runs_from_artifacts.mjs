import fs from 'node:fs/promises';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const dataDir = path.join(root.pathname, 'data');
const runsPath = path.join(dataDir, 'runs.json');
const operationLogsPath = path.join(dataDir, 'operation-logs.json');
const backupDir = path.join(dataDir, 'restore-backups');

const terminalStatuses = new Set([
  'completed',
  'conditional_pass',
  'passed',
  'failed',
  'blocked',
  'cancelled',
  'canceled',
  'skipped'
]);

const completedStageStatuses = new Set([
  'passed',
  'conditional_pass',
  'completed',
  'done',
  'success',
  'skipped'
]);

const statusPriority = new Map([
  ['failed', 6],
  ['blocked', 5],
  ['cancelled', 4],
  ['conditional_pass', 3],
  ['completed', 2],
  ['passed', 2],
  ['skipped', 1]
]);

function cleanString(value = '') {
  return String(value || '').trim();
}

function normalizeRunStatus(value = '') {
  const text = cleanString(value).toLowerCase();
  if (!text) return '';
  if (/cancelled|canceled|取消|中断/.test(text)) return 'cancelled';
  if (/blocked|阻塞/.test(text)) return 'blocked';
  if (/fail|error|失败|错误/.test(text)) return 'failed';
  if (/conditional|有条件|部分|风险/.test(text)) return 'conditional_pass';
  if (/completed|complete|done|success|passed|完成|通过|成功/.test(text)) return 'completed';
  if (/skipped|skip|跳过/.test(text)) return 'skipped';
  if (/running|执行中|运行中/.test(text)) return 'running';
  if (/pending|queued|未启动|待/.test(text)) return 'pending';
  return text;
}

function normalizeStageStatus(value = '') {
  const text = cleanString(value);
  if (!text) return 'pending';
  if (/未执行|待执行|pending|queued|created/i.test(text)) return 'pending';
  if (/执行中|运行中|running|in_progress/i.test(text)) return 'running';
  if (/阻塞|blocked/i.test(text)) return 'blocked';
  if (/失败|❌|failed|error/i.test(text)) return 'failed';
  if (/取消|中断|cancelled|canceled/i.test(text)) return 'cancelled';
  if (/有条件|⚠️|conditional/i.test(text)) return 'conditional_pass';
  if (/跳过|未触发|⏭️|skipped|skip/i.test(text)) return 'skipped';
  if (/通过|完成|✅|passed|success|done|completed/i.test(text)) return 'passed';
  return text;
}

function stageNameKey(value = '') {
  return cleanString(value)
    .replace(/\s+/g, '')
    .replace(/[\/\\]/g, '')
    .replace(/api/ig, '')
    .toLowerCase();
}

function parseStageReportRows(raw = '') {
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|\s*-+/.test(trimmed) || /序号\s*\|\s*阶段\s*\|\s*状态/.test(trimmed)) continue;
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim());
    if (cells.length < 3) continue;
    const maybeNo = Number(cells[0]);
    const no = Number.isFinite(maybeNo) ? maybeNo : rows.length + 1;
    const name = Number.isFinite(maybeNo) ? cells[1] : cells[0];
    const status = Number.isFinite(maybeNo) ? cells[2] : cells[1];
    const output = Number.isFinite(maybeNo) ? cells[3] || '' : cells[2] || '';
    if (!name || /阶段/.test(name)) continue;
    rows.push({ no, name, status: normalizeStageStatus(status), output });
  }
  return rows;
}

function parseFinalStatus(raw = '') {
  const patterns = [
    /最终状态[：:]\s*`?([^`\n\r]+)/i,
    /执行结论[：:]\s*`?([^`\n\r]+)/i,
    /最终状态\s*为\s*`?([^`\n\r。]+)/i,
    /最终状态\s*[:：]\s*([^\n\r]+)/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      const normalized = normalizeRunStatus(match[1].replace(/[。；;].*$/, ''));
      if (normalized) return normalized;
    }
  }
  return '';
}

function statusFromStages(stages = []) {
  if (!stages.length) return '';
  const statuses = stages.map(stage => normalizeStageStatus(stage.status));
  if (statuses.some(status => status === 'failed')) return 'failed';
  if (statuses.some(status => status === 'blocked')) return 'blocked';
  if (statuses.some(status => status === 'running')) return 'running';
  if (statuses.some(status => status === 'conditional_pass')) return 'conditional_pass';
  if (statuses.some(status => ['passed', 'skipped'].includes(status)) && statuses.every(status => completedStageStatuses.has(status))) return 'completed';
  return '';
}

function isTerminal(status = '') {
  return terminalStatuses.has(normalizeRunStatus(status));
}

function bestTerminalStatus(a = '', b = '') {
  const left = normalizeRunStatus(a);
  const right = normalizeRunStatus(b);
  if (!left) return right;
  if (!right) return left;
  return (statusPriority.get(right) || 0) > (statusPriority.get(left) || 0) ? right : left;
}

function matchReportStage(stage = {}, reportStages = []) {
  const key = stageNameKey(stage.name);
  return reportStages.find(item => stageNameKey(item.name) === key)
    || reportStages.find(item => {
      const reportKey = stageNameKey(item.name);
      return reportKey && key && (reportKey.includes(key) || key.includes(reportKey));
    })
    || reportStages.find(item => Number(item.no) === Number(stage.no))
    || null;
}

function mergeStages(run = {}, reportStages = [], runStatus = '') {
  const existing = Array.isArray(run.stages) ? run.stages : [];
  const source = existing.length ? existing : reportStages;
  if (!source.length) return existing;
  const terminal = isTerminal(runStatus);
  return source.map((stage, index) => {
    const matched = matchReportStage(stage, reportStages) || reportStages[index];
    const currentStatus = normalizeStageStatus(stage.status);
    const reportStatus = matched?.status || '';
    const reportIsTemplatePending = reportStatus === 'pending' && currentStatus !== 'pending';
    const nextStatus = reportIsTemplatePending
      ? currentStatus
      : reportStatus || (terminal ? fallbackStageStatus(runStatus) : currentStatus);
    const next = {
      ...stage,
      no: stage.no || matched?.no || index + 1,
      name: stage.name || matched?.name || `阶段 ${index + 1}`,
      status: nextStatus
    };
    if (matched?.output && !next.output) next.output = matched.output;
    if (terminal && completedStageStatuses.has(nextStatus) && !next.finishedAt) {
      next.finishedAt = run.finishedAt || run.updatedAt || run.startedAt || '';
    }
    return next;
  });
}

function fallbackStageStatus(runStatus = '') {
  const normalized = normalizeRunStatus(runStatus);
  if (['failed', 'blocked', 'cancelled'].includes(normalized)) return 'skipped';
  if (normalized === 'conditional_pass') return 'conditional_pass';
  if (['completed', 'passed'].includes(normalized)) return 'passed';
  return 'pending';
}

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function groupLogsByRun(logs = []) {
  const grouped = new Map();
  for (const log of logs) {
    if (log?.module !== 'run' || !log.targetId || log.targetId === 'range') continue;
    if (!grouped.has(log.targetId)) grouped.set(log.targetId, []);
    grouped.get(log.targetId).push(log);
  }
  for (const items of grouped.values()) {
    items.sort((a, b) => cleanString(a.createdAt).localeCompare(cleanString(b.createdAt)));
  }
  return grouped;
}

function inferFromLogs(run = {}, logs = []) {
  const info = {
    startedAt: '',
    finishedAt: '',
    promptPath: '',
    logPath: '',
    pid: run.pid ?? null,
    startedBy: run.startedBy || '',
    cancelledBy: run.cancelledBy || '',
    status: ''
  };
  for (const log of logs) {
    if (log.action === 'START_RUN') {
      info.status = 'running';
      info.startedAt = log.before?.startedAt || log.createdAt || info.startedAt;
      info.startedBy = log.metadata?.startedBy || log.userId || info.startedBy;
      info.promptPath = log.after?.promptPath || info.promptPath;
      info.logPath = log.after?.logPath || info.logPath;
      info.pid = log.after?.pid ?? info.pid;
    }
    if (log.action === 'CANCEL_RUN') {
      info.status = 'cancelled';
      info.finishedAt = log.createdAt || info.finishedAt;
      info.cancelledBy = log.userId || info.cancelledBy;
    }
    if (/UPDATE_DIRECT_SKILL_RUN/.test(log.action || '')) {
      const status = normalizeRunStatus(log.after?.status || log.after?.workerStatus);
      if (status) info.status = status;
      if (log.after?.finishedAt) info.finishedAt = log.after.finishedAt;
    }
  }
  return info;
}

function summarizeStatusCounts(runs = []) {
  return runs.reduce((acc, run) => {
    const status = run.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const [runsRaw, logsRaw] = await Promise.all([
    fs.readFile(runsPath, 'utf8'),
    fs.readFile(operationLogsPath, 'utf8').catch(() => '[]')
  ]);
  const runs = JSON.parse(runsRaw);
  const logsByRun = groupLogsByRun(JSON.parse(logsRaw));
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `runs-before-artifact-restore-${stamp}.json`);
  await fs.writeFile(backupPath, JSON.stringify(runs, null, 2));

  const changes = [];
  const restored = [];
  for (const run of runs) {
    const reportText = await readText(run.artifactRoot ? path.join(run.artifactRoot, '阶段执行报告.md') : '');
    const logInfo = inferFromLogs(run, logsByRun.get(run.id) || []);
    const reportStages = parseStageReportRows(reportText);
    const reportStatus = parseFinalStatus(reportText);
    const stageStatus = statusFromStages(reportStages);
    let targetStatus = run.status;

    if (!isTerminal(targetStatus)) {
      targetStatus = bestTerminalStatus(targetStatus, reportStatus);
      targetStatus = bestTerminalStatus(targetStatus, stageStatus);
    }
    if (!isTerminal(targetStatus) && logInfo.status) targetStatus = logInfo.status;
    if (logInfo.status === 'cancelled') targetStatus = 'cancelled';

    const next = {
      ...run,
      status: targetStatus || run.status,
      stages: mergeStages(run, reportStages, targetStatus || run.status)
    };

    if (!next.startedAt && logInfo.startedAt) next.startedAt = logInfo.startedAt;
    if (!next.startedBy && logInfo.startedBy) next.startedBy = logInfo.startedBy;
    if (!next.promptPath && logInfo.promptPath) next.promptPath = logInfo.promptPath;
    if (!next.logPath && logInfo.logPath) next.logPath = logInfo.logPath;
    if ((next.pid === null || next.pid === undefined) && logInfo.pid) next.pid = logInfo.pid;
    if (targetStatus === 'cancelled') {
      next.finishedAt = next.finishedAt || logInfo.finishedAt || run.updatedAt || '';
      next.cancelledBy = next.cancelledBy || logInfo.cancelledBy || '';
      next.pid = null;
      next.exitCode = next.exitCode ?? null;
    } else if (isTerminal(targetStatus)) {
      next.finishedAt = next.finishedAt || run.finishedAt || run.updatedAt || logInfo.finishedAt || '';
      if (next.exitCode === null || next.exitCode === undefined) {
        next.exitCode = ['failed', 'blocked'].includes(targetStatus) ? 1 : 0;
      }
      next.pid = null;
    }
    if (isTerminal(next.status)) next.currentStage = null;
    next.updatedAt = next.updatedAt || next.finishedAt || next.startedAt || next.createdAt;

    const changed = JSON.stringify(next) !== JSON.stringify(run);
    restored.push(next);
    if (changed) {
      changes.push({
        id: run.id,
        title: run.title,
        from: run.status,
        to: next.status,
        stageCount: next.stages?.length || 0
      });
    }
  }

  await fs.writeFile(runsPath, JSON.stringify(restored, null, 2));
  console.log(JSON.stringify({
    backupPath,
    changedCount: changes.length,
    before: summarizeStatusCounts(runs),
    after: summarizeStatusCounts(restored),
    changes
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
