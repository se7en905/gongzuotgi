import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const backupDir = path.join(dataDir, 'restore-backups', `project-id-migration-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const fromId = 'qp_lobby_5_2';
const toId = 'art_department';

const jsonFiles = [
  'projects.json',
  'users.json',
  'tasks.json',
  'bugs.json',
  'task-reviews.json',
  'runs.json',
  'custom-workflows.json',
  'operation-logs.json',
  'art-briefs.json',
  'usage-counters.json',
  'project-scan-cache.json',
  'ai-flow-records.json',
  'task-processing-notes.json'
];

await fs.mkdir(backupDir, { recursive: true });

const changed = [];
for (const file of jsonFiles) {
  const filePath = path.join(dataDir, file);
  const text = await readText(filePath);
  if (!text || !text.includes(fromId)) continue;
  await fs.copyFile(filePath, path.join(backupDir, file));
  const next = text.split(fromId).join(toId);
  await fs.writeFile(filePath, next, 'utf8');
  changed.push(file);
}

const artifactFrom = path.join(root, 'workspace', 'artifacts', fromId);
const artifactTo = path.join(root, 'workspace', 'artifacts', toId);
if (await exists(artifactFrom) && !await exists(artifactTo)) {
  await fs.rename(artifactFrom, artifactTo);
  changed.push('workspace/artifacts');
}

console.log(JSON.stringify({
  ok: true,
  fromId,
  toId,
  backupDir,
  changed
}, null, 2));

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
