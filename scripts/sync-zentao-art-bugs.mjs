import { closeMysqlStore } from '../server/mysql-store.mjs';
import { getProject } from '../server/store.mjs';
import { syncZentaoBugsForProject } from '../server/zentao-bug-sync.mjs';

const projectId = process.env.AWP_PROJECT_ID || 'art_department';
const project = await getProject(projectId);

if (!project) {
  console.error(JSON.stringify({ ok: false, error: `项目不存在：${projectId}` }, null, 2));
  process.exitCode = 1;
} else {
  try {
    const result = await syncZentaoBugsForProject(project, {
      products: process.env.ZENTAO_BUG_PRODUCT_IDS || 'all',
      limit: Number(process.env.ZENTAO_BUG_LIMIT || 100),
      maxPages: Number(process.env.ZENTAO_BUG_MAX_PAGES || 10),
      artDeptId: Number(process.env.ZENTAO_ART_DEPT_ID || 27)
    });
    console.log(JSON.stringify({ ok: true, projectId, ...result, bugs: undefined }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, projectId, error: error.message || String(error) }, null, 2));
    process.exitCode = 1;
  }
}

await closeMysqlStore();
