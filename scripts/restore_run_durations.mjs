import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir = path.resolve('data');
const runsPath = path.join(dataDir, 'runs.json');
const operationLogsPath = path.join(dataDir, 'operation-logs.json');
const backupDir = path.join(dataDir, 'restore-backups');

const closedStagePattern = /done|success|passed|completed|conditional|skipped|failed|blocked|cancelled|canceled|通过|完成|有条件|跳过|失败|阻塞|取消|中断/i;
const runningStagePattern = /running|in_progress|claimed|执行中|运行中/i;
const pendingStagePattern = /pending|created|queued|wait|未执行|待执行/i;

function clean(value = '') {
  return String(value || '').trim();
}

function parseTime(value = '') {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function iso(time = 0) {
  return time ? new Date(time).toISOString() : '';
}

function durationBetween(start = 0, end = 0) {
  if (!start || !end || end < start) return 0;
  return end - start;
}

function stageNameKey(value = '') {
  return clean(value)
    .replace(/\s+/g, '')
    .replace(/[\/\\]/g, '')
    .replace(/api/ig, '')
    .toLowerCase();
}

function stageNameMatches(a = '', b = '') {
  const left = stageNameKey(a);
  const right = stageNameKey(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function normalizeStageStatus(status = '') {
  const value = clean(status);
  if (!value) return '';
  if (/cancelled|canceled|取消|中断/i.test(value)) return 'cancelled';
  if (/failed|error|失败/i.test(value)) return 'failed';
  if (/blocked|阻塞/i.test(value)) return 'blocked';
  if (/conditional|有条件/i.test(value)) return 'conditional_pass';
  if (/skipped|skip|跳过/i.test(value)) return 'skipped';
  if (/passed|success|done|completed|通过|完成/i.test(value)) return 'passed';
  if (/running|执行中|运行中/i.test(value)) return 'running';
  if (/pending|queued|未执行|待执行/i.test(value)) return 'pending';
  return value;
}

function groupOperationLogs(logs = []) {
  const grouped = new Map();
  for (const log of logs) {
    if (log?.module !== 'run' || !log.targetId || log.targetId === 'range') continue;
    if (!grouped.has(log.targetId)) grouped.set(log.targetId, []);
    grouped.get(log.targetId).push(log);
  }
  for (const items of grouped.values()) {
    items.sort((a, b) => clean(a.createdAt).localeCompare(clean(b.createdAt)));
  }
  return grouped;
}

async function readText(file = '') {
  if (!file) return '';
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function fileMtime(file = '') {
  if (!file) return 0;
  try {
    const stat = await fs.stat(file);
    return stat.mtimeMs || 0;
  } catch {
    return 0;
  }
}

function parseMarkers(logText = '') {
  const markers = [];
  const re = /AGENT_WORKFLOW_STAGE_(START|DONE):\s*([^|\n]+)(?:\|\s*([a-z_]+))?/g;
  let match;
  while ((match = re.exec(logText))) {
    const name = clean(match[2]);
    if (!name || name === '阶段名') continue;
    markers.push({
      type: match[1] === 'START' ? 'start' : 'done',
      name,
      status: normalizeStageStatus(match[3] || ''),
      offset: match.index
    });
  }
  return markers;
}

function parseChangeSummaryTime(logText = '') {
  const matches = [...logText.matchAll(/\[change-summary\]\s*\ncollectedAt:\s*([^\n]+)/g)];
  return clean(matches.at(-1)?.[1] || '');
}

function usefulLogEndTime(run = {}, logText = '') {
  return parseTime(parseChangeSummaryTime(logText))
    || parseTime(run.resultSummary?.parsedAt)
    || parseTime(run.workerResult?.finishedAt)
    || 0;
}

function inferRunTimes(run = {}, logs = [], logText = '') {
  const startLog = [...logs].reverse().find(log => log.action === 'START_RUN');
  const cancelLog = [...logs].reverse().find(log => log.action === 'CANCEL_RUN');
  const directUpdates = logs.filter(log => log.action === 'UPDATE_DIRECT_SKILL_RUN');
  const lastDirectUpdate = directUpdates.at(-1);

  const startedAt = parseTime(run.startedAt)
    || parseTime(startLog?.createdAt)
    || parseTime(lastDirectUpdate?.after?.startedAt)
    || parseTime(run.claimedAt)
    || parseTime(run.createdAt);

  let finishedAt = 0;
  if (cancelLog) finishedAt = parseTime(cancelLog.createdAt);
  else if (lastDirectUpdate) {
    finishedAt = parseTime(lastDirectUpdate.after?.finishedAt)
      || parseTime(lastDirectUpdate.createdAt)
      || parseTime(run.finishedAt);
  } else {
    finishedAt = usefulLogEndTime(run, logText)
      || parseTime(run.finishedAt)
      || parseTime(run.completedAt)
      || parseTime(run.updatedAt);
  }
  if (finishedAt && startedAt && finishedAt < startedAt) {
    finishedAt = usefulLogEndTime(run, logText) || parseTime(cancelLog?.createdAt) || parseTime(lastDirectUpdate?.createdAt) || parseTime(run.updatedAt);
  }
  if (finishedAt && startedAt && finishedAt < startedAt) finishedAt = 0;
  return { startedAt, finishedAt };
}

function markerRange(markers = [], logText = '') {
  const useful = markers.filter(marker => marker.name !== '需求解析' || markers.length <= 2);
  const first = useful[0]?.offset ?? markers[0]?.offset ?? 0;
  const endMatch = logText.match(/\[change-summary\]/);
  const last = endMatch?.index && endMatch.index > first ? endMatch.index : (useful.at(-1)?.offset ?? markers.at(-1)?.offset ?? logText.length);
  return { first, last: Math.max(first + 1, last) };
}

function markerTime(offset = 0, range = {}, startedAt = 0, finishedAt = 0) {
  if (!startedAt || !finishedAt || finishedAt <= startedAt) return 0;
  const fraction = Math.max(0, Math.min(1, (offset - range.first) / Math.max(1, range.last - range.first)));
  return Math.round(startedAt + fraction * (finishedAt - startedAt));
}

function inferStagesFromMarkers(stages = [], markers = [], logText = '', startedAt = 0, finishedAt = 0) {
  if (!stages.length || !markers.length || !startedAt || !finishedAt || finishedAt <= startedAt) return null;
  const range = markerRange(markers, logText);
  return stages.map((stage, index) => {
    const matched = markers.filter(marker => stageNameMatches(stage.name, marker.name));
    if (!matched.length) return null;
    const startMarker = matched.find(marker => marker.type === 'start') || matched[0];
    const doneMarker = [...matched].reverse().find(marker => marker.type === 'done');
    const stageStart = markerTime(startMarker.offset, range, startedAt, finishedAt) || startedAt;
    const nextStageStartMarker = markers.find(marker => marker.type === 'start' && stages.slice(index + 1).some(next => stageNameMatches(next.name, marker.name)));
    const stageEnd = doneMarker
      ? markerTime(doneMarker.offset, range, startedAt, finishedAt)
      : nextStageStartMarker
        ? markerTime(nextStageStartMarker.offset, range, startedAt, finishedAt)
        : index === stages.length - 1
          ? finishedAt
          : 0;
    return {
      ...stage,
      startedAt: stage.startedAt || iso(stageStart),
      finishedAt: stage.finishedAt || (stageEnd ? iso(stageEnd) : ''),
      durationMs: Number(stage.durationMs) > 0 ? Number(stage.durationMs) : durationBetween(stageStart, stageEnd),
      durationEstimated: Number(stage.durationMs) > 0 ? stage.durationEstimated : true
    };
  });
}

function distributeDurations(stages = [], startedAt = 0, finishedAt = 0) {
  if (!stages.length || !startedAt || !finishedAt || finishedAt <= startedAt) return stages;
  const total = finishedAt - startedAt;
  const activeIndexes = stages
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage }) => !pendingStagePattern.test(clean(stage.status)) || runningStagePattern.test(clean(stage.status)));
  const targets = activeIndexes.length ? activeIndexes : stages.map((stage, index) => ({ stage, index }));
  const slice = Math.max(1, Math.floor(total / targets.length));
  const nextStages = stages.map(stage => ({ ...stage }));
  targets.forEach(({ index }, targetIndex) => {
    const start = startedAt + slice * targetIndex;
    const end = targetIndex === targets.length - 1 ? finishedAt : Math.min(finishedAt, start + slice);
    if (!nextStages[index].startedAt) nextStages[index].startedAt = iso(start);
    if (!nextStages[index].finishedAt) nextStages[index].finishedAt = iso(end);
    if (!(Number(nextStages[index].durationMs) > 0)) {
      nextStages[index].durationMs = durationBetween(start, end);
      nextStages[index].durationEstimated = true;
    }
  });
  return nextStages;
}

function restoreStageDurations(run = {}, logs = [], logText = '') {
  const stages = Array.isArray(run.stages) ? run.stages.map(stage => ({ ...stage })) : [];
  if (!stages.length) return { run, changed: false };
  const { startedAt, finishedAt } = inferRunTimes(run, logs, logText);
  const markers = parseMarkers(logText);
  const existingTotal = stages.reduce((sum, stage) => sum + (Number(stage.durationMs) || 0), 0);
  let nextStages = stages;
  if (!existingTotal && markers.length) {
    const fromMarkers = inferStagesFromMarkers(stages, markers, logText, startedAt, finishedAt);
    if (fromMarkers && fromMarkers.some(Boolean)) {
      nextStages = stages.map((stage, index) => fromMarkers[index] || stage);
    }
  }
  if (!nextStages.reduce((sum, stage) => sum + (Number(stage.durationMs) || 0), 0)) {
    nextStages = distributeDurations(nextStages, startedAt, finishedAt);
  }
  nextStages = nextStages.map(stage => {
    if (Number(stage.durationMs) > 0) return stage;
    const start = parseTime(stage.startedAt);
    const end = parseTime(stage.finishedAt);
    if (!start || !end || end < start) return stage;
    return { ...stage, durationMs: end - start, durationEstimated: stage.durationEstimated ?? true };
  });
  const nextRun = {
    ...run,
    startedAt: run.startedAt || iso(startedAt),
    finishedAt: finishedAt ? iso(finishedAt) : run.finishedAt,
    stages: nextStages
  };
  if (parseTime(nextRun.finishedAt) && parseTime(nextRun.startedAt) && parseTime(nextRun.finishedAt) < parseTime(nextRun.startedAt)) {
    nextRun.finishedAt = run.finishedAt;
  }
  const changed = JSON.stringify(nextRun) !== JSON.stringify(run);
  return { run: nextRun, changed };
}

function normalizeDurationStageStatuses(run = {}) {
  const stages = Array.isArray(run.stages) ? run.stages : [];
  const nextStages = stages.map(stage => {
    const hasDuration = Number(stage.durationMs) > 0 || (parseTime(stage.startedAt) && parseTime(stage.finishedAt) && parseTime(stage.finishedAt) >= parseTime(stage.startedAt));
    if (!hasDuration || !pendingStagePattern.test(clean(stage.status))) return stage;
    const hasEnd = Boolean(parseTime(stage.finishedAt));
    if (/cancelled|canceled/i.test(clean(run.status)) && !hasEnd) return { ...stage, status: 'cancelled' };
    if (/failed|blocked/i.test(clean(run.status)) && !hasEnd) return { ...stage, status: 'skipped' };
    return { ...stage, status: 'conditional_pass' };
  });
  return { ...run, stages: nextStages };
}

function totalStageDuration(run = {}) {
  return (run.stages || []).reduce((sum, stage) => sum + (Number(stage.durationMs) || 0), 0);
}

async function main() {
  const [runsText, logsText] = await Promise.all([
    fs.readFile(runsPath, 'utf8'),
    fs.readFile(operationLogsPath, 'utf8').catch(() => '[]')
  ]);
  const runs = JSON.parse(runsText);
  const logsByRun = groupOperationLogs(JSON.parse(logsText));
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `runs-before-duration-restore-${stamp}.json`);
  await fs.writeFile(backupPath, JSON.stringify(runs, null, 2));

  const changes = [];
  const restored = [];
  for (const run of runs) {
    const logPath = run.logPath || path.join('workspace', run.id, 'run.log');
    const logText = await readText(logPath);
    const logMtime = await fileMtime(logPath);
    const sourceRun = logMtime && (!parseTime(run.finishedAt) || parseTime(run.finishedAt) < parseTime(run.startedAt || run.createdAt))
      ? { ...run, finishedAt: iso(logMtime) }
      : run;
    const beforeTotal = totalStageDuration(run);
    const result = restoreStageDurations(sourceRun, logsByRun.get(run.id) || [], logText);
    const normalizedRun = normalizeDurationStageStatuses(result.run);
    restored.push(normalizedRun);
    const afterTotal = totalStageDuration(normalizedRun);
    if (result.changed || beforeTotal !== afterTotal) {
      changes.push({
        id: run.id,
        title: run.title,
        status: run.status,
        beforeTotal,
        afterTotal,
        startedAt: normalizedRun.startedAt || '',
        finishedAt: normalizedRun.finishedAt || ''
      });
    }
  }
  await fs.writeFile(runsPath, JSON.stringify(restored, null, 2));
  console.log(JSON.stringify({ backupPath, changedCount: changes.length, changes }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
