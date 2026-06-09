import { listBugs, replaceBugsForProducts, upsertBugs } from './store.mjs';
import { getZentaoApi, getZentaoModules } from './zentao-adapter.mjs';

const zentaoArtUsersCacheTtlMs = Number(process.env.ZENTAO_ART_USERS_CACHE_TTL_MS || 10 * 60 * 1000);
let zentaoArtUsersCache = {
  key: '',
  expiresAt: 0,
  value: null
};

export async function syncZentaoBugsForProject(project, options = {}) {
  const configuredProducts = options.products || options.product || options.productIds || process.env.ZENTAO_BUG_PRODUCT_IDS || 'all';
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 200);
  const maxPages = Math.min(Math.max(Number(options.maxPages || 10), 1), 50);
  const refreshTracked = options.refreshTracked !== false;
  const trackedConcurrency = Math.min(Math.max(Number(options.trackedConcurrency || 4), 1), 8);
  const syncProfile = String(options.syncProfile || options.profile || '').trim().toLowerCase();
  const fullScan = options.fullScan === true || options.discovery === true || options.discover === true || ['full', 'full-scan', 'deep', 'discovery', 'discover', 'find-new'].includes(syncProfile);
  const currentOnlySync = !fullScan && (options.currentOnly !== false);
  const artDeptId = Number(options.artDeptId || process.env.ZENTAO_ART_DEPT_ID || 27);
  const { artAccounts, userNames } = await getZentaoArtUsers(artDeptId);
  const api = await getZentaoApi();
  const zentao = await getZentaoModules();
  const trackedBugNos = refreshTracked
    ? new Set((await listBugs({ projectId: project.id }))
      .filter(bug => bug.bugNo || bug.zentao?.id)
      .map(bug => String(bug.bugNo || bug.zentao?.id).trim())
      .filter(Boolean))
    : new Set();

  if (currentOnlySync) {
    const detailRefresh = refreshTracked && typeof zentao.getBug === 'function'
      ? await refreshTrackedZentaoBugs(project, trackedBugNos, artAccounts, userNames, trackedConcurrency)
      : { bugs: [], refreshed: 0, failed: [] };
    const saved = detailRefresh.refreshed ? await upsertBugs(detailRefresh.bugs) : { created: 0, updated: 0, total: 0, bugs: [] };
    const existing = await listBugs({ projectId: project.id });
    return {
      created: saved.created || 0,
      updated: saved.updated || 0,
      removed: 0,
      total: existing.length,
      bugs: saved.bugs?.length ? saved.bugs : existing,
      currentOnlySync: true,
      skippedProductScan: true,
      artDeptId,
      artUserCount: artAccounts.size,
      trackedCandidates: trackedBugNos.size,
      detailRefresh: {
        refreshed: detailRefresh.refreshed,
        failed: detailRefresh.failed.length,
        failures: detailRefresh.failed
      },
      products: [],
      syncedAt: new Date().toISOString()
    };
  }

  const products = await resolveBugProductIds(zentao, api, configuredProducts);
  if (!products.length) throw new Error('请填写要同步的 ZenTao product ID');
  const allBugs = [];
  const productSummaries = [];

  for (const product of products) {
    let page = 1;
    let total = 0;
    let fetched = 0;
    let matched = 0;
    let error = '';
    while (page <= maxPages) {
      try {
        const payload = await zentao.listBugs(api, { product, page, limit });
        const result = payload.result || payload.data || payload;
        const bugs = Array.isArray(result.bugs) ? result.bugs : Array.isArray(result) ? result : [];
        const artBugs = bugs.filter(bug => isArtDepartmentBug(bug, artAccounts));
        total = Number(result.total || bugs.length || total);
        fetched += bugs.length;
        matched += artBugs.length;
        allBugs.push(...artBugs.map(bug => normalizeZentaoBug(project, bug, product, userNames)));
        if (!bugs.length || fetched >= total) break;
        page += 1;
      } catch (err) {
        error = err.message || String(err);
        break;
      }
    }
    if (!error && total > fetched) {
      error = `产品 ${product} 本次只扫描 ${fetched}/${total} 条 Bug，已跳过全量替换以保留现有快照`;
    }
    productSummaries.push({ product, fetched, matched, total, error });
  }

  const detailRefresh = refreshTracked && typeof zentao.getBug === 'function'
    ? await refreshTrackedZentaoBugs(project, trackedBugNos, artAccounts, userNames, trackedConcurrency)
    : { bugs: [], refreshed: 0, failed: [] };
  const bugByNo = new Map();
  for (const bug of allBugs) bugByNo.set(String(bug.bugNo), bug);
  for (const bug of detailRefresh.bugs) bugByNo.set(String(bug.bugNo), bug);
  const mergedBugs = [...bugByNo.values()];

  const scannedAnyProduct = productSummaries.some(summary => summary.fetched > 0 || summary.total > 0);
  const hasErrors = productSummaries.some(summary => summary.error);
  if (!scannedAnyProduct || hasErrors) {
    const existing = await listBugs({ projectId: project.id });
    const saved = detailRefresh.refreshed ? await upsertBugs(detailRefresh.bugs) : null;
    return {
      created: saved?.created || 0,
      updated: saved?.updated || 0,
      removed: 0,
      total: saved?.total || existing.length,
      bugs: saved?.bugs || existing,
      skippedReplace: true,
      skipReason: !scannedAnyProduct
        ? '本次 ZenTao Bug 同步没有成功扫描到产品数据，已保留现有 Bug 快照'
        : '本次 ZenTao Bug 同步存在产品拉取错误，已保留现有 Bug 快照',
      artDeptId,
      artUserCount: artAccounts.size,
      detailRefresh: {
        refreshed: detailRefresh.refreshed,
        failed: detailRefresh.failed.length,
        failures: detailRefresh.failed
      },
      products: productSummaries,
      syncedAt: new Date().toISOString()
    };
  }

  const saved = await replaceBugsForProducts(project.id, products, mergedBugs);
  return {
    ...saved,
    artDeptId,
    artUserCount: artAccounts.size,
    detailRefresh: {
      refreshed: detailRefresh.refreshed,
      failed: detailRefresh.failed.length,
      failures: detailRefresh.failed
    },
    products: productSummaries,
    syncedAt: new Date().toISOString()
  };
}

async function refreshTrackedZentaoBugs(project, bugNos = new Set(), artAccounts = new Set(), userNames = new Map(), concurrency = 4) {
  const ids = [...bugNos].filter(Boolean);
  const refreshedBugs = [];
  const failed = [];
  const api = await getZentaoApi();
  const zentao = await getZentaoModules();
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const bugNo = ids[cursor];
      cursor += 1;
      try {
        const payload = await zentao.getBug(api, { id: bugNo });
        const result = payload.result || payload.data || payload;
        const bug = result.bug || result;
        if (!bug || !bug.id) throw new Error('ZenTao 未返回 Bug 详情');
        if (!isArtDepartmentBug(bug, artAccounts)) continue;
        refreshedBugs.push(normalizeZentaoBug(project, bug, bug.product || '', userNames));
      } catch (error) {
        failed.push({ bugNo: String(bugNo), error: error.message || String(error) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(ids.length, 1)) }, () => worker()));
  return {
    bugs: refreshedBugs,
    refreshed: refreshedBugs.length,
    failed
  };
}

async function resolveBugProductIds(zentao, api, value) {
  const raw = String(Array.isArray(value) ? value.join(',') : value || '').trim();
  if (/^(all|全部|\*)$/i.test(raw)) {
    const payload = await zentao.listProducts(api, { page: 1, limit: 1000 });
    const result = payload.result || payload.data || payload;
    const products = Array.isArray(result.products) ? result.products : Array.isArray(result) ? result : [];
    return products
      .filter(product => String(product.deleted || '0') !== '1' && String(product.status || '').toLowerCase() !== 'closed')
      .map(product => String(product.id || product.product || '').trim())
      .filter(Boolean);
  }
  return normalizeIds(raw);
}

export function isArtDepartmentBug(bug, artAccounts) {
  const assignedTo = accountName(bug.assignedTo);
  const openedBy = accountName(bug.openedBy);
  const resolvedBy = accountName(bug.resolvedBy);
  const status = String(bug.status || '').toLowerCase();
  const closedBy = accountName(bug.closedBy);
  const closedDate = validDate(bug.closedDate);
  const deleted = bug.deleted === true || bug.deleted === '1';
  if (deleted || status === 'closed' || closedBy || closedDate) return false;
  return Boolean(artAccounts.has(assignedTo) || artAccounts.has(openedBy) || artAccounts.has(resolvedBy));
}

export function normalizeZentaoBug(project, bug, product, userNames = new Map()) {
  const bugNo = String(bug.id || '').trim();
  const assignee = accountName(bug.assignedTo);
  const openedBy = accountName(bug.openedBy);
  const resolvedBy = accountName(bug.resolvedBy);
  const artOwner = selectArtBugOwner(bug, userNames);
  const status = isPendingCloseBug(bug) && (userNames.has(assignee) || userNames.has(openedBy))
    ? 'pending_close'
    : bug.status || '';
  return {
    id: `zentao_bug_${bugNo}`,
    projectId: project.id,
    bugNo,
    title: bug.title || `ZenTao bug ${bugNo}`,
    developer: userNames.get(artOwner) || userName(bug.assignedTo) || userName(bug.openedBy) || '',
    assignedTo: artOwner,
    productId: String(bug.product || product || ''),
    status,
    severity: bug.severity || '',
    pri: bug.pri || '',
    deadline: validDate(bug.deadline),
    openedAt: toIsoDate(bug.openedDate),
    updatedAt: toIsoDate(bug.lastEditedDate || bug.assignedDate || bug.openedDate) || new Date().toISOString(),
    zentao: {
      id: Number(bugNo),
      product: bug.product || product,
      execution: bug.execution || '',
      task: bug.task || '',
      story: bug.story || '',
      assignedTo: assignee,
      assignedToName: userName(bug.assignedTo),
      openedBy,
      openedByName: userName(bug.openedBy),
      resolvedBy,
      resolvedByName: userName(bug.resolvedBy),
      artOwner,
      status: bug.status || '',
      resolution: bug.resolution || '',
      severity: bug.severity || '',
      pri: bug.pri || '',
      deadline: validDate(bug.deadline),
      openedDate: bug.openedDate || '',
      assignedDate: bug.assignedDate || '',
      resolvedDate: bug.resolvedDate || '',
      closedBy: accountName(bug.closedBy),
      closedDate: bug.closedDate || '',
      lastEditedDate: bug.lastEditedDate || ''
    }
  };
}

function selectArtBugOwner(bug = {}, userNames = new Map()) {
  const assignee = accountName(bug.assignedTo);
  const openedBy = accountName(bug.openedBy);
  const resolvedBy = accountName(bug.resolvedBy);
  return [assignee, openedBy, resolvedBy].find(account => userNames.has(account)) || assignee || openedBy || resolvedBy;
}

function isPendingCloseBug(bug = {}) {
  const status = String(bug.status || '').toLowerCase();
  const closedBy = accountName(bug.closedBy);
  const closedDate = validDate(bug.closedDate);
  if (status === 'closed' || closedBy || closedDate) return false;
  return Boolean(status === 'resolved' || bug.resolution || bug.resolvedDate);
}

async function getZentaoArtUsers(artDeptId) {
  const cacheKey = String(artDeptId || '');
  const now = Date.now();
  if (zentaoArtUsersCache.key === cacheKey && zentaoArtUsersCache.value && zentaoArtUsersCache.expiresAt > now) {
    return zentaoArtUsersCache.value;
  }
  const api = await getZentaoApi();
  const zentao = await getZentaoModules();
  const users = [];
  const limit = 1000;
  let page = 1;
  let total = 0;
  while (page <= 20) {
    const payload = await zentao.listUsers(api, { page, limit });
    const result = payload.result || payload.data || payload;
    const pageUsers = Array.isArray(result.users) ? result.users : Array.isArray(result) ? result : [];
    total = Number(result.total || pageUsers.length || total);
    users.push(...pageUsers);
    if (!pageUsers.length || users.length >= total) break;
    page += 1;
  }
  const artUsers = users.filter(user => Number(user.dept) === artDeptId);
  const value = {
    artAccounts: new Set(artUsers.map(user => user.account).filter(Boolean)),
    userNames: new Map(users.map(user => [user.account, user.realname || user.account]))
  };
  if (value.artAccounts.size) {
    zentaoArtUsersCache = {
      key: cacheKey,
      expiresAt: Date.now() + zentaoArtUsersCacheTtlMs,
      value
    };
  }
  return value;
}

function normalizeIds(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  return [...new Set(raw.split(/[,，\s]+/).map(item => item.trim()).filter(Boolean))];
}

function accountName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.account || value.realname || '';
}

function userName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.realname || value.account || '';
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
