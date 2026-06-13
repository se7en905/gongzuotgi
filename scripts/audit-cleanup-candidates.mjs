import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const directCandidates = [
  { path: '.DS_Store', note: 'macOS Finder 元数据文件。' },
  { path: '.playwright-cli', note: '本地浏览器调试快照和 console 日志。' },
  { path: 'outputs/archive', note: '空归档根目录。' },
  { path: 'outputs/redesign-qa', note: '已确认无内容的临时验证目录。' },
  { path: 'outputs/art-briefs-verify', note: '摘要模板验证产物，确认不再验证后可清理。' },
  { path: 'outputs/art-workbench-sync-reporter-skill', note: '已废弃或已转移分发来源的同步上报 Skill 分发目录。' },
  { path: 'outputs/member-art-workbench-sync-update', note: '已废弃或已转移分发来源的同步上报增量包目录。' },
  { path: 'outputs/member-art-reporter', note: '已废弃或已转移分发来源的组员 AI 研究沉淀安装包。' },
  { path: 'outputs/*.zip', note: '旧分发 zip 包；保留源目录或确认不再分发后可清理。', pattern: /^.+\.zip$/ }
];

const confirmCandidates = [
  { path: 'logs', note: '排障窗口结束后，可按日期归档或截断旧日志；不要在问题排查期间清理。' },
  { path: 'data/restore-backups', note: '历史恢复备份，确认对应修复已稳定后可归档到外部备份。' }
];

const protectedPaths = [
  { path: 'data', note: '平台本地业务数据、账号、任务、缓存、调用次数和看板状态。' },
  { path: 'workspace', note: '执行工作区、日志、材料和执行产物证据。' },
  { path: 'workspace/artifacts', note: '美术执行台和 AI 档案读取的归档产物。' },
  { path: 'outputs/art-briefs', note: '任务中心正式美术摘要和 AI 工作说明。' },
  { path: 'logs', note: '平台和自动备份日志，排障前不应清理。' },
  { path: 'dist', note: '生产静态构建结果。' },
  { path: 'node_modules', note: '依赖目录。' }
];

const sections = [
  ['可直接清理', directCandidates],
  ['建议负责人确认后再清理', confirmCandidates],
  ['禁止手动删除', protectedPaths],
  ['数据体量巡检', []],
  ['外部配置硬编码线索', []]
];

const dsStores = await findFiles(root, '.DS_Store');
if (dsStores.length) {
  directCandidates.push({
    path: `${dsStores.length} 个 .DS_Store`,
    note: dsStores.map(file => path.relative(root, file)).join('、')
  });
}

console.log('项目清理巡检报告');
console.log(`根目录：${root}`);
console.log(`生成时间：${new Date().toISOString()}`);
console.log('');

for (const [title, items] of sections) {
  if (title === '数据体量巡检') {
    await printDataHealthSection();
    continue;
  }
  if (title === '外部配置硬编码线索') {
    await printExternalConfigSection();
    continue;
  }
  console.log(`## ${title}`);
  let printed = 0;
  for (const item of items) {
    const stats = item.pattern ? await statPatternCandidate(item) : await statCandidate(item.path);
    if (!stats.exists && title !== '禁止手动删除') continue;
    printed += 1;
    const suffix = stats.exists ? `${stats.kind}，${formatBytes(stats.size)}` : '当前不存在';
    console.log(`- ${item.path}：${suffix}。${item.note}`);
  }
  if (!printed) console.log('- 暂无。');
  console.log('');
}

console.log('说明：本脚本只读巡检，不会删除、移动或修改任何文件。');

async function statCandidate(relativePath) {
  if (relativePath.includes(' 个 .DS_Store')) {
    return { exists: true, kind: '文件集合', size: 0 };
  }
  const target = path.join(root, relativePath);
  try {
    const stat = await fs.stat(target);
    return {
      exists: true,
      kind: stat.isDirectory() ? '目录' : stat.isFile() ? '文件' : '其它',
      size: stat.isDirectory() ? await directorySize(target) : stat.size
    };
  } catch {
    return { exists: false, kind: '', size: 0 };
  }
}

async function statPatternCandidate(item) {
  const outputsDir = path.join(root, 'outputs');
  const entries = await fs.readdir(outputsDir, { withFileTypes: true }).catch(() => []);
  const matches = entries
    .filter(entry => entry.isFile() && item.pattern.test(path.join('outputs', entry.name)))
    .map(entry => path.join(outputsDir, entry.name));
  if (!matches.length) return { exists: false, kind: '', size: 0 };
  let size = 0;
  for (const file of matches) size += (await fs.stat(file)).size;
  item.note = `${item.note} 当前匹配：${matches.map(file => path.relative(root, file)).join('、')}`;
  return { exists: true, kind: `文件集合 ${matches.length} 个`, size };
}

async function printDataHealthSection() {
  console.log('## 数据体量巡检');
  const targets = [
    'data/operation-logs.json',
    'data/art-progress-events.json',
    'data/usage-counters.json',
    'data/tasks.json',
    'data/runs.json',
    'workspace/artifacts',
    'outputs/art-briefs',
    'logs'
  ];
  for (const target of targets) {
    const stats = await statCandidate(target);
    if (!stats.exists) continue;
    const count = target.endsWith('.json') ? await jsonRecordCount(path.join(root, target)) : '';
    console.log(`- ${target}：${stats.kind}，${formatBytes(stats.size)}${count ? `，${count}` : ''}。`);
  }
  console.log('- 建议：只读巡检用于观察增长，不代表这些内容可以手动删除。');
  console.log('');
}

async function printExternalConfigSection() {
  console.log('## 外部配置硬编码线索');
  const files = [
    'server/server.mjs',
    'server/scanner.mjs',
    'scripts/report-art-progress-event.mjs',
    'scripts/art-brief/generate_art_summary.py',
    'src/App.vue'
  ];
  const patterns = [
    /https?:\/\/[^\s'"`]+/g,
    /\/Users\/[^\s'"`]+/g,
    /\/Applications\/[^\n"'`]+/g,
    /\b\d{1,3}(?:\.\d{1,3}){3}:\d+\b/g
  ];
  let printed = 0;
  for (const file of files) {
    const abs = path.join(root, file);
    const raw = await fs.readFile(abs, 'utf8').catch(() => '');
    if (!raw) continue;
    const matches = new Set();
    for (const pattern of patterns) {
      for (const match of raw.matchAll(pattern)) {
        const value = match[0].replace(/[),.;\]]+$/, '');
        if (value.includes('127.0.0.1') || value.includes('localhost')) continue;
        matches.add(value);
      }
    }
    if (!matches.size) continue;
    printed += 1;
    console.log(`- ${file}：${[...matches].slice(0, 8).join('、')}${matches.size > 8 ? ` 等 ${matches.size} 项` : ''}`);
  }
  if (!printed) console.log('- 暂无。');
  console.log('- 建议：先集中登记配置项，不要直接改默认值，避免影响现有禅道、组员上报和摘要生成链路。');
  console.log('');
}

async function jsonRecordCount(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (Array.isArray(parsed)) return `${parsed.length} 条`;
    if (parsed && typeof parsed === 'object') return `${Object.keys(parsed).length} 个键`;
  } catch {
    return '';
  }
  return '';
}

async function directorySize(dir) {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(target);
    else if (entry.isFile()) total += (await fs.stat(target)).size;
  }
  return total;
}

async function findFiles(dir, fileName, results = []) {
  const ignored = new Set(['.git', 'node_modules']);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await findFiles(target, fileName, results);
    else if (entry.isFile() && entry.name === fileName) results.push(target);
  }
  return results;
}

function formatBytes(value = 0) {
  const size = Number(value || 0);
  if (size < 1024) return `${size}B`;
  const units = ['KB', 'MB', 'GB'];
  let current = size / 1024;
  for (const unit of units) {
    if (current < 1024 || unit === units.at(-1)) return `${current.toFixed(current >= 10 ? 1 : 2)}${unit}`;
    current /= 1024;
  }
  return `${size}B`;
}
