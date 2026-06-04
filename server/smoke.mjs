import assert from 'node:assert/strict';
import { ensurePlatformDirs, listProjects } from './store.mjs';
import { closeMysqlStore } from './mysql-store.mjs';
import { scanProject } from './scanner.mjs';

await ensurePlatformDirs();
const projects = await listProjects();
assert.ok(projects.length > 0, 'expected at least one project');

const scan = await scanProject(projects[0]);
assert.ok(scan.configs.agentConfig.exists, 'expected AGENTS.md to exist');
assert.ok(scan.skills.length > 0, 'expected skills to be discovered');
assert.ok(scan.tasks.length > 0, 'expected task reports to be discovered');

console.log(JSON.stringify({
  ok: true,
  project: projects[0].id,
  skills: scan.skills.length,
  tasks: scan.tasks.length
}, null, 2));

await closeMysqlStore();
