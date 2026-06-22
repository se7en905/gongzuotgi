import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  authenticateRequest,
  buildSessionCookie,
  canAccessProject,
  clearSessionCookie,
  changeOwnPassword,
  createUser,
  deleteUser,
  ensureDefaultAdmin,
  hasPermission,
  listAgentWorkerUsers,
  listPermissionCatalog,
  listPublicUsers,
  listRoles,
  loginUser,
  logoutUser,
  deleteRole,
  requireAnyPermission,
  requireAuth,
  requirePermission,
  requireProjectAccess,
  requireRole,
  recordUserVisiblePassword,
  resetUserPassword,
  updateUser,
  upsertRole
} from './auth.mjs';
import {
  createTaskReview,
  deleteAiFlowRecord,
  deleteArtProgressEvent,
  deleteOperationLogsByFilters,
  deleteOperationLog,
  createOperationLog,
  createRun,
  createArtProgressEvent,
  cloneRunForRetry,
  deletePlatformTask,
  deleteProject,
  deleteRun,
  deleteRunsByFilters,
  deleteCustomWorkflow,
  ensurePlatformDirs,
  enforceRetentionNow,
  applyMaintenanceAction,
  getCodexConfig,
  getCustomWorkflow,
  getAiMemberScoreSnapshot,
  getAiFlowRecord,
  getArtBriefByGroupKey,
  getOperationLog,
  getProject,
  getRun,
  getTask,
  getTaskCenterConfig,
  getUsageCounters,
  appendRunLog,
  ensureRunLogPath,
  claimNextAgentRun,
  claimRecoverableAgentRun,
  applyAgentRunEvents,
  listMissingRunIds,
  listCustomWorkflows,
  listAgentWorkers,
  listOperationLogs,
  listBugs,
  listAiFlowRecords,
  listArtBriefs,
  listArtProgressEvents,
  listProjects,
  listRuns,
  listTaskReviews,
  listTaskProcessingNotes,
  listTasks,
  maintenanceOverview,
  paths,
  previewMaintenanceAction,
  recordUsageCountersForArtProgressEvent,
  recordUsageCountersForExpiredSkillValidations,
  recordUsageCountersForOperationLog,
  recordUsageCountersForRun,
  recordUsageCountersForSkillValidation,
  recordUsageCountersForSkillValidationOperationLog,
  recordUsageCountersForSkillAliases,
  queueRunForLocalWorker,
  reconcileZentaoTaskSnapshot,
  upsertBugs,
  redactCodexConfig,
  upsertCodexConfig,
  upsertAiMemberScoreSnapshot,
  upsertTaskCenterConfig,
  upsertCustomWorkflow,
  upsertProject,
  upsertTask,
  upsertTaskProcessingNote,
  updateArtProgressEvent,
  updateAgentRunFromWorker,
  updateAgentWorkerAlias,
  upsertAgentWorker,
  upsertTasks,
  upsertAiFlowRecord,
  upsertArtBrief,
  upsertAiFlowRecords
} from './store.mjs';
import { collectRunArtifacts, isSkillAuditTarget, scanProject, skillAuditFields, skillAuditRuleVersion } from './scanner.mjs';
import { cancelRun, startRun, subscribe } from './runner.mjs';
import { buildWorkflowPlan, workflowLevels } from './workflow.mjs';
import { getZentaoApi, getZentaoModules, resetZentaoApi } from './zentao-adapter.mjs';
import { syncZentaoBugsForProject } from './zentao-bug-sync.mjs';
import { applyZentaoSplitPlan, assignZentaoTask, buildZentaoSplitPlan, getZentaoClassicCookies as getZentaoActionClassicCookies } from './zentao-task-actions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', process.env.STATIC_DIR || 'dist');
const port = Number(process.env.API_PORT || process.env.PORT || 4288);
const host = process.env.API_HOST || process.env.HOST || '0.0.0.0';
const aiWeekDir = process.env.AI_WEEK_DIR || path.join(paths.dataDir, 'ai-week');
const artDashboardDataDir = process.env.ART_DASHBOARD_DATA_DIR || path.join(paths.dataDir, 'art-dashboard');
const zentaoBaseUrl = 'https://cd.baa360.cc:20088/index.php';
const zentaoArtDeptId = Number(process.env.ZENTAO_ART_DEPT_ID || 27);
const zentaoArtDeptIds = new Set([zentaoArtDeptId]);
const defaultArtUsers = [
  { account: 'zhangqw', realname: '张倩文', role: 'owner', userId: 15, userID: 15 },
  { account: 'fengshuqi', realname: '冯淑琪', userId: 179, userID: 179 },
  { account: 'yushengwei', realname: '余盛威', userId: 154, userID: 154 },
  { account: 'yejunbo', realname: '叶君博', userId: 151, userID: 151 },
  { account: 'huangjianrong', realname: '黄剑荣', userId: 133, userID: 133 },
  { account: 'lilh', realname: '李华玲', userId: 22, userID: 22 },
  { account: 'zhangzb', realname: '张宗斌', userId: 20, userID: 20 },
  { account: 'lanhj', realname: '兰韩界', userId: 17, userID: 17 }
];
const zentaoBugProductIds = process.env.ZENTAO_BUG_PRODUCT_IDS || 'all';
const zentaoAutoSyncIntervalMs = Number(process.env.ZENTAO_AUTO_SYNC_INTERVAL_MS || 30 * 60 * 1000);
const zentaoAutoSyncInitialDelayMs = Number(process.env.ZENTAO_AUTO_SYNC_INITIAL_DELAY_MS || 5000);
const zentaoAutoSyncProjectId = process.env.ZENTAO_AUTO_SYNC_PROJECT_ID || 'art_department';
const defaultRunLogTailBytes = Number(process.env.RUN_LOG_TAIL_BYTES || 128 * 1024);
const artProjectId = process.env.ART_PLATFORM_PROJECT_ID || zentaoAutoSyncProjectId;
const zentaoAutoSyncScript = path.join(paths.root, 'scripts', 'sync-zentao-art-tasks.mjs');
const zentaoBugSyncScript = path.join(paths.root, 'scripts', 'sync-zentao-art-bugs.mjs');
const zentaoArtBriefRoot = path.join(paths.root, 'scripts', 'art-brief');
const zentaoArtBriefScript = process.env.ZENTAO_ART_BRIEF_SCRIPT || path.join(zentaoArtBriefRoot, 'generate_art_summary.py');
const zentaoArtBriefOutDir = process.env.ZENTAO_ART_BRIEF_OUT_DIR || path.join(paths.root, 'outputs', 'art-briefs');
const defaultDirectoryBrowseRoot = path.join(os.homedir(), 'Desktop', 'code', 'git');
const defaultAiFlowSheetId = '1tP9XTqxIMUQ6E6rq47fq0A0T7kxvJvnVEPKBpnoIpiw';
const defaultAiFlowSheetGid = '1127778149';
const defaultArtProjectSheetId = '18MyY-8UudwHjUcjt0dFgXUHhrqNqhoc1MOrn_b6gsmg';
const defaultArtProjectSheetGid = '0';
const defaultSkillValidationSheetId = '17Ap_vG-GUCq2tGu03CYw_236Ez6FsRvjnVIrxfnTa2U';
const defaultSkillValidationSheetGid = '362098258';
const defaultSkillValidationStartRow = 31;
const defaultAiAssetSheetId = defaultSkillValidationSheetId;
const defaultAiAssetSheetGid = '1619980559';
const defaultAiAssetStartRow = 11;
const skillValidationsPath = path.join(paths.dataDir, 'skill-validations.json');
const aiAssetSheetPath = path.join(paths.dataDir, 'ai-asset-sheet.json');
const aiAssetOverridesPath = path.join(paths.dataDir, 'ai-asset-overrides.json');
const skillVersionOverridesPath = path.join(paths.dataDir, 'skill-version-overrides.json');
const projectScanCachePath = path.join(paths.dataDir, 'project-scan-cache.json');
const artProgressEventKeyPath = path.join(paths.dataDir, 'art-progress-event-key.json');
const artProjectSheetOverridesPath = path.join(paths.dataDir, 'art-project-sheet-overrides.json');
const artProjectSheetConfigPath = path.join(paths.dataDir, 'art-project-sheet-config.json');
const execFileAsync = promisify(execFile);
let zentaoAutoSyncRunning = false;
let zentaoAutoSyncState = {
  enabled: process.env.ZENTAO_AUTO_SYNC === '1',
  running: false,
  projectId: zentaoAutoSyncProjectId,
  intervalMs: zentaoAutoSyncIntervalMs,
  lastStartedAt: '',
  lastFinishedAt: '',
  lastSuccessAt: '',
  lastErrorAt: '',
  lastError: '',
  lastSummary: null,
  tasks: createZentaoQueueState('tasks'),
  bugs: createZentaoQueueState('bugs')
};
const platformEventClients = new Set();
let platformEventSeq = 0;
let artDepartmentUsersCache = null;
let artDepartmentUsersCacheAt = 0;
let artDepartmentUsersRefreshPromise = null;
const artDepartmentUsersCacheTtlMs = Number(process.env.ZENTAO_ART_USERS_CACHE_TTL_MS || 10 * 60 * 1000);
const zentaoClassicUserTaskMaxPages = Math.min(Math.max(Number(process.env.ZENTAO_CLASSIC_USER_TASK_MAX_PAGES || 80), 1), 300);
const zentaoClassicUserTaskConcurrency = Math.min(Math.max(Number(process.env.ZENTAO_CLASSIC_USER_TASK_CONCURRENCY || 6), 1), 12);
const dataRetentionDays = Math.max(1, Number(process.env.AWP_DATA_RETENTION_DAYS || 2) || 2);
const dataRetentionEnabled = process.env.AWP_DATA_RETENTION_ENABLED !== '0';
const dataRetentionCleanupIntervalMs = Math.max(60 * 60 * 1000, Number(process.env.AWP_DATA_RETENTION_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000);
let dataRetentionCleanupRunning = false;

await ensurePlatformDirs();
await enforceServerFileRetention();
const initialAdmin = await ensureDefaultAdmin();
if (initialAdmin) {
  console.log(`Default admin created: ${initialAdmin.username} / ${initialAdmin.password}`);
  console.log('Set AWP_ADMIN_USERNAME and AWP_ADMIN_PASSWORD before first start to control the initial account.');
}
await ensureArtDepartmentProject();
await ensureArtDepartmentSeed();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/worker/')) {
      await serveWorkerDownload(res, url.pathname);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message, code: error.code || '', details: error.details || null });
  }
});

server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  console.log(`Agent Workflow Platform API running at http://${displayHost}:${port}`);
  if (host === '0.0.0.0') {
    console.log(`LAN access: http://<this-machine-ip>:${port}`);
  }
  console.log(`Static: ${publicDir}`);
  console.log(`Data: ${paths.dataDir}`);
  scheduleDataRetentionCleanup();
  scheduleZentaoAutoSync();
  watchAiMembersBoardFiles();
});

async function handleApi(req, res, url) {
  const authResult = await authenticateRequest(req, { includeExpired: true });
  const expiredSession = authResult?.expired ? authResult.session : null;
  const currentUser = authResult?.expired ? null : authResult;

  if (req.method === 'POST' && url.pathname === '/api/art-progress-events') {
    const body = await readBody(req);
    const user = currentUser || await authenticateArtProgressReporter(req);
    if (!user) {
      sendJson(res, 401, { error: '缺少有效登录态或美术工作台上报密钥。' });
      return;
    }
    const event = await saveArtProgressEvent(body, user, 'api');
    const validationRecord = await maybeCreateSkillValidationFromArtProgress(event, user);
    broadcastPlatformEvent('art-progress-events.changed', { module: 'skill-events' });
    if (validationRecord) {
      broadcastPlatformEvent('skill-validations.changed', { module: 'skill-validation' });
      broadcastUsageCountersChanged(validationRecord.usagePatch, {
        module: 'skill-validation',
        targetId: validationRecord.id || '',
        target: validationRecord.artifactName || validationRecord.researchName || ''
      });
    }
    sendJson(res, 201, validationRecord ? { event, validationRecord } : { event });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readBody(req);
    const result = await loginUser(body.username, body.password);
    if (!result) {
      await writeOperationLog(req, {
        user: { username: String(body.username || '').trim() },
        module: 'auth',
        action: 'LOGIN',
        actionName: '登录',
        targetType: 'user',
        targetName: String(body.username || '').trim(),
        result: 'fail',
        errorMessage: '用户名或密码错误。'
      });
      sendJson(res, 401, { error: '用户名或密码错误。' });
      return;
    }
    await writeOperationLog(req, {
      user: result.user,
      module: 'auth',
      action: 'LOGIN',
      actionName: '登录',
      targetType: 'user',
      targetId: result.user.id,
      targetName: result.user.username,
      description: `${result.user.displayName || result.user.username} 登录平台`
    });
    res.setHeader('Set-Cookie', buildSessionCookie(result.token));
    sendJson(res, 200, { user: result.user });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    await logoutUser(req);
    if (currentUser) {
      await writeOperationLog(req, {
        user: currentUser,
        module: 'auth',
        action: 'LOGOUT',
        actionName: '退出登录',
        targetType: 'user',
        targetId: currentUser.id,
        targetName: currentUser.username,
        description: `${currentUser.displayName || currentUser.username} 退出登录`
      });
    }
    res.setHeader('Set-Cookie', clearSessionCookie());
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
    requireAuth(currentUser);
    const body = await readBody(req);
    const user = await changeOwnPassword(currentUser.id, body.currentPassword, body.password);
    await writeOperationLog(req, {
      user,
      module: 'auth',
      action: 'CHANGE_OWN_PASSWORD',
      actionName: '修改本人密码',
      targetType: 'user',
      targetId: user.id,
      targetName: user.username,
      description: `${user.displayName || user.username} 修改了本人登录密码`
    });
    broadcastPlatformEvent('access-control.changed', { module: 'user', reason: 'password-display-updated' });
    res.setHeader('Set-Cookie', clearSessionCookie());
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    if (expiredSession) {
      await writeOperationLog(req, {
        userId: expiredSession.userId || '',
        username: 'expired-session',
        displayName: '登录态已过期',
        module: 'auth',
        action: 'SESSION_EXPIRED',
        actionName: '强制重新登录',
        targetType: 'session',
        targetId: expiredSession.id || '',
        targetName: expiredSession.userId || '',
        result: 'fail',
        description: '登录态过期或长时间未活跃，已要求重新登录',
        metadata: {
          createdAt: expiredSession.createdAt || '',
          lastSeenAt: expiredSession.lastSeenAt || '',
          expiresAt: expiredSession.expiresAt || ''
        }
      });
      res.setHeader('Set-Cookie', clearSessionCookie());
    }
    sendJson(res, 200, { user: currentUser });
    return;
  }

  requireAuth(currentUser);

  if (req.method === 'GET' && url.pathname === '/api/platform-events') {
    subscribePlatformEvents(req, res, currentUser);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/zentao-file') {
    await serveZentaoFileProxy(res, url.searchParams.get('url'));
    return;
  }


  if (req.method === 'GET' && url.pathname === '/api/art-progress-events/lifecycle') {
    requireAnyPermission(currentUser, ['artProgress.accessLogs.view', 'artProgress.logs.manage']);
    const events = await listArtProgressEvents(Object.fromEntries(url.searchParams.entries()));
    sendJson(res, 200, events.filter(event => isReporterLifecycleEvent(event)));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/art-progress-events') {
    sendJson(res, 200, await listVisibleArtProgressEvents(currentUser, Object.fromEntries(url.searchParams.entries())));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/art-progress-events/summary') {
    sendJson(res, 200, await buildArtProgressSummary(currentUser, Object.fromEntries(url.searchParams.entries())));
    return;
  }

  const artProgressEventDetail = url.pathname.match(/^\/api\/art-progress-events\/([^/]+)$/);
  if (artProgressEventDetail && req.method === 'PUT') {
    requirePermission(currentUser, 'api.skillAsset.create');
    const body = await readBody(req);
    const event = await editArtProgressEvent(artProgressEventDetail[1], body, currentUser);
    if (!event) {
      sendJson(res, 404, { error: '研究同步记录不存在。' });
      return;
    }
    broadcastPlatformEvent('art-progress-events.changed', { module: 'skill-events' });
    sendJson(res, 200, { event });
    return;
  }

  if (artProgressEventDetail && req.method === 'DELETE') {
    const existingEvent = (await listArtProgressEvents({})).find(event => String(event.id) === String(artProgressEventDetail[1]));
    if (isReporterLifecycleEvent(existingEvent)) {
      requireAnyPermission(currentUser, ['artProgress.logs.delete', 'artProgress.logs.manage', 'api.skillAsset.void']);
    } else {
      requirePermission(currentUser, 'api.skillAsset.void');
    }
    const event = await removeArtProgressEvent(artProgressEventDetail[1], currentUser);
    if (!event) {
      sendJson(res, 404, { error: '研究同步记录不存在。' });
      return;
    }
    broadcastPlatformEvent('art-progress-events.changed', { module: 'skill-events' });
    sendJson(res, 200, { event });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ai-asset-sheet') {
    requireAuth(currentUser);
    if (!hasPermission(currentUser, 'menu.skillList')) {
      throw new HttpError(403, '当前账号没有权限查看人工研究清单。');
    }
    sendJson(res, 200, await loadAiAssetSheet({ includeDeleted: url.searchParams.get('includeDeleted') === '1' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai-asset-sheet/rows') {
    requirePermission(currentUser, 'api.skillAsset.create');
    const result = await saveAiAssetOverride(await readBody(req), currentUser);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'ai-asset-sheet',
      action: 'UPSERT_AI_ASSET_ROW',
      actionName: '维护人工研究清单',
      targetType: 'ai-asset-row',
      targetId: result.savedRow?.id || '',
      targetName: result.savedRow?.title || '',
      after: result.savedRow,
      description: `${currentUser.displayName || currentUser.username} 维护人工研究记录「${result.savedRow?.title || result.savedRow?.id || ''}」`
    });
    broadcastPlatformEvent('ai-asset-sheet.changed', { module: 'ai-asset-sheet' });
    sendJson(res, 200, filterSkillValidationResponse(result));
    return;
  }

  const aiAssetSheetRowDetail = url.pathname.match(/^\/api\/ai-asset-sheet\/rows\/([^/]+)$/);
  if (req.method === 'DELETE' && aiAssetSheetRowDetail) {
    requirePermission(currentUser, 'api.skillAsset.void');
    const result = await deleteAiAssetOverride(aiAssetSheetRowDetail[1], currentUser);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'ai-asset-sheet',
      action: 'DELETE_AI_ASSET_ROW',
      actionName: '隐藏人工研究清单行',
      targetType: 'ai-asset-row',
      targetId: result.deletedRow?.id || aiAssetSheetRowDetail[1],
      targetName: result.deletedRow?.title || '',
      before: result.deletedRow,
      description: `${currentUser.displayName || currentUser.username} 隐藏人工研究记录「${result.deletedRow?.title || aiAssetSheetRowDetail[1]}」`
    });
    broadcastPlatformEvent('ai-asset-sheet.changed', { module: 'ai-asset-sheet' });
    sendJson(res, 200, filterSkillValidationResponse(result));
    return;
  }

  const aiAssetSheetRowRestore = url.pathname.match(/^\/api\/ai-asset-sheet\/rows\/([^/]+)\/restore$/);
  if (req.method === 'POST' && aiAssetSheetRowRestore) {
    requirePermission(currentUser, 'api.skillAsset.void');
    const result = await restoreAiAssetOverride(aiAssetSheetRowRestore[1], currentUser);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'ai-asset-sheet',
      action: 'RESTORE_AI_ASSET_ROW',
      actionName: '恢复人工研究清单行',
      targetType: 'ai-asset-row',
      targetId: result.restoredRow?.id || aiAssetSheetRowRestore[1],
      targetName: result.restoredRow?.title || '',
      after: result.restoredRow,
      description: `${currentUser.displayName || currentUser.username} 恢复人工研究记录「${result.restoredRow?.title || aiAssetSheetRowRestore[1]}」`
    });
    broadcastPlatformEvent('ai-asset-sheet.changed', { module: 'ai-asset-sheet' });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/art-project-sheet') {
    requirePermission(currentUser, 'menu.skillList');
    sendJson(res, 200, await loadArtProjectSheet({
      spreadsheetId: url.searchParams.get('spreadsheetId') || defaultArtProjectSheetId,
      gid: url.searchParams.get('gid') || defaultArtProjectSheetGid
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/art-project-sheet/rows') {
    requirePermission(currentUser, 'api.skillSources.manage');
    const row = await upsertArtProjectSheetOverride(await readBody(req));
    await writeOperationLog(req, {
      user: currentUser,
      module: 'project-sheet',
      action: 'UPSERT_ART_PROJECT_ROW',
      actionName: '维护项目列表字段',
      targetType: 'art-project-sheet-row',
      targetId: row.id,
      targetName: row.file,
      after: row,
      description: `${currentUser.displayName || currentUser.username} 维护项目列表「${row.file || row.id}」`
    });
    broadcastPlatformEvent('art-project-sheet.changed', { module: 'project-sheet' });
    sendJson(res, 200, row);
    return;
  }

  const artProjectSheetRowDetail = url.pathname.match(/^\/api\/art-project-sheet\/rows\/([^/]+)$/);
  if (req.method === 'DELETE' && artProjectSheetRowDetail) {
    requirePermission(currentUser, 'api.skillSources.delete');
    const row = await deleteArtProjectSheetOverride(artProjectSheetRowDetail[1]);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'project-sheet',
      action: 'HIDE_ART_PROJECT_ROW',
      actionName: '隐藏项目列表行',
      targetType: 'art-project-sheet-row',
      targetId: row.id,
      targetName: row.file,
      before: row,
      description: `${currentUser.displayName || currentUser.username} 隐藏项目列表「${row.file || row.id}」`
    });
    broadcastPlatformEvent('art-project-sheet.changed', { module: 'project-sheet' });
    sendJson(res, 200, row);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/art-project-sheet/fields') {
    requirePermission(currentUser, 'api.skillSources.manage');
    const config = await upsertArtProjectSheetField(await readBody(req));
    await writeOperationLog(req, {
      user: currentUser,
      module: 'art-project-sheet',
      action: 'UPSERT_ART_PROJECT_SHEET_FIELD',
      actionName: '维护项目列表字段',
      targetType: 'art-project-sheet-field',
      targetId: config.field?.key || '',
      targetName: config.field?.label || config.field?.key || '',
      after: config,
      description: `${currentUser.displayName || currentUser.username} 维护项目列表字段「${config.field?.label || config.field?.key || ''}」`
    });
    broadcastPlatformEvent('art-project-sheet.changed', { module: 'project-sheet' });
    sendJson(res, 200, config);
    return;
  }

  const artProjectSheetFieldDetail = url.pathname.match(/^\/api\/art-project-sheet\/fields\/([^/]+)$/);
  if (req.method === 'DELETE' && artProjectSheetFieldDetail) {
    requirePermission(currentUser, 'api.skillSources.delete');
    const config = await deleteArtProjectSheetField(artProjectSheetFieldDetail[1]);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'art-project-sheet',
      action: 'HIDE_ART_PROJECT_SHEET_FIELD',
      actionName: '隐藏项目列表字段',
      targetType: 'art-project-sheet-field',
      targetId: artProjectSheetFieldDetail[1],
      before: config.deletedField,
      description: `${currentUser.displayName || currentUser.username} 隐藏项目列表字段「${config.deletedField?.label || artProjectSheetFieldDetail[1]}」`
    });
    broadcastPlatformEvent('art-project-sheet.changed', { module: 'project-sheet' });
    sendJson(res, 200, config);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/skill-validations') {
    requirePermission(currentUser, 'menu.skillList');
    const payload = await loadSkillValidations();
    sendJson(res, 200, filterSkillValidationResponse(payload));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skill-validations') {
    requirePermission(currentUser, 'api.skillAsset.create');
    const body = await readBody(req);
    const result = await saveSkillValidationRecord(body, currentUser);
    const usagePatch = result.usagePatch || { matched: 0 };
    const targetName = skillValidationOperationTargetName(result.savedRecord);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'skill-validation',
      action: 'UPSERT_SKILL_VALIDATION',
      actionName: '保存验证回填',
      targetType: 'skill-validation',
      targetId: result.savedRecord?.id || '',
      targetName,
      after: result.savedRecord,
      description: `${currentUser.displayName || currentUser.username} 保存验证回填「${targetName}」`
    });
    broadcastPlatformEvent('skill-validations.changed', { module: 'skill-validation' });
    broadcastUsageCountersChanged(usagePatch, {
      module: 'skill-validation',
      targetId: result.savedRecord?.id || '',
      target: targetName
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/skill-validations/backfill') {
    requirePermission(currentUser, 'api.skillAsset.create');
    const body = await readBody(req);
    const sourceId = cleanText(body.id || body.sourceRef);
    const backfillId = sourceId ? `skill-validation-backfill-${sourceId}` : '';
    const result = await saveSkillValidationRecord({
      ...body,
      id: backfillId || body.id,
      rowNumber: 0,
      sourceRef: cleanText(body.sourceRef),
      originalSourceId: sourceId,
      forceDisplayInValidation: true,
      manualBackfill: true,
      originalSource: '工作台确认回填',
      source: '工作台确认回填'
    }, currentUser);
    const usagePatch = result.usagePatch || { matched: 0 };
    const targetName = skillValidationOperationTargetName(result.savedRecord);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'skill-validation',
      action: 'BACKFILL_SKILL_VALIDATION',
      actionName: '确认验证明细回填',
      targetType: 'skill-validation',
      targetId: result.savedRecord?.id || '',
      targetName,
      after: result.savedRecord,
      description: `${currentUser.displayName || currentUser.username} 确认回填验证明细「${targetName}」`
    });
    broadcastPlatformEvent('skill-validations.changed', { module: 'skill-validation' });
    broadcastUsageCountersChanged(usagePatch, {
      module: 'skill-validation',
      targetId: result.savedRecord?.id || '',
      target: targetName
    });
    sendJson(res, 200, result);
    return;
  }

  const skillValidationDetail = url.pathname.match(/^\/api\/skill-validations\/([^/]+)$/);
  if (req.method === 'DELETE' && skillValidationDetail) {
    requirePermission(currentUser, 'api.skillAsset.void');
    const result = await deleteSkillValidationRecord(skillValidationDetail[1], currentUser);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'skill-validation',
      action: 'DELETE_SKILL_VALIDATION',
      actionName: '删除验证回填',
      targetType: 'skill-validation',
      targetId: result.deletedRecord?.id || skillValidationDetail[1],
      targetName: result.deletedRecord?.artifactName || result.deletedRecord?.researchName || '',
      before: result.deletedRecord,
      description: `${currentUser.displayName || currentUser.username} 删除验证回填「${result.deletedRecord?.artifactName || result.deletedRecord?.researchName || skillValidationDetail[1]}」`
    });
    broadcastPlatformEvent('skill-validations.changed', { module: 'skill-validation' });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/skill-version') {
    const body = await readBody(req);
    const ownerChange = hasSkillVersionOwnerChange(body);
    const displayNameChange = hasSkillDisplayNameChange(body);
    const inventoryKindChange = hasSkillInventoryKindChange(body);
    const versionOrAliasChange = Object.prototype.hasOwnProperty.call(body, 'version')
      || Object.prototype.hasOwnProperty.call(body, 'aliases');
    if (ownerChange && !canManageSkillAssetOwner(currentUser)) {
      throw new HttpError(403, '当前账号没有权限修改产物贡献人。');
    }
    if (displayNameChange || inventoryKindChange) {
      requirePermission(currentUser, 'api.skillSources.manage');
      const project = body.projectId ? await getProject(body.projectId) : null;
      const sourceType = String(body.sourceType || project?.sourceType || '').toLowerCase();
      if (!['local', 'shared'].includes(sourceType)) {
        sendJson(res, 400, { error: '只有本地路径或共享盘扫描产物可以修改产物名称或类型。' });
        return;
      }
    }
    if (!displayNameChange && !inventoryKindChange && (versionOrAliasChange || !ownerChange)) {
      requirePermission(currentUser, 'api.skillVersion.manage');
    }
    const result = await saveSkillVersionOverride({ ...body, allowAliases: true });
    const aliasChanged = Object.prototype.hasOwnProperty.call(body, 'aliases');
    const usagePatch = aliasChanged
      ? await recordUsageCountersForSkillAliases(result.aliases || body.aliases || [], {
        target: result.title || body.title || result.relativePath || body.relativePath || body.id || result.key,
        kind: 'usage'
      }).catch(error => {
        console.warn('调用别名历史计数补录失败', error);
        return { matched: 0 };
      })
      : { matched: 0 };
    const actionName = inventoryKindChange
      ? '修改产物类型'
      : displayNameChange && Object.prototype.hasOwnProperty.call(body, 'aliases')
      ? '修改产物名称和调用别名'
      : displayNameChange
        ? '修改产物名称'
        : Object.prototype.hasOwnProperty.call(body, 'aliases')
          ? '修改产物调用别名'
          : '修改产物版本';
    await writeOperationLog(req, {
      user: currentUser,
      module: 'skill-inventory',
      action: 'UPDATE_SKILL_VERSION',
      actionName,
      targetType: 'skill',
      targetId: result.key,
      targetName: body.title || body.id || body.relativePath || '',
      after: result,
      description: `${currentUser.displayName || currentUser.username} ${actionName}`
    });
    broadcastPlatformEvent('skill-version-overrides.changed', {
      module: 'skill-inventory',
      override: result,
      projectId: result.projectId || body.projectId || '',
      relativePath: result.relativePath || body.relativePath || ''
    });
    if (usagePatch.matched) {
      broadcastPlatformEvent('usage-counters.changed', {
        module: 'skill-inventory',
        target: result.title || result.relativePath || '',
        matched: usagePatch.matched
      });
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/skill-version-overrides') {
    requireAnyPermission(currentUser, ['menu.skillList']);
    const overrides = await loadSkillVersionOverrides();
    sendJson(res, 200, { overrides });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/project-scan-cache') {
    requireAnyPermission(currentUser, ['menu.skillList']);
    const projects = await listProjects();
    const projectIds = new Set(projects.map(project => project.id));
    const projectById = new Map(projects.map(project => [project.id, project]));
    const cache = await loadProjectScanCache();
    let shouldPersistAuditHydration = false;
    const scans = {};
    for (const [projectId, entry] of Object.entries(cache)) {
      const scanEntry = entry?.scan && typeof entry.scan === 'object' ? entry.scan : entry;
      const cachedAt = entry?.scan ? entry.cachedAt : entry?.cachedAt;
      if (projectIds.size && !projectIds.has(projectId)) {
        const cachedScan = scanEntry;
        const hasCachedProducts = Array.isArray(cachedScan?.skills) && cachedScan.skills.length > 0;
        if (!hasCachedProducts) continue;
      }
      const scan = scanEntry;
      if (!scan || typeof scan !== 'object') continue;
      const scanWithAudit = await hydrateCachedSkillAuditScores(scan);
      if (scanWithAudit !== scan) {
        cache[projectId] = {
          ...(entry?.scan ? entry : { projectId }),
          scan: scanWithAudit
        };
        shouldPersistAuditHydration = true;
      }
      const scanWithOverrides = await applySkillVersionOverridesToScan(scanWithAudit);
      const project = projectById.get(projectId) || {};
      scans[projectId] = {
        ...scan,
        ...scanWithOverrides,
        projectId,
        projectName: scanWithOverrides.projectName || scan.projectName || project.name || projectId,
        name: scanWithOverrides.name || scan.name || project.name || projectId,
        rootPath: scanWithOverrides.rootPath || scan.rootPath || project.rootPath || '',
        sourceType: scanWithOverrides.sourceType || scan.sourceType || project.sourceType || '',
        framework: scanWithOverrides.framework || scan.framework || project.framework || '',
        cacheOnly: true,
        cachedAt: cachedAt || scanWithOverrides.cachedAt || ''
      };
    }
    if (shouldPersistAuditHydration) await writeProjectScanCache(cache);
    sendJson(res, 200, { scans, productStats: buildSkillInventoryProductStats(scans) });
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/skill-alias') {
    requirePermission(currentUser, 'api.skillAlias.manage');
    const body = await readBody(req);
    const result = await saveSkillVersionOverride({ ...body, version: '', allowVersion: false, allowAliases: true });
    const usagePatch = await recordUsageCountersForSkillAliases(result.aliases || body.aliases || [], {
      target: result.title || body.title || result.relativePath || body.relativePath || body.id || result.key,
      kind: 'usage'
    }).catch(error => {
      console.warn('调用别名历史计数补录失败', error);
      return { matched: 0 };
    });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'skill-inventory',
      action: 'UPDATE_SKILL_ALIAS',
      actionName: '修改产物调用别名',
      targetType: 'skill',
      targetId: result.key,
      targetName: body.title || body.id || body.relativePath || '',
      after: result,
      description: `${currentUser.displayName || currentUser.username} 修改产物调用别名`
    });
    broadcastPlatformEvent('skill-version-overrides.changed', {
      module: 'skill-inventory',
      overrideKey: result.key,
      projectId: result.projectId || '',
      relativePath: result.relativePath || ''
    });
    if (usagePatch.matched) {
      broadcastPlatformEvent('usage-counters.changed', {
        module: 'skill-inventory',
        target: result.title || result.relativePath || '',
        matched: usagePatch.matched
      });
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/skill-inventory/visibility') {
    requirePermission(currentUser, 'api.skillVersion.manage');
    const body = await readBody(req);
    const result = await saveSkillInventoryVisibilityOverride(body, currentUser);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'skill-inventory',
      action: result.hidden ? 'VOID_SKILL_ASSET' : 'RESTORE_SKILL_ASSET',
      actionName: result.hidden ? '作废产物' : '恢复产物',
      targetType: 'skill',
      targetId: result.key,
      targetName: body.title || body.id || body.relativePath || '',
      after: result,
      description: `${currentUser.displayName || currentUser.username} ${result.hidden ? '作废' : '恢复'}产物「${body.title || body.id || body.relativePath || result.key}」`
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/skill-inventory/display-visibility') {
    requirePermission(currentUser, 'api.skillSources.manage');
    const body = await readBody(req);
    const project = body.projectId ? await getProject(body.projectId) : null;
    const sourceType = String(body.sourceType || project?.sourceType || '').toLowerCase();
    if (!['local', 'shared'].includes(sourceType)) {
      sendJson(res, 400, { error: '只有本地路径或共享盘扫描产物可以调整展示状态。' });
      return;
    }
    const result = await saveSkillInventoryDisplayVisibilityOverride({ ...body, sourceType }, currentUser);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'skill-inventory',
      action: result.displayHidden ? 'HIDE_SCAN_SOURCE_PRODUCT' : 'SHOW_SCAN_SOURCE_PRODUCT',
      actionName: result.displayHidden ? '隐藏扫描产物展示' : '展示扫描产物',
      targetType: 'skill',
      targetId: result.key,
      targetName: body.title || body.id || body.relativePath || body.path || '',
      after: result,
      description: `${currentUser.displayName || currentUser.username} ${result.displayHidden ? '隐藏' : '展示'}扫描产物「${body.title || body.id || body.relativePath || body.path || result.key}」`
    });
    broadcastPlatformEvent('project-scan-cache.changed', { projectId: body.projectId || '', module: 'skill-inventory' });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/audit/action') {
    const body = await readBody(req).catch(() => ({}));
    const action = String(body.action || '').trim();
    const allowedActions = {
      SAVE_TASK_PROCESSING_NOTE: ['task', '保存任务处理备注', 'task']
    };
    const config = allowedActions[action];
    if (!config) {
      sendJson(res, 400, { error: '不支持的操作留痕类型。' });
      return;
    }
    await writeOperationLog(req, {
      user: currentUser,
      module: body.module || config[0],
      action,
      actionName: body.actionName || config[1],
      targetType: body.targetType || config[2],
      targetId: String(body.targetId || '').trim(),
      targetName: String(body.targetName || '').trim(),
      metadata: body.metadata || {},
      description: String(body.description || '').trim()
        || `${currentUser.displayName || currentUser.username} ${config[1]}「${String(body.targetName || body.targetId || '').trim()}」`
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ai-members') {
    requireAnyPermission(currentUser, ['api.aiMembers.read', 'menu.aiMembers']);
    sendJson(res, 200, await loadAiMembersSnapshot(currentUser));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ai-member-score-snapshot') {
    requireAnyPermission(currentUser, ['api.aiMembers.score.read', 'aiMembers.score.view']);
    sendJson(res, 200, await getAiMemberScoreSnapshot());
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/ai-member-score-snapshot') {
    requireAnyPermission(currentUser, ['api.aiMembers.score.write', 'aiMembers.score.refresh']);
    const body = await readBody(req);
    const snapshot = await upsertAiMemberScoreSnapshot({
      rows: body.rows,
      key: body.key,
      month: body.month,
      savedAt: body.savedAt,
      savedBy: {
        id: currentUser.id || '',
        username: currentUser.username || '',
        displayName: currentUser.displayName || currentUser.username || ''
      }
    });
    broadcastPlatformEvent('ai-member-score-snapshot.changed', { module: 'ai-members-score', savedAt: snapshot.savedAt });
    sendJson(res, 200, snapshot);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/users') {
    requirePermission(currentUser, 'api.users.manage');
    sendJson(res, 200, await listPublicUsers());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/users') {
    requirePermission(currentUser, 'api.users.manage');
    const body = await readBody(req);
    const user = await createUser(body);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'user',
      action: 'CREATE_USER',
      actionName: '新增账号',
      targetType: 'user',
      targetId: user.id,
      targetName: user.username,
      after: user,
      description: `${currentUser.displayName || currentUser.username} 新增账号「${user.username}」`
    });
    broadcastPlatformEvent('access-control.changed', { module: 'user' });
    sendJson(res, 201, user);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/operation-logs') {
    const moduleFilter = String(url.searchParams.get('module') || '').trim();
    if (moduleFilter === 'art-progress') {
      requireAnyPermission(currentUser, ['artProgress.operationLogs.view', 'artProgress.logs.manage']);
    } else {
      requirePermission(currentUser, 'api.operationLogs.read');
    }
    sendJson(res, 200, await listOperationLogs(Object.fromEntries(url.searchParams.entries())));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/maintenance/overview') {
    requireRole(currentUser, 'admin');
    requirePermission(currentUser, 'api.maintenance.manage');
    sendJson(res, 200, await maintenanceOverview());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/maintenance/preview') {
    requireRole(currentUser, 'admin');
    requirePermission(currentUser, 'api.maintenance.manage');
    const body = await readBody(req);
    sendJson(res, 200, await previewMaintenanceAction(body));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/maintenance/apply') {
    requireRole(currentUser, 'admin');
    requirePermission(currentUser, 'api.maintenance.manage');
    const body = await readBody(req);
    const result = await applyMaintenanceAction(body);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'maintenance',
      action: 'APPLY_MAINTENANCE_ACTION',
      actionName: '执行维护中心清理',
      targetType: body?.type || 'maintenance',
      targetId: body?.type || 'maintenance',
      targetName: maintenanceActionLabel(body?.type),
      before: { type: body?.type || '', filters: body?.filters || {} },
      after: {
        deletedCount: result.deletedCount || 0,
        skippedCount: result.skippedCount || 0,
        releasedBytes: result.releasedBytes || result.estimatedBytes || 0,
        removedArtBriefRecords: result.removedArtBriefRecords || 0
      },
      description: `${currentUser.displayName || currentUser.username} 在维护中心执行「${maintenanceActionLabel(body?.type)}」，删除 ${Number(result.deletedCount || 0)} 项`
    });
    broadcastPlatformEvent('maintenance.changed', { module: 'maintenance', type: body?.type || '', result });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/operation-logs') {
    requirePermission(currentUser, 'api.operationLogs.delete');
    const body = await readBody(req);
    const filters = body?.filters && typeof body.filters === 'object' ? body.filters : {};
    const result = await deleteOperationLogsByFilters(filters);
    broadcastPlatformEvent('operation-logs.changed', { module: 'operation-log' });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/operation-logs/view') {
    requireAuth(currentUser);
    const body = await readBody(req);
    const view = String(body.view || '').trim();
    const viewName = String(body.viewName || view || '工作台页面').trim();
    if (!view) {
      sendJson(res, 400, { error: '缺少页面标识。' });
      return;
    }
    const log = await writeOperationLog(req, {
      user: currentUser,
      module: 'workbench',
      action: 'VIEW_PAGE',
      actionName: '进入页面',
      targetType: 'view',
      targetId: view,
      targetName: viewName,
      result: 'success',
      description: `${currentUser.displayName || currentUser.username} 进入「${viewName}」`,
      metadata: {
        path: body.path || ''
      }
    });
    sendJson(res, 201, { log });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/skill-usage/task-art-brief') {
    requireAnyPermission(currentUser, ['skill.usageLogs.view', 'api.operationLogs.read']);
    sendJson(res, 200, await listOperationLogs({
      module: 'task',
      actions: [
        'GENERATE_ZENTAO_ART_BRIEF',
        'REUSE_ZENTAO_ART_BRIEF',
        'REGENERATE_ZENTAO_ART_BRIEF'
      ],
      pageSize: url.searchParams.get('pageSize') || 200
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/usage-counters') {
    requireAnyPermission(currentUser, ['skill.usageLogs.view', 'menu.skillList']);
    sendJson(res, 200, await getUsageCounters());
    return;
  }

  const operationLogDetail = url.pathname.match(/^\/api\/operation-logs\/([^/]+)$/);
  if (operationLogDetail && req.method === 'DELETE') {
    const targetLog = await getOperationLog(operationLogDetail[1]);
    if (targetLog?.module === 'art-progress') {
      requireAnyPermission(currentUser, ['artProgress.logs.delete', 'artProgress.logs.manage', 'api.operationLogs.delete']);
    } else {
      requirePermission(currentUser, 'api.operationLogs.delete');
    }
    const log = await deleteOperationLog(operationLogDetail[1]);
    if (!log) {
      sendJson(res, 404, { error: '操作日志记录不存在。' });
      return;
    }
    broadcastPlatformEvent('operation-logs.changed', { module: 'operation-log' });
    sendJson(res, 200, { log });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/roles') {
    requirePermission(currentUser, 'api.roles.manage');
    sendJson(res, 200, await listRoles());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/permissions') {
    requirePermission(currentUser, 'api.roles.manage');
    sendJson(res, 200, listPermissionCatalog());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/roles') {
    requirePermission(currentUser, 'api.roles.manage');
    const body = await readBody(req);
    const role = await upsertRole(body);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'role',
      action: 'CREATE_ROLE',
      actionName: '新增角色',
      targetType: 'role',
      targetId: role.id,
      targetName: role.name,
      after: role,
      description: `${currentUser.displayName || currentUser.username} 新增角色「${role.name}」`
    });
    broadcastPlatformEvent('access-control.changed', { module: 'role' });
    sendJson(res, 201, role);
    return;
  }

  const roleDetail = url.pathname.match(/^\/api\/roles\/([^/]+)$/);
  if (req.method === 'PATCH' && roleDetail) {
    requirePermission(currentUser, 'api.roles.manage');
    const before = (await listRoles()).find(role => role.id === roleDetail[1]) || null;
    const role = await upsertRole({ ...(await readBody(req)), id: roleDetail[1] });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'role',
      action: 'UPDATE_ROLE',
      actionName: '编辑角色',
      targetType: 'role',
      targetId: role.id,
      targetName: role.name,
      before,
      after: role,
      description: `${currentUser.displayName || currentUser.username} 编辑角色「${role.name}」`
    });
    broadcastPlatformEvent('access-control.changed', { module: 'role' });
    sendJson(res, 200, role);
    return;
  }

  if (req.method === 'DELETE' && roleDetail) {
    requirePermission(currentUser, 'api.roles.manage');
    const role = await deleteRole(roleDetail[1]);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'role',
      action: 'DELETE_ROLE',
      actionName: '删除角色',
      targetType: 'role',
      targetId: role.id,
      targetName: role.name,
      before: role,
      description: `${currentUser.displayName || currentUser.username} 删除角色「${role.name}」`
    });
    broadcastPlatformEvent('access-control.changed', { module: 'role' });
    sendJson(res, 200, role);
    return;
  }

  const userDetail = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (req.method === 'PATCH' && userDetail) {
    requirePermission(currentUser, 'api.users.manage');
    const before = (await listPublicUsers()).find(user => user.id === userDetail[1]) || null;
    const user = await updateUser(userDetail[1], await readBody(req));
    await writeOperationLog(req, {
      user: currentUser,
      module: 'user',
      action: 'UPDATE_USER',
      actionName: '编辑账号',
      targetType: 'user',
      targetId: user.id,
      targetName: user.username,
      before,
      after: user,
      description: `${currentUser.displayName || currentUser.username} 编辑账号「${user.username}」`
    });
    broadcastPlatformEvent('access-control.changed', { module: 'user' });
    sendJson(res, 200, user);
    return;
  }

  if (req.method === 'DELETE' && userDetail) {
    requirePermission(currentUser, 'api.users.manage');
    const user = await deleteUser(userDetail[1], currentUser.id);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'user',
      action: 'DELETE_USER',
      actionName: '删除账号',
      targetType: 'user',
      targetId: user.id,
      targetName: user.username,
      before: user,
      description: `${currentUser.displayName || currentUser.username} 删除账号「${user.username}」`
    });
    broadcastPlatformEvent('access-control.changed', { module: 'user' });
    sendJson(res, 200, user);
    return;
  }

  const userPassword = url.pathname.match(/^\/api\/users\/([^/]+)\/password$/);
  if (req.method === 'POST' && userPassword) {
    requirePermission(currentUser, 'api.users.manage');
    const body = await readBody(req);
    const user = await resetUserPassword(userPassword[1], body.password);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'user',
      action: 'RESET_USER_PASSWORD',
      actionName: '重置密码',
      targetType: 'user',
      targetId: user.id,
      targetName: user.username,
      description: `${currentUser.displayName || currentUser.username} 重置账号「${user.username}」密码`
    });
    broadcastPlatformEvent('access-control.changed', { module: 'user' });
    sendJson(res, 200, user);
    return;
  }

  const userVisiblePassword = url.pathname.match(/^\/api\/users\/([^/]+)\/visible-password$/);
  if (req.method === 'POST' && userVisiblePassword) {
    requirePermission(currentUser, 'api.users.manage');
    const body = await readBody(req);
    const user = await recordUserVisiblePassword(userVisiblePassword[1], body.password, body.source || '手动登记');
    await writeOperationLog(req, {
      user: currentUser,
      module: 'user',
      action: 'RECORD_USER_VISIBLE_PASSWORD',
      actionName: '登记密码展示',
      targetType: 'user',
      targetId: user.id,
      targetName: user.username,
      description: `${currentUser.displayName || currentUser.username} 登记账号「${user.username}」的密码展示`
    });
    broadcastPlatformEvent('access-control.changed', { module: 'user' });
    sendJson(res, 200, user);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/fs/directories') {
    requirePermission(currentUser, 'api.skillSources.manage');
    sendJson(res, 200, await listDirectories(url.searchParams.get('path')));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/fs/open-directory') {
    requirePermission(currentUser, 'api.skillSources.manage');
    const body = await readBody(req);
    const target = normalizeFsPath(body.path);
    if (!target) {
      sendJson(res, 400, { error: 'path is required' });
      return;
    }
    if (!isDirectoryBrowseAllowed(target)) {
      sendJson(res, 403, { error: '目录不在允许浏览范围内，请调整目录或配置 ART_PLATFORM_ALLOWED_BROWSE_ROOTS。' });
      return;
    }
    const stat = await fs.stat(target).catch(() => null);
    if (!stat?.isDirectory()) {
      sendJson(res, 400, { error: 'directory not found' });
      return;
    }
    await execFileAsync('open', [target]);
    sendJson(res, 200, { ok: true, path: target });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/projects') {
    const projects = await listProjects();
    sendJson(res, 200, projects.filter(project => canAccessProject(currentUser, project.id)).map(redactProject));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/custom-workflows') {
    const projectId = url.searchParams.get('projectId') || '';
    if (projectId) requireProjectAccess(currentUser, projectId, 'viewer');
    const workflows = await listCustomWorkflows({ projectId });
    sendJson(res, 200, workflows.filter(workflow => !workflow.projectId || canAccessProject(currentUser, workflow.projectId)));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/custom-workflows') {
    const body = await readBody(req);
    if (body.projectId) requireProjectAccess(currentUser, body.projectId, 'developer', 'api.workflow.manage');
    else requirePermission(currentUser, 'api.workflow.manage');
    const workflow = await upsertCustomWorkflow(body);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'workflow',
      action: body.id ? 'UPDATE_WORKFLOW' : 'CREATE_WORKFLOW',
      actionName: body.id ? '编辑工作流模板' : '新增工作流模板',
      targetType: 'custom_workflow',
      targetId: workflow.id,
      targetName: workflow.name,
      after: workflow,
      description: `${currentUser.displayName || currentUser.username} ${body.id ? '编辑' : '新增'}工作流模板「${workflow.name}」`
    });
    sendJson(res, 201, workflow);
    return;
  }

  const customWorkflowDetail = url.pathname.match(/^\/api\/custom-workflows\/([^/]+)$/);
  if (req.method === 'GET' && customWorkflowDetail) {
    const workflow = await getCustomWorkflow(customWorkflowDetail[1]);
    if (!workflow) {
      sendJson(res, 404, { error: 'custom workflow not found' });
      return;
    }
    if (workflow.projectId) requireProjectAccess(currentUser, workflow.projectId, 'viewer');
    sendJson(res, 200, workflow);
    return;
  }

  if (req.method === 'DELETE' && customWorkflowDetail) {
    const existingWorkflow = await getCustomWorkflow(customWorkflowDetail[1]);
    if (!existingWorkflow) {
      sendJson(res, 404, { error: 'custom workflow not found' });
      return;
    }
    if (existingWorkflow.projectId) requireProjectAccess(currentUser, existingWorkflow.projectId, 'developer', 'api.workflow.manage');
    else requirePermission(currentUser, 'api.workflow.manage');
    const workflow = await deleteCustomWorkflow(customWorkflowDetail[1]);
    if (!workflow) {
      sendJson(res, 404, { error: 'custom workflow not found' });
      return;
    }
    await writeOperationLog(req, {
      user: currentUser,
      module: 'workflow',
      action: 'DELETE_WORKFLOW',
      actionName: '删除工作流模板',
      targetType: 'custom_workflow',
      targetId: workflow.id,
      targetName: workflow.name,
      before: workflow,
      description: `${currentUser.displayName || currentUser.username} 删除工作流模板「${workflow.name}」`
    });
    sendJson(res, 200, { ok: true, workflow });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    sendJson(res, 200, {
      zentaoBaseUrl,
      codex: redactCodexConfig(await getCodexConfig()),
      zentaoAutoSync: compactZentaoAutoSyncState(zentaoAutoSyncState),
      zentaoArtDeptId,
      zentaoArtUsers: await getZentaoArtUserList(),
      taskCenter: await getTaskCenterConfig(),
      workflowLevels
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/task-center/config') {
    requireAnyPermission(currentUser, ['api.taskCenter.config.manage', 'skill.validationColumns.manage']);
    if (!canAccessProject(currentUser, artProjectId)) {
      const error = new Error('当前账号没有该项目权限。');
      error.status = 403;
      throw error;
    }
    const config = await upsertTaskCenterConfig(await readBody(req));
    await writeOperationLog(req, {
      user: currentUser,
      module: 'task',
      action: 'UPSERT_TASK_CENTER_CONFIG',
      actionName: '保存任务中心字段配置',
      targetType: 'task_center_config',
      targetId: 'member-visible-columns',
      targetName: '组员可见字段',
      after: config,
      description: `${currentUser.displayName || currentUser.username} 保存任务中心组员可见字段配置`
    });
    sendJson(res, 200, config);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/codex/config') {
    requirePermission(currentUser, 'api.codex.config.read');
    sendJson(res, 200, redactCodexConfig(await getCodexConfig()));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/codex/config') {
    requirePermission(currentUser, 'api.codex.config.manage');
    const body = await readBody(req);
    const before = redactCodexConfig(await getCodexConfig());
    const config = redactCodexConfig(await upsertCodexConfig(body));
    await writeOperationLog(req, {
      user: currentUser,
      module: 'codex',
      action: 'UPSERT_CODEX_CONFIG',
      actionName: '保存 Codex 配置',
      targetType: 'codex_config',
      targetId: 'codex-config',
      targetName: config.model || config.modelProvider || 'Codex 配置',
      before,
      after: config,
      metadata: {
        keyAction: body.clearApiKey === true ? 'clear' : String(body.apiKey || '').trim() ? 'replace' : 'keep',
        keyFingerprint: config.keyFingerprint || '',
        previousKeyFingerprint: before.keyFingerprint || '',
        model: config.model || '',
        baseUrl: config.baseUrl || ''
      },
      description: `${currentUser.displayName || currentUser.username} 保存 Codex 配置${config.keyFingerprint ? `（Key ${config.keyFingerprint}）` : ''}`
    });
    sendJson(res, 200, config);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/agent-workers') {
    requirePermission(currentUser, 'api.agentWorkers.read');
    const workers = await listAgentWorkers(url.searchParams.get('mine') === '1' ? { userId: currentUser.id } : {});
    sendJson(res, 200, workers);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/agent-worker-users') {
    requirePermission(currentUser, 'api.agentWorkers.read');
    sendJson(res, 200, await listAgentWorkerUsers());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/agent-workers/heartbeat') {
    requirePermission(currentUser, 'api.agentWorkers.heartbeat');
    const body = await readBody(req);
    const worker = await upsertAgentWorker({
      ...body,
      userId: currentUser.id,
      userName: currentUser.displayName || currentUser.username,
      lastHeartbeatAt: new Date().toISOString()
    });
    broadcastPlatformEvent('agent-workers.changed', { userId: currentUser.id, deviceId: worker.deviceId, module: 'agent-worker' });
    sendJson(res, 200, worker);
    return;
  }

  const agentWorkerAlias = url.pathname.match(/^\/api\/agent-workers\/([^/]+)\/alias$/);
  if (req.method === 'PATCH' && agentWorkerAlias) {
    requirePermission(currentUser, 'api.agentWorkers.alias');
    const body = await readBody(req).catch(() => ({}));
    const workerId = decodeURIComponent(agentWorkerAlias[1]);
    const worker = await updateAgentWorkerAlias(workerId, currentUser.id, body.alias || body.deviceAlias || '');
    if (!worker) throw new HttpError(404, '只能修改本人已绑定设备的花名。');
    await writeOperationLog(req, {
      user: currentUser,
      module: 'agent-worker',
      action: 'UPDATE_AGENT_WORKER_ALIAS',
      actionName: '修改 Worker 设备花名',
      targetType: 'agent-worker',
      targetId: worker.id,
      targetName: worker.deviceAlias || worker.deviceName || worker.deviceId,
      after: { id: worker.id, deviceAlias: worker.deviceAlias, deviceName: worker.deviceName, deviceId: worker.deviceId },
      description: `${currentUser.displayName || currentUser.username} 修改本机 Worker 设备花名为「${worker.deviceAlias || worker.deviceName || worker.deviceId}」`
    });
    broadcastPlatformEvent('agent-workers.changed', { userId: currentUser.id, deviceId: worker.deviceId, module: 'agent-worker' });
    sendJson(res, 200, worker);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/agent-runs/next') {
    requirePermission(currentUser, 'api.agentRuns.claim');
    const body = await readBody(req).catch(() => ({}));
    const workerInput = {
      ...body,
      userId: currentUser.id,
      userName: currentUser.displayName || currentUser.username,
      status: 'online',
      lastHeartbeatAt: new Date().toISOString()
    };
    const capabilities = Array.isArray(workerInput.capabilities)
      ? workerInput.capabilities
      : String(workerInput.capabilities || '').split(/\n|,|，/).map(item => item.trim()).filter(Boolean);
    const run = await claimNextAgentRun({
      userId: currentUser.id,
      deviceId: workerInput.deviceId,
      capabilities,
      allowedProjectIds: currentUser.projectIds || [],
      canAccessAllProjects: currentUser.role === 'admin'
    });
    const worker = await upsertAgentWorker(workerInput);
    broadcastPlatformEvent('agent-workers.changed', { userId: currentUser.id, deviceId: worker.deviceId, module: 'agent-worker' });
    if (!run) {
      sendJson(res, 200, { run: null, worker });
      return;
    }
    await writeOperationLog(req, {
      user: currentUser,
      module: 'run',
      action: run.sourceType === 'direct-skill' || run.executionMode === 'direct-skill' ? 'CLAIM_DIRECT_SKILL_RUN' : 'CLAIM_LOCAL_WORKER_RUN',
      actionName: run.sourceType === 'direct-skill' || run.executionMode === 'direct-skill' ? '本机领取直接执行' : '本机领取美术执行',
      targetType: 'run',
      targetId: run.id,
      targetName: run.title,
      after: run,
      metadata: { deviceId: worker.deviceId, capabilities: worker.capabilities },
      description: `${currentUser.displayName || currentUser.username} 的本机 Worker 领取${run.sourceType === 'direct-skill' || run.executionMode === 'direct-skill' ? '直接执行' : '美术执行'}「${run.title}」`
    });
    broadcastPlatformEvent('runs.changed', { projectId: run.projectId, runId: run.id, run, module: 'agent-run' });
    sendJson(res, 200, { run, worker });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/agent-runs/recover') {
    requirePermission(currentUser, 'api.agentRuns.claim');
    const body = await readBody(req).catch(() => ({}));
    const workerInput = {
      ...body,
      userId: currentUser.id,
      userName: currentUser.displayName || currentUser.username,
      status: 'online',
      lastHeartbeatAt: new Date().toISOString()
    };
    const capabilities = Array.isArray(workerInput.capabilities)
      ? workerInput.capabilities
      : String(workerInput.capabilities || '').split(/\n|,|，/).map(item => item.trim()).filter(Boolean);
    const run = await claimRecoverableAgentRun({
      userId: currentUser.id,
      deviceId: workerInput.deviceId,
      runId: workerInput.runId,
      capabilities,
      allowedProjectIds: currentUser.projectIds || [],
      canAccessAllProjects: currentUser.role === 'admin'
    });
    if (!run) {
      sendJson(res, 200, { run: null });
      return;
    }
    const worker = await upsertAgentWorker(workerInput);
    broadcastPlatformEvent('agent-workers.changed', { userId: currentUser.id, deviceId: worker.deviceId, module: 'agent-worker' });
    const { _changed, ...stableRun } = run;
    if (run._changed === false) {
      sendJson(res, 200, { run: stableRun, worker });
      return;
    }
    await writeOperationLog(req, {
      user: currentUser,
      module: 'run',
      action: stableRun.sourceType === 'direct-skill' || stableRun.executionMode === 'direct-skill' ? 'RECOVER_DIRECT_SKILL_RUN' : 'RECOVER_LOCAL_WORKER_RUN',
      actionName: stableRun.sourceType === 'direct-skill' || stableRun.executionMode === 'direct-skill' ? '恢复本机直接执行' : '恢复本机美术执行',
      targetType: 'run',
      targetId: stableRun.id,
      targetName: stableRun.title,
      after: stableRun,
      metadata: { deviceId: worker.deviceId, capabilities: worker.capabilities },
      description: `${currentUser.displayName || currentUser.username} 的本机 Worker 恢复${stableRun.sourceType === 'direct-skill' || stableRun.executionMode === 'direct-skill' ? '直接执行' : '美术执行'}「${stableRun.title}」`
    });
    broadcastPlatformEvent('runs.changed', { projectId: stableRun.projectId, runId: stableRun.id, run: stableRun, module: 'agent-run-recover' });
    sendJson(res, 200, { run: stableRun, worker });
    return;
  }

  const agentRunLog = url.pathname.match(/^\/api\/agent-runs\/([^/]+)\/log$/);
  if (req.method === 'POST' && agentRunLog) {
    const run = await requireRun(agentRunLog[1]);
    requireProjectAccess(currentUser, run.projectId, 'developer', 'api.agentRuns.log');
    ensureWorkerCanUpdateRun(currentUser, run);
    const body = await readBody(req).catch(() => ({}));
    const chunk = String(body.chunk || body.text || '').slice(0, 20000);
    if (chunk) {
      await appendRunLog(run.id, chunk);
      await ensureRunLogPath(run.id);
    }
    broadcastPlatformEvent('runs.changed', { projectId: run.projectId, runId: run.id, module: 'agent-run-log' });
    sendJson(res, 200, { ok: true });
    return;
  }

  const agentRunStatus = url.pathname.match(/^\/api\/agent-runs\/([^/]+)\/status$/);
  if (req.method === 'POST' && agentRunStatus) {
    const run = await requireRun(agentRunStatus[1]);
    requireProjectAccess(currentUser, run.projectId, 'developer', 'api.agentRuns.status');
    ensureWorkerCanUpdateRun(currentUser, run);
    const body = await readBody(req).catch(() => ({}));
    const updated = await updateAgentRunFromWorker(run.id, body);
    const { _changed, ...stableUpdated } = updated || {};
    if (updated?._changed === false) {
      sendJson(res, 200, stableUpdated);
      return;
    }
    const workerRunKind = run.sourceType === 'direct-skill' || run.executionMode === 'direct-skill' ? '直接执行' : '美术执行';
    await writeOperationLog(req, {
      user: currentUser,
      module: 'run',
      action: workerRunKind === '直接执行' ? 'UPDATE_DIRECT_SKILL_RUN' : 'UPDATE_LOCAL_WORKER_RUN',
      actionName: `回传${workerRunKind}状态`,
      targetType: 'run',
      targetId: run.id,
      targetName: run.title,
      before: run,
      after: stableUpdated,
      metadata: {
        status: body.status || body.workerStatus || '',
        figmaWritten: body.figmaWriteResult?.written === true || body.resultSummary?.figmaWritten === true
      },
      description: `${currentUser.displayName || currentUser.username} 回传${workerRunKind}「${run.title}」状态：${body.status || body.workerStatus || 'running'}`
    });
    const usagePatch = await recordUsageCountersForRun(stableUpdated, {
      source: workerRunKind === '直接执行' ? 'direct-skill-run' : 'agent-run-status',
      at: stableUpdated.finishedAt || stableUpdated.updatedAt || new Date().toISOString()
    }).catch(error => {
      console.warn('执行状态调用次数累计失败', error);
      return null;
    });
    broadcastUsageCountersChanged(usagePatch, {
      module: workerRunKind === '直接执行' ? 'direct-skill-run' : 'agent-run-status',
      runId: stableUpdated.id,
      projectId: stableUpdated.projectId
    });
    broadcastPlatformEvent('runs.changed', { projectId: run.projectId, runId: run.id, run: stableUpdated, module: 'agent-run-status' });
    sendJson(res, 200, stableUpdated);
    return;
  }

  const agentRunSync = url.pathname.match(/^\/api\/agent-runs\/([^/]+)\/sync$/);
  if (req.method === 'POST' && agentRunSync) {
    const run = await requireRun(agentRunSync[1]);
    requireProjectAccess(currentUser, run.projectId, 'developer', 'api.agentRuns.status');
    ensureWorkerCanUpdateRun(currentUser, run);
    const body = await readBody(req).catch(() => ({}));
    const updated = await applyAgentRunEvents(run.id, body);
    const { _changed, ...stableUpdated } = updated || {};
    if (updated?._changed === false) {
      sendJson(res, 200, stableUpdated || run);
      return;
    }
    broadcastPlatformEvent('runs.changed', { projectId: run.projectId, runId: run.id, run: stableUpdated || run, module: 'agent-run-offline-sync' });
    sendJson(res, 200, stableUpdated || run);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/agent-runs/missing') {
    requireAnyPermission(currentUser, ['api.agentRuns.claim', 'api.agentRuns.status']);
    const body = await readBody(req).catch(() => ({}));
    const runIds = Array.isArray(body.runIds) ? body.runIds : [];
    sendJson(res, 200, { missingRunIds: await listMissingRunIds(runIds) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/projects') {
    const body = await readBody(req);
    const before = body.id ? await getProject(body.id) : null;
    requirePermission(currentUser, before ? 'api.skillSources.manage' : 'api.skillSources.manage');
    const project = redactProject(await upsertProject(body));
    await writeOperationLog(req, {
      user: currentUser,
      module: 'project',
      action: before ? 'UPDATE_PROJECT' : 'CREATE_PROJECT',
      actionName: before ? '编辑项目' : '接入项目',
      targetType: 'project',
      targetId: project.id,
      targetName: project.name,
      before,
      after: project,
      description: `${currentUser.displayName || currentUser.username} ${before ? '编辑' : '接入'}项目「${project.name || project.id}」`
    });
    sendJson(res, 201, project);
    return;
  }

  const projectDetail = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (req.method === 'DELETE' && projectDetail) {
    const projectId = decodeURIComponent(projectDetail[1]);
    requireProjectAccess(currentUser, projectId, 'admin', 'api.skillSources.delete');
    const result = await deleteProject(projectId);
    if (!result) {
      sendJson(res, 404, { error: 'project not found' });
      return;
    }
    await cleanupDeletedProjectScanCache(result.project);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'project',
      action: 'DELETE_PROJECT',
      actionName: '删除项目',
      targetType: 'project',
      targetId: result.project.id,
      targetName: result.project.name,
      before: result.project,
      metadata: result.removed,
      description: `${currentUser.displayName || currentUser.username} 删除项目「${result.project.name || result.project.id}」`
    });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  const projectScan = url.pathname.match(/^\/api\/projects\/([^/]+)\/scan$/);
  if (req.method === 'GET' && projectScan) {
    const project = await requireProject(projectScan[1]);
    requireProjectAccess(currentUser, project.id, 'viewer', 'api.skillScan.run');
    sendJson(res, 200, url.searchParams.get('refresh') === '1'
      ? await scanProjectWithStableCache(project, { forceGitSync: true })
      : await readProjectScanFromCache(project));
    return;
  }

  const projectFilePreview = url.pathname.match(/^\/api\/projects\/([^/]+)\/file-preview$/);
  if (req.method === 'GET' && projectFilePreview) {
    const project = await requireProject(projectFilePreview[1]);
    requireProjectAccess(currentUser, project.id, 'viewer');
    await serveProjectFilePreview(res, project, url.searchParams.get('file'));
    return;
  }

  const projectPlan = url.pathname.match(/^\/api\/projects\/([^/]+)\/workflow-plan$/);
  if (req.method === 'POST' && projectPlan) {
    const project = await requireProject(projectPlan[1]);
    requireProjectAccess(currentUser, project.id, 'viewer');
    const body = await readBody(req);
    sendJson(res, 200, buildWorkflowPlan({
      ...body,
      projectId: project.id
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/runs') {
    sendJson(res, 200, await listVisibleRunsForUser(currentUser));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    const projectId = url.searchParams.get('projectId') || '';
    if (projectId) requireProjectAccess(currentUser, projectId, 'viewer');
    const artTasks = await listArtSnapshotTasks(projectId || artProjectId);
    const storedTasks = await listTasks({ projectId });
    const tasks = mergeArtSnapshotRows(artTasks, storedTasks);
    const visibleTasks = tasks.filter(task => canAccessProject(currentUser, task.projectId));
    sendJson(res, 200, await attachArtBriefsToTasks(visibleTasks));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/bugs') {
    const projectId = url.searchParams.get('projectId') || '';
    if (projectId) requireProjectAccess(currentUser, projectId, 'viewer');
    const artBugs = await listArtSnapshotBugs(projectId || artProjectId);
    const storedBugs = await listBugs({ projectId });
    const bugs = mergeArtSnapshotRows(artBugs, storedBugs);
    sendJson(res, 200, bugs.filter(bug => canAccessProject(currentUser, bug.projectId)));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/task-reviews') {
    const projectId = url.searchParams.get('projectId') || '';
    if (projectId) requireProjectAccess(currentUser, projectId, 'viewer');
    const reviews = await listTaskReviews({
      projectId,
      taskId: url.searchParams.get('taskId') || ''
    });
    sendJson(res, 200, reviews.filter(review => canAccessProject(currentUser, review.projectId)));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/task-processing-notes') {
    const projectId = url.searchParams.get('projectId') || '';
    if (projectId) requireProjectAccess(currentUser, projectId, 'viewer');
    const notes = await listTaskProcessingNotes({ projectId });
    sendJson(res, 200, notes.filter(note => canAccessProject(currentUser, note.projectId)));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await readBody(req);
    await requireProject(body.projectId);
    requireProjectAccess(currentUser, body.projectId, 'developer', 'task.sync');
    if (isBugLikeTaskInput(body)) {
      const saved = await upsertBugs([taskInputToBug(body)]);
      await writeOperationLog(req, {
        user: currentUser,
        module: 'task',
        action: 'CREATE_BUG',
        actionName: '新增 Bug',
        targetType: 'bug',
        targetId: saved.bugs[0].id,
        targetName: saved.bugs[0].title,
        after: saved.bugs[0],
        description: `${currentUser.displayName || currentUser.username} 新增 Bug「${saved.bugs[0].title}」`
      });
      sendJson(res, 201, saved.bugs[0]);
      return;
    }
    const assignee = findArtAssignee(body.assignedTo || body.developer || body.assignedName || '') || null;
    const task = await upsertTask({
      ...body,
      source: body.source || 'platform',
      developer: body.developer || assignee?.realname || body.assignedName || '',
      assignedTo: body.assignedTo || assignee?.account || '',
      zentao: {
        ...(body.zentao || {}),
        assignedTo: body.assignedTo || assignee?.account || body.zentao?.assignedTo || '',
        assignedToName: body.assignedName || body.developer || assignee?.realname || body.zentao?.assignedToName || ''
      },
      createdBy: currentUser.id
    });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'task',
      action: 'CREATE_TASK',
      actionName: '新增任务',
      targetType: 'task',
      targetId: task.id,
      targetName: task.title,
      after: task,
      description: `${currentUser.displayName || currentUser.username} 新增任务「${task.title}」`
    });
    sendJson(res, 201, task);
    return;
  }

  const taskPatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (req.method === 'PATCH' && taskPatch) {
    const body = await readBody(req);
    const rawTask = await requireTaskLike(taskPatch[1]);
    const task = await hydrateTaskForWorkloadGrouping(rawTask);
    requireProjectAccess(currentUser, task.projectId, 'admin', 'task.sync');
    if (isLowEffortArtAcceptanceTaskInput(task)) throw new HttpError(400, '设计同步单/验收单不参与 AI 量级评估。');
    const workloadLevel = normalizeTaskWorkloadLevelInput(body.workloadLevel || body.workloadEstimate?.level);
    if (!workloadLevel) throw new HttpError(400, '任务量级只能选择 XS、S、M、L。');
    const before = task;
    const workloadGroup = taskWorkloadGroupForTask(task);
    const workloadGroupType = workloadGroup.startsWith('title:') ? 'title' : (workloadGroup ? 'parent' : 'single');
    const storedProjectTasks = await listTasks({ projectId: task.projectId });
    const snapshotProjectTasks = await listArtSnapshotTasks(task.projectId || artProjectId).catch(() => []);
    const projectTasks = mergeArtSnapshotRows(snapshotProjectTasks, storedProjectTasks);
    const targetTasks = workloadGroup
      ? projectTasks.filter(item => taskMatchesWorkloadGroup(item, workloadGroup) && isWorkbenchArtTask(item) && !isLowEffortArtAcceptanceTaskInput(item))
      : [task];
    const changedAt = new Date().toISOString();
    const updatedTasks = [];
    for (const targetTask of targetTasks.length ? targetTasks : [task]) {
      const previousEstimate = targetTask.workloadEstimate && typeof targetTask.workloadEstimate === 'object' ? targetTask.workloadEstimate : {};
      updatedTasks.push(await upsertTask({
        ...targetTask,
        workloadLevel,
        workloadEstimate: {
          ...previousEstimate,
          level: workloadLevel,
          source: 'manual',
          groupKey: workloadGroup || '',
          updatedAt: changedAt,
          updatedBy: currentUser.id,
          updatedByName: currentUser.displayName || currentUser.username
        },
        updatedAt: changedAt
      }));
    }
    const updated = updatedTasks.find(item => item.id === task.id) || updatedTasks[0] || task;
    await writeOperationLog(req, {
      user: currentUser,
      module: 'task',
      action: 'UPDATE_TASK_WORKLOAD_LEVEL',
      actionName: '调整任务量级',
      targetType: 'task',
      targetId: task.id,
      targetName: task.displayTitle || task.title || task.taskNo || task.id,
      before,
      after: updated,
      metadata: {
        taskNo: task.taskNo || task.zentao?.id || '',
        workloadLevel,
        groupKey: workloadGroup || '',
        affectedTaskCount: updatedTasks.length,
        affectedTaskNos: updatedTasks.map(item => item.taskNo || item.zentao?.id || '').filter(Boolean)
      },
      description: `${currentUser.displayName || currentUser.username} 将任务「${task.displayTitle || task.title || task.taskNo || task.id}」${updatedTasks.length > 1 ? `等 ${updatedTasks.length} 条${workloadGroupType === 'title' ? '同标题' : '同主单'}任务` : ''}AI评估调整为 ${workloadLevel}`
    });
    broadcastPlatformEvent('tasks.changed', {
      projectId: task.projectId || artProjectId,
      taskId: updated.id,
      taskNo: updated.taskNo || '',
      module: 'task-workload-level',
      affectedTaskIds: updatedTasks.map(item => item.id)
    });
    sendJson(res, 200, { ...updated, updatedTasks, affectedTaskCount: updatedTasks.length, workloadGroup: workloadGroup || '', workloadGroupType });
    return;
  }

  const taskDelete = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (req.method === 'DELETE' && taskDelete) {
    const task = await requireTaskLike(taskDelete[1]);
    requireProjectAccess(currentUser, task.projectId, 'admin', 'api.tasks.deletePlatform');
    if (task.source !== 'platform') {
      throw new HttpError(403, '只允许删除平台创建任务，禅道同步任务不能删除。');
    }
    let result;
    try {
      result = await deletePlatformTask(task.id || taskDelete[1]);
    } catch (error) {
      if (error.code === 'TASK_DELETE_FORBIDDEN') {
        throw new HttpError(403, error.message);
      }
      throw error;
    }
    if (!result) {
      sendJson(res, 404, { error: 'task not found' });
      return;
    }
    await writeOperationLog(req, {
      user: currentUser,
      module: 'task',
      action: 'DELETE_PLATFORM_TASK',
      actionName: '删除平台创建任务',
      targetType: 'task',
      targetId: result.task.id,
      targetName: result.task.title,
      before: result.task,
      metadata: result.removed,
      description: `${currentUser.displayName || currentUser.username} 删除平台创建任务「${result.task.title}」`
    });
    broadcastPlatformEvent('tasks.changed', {
      projectId: result.task.projectId || artProjectId,
      taskId: result.task.id,
      taskNo: result.task.taskNo || '',
      module: 'platform-task-delete',
      deleted: true
    });
    sendJson(res, 200, { ok: true, task: result.task, removed: result.removed });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/task-processing-notes') {
    const body = await readBody(req);
    const task = await requireTaskLike(body.taskId || body.id);
    requireProjectAccess(currentUser, task.projectId, 'developer', 'api.taskNotes.manage');
    const note = await upsertTaskProcessingNote({
      id: `${task.projectId}:${task.id}`,
      projectId: task.projectId,
      taskId: task.id,
      taskNo: task.taskNo || task.zentao?.id || '',
      title: task.displayTitle || task.title || task.taskNo || task.id,
      note: body.note,
      updatedBy: currentUser.id,
      updatedByName: currentUser.displayName || currentUser.username
    });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'task',
      action: 'SAVE_TASK_PROCESSING_NOTE',
      actionName: '保存任务处理备注',
      targetType: 'task',
      targetId: task.id,
      targetName: task.displayTitle || task.title || task.taskNo || task.id,
      after: note,
      metadata: {
        taskNo: task.taskNo || task.zentao?.id || '',
        noteLength: note.note.length,
        updatedAt: note.updatedAt
      },
      description: `${currentUser.displayName || currentUser.username} 保存任务「${task.displayTitle || task.title || task.taskNo || task.id}」处理备注`
    });
    broadcastPlatformEvent('task-processing-notes.changed', {
      projectId: task.projectId || artProjectId,
      taskId: task.id || '',
      taskNo: task.taskNo || '',
      module: 'task-processing-note'
    });
    sendJson(res, 200, note);
    return;
  }

  const taskAssign = url.pathname.match(/^\/api\/tasks\/([^/]+)\/assign-zentao$/);
  if (req.method === 'POST' && taskAssign) {
    const body = await readBody(req).catch(() => ({}));
    const task = await requireTaskLike(taskAssign[1]);
    requireProjectAccess(currentUser, task.projectId, 'developer', 'task.sync');
    const assigneeInput = body.assignedTo || body.account || body.name || body.assignedName || body.realname;
    const assignee = findArtAssignee(assigneeInput) || {
      account: String(body.assignedTo || body.account || '').trim(),
      realname: String(body.assignedName || body.name || body.realname || body.assignedTo || '').trim()
    };
    if (!assignee.account && !assignee.realname) throw new HttpError(400, '未找到要指派的美术成员');
    const before = task;
    const changedAt = new Date().toISOString();
    let zentaoTask = null;
    if (!assignee.account) throw new HttpError(400, '未匹配到禅道账号，无法实时指派禅道。');
    try {
      zentaoTask = await assignZentaoTask(task, assignee);
    } catch (error) {
      const zentaoAssignError = zentaoSyncErrorMessage(error);
      console.warn(`ZenTao assign failed for task ${task.taskNo || task.id}: ${zentaoAssignError}`);
      throw new HttpError(502, `禅道实时指派失败：${zentaoAssignError}`);
    }
    const updated = await upsertTask({
      ...task,
      developer: assignee.realname || assignee.account,
      assignedTo: assignee.account,
      zentaoStatus: zentaoTask?.status || task.zentaoStatus || '',
      zentao: {
        ...(task.zentao || {}),
        assignedTo: assignee.account,
        assignedToName: assignee.realname || assignee.account,
        assignedDate: zentaoTask?.assignedDate || task.zentao?.assignedDate || '',
        originalStatus: zentaoTask?.status || task.zentaoStatus || task.zentao?.originalStatus || '',
        assignSync: {
          status: 'synced',
          targetAccount: assignee.account,
          targetName: assignee.realname || assignee.account,
          syncedAt: changedAt,
          lastErrorAt: '',
          lastError: ''
        }
      },
      updatedAt: changedAt
    });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'task',
      action: 'ASSIGN_ZENTAO_TASK',
      actionName: '拖拽指派禅道任务',
      targetType: 'task',
      targetId: task.id,
      targetName: task.displayTitle || task.title || task.taskNo || task.id,
      before,
      after: updated,
      metadata: { taskNo: task.taskNo || task.zentao?.id || '', assignedTo: assignee.account, assignedToName: assignee.realname, zentaoAssignError: '' },
      description: `${currentUser.displayName || currentUser.username} 将任务「${task.displayTitle || task.title || task.taskNo || task.id}」指派给 ${assignee.realname || assignee.account}`
    });
    broadcastPlatformEvent('tasks.changed', { projectId: task.projectId || artProjectId, taskId: task.id, taskNo: task.taskNo || '', module: 'zentao-task-assign' });
    sendJson(res, 200, { ...updated, zentaoAssignError: '', zentaoAssignSynced: true });
    return;
  }

  const taskSplitPlan = url.pathname.match(/^\/api\/tasks\/([^/]+)\/split-plan$/);
  if (req.method === 'POST' && taskSplitPlan) {
    const task = await requireTaskLike(taskSplitPlan[1]);
    requireProjectAccess(currentUser, task.projectId, 'developer', 'task.sync');
    if (isSgProjectTask(task)) throw new HttpError(400, 'SG 项目不需要拆单。');
    const plan = await buildZentaoSplitPlan(task);
    sendJson(res, 200, plan);
    return;
  }

  const taskSplitApply = url.pathname.match(/^\/api\/tasks\/([^/]+)\/split-apply$/);
  if (req.method === 'POST' && taskSplitApply) {
    const body = await readBody(req).catch(() => ({}));
    const task = await requireTaskLike(taskSplitApply[1]);
    requireProjectAccess(currentUser, task.projectId, 'developer', 'task.sync');
    if (isSgProjectTask(task)) throw new HttpError(400, 'SG 项目不需要拆单。');
    const result = await applyZentaoSplitPlan(task, body.plan || body);
    const mainResult = Array.isArray(result.results) ? result.results.find(item => item.type === 'main') : null;
    let updatedTask = null;
    if (mainResult?.ok && String((body.plan || body).mainAssignee || '').trim()) {
      const mainAssigneeAccount = String((body.plan || body).mainAssignee || '').trim();
      const mainAssignee = defaultArtUsers.find(user => user.account === mainAssigneeAccount) || { account: mainAssigneeAccount, realname: mainResult.assignedTo || mainAssigneeAccount };
      const changedAt = new Date().toISOString();
      updatedTask = await upsertTask({
        ...task,
        developer: mainAssignee.realname || mainAssignee.account,
        assignedTo: mainAssignee.account,
        zentao: {
          ...(task.zentao || {}),
          assignedTo: mainAssignee.account,
          assignedToName: mainAssignee.realname || mainAssignee.account,
          assignedToRealName: mainAssignee.realname || mainAssignee.account,
          assignSync: {
            status: 'synced',
            targetAccount: mainAssignee.account,
            targetName: mainAssignee.realname || mainAssignee.account,
            syncedAt: changedAt,
            lastErrorAt: '',
            lastError: ''
          }
        },
        updatedAt: changedAt
      });
      result.updatedTask = updatedTask;
    }
    await writeOperationLog(req, {
      user: currentUser,
      module: 'task',
      action: 'SPLIT_ZENTAO_TASK',
      actionName: '工作台拆单',
      targetType: 'task',
      targetId: task.id,
      targetName: task.displayTitle || task.title || task.taskNo || task.id,
      metadata: result,
      description: `${currentUser.displayName || currentUser.username} 在工作台拆单「${task.displayTitle || task.title || task.taskNo || task.id}」`
    });
    broadcastPlatformEvent('tasks.changed', { projectId: task.projectId || artProjectId, taskId: (updatedTask || task).id, taskNo: task.taskNo || '', module: 'zentao-task-split' });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/task-reviews') {
    const body = await readBody(req);
    await requireProject(body.projectId);
    await requireTask(body.taskId);
    requireProjectAccess(currentUser, body.projectId, 'reviewer', 'api.reviews.submit');
    const review = await createTaskReview({
      ...body,
      reviewer: body.reviewer || currentUser.displayName,
      reviewedBy: currentUser.id
    });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'review',
      action: 'CREATE_TASK_REVIEW',
      actionName: '提交复核',
      targetType: 'task_review',
      targetId: review.id,
      targetName: review.taskId,
      after: review,
      description: `${currentUser.displayName || currentUser.username} 提交任务复核「${review.taskId}」`
    });
    sendJson(res, 201, review);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ai-flow-records') {
    const projectId = url.searchParams.get('projectId') || '';
    if (projectId) requireProjectAccess(currentUser, projectId, 'viewer');
    const records = await listAiFlowRecords({
      projectId,
      taskNo: url.searchParams.get('taskNo') || '',
      includeDeleted: url.searchParams.get('includeDeleted') === '1'
    });
    sendJson(res, 200, records.filter(record => canAccessProject(currentUser, record.projectId)));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai-flow-records') {
    const body = await readBody(req);
    const project = await requireProject(body.projectId);
    requireProjectAccess(currentUser, project.id, 'developer', 'archive.record.manage');
    const record = await upsertAiFlowRecord({
      ...body,
      projectId: project.id,
      source: body.source || 'manual',
      createdBy: body.createdBy || currentUser.id,
      updatedBy: currentUser.id
    });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'ai_archive',
      action: 'UPSERT_AI_FLOW_RECORD',
      actionName: '保存 AI 全流程人工记录',
      targetType: 'ai_flow_record',
      targetId: record.id,
      targetName: record.taskTitle || record.taskNameAndNo,
      after: record,
      description: `${currentUser.displayName || currentUser.username} 保存 AI 全流程人工记录「${record.taskTitle || record.taskNo || record.id}」`
    });
    sendJson(res, 201, record);
    return;
  }

  const aiFlowRecordMatch = url.pathname.match(/^\/api\/ai-flow-records\/([^/]+)$/);
  if (aiFlowRecordMatch) {
    const record = await getAiFlowRecord(decodeURIComponent(aiFlowRecordMatch[1]));
    if (!record) {
      sendJson(res, 404, { error: 'AI 全流程记录不存在。' });
      return;
    }
    requireProjectAccess(currentUser, record.projectId, 'developer', 'archive.record.manage');
    if (req.method === 'PUT') {
      const body = await readBody(req);
      const saved = await upsertAiFlowRecord({
        ...record,
        ...body,
        id: record.id,
        projectId: body.projectId || record.projectId,
        updatedBy: currentUser.id
      });
      await writeOperationLog(req, {
        user: currentUser,
        module: 'ai_archive',
        action: 'UPDATE_AI_FLOW_RECORD',
        actionName: '更新 AI 全流程人工记录',
        targetType: 'ai_flow_record',
        targetId: saved.id,
        targetName: saved.taskTitle || saved.taskNameAndNo,
        before: record,
        after: saved,
        description: `${currentUser.displayName || currentUser.username} 更新 AI 全流程人工记录「${saved.taskTitle || saved.taskNo || saved.id}」`
      });
      sendJson(res, 200, saved);
      return;
    }
    if (req.method === 'DELETE') {
      const deleted = await deleteAiFlowRecord(record.id, { deletedBy: currentUser.id });
      await writeOperationLog(req, {
        user: currentUser,
        module: 'ai_archive',
        action: 'DELETE_AI_FLOW_RECORD',
        actionName: '删除 AI 全流程人工记录',
        targetType: 'ai_flow_record',
        targetId: record.id,
        targetName: record.taskTitle || record.taskNameAndNo,
        before: record,
        after: deleted,
        description: `${currentUser.displayName || currentUser.username} 删除 AI 全流程人工记录「${record.taskTitle || record.taskNo || record.id}」`
      });
      sendJson(res, 200, deleted);
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/ai-flow-records/import-sheet') {
    const body = await readBody(req);
    const project = await requireProject(body.projectId);
    requireProjectAccess(currentUser, project.id, 'developer', 'archive.record.manage');
    const result = await importAiFlowRecordsFromSheet(project, body, currentUser);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'ai_archive',
      action: 'IMPORT_AI_FLOW_SHEET',
      actionName: '导入 AI 全流程表格记录',
      targetType: 'project',
      targetId: project.id,
      targetName: project.name,
      metadata: result,
      description: `${currentUser.displayName || currentUser.username} 导入项目「${project.name || project.id}」的 AI 全流程表格记录`
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tasks/sync-zentao') {
    const body = await readBody(req);
    const project = await requireProject(body.projectId);
    requireProjectAccess(currentUser, project.id, 'developer', 'api.runs.execute');
    const syncKind = normalizeZentaoSyncKind(body.syncKind || body.kind || body.mode);
    if (body.wait === true) {
      const result = await syncZentaoTasksWithStats(project, { ...body, syncKind });
      await writeOperationLog(req, {
        user: currentUser,
        module: 'task',
        action: syncKind === 'bug' ? 'SYNC_ZENTAO_BUGS' : syncKind === 'task' ? 'SYNC_ZENTAO_TASKS_ONLY' : 'SYNC_ZENTAO_TASKS',
        actionName: syncKind === 'bug' ? '同步禅道 Bug' : syncKind === 'task' ? '同步禅道任务' : '同步禅道任务和 Bug',
        targetType: 'project',
        targetId: project.id,
        targetName: project.name,
        metadata: result,
        description: `${currentUser.displayName || currentUser.username} 同步项目「${project.name || project.id}」的${syncKind === 'bug' ? '禅道 Bug' : syncKind === 'task' ? '禅道任务' : '禅道任务和 Bug'}`
      });
      broadcastPlatformEvent('tasks.changed', { projectId: project.id, module: syncKind === 'bug' ? 'bug-sync' : 'task-sync' });
      sendJson(res, 200, result);
      return;
    }
    const result = syncKind === 'bug'
      ? triggerZentaoBugSyncOnly(project, body, 'manual')
      : triggerZentaoTaskSync(project, { ...body, includeBugs: syncKind !== 'task' }, 'manual');
    await writeOperationLog(req, {
      user: currentUser,
      module: 'task',
      action: syncKind === 'bug' ? 'TRIGGER_ZENTAO_BUG_SYNC' : syncKind === 'task' ? 'TRIGGER_ZENTAO_TASK_SYNC_ONLY' : 'TRIGGER_ZENTAO_TASK_SYNC',
      actionName: syncKind === 'bug' ? '触发禅道 Bug 同步' : syncKind === 'task' ? '触发禅道任务同步' : '触发禅道任务和 Bug 同步',
      targetType: 'project',
      targetId: project.id,
      targetName: project.name,
      metadata: result,
      description: `${currentUser.displayName || currentUser.username} 触发项目「${project.name || project.id}」的${syncKind === 'bug' ? '禅道 Bug' : syncKind === 'task' ? '禅道任务' : '禅道任务和 Bug'}同步`
    });
    sendJson(res, 202, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/bugs/sync-zentao') {
    const body = await readBody(req);
    const project = await requireProject(body.projectId);
    requireProjectAccess(currentUser, project.id, 'developer', 'api.runs.execute');
    if (body.wait === false || body.async === true) {
      const result = triggerZentaoBugSync(project, { ...body, currentOnly: body.currentOnly !== false }, 'manual');
      await writeOperationLog(req, {
        user: currentUser,
        module: 'task',
        action: 'TRIGGER_ZENTAO_BUG_SYNC',
        actionName: '触发禅道 Bug 同步',
        targetType: 'project',
        targetId: project.id,
        targetName: project.name,
        metadata: result,
        description: `${currentUser.displayName || currentUser.username} 触发项目「${project.name || project.id}」的禅道 Bug 同步`
      });
      sendJson(res, 202, result);
      return;
    }
    const result = await syncZentaoBugs(project, { ...body, currentOnly: body.currentOnly !== false, trigger: 'manual' });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'task',
      action: 'SYNC_ZENTAO_BUGS',
      actionName: '同步禅道 Bug',
      targetType: 'project',
      targetId: project.id,
      targetName: project.name,
      metadata: result,
      description: `${currentUser.displayName || currentUser.username} 同步项目「${project.name || project.id}」的禅道 Bug`
    });
    broadcastPlatformEvent('tasks.changed', { projectId: project.id, module: 'bug-sync' });
    sendJson(res, 200, result);
    return;
  }

  const taskDetail = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (req.method === 'GET' && taskDetail) {
    const task = await requireTaskLike(taskDetail[1]);
    requireProjectAccess(currentUser, task.projectId, 'viewer');
    const [taskWithBrief] = await attachArtBriefsToTasks([task]);
    sendJson(res, 200, taskWithBrief || task);
    return;
  }

  const taskArtBrief = url.pathname.match(/^\/api\/tasks\/([^/]+)\/art-brief$/);
  if (req.method === 'POST' && taskArtBrief) {
    const body = await readBody(req).catch(() => ({}));
    const force = body.force === true;
    const task = await requireTaskLike(taskArtBrief[1]);
    requireProjectAccess(currentUser, task.projectId, 'developer', 'api.taskArtBrief.generate');
    const result = await getOrGenerateZentaoArtBrief(task, currentUser, { force });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'task',
      action: force ? 'REGENERATE_ZENTAO_ART_BRIEF' : (result.reused ? 'REUSE_ZENTAO_ART_BRIEF' : 'GENERATE_ZENTAO_ART_BRIEF'),
      actionName: force ? '重新生成禅道美术摘要' : (result.reused ? '复用禅道美术摘要' : '生成禅道美术摘要'),
      targetType: 'task',
      targetId: task.id,
      targetName: task.title,
      metadata: {
        taskNo: task.taskNo,
        groupKey: result.groupKey,
        groupTitle: result.groupTitle,
        reused: result.reused === true,
        regenerated: result.regenerated === true,
        reportFile: result.reportFile,
        needs: result.needs?.length || 0,
        avoid: result.avoid?.length || 0,
        confirm: result.confirm?.length || 0
      },
      description: `${currentUser.displayName || currentUser.username} 为任务「${task.title || task.taskNo || task.id}」${force ? '重新生成' : (result.reused ? '复用' : '生成')}禅道美术摘要`
    });
    broadcastPlatformEvent('task-art-brief.changed', {
      projectId: task.projectId || artProjectId,
      taskId: task.id || '',
      taskNo: task.taskNo || '',
      groupKey: result.groupKey || '',
      module: 'task-art-brief'
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/runs') {
    const body = await readBody(req);
    const project = await requireProject(body.projectId);
    if (body.sourceType === 'direct-skill' || body.executionMode === 'direct-skill') {
      requireProjectAccess(currentUser, project.id, 'developer', 'api.agentRuns.create');
      const run = await createDirectSkillRunFromBody(req, project, body, currentUser);
      sendJson(res, 201, run);
      return;
    }
    requireProjectAccess(currentUser, project.id, 'developer', 'api.runs.execute');
    validateFigmaRunTarget(body);
    if (body.executionMode === 'single-skill' || body.executionMode === 'custom-workflow' || normalizeRunMaterialSnapshotsForRequest(body.selectedMaterialSnapshots).length) {
      validateSkillSnapshotForRun(body, { requireSnapshot: true });
    }
    const currentUserName = currentUser.displayName || currentUser.username || currentUser.id;
    const now = new Date().toISOString();
    const run = await createRun({
      ...body,
      createdBy: currentUser.id,
      ownerUserId: currentUser.id,
      assignedToUserId: body.assignedToUserId || body.assigneeUserId || currentUser.id,
      assignedToName: body.assignedToName || body.assigneeName || body.developer || currentUserName,
      queuedForUserId: body.queuedForUserId || body.assignedToUserId || body.assigneeUserId || currentUser.id,
      queuedForName: body.queuedForName || body.assignedToName || body.assigneeName || body.developer || currentUserName,
      queuedAt: body.queuedAt || now,
      executionHost: body.executionHost || 'local-worker',
      workerExecution: true,
      workerStatus: body.workerStatus || 'queued',
      currentStage: body.currentStage || '正在启动本机执行'
    });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'run',
      action: 'CREATE_RUN',
      actionName: '创建执行',
      targetType: 'run',
      targetId: run.id,
      targetName: run.title,
      after: run,
      metadata: {
        countAsSkillUsage: false,
        countAsProductUsage: false,
        ...runUsageLogMetadata(run)
      },
      description: `${currentUser.displayName || currentUser.username} 创建执行「${run.title}」`
    });
    broadcastPlatformEvent('runs.changed', {
      projectId: project.id,
      runId: run.id,
      run,
      module: 'run-created',
      targetUserId: run.queuedForUserId || run.assignedToUserId || run.ownerUserId || currentUser.id,
      wakeWorker: true
    });
    sendJson(res, 201, run);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/runs/direct-skill') {
    const body = await readBody(req);
    const project = await requireProject(body.projectId);
    requireProjectAccess(currentUser, project.id, 'developer', 'api.agentRuns.create');
    const run = await createDirectSkillRunFromBody(req, project, body, currentUser);
    sendJson(res, 201, run);
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/runs') {
    requirePermission(currentUser, 'api.aiArchive.delete');
    const filters = Object.fromEntries(url.searchParams.entries());
    if (!filters.from || !filters.to) throw new HttpError(400, '请选择要删除的开始时间和结束时间。');
    const result = await deleteRunsByFilters(filters);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'run',
      action: 'DELETE_RUN_RANGE',
      actionName: '范围删除执行明细',
      targetType: 'run',
      targetId: 'range',
      targetName: `${filters.from} - ${filters.to}`,
      before: { filters, deletedCount: result.deleted.length },
      description: `${currentUser.displayName || currentUser.username} 范围删除执行明细 ${result.deleted.length} 条`
    });
    broadcastPlatformEvent('runs.changed', { module: 'ai-archive', deletedCount: result.deleted.length });
    sendJson(res, 200, { ok: true, deletedCount: result.deleted.length, deletedIds: result.deleted.map(run => run.id) });
    return;
  }

  const runStart = url.pathname.match(/^\/api\/runs\/([^/]+)\/start$/);
  if (req.method === 'POST' && runStart) {
    const run = await requireRun(runStart[1]);
    const body = await readBody(req).catch(() => ({}));
    const project = await getProject(run.projectId);
    if (!project) {
      throw new HttpError(409, '该执行记录的扫描来源已删除，只能查看、归档或删除，不能继续执行。');
    }
    requireProjectAccess(currentUser, project.id, 'developer', 'run.codex.execute');
    if (run.sourceType === 'direct-skill' || run.executionMode === 'direct-skill') {
      throw new HttpError(409, '直接执行任务只能由执行人本机 Worker 领取，不能在平台服务器启动。');
    }
    const activeWorker = await findOnlineWorkerRunningRun(run.id);
    if (activeWorker && /claimed|running|in_progress/i.test(`${run.status || ''} ${run.workerStatus || ''}`)) {
      sendJson(res, 200, run);
      return;
    }
    const startMode = ['resume', 'restart'].includes(String(body.mode || '').trim()) ? String(body.mode).trim() : 'start';
    const targetUserId = String(currentUser.id || '').trim();
    const targetUser = currentUser;
    const targetUserName = targetUser.displayName || targetUser.username || targetUserId;
    const queued = await queueRunForLocalWorker(run.id, {
      queuedForUserId: targetUserId,
      queuedForName: targetUserName,
      startMode
    });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'run',
      action: 'QUEUE_RUN_LOCAL_WORKER',
      actionName: '本机启动执行',
      targetType: 'run',
      targetId: run.id,
      targetName: run.title,
      before: run,
      after: queued,
      metadata: { executionHost: 'local-worker', queuedForUserId: targetUserId, startMode },
      description: `${currentUser.displayName || currentUser.username} 将执行「${run.title}」排队到${targetUserName || '执行人'}本机 Worker`
    });
    broadcastPlatformEvent('runs.changed', {
      projectId: project.id,
      runId: run.id,
      run: queued,
      module: 'local-worker-run',
      targetUserId: queued.queuedForUserId || queued.assignedToUserId || queued.ownerUserId || currentUser.id,
      wakeWorker: true
    });
    sendJson(res, 200, queued);
    return;
  }

  const runRetry = url.pathname.match(/^\/api\/runs\/([^/]+)\/retry$/);
  if (req.method === 'POST' && runRetry) {
    const source = await requireRun(runRetry[1]);
    const project = await getProject(source.projectId);
    if (!project) {
      throw new HttpError(409, '该执行记录的扫描来源已删除，只能查看、归档或删除，不能再次执行。');
    }
    requireProjectAccess(currentUser, source.projectId, 'developer', 'run.codex.execute');
    const body = await readBody(req);
    const retryRun = await cloneRunForRetry(source.id, {
      title: body.title,
      requirement: body.requirement,
      figmaLinks: body.figmaLinks,
      showdocHints: body.showdocHints,
      targetPage: body.targetPage,
      stage: body.stage,
      workflow: source.workflow,
      workflowLevel: source.workflowLevel,
      customWorkflowId: source.customWorkflowId,
      customWorkflowName: source.customWorkflowName,
      customStages: source.stages,
      executionMode: source.executionMode,
      sourceType: source.sourceType,
      productName: source.productName,
      sourceTitle: source.sourceTitle,
      primarySkillPath: source.primarySkillPath,
      primarySkillTitle: source.primarySkillTitle,
      primarySkillContent: source.primarySkillContent,
      selectedMaterialHints: source.selectedMaterialHints,
      selectedMaterialSnapshots: source.selectedMaterialSnapshots,
      figmaWriteMode: source.figmaWriteMode,
      assignedToUserId: currentUser.id,
      assignedToName: currentUser.displayName || currentUser.username || currentUser.id,
      queuedForUserId: currentUser.id,
      queuedForName: currentUser.displayName || currentUser.username || currentUser.id,
      developer: currentUser.displayName || currentUser.username || source.developer,
      codexRequest: body.codexRequest,
      createdBy: currentUser.id,
      ownerUserId: currentUser.id
    });
    await writeOperationLog(req, {
      user: currentUser,
      module: 'run',
      action: 'RETRY_RUN',
      actionName: '重新执行',
      targetType: 'run',
      targetId: retryRun.id,
      targetName: retryRun.title,
      before: source,
      after: retryRun,
      metadata: {
        countAsSkillUsage: false,
        countAsProductUsage: false,
        ...runUsageLogMetadata(retryRun)
      },
      description: `${currentUser.displayName || currentUser.username} 基于「${source.title}」创建重新执行`
    });
    sendJson(res, 201, retryRun);
    return;
  }

  const runCancel = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && runCancel) {
    const run = await requireRun(runCancel[1]);
    requireProjectAccess(currentUser, run.projectId, 'developer', 'run.codex.execute');
    const cancelled = await cancelRun(runCancel[1], currentUser.id);
    await writeOperationLog(req, {
      user: currentUser,
      module: 'run',
      action: 'CANCEL_RUN',
      actionName: '中断执行',
      targetType: 'run',
      targetId: run.id,
      targetName: run.title,
      before: run,
      after: cancelled,
      description: `${currentUser.displayName || currentUser.username} 中断执行「${run.title}」`
    });
    sendJson(res, 200, cancelled);
    return;
  }

  const runDelete = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (req.method === 'DELETE' && runDelete) {
    const targetRun = await requireRun(runDelete[1]);
    await requireRunDeleteAccess(currentUser, targetRun);
    const run = await deleteRun(runDelete[1]);
    if (!run) {
      sendJson(res, 404, { error: 'run not found' });
      return;
    }
    await writeOperationLog(req, {
      user: currentUser,
      module: 'run',
      action: 'DELETE_RUN',
      actionName: '删除执行记录',
      targetType: 'run',
      targetId: run.id,
      targetName: run.title,
      before: run,
      description: `${currentUser.displayName || currentUser.username} 删除执行记录「${run.title}」`
    });
    sendJson(res, 200, { ok: true, run });
    return;
  }

  const runEvents = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (req.method === 'GET' && runEvents) {
    const run = await requireRun(runEvents[1]);
    requireProjectAccess(currentUser, run.projectId, 'viewer');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', runId: runEvents[1] })}\n\n`);
    subscribe(runEvents[1], res);
    return;
  }

  const runLog = url.pathname.match(/^\/api\/runs\/([^/]+)\/log$/);
  if (req.method === 'GET' && runLog) {
    const run = await requireRun(runLog[1]);
    await requireRunViewAccess(currentUser, run);
    const fallbackLogPath = path.join(paths.workspaceDir, run.id, 'run.log');
    const tailBytes = clampNumber(url.searchParams.get('tailBytes'), 16 * 1024, 1024 * 1024, defaultRunLogTailBytes);
    await serveRunLog(res, run.logPath || fallbackLogPath, currentUser, { tailBytes, run });
    return;
  }

  const runArtifacts = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
  if (req.method === 'GET' && runArtifacts) {
    const run = await requireRun(runArtifacts[1]);
    const project = await requireProject(run.projectId);
    requireProjectAccess(currentUser, project.id, 'viewer');
    sendJson(res, 200, await collectRunArtifacts(project, run));
    return;
  }

  const runDiff = url.pathname.match(/^\/api\/runs\/([^/]+)\/diff$/);
  if (req.method === 'GET' && runDiff) {
    const run = await requireRun(runDiff[1]);
    const project = await requireProject(run.projectId);
    requireProjectAccess(currentUser, project.id, 'viewer');
    sendJson(res, 200, await getRunFileDiff(project, run, url.searchParams.get('file')));
    return;
  }

  const runFilePreview = url.pathname.match(/^\/api\/runs\/([^/]+)\/file-preview$/);
  if (req.method === 'GET' && runFilePreview) {
    const run = await requireRun(runFilePreview[1]);
    const project = await requireProject(run.projectId);
    requireProjectAccess(currentUser, project.id, 'viewer');
    await serveRunFilePreview(res, project, url.searchParams.get('file'), url.searchParams.get('version'));
    return;
  }

  const artifact = url.pathname.match(/^\/api\/artifact$/);
  if ((req.method === 'GET' || req.method === 'HEAD') && artifact) {
    await serveArtifact(res, url.searchParams.get('path'), currentUser, {
      head: req.method === 'HEAD',
      download: url.searchParams.get('download') || ''
    });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

async function writeOperationLog(req, input = {}) {
  try {
    const log = await createOperationLog({
      ...input,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] || '',
      requestId: req.headers['x-request-id'] || ''
    });
    if (log?._skipped === true) return log;
    const usagePatch = await recordUsageCountersForOperationLog(log).catch(error => {
      console.error(`Usage counter operation log update failed: ${error.message}`);
      return null;
    });
    const validationUsagePatch = await recordUsageCountersForSkillValidationOperationLog(log).catch(error => {
      console.error(`Usage counter skill validation operation log update failed: ${error.message}`);
      return null;
    });
    const mergedUsagePatch = {
      matched: Number(usagePatch?.matched || 0) + Number(validationUsagePatch?.matched || 0)
    };
    if (input.broadcast !== false && log?._deduped !== true) {
      broadcastPlatformEvent('operation-logs.changed', { module: input.module || 'operation-log' });
      broadcastUsageCountersChanged(mergedUsagePatch, {
        module: input.module || 'operation-log',
        targetType: input.targetType || '',
        targetId: input.targetId || '',
        action: input.action || ''
      });
    }
    return log;
  } catch (error) {
    console.error(`Operation log write failed: ${error.message}`);
    return null;
  }
}

function redactProject(project = {}) {
  return {
    ...project,
    git: project.git ? { ...project.git } : undefined
  };
}

function ensureWorkerCanUpdateRun(user = {}, run = {}) {
  const userId = String(user.id || '').trim();
  const assignee = String(run.assignedToUserId || run.ownerUserId || '').trim();
  if (!assignee || assignee === userId || hasPermission(user, 'api.runs.delete')) return;
  throw new HttpError(403, '只能回传分配给自己的直接执行任务。');
}

async function findOnlineWorkerRunningRun(runId = '') {
  const id = String(runId || '').trim();
  if (!id) return null;
  const now = Date.now();
  const workers = await listAgentWorkers();
  return workers.find(worker => {
    if (String(worker.currentRunId || '').trim() !== id) return false;
    const lastHeartbeatMs = Date.parse(worker.lastHeartbeatAt || '');
    if (!lastHeartbeatMs) return false;
    const heartbeat = Math.max(Number(worker.heartbeatIntervalMs || 0), 60000);
    const grace = Math.min(Math.max(Number(worker.onlineGraceMs || 0), heartbeat * 3, 180000), 900000);
    return now - lastHeartbeatMs < grace;
  }) || null;
}

function buildDirectSkillRequirement(body = {}) {
  const manual = String(body.requirement || '').trim();
  const skillPath = String(body.primarySkillPath || body.skillPath || body.stage || '').trim();
  const figmaLinks = String(body.figmaLinks || body.figmaUrl || '').trim();
  const writeMode = String(body.figmaWriteMode || 'target-node').trim();
  return [
    manual,
    '',
    '## 直接执行约束',
    '',
    `- 主执行 Skill / md：${skillPath}`,
    `- Figma 链接：${figmaLinks}`,
    `- Figma 写入方式：${writeMode === 'create-page' ? '新建页面或新建 Frame' : '写入指定节点'}`,
    '- 本次任务必须在执行人本机 Codex 环境中运行，使用执行人自己的 Figma MCP 和 Figma 授权。',
    '- 平台不提供 Figma token；如果本机 Figma MCP 未授权、缺少写入工具或没有 Figma 权限，必须停止并回传阻塞原因。',
    '- 必须优先使用平台随任务下发的 Skill / md 内容快照，再按 Figma 链接解析 fileKey、node-id 和目标区域。',
    '- 不要求组员电脑存在负责人本机项目目录；如果内容快照缺失且本机无法读取路径，必须回传阻塞原因。',
    '- 只处理本次指定 Skill / md 和 Figma 目标，不扩展为无关代码改造。',
    '- 只有 Figma 写入工具真实返回 createdNodeIds 或 mutatedNodeIds，才允许判定为已写入。',
    '- 执行报告必须记录使用的 Skill / md、Figma URL、写入节点、阻塞原因和人工复核建议。'
  ].filter(Boolean).join('\n');
}

function normalizeRunMaterialSnapshotsForRequest(input = []) {
  return Array.isArray(input)
    ? input.map(item => ({
      path: String(item?.path || item?.relativePath || item?.sourceValue || '').trim(),
      title: String(item?.title || item?.name || '').trim(),
      kind: String(item?.kind || item?.inventoryKind || '').trim(),
      content: String(item?.content || '').trim()
    })).filter(item => item.content)
    : [];
}

function isUsableSkillContent(value = '') {
  const text = String(value || '').trim();
  return text.length >= 20 && !/技能内容读取失败|文件读取失败|cannot find path|no such file/i.test(text);
}

function validateFigmaRunTarget(body = {}) {
  const figmaLinks = String(body.figmaLinks || body.figmaUrl || '').trim();
  if (!figmaLinks) throw new HttpError(400, '请先填写 Figma 链接。');
  if (!/figma\.com\/(design|file|proto|board|slides|make)\//i.test(figmaLinks)) {
    throw new HttpError(400, 'Figma 链接必须是有效的 figma.com 文件、Frame、分区或页面链接。');
  }
  if (String(body.figmaWriteMode || 'target-node') !== 'create-page' && !/node-id=|[?&]node_id=/i.test(figmaLinks)) {
    throw new HttpError(400, '写入指定节点时，请粘贴包含 node-id 的 Figma Frame / 分区链接。');
  }
}

function validateSkillSnapshotForRun(body = {}, { requireSnapshot = false } = {}) {
  const primarySkillPath = String(body.primarySkillPath || body.skillPath || body.stage || '').trim();
  const primarySkillContent = String(body.primarySkillContent || body.skillContent || '').trim();
  const snapshots = normalizeRunMaterialSnapshotsForRequest(body.selectedMaterialSnapshots);
  if (!primarySkillPath) throw new HttpError(400, '请先选择要执行的 Skill 或 md。');
  if (requireSnapshot && !isUsableSkillContent(primarySkillContent) && !snapshots.some(item => isUsableSkillContent(item.content))) {
    throw new HttpError(400, '未读取到可执行的 Skill / md 内容快照，不能创建执行。请重新选择 Git 仓库里的 md / Skill。');
  }
}

async function createDirectSkillRunFromBody(req, project, body = {}, currentUser = {}) {
  const figmaLinks = String(body.figmaLinks || body.figmaUrl || '').trim();
  const primarySkillPath = String(body.primarySkillPath || body.skillPath || body.stage || '').trim();
  const primarySkillContent = String(body.primarySkillContent || body.skillContent || '').trim().slice(0, 60000);
  validateFigmaRunTarget(body);
  validateSkillSnapshotForRun(body, { requireSnapshot: true });
  const assigneeUserId = String(body.assignedToUserId || body.assigneeUserId || currentUser.id || '').trim();
  const assigneeName = String(body.assignedToName || body.assigneeName || body.developer || currentUser.displayName || currentUser.username || '').trim();
  const run = await createRun({
    ...body,
    projectId: project.id,
    title: body.title || `直接执行：${path.basename(primarySkillPath)}`,
    workflow: 'art-single-skill',
    workflowLevel: body.workflowLevel || 'XS',
    executionMode: 'direct-skill',
    sourceType: 'direct-skill',
    stage: primarySkillPath,
    primarySkillPath,
    primarySkillContent,
    showdocHints: [primarySkillPath, ...(Array.isArray(body.selectedMaterialHints) ? body.selectedMaterialHints : [])].filter(Boolean).join('\n'),
    selectedMaterialHints: body.selectedMaterialHints || [primarySkillPath],
    figmaLinks,
    figmaWriteMode: body.figmaWriteMode || 'target-node',
    developer: assigneeName,
    assignedToUserId: assigneeUserId,
    assignedToName: assigneeName,
    requirement: buildDirectSkillRequirement(body),
    createdBy: currentUser.id,
    createdByName: currentUser.displayName || currentUser.username || currentUser.id,
    ownerUserId: assigneeUserId || currentUser.id
  });
  await writeOperationLog(req, {
    user: currentUser,
    module: 'run',
    action: 'CREATE_DIRECT_SKILL_RUN',
    actionName: '创建直接执行',
    targetType: 'run',
    targetId: run.id,
    targetName: run.title,
    after: run,
    metadata: {
      countAsSkillUsage: false,
      countAsProductUsage: false,
      primarySkillPath,
      figmaLinks,
      assigneeUserId,
      figmaWriteMode: run.figmaWriteMode || '',
      ...runUsageLogMetadata(run)
    },
    description: `${currentUser.displayName || currentUser.username} 创建直接执行「${run.title}」，指派给 ${assigneeName || assigneeUserId || '未指定成员'}`
  });
  broadcastPlatformEvent('runs.changed', {
    projectId: project.id,
    runId: run.id,
    run,
    module: 'direct-skill-run',
    targetUserId: run.queuedForUserId || run.assignedToUserId || run.ownerUserId || assigneeUserId || currentUser.id,
    wakeWorker: true
  });
  return run;
}

function subscribePlatformEvents(req, res, user = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const client = {
    res,
    userId: user.id || '',
    role: user.role || '',
    permissions: new Set(user.permissions || []),
    projectIds: Array.isArray(user.projectIds) ? user.projectIds : []
  };
  platformEventClients.add(client);
  sendPlatformEvent(client, 'connected', {
    seq: platformEventSeq,
    serverTime: new Date().toISOString()
  });
  const heartbeat = setInterval(() => {
    sendPlatformEvent(client, 'heartbeat', {
      seq: platformEventSeq,
      serverTime: new Date().toISOString()
    });
  }, 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    platformEventClients.delete(client);
  });
}

function scheduleDataRetentionCleanup() {
  if (!dataRetentionEnabled) return;
  setInterval(() => runDataRetentionCleanup('interval'), dataRetentionCleanupIntervalMs);
}

async function runDataRetentionCleanup(source = 'manual') {
  if (!dataRetentionEnabled || dataRetentionCleanupRunning) return;
  dataRetentionCleanupRunning = true;
  try {
    await enforceRetentionNow();
    await enforceServerFileRetention();
  } catch (error) {
    console.error(`Data retention cleanup failed (${source}): ${error.message}`);
  } finally {
    dataRetentionCleanupRunning = false;
  }
}

function broadcastPlatformEvent(type, payload = {}) {
  const event = {
    type,
    payload,
    seq: ++platformEventSeq,
    at: new Date().toISOString()
  };
  for (const client of platformEventClients) {
    if (canReceivePlatformEvent(client, event)) sendPlatformEvent(client, 'message', event);
  }
}

function broadcastUsageCountersChanged(result = null, payload = {}) {
  if (!result || Number(result.matched || 0) <= 0) return;
  broadcastPlatformEvent('usage-counters.changed', {
    ...payload,
    matched: Number(result.matched || 0)
  });
}

function watchAiMembersBoardFiles() {
  const boardFiles = [
    '美术部AI看板.html'
  ];
  let timer = null;
  const emitChanged = fileName => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      broadcastPlatformEvent('ai-members-board.changed', {
        module: 'ai-members-board',
        root: aiWeekDir,
        fileName: fileName || '',
        changedAt: new Date().toISOString()
      });
    }, 800);
  };
  try {
    fs.watch(aiWeekDir, (eventType, fileName) => {
      const name = String(fileName || '');
      if (!boardFiles.includes(name)) return;
      emitChanged(name);
    }).on('error', error => {
      console.warn(`AI部门看板目录监听失败：${error.message}`);
    });
  } catch (error) {
    console.warn(`AI部门看板目录监听未启用：${error.message}`);
  }
}

function runUsageLogMetadata(run = {}) {
  const selectedMaterialHints = Array.isArray(run.selectedMaterialHints)
    ? run.selectedMaterialHints.map(item => String(item || '').trim()).filter(Boolean)
    : String(run.selectedMaterialHints || '')
      .split(/\n|,|，|、/)
      .map(item => item.trim())
      .filter(Boolean);
  const artifactNames = [
    run.productName,
    run.sourceTitle,
    run.title
  ].map(item => String(item || '').trim()).filter(Boolean);
  const artifactPaths = [
    run.primarySkillPath,
    run.skillPath,
    run.stage,
    ...selectedMaterialHints
  ].map(item => String(item || '').trim()).filter(Boolean);
  return {
    productName: String(run.productName || '').trim(),
    artifactName: artifactNames[0] || '',
    skillName: artifactNames[0] || '',
    operationName: String(run.title || '').trim(),
    path: artifactPaths[0] || '',
    filePath: artifactPaths[0] || '',
    skillPath: String(run.primarySkillPath || run.skillPath || run.stage || '').trim(),
    artifactPath: artifactPaths[0] || '',
    artifactNames: [...new Set(artifactNames)],
    artifactPaths: [...new Set(artifactPaths)],
    selectedMaterialHints
  };
}

function sendPlatformEvent(client, eventName, payload = {}) {
  try {
    client.res.write(`event: ${eventName}\n`);
    client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    platformEventClients.delete(client);
  }
}

function canReceivePlatformEvent(client, event = {}) {
  const type = event.type || '';
  const targetUserId = String(event.payload?.targetUserId || '').trim();
  if (targetUserId && targetUserId !== String(client.userId || '').trim()) return false;
  if (type === 'skill-validations.changed') return client.permissions.has('menu.skillList');
  if (type === 'art-progress-events.changed') return client.permissions.has('menu.skillList');
  if (type === 'art-project-sheet.changed') return client.permissions.has('menu.skillList');
  if (type === 'project-scan-cache.changed') return client.permissions.has('menu.skillList') && canClientAccessProject(client, event.payload?.projectId || artProjectId);
  if (type === 'task-art-brief.changed' || type === 'task-processing-notes.changed' || type === 'tasks.changed') {
    return client.permissions.has('menu.tasks') && canClientAccessProject(client, event.payload?.projectId || artProjectId);
  }
  if (type === 'runs.changed') return canClientAccessProject(client, event.payload?.projectId || '');
  if (type === 'access-control.changed') return true;
  if (type === 'operation-logs.changed') return client.role === 'admin' && (client.permissions.has('api.operationLogs.read') || client.permissions.has('menu.operationLogs'));
  return true;
}

function canClientAccessProject(client, projectId = '') {
  if (!projectId) return true;
  const ids = client.projectIds || [];
  return ids.includes('*') || ids.includes(projectId);
}

async function importAiFlowRecordsFromSheet(project, options = {}, currentUser = {}) {
  const spreadsheetId = String(options.spreadsheetId || defaultAiFlowSheetId).trim();
  const gid = String(options.gid || defaultAiFlowSheetGid).trim();
  const sheetSourceUrl = options.sheetSourceUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}`;
  const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  const response = await fetch(csvUrl);
  if (!response.ok) throw new HttpError(response.status, `Google Sheet 读取失败：${response.statusText || response.status}`);
  const csvText = await response.text();
  const parsed = parseCsv(csvText);
  const headerIndex = parsed.findIndex(row => row.some(cell => normalizeHeader(cell) === '任务名称和单号'));
  if (headerIndex === -1) throw new HttpError(400, '没有找到「任务名称和单号」表头。');
  const headers = parsed[headerIndex].map(normalizeHeader);
  const now = new Date().toISOString();
  const records = parsed.slice(headerIndex + 1)
    .map((row, index) => aiFlowRecordFromSheetRow(headers, row, {
      projectId: project.id,
      sheetSourceUrl,
      sheetRowNumber: headerIndex + index + 2,
      importedAt: now,
      userId: currentUser.id || ''
    }))
    .filter(isImportableAiFlowRecord);
  const result = await upsertAiFlowRecords(records);
  return {
    ...result,
    spreadsheetId,
    gid,
    sheetSourceUrl,
    importedAt: now,
    skipped: Math.max(0, parsed.length - headerIndex - 1 - records.length)
  };
}

function isImportableAiFlowRecord(record = {}) {
  const title = String(record.taskNameAndNo || record.taskTitle || '').trim();
  if (!title) return false;
  if (/^AI\s*问题|^结论[:：]|^测试流程[:：]/i.test(title)) return false;
  return Boolean(record.taskNo || /【[^】]+】|--\s*web|web5|web/i.test(title));
}

function aiFlowRecordFromSheetRow(headers = [], row = [], context = {}) {
  const value = label => row[headers.indexOf(label)] || '';
  return {
    projectId: context.projectId,
    taskNameAndNo: value('任务名称和单号'),
    developer: value('执行开发人员'),
    agentModel: value('使用智能体+模型') || value('使用智能体 + 模型'),
    requirementDoc: value('需求文档输出'),
    dataModelBuild: value('数据模型智能构建'),
    figmaToPage: value('FigmaToPage') || value('Figma To Page'),
    apiOrchestration: value('API取调编排'),
    autoCodeQuality: value('自动质检代码'),
    devQualityReport: value('开发质检报告'),
    qualificationAssessment: value('达标/合格率评估'),
    autoFix: value('自动修复'),
    flowCompletion: value('全流程完成度'),
    totalDuration: value('生成总时长'),
    summaryIssues: value('总结和问题'),
    status: 'confirmed',
    source: 'sheet-import',
    sheetSourceUrl: context.sheetSourceUrl,
    sheetRowNumber: context.sheetRowNumber,
    importedAt: context.importedAt,
    updatedBy: context.userId,
    createdBy: context.userId
  };
}

function normalizeHeader(value = '') {
  return String(value || '').replace(/\s+/g, '').trim();
}

async function loadArtProjectSheet(options = {}) {
  const spreadsheetId = String(options.spreadsheetId || defaultArtProjectSheetId).trim();
  const gid = String(options.gid || defaultArtProjectSheetGid).trim();
  const sheetSourceUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}`;
  const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  const response = await fetch(csvUrl);
  if (!response.ok) throw new HttpError(response.status, `Google 项目表读取失败：${response.statusText || response.status}`);
  const csvText = await response.text();
  const parsed = parseCsv(csvText);
  const headerIndex = parsed.findIndex(row => row.some(cell => normalizeHeader(cell) === '文件'));
  if (headerIndex === -1) throw new HttpError(400, '没有找到「文件」表头。');
  const rawHeaders = parsed[headerIndex].map(cell => String(cell || '').trim());
  const rows = parsed.slice(headerIndex + 1)
    .map((row, index) => artProjectSheetRow(rawHeaders, row, headerIndex + index + 2))
    .filter(row => row.file || row.owner || row.figmaName || row.devLink || row.viewLink || row.pcPreviewLink || row.wapPreviewLink);
  const overrides = await listArtProjectSheetOverrides();
  const overrideById = new Map(overrides.map(row => [String(row.id), row]));
  const mergedRows = rows
    .filter(row => overrideById.get(row.id)?.deleted !== true)
    .map(row => normalizeArtProjectSheetOverride({ ...row, ...(overrideById.get(row.id) || {}), source: 'google' }));
  const existingIds = new Set(mergedRows.map(row => row.id));
  for (const row of overrides) {
    if (!existingIds.has(row.id) && row.deleted !== true) mergedRows.push(normalizeArtProjectSheetOverride({ ...row, source: row.source || 'manual' }));
  }
  return {
    spreadsheetId,
    gid,
    sheetSourceUrl,
    fetchedAt: new Date().toISOString(),
    headers: rawHeaders,
    fields: await listArtProjectSheetFields(rawHeaders),
    rows: mergedRows
  };
}

async function listArtProjectSheetFields(rawHeaders = []) {
  const config = await readArtProjectSheetConfig();
  const builtinFields = defaultArtProjectSheetFields(rawHeaders);
  const byKey = new Map(builtinFields.map(field => [field.key, field]));
  for (const field of config.fields || []) {
    const normalized = normalizeArtProjectSheetField(field);
    if (normalized.deleted === true) {
      byKey.delete(normalized.key);
      continue;
    }
    const base = byKey.get(normalized.key) || {};
    byKey.set(normalized.key, { ...base, ...normalized });
  }
  return [...byKey.values()]
    .filter(field => field.deleted !== true)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.label).localeCompare(String(b.label)));
}

function defaultArtProjectSheetFields(rawHeaders = []) {
  const builtin = [
    { key: 'file', label: '项目名', source: 'builtin', locked: true, order: 10 },
    { key: 'devLink', label: '开发模式', source: 'builtin', type: 'url', order: 20 },
    { key: 'viewLink', label: '测试查阅', source: 'builtin', type: 'url', order: 30 },
    { key: 'pcPreviewLink', label: '预览链-PC', source: 'builtin', type: 'url', order: 40 },
    { key: 'wapPreviewLink', label: '预览链-WAP', source: 'builtin', type: 'url', order: 50 }
  ];
  const knownHeaders = new Set(['文件', '开发模式', '测试查阅', '预览链-PC', '预览链-WAP']);
  const extraFields = rawHeaders
    .map(header => String(header || '').trim())
    .filter(header => header && !knownHeaders.has(header))
    .map((header, index) => ({
      key: `extra.${header}`,
      label: header,
      source: 'sheet',
      order: 100 + index
    }));
  return [...builtin, ...extraFields].map(normalizeArtProjectSheetField);
}

async function readArtProjectSheetConfig() {
  try {
    const raw = await fs.readFile(artProjectSheetConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      fields: Array.isArray(parsed.fields) ? parsed.fields.map(normalizeArtProjectSheetField) : []
    };
  } catch {
    return { fields: [] };
  }
}

async function writeArtProjectSheetConfig(config = {}) {
  const fields = Array.isArray(config.fields) ? config.fields.map(normalizeArtProjectSheetField) : [];
  await fs.writeFile(artProjectSheetConfigPath, `${JSON.stringify({ fields }, null, 2)}\n`);
  return { fields };
}

async function upsertArtProjectSheetField(input = {}) {
  const config = await readArtProjectSheetConfig();
  const field = normalizeArtProjectSheetField(input);
  if (!field.label) throw new HttpError(400, '字段名称不能为空。');
  const index = config.fields.findIndex(item => item.key === field.key);
  const now = new Date().toISOString();
  const nextField = {
    ...field,
    source: field.source === 'builtin' ? 'builtin' : 'custom',
    updatedAt: now,
    createdAt: field.createdAt || now,
    deleted: false
  };
  if (index >= 0) config.fields[index] = { ...config.fields[index], ...nextField };
  else config.fields.push(nextField);
  const saved = await writeArtProjectSheetConfig(config);
  return { ...saved, field: nextField };
}

async function deleteArtProjectSheetField(key = '') {
  const fieldKey = decodeURIComponent(String(key || '').trim());
  if (!fieldKey || fieldKey === 'file') throw new HttpError(400, '项目名字段不能删除。');
  const config = await readArtProjectSheetConfig();
  const index = config.fields.findIndex(item => item.key === fieldKey);
  const deletedField = index >= 0
    ? { ...config.fields[index], deleted: true, updatedAt: new Date().toISOString() }
    : { key: fieldKey, label: fieldKey.replace(/^extra\./, ''), source: 'custom', deleted: true, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  if (index >= 0) config.fields[index] = deletedField;
  else config.fields.push(deletedField);
  const saved = await writeArtProjectSheetConfig(config);
  return { ...saved, deletedField };
}

function normalizeArtProjectSheetField(input = {}) {
  const rawLabel = String(input.label || input.name || '').trim();
  const rawKey = String(input.key || '').trim();
  const label = rawLabel || rawKey.replace(/^extra\./, '');
  const key = rawKey || (label ? `extra.${label}` : '');
  return {
    key,
    label,
    type: input.type === 'url' || /链接|链|url/i.test(label) ? 'url' : 'text',
    source: String(input.source || '').trim() || 'custom',
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : 999,
    locked: input.locked === true || key === 'file',
    deleted: input.deleted === true,
    createdAt: String(input.createdAt || '').trim(),
    updatedAt: String(input.updatedAt || '').trim()
  };
}

async function listArtProjectSheetOverrides() {
  try {
    const raw = await fs.readFile(artProjectSheetOverridesPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeArtProjectSheetOverride) : [];
  } catch {
    return [];
  }
}

async function writeArtProjectSheetOverrides(rows = []) {
  await fs.writeFile(artProjectSheetOverridesPath, `${JSON.stringify(rows.map(normalizeArtProjectSheetOverride), null, 2)}\n`);
}

async function upsertArtProjectSheetOverride(input = {}) {
  const rows = await listArtProjectSheetOverrides();
  const row = normalizeArtProjectSheetOverride(input);
  const index = rows.findIndex(item => item.id === row.id);
  if (index >= 0) rows[index] = { ...rows[index], ...row, updatedAt: new Date().toISOString() };
  else rows.push({ ...row, source: row.source || 'manual', createdAt: row.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
  await writeArtProjectSheetOverrides(rows);
  return rows.find(item => item.id === row.id);
}

async function deleteArtProjectSheetOverride(id = '') {
  const rows = await listArtProjectSheetOverrides();
  const index = rows.findIndex(item => item.id === id);
  if (index === -1) {
    const row = normalizeArtProjectSheetOverride({ id, file: '', deleted: true });
    rows.push(row);
    await writeArtProjectSheetOverrides(rows);
    return row;
  }
  rows[index] = { ...rows[index], deleted: true, updatedAt: new Date().toISOString() };
  await writeArtProjectSheetOverrides(rows);
  return rows[index];
}

async function loadSkillValidations() {
  const fallback = {
    sourceName: '部门验证表（实时）',
    spreadsheetId: defaultSkillValidationSheetId,
    gid: defaultSkillValidationSheetGid,
    sheetSourceUrl: `https://docs.google.com/spreadsheets/d/${defaultSkillValidationSheetId}/edit?gid=${defaultSkillValidationSheetGid}#gid=${defaultSkillValidationSheetGid}`,
    startRow: defaultSkillValidationStartRow,
    importedAt: '',
    records: []
  };
	  const live = await fetchSkillValidationsFromGoogleSheet().catch(error => ({ error: error.message || String(error) }));
	  if (live && !live.error && Array.isArray(live.records) && live.records.length) return live;
	  try {
	    const raw = await fs.readFile(skillValidationsPath, 'utf8');
	    const parsed = JSON.parse(raw);
	    const { googleRecords, manualRecords } = splitStoredSkillValidationRecords(parsed);
	    const records = mergeSkillValidationRecords(googleRecords, manualRecords);
	    return skillValidationSummary({
	      ...fallback,
	      ...parsed,
	      ...(live?.error ? { lastError: live.error } : {}),
	      records,
	      googleRecords,
	      manualRecords,
	      sourcePath: skillValidationsPath
	    });
  } catch (error) {
    if (error.code === 'ENOENT') return { ...fallback, total: 0, completedCount: 0, deliverableCount: 0, walkthroughDoneCount: 0, sourcePath: skillValidationsPath };
    throw error;
  }
}

async function writeSkillValidations(payload = {}) {
  const nextPayload = await applySkillValidationRetention(payload);
  await fs.mkdir(path.dirname(skillValidationsPath), { recursive: true });
  await fs.writeFile(skillValidationsPath, `${JSON.stringify(nextPayload, null, 2)}\n`);
}

async function applySkillValidationRetention(payload = {}) {
  if (!dataRetentionEnabled || !payload || typeof payload !== 'object') return payload;
  const cutoff = Date.now() - dataRetentionDays * 24 * 60 * 60 * 1000;
  const next = { ...payload };
  const expiredById = new Map();
  for (const key of ['records', 'googleRecords', 'manualRecords']) {
    if (!Array.isArray(payload[key])) continue;
    next[key] = payload[key].filter(record => {
      if (record?.deleted === true) return true;
      if (isGoogleSkillValidationRecord(record)) return true;
      const time = validationRetentionTime(record);
      const keep = !time || time >= cutoff;
      if (!keep) expiredById.set(record.id || skillValidationRecordKey(record), record);
      return keep;
    });
  }
  if (expiredById.size) await recordUsageCountersForExpiredSkillValidations([...expiredById.values()]);
  next.retention = {
    ...(payload.retention && typeof payload.retention === 'object' ? payload.retention : {}),
    days: dataRetentionDays,
    lastAppliedAt: new Date().toISOString()
  };
  return next;
}

function validationRetentionTime(record = {}) {
  for (const value of [record.createdAt, record.updatedAt, record.submittedAt, record.importedAt]) {
    const time = Date.parse(String(value || '').trim());
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

async function enforceServerFileRetention() {
  if (!dataRetentionEnabled) return;
  await enforceSkillValidationFileRetention();
  await enforceArtDashboardSnapshotRetention();
}

async function enforceSkillValidationFileRetention() {
  try {
    const raw = await fs.readFile(skillValidationsPath, 'utf8');
    const parsed = JSON.parse(raw);
    await writeSkillValidations(parsed && typeof parsed === 'object' ? parsed : {});
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function enforceArtDashboardSnapshotRetention() {
  const cutoff = Date.now() - dataRetentionDays * 24 * 60 * 60 * 1000;
  let entries = [];
  try {
    entries = await fs.readdir(artDashboardDataDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(entries
    .filter(entry => entry.isFile())
    .map(async entry => {
      const dateMatch = entry.name.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) return;
      const time = Date.parse(`${dateMatch[1]}T00:00:00+08:00`);
      if (!Number.isFinite(time) || time >= cutoff) return;
      await fs.unlink(path.join(artDashboardDataDir, entry.name)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }));
}

function mergeSkillValidationRecords(baseRecords = [], manualRecords = []) {
  const map = new Map();
  const baseIds = new Set(baseRecords.map(record => record.id || skillValidationRecordKey(record)).filter(Boolean));
  const deletedIds = new Set(manualRecords
    .filter(record => record.deleted === true && record.id && !baseIds.has(record.id))
    .map(record => record.id));
  for (const record of baseRecords) {
    const id = skillValidationMergeKey(record) || record.id || skillValidationRecordKey(record);
    if (!deletedIds.has(id) && isSkillValidationRecord(record)) map.set(id, record);
  }
  for (const record of manualRecords) {
    if (record.deleted === true) {
      if (record.id) map.delete(record.id);
      continue;
    }
    if (!isSkillValidationRecord(record)) continue;
    const id = skillValidationMergeKey(record) || record.id || skillValidationRecordKey(record);
    if (baseIds.has(id)) continue;
    const previous = map.get(id);
    map.set(id, previous ? preferLatestSkillValidationRecord(previous, record) : record);
  }
  return [...map.values()].sort((a, b) => {
    const ar = Number(a.rowNumber || 0);
    const br = Number(b.rowNumber || 0);
    if (ar || br) return (ar || 999999) - (br || 999999);
    return String(a.createdAt || a.importedAt || '').localeCompare(String(b.createdAt || b.importedAt || ''));
  });
}

function isGoogleSkillValidationRecord(record = {}) {
  const source = cleanText(record.source);
  const originalSource = cleanText(record.originalSource);
  const id = cleanText(record.id);
  return Number(record.rowNumber || 0) > 0
    || source === 'Google Sheet'
    || originalSource === 'Google Sheet'
    || /^skill-validation-row-\d+$/i.test(id);
}

function splitStoredSkillValidationRecords(stored = {}) {
  const googleMap = new Map();
  const addGoogle = record => {
    if (!isSkillValidationRecord(record)) return;
    if (!isGoogleSkillValidationRecord(record)) return;
    const id = record.id || skillValidationRecordKey(record);
    if (!id) return;
    const previous = googleMap.get(id);
    if (!previous || cleanText(record.source) === 'Google Sheet') googleMap.set(id, {
      ...record,
      manualOwnerOverride: false,
      forceDisplayInValidation: false,
      manualBackfill: false,
      source: 'Google Sheet',
      originalSource: cleanText(record.originalSource || record.source) || 'Google Sheet',
      updatedBy: ''
    });
  };
  for (const record of Array.isArray(stored.googleRecords) ? stored.googleRecords : []) addGoogle(record);
  for (const record of Array.isArray(stored.records) ? stored.records : []) addGoogle(record);
  for (const record of Array.isArray(stored.manualRecords) ? stored.manualRecords : []) addGoogle(record);

  const googleIds = new Set(googleMap.keys());
  const manualRecords = (Array.isArray(stored.manualRecords) ? stored.manualRecords : [])
    .filter(record => record?.deleted === true || isSkillValidationRecord(record))
    .filter(record => {
      const id = record?.id || skillValidationRecordKey(record);
      return !isGoogleSkillValidationRecord(record) && !googleIds.has(id);
    });

  return {
    googleRecords: [...googleMap.values()].sort((a, b) => {
      const ar = Number(a.rowNumber || 0);
      const br = Number(b.rowNumber || 0);
      if (ar || br) return (ar || 999999) - (br || 999999);
      return String(a.createdAt || a.importedAt || '').localeCompare(String(b.createdAt || b.importedAt || ''));
    }),
    manualRecords
  };
}

function mergeFetchedSkillValidationGoogleRecords(previousRecords = [], fetchedRecords = []) {
  const map = new Map();
  for (const record of previousRecords) {
    if (!isSkillValidationRecord(record)) continue;
    const id = record.id || skillValidationRecordKey(record);
    map.set(id, record);
  }
  for (const record of fetchedRecords) {
    if (!isSkillValidationRecord(record)) continue;
    const id = record.id || skillValidationRecordKey(record);
    const previous = map.get(id);
    if (!previous) {
      map.set(id, record);
      continue;
    }
    map.set(id, {
      ...record,
      id,
      createdAt: previous.createdAt || record.createdAt || '',
      importedAt: previous.importedAt || record.importedAt || '',
      updatedAt: ''
    });
  }
  return [...map.values()].sort((a, b) => {
    const ar = Number(a.rowNumber || 0);
    const br = Number(b.rowNumber || 0);
    if (ar || br) return (ar || 999999) - (br || 999999);
    return String(a.createdAt || a.importedAt || '').localeCompare(String(b.createdAt || b.importedAt || ''));
  });
}

function skillValidationSummary(payload = {}) {
  const records = Array.isArray(payload.records) ? payload.records.filter(isSkillValidationRecord) : [];
  const manualRecords = Array.isArray(payload.manualRecords)
    ? payload.manualRecords.filter(record => record?.deleted === true || isSkillValidationRecord(record))
    : [];
  return {
    ...payload,
    records,
    manualRecords,
    total: records.length,
    completedCount: records.filter(record => record.status === '已完成').length,
    deliverableCount: records.filter(record => record.deliverableReady).length,
    walkthroughDoneCount: records.filter(record => record.walkthroughDone).length,
    sourcePath: skillValidationsPath
  };
}

function deletedSkillValidationMarker(record = {}, currentUser = {}) {
  const now = new Date().toISOString();
  return {
    ...record,
    id: record.id,
    deleted: true,
    source: record.source === '工作台人工回填' ? record.source : '工作台隐藏记录',
    deletedAt: now,
    deletedBy: currentUser.displayName || currentUser.username || '',
    updatedAt: now
  };
}

function skillValidationRecordKey(record = {}) {
  return [
    record.rowNumber,
    record.artifactName,
    record.researchName,
    record.validator,
    record.owner,
    record.evidenceLink
  ].map(value => String(value || '').trim()).join('|');
}

function skillValidationMergeKey(record = {}) {
  if (isGoogleSkillValidationRecord(record)) return '';
  const artifact = normalizeSkillValidationMatchKey(record.artifactName || record.researchName || record.artifactLocation || record.sourceRef || record.scope);
  const validator = normalizeSkillValidationMatchKey(record.validator || record.walkthroughOwner);
  const evidence = normalizeSkillValidationMatchKey(record.evidenceLink || record.validationTask || record.artifactLocation);
  if (!artifact || !validator) return '';
  return ['manual-validation', artifact, validator, evidence].filter(Boolean).join('|');
}

function normalizeSkillValidationMatchKey(value = '') {
  return cleanText(value)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.(md|markdown)$/i, '')
    .toLowerCase()
    .replace(/[_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '') || '';
}

function preferLatestSkillValidationRecord(left = {}, right = {}) {
  const leftTime = skillValidationMergeTime(left);
  const rightTime = skillValidationMergeTime(right);
  const latest = rightTime >= leftTime ? right : left;
  const older = latest === right ? left : right;
  return {
    ...older,
    ...latest,
    createdAt: latest.createdAt || older.createdAt || '',
    submittedAt: latest.submittedAt || older.submittedAt || '',
    updatedAt: latest.updatedAt || older.updatedAt || '',
    notes: latest.notes || older.notes || '',
    mergedCount: Number(older.mergedCount || 1) + Number(latest.mergedCount || 1),
    latestSubmittedAt: latest.submittedAt || latest.createdAt || latest.updatedAt || ''
  };
}

function skillValidationMergeTime(record = {}) {
  for (const value of [record.submittedAt, record.createdAt, record.updatedAt, record.importedAt]) {
    const time = Date.parse(String(value || '').trim());
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function cleanText(value = '') {
  return String(value ?? '').trim();
}

function normalizeSkillValidationPerson(value = '') {
  const text = cleanText(value);
  if (!text) return '';
  const direct = findDefaultArtUser(text);
  if (direct?.realname) return direct.realname;
  const shortAliases = new Map([
    ['倩文', '张倩文'],
    ['淑琪', '冯淑琪'],
    ['盛威', '余盛威'],
    ['君博', '叶君博'],
    ['剑荣', '黄剑荣'],
    ['华玲', '李华玲'],
    ['宗斌', '张宗斌'],
    ['韩界', '兰韩界']
  ]);
  for (const [alias, name] of shortAliases.entries()) {
    if (text === alias || text.includes(alias)) return name;
  }
  const chinese = text.match(/[\u4e00-\u9fa5]{2,4}/);
  return chinese ? chinese[0] : text;
}

function splitPersonList(value = '') {
  return cleanText(value)
    .split(/[、,，;；|/\\\s]+/)
    .map(item => normalizeSkillValidationPerson(item))
    .filter(Boolean)
    .filter((item, index, array) => array.findIndex(other => samePersonName(other, item)) === index);
}

function normalizePersonListText(value = '') {
  return splitPersonList(value).join('、');
}

function normalizeSkillValidationRecord(input = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const rowNumber = Number(input.rowNumber || 0);
  const validationResult = cleanText(input.validationResult || input.status || '');
  const reuseAdvice = cleanText(input.reuseAdvice || '');
  const id = cleanText(input.id) || `skill-validation-manual-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const record = {
    id,
    rowNumber,
    submittedAt: cleanText(input.submittedAt),
    validator: normalizeSkillValidationPerson(input.validator),
    sourceRef: cleanText(input.sourceRef),
    owner: normalizePersonListText(input.owner),
    manualOwnerOverride: input.manualOwnerOverride === true,
    forceDisplayInValidation: input.forceDisplayInValidation === true,
    manualBackfill: input.manualBackfill === true,
    researchName: cleanText(input.researchName),
    artifactType: cleanText(input.artifactType),
    artifactName: cleanText(input.artifactName),
    artifactLocation: cleanText(input.artifactLocation),
    workflowScene: cleanText(input.workflowScene),
    validationTask: cleanText(input.validationTask),
    selfCreated: cleanText(input.selfCreated),
    inputMaterial: cleanText(input.inputMaterial),
    evidenceLink: cleanText(input.evidenceLink),
    validationResult,
    manualChange: cleanText(input.manualChange),
    timeEstimate: cleanText(input.timeEstimate),
    issues: cleanText(input.issues),
    suggestion: cleanText(input.suggestion),
    reuseAdvice,
    notes: cleanText(input.notes),
    scope: cleanText(input.artifactName || input.researchName || input.sourceRef || input.scope),
    status: normalizeSkillValidationStatus(validationResult),
    deliverableReady: /可直接复用|建议.*复用/.test(`${validationResult} ${reuseAdvice}`),
    walkthroughOwner: normalizeSkillValidationPerson(input.validator || input.walkthroughOwner),
    walkthroughDone: Boolean(validationResult && !/待评估|待判断|待记录|待填写/.test(validationResult)),
    zentaoTaskUrl: /^https?:\/\//i.test(cleanText(input.validationTask)) ? cleanText(input.validationTask) : '',
    source: cleanText(input.source) || '工作台人工回填',
    originalSource: cleanText(input.originalSource || input.source),
    sourceUrl: cleanText(input.sourceUrl),
    importedAt: cleanText(input.importedAt),
    createdAt: cleanText(input.createdAt) || now,
    updatedAt: now,
    updatedBy: options.user?.displayName || options.user?.username || ''
  };
  if (!record.artifactName && !record.researchName) throw new HttpError(400, '请填写研究项名称或产物文件名。');
  return record;
}

function skillValidationOperationTargetName(record = {}) {
  return validationArtifactDisplayName(record.artifactLocation)
    || cleanText(record.artifactName)
    || validationArtifactDisplayName(record.researchName)
    || cleanText(record.researchName)
    || '未命名产物';
}

function isOwnerWorkbenchUser(user = {}) {
  if (user.role === 'admin') return true;
  return [user.username, user.displayName, user.name, user.realname, user.account]
    .filter(Boolean)
    .some(value => samePersonName(value, 'zhangqw') || samePersonName(value, '张倩文') || samePersonName(value, 'admin'));
}

function hasUserPermission(user = {}, permission = '') {
  return user.role === 'admin' || (Array.isArray(user.permissions) && user.permissions.includes(permission));
}

function canManageSkillValidationOwner(user = {}) {
  return isOwnerWorkbenchUser(user) || hasUserPermission(user, 'skill.validationOwner.manage');
}

function canManageSkillAssetOwner(user = {}) {
  return isOwnerWorkbenchUser(user) || hasUserPermission(user, 'skill.assetOwner.manage');
}

function normalizeSkillValidationOwnerInput(input = {}, currentUser = {}) {
  if (canManageSkillValidationOwner(currentUser)) return input;
  const id = cleanText(input.id);
  if (!id) return { ...input, owner: '' };
  const rows = Array.isArray(input.__existingRows) ? input.__existingRows : [];
  const existing = rows.find(row => row.id === id);
  return { ...input, owner: existing?.owner || '' };
}

async function saveSkillValidationRecord(input = {}, currentUser = {}, options = {}) {
  const stored = await loadSkillValidationsFromFile();
  const { googleRecords, manualRecords } = splitStoredSkillValidationRecords(stored);
  const inputWithOwnerGuard = options.skipOwnerGuard === true || canManageSkillValidationOwner(currentUser)
    ? input
    : normalizeSkillValidationOwnerInput({ ...input, __existingRows: [...manualRecords, ...googleRecords] }, currentUser);
  const nextRecord = normalizeSkillValidationRecord(inputWithOwnerGuard, { user: currentUser });
  const googleSourceRecord = googleRecords.find(record => (record.id || skillValidationRecordKey(record)) === nextRecord.id);
  if (googleSourceRecord) {
    const result = skillValidationSummary({
      ...stored,
      sourceName: stored.sourceName || '部门验证表（实时）',
      spreadsheetId: stored.spreadsheetId || defaultSkillValidationSheetId,
      gid: stored.gid || defaultSkillValidationSheetGid,
      sheetSourceUrl: stored.sheetSourceUrl || `https://docs.google.com/spreadsheets/d/${defaultSkillValidationSheetId}/edit?gid=${defaultSkillValidationSheetGid}#gid=${defaultSkillValidationSheetGid}`,
      startRow: stored.startRow || defaultSkillValidationStartRow,
      records: mergeSkillValidationRecords(googleRecords, manualRecords),
      googleRecords,
      manualRecords
    });
    await writeSkillValidations(result);
    return {
      ...result,
      savedRecord: googleSourceRecord,
      warning: 'Google 表记录以源表为准，工作台未覆盖原始字段。'
    };
  }
  const index = manualRecords.findIndex(record => record.id === nextRecord.id);
  let savedRecord = nextRecord;
  if (index >= 0) {
    savedRecord = { ...manualRecords[index], ...nextRecord, createdAt: manualRecords[index].createdAt || nextRecord.createdAt };
    manualRecords[index] = savedRecord;
  } else {
    manualRecords.push(savedRecord);
  }
  const result = skillValidationSummary({
    ...stored,
    sourceName: stored.sourceName || '部门验证表（实时）',
    spreadsheetId: stored.spreadsheetId || defaultSkillValidationSheetId,
    gid: stored.gid || defaultSkillValidationSheetGid,
    sheetSourceUrl: stored.sheetSourceUrl || `https://docs.google.com/spreadsheets/d/${defaultSkillValidationSheetId}/edit?gid=${defaultSkillValidationSheetGid}#gid=${defaultSkillValidationSheetGid}`,
    startRow: stored.startRow || defaultSkillValidationStartRow,
    records: mergeSkillValidationRecords(googleRecords, manualRecords),
    googleRecords,
    manualRecords
  });
  await writeSkillValidations(result);
  const usagePatch = await recordUsageCountersForSkillValidation(savedRecord);
  return { ...result, savedRecord, usagePatch };
}

async function deleteSkillValidationRecord(id = '', currentUser = {}) {
  const targetId = cleanText(decodeURIComponent(id));
  if (!targetId) throw new HttpError(400, '缺少验证回填记录标识。');
  const stored = await loadSkillValidationsFromFile();
  const { googleRecords, manualRecords } = splitStoredSkillValidationRecords(stored);
  const sourceRecord = manualRecords.find(record => record.id === targetId)
    || googleRecords.find(record => record.id === targetId)
    || (Array.isArray(stored.records) ? stored.records.find(record => record.id === targetId) : null);
  if (!sourceRecord) throw new HttpError(404, '验证回填记录不存在。');
  const marker = deletedSkillValidationMarker(sourceRecord, currentUser);
  const index = manualRecords.findIndex(record => record.id === targetId);
  if (index >= 0) manualRecords[index] = marker;
  else manualRecords.push(marker);
  const result = skillValidationSummary({
    ...stored,
    records: mergeSkillValidationRecords(googleRecords, manualRecords),
    googleRecords,
    manualRecords
  });
  await writeSkillValidations(result);
  return { ...result, deletedRecord: sourceRecord };
}

async function loadSkillValidationsFromFile() {
  try {
    const raw = await fs.readFile(skillValidationsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function loadSkillVersionOverrides() {
  try {
    const raw = await fs.readFile(skillVersionOverridesPath, 'utf8');
    const parsed = JSON.parse(raw);
    const overrides = parsed && typeof parsed === 'object' ? parsed : {};
    return normalizeSkillVersionAliasOverrides(overrides);
  } catch {
    return {};
  }
}

function normalizeSkillVersionAliasOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== 'object') return {};
  const normalized = { ...overrides };
  for (const [key, record] of Object.entries(overrides)) {
    if (/^(version|owner|name|kind|display):/.test(String(key || '').trim())) continue;
    if (!record || typeof record !== 'object' || !Array.isArray(record.aliases)) continue;
    const aliasKey = skillAliasOverrideKey({
      projectId: record.projectId || '',
      relativePath: record.relativePath || record.path || '',
      path: record.relativePath || record.path || '',
      id: record.id || ''
    });
    if (!aliasKey || aliasKey === key) continue;
    const existingAlias = normalized[aliasKey] || {};
    normalized[aliasKey] = {
      ...existingAlias,
      key: aliasKey,
      id: existingAlias.id || record.id || '',
      projectId: existingAlias.projectId || record.projectId || '',
      title: existingAlias.title || record.title || '',
      relativePath: existingAlias.relativePath || record.relativePath || record.path || '',
      aliases: Array.isArray(existingAlias.aliases) ? existingAlias.aliases : record.aliases,
      aliasHistory: mergeSkillAliasHistory(existingAlias.aliasHistory, existingAlias.aliases, record.aliasHistory, record.aliases),
      updatedAt: existingAlias.updatedAt || record.updatedAt || ''
    };
  }
  return normalized;
}

async function writeSkillVersionOverrides(overrides = {}) {
  await fs.mkdir(path.dirname(skillVersionOverridesPath), { recursive: true });
  await fs.writeFile(skillVersionOverridesPath, `${JSON.stringify(normalizeSkillVersionAliasOverrides(overrides), null, 2)}\n`);
}

async function loadProjectScanCache() {
  try {
    const raw = await fs.readFile(projectScanCachePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeInventoryProductKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[\\/_.\-:：()[\]（）【】「」《》<>#?&=+，,。；;、\s]+/g, '');
}

function inventoryProductFileName(value = '') {
  return path.basename(String(value || '').replace(/\\/g, '/'));
}

function inventoryProductKind(skill = {}) {
  const directKind = String(skill.inventoryKind || skill.skillInventoryKind || '').trim();
  if (directKind === 'skill') return 'skill';
  if (directKind === 'document') return 'standard';
  if (directKind === 'directory') return 'directory';
  const text = [
    skill.inventoryKind,
    skill.skillInventoryKind,
    skill.relativePath,
    skill.path,
    skill.git?.relativePath,
    skill.productFileName,
    skill.productDisplayName,
    skill.displayName,
    skill.title,
    skill.description,
    skill.preview,
    skill.category
  ].join('\n');
  if (/(^|\/)SKILL\.md$/i.test(text)) return 'skill';
  if (/规范|规则|模板|说明|指南|标准|交付|命名|清单|流程|design|handoff|template|guide|standard/i.test(text)) return 'standard';
  return 'directory';
}

function isVisibleInventoryProduct(skill = {}) {
  if (!skill || skill.hidden === true || skill.displayHidden === true) return false;
  const kind = String(skill.inventoryKind || skill.skillInventoryKind || '').trim();
  if (kind === 'directory' || kind === 'skill' || kind === 'document') return true;
  const relativePath = String(skill.git?.relativePath || skill.relativePath || skill.path || '').replace(/\\/g, '/');
  const title = String(skill.productDisplayName || skill.productFileName || skill.displayName || skill.title || '').trim();
  const source = String(skill.source || '').trim();
  const text = [relativePath, title, skill.description, skill.preview].join('\n');
  if (!relativePath && !title) return false;
  if (/^member-art-reporter\//i.test(relativePath)) return true;
  if (/(^|\/)(README|CODEX_RULES|AGENTS|CLAUDE)\.md$/i.test(relativePath)) return false;
  if (/(^|\/)(install|setup|report|auto-sync|troubleshooting|classification)\.md$/i.test(relativePath)) return false;
  if (source.startsWith('Git:')) return true;
  return /(\.md|SKILL\.md|skill|规范|组件|模板|流程|规则|资源|资产|design|命名|整理|拆解|提取)/i.test(text);
}

function inventoryProductName(skill = {}) {
  return String(
    skill.productDisplayName
    || skill.productFileName
    || skill.displayName
    || skill.title
    || inventoryProductFileName(skill.git?.relativePath || skill.relativePath || skill.path)
    || skill.id
    || ''
  ).trim();
}

function buildSkillInventoryProductStats(scans = {}) {
  const rank = { skill: 3, standard: 2, directory: 1 };
  const products = new Map();
  for (const scan of Object.values(scans || {})) {
    for (const skill of Array.isArray(scan?.skills) ? scan.skills : []) {
      if (!isVisibleInventoryProduct(skill)) continue;
      const name = inventoryProductName(skill);
      const key = normalizeInventoryProductKey(name || skill.id || '');
      if (!key) continue;
      const kind = inventoryProductKind(skill);
      const existing = products.get(key);
      if (!existing || rank[kind] > rank[existing.kind]) {
        products.set(key, { kind });
      }
    }
  }
  const rows = [...products.values()];
  return {
    total: rows.length,
    skill: rows.filter(row => row.kind === 'skill').length,
    standard: rows.filter(row => row.kind === 'standard').length,
    directory: rows.filter(row => row.kind === 'directory').length
  };
}

async function writeProjectScanCache(cache = {}) {
  await fs.mkdir(path.dirname(projectScanCachePath), { recursive: true });
  await fs.writeFile(projectScanCachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

async function readProjectScanFromCache(project = {}) {
  const cache = await loadProjectScanCache();
  const cached = cache[project.id]?.scan;
  if (cached && typeof cached === 'object') {
    return await applySkillVersionOverridesToScan({
      ...await hydrateCachedSkillAuditScores(cached),
      cacheOnly: true,
      cachedAt: cache[project.id]?.cachedAt || cached.cachedAt || ''
    });
  }
  return await applySkillVersionOverridesToScan(emptyPreservedProjectScan(project, new Error('暂无上次库存缓存，请点击刷新库存。')));
}

async function scanProjectWithStableCache(project = {}, options = {}) {
  let cache = await loadProjectScanCache();
  try {
    const scan = await applySkillVersionOverridesToScan(await hydrateCachedSkillAuditScores(await scanProject(project, options)));
    const previousScan = cache[project.id]?.scan || null;
    const stableScan = mergeStableProjectScan(project, previousScan, scan);
    const nextEntry = {
      projectId: project.id,
      cachedAt: new Date().toISOString(),
      scan: stableScan
    };
    cache = {
      ...cache,
      [project.id]: nextEntry
    };
    if (isLocalOrSharedScanSource(project)) {
      await cleanupRemovedScanSourceProductData(project, previousScan, stableScan, cache);
    }
    await writeProjectScanCache(cache);
    broadcastPlatformEvent('project-scan-cache.changed', { projectId: project.id, module: 'skill-inventory' });
    return stableScan;
  } catch (error) {
    const cached = cache[project.id]?.scan;
    if (!cached) {
      return await applySkillVersionOverridesToScan(emptyPreservedProjectScan(project, error));
    }
    return await applySkillVersionOverridesToScan({
      ...cached,
      preserved: true,
      lastError: error.message || String(error),
      lastFailedAt: new Date().toISOString()
    });
  }
}

async function cleanupDeletedProjectScanCache(project = {}) {
  if (!project?.id) return { removed: false };
  const cache = await loadProjectScanCache();
  const previousScan = cache[project.id]?.scan || null;
  if (!previousScan) return { removed: false };
  delete cache[project.id];
  if (isLocalOrSharedScanSource(project)) {
    await cleanupRemovedScanSourceProductData(project, previousScan, { ...previousScan, skills: [], tasks: [] }, cache);
  }
  await writeProjectScanCache(cache);
  broadcastPlatformEvent('project-scan-cache.changed', { projectId: project.id, module: 'skill-inventory' });
  return { removed: true };
}

function emptyPreservedProjectScan(project = {}, error = null) {
  return {
    projectId: project.id,
    rootPath: project.rootPath || '',
    scannedAt: new Date().toISOString(),
    framework: project.framework || '未知',
    configs: {},
    workflowProfile: null,
    skills: [],
    tasks: [],
    detected: {},
    preserved: true,
    lastError: error?.message || String(error || '扫描失败'),
    lastFailedAt: new Date().toISOString()
  };
}

async function hydrateCachedSkillAuditScores(scan = {}) {
  if (!scan || typeof scan !== 'object') return scan;
  const skills = Array.isArray(scan.skills)
    ? await Promise.all(scan.skills.map(async skill => {
      if (!skill || typeof skill !== 'object') return skill;
      if (!isSkillAuditTarget(skill)) {
        return stripSkillAuditFields(skill);
      }
      if (!shouldHydrateSkillAuditScore(skill)) return skill;
      const sourceText = await readSkillAuditSourceText(scan, skill);
      const auditFields = skillAuditFields(sourceText ? { ...skill, content: sourceText } : skill);
      if (!Object.keys(auditFields).length) return stripSkillAuditFields(skill);
      const next = { ...skill, ...auditFields };
      return isSameSkillAuditScore(skill, auditFields) ? skill : next;
    }))
    : scan.skills;
  if (skills === scan.skills || (Array.isArray(scan.skills) && skills.every((skill, index) => skill === scan.skills[index]))) return scan;
  return { ...scan, skills };
}

function shouldHydrateSkillAuditScore(skill = {}) {
  if (!Number.isFinite(Number(skill.auditScore ?? skill.audit?.score))) return true;
  return String(skill.audit?.standard || '') !== 'skill-auditor'
    || String(skill.audit?.version || '') !== skillAuditRuleVersion;
}

function stripSkillAuditFields(skill = {}) {
  if (!Number.isFinite(Number(skill.auditScore ?? skill.audit?.score ?? skill.auditScore90 ?? skill.score))) return skill;
  const next = { ...skill };
  delete next.auditScore;
  delete next.auditScore90;
  delete next.audit;
  delete next.score;
  return next;
}

async function readSkillAuditSourceText(scan = {}, skill = {}) {
  const candidates = [
    skill.path,
    skill.skillPath,
    skill.git?.relativePath && path.isAbsolute(String(skill.git?.relativePath)) ? skill.git.relativePath : '',
    skill.relativePath && path.isAbsolute(String(skill.relativePath)) ? skill.relativePath : '',
    scan.rootPath && skill.path && !path.isAbsolute(String(skill.path)) ? path.join(scan.rootPath, skill.path) : '',
    scan.rootPath && skill.relativePath && !path.isAbsolute(String(skill.relativePath)) ? path.join(scan.rootPath, skill.relativePath) : '',
    scan.rootPath && skill.git?.relativePath ? path.join(scan.rootPath, skill.git.relativePath) : ''
  ]
    .map(item => String(item || '').trim())
    .filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    if (!/\.md$/i.test(candidate)) continue;
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {}
  }
  return '';
}

function isSameSkillAuditScore(skill = {}, auditFields = {}) {
  return Number(skill.auditScore) === Number(auditFields.auditScore)
    && Number(skill.auditScore90) === Number(auditFields.auditScore90)
    && JSON.stringify(skill.audit || null) === JSON.stringify(auditFields.audit || null)
    && Number(skill.score) === Number(auditFields.score);
}

function mergeStableProjectScan(project = {}, previousScan = null, nextScan = {}) {
  const previousSkills = Array.isArray(previousScan?.skills) ? previousScan.skills : [];
  const nextSkills = Array.isArray(nextScan?.skills) ? nextScan.skills : [];
  if (previousSkills.length && !nextSkills.length && isPreservedOrFailedScan(nextScan)) {
    return {
      ...previousScan,
      ...nextScan,
      skills: previousSkills,
      tasks: previousScan.tasks || [],
      preserved: true,
      lastError: nextScan.error || nextScan.lastError || '本次刷新未读取到产物，已保留上次库存。',
      lastFailedAt: new Date().toISOString()
    };
  }
  if (!previousScan) return nextScan;
  return {
    ...previousScan,
    ...nextScan,
    skills: mergeStableScanSkills(previousSkills, nextSkills),
    tasks: Array.isArray(nextScan.tasks) && nextScan.tasks.length ? nextScan.tasks : (previousScan.tasks || [])
  };
}

function isPreservedOrFailedScan(scan = {}) {
  return scan?.preserved === true || Boolean(scan?.error || scan?.lastError);
}

function isLocalOrSharedScanSource(project = {}) {
  return ['local', 'shared'].includes(String(project.sourceType || '').toLowerCase());
}

function mergeStableScanSkills(previousSkills = [], nextSkills = []) {
  const previousByKey = new Map();
  for (const skill of Array.isArray(previousSkills) ? previousSkills : []) {
    const key = stableScanSkillKey(skill);
    if (key) previousByKey.set(key, skill);
  }
  const merged = [];
  for (const skill of Array.isArray(nextSkills) ? nextSkills : []) {
    const key = stableScanSkillKey(skill);
    if (!key) {
      merged.push({ ...skill, stale: false });
      continue;
    }
    const previous = previousByKey.get(key);
    if (previous && stableScanSkillFingerprint(previous) === stableScanSkillFingerprint(skill)) {
      merged.push({ ...previous, stale: false });
    } else {
      merged.push({ ...skill, stale: false });
    }
  }
  return merged.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')) || String(a.title || '').localeCompare(String(b.title || '')));
}

function stableScanSkillKey(skill = {}) {
  if (skill.inventoryKind === 'directory' || skill.fileProduct === true) {
    return String(skill.productFileName || skill.displayName || skill.title || '')
      .trim()
      .toLowerCase();
  }
  return String(skill.git?.relativePath || skill.relativePath || skill.path || skill.id || skill.title || '').trim();
}

function stableScanSkillFingerprint(skill = {}) {
  return [
    skill.git?.commit || '',
    skill.git?.uploadedAt || '',
    skill.commitSubject || '',
    skill.uploadedAt || '',
    skill.version || '',
    skill.hidden === true ? 'hidden' : 'visible',
    skill.displayHidden === true ? 'displayHidden' : 'displayVisible',
    skill.title || '',
    skill.productDisplayName || '',
    skill.productFileName || '',
    skill.description || '',
    String(skill.preview || '').slice(0, 2400),
    skill.auditScore ?? '',
    skill.audit?.score ?? ''
  ].join('\n');
}

async function cleanupRemovedScanSourceProductData(project = {}, previousScan = null, nextScan = {}, nextCache = {}) {
  const previousSkills = Array.isArray(previousScan?.skills) ? previousScan.skills : [];
  if (!previousSkills.length) return { removed: 0 };
  const nextKeys = new Set((Array.isArray(nextScan?.skills) ? nextScan.skills : []).map(stableScanSkillKey).filter(Boolean));
  const removedSkills = previousSkills.filter(skill => {
    const key = stableScanSkillKey(skill);
    return key && !nextKeys.has(key);
  });
  if (!removedSkills.length) return { removed: 0 };
  const overrideCleanup = await cleanupRemovedSkillVersionOverrides(project, removedSkills, nextCache);
  return {
    removed: removedSkills.length,
    overrides: overrideCleanup.removed || 0,
    usageCounters: 0
  };
}

async function cleanupRemovedSkillVersionOverrides(project = {}, removedSkills = [], nextCache = {}) {
  const overrides = await loadSkillVersionOverrides();
  const keys = Object.keys(overrides || {});
  if (!keys.length) return { removed: 0 };
  const projectId = String(project.id || '').trim();
  const removedKeys = new Set(removedSkills.flatMap(skill => skillOverrideCandidateKeys(skill)));
  const remainingKeys = collectScanOverrideCandidateKeys(nextCache);
  let removed = 0;
  for (const key of keys) {
    const record = overrides[key] || {};
    const scopedKey = scopedOverrideTargetKey(key, projectId);
    const recordKeys = skillOverrideCandidateKeys(record);
    const matchesRemoved = (scopedKey && removedKeys.has(scopedKey))
      || recordKeys.some(item => removedKeys.has(item));
    if (!matchesRemoved) continue;
    const scopedToProject = key.startsWith(`display:${projectId}:`)
      || key.startsWith(`owner:${projectId}:`)
      || key.startsWith(`alias:${projectId}:`)
      || key.startsWith(`kind:${projectId}:`)
      || String(record.projectId || '') === projectId;
    const canRemoveUnscoped = !scopedToProject
      && recordKeys.some(item => removedKeys.has(item) && !remainingKeys.has(item));
    if (!scopedToProject && !canRemoveUnscoped) continue;
    delete overrides[key];
    removed += 1;
  }
  if (removed) await writeSkillVersionOverrides(overrides);
  return { removed };
}

function scopedOverrideTargetKey(key = '', projectId = '') {
  const text = String(key || '').trim();
  const id = String(projectId || '').trim();
  if (!text || !id) return '';
  for (const prefix of [`display:${id}:`, `owner:${id}:`, `version:${id}:`]) {
    if (text.startsWith(prefix)) return text.slice(prefix.length);
  }
  return '';
}

function collectScanOverrideCandidateKeys(cache = {}) {
  const keys = new Set();
  for (const entry of Object.values(cache || {})) {
    const scan = entry?.scan || entry;
    for (const skill of Array.isArray(scan?.skills) ? scan.skills : []) {
      skillOverrideCandidateKeys(skill).forEach(key => keys.add(key));
    }
  }
  return keys;
}

function skillOverrideCandidateKeys(input = {}) {
  const values = [
    input.git?.relativePath,
    input.relativePath,
    input.path,
    input.uid,
    input.key,
    input.overrideKey
  ];
  const id = String(input.id || '').trim();
  if (id && !/^directory$/i.test(id)) values.push(id);
  return values
    .map(value => skillVersionOverrideKey({ relativePath: value }))
    .filter(value => value && value.length >= 2)
    .filter((value, index, array) => array.indexOf(value) === index);
}

function usageCounterKeyForScanProduct(value = '') {
  const text = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.(md|markdown)$/i, '')
    .toLowerCase()
    .replace(/[_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '') || '';
  if (!text || text.length < 3 || isGenericUsageCounterProductKey(text)) return '';
  return text;
}

function isGenericUsageCounterProductKey(value = '') {
  return /^(skill|skills|readme|agents|agent|memory|安装说明|安装包|同步器|上报器|执行|试用|文件本体|文档|工具|资源|图片|素材)$/i.test(String(value || '').trim());
}

function skillVersionOverrideKey(input = {}) {
  return String(input.relativePath || input.path || input.uid || input.id || '').trim();
}

function isGenericSkillVersionIdentity(value = '') {
  const text = String(value || '').trim();
  if (!text) return true;
  const fileName = path.basename(text.replace(/\\/g, '/'));
  return /^(SKILL|README)\.md$/i.test(fileName) || /^\.md$/i.test(fileName);
}

function skillVersionIdentityKey(input = {}) {
  const pathKey = String(input.relativePath || input.path || input.git?.relativePath || '').trim();
  if (pathKey) return pathKey;
  const uid = String(input.uid || '').trim();
  if (uid && !isGenericSkillVersionIdentity(uid)) return uid;
  const id = String(input.id || '').trim();
  if (id && !isGenericSkillVersionIdentity(id)) return id;
  return '';
}

function scopedSkillVersionOverrideKey(input = {}) {
  const projectId = String(input.projectId || '').trim();
  const key = skillVersionIdentityKey(input);
  if (!projectId || !key) return '';
  return `version:${projectId}:${key}`;
}

function scopedSkillOwnerOverrideKey(input = {}) {
  const projectId = String(input.projectId || '').trim();
  const key = skillVersionOverrideKey(input);
  if (!projectId || !key) return '';
  return `owner:${projectId}:${key}`;
}

function scopedSkillDisplayNameOverrideKey(input = {}) {
  const projectId = String(input.projectId || '').trim();
  const key = skillVersionOverrideKey(input);
  if (!projectId || !key) return '';
  return `name:${projectId}:${key}`;
}

function scopedSkillAliasOverrideKey(input = {}) {
  const projectId = String(input.projectId || '').trim();
  const key = skillVersionOverrideKey(input);
  if (!projectId || !key) return '';
  return `alias:${projectId}:${key}`;
}

function skillAliasOverrideKey(input = {}) {
  const scopedKey = scopedSkillAliasOverrideKey(input);
  if (scopedKey) return scopedKey;
  const key = skillVersionOverrideKey(input);
  const fileName = path.basename(String(key || '').replace(/\\/g, '/'));
  if (/^(SKILL|README)\.md$/i.test(fileName)) return '';
  return key;
}

function scopedSkillInventoryKindOverrideKey(input = {}) {
  const projectId = String(input.projectId || '').trim();
  const key = skillVersionOverrideKey(input);
  if (!projectId || !key) return '';
  return `kind:${projectId}:${key}`;
}

function hasSkillVersionOwnerChange(input = {}) {
  return Object.prototype.hasOwnProperty.call(input, 'owner')
    || Object.prototype.hasOwnProperty.call(input, 'uploader');
}

function hasSkillDisplayNameChange(input = {}) {
  return Object.prototype.hasOwnProperty.call(input, 'displayName')
    || Object.prototype.hasOwnProperty.call(input, 'commonName');
}

function hasSkillInventoryKindChange(input = {}) {
  return Object.prototype.hasOwnProperty.call(input, 'inventoryKind')
    || Object.prototype.hasOwnProperty.call(input, 'skillInventoryKind');
}

async function saveSkillVersionOverride(input = {}) {
  const ownerChange = hasSkillVersionOwnerChange(input);
  const displayNameChange = hasSkillDisplayNameChange(input);
  const inventoryKindChange = hasSkillInventoryKindChange(input);
  const allowVersion = input.allowVersion !== false;
  const allowAliases = input.allowAliases === true || input.aliases !== undefined;
  const scopedOwnerKey = ownerChange ? scopedSkillOwnerOverrideKey(input) : '';
  const scopedDisplayNameKey = displayNameChange ? scopedSkillDisplayNameOverrideKey(input) : '';
  const scopedInventoryKindKey = inventoryKindChange ? scopedSkillInventoryKindOverrideKey(input) : '';
  const versionChange = allowVersion && Object.prototype.hasOwnProperty.call(input, 'version');
  const scopedVersionKey = versionChange ? scopedSkillVersionOverrideKey(input) : '';
  const aliasOnlyChange = allowAliases && input.aliases !== undefined && !String(input.version || '').trim() && !ownerChange && !displayNameChange;
  const scopedAliasKey = aliasOnlyChange ? skillAliasOverrideKey(input) : '';
  const fallbackKey = versionChange ? skillVersionIdentityKey(input) : skillVersionOverrideKey(input);
  const key = scopedOwnerKey || scopedDisplayNameKey || scopedInventoryKindKey || scopedAliasKey || scopedVersionKey || fallbackKey;
  const version = String(input.version || '').trim();
  if (!key) throw statusError(400, '缺少产物路径，无法保存版本。');
  const owner = normalizePersonListText(input.owner || input.uploader || '');
  const aliases = allowAliases && input.aliases !== undefined ? normalizeSkillAliases(input.aliases) : null;
  const displayName = displayNameChange ? cleanText(input.displayName ?? input.commonName) : '';
  const inventoryKind = inventoryKindChange ? normalizeSkillInventoryKind(input.inventoryKind ?? input.skillInventoryKind) : '';
  if (inventoryKindChange && !inventoryKind) throw statusError(400, '请选择产物类型。');
  if (allowVersion && !version && !owner && aliases === null && !displayNameChange && !inventoryKindChange) throw statusError(400, '请填写版本、别名、归属人、常用名称或产物类型。');
  if (!allowVersion && aliases === null) throw statusError(400, '请填写调用别名。');
  const overrides = await loadSkillVersionOverrides();
  const previous = overrides[key] || {};
  const isVersionRecord = key.startsWith('version:');
  const aliasHistory = aliases === null
    ? mergeSkillAliasHistory(previous.aliasHistory, previous.aliases)
    : mergeSkillAliasHistory(previous.aliasHistory, previous.aliases, aliases);
  const record = {
    ...previous,
    key,
    id: String(input.id || '').trim(),
    projectId: String(input.projectId || previous.projectId || '').trim(),
    title: String(input.title || '').trim(),
    relativePath: String(input.relativePath || input.path || '').trim(),
    version: allowVersion ? (version || previous.version || '') : (previous.version || ''),
    aliases: isVersionRecord ? (previous.aliases || []) : (aliases === null ? (previous.aliases || []) : aliases),
    aliasHistory: isVersionRecord ? (previous.aliasHistory || []) : aliasHistory,
    owner: allowVersion ? (owner || previous.owner || '') : (previous.owner || ''),
    updatedAt: new Date().toISOString()
  };
  if (displayNameChange || Object.prototype.hasOwnProperty.call(previous, 'displayName') || Object.prototype.hasOwnProperty.call(previous, 'commonName')) {
    record.displayName = displayNameChange ? displayName : (previous.displayName || '');
    record.commonName = displayNameChange ? displayName : (previous.commonName || '');
  }
  if (inventoryKindChange || Object.prototype.hasOwnProperty.call(previous, 'inventoryKind')) {
    record.inventoryKind = inventoryKindChange ? inventoryKind : (previous.inventoryKind || '');
  }
  overrides[key] = record;
  const aliasMirrorKey = aliases !== null ? skillAliasOverrideKey(input) : '';
  if (aliasMirrorKey && aliasMirrorKey !== key) {
    const previousAlias = overrides[aliasMirrorKey] || {};
    overrides[aliasMirrorKey] = {
      ...previousAlias,
      key: aliasMirrorKey,
      id: record.id || previousAlias.id || '',
      projectId: record.projectId || previousAlias.projectId || '',
      title: record.title || previousAlias.title || '',
      relativePath: record.relativePath || previousAlias.relativePath || '',
      aliases,
      aliasHistory: mergeSkillAliasHistory(previousAlias.aliasHistory, previousAlias.aliases, aliasHistory, aliases),
      updatedAt: record.updatedAt
    };
  }
  await writeSkillVersionOverrides(overrides);
  return record;
}

function normalizeSkillInventoryKind(value = '') {
  const text = cleanText(value).toLowerCase();
  if (['skill', 'skills'].includes(text) || text === '技能') return 'skill';
  if (['document', 'doc', 'docs', 'standard', 'standards'].includes(text) || /规范|文档|标准/.test(text)) return 'document';
  if (['directory', 'folder', 'file-product', 'file_product'].includes(text) || /文件夹|目录|产物/.test(text)) return 'directory';
  return '';
}

async function saveSkillInventoryVisibilityOverride(input = {}, currentUser = {}) {
  const key = skillVersionOverrideKey(input);
  if (!key) throw statusError(400, '缺少产物路径，无法保存隐藏状态。');
  const hidden = input.hidden !== false;
  const overrides = await loadSkillVersionOverrides();
  const previous = overrides[key] || {};
  const now = new Date().toISOString();
  const userName = currentUser.displayName || currentUser.username || '';
  const record = {
    ...previous,
    key,
    id: String(input.id || previous.id || '').trim(),
    title: String(input.title || previous.title || '').trim(),
    relativePath: String(input.relativePath || input.path || previous.relativePath || '').trim(),
    hidden,
    hiddenAt: hidden ? now : '',
    hiddenBy: hidden ? userName : '',
    restoredAt: hidden ? (previous.restoredAt || '') : now,
    restoredBy: hidden ? (previous.restoredBy || '') : userName,
    updatedAt: now
  };
  overrides[key] = record;
  await writeSkillVersionOverrides(overrides);
  return record;
}

async function saveSkillInventoryDisplayVisibilityOverride(input = {}, currentUser = {}) {
  const key = skillDisplayVisibilityOverrideKey(input);
  if (!key) throw statusError(400, '缺少产物路径，无法保存展示状态。');
  const displayHidden = input.displayHidden === true || input.visible === false;
  const overrides = await loadSkillVersionOverrides();
  const previous = overrides[key] || {};
  const now = new Date().toISOString();
  const userName = currentUser.displayName || currentUser.username || '';
  const record = {
    ...previous,
    key,
    id: String(input.id || previous.id || '').trim(),
    projectId: String(input.projectId || previous.projectId || '').trim(),
    title: String(input.title || previous.title || '').trim(),
    relativePath: String(input.relativePath || input.path || previous.relativePath || '').trim(),
    sourceType: String(input.sourceType || previous.sourceType || '').trim(),
    displayHidden,
    displayHiddenAt: displayHidden ? now : '',
    displayHiddenBy: displayHidden ? userName : '',
    displayRestoredAt: displayHidden ? (previous.displayRestoredAt || '') : now,
    displayRestoredBy: displayHidden ? (previous.displayRestoredBy || '') : userName,
    updatedAt: now
  };
  overrides[key] = record;
  await writeSkillVersionOverrides(overrides);
  return record;
}

function skillDisplayVisibilityOverrideKey(input = {}) {
  const projectId = String(input.projectId || '').trim();
  const target = skillVersionOverrideKey(input);
  if (!target) return '';
  return projectId ? `display:${projectId}:${target}` : `display:${target}`;
}

function normalizeSkillAliases(value = []) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,，、\n\r]+/);
  const blocked = /^(skill|skills|md|markdown|codex|mcp|figma|git|ai|工具|技能|文档|流程|规范|验证|平台|资源|图片)$/i;
  const seen = new Set();
  const output = [];
  for (const item of raw) {
    const text = String(item || '').trim();
    if (!text || text.length < 2 || text.length > 80 || blocked.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output.slice(0, 12);
}

function normalizeSkillAliasHistory(value = []) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,，、\n\r]+/);
  const blocked = /^(skill|skills|md|markdown|codex|mcp|figma|git|ai|工具|技能|文档|流程|规范|验证|平台|资源|图片)$/i;
  const seen = new Set();
  const output = [];
  for (const item of raw) {
    const text = String(item || '').trim();
    if (!text || text.length < 2 || text.length > 80 || blocked.test(text)) continue;
    const key = usageCounterKeyForScanProduct(text) || text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output.slice(-80);
}

function mergeSkillAliasHistory(...values) {
  const merged = [];
  for (const value of values) {
    merged.push(...normalizeSkillAliasHistory(value));
  }
  return merged
    .filter((item, index, array) => array.findIndex(other => usageCounterKeyForScanProduct(other) === usageCounterKeyForScanProduct(item)) === index)
    .slice(-80);
}

async function applySkillVersionOverridesToScan(scan = {}) {
  const overrides = await loadSkillVersionOverrides();
  if (!Array.isArray(scan.skills) || !Object.keys(overrides).length) return scan;
  return {
    ...scan,
    skills: scan.skills.map(skill => {
      const key = skillVersionOverrideKey({
        relativePath: skill.git?.relativePath || '',
        path: skill.path || '',
        id: skill.id || ''
      });
      const versionKey = scopedSkillVersionOverrideKey({
        projectId: scan.projectId || '',
        relativePath: skill.git?.relativePath || skill.relativePath || '',
        path: skill.path || '',
        id: skill.id || ''
      });
      const displayKey = skillDisplayVisibilityOverrideKey({
        projectId: scan.projectId || '',
        relativePath: skill.git?.relativePath || skill.relativePath || '',
        path: skill.path || '',
        id: skill.id || ''
      });
      const ownerKey = scopedSkillOwnerOverrideKey({
        projectId: scan.projectId || '',
        relativePath: skill.git?.relativePath || skill.relativePath || '',
        path: skill.path || '',
        id: skill.id || ''
      });
      const displayNameKey = scopedSkillDisplayNameOverrideKey({
        projectId: scan.projectId || '',
        relativePath: skill.git?.relativePath || skill.relativePath || '',
        path: skill.path || '',
        id: skill.id || ''
      });
      const aliasKey = scopedSkillAliasOverrideKey({
        projectId: scan.projectId || '',
        relativePath: skill.git?.relativePath || skill.relativePath || '',
        path: skill.path || '',
        id: skill.id || ''
      });
      const inventoryKindKey = scopedSkillInventoryKindOverrideKey({
        projectId: scan.projectId || '',
        relativePath: skill.git?.relativePath || skill.relativePath || '',
        path: skill.path || '',
        id: skill.id || ''
      });
      const rawBaseOverride = overrides[key]
        || overrides[skill.relativePath]
        || overrides[skill.git?.relativePath]
        || overrides[skill.path]
        || overrides[skill.id];
      const baseOverride = rawBaseOverride || {};
      const versionOverride = overrides[versionKey]?.version ? overrides[versionKey] : (baseOverride?.version ? baseOverride : null);
      const aliasOverride = overrides[aliasKey] || null;
      const inventoryKindOverride = overrides[inventoryKindKey] || null;
      const ownerOverride = overrides[ownerKey]?.owner ? overrides[ownerKey] : null;
      const displayNameOverride = overrides[displayNameKey] || null;
      const displayOverride = overrides[displayKey];
      const legacyAliasOverride = !aliasKey && rawBaseOverride && Array.isArray(rawBaseOverride.aliases)
        ? rawBaseOverride
        : null;
      const hasVisibilityOverride = Object.prototype.hasOwnProperty.call(baseOverride, 'hidden');
      const hasDisplayVisibilityOverride = Object.prototype.hasOwnProperty.call(displayOverride || baseOverride || {}, 'displayHidden');
      const displayNameSource = displayNameOverride || {};
      const hasDisplayNameOverride = Object.prototype.hasOwnProperty.call(displayNameSource, 'displayName')
        || Object.prototype.hasOwnProperty.call(displayNameSource, 'commonName');
      const hasInventoryKindOverride = Object.prototype.hasOwnProperty.call(inventoryKindOverride || {}, 'inventoryKind')
        || Object.prototype.hasOwnProperty.call(baseOverride || {}, 'inventoryKind');
      const hasAliasHistoryOverride = Array.isArray(aliasOverride?.aliasHistory)
        || Array.isArray(legacyAliasOverride?.aliasHistory)
        || Array.isArray(baseOverride?.aliasHistory);
      const staleDisplayVersion = !versionOverride?.version && String(skill.displayVersionOverride || '').trim();
      if (!versionOverride?.version && !staleDisplayVersion && !Array.isArray(legacyAliasOverride?.aliases) && !Array.isArray(aliasOverride?.aliases) && !hasAliasHistoryOverride && !baseOverride?.owner && !ownerOverride?.owner && !hasVisibilityOverride && !hasDisplayVisibilityOverride && !hasDisplayNameOverride && !hasInventoryKindOverride) return skill;
      const hidden = hasVisibilityOverride ? baseOverride.hidden === true : skill.hidden === true;
      const displaySource = displayOverride || baseOverride || {};
      const displayHidden = hasDisplayVisibilityOverride ? displaySource.displayHidden === true : skill.displayHidden === true;
      const displayName = cleanText(displayNameSource.displayName ?? displayNameSource.commonName);
      const aliases = Array.isArray(aliasOverride?.aliases)
        ? aliasOverride.aliases
        : (Array.isArray(legacyAliasOverride?.aliases) ? legacyAliasOverride.aliases : skill.aliases);
      const manualAliases = Array.isArray(aliasOverride?.aliases)
        ? aliasOverride.aliases
        : (Array.isArray(legacyAliasOverride?.aliases) ? legacyAliasOverride.aliases : []);
      const aliasHistory = mergeSkillAliasHistory(
        skill.aliasHistory,
        skill.aliases,
        baseOverride.aliasHistory,
        legacyAliasOverride?.aliasHistory,
        legacyAliasOverride?.aliases,
        aliasOverride?.aliasHistory,
        aliasOverride?.aliases
      );
      return {
        ...skill,
        displayVersionOverride: versionOverride?.version || '',
        inventoryKind: hasInventoryKindOverride ? (inventoryKindOverride?.inventoryKind || baseOverride.inventoryKind || skill.inventoryKind) : skill.inventoryKind,
        inventoryKindOverride: hasInventoryKindOverride,
        aliases,
        manualAliases,
        aliasHistory,
        hasAliasOverride: manualAliases.length > 0,
        ownerOverride: ownerOverride?.owner || baseOverride.owner || '',
        productDisplayName: hasDisplayNameOverride ? (displayName || skill.productFileName || skill.productDisplayName) : skill.productDisplayName,
        displayName: hasDisplayNameOverride ? (displayName || skill.productFileName || skill.displayName) : skill.displayName,
        commonName: hasDisplayNameOverride ? displayName : skill.commonName,
        commonNameOverride: hasDisplayNameOverride,
        originalProductDisplayName: skill.originalProductDisplayName || skill.productDisplayName || '',
        hidden,
        hiddenAt: hidden ? (baseOverride.hiddenAt || '') : '',
        hiddenBy: hidden ? (baseOverride.hiddenBy || '') : '',
        restoredAt: baseOverride.restoredAt || '',
        restoredBy: baseOverride.restoredBy || '',
        displayHidden,
        displayHiddenAt: displayHidden ? (displaySource.displayHiddenAt || '') : '',
        displayHiddenBy: displayHidden ? (displaySource.displayHiddenBy || '') : '',
        displayRestoredAt: displaySource.displayRestoredAt || '',
        displayRestoredBy: displaySource.displayRestoredBy || ''
      };
    })
  };
}

async function fetchSkillValidationsFromGoogleSheet() {
  const spreadsheetId = defaultSkillValidationSheetId;
  const gid = defaultSkillValidationSheetGid;
  const startRow = defaultSkillValidationStartRow;
  const sheetSourceUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}`;
  const range = `A${startRow}:T200`;
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?tqx=out:json&gid=${encodeURIComponent(gid)}&range=${encodeURIComponent(range)}&headers=0`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`部门验证表读取失败：HTTP ${response.status}`);
  const raw = await response.text();
  const parsed = parseGoogleVisualizationResponse(raw);
  const fetchedRecords = (parsed.table?.rows || [])
    .map((row, index) => skillValidationRecordFromSheetRow(row, startRow + index, sheetSourceUrl))
    .filter(isSkillValidationRecord);
  const stored = await loadSkillValidationsFromFile();
  const storedSplit = splitStoredSkillValidationRecords(stored);
  const previousGoogleRecords = storedSplit.googleRecords;
  const googleRecords = mergeFetchedSkillValidationGoogleRecords(previousGoogleRecords, fetchedRecords);
  const googleIds = new Set(googleRecords.map(record => record.id || skillValidationRecordKey(record)).filter(Boolean));
  const manualRecords = storedSplit.manualRecords.filter(record => {
    const id = record?.id || skillValidationRecordKey(record);
    return !googleIds.has(id);
  });
  const result = skillValidationSummary({
    ...stored,
    sourceName: '部门验证表（实时）',
    spreadsheetId,
    gid,
    sheetSourceUrl,
    startRow,
    importedAt: stored.importedAt || new Date().toISOString(),
    lastRefreshedAt: new Date().toISOString(),
    records: mergeSkillValidationRecords(googleRecords, manualRecords),
    googleRecords,
    manualRecords,
    sourcePath: skillValidationsPath
  });
  await writeSkillValidations(result);
  return result;
}

function parseGoogleVisualizationResponse(raw = '') {
  const match = String(raw || '').match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error('部门验证表返回格式不正确。');
  return JSON.parse(match[1]);
}

function skillValidationRecordFromSheetRow(row = {}, rowNumber = 0, sourceUrl = '') {
  const cells = Array.from({ length: 20 }, (_, index) => googleCellValue(row.c?.[index]));
  const [
    submittedAt,
    validator,
    sourceRef,
    owner,
    researchName,
    artifactType,
    artifactName,
    artifactLocation,
    workflowScene,
    validationTask,
    selfCreated,
    inputMaterial,
    evidenceLink,
    validationResult,
    manualChange,
    timeEstimate,
    issues,
    suggestion,
    reuseAdvice,
    notes
  ] = cells;
  return {
    id: `skill-validation-row-${rowNumber}`,
    rowNumber,
    submittedAt,
    validator: normalizeSkillValidationPerson(validator),
    sourceRef,
    owner: normalizeSkillValidationPerson(owner),
    researchName,
    artifactType,
    artifactName,
    artifactLocation,
    workflowScene,
    validationTask,
    selfCreated,
    inputMaterial,
    evidenceLink,
    validationResult,
    manualChange,
    timeEstimate,
    issues,
    suggestion,
    reuseAdvice,
    notes,
    scope: artifactName || researchName || sourceRef,
    status: normalizeSkillValidationStatus(validationResult),
    deliverableReady: /可直接复用|建议.*复用/.test(`${validationResult} ${reuseAdvice}`),
    walkthroughOwner: normalizeSkillValidationPerson(validator),
    walkthroughDone: Boolean(validationResult && !/待评估|待判断|待记录|待填写/.test(validationResult)),
    zentaoTaskUrl: /^https?:\/\//i.test(validationTask) ? validationTask : '',
    source: 'Google Sheet',
    sourceUrl,
    importedAt: new Date().toISOString()
  };
}

function googleCellValue(cell = {}) {
  if (!cell || cell.v === null || cell.v === undefined) return '';
  return String(cell.f || cell.v || '').trim();
}

function normalizeSkillValidationStatus(value = '') {
  const text = String(value || '').trim();
  if (!text) return '待确认';
  if (/可直接复用/.test(text)) return '可直接复用';
  if (/部分可用/.test(text)) return '部分可用需修改';
  if (/不可用/.test(text)) return '不可用需重做';
  if (/资料不完整/.test(text)) return '资料不完整';
  if (/场景不匹配/.test(text)) return '场景不匹配';
  return text;
}

function isSkillValidationRecord(record = {}) {
  const text = [
    record.scope,
    record.submittedAt,
    record.validator,
    record.sourceRef,
    record.researchName,
    record.artifactName,
    record.validationResult,
    record.walkthroughOwner,
    record.owner,
    record.status,
    record.zentaoTaskUrl,
    record.evidenceLink,
    record.notes
  ].join(' ').trim();
  if (!text) return false;
  if (record.source === '工作台人工回填') return true;
  const placeholderFields = [
    record.submittedAt,
    record.sourceRef,
    record.researchName,
    record.artifactType,
    record.artifactName,
    record.artifactLocation,
    record.workflowScene,
    record.validationTask,
    record.inputMaterial,
    record.evidenceLink,
    record.validationResult
  ].join(' ').trim();
  if (/待填写|示例：|示例链接|example/i.test(placeholderFields)) return false;
  return Boolean(record.scope || record.status || record.deliverableReady || record.walkthroughDone || record.zentaoTaskUrl || record.evidenceLink || record.notes);
}

function filterSkillValidationResponse(payload = {}) {
  const records = Array.isArray(payload.records)
    ? payload.records.filter(record => !isDistributedConfigValidationRecord(record))
    : [];
  const googleRecords = Array.isArray(payload.googleRecords)
    ? payload.googleRecords.filter(record => !isDistributedConfigValidationRecord(record))
    : [];
  const manualRecords = Array.isArray(payload.manualRecords)
    ? payload.manualRecords.filter(record => record?.deleted === true || !isDistributedConfigValidationRecord(record))
    : [];
  return {
    ...payload,
    records,
    googleRecords,
    manualRecords,
    total: records.length,
    completedCount: records.filter(record => record.status === '已完成').length,
    deliverableCount: records.filter(record => record.deliverableReady).length,
    walkthroughDoneCount: records.filter(record => record.walkthroughDone).length
  };
}


async function loadAiAssetSheet(options = {}) {
  const fallback = {
    sourceName: '人工研究清单（实时）',
    spreadsheetId: defaultAiAssetSheetId,
    gid: defaultAiAssetSheetGid,
    sheetSourceUrl: `https://docs.google.com/spreadsheets/d/${defaultAiAssetSheetId}/edit?gid=${defaultAiAssetSheetGid}#gid=${defaultAiAssetSheetGid}`,
    startRow: defaultAiAssetStartRow,
    importedAt: '',
    rows: []
  };
  const live = await fetchAiAssetSheetFromGoogle().catch(error => ({ error: error.message || String(error) }));
  if (live && !live.error) return mergeAiAssetOverrides(live, options);
  try {
    const raw = await fs.readFile(aiAssetSheetPath, 'utf8');
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed.rows) ? parsed.rows.filter(isAiAssetSheetRow) : [];
    return mergeAiAssetOverrides(aiAssetSheetSummary({ ...fallback, ...parsed, ...(live?.error ? { lastError: live.error } : {}), rows }), options);
  } catch (error) {
    if (error.code === 'ENOENT') return mergeAiAssetOverrides(aiAssetSheetSummary({ ...fallback, lastError: live?.error || '', sourcePath: aiAssetSheetPath }), options);
    throw error;
  }
}

async function fetchAiAssetSheetFromGoogle() {
  const spreadsheetId = defaultAiAssetSheetId;
  const gid = defaultAiAssetSheetGid;
  const startRow = defaultAiAssetStartRow;
  const sheetSourceUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}`;
  const range = `A${startRow}:T300`;
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?tqx=out:json&gid=${encodeURIComponent(gid)}&range=${encodeURIComponent(range)}&headers=0`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`人工研究清单读取失败：HTTP ${response.status}`);
  const raw = await response.text();
  const parsed = parseGoogleVisualizationResponse(raw);
  const rows = (parsed.table?.rows || [])
    .map((row, index) => aiAssetSheetRowFromGoogle(row, startRow + index, sheetSourceUrl))
    .filter(isAiAssetSheetRow);
  const result = aiAssetSheetSummary({
    sourceName: '人工研究清单（实时）',
    spreadsheetId,
    gid,
    sheetSourceUrl,
    startRow,
    importedAt: new Date().toISOString(),
    rows,
    sourcePath: aiAssetSheetPath
  });
  await fs.mkdir(path.dirname(aiAssetSheetPath), { recursive: true });
  await fs.writeFile(aiAssetSheetPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function aiAssetSheetRowFromGoogle(row = {}, rowNumber = 0, sourceUrl = '') {
  const cells = Array.from({ length: 20 }, (_, index) => googleCellValue(row.c?.[index]));
  const [_unused, title, suites, owner, progressStatus, dailyNote, plannedDoneAt, finalPath, projectName, verifyStatus, availablePeople, publicStatus, crossCount, accuracy, description, unpublishedReason, skillPath, flowOwner, fileLink, templateNote] = cells;
  return {
    id: `ai-asset-row-${rowNumber}`,
    rowNumber,
    title: cleanText(title),
    suites: cleanText(suites),
    owner: normalizeSkillValidationPerson(owner),
    progressStatus: cleanText(progressStatus),
    dailyNote: cleanText(dailyNote),
    plannedDoneAt: cleanText(plannedDoneAt),
    finalPath: cleanText(finalPath),
    projectName: cleanText(projectName),
    verifyStatus: cleanText(verifyStatus),
    availablePeople: cleanText(availablePeople),
    publicStatus: cleanText(publicStatus),
    crossCount: cleanText(crossCount),
    accuracy: cleanText(accuracy),
    description: cleanText(description),
    unpublishedReason: cleanText(unpublishedReason),
    skillPath: cleanText(skillPath),
    flowOwner: normalizeSkillValidationPerson(flowOwner),
    fileLink: cleanText(fileLink),
    templateNote: cleanText(templateNote),
    source: 'Google Sheet',
    sourceUrl,
    importedAt: new Date().toISOString()
  };
}

function isAiAssetSheetRow(row = {}) {
  const text = [row.title, row.owner, row.progressStatus, row.finalPath, row.projectName, row.verifyStatus, row.fileLink].join(' ').trim();
  if (!text) return false;
  if (/主要在做什么|进度状态|产物目录|模板|表头/i.test(text)) return false;
  return Boolean(row.title || row.finalPath || row.projectName || row.fileLink);
}


async function loadAiAssetOverrides() {
  try {
    const raw = await fs.readFile(aiAssetOverridesPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { rows: [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { rows: [] };
    throw error;
  }
}

async function writeAiAssetOverrides(payload = {}) {
  await fs.mkdir(path.dirname(aiAssetOverridesPath), { recursive: true });
  await fs.writeFile(aiAssetOverridesPath, `${JSON.stringify({ rows: payload.rows || [] }, null, 2)}\n`);
}

async function mergeAiAssetOverrides(payload = {}, options = {}) {
  const overrides = await loadAiAssetOverrides();
  const overrideRows = Array.isArray(overrides.rows) ? overrides.rows : [];
  const deletedIds = new Set(overrideRows.filter(row => row.deleted === true).map(row => row.id).filter(Boolean));
  const byId = new Map((payload.rows || []).filter(row => !deletedIds.has(row.id)).map(row => [row.id, row]));
  for (const row of overrideRows) {
    if (!row.id || row.deleted === true) continue;
    byId.set(row.id, { ...(byId.get(row.id) || {}), ...row, source: row.source || '工作台本地覆盖' });
  }
  const deletedRows = options.includeDeleted
    ? overrideRows.filter(row => row.deleted === true).map(row => ({ ...row, source: row.source || '工作台隐藏记录' }))
    : [];
  return aiAssetSheetSummary({ ...payload, rows: [...byId.values(), ...deletedRows], overrides: overrideRows });
}

function normalizeAiAssetOverride(input = {}, currentUser = {}) {
  const id = cleanText(input.id) || `ai-asset-manual-${Date.now()}`;
  return {
    ...input,
    id,
    rowNumber: Number(input.rowNumber || 0),
    title: cleanText(input.title),
    suites: cleanText(input.suites),
    owner: normalizePersonListText(input.owner),
    progressStatus: cleanText(input.progressStatus),
    dailyNote: cleanText(input.dailyNote),
    plannedDoneAt: cleanText(input.plannedDoneAt),
    finalPath: cleanText(input.finalPath),
    projectName: cleanText(input.projectName),
    verifyStatus: cleanText(input.verifyStatus),
    availablePeople: cleanText(input.availablePeople),
    publicStatus: cleanText(input.publicStatus),
    crossCount: cleanText(input.crossCount),
    accuracy: cleanText(input.accuracy),
    description: cleanText(input.description),
    unpublishedReason: cleanText(input.unpublishedReason),
    skillPath: cleanText(input.skillPath),
    flowOwner: normalizePersonListText(input.flowOwner),
    fileLink: cleanText(input.fileLink),
    templateNote: cleanText(input.templateNote),
    source: '工作台本地覆盖',
    sourceUrl: cleanText(input.sourceUrl),
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser.displayName || currentUser.username || ''
  };
}

function canEditAiAssetRow(row = {}, currentUser = {}) {
  if (currentUser.role === 'admin') return true;
  const names = [currentUser.displayName, currentUser.username, currentUser.name, currentUser.realname, currentUser.account].filter(Boolean);
  const rowPeople = [
    ...splitPersonList(row.owner),
    ...splitPersonList(row.flowOwner)
  ];
  return names.some(name => rowPeople.some(person => samePersonName(name, person)));
}

function canRestoreAiAssetRow(row = {}, currentUser = {}) {
  if (canEditAiAssetRow(row, currentUser)) return true;
  return Array.isArray(currentUser.permissions) && currentUser.permissions.includes('skill.asset.void');
}

function samePersonName(left = '', right = '') {
  const a = normalizePersonLoose(left);
  const b = normalizePersonLoose(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function normalizePersonLoose(value = '') {
  return String(value || '').toLowerCase().replace(/[\s._@-]+/g, '').replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

async function saveAiAssetOverride(input = {}, currentUser = {}) {
  const sheet = await loadAiAssetSheet();
  const existing = (sheet.rows || []).find(row => row.id === input.id) || input;
  const guardedInput = canManageSkillAssetOwner(currentUser)
    ? input
    : { ...input, owner: existing?.id ? existing.owner || '' : '' };
  const nextRow = normalizeAiAssetOverride({ ...existing, ...guardedInput }, currentUser);
  if (!canEditAiAssetRow(existing, currentUser) && !canEditAiAssetRow(nextRow, currentUser)) throw new HttpError(403, '只能修改自己名下的人工研究记录。');
  const overrides = await loadAiAssetOverrides();
  const rows = Array.isArray(overrides.rows) ? overrides.rows.filter(row => row.id !== nextRow.id) : [];
  rows.push(nextRow);
  await writeAiAssetOverrides({ rows });
  const result = await loadAiAssetSheet();
  return { ...result, savedRow: nextRow };
}

async function deleteAiAssetOverride(id = '', currentUser = {}) {
  const targetId = cleanText(decodeURIComponent(id));
  if (!targetId) throw new HttpError(400, '缺少人工研究记录标识。');
  const sheet = await loadAiAssetSheet();
  const existing = (sheet.rows || []).find(row => row.id === targetId);
  if (!existing) throw new HttpError(404, '人工研究记录不存在。');
  if (!canEditAiAssetRow(existing, currentUser)) throw new HttpError(403, '只能隐藏自己名下的人工研究记录。');
  const overrides = await loadAiAssetOverrides();
  const rows = Array.isArray(overrides.rows) ? overrides.rows.filter(row => row.id !== targetId) : [];
  rows.push({ ...existing, id: targetId, deleted: true, deletedAt: new Date().toISOString(), deletedBy: currentUser.displayName || currentUser.username || '' });
  await writeAiAssetOverrides({ rows });
  const result = await loadAiAssetSheet();
  return { ...result, deletedRow: existing };
}

async function restoreAiAssetOverride(id = '', currentUser = {}) {
  const targetId = cleanText(decodeURIComponent(id));
  if (!targetId) throw new HttpError(400, '缺少人工研究记录标识。');
  const sheet = await loadAiAssetSheet({ includeDeleted: true });
  const existing = (sheet.rows || []).find(row => row.id === targetId);
  if (!existing) throw new HttpError(404, '人工研究记录不存在。');
  if (!canRestoreAiAssetRow(existing, currentUser)) throw new HttpError(403, '只能恢复自己名下的人工研究记录。');
  const overrides = await loadAiAssetOverrides();
  const rows = Array.isArray(overrides.rows) ? overrides.rows.filter(row => row.id !== targetId) : [];
  await writeAiAssetOverrides({ rows });
  const result = await loadAiAssetSheet({ includeDeleted: true });
  return { ...result, restoredRow: { ...existing, deleted: false } };
}

function aiAssetSheetSummary(payload = {}) {
  const rows = Array.isArray(payload.rows) ? payload.rows.filter(isAiAssetSheetRow) : [];
  return {
    ...payload,
    rows,
    total: rows.length,
    publicCount: rows.filter(row => /是|可公开|公用/i.test(row.publicStatus)).length,
    verifiedCount: rows.filter(row => /已验证|1\/1|0\.8|1$/.test(`${row.verifyStatus} ${row.accuracy}`)).length,
    skillPathCount: rows.filter(row => row.skillPath || /skill/i.test(row.title)).length,
    sourcePath: payload.sourcePath || aiAssetSheetPath
  };
}

async function authenticateArtProgressReporter(req) {
  const supplied = req.headers['x-art-event-key'] || req.headers['x-workbench-event-key'] || '';
  const expected = await getArtProgressEventKey();
  if (!expected || supplied !== expected) return null;
  return {
    id: 'art-progress-reporter',
    username: 'art-progress-reporter',
    displayName: '研究同步助手',
    role: 'developer',
    projectIds: ['*'],
    permissions: []
  };
}

async function getArtProgressEventKey() {
  if (process.env.ART_WORKBENCH_EVENT_KEY) return process.env.ART_WORKBENCH_EVENT_KEY;
  try {
    const raw = await fs.readFile(artProgressEventKeyPath, 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed.key || '').trim();
  } catch {
    return '';
  }
}

function artProgressValidationMetadata(event = {}) {
  return event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata : {};
}

function compactValidationTextParts(parts = []) {
  return parts.map(value => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    }
    return String(value);
  }).map(value => value.trim()).filter(Boolean);
}

function artProgressValidationHaystack(event = {}) {
  const metadata = artProgressValidationMetadata(event);
  return compactValidationTextParts([
    event.eventType,
    event.title,
    event.stage,
    event.summary,
    event.skillId,
    event.skillName,
    event.repoPath,
    event.projectName,
    event.zentaoTaskId,
    event.taskNo,
    metadata.validationResult,
    metadata.validationStatus,
    metadata.reuseAdvice,
    metadata.manualChange,
    metadata.timeEstimate,
    metadata.issues,
    metadata.suggestion,
    metadata.notes,
    metadata.artifactName,
    metadata.fileName,
    metadata.skillName,
    metadata.artifactPath,
    metadata.artifactLocation,
    metadata.skillPath,
    metadata.finalPath,
    metadata.path,
    metadata.filePath,
    metadata.evidenceLink,
    metadata.workflowScene,
    metadata.inputMaterial,
    ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : []),
    ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : []),
    ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts.flatMap(item => [item?.id, item?.name, item?.path, item?.alias, item?.type]) : []),
    ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts.flatMap(item => [item?.id, item?.name, item?.path, item?.alias, item?.type]) : [])
  ]).join('\n');
}

function isAppliedArtifactValidationText(text = '') {
  const normalized = String(text || '');
  if (isSkillCreationDraftText(normalized)) return false;
  const usesArtifact = /(用|使用|基于|按照).{0,80}(\.md|SKILL\.md|skill|规范|文档|沉淀).{0,160}(帮我|进行|应用|验证|重命名|重新命名|改名|处理|检查|生成|修改)/i.test(normalized)
    || /(\.md|SKILL\.md|skill|规范|文档|沉淀).{0,160}(Figma|figma|node-id|界面|页面|真实任务|web\d|cocos|重命名|重新命名|改名)/i.test(normalized);
  const hasExecutionEvidence = /已完成|完成了|已按|结果|校验|检查|写入|未做任何修改|调用 Figma|Figma MCP|use_figma|重命名[:：]/i.test(normalized);
  return usesArtifact && hasExecutionEvidence;
}

function isSkillCreationDraftText(text = '') {
  const normalized = String(text || '');
  const asksToCreateSkill = /(帮我|给我|写|生成|创建|新增|整理|提炼).{0,40}(一条)?\s*skill\.md/i.test(normalized)
    || /(写成|做成|生成|创建|新增|整理成|提炼成).{0,60}(SKILL\.md|skill\s*说明|独立技能|技能说明)/i.test(normalized)
    || /(触发语覆盖|frontmatter|技能规范|技能发现规则|可发现的英文副本|无需调用插件也能按同样规范)/i.test(normalized);
  const appliesExistingArtifact = /(用|使用|基于|按照).{0,80}(已有|现有|清单|资源|规范|文档|沉淀).{0,160}(验证|验收|实任务|重命名|处理|检查|修改|应用)/i.test(normalized);
  return asksToCreateSkill && !appliesExistingArtifact;
}

function isDistributedConfigValidationText(text = '') {
  const normalized = String(text || '').replace(/\s+/g, '');
  if (!normalized) return false;
  return /(?:Codex|CodeX)?(?:全局|生图|本地)?前置(?:设置|配置)(?:\(\d+\))?(?:\.md)?/i.test(normalized)
    || /(?:Codex|CodeX)生图本地前置配置通用指南/i.test(normalized)
    || /(?:Codex|CodeX)?(?:全局|生图|本地)?前置(?:设置|配置).{0,24}(?:配置文件|配置文档|分发|安装|设置)/i.test(normalized);
}

function isDistributedConfigValidationRecord(record = {}) {
  const text = compactValidationTextParts([
    record.researchName,
    record.artifactName,
    record.artifactLocation,
    record.workflowScene,
    record.validationResult,
    record.reuseAdvice,
    record.notes,
    record.scope,
    record.sourceRef
  ]).join('\n');
  return isDistributedConfigValidationText(text);
}

function isGenericCodexOperationForValidation(event = {}) {
  const text = artProgressValidationHaystack(event);
  return isSkillCreationDraftText(text)
    || isDistributedConfigValidationText(text)
    || !hasConcreteValidationArtifactSignal(event)
    || (/Codex 使用记录补传|记录日期：|会话：|codex session|sessionId|操作记录|对话记录|environment_context|AGENTS\.md instructions/i.test(text)
    && !/验证结果|验证回填|验收结果|可直接复用|部分可用|不可用需重做|资料不完整|场景不匹配|建议部门内复用|建议小范围复用/i.test(text)
    && !isAppliedArtifactValidationText(text));
}

function extractFirstValidationMatch(text = '', patterns = []) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return cleanText(match[1]).replace(/[。；;，,、]+$/g, '');
  }
  return '';
}

function inferValidationResultFromText(text = '') {
  const normalized = String(text || '');
  const explicit = extractFirstValidationMatch(normalized, [
    /(?:验证结果|验收结果|验证结论|结论)[:：]\s*([^\n。；;]+)/i,
    /(?:结果为|结论为)[:：]?\s*([^\n。；;]+)/i
  ]);
  if (explicit) return explicit;
  if (/可直接复用|通过验证|验证通过|测试通过|验收通过/i.test(normalized)) return '可直接复用';
  if (/部分可用|需修改|需要修改|少量修改|中等修改/i.test(normalized)) return '部分可用需修改';
  if (/不可用需重做|不可用|验证失败|测试失败|无法复用/i.test(normalized)) return '不可用需重做';
  if (/资料不完整|材料不完整|缺少资料|缺少材料/i.test(normalized)) return '资料不完整';
  if (/场景不匹配|不适配当前场景/i.test(normalized)) return '场景不匹配暂不判断';
  return '';
}

function inferArtifactTypeFromValidation(event = {}) {
  const metadata = artProgressValidationMetadata(event);
  const text = artProgressValidationHaystack(event);
  const explicit = cleanText(metadata.artifactType || metadata.type);
  if (explicit) return explicit;
  if (/SKILL\.md|skillPath|\bskill\b|技能/i.test(text)) return 'skill';
  if (/\.md\b|markdown/i.test(text)) return 'md';
  if (/figma/i.test(text)) return 'figma';
  if (/脚本|script|\.mjs\b|\.js\b|\.py\b/i.test(text)) return '脚本';
  return '待判断';
}

function firstCleanValidationValue(values = []) {
  return compactValidationTextParts(values).find(value => !isGenericValidationArtifactValue(value)) || '';
}

function firstConcreteValidationArtifactValue(values = []) {
  return compactValidationTextParts(values).find(value => isConcreteValidationArtifactValue(value)) || '';
}

function preferredValidationArtifactCandidate(event = {}) {
  const metadata = artProgressValidationMetadata(event);
  const haystack = artProgressValidationHaystack(event);
  const directPaths = [
    metadata.artifactLocation,
    metadata.artifactPath,
    metadata.finalPath,
    metadata.skillPath,
    metadata.path,
    metadata.filePath,
    event.repoPath,
    ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : []),
    ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts.flatMap(item => [item?.path]) : []),
    ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts.flatMap(item => [item?.path]) : []),
    extractArtifactPathFromValidationText(haystack)
  ];
  const directNames = [
    metadata.artifactName,
    metadata.fileName,
    metadata.skillName,
    event.skillName,
    ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : []),
    ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts.flatMap(item => [item?.name, item?.id, item?.alias]) : []),
    ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts.flatMap(item => [item?.name, item?.id, item?.alias]) : []),
    extractArtifactNameFromValidationText(haystack),
    event.title
  ];
  const location = preferredConcreteValidationArtifactValue(directPaths)
    || preferredConcreteValidationArtifactValue(directNames);
  return {
    location,
    name: validationArtifactDisplayName(location) || preferredConcreteValidationArtifactValue(directNames)
  };
}

function preferredConcreteValidationArtifactValue(values = []) {
  const candidates = compactValidationTextParts(values)
    .map(value => cleanText(value).replace(/\\/g, '/').replace(/^[#\[]+|[\]]+$/g, '').trim())
    .filter(value => isConcreteValidationArtifactValue(value));
  if (!candidates.length) return '';
  return candidates.find(value => /(^|\/)SKILL\.md(?:$|[?#])/i.test(value))
    || candidates.find(value => /(^|\/)skills?\//i.test(value))
    || candidates.find(value => /\.(md|markdown|txt|js|mjs|py)$/i.test(value) && !/(^|\/)(?:AGENTS|README|MEMORY)\.md$/i.test(value))
    || candidates[0];
}

function validationArtifactDisplayName(value = '') {
  const text = cleanText(value).replace(/\\/g, '/').replace(/[?#].*$/, '');
  if (!text) return '';
  const parts = text.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || text;
  if (/^SKILL\.md$/i.test(last) && parts.length > 1) return parts[parts.length - 2];
  if (/^(AGENTS|README|MEMORY)\.md$/i.test(last) && parts.length <= 1) return '';
  return last.replace(/\.(md|markdown)$/i, '');
}

function extractArtifactPathFromValidationText(text = '') {
  const normalized = String(text || '');
  const pathMatch = normalized.match(/((?:[A-Z]:\\|\\\\)[^\n`<>"'，。；;]+?\.(?:md|markdown|txt|js|mjs|py))/i);
  return cleanText(pathMatch?.[1] || '').replace(/帮我.*$/i, '');
}

function extractArtifactNameFromValidationText(text = '') {
  const pathValue = extractArtifactPathFromValidationText(text);
  if (pathValue) return path.basename(pathValue);
  const mdMatch = String(text || '').match(/([^\\\/\n`<>"'，。；;]+?\.(?:md|markdown|txt|js|mjs|py))/i);
  if (mdMatch?.[1]) return cleanText(mdMatch[1]);
  const namedDoc = String(text || '').match(/([\u4e00-\u9fa5A-Za-z0-9_-]{2,30}(?:规范|文档|沉淀|Skill|skill))/);
  return cleanText(namedDoc?.[1] || '');
}

function inferAppliedValidationResult(text = '') {
  if (!isAppliedArtifactValidationText(text)) return '';
  if (/已完成|完成了|已按|重命名[:：]|校验/i.test(String(text || ''))) return '已完成实任务验证，待人工确认';
  return '实任务验证中，待人工确认';
}

function hasConcreteValidationArtifactSignal(event = {}) {
  const metadata = artProgressValidationMetadata(event);
  const values = compactValidationTextParts([
    metadata.artifactName,
    metadata.fileName,
    metadata.skillName,
    metadata.artifactPath,
    metadata.artifactLocation,
    metadata.skillPath,
    metadata.finalPath,
    metadata.path,
    metadata.filePath,
    event.skillName,
    event.repoPath,
    ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : []),
    ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : []),
    ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts.flatMap(item => [item?.name, item?.path, item?.alias]) : []),
    ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts.flatMap(item => [item?.name, item?.path, item?.alias]) : [])
  ]);
  return values.some(value => {
    return isConcreteValidationArtifactValue(value);
  });
}

function isConcreteValidationArtifactValue(value = '') {
  const text = String(value || '').replace(/\\/g, '/').replace(/^[#\[]+|[\]]+$/g, '').trim();
  if (!text || isGenericValidationArtifactValue(text)) return false;
  if (/(^|\/)(?:SKILL|README|AGENTS|MEMORY)\.md$/i.test(text)) {
    const parts = text.split('/').filter(Boolean);
    const parent = parts.length > 1 ? parts[parts.length - 2] : '';
    return Boolean(parent && !isGenericValidationArtifactValue(parent));
  }
  if (/\.(md|markdown|txt|js|mjs|py)$/i.test(text)) return true;
  const normalized = normalizeValidationArtifactToken(text);
  return normalized.length >= 4 && !isGenericValidationArtifactValue(normalized);
}

function isGenericValidationArtifactValue(value = '') {
  const normalized = normalizeValidationArtifactToken(value);
  return !normalized
    || /^[0-9a-f]{32}$/i.test(normalized)
    || /^(skill|skills|md|markdown|readme|agents|agent|memory|references|reference|文档|说明|规范|流程|工具|技能|试用|执行|文件|内容执行|快照执行|已读取|untitledtask)$/i.test(normalized);
}

function normalizeValidationArtifactToken(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.(md|markdown)$/i, '')
    .replace(/^[#\[]+|[\]]+$/g, '')
    .replace(/[_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '')
    .toLowerCase() || '';
}

function buildSkillValidationDraftFromArtProgress(event = {}) {
  if (!event?.id || isGenericCodexOperationForValidation(event)) return null;
  const metadata = artProgressValidationMetadata(event);
  const haystack = artProgressValidationHaystack(event);
  const appliedArtifactValidation = isAppliedArtifactValidationText(haystack);
  const hasValidationSignal = /验证|验收|验证回填|验证结果|验收结果|复用建议|可直接复用|部分可用|不可用需重做|资料不完整|场景不匹配|测试通过|测试失败|建议部门内复用|建议小范围复用/i.test(haystack)
    || (hasConcreteValidationArtifactSignal(event) && /通过|可用|复用|完成|结果|结论|反馈|问题|建议/i.test(haystack))
    || appliedArtifactValidation;
  if (!hasValidationSignal) return null;
  const validationResult = cleanText(metadata.validationResult || metadata.validationStatus || metadata.result) || inferValidationResultFromText(haystack) || inferAppliedValidationResult(haystack);
  const reuseAdvice = cleanText(metadata.reuseAdvice || metadata.reuse || extractFirstValidationMatch(haystack, [/(?:复用建议|是否建议部门内复用)[:：]\s*([^\n。；;]+)/i]));
  if (!validationResult && !reuseAdvice && !/验证回填|待验证|已验证|进行验证|完成验证|验收/i.test(haystack)) return null;
  const preferredArtifact = preferredValidationArtifactCandidate(event);
  const artifactLocation = preferredArtifact.location || firstConcreteValidationArtifactValue([
    metadata.artifactLocation,
    metadata.artifactPath,
    metadata.finalPath,
    metadata.skillPath,
    metadata.path,
    metadata.filePath,
    event.repoPath,
    extractArtifactPathFromValidationText(haystack)
  ]);
  const artifactName = preferredArtifact.name || firstConcreteValidationArtifactValue([
    metadata.artifactName,
    metadata.fileName,
    metadata.skillName,
    ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : []),
    ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts.flatMap(item => [item?.name, item?.path, item?.alias]) : []),
    ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts.flatMap(item => [item?.name, item?.path, item?.alias]) : []),
    extractArtifactNameFromValidationText(haystack),
    event.skillName,
    event.title,
    artifactLocation ? path.basename(artifactLocation) : ''
  ]);
  const validator = normalizeSkillValidationPerson(metadata.validator || event.memberName || event.memberAccount);
  const notesPrefix = 'Codex 验证自动回填';
  const notes = firstCleanValidationValue([metadata.notes, event.summary]);
  return {
    id: `skill-validation-from-art-progress-${event.id}`,
    submittedAt: event.createdAt || new Date().toISOString(),
    validator,
    sourceRef: event.id,
    owner: normalizeSkillValidationPerson(metadata.owner || metadata.creator || event.memberName || event.memberAccount),
    researchName: firstCleanValidationValue([metadata.researchName, event.skillName, event.stage, event.projectName]),
    artifactType: inferArtifactTypeFromValidation(event),
    artifactName: artifactName || firstCleanValidationValue([event.summary, event.stage]),
    artifactLocation,
    workflowScene: firstCleanValidationValue([metadata.workflowScene, metadata.scene, event.projectName, appliedArtifactValidation ? 'Codex 实任务验证' : '']),
    validationTask: firstCleanValidationValue([metadata.validationTask, metadata.zentaoTaskUrl, event.zentaoTaskId, event.taskNo]),
    selfCreated: firstCleanValidationValue([metadata.selfCreated]) || '',
    inputMaterial: firstCleanValidationValue([metadata.inputMaterial, metadata.input, metadata.material]),
    evidenceLink: firstCleanValidationValue([metadata.evidenceLink, metadata.evidence, metadata.outputLink]),
    validationResult: validationResult || '待确认',
    manualChange: cleanText(metadata.manualChange || extractFirstValidationMatch(haystack, [/(?:人工修改量|手动修改量|修改量)[:：]\s*([^\n。；;]+)/i])),
    timeEstimate: cleanText(metadata.timeEstimate || metadata.timeChange || extractFirstValidationMatch(haystack, [/(?:节省时间|增加时间|时间估算|耗时)[:：]\s*([^\n。；;]+)/i])),
    issues: cleanText(metadata.issues || metadata.problem || extractFirstValidationMatch(haystack, [/(?:问题|验证问题|改进点)[:：]\s*([^\n]+)/i])),
    suggestion: cleanText(metadata.suggestion || metadata.advice || extractFirstValidationMatch(haystack, [/(?:建议怎么改|修改建议)[:：]\s*([^\n]+)/i])),
    reuseAdvice: reuseAdvice || (/建议部门内复用/i.test(haystack) ? '建议部门内复用' : (/建议小范围复用/i.test(haystack) ? '建议小范围复用' : '')),
    notes: notes ? `${notesPrefix}：${notes}` : notesPrefix,
    source: notesPrefix,
    sourceUrl: cleanText(metadata.sourceUrl || metadata.url),
    importedAt: new Date().toISOString()
  };
}

async function maybeCreateSkillValidationFromArtProgress(event = {}, user = {}) {
  const metadata = artProgressValidationMetadata(event);
  if (metadata.skipValidationAutoBackfill === true || metadata.source === 'operation-log-display' || metadata.displaySource === 'operation-log-display') return null;
  const draft = buildSkillValidationDraftFromArtProgress(event);
  if (!draft) return null;
  const result = await saveSkillValidationRecord(draft, user, { skipOwnerGuard: true });
  const targetName = skillValidationOperationTargetName(result.savedRecord);
  await createOperationLog({
    user,
    module: 'skill-validation',
    action: 'AUTO_UPSERT_SKILL_VALIDATION',
    actionName: '自动回填验证',
    targetType: 'skill-validation',
    targetId: result.savedRecord?.id || '',
    targetName,
    after: result.savedRecord,
    description: `${result.savedRecord?.validator || user.displayName || user.username || '成员'} 的 Codex 验证内容已自动回填到验证列表「${targetName}」`
  });
  return result.savedRecord ? { ...result.savedRecord, usagePatch: result.usagePatch || { matched: 0 } } : null;
}

async function saveArtProgressEvent(input = {}, user = {}, source = 'api') {
  const run = input.runId ? await getRun(String(input.runId)).catch(() => null) : null;
  const task = run?.taskId ? await getTask(run.taskId).catch(() => null) : null;
  const project = (input.projectId || run?.projectId) ? await getProject(input.projectId || run.projectId).catch(() => null) : null;
  const classified = classifyArtProgressEventInput({
    ...input,
    title: input.title || run?.title || task?.title || '',
    projectName: input.projectName || project?.name || ''
  });
  const event = await createArtProgressEvent({
    ...input,
    ...classified,
    runId: input.runId || run?.id || '',
    projectId: input.projectId || run?.projectId || task?.projectId || '',
    projectName: input.projectName || project?.name || '',
    taskId: input.taskId || run?.taskId || task?.id || '',
    taskNo: input.taskNo || input.zentaoTaskId || run?.zentaoId || task?.taskNo || '',
    zentaoTaskId: input.zentaoTaskId || input.zentaoId || run?.zentaoId || task?.taskNo || '',
    title: classified.title || input.title || run?.title || task?.title || '',
    memberAccount: normalizeArtMemberAccount(input.memberAccount, input.memberName) || user.username || '',
    memberName: normalizeArtMemberName(input.memberName || user.displayName || user.username, input.memberAccount || user.username),
    source
  });
  await recordUsageCountersForArtProgressEvent(event);
  await createOperationLog({
    user,
    module: 'art-progress',
    action: 'REPORT_ART_PROGRESS',
    actionName: '同步研究沉淀',
    targetType: 'art-progress-event',
    targetId: event.id,
    targetName: event.title || event.summary,
    description: `${normalizeArtMemberName(event.memberName, event.memberAccount) || '外部脚本'} 同步 ${event.eventType}：${event.summary}`,
    after: event
  });
  return event;
}

async function editArtProgressEvent(id = '', input = {}, user = {}) {
  const before = (await listArtProgressEvents({})).find(event => event.id === id);
  const classified = classifyArtProgressEventInput(input, { preserveManualType: true });
  const event = await updateArtProgressEvent(id, {
    eventType: classified.eventType,
    title: classified.title,
    memberAccount: normalizeArtMemberAccount(input.memberAccount, input.memberName),
    memberName: normalizeArtMemberName(input.memberName, input.memberAccount),
    skillId: input.skillId,
    skillName: classified.skillName,
    stage: classified.stage,
    status: classified.status,
    summary: classified.summary,
    repoPath: input.repoPath,
    projectName: input.projectName,
    zentaoTaskId: input.zentaoTaskId,
    taskNo: input.taskNo,
    metadata: input.metadata
  });
  if (!event) return null;
  await createOperationLog({
    user,
    module: 'art-progress',
    action: 'UPDATE_ART_PROGRESS',
    actionName: '修改研究同步',
    targetType: 'art-progress-event',
    targetId: event.id,
    targetName: event.title || event.summary,
    description: `修改研究同步：${event.title || event.stage || event.summary || event.id}`,
    before,
    after: event
  });
  return event;
}

async function removeArtProgressEvent(id = '', user = {}) {
  const event = await deleteArtProgressEvent(id);
  if (!event) return null;
  await createOperationLog({
    user,
    module: 'art-progress',
    action: 'DELETE_ART_PROGRESS',
    actionName: '删除研究同步',
    targetType: 'art-progress-event',
    targetId: event.id,
    targetName: event.title || event.summary,
    description: `删除研究同步：${event.title || event.stage || event.summary || event.id}`,
    before: event
  });
  return event;
}

async function listVisibleArtProgressEvents(user, filters = {}) {
  const visibleEvents = await listRawVisibleArtProgressEvents(user, filters);
  return projectArtProgressEventsForResponse(visibleEvents, filters);
}

async function listRawVisibleArtProgressEvents(user, filters = {}) {
  const events = await listArtProgressEvents(filters);
  if (canSeeAllArtProgress(user, filters)) return events;
  const account = String(user?.username || '');
  const name = normalizeArtMemberName(user?.displayName || '', account);
  return events.filter(event => event.memberAccount === account || normalizeArtMemberName(event.memberName, event.memberAccount) === name);
}

function projectArtProgressEventsForResponse(events = [], filters = {}) {
  const pageSize = Math.max(1, Math.min(1000, Number(filters.pageSize || filters.limit || 200) || 200));
  const page = Math.max(1, Number(filters.page || 1) || 1);
  const start = filters.all === '1' ? 0 : (page - 1) * pageSize;
  const end = filters.all === '1' ? events.length : start + pageSize;
  const sliced = events.slice(start, end);
  if (filters.full === '1') return sliced;
  return sliced.map(compactArtProgressEventForList);
}

function compactArtProgressEventForList(event = {}) {
  const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata : {};
  const compactArtifacts = value => (Array.isArray(value) ? value : [])
    .slice(0, 12)
    .map(item => ({
      id: cleanText(item?.id),
      name: cleanText(item?.name || item?.alias),
      path: cleanText(item?.path)
    }))
    .filter(item => item.id || item.name || item.path);
  return {
    ...event,
    title: truncateText(event.title, 240),
    summary: truncateText(event.summary, 1000),
    metadata: {
      source: cleanText(metadata.source),
      displaySource: cleanText(metadata.displaySource),
      path: cleanText(metadata.path),
      filePath: cleanText(metadata.filePath),
      finalPath: cleanText(metadata.finalPath),
      skillPath: cleanText(metadata.skillPath),
      artifactPath: cleanText(metadata.artifactPath),
      artifactLocation: cleanText(metadata.artifactLocation),
      artifactName: cleanText(metadata.artifactName),
      skillName: cleanText(metadata.skillName),
      validationResult: cleanText(metadata.validationResult || metadata.validationStatus || metadata.result),
      reuseAdvice: cleanText(metadata.reuseAdvice || metadata.reuse),
      calledArtifacts: compactArtifacts(metadata.calledArtifacts),
      matchedArtifacts: compactArtifacts(metadata.matchedArtifacts),
      artifactNames: Array.isArray(metadata.artifactNames) ? metadata.artifactNames.map(cleanText).filter(Boolean).slice(0, 12) : [],
      artifactPaths: Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths.map(cleanText).filter(Boolean).slice(0, 12) : []
    }
  };
}

function truncateText(value = '', max = 1000) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function buildArtProgressSummary(user, filters = {}) {
  const events = await listRawVisibleArtProgressEvents(user, filters);
  const researchEvents = events.filter(event => !isReporterLifecycleEvent(event));
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = events.filter(event => String(event.createdAt || '').slice(0, 10) === today);
  return {
    total: researchEvents.length,
    today: todayEvents.filter(event => !isReporterLifecycleEvent(event)).length,
    running: researchEvents.filter(event => event.status === 'running').length,
    blocked: researchEvents.filter(event => event.status === 'blocked' || event.eventType === 'task_blocked' || event.eventType === 'research_blocked').length,
    failed: researchEvents.filter(event => event.status === 'failed' || event.eventType === 'task_failed').length,
    completed: researchEvents.filter(event => event.status === 'completed' || event.eventType === 'task_completed' || event.eventType === 'research_finding' || event.eventType === 'research_summary' || event.eventType === 'research_artifact').length,
    byMember: aggregateArtEvents(researchEvents.map(event => ({ ...event, memberName: normalizeArtMemberName(event.memberName, event.memberAccount) })), 'memberName', 'memberAccount'),
    bySkill: aggregateArtEvents(researchEvents, 'skillName', 'skillId'),
    recent: events.slice(0, 20)
  };
}

function isReporterLifecycleEvent(event = {}) {
  return ['reporter_installed', 'reporter_test'].includes(classifyArtProgressEventInput(event).eventType);
}

function classifyArtProgressEventInput(input = {}, options = {}) {
  const currentType = String(input.eventType || '').trim();
  const title = normalizeArtProgressBusinessText(input.title || '');
  const stage = normalizeArtProgressBusinessText(input.stage || '');
  const summary = normalizeArtProgressBusinessText(input.summary || '');
  const skillName = normalizeArtProgressBusinessText(input.skillName || input.skillId || '');
  const haystack = [currentType, title, stage, summary, skillName, input.skillId, input.projectName].map(value => String(value || '')).join('\n');
  let eventType = currentType || 'research_progress';

  if (/安装测试|install-test|研究沉淀同步测试成功|Research sync install test succeeded|Art progress reporter test succeeded/i.test(haystack)) {
    eventType = 'reporter_test';
  } else if (/安装完成|install-completed|install-complete|research-sync-install|Art progress reporter install|已完成研究沉淀同步安装|completed research sync installation|completed art progress reporter installation/i.test(haystack)) {
    eventType = 'reporter_installed';
  } else if (/卡住|卡点|阻塞|缺少|待补|补充材料|样例不足|无法继续|blocked/i.test(haystack)) {
    eventType = 'research_blocked';
  } else if (/产物|输出文件|生成了|完成了|沉淀文档|规范文档|脚本|页面|截图|链接|交付物|artifact|deliverable/i.test(haystack)) {
    eventType = 'research_artifact';
  } else if (/结论|总结|规则|规律|适用|不适用|边界|反例|复用建议|阶段总结|summary|finding/i.test(haystack)) {
    eventType = /总结|summary/i.test(haystack) ? 'research_summary' : 'research_finding';
  } else if (/工具|skill|mcp|脚本|试用|调用|使用|tool/i.test(haystack)) {
    eventType = 'tool_used';
  } else if (/开始|启动|准备研究|研究方向|started/i.test(haystack)) {
    eventType = 'research_started';
  } else if (!options.preserveManualType || !currentType || /^task_|skill_called$/.test(currentType)) {
    eventType = 'research_progress';
  }

  return {
    eventType,
    title,
    stage,
    summary,
    skillName,
    status: statusForClassifiedArtEventType(eventType, input.status)
  };
}

function normalizeArtProgressBusinessText(value = '') {
  const text = String(value || '').trim();
  const map = {
    'art-progress-reporter': '美术工作台研究沉淀同步',
    'install-test': '安装测试',
    'install-completed': '安装完成',
    'install-complete': '安装完成',
    'research-sync-install': '研究沉淀同步安装',
    'Art progress reporter install': '研究沉淀同步安装',
    'Research sync install test succeeded.': '研究沉淀同步测试成功。',
    'Art progress reporter test succeeded.': '研究沉淀同步测试成功。',
    'AI research': 'AI 研究',
    'Sync one AI research or tool usage note to art workbench.': '同步一次 AI 研究或工具使用经验到美术工作台。'
  };
  if (map[text]) return map[text];
  const installMatch = text.match(/^(.+?) completed (?:research sync|art progress reporter) installation\.$/i);
  if (installMatch) return `${installMatch[1]} 已完成研究沉淀同步安装。`;
  return text;
}

function statusForClassifiedArtEventType(eventType = '', fallback = '') {
  if (eventType === 'reporter_installed' || eventType === 'reporter_test') return 'connected';
  if (eventType === 'research_blocked') return 'blocked';
  if (eventType === 'research_finding' || eventType === 'research_summary' || eventType === 'research_artifact') return 'completed';
  if (eventType === 'task_failed') return 'failed';
  return fallback && fallback !== 'connected' ? String(fallback).trim() : 'running';
}

function normalizeArtMemberName(name = '', account = '') {
  const raw = String(name || '').trim();
  const accountText = String(account || '').trim();
  const known = findDefaultArtUser(raw) || findDefaultArtUser(accountText);
  if (known?.realname) return known.realname;
  const chinese = raw.match(/[\u4e00-\u9fa5]{2,4}/);
  if (chinese) return chinese[0];
  return raw || accountText;
}

function normalizeArtMemberAccount(account = '', name = '') {
  const raw = String(account || '').trim();
  const known = findDefaultArtUser(raw) || findDefaultArtUser(name);
  return known?.account || raw;
}

function findDefaultArtUser(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  return defaultArtUsers.find(user => {
    const account = String(user.account || '').toLowerCase();
    const realname = String(user.realname || '').toLowerCase();
    return text === account || text === realname || text.includes(account) || text.includes(realname);
  }) || null;
}

function aggregateArtEvents(events = [], labelKey, fallbackKey) {
  const map = new Map();
  for (const event of events) {
    const label = String(event[labelKey] || event[fallbackKey] || '未标记').trim();
    const row = map.get(label) || { label, count: 0, blocked: 0, failed: 0, completed: 0 };
    row.count += 1;
    if (event.status === 'blocked' || event.eventType === 'task_blocked' || event.eventType === 'research_blocked') row.blocked += 1;
    if (event.status === 'failed' || event.eventType === 'task_failed') row.failed += 1;
    if (event.status === 'completed' || event.eventType === 'task_completed' || event.eventType === 'research_finding' || event.eventType === 'research_summary' || event.eventType === 'research_artifact') row.completed += 1;
    map.set(label, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 20);
}

function canSeeAllArtProgress(user = {}, filters = {}) {
  if (filters.scope === 'log') {
    return user.role === 'admin'
      || hasPermission(user, 'artProgress.operationLogs.view')
      || hasPermission(user, 'artProgress.accessLogs.view')
      || hasPermission(user, 'artProgress.logs.manage');
  }
  if (user.role === 'admin' || user.role === 'developer' || (user.projectIds || []).includes('*')) return true;
  return false;
}

function artProjectSheetRow(headers = [], row = [], rowNumber = 0) {
  const valueAt = index => String(row[index] || '').trim();
  const extra = {};
  headers.forEach((header, index) => {
    if (!header) return;
    extra[header] = valueAt(index);
  });
  return {
    id: `art-project-sheet-${rowNumber}`,
    rowNumber,
    file: valueAt(0),
    devLink: valueAt(1),
    viewLink: valueAt(2),
    pcPreviewLink: valueAt(3),
    wapPreviewLink: valueAt(4),
    owner: valueAt(6),
    figmaName: valueAt(7),
    remark: valueAt(10) || valueAt(9) || '',
    extra
  };
}

function normalizeArtProjectSheetOverride(input = {}) {
  const now = new Date().toISOString();
  const id = String(input.id || `manual-${crypto.randomUUID()}`).trim();
  const extra = input.extra && typeof input.extra === 'object' && !Array.isArray(input.extra)
    ? Object.fromEntries(Object.entries(input.extra).map(([key, value]) => [String(key || '').trim(), String(value || '').trim()]).filter(([key]) => key))
    : {};
  return {
    id,
    rowNumber: Number(input.rowNumber || 0),
    file: String(input.file || '').trim(),
    devLink: String(input.devLink || '').trim(),
    viewLink: String(input.viewLink || '').trim(),
    pcPreviewLink: String(input.pcPreviewLink || '').trim(),
    wapPreviewLink: String(input.wapPreviewLink || '').trim(),
    owner: String(input.owner || '').trim(),
    figmaName: String(input.figmaName || '').trim(),
    remark: String(input.remark || '').trim(),
    source: String(input.source || '').trim() || 'manual',
    deleted: input.deleted === true,
    extra,
    createdAt: String(input.createdAt || '').trim() || now,
    updatedAt: String(input.updatedAt || '').trim() || now
  };
}

function parseCsv(raw = '') {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some(value => String(value || '').trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some(value => String(value || '').trim())) rows.push(row);
  return rows;
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  return normalizeClientIp(forwarded || realIp || req.socket?.remoteAddress || '');
}

function normalizeClientIp(value = '') {
  const ip = String(value || '').trim();
  if (!ip) return '';
  if (ip === '::1') return '127.0.0.1';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

async function serveZentaoFileProxy(res, rawUrl = '') {
  const target = normalizeZentaoFileProxyUrl(rawUrl);
  if (!target) {
    sendJson(res, 400, { error: '无效的禅道图片地址。' });
    return;
  }
  const api = await getZentaoApi();
  const cookies = await getZentaoActionClassicCookies(api);
  const response = await fetch(target, {
    headers: {
      Cookie: cookies,
      Referer: normalizeZentaoSiteBaseUrl(api.baseUrl || zentaoBaseUrl)
    },
    redirect: 'follow'
  });
  if (!response.ok) {
    sendJson(res, response.status === 404 ? 404 : 502, { error: `禅道图片读取失败：HTTP ${response.status}` });
    return;
  }
  const contentType = response.headers.get('content-type') || mimeType(new URL(target).pathname);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=300'
  });
  res.end(buffer);
}

function normalizeZentaoFileProxyUrl(rawUrl = '') {
  const text = String(rawUrl || '').trim();
  if (!text || /^(?:javascript|data):/i.test(text)) return '';
  try {
    const base = normalizeZentaoSiteBaseUrl(zentaoBaseUrl);
    const target = new URL(text, `${base}/`);
    const allowed = new URL(base);
    if (target.origin !== allowed.origin) return '';
    const value = target.toString();
    if (!/(?:[?&]m=file(?:&|$)|\/data\/upload\/|\/file-read-|[?&]f=read(?:&|$))/i.test(value)) return '';
    return value;
  } catch {
    return '';
  }
}

async function serveArtifact(res, file, currentUser, options = {}) {
  if (!file) {
    sendJson(res, 400, { error: 'path is required' });
    return;
  }
  requireAuth(currentUser);
  const abs = resolveArtifactRequestPath(file);
  if (!abs) {
    sendJson(res, 403, { error: 'artifact path is outside platform workspace' });
    return;
  }
  const runs = await listRuns();
  const matchedRun = runs.find(run => {
    const roots = [
      run.artifactRoot,
      run.logPath,
      run.promptPath,
      run.materialPath,
      run.id ? path.join(paths.workspaceDir, run.id, 'run.log') : ''
    ].filter(Boolean);
    return roots.some(root => isPathInside(abs, root));
  });
  if (matchedRun) {
    await requireRunViewAccess(currentUser, matchedRun);
  } else if (!isPathInside(abs, zentaoArtBriefOutDir)) {
    sendJson(res, 403, { error: 'artifact path is not linked to an accessible run' });
    return;
  } else {
    requireAnyPermission(currentUser, ['menu.tasks', 'api.taskArtBrief.generate']);
  }
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    sendJson(res, 404, { error: '文件不存在，请重新生成美术摘要。', code: 'ENOENT', details: { path: abs } });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { error: '目标不是可打开的文件，请重新生成美术摘要。', code: 'ENOTFILE', details: { path: abs } });
    return;
  }
  if (options.head) {
    res.writeHead(200, { 'Content-Type': mimeType(abs), 'Content-Length': stat.size });
    res.end();
    return;
  }
  const content = await fs.readFile(abs);
  const headers = { 'Content-Type': mimeType(abs) };
  if (options.download) {
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(safeDownloadFilename(options.download))}`;
  }
  res.writeHead(200, headers);
  res.end(content);
}

function safeDownloadFilename(value = '') {
  return String(value || '')
    .replace(/[\\/\r\n]/g, '-')
    .trim()
    .slice(0, 180) || 'download';
}

async function serveRunLog(res, file, currentUser, options = {}) {
  if (!file) {
    sendJson(res, 400, { error: 'path is required' });
    return;
  }
  requireAuth(currentUser);
  const abs = resolveWorkspaceRequestPath(file);
  if (!abs) {
    sendJson(res, 403, { error: 'run log path is outside platform workspace' });
    return;
  }
  const runs = await listRuns();
  const matchedRun = runs.find(run => {
    const roots = [run.logPath, run.id ? path.join(paths.workspaceDir, run.id, 'run.log') : ''].filter(Boolean);
    return roots.some(root => isPathInside(abs, root));
  });
  if (!matchedRun) {
    sendJson(res, 403, { error: 'run log path is not linked to an accessible run' });
    return;
  }
  await requireRunViewAccess(currentUser, matchedRun);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    if (options.run && shouldReturnRunLogDiagnostic(options.run)) {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Run-Log-Bytes': '0',
        'X-Run-Log-Diagnostic': '1'
      });
      res.end(buildRunLogDiagnostic(options.run));
      return;
    }
    sendJson(res, 404, { error: '日志文件不存在。', code: 'ENOENT' });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { error: '日志路径不是文件。', code: 'ENOTFILE' });
    return;
  }
  const tailBytes = Math.max(0, Number(options.tailBytes || defaultRunLogTailBytes));
  const start = tailBytes > 0 && stat.size > tailBytes ? stat.size - tailBytes : 0;
  const handle = await fs.open(abs, 'r');
  try {
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, start);
    const prefix = start > 0
      ? `...已省略前半段原始日志，仅返回最近 ${formatBytes(length)}。完整日志仍保存在服务器 run.log。\n`
      : '';
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Run-Log-Bytes': String(stat.size),
      'X-Run-Log-Returned-Bytes': String(length),
      'X-Run-Log-Truncated': start > 0 ? '1' : '0'
    });
    res.end(prefix + buffer.toString('utf8'));
  } finally {
    await handle.close();
  }
}

function shouldReturnRunLogDiagnostic(run = {}) {
  const status = `${run.status || ''} ${run.workerStatus || ''} ${run.resultSummary?.status || ''}`.toLowerCase();
  return /blocked|failed|running|claimed|in_progress/.test(status);
}

function buildRunLogDiagnostic(run = {}) {
  const status = `${run.status || ''}${run.workerStatus ? ` / ${run.workerStatus}` : ''}`.trim() || '未知';
  const blockerReason = run.resultSummary?.blockerReason || run.blocker?.reason || '';
  return [
    '[platform] 未找到服务端 run.log。',
    `执行记录：${run.title || run.id || '未命名'}`,
    `当前状态：${status}`,
    `领取设备：${run.claimedByDeviceId || '未领取'}`,
    `领取时间：${run.claimedAt || '无'}`,
    `开始时间：${run.startedAt || '无'}`,
    `最近状态回传：${run.updatedAt || '无'}`,
    run.workerLocalLogPath ? `执行人本机日志路径：${run.workerLocalLogPath}` : '执行人本机日志路径：未回传',
    blockerReason ? `阻塞原因：${blockerReason}` : '',
    '',
    '说明：这代表平台没有收到 Codex stdout/stderr 或 Worker 补传的日志内容，不能按“已真实执行完成”判断。'
  ].filter(Boolean).join('\n');
}

async function serveRunFilePreview(res, project, file, version = 'current') {
  if (!file) {
    sendJson(res, 400, { error: 'file is required' });
    return;
  }
  if (!project?.rootPath) {
    sendJson(res, 400, { error: 'project rootPath is missing' });
    return;
  }
  const root = path.resolve(project.rootPath);
  let relativeFile = normalizeGitPath(file).replaceAll('\\', '/').replace(/^\/+/, '');
  const abs = resolveInsideRoot(root, relativeFile);
  if (!abs) {
    sendJson(res, 400, { error: 'file is outside project root' });
    return;
  }
  relativeFile = path.relative(root, abs).replaceAll('\\', '/');
  try {
    const content = version === 'head'
      ? await gitHeadFileBuffer(root, relativeFile)
      : await fs.readFile(abs);
    res.writeHead(200, { 'Content-Type': mimeType(relativeFile) });
    res.end(content);
  } catch (error) {
    sendJson(res, 404, { error: error.message || 'file preview not found' });
  }
}

async function serveProjectFilePreview(res, project, file) {
  if (!file) {
    sendJson(res, 400, { error: 'file is required' });
    return;
  }
  if (!project?.rootPath) {
    sendJson(res, 400, { error: 'project rootPath is missing' });
    return;
  }
  const root = path.resolve(project.rootPath);
  let relativeFile = normalizeGitPath(file).replaceAll('\\', '/').replace(/^\/+/, '');
  const abs = resolveInsideRoot(root, relativeFile);
  if (!abs) {
    sendJson(res, 400, { error: 'file is outside project root' });
    return;
  }
  relativeFile = path.relative(root, abs).replaceAll('\\', '/');
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      sendJson(res, 404, { error: 'target is not a file' });
      return;
    }
    const content = await fs.readFile(abs);
    res.writeHead(200, { 'Content-Type': mimeType(relativeFile) });
    res.end(content);
  } catch (error) {
    sendJson(res, 404, { error: error.message || 'file preview not found' });
  }
}

async function listRunsWithExpandedChanges() {
  const runs = await listRuns();
  const projects = await listProjects();
  const projectMap = new Map(projects.map(project => [project.id, project]));
  return Promise.all(runs.map(async run => {
    const project = projectMap.get(run.projectId);
    if (!project?.rootPath || !run.changeSummary) return run;
    return {
      ...run,
      changeSummary: await expandChangeSummaryDirectories(project.rootPath, run.changeSummary)
    };
  }));
}

async function listVisibleRunsForUser(user = {}) {
  const runs = await listRunsWithExpandedChanges();
  const projects = await listProjects();
  const activeProjectIds = new Set(projects.map(project => String(project.id || '').trim()).filter(Boolean));
  return runs.filter(run => canAccessRunRecord(user, run, activeProjectIds));
}

function canAccessRunRecord(user = {}, run = {}, activeProjectIds = new Set()) {
  if (!user || !run) return false;
  const projectId = String(run.projectId || '').trim();
  const isOrphanRun = Boolean(projectId && !activeProjectIds.has(projectId));
  if (!isOrphanRun && canAccessProject(user, run.projectId)) return true;
  if (!isOrphanRun || (!hasPermission(user, 'menu.runs') && !hasPermission(user, 'menu.aiArchive'))) return false;
  if (user.role === 'admin') return true;
  const userId = String(user.id || '').trim();
  return [
    run.createdBy,
    run.ownerUserId,
    run.assignedToUserId,
    run.startedBy,
    run.queuedForUserId
  ].map(value => String(value || '').trim()).filter(Boolean).includes(userId);
}

async function requireRunViewAccess(user = {}, run = {}) {
  const activeProjectIds = new Set((await listProjects()).map(project => String(project.id || '').trim()).filter(Boolean));
  if (!canAccessRunRecord(user, run, activeProjectIds)) {
    throw new HttpError(403, '当前账号没有该执行记录权限。');
  }
  return user;
}

async function requireRunDeleteAccess(user = {}, run = {}) {
  requirePermission(user, 'api.runs.delete');
  const activeProjectIds = new Set((await listProjects()).map(project => String(project.id || '').trim()).filter(Boolean));
  if (!canAccessRunRecord(user, run, activeProjectIds)) {
    throw new HttpError(403, '当前账号没有该执行记录权限。');
  }
  return user;
}

async function expandChangeSummaryDirectories(rootPath, summary) {
  const expandList = async (items, changeCategory = '') => {
    const expanded = [];
    for (const item of items || []) {
      const relativePath = normalizeGitPath(item?.path || '');
      const normalizedItem = changeCategory && !item?.changeCategory ? { ...item, changeCategory } : item;
      if (item?.status === '??' && relativePath.endsWith('/')) {
        const abs = resolveInsideRoot(rootPath, relativePath);
        if (!abs) {
          expanded.push(normalizedItem);
          continue;
        }
        const stat = await fs.stat(abs).catch(() => null);
        if (stat?.isDirectory()) {
          const files = await listDirectoryPreview(abs, relativePath);
          expanded.push(...files.map(file => ({ ...normalizedItem, path: file, parentPath: relativePath })));
          continue;
        }
      }
      expanded.push(normalizedItem);
    }
    return expanded;
  };

  const after = await expandList(summary.after);
  const before = await expandList(summary.before);
  const added = await expandList(summary.added, 'added');
  const changed = await expandList(summary.changed, 'changed');
  const removed = await expandList(summary.removed, 'removed');
  return { ...summary, before, after, added, changed, removed };
}

async function getRunFileDiff(project, run, file) {
  if (!file) throw new Error('file is required');
  const root = path.resolve(project.rootPath);
  let relativeFile = normalizeGitPath(file).replaceAll('\\', '/').replace(/^\/+/, '');
  const abs = resolveInsideRoot(root, relativeFile);
  if (!abs) {
    throw new Error('file is outside project root');
  }
  relativeFile = path.relative(root, abs).replaceAll('\\', '/');

  const statusFromRun = run?.changeSummary?.after?.find(item => normalizeGitPath(item?.path || '') === relativeFile)?.status || '';
  const status = await gitStatusForFile(root, relativeFile);
  const effectiveStatus = status || statusFromRun;
  const runDiff = await runLogFileDiff(run, relativeFile);
  if (runDiff && isTextPreviewFile(relativeFile)) {
    const parsed = parseGitFileDiff(runDiff);
    return {
      file: relativeFile,
      status: effectiveStatus,
      mode: 'diff',
      content: runDiff,
      oldContent: parsed.oldContent,
      newContent: parsed.newContent,
      changeType: parsed.changeType
    };
  }

  const isUntracked = effectiveStatus.includes('??');
  const isDeleted = /\bD\b/.test(effectiveStatus) || effectiveStatus.includes('D');
  const ext = path.extname(relativeFile).toLowerCase();
  const currentStat = await fs.stat(abs).catch(() => null);
  const imagePreview = buildImageDiffPreview(relativeFile, currentStat, effectiveStatus, { isDeleted, isUntracked });
  if (imagePreview) return imagePreview;

  if (isUntracked) {
    if (currentStat?.isDirectory()) {
      const files = await listDirectoryPreview(abs, relativeFile);
      return {
        file: relativeFile,
        status: effectiveStatus,
        mode: 'directory',
        content: files.length ? files.join('\n') : '目录为空或没有可预览文件。',
        oldContent: '',
        newContent: files.join('\n')
      };
    }
    const binaryPreview = buildBinaryDiffPreview(relativeFile, currentStat, effectiveStatus, ext);
    if (binaryPreview) return binaryPreview;

    const newContent = await readTextPreview(abs);
    return {
      file: relativeFile,
      status: effectiveStatus,
      mode: 'diff',
      content: newContent,
      oldContent: '',
      newContent,
      changeType: 'added'
    };
  }

  if (isDeleted) {
    const binaryPreview = buildBinaryDiffPreview(relativeFile, currentStat, effectiveStatus, ext, true);
    if (binaryPreview) return binaryPreview;

    const oldContent = await gitHeadFileContent(root, relativeFile);
    return {
      file: relativeFile,
      status: effectiveStatus,
      mode: 'diff',
      content: oldContent,
      oldContent,
      newContent: '',
      changeType: 'deleted'
    };
  }

  const binaryPreview = buildBinaryDiffPreview(relativeFile, currentStat, effectiveStatus, ext);
  if (binaryPreview) return binaryPreview;

  const diff = await gitDiffForFile(root, relativeFile);
  const [oldContent, newContent] = await Promise.all([
    gitHeadFileContent(root, relativeFile),
    readTextPreview(abs)
  ]);
  if (diff.trim()) {
    return {
      file: relativeFile,
      status: effectiveStatus,
      mode: 'diff',
      content: diff,
      oldContent,
      newContent
    };
  }

  if (effectiveStatus && isTextPreviewFile(relativeFile)) {
    return {
      file: relativeFile,
      status: effectiveStatus,
      mode: 'diff',
      content: '当前工作区已无可读 Git 差异，按执行记录保留左右对比视图。',
      oldContent,
      newContent,
      changeType: 'unchanged'
    };
  }

  return {
    file: relativeFile,
    status: effectiveStatus,
    mode: 'content',
    content: newContent,
    oldContent,
    newContent
  };
}

function buildImageDiffPreview(relativeFile, stat, status, { isDeleted = false, isUntracked = false } = {}) {
  if (!isImagePreviewFile(relativeFile)) return null;
  const hasNewImage = !isDeleted && Boolean(stat?.isFile());
  const hasOldImage = !isUntracked;
  const isMissing = !hasOldImage && !hasNewImage && !isDeleted;
  return {
    file: relativeFile,
    status,
    mode: 'image',
    content: isMissing
      ? '当前工作区未找到该图片文件，无法生成预览。'
      : hasOldImage && hasNewImage
      ? '图片文件已显示左右对比预览。'
      : hasNewImage
        ? '新增图片文件，左侧无旧版本。'
        : '图片文件已删除，右侧无新版本。',
    oldContent: '',
    newContent: '',
    oldAvailable: hasOldImage,
    newAvailable: hasNewImage,
    mimeType: mimeType(relativeFile),
    size: stat?.size || 0
  };
}

function buildBinaryDiffPreview(relativeFile, stat, status, ext, deleted = false) {
  if (isTextPreviewFile(relativeFile)) return null;
  const sizeText = stat?.size ? `，大小 ${formatBytes(stat.size)}` : '';
  return {
    file: relativeFile,
    status,
    mode: 'binary',
    content: deleted
      ? '该文件已删除，平台暂不支持预览已删除的二进制内容。'
      : `该文件为二进制或暂不识别的文件类型${sizeText}，不支持文本 Diff。`,
    oldContent: '',
    newContent: '',
    mimeType: ext ? mimeType(relativeFile) : 'application/octet-stream',
    size: stat?.size || 0
  };
}

async function runLogFileDiff(run, relativeFile) {
  if (!run?.logPath || !relativeFile) return '';
  const logText = await fs.readFile(run.logPath, 'utf8').catch(() => '');
  if (!logText) return '';
  const escaped = escapeRegExp(relativeFile);
  const startPattern = new RegExp(`^diff --git a/${escaped} b/${escaped}$`, 'm');
  const startMatch = startPattern.exec(logText);
  if (!startMatch) return '';
  const start = startMatch.index;
  const rest = logText.slice(start + startMatch[0].length + 1);
  const nextMatch = /^diff --git a\/.+ b\/.+$/m.exec(rest);
  const body = nextMatch ? rest.slice(0, nextMatch.index) : rest;
  return `${startMatch[0]}\n${body}`.trimEnd();
}

function parseGitFileDiff(diffText = '') {
  const oldLines = [];
  const newLines = [];
  let inHunk = false;
  let changeType = '';
  for (const line of String(diffText || '').split(/\r?\n/)) {
    if (line.startsWith('deleted file mode')) changeType = 'deleted';
    if (line.startsWith('new file mode')) changeType = 'added';
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('\\ No newline at end of file')) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      oldLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(' ')) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }
  return {
    oldContent: oldLines.join('\n'),
    newContent: newLines.join('\n'),
    changeType
  };
}

function isImagePreviewFile(file = '') {
  return /\.(png|jpe?g|webp|gif)$/i.test(file);
}

function isTextPreviewFile(file = '') {
  return /\.(vue|tsx?|jsx?|mjs|cjs|json|md|markdown|txt|log|css|scss|sass|less|html?|xml|svg|yml|yaml|env|gitignore|c|cc|cpp|h|hpp|java|kt|swift|go|rs|py|rb|php|sh|bash|zsh|sql|csv)$/i.test(file)
    || /(^|\/)(AGENTS|README|LICENSE|Dockerfile|Makefile)(\..*)?$/i.test(file);
}

async function gitStatusForFile(root, file) {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', 'status', '--short', '--', file], { cwd: root, timeout: 10000 });
    return stdout.trim().split(/\s+/)[0] || '';
  } catch {
    return '';
  }
}

async function gitDiffForFile(root, file) {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', 'diff', '--', file], { cwd: root, timeout: 20000, maxBuffer: 1024 * 1024 * 8 });
    return stdout;
  } catch (error) {
    return `diff read failed: ${error.message}`;
  }
}

async function gitHeadFileContent(root, file) {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', 'show', `HEAD:${file}`], { cwd: root, timeout: 10000, maxBuffer: 1024 * 1024 * 4 });
    return stdout;
  } catch {
    return '';
  }
}

async function gitHeadFileBuffer(root, file) {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', 'show', `HEAD:${file}`], {
    cwd: root,
    timeout: 10000,
    maxBuffer: 1024 * 1024 * 12,
    encoding: 'buffer'
  });
  return stdout;
}

async function readTextPreview(file) {
  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) return '这是一个目录，无法直接预览 diff。';
    if (stat.size > 1024 * 1024) return `文件过大，暂不预览：${stat.size} bytes`;
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    return `file read failed: ${error.message}`;
  }
}

async function listDirectoryPreview(absDir, relativeDir) {
  const entries = [];
  async function walk(currentAbs, currentRelative, depth = 0) {
    if (entries.length >= 200 || depth > 4) return;
    const children = await fs.readdir(currentAbs, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (entries.length >= 200) return;
      if (child.name === '.git' || child.name === 'node_modules') continue;
      const childAbs = path.join(currentAbs, child.name);
      const childRelative = path.join(currentRelative, child.name);
      if (child.isDirectory()) {
        await walk(childAbs, childRelative, depth + 1);
      } else {
        entries.push(childRelative);
      }
    }
  }
  await walk(absDir, relativeDir.replace(/\/$/, ''));
  return entries;
}

function normalizeGitPath(file = '') {
  const raw = String(file)
    .replace(/^"(.*)"$/, '$1')
    .replace(/^.*? -> /, '')
    .trim();
  return decodeGitQuotedPath(raw);
}

function decodeGitQuotedPath(value = '') {
  if (!/\\[0-7]{3}/.test(value)) return value;
  const bytes = [];
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\' && /^[0-7]{3}$/.test(value.slice(i + 1, i + 4))) {
      bytes.push(Number.parseInt(value.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      const encoded = Buffer.from(value[i]);
      bytes.push(...encoded);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPathInside(target, root) {
  if (!target || !root) return false;
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveInsideRoot(root, ...segments) {
  if (!root) return '';
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments.filter(segment => segment !== undefined && segment !== null));
  return isPathInside(resolvedTarget, resolvedRoot) ? resolvedTarget : '';
}

function normalizeFsPath(value = '') {
  const text = String(value || '').trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!text) return '';
  if (text === '~') return os.homedir();
  if (text.startsWith('~/')) return path.join(os.homedir(), text.slice(2));
  return text;
}

function resolveArtifactRequestPath(file = '') {
  const raw = normalizeFsPath(file);
  if (!raw || /^https?:\/\//i.test(raw) || raw.includes('\0')) return '';
  const normalized = raw.replaceAll('\\', '/');
  const relative = normalized.replace(/^\/+/, '');
  const abs = path.isAbsolute(raw)
    ? path.resolve(raw)
    : relative.startsWith('platform-artifacts/')
      ? path.resolve(paths.artifactDir, relative.replace(/^platform-artifacts\/+/, ''))
      : path.resolve(paths.root, relative);
  return [paths.artifactDir, paths.workspaceDir, zentaoArtBriefOutDir].some(root => isPathInside(abs, root)) ? abs : '';
}

function resolveWorkspaceRequestPath(file = '') {
  const raw = normalizeFsPath(file);
  if (!raw || /^https?:\/\//i.test(raw) || raw.includes('\0')) return '';
  const normalized = raw.replaceAll('\\', '/');
  const relative = normalized.replace(/^\/+/, '');
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(paths.root, relative);
  return isPathInside(abs, paths.workspaceDir) ? abs : '';
}

function allowedDirectoryBrowseRoots() {
  const envRoots = String(process.env.ART_PLATFORM_ALLOWED_BROWSE_ROOTS || '')
    .split(/[;,]/)
    .map(normalizeFsPath)
    .filter(Boolean);
  const roots = [
    defaultDirectoryBrowseRoot,
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Downloads'),
    '/Volumes',
    path.dirname(paths.root),
    paths.root,
    ...envRoots
  ];
  return [...new Set(roots.map(item => path.resolve(item)).filter(Boolean))];
}

function isDirectoryBrowseAllowed(target = '') {
  if (!target) return false;
  const resolved = path.resolve(target);
  return allowedDirectoryBrowseRoots().some(root => isPathInside(resolved, root));
}

async function resolveDirectoryBrowseTarget(inputPath = '') {
  const requested = normalizeFsPath(inputPath);
  if (requested) {
    const target = path.resolve(requested);
    if (!isDirectoryBrowseAllowed(target)) {
      throw new HttpError(403, '目录不在允许浏览范围内，请调整目录或配置 ART_PLATFORM_ALLOWED_BROWSE_ROOTS。');
    }
    return target;
  }
  for (const root of allowedDirectoryBrowseRoots()) {
    const stat = await fs.stat(root).catch(() => null);
    if (stat?.isDirectory()) return root;
  }
  return paths.root;
}

async function listDirectories(inputPath) {
  const target = await resolveDirectoryBrowseTarget(inputPath);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new HttpError(404, '目录不存在或不是目录。');
  }
  const entries = await fs.readdir(target, { withFileTypes: true });
  const directories = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({
      name: entry.name,
      path: path.join(target, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    path: target,
    parent: path.dirname(target) !== target && isDirectoryBrowseAllowed(path.dirname(target)) ? path.dirname(target) : '',
    directories
  };
}

async function syncZentaoTasks(project, options = {}) {
  const startedAt = new Date().toISOString();
  markZentaoQueueRunning('tasks', {
    projectId: project.id,
    trigger: options.trigger || options.reason || zentaoAutoSyncState.trigger || 'manual',
    startedAt
  });
  zentaoAutoSyncState = {
    ...zentaoAutoSyncState,
    running: true,
    projectId: project.id,
    lastStartedAt: startedAt,
    lastError: ''
  };
  try {
    const interactive = options.interactive === true || options.mode === 'interactive';
    const syncProfile = String(options.syncProfile || options.profile || '').trim().toLowerCase();
    const fullScan = options.fullScan === true || ['full', 'full-scan', 'deep'].includes(syncProfile) || options.mode === 'full';
    const discoveryScan = fullScan || options.discovery === true || options.discover === true || ['discovery', 'discover', 'find-new'].includes(syncProfile);
    const quickSync = !fullScan && (options.quick === true || ['quick', 'fast', 'manual-quick'].includes(syncProfile));
    const currentOnlySync = !discoveryScan && (quickSync || options.detailRefreshScope === 'current' || options.currentOnly === true);
    const widenInteractiveScan = interactive && !quickSync;
    const syncOptions = widenInteractiveScan
      ? {
          ...options,
          executionMaxPages: Math.max(Number(options.executionMaxPages || 0), 20),
          maxPages: Math.max(Number(options.maxPages || 0), 8),
          limit: Math.max(Number(options.limit || 0), 100),
          detailConcurrency: Math.max(Number(options.detailConcurrency || 0), 6),
          executionScanLimit: Math.max(Number(options.executionScanLimit || 0), 120)
        }
      : {
          ...options,
          executionMaxPages: options.executionMaxPages ?? (quickSync ? 5 : options.executionMaxPages),
          maxPages: options.maxPages ?? (quickSync ? 3 : options.maxPages),
          limit: options.limit ?? 100,
          detailConcurrency: options.detailConcurrency ?? (quickSync ? 6 : options.detailConcurrency),
          executionScanLimit: options.executionScanLimit ?? (quickSync ? 24 : options.executionScanLimit),
          detailRefreshScope: options.detailRefreshScope || (quickSync ? 'tracked' : options.detailRefreshScope)
        };
    if (quickSync && !currentOnlySync) {
      syncOptions.executionScanLimit = Math.max(Number(syncOptions.executionScanLimit || 0), 80);
      syncOptions.executionMaxPages = Math.max(Number(syncOptions.executionMaxPages || 0), 5);
      syncOptions.maxPages = Math.max(Number(syncOptions.maxPages || 0), 3);
    }
    const limit = Math.min(Math.max(Number(syncOptions.limit || 100), 1), 200);
    const maxPages = Math.min(Math.max(Number(syncOptions.maxPages || 5), 1), 50);
    const detailConcurrency = Math.min(Math.max(Number(syncOptions.detailConcurrency || (interactive ? 6 : 4)), 1), 10);
    const { artAccounts, userNames, artUserSource, artUsers } = await getZentaoArtUsers();
    const artSnapshotTasks = await listArtSnapshotTasks(project.id).catch(() => []);
    const artSeenCandidateMaxAgeMs = currentOnlySync
      ? Number(syncOptions.artSeenCandidateMaxAgeMs ?? 2 * 24 * 60 * 60 * 1000)
      : Number(syncOptions.artSeenCandidateMaxAgeMs ?? 0);
    const artSeenCandidateTaskNos = await listArtSeenCandidateTaskNos({ maxAgeMs: artSeenCandidateMaxAgeMs }).catch(() => []);
    const existingZentaoTasks = (await listTasks({ projectId: project.id }))
      .filter(task => task.source === 'zentao' && task.taskNo);
    const aiFlowTaskNos = (await listAiFlowRecords({ projectId: project.id }))
      .filter(record => record.status !== 'deleted' && record.taskNo)
      .map(record => String(record.taskNo));
    const existingZentaoTaskNos = new Set(existingZentaoTasks.map(task => String(task.taskNo)));
    for (const task of artSnapshotTasks) {
      if (task.taskNo) existingZentaoTaskNos.add(String(task.taskNo));
    }
    for (const taskNo of artSeenCandidateTaskNos) existingZentaoTaskNos.add(String(taskNo));
    for (const taskNo of aiFlowTaskNos) existingZentaoTaskNos.add(taskNo);
    const existingZentaoTaskByNo = new Map([
      ...artSnapshotTasks.filter(task => task.taskNo).map(task => [String(task.taskNo), task]),
      ...existingZentaoTasks.map(task => [String(task.taskNo), task])
    ]);
    const detailRefreshScope = String(syncOptions.detailRefreshScope || 'tracked').trim().toLowerCase();
    const detailRefreshTaskNos = detailRefreshScope === 'current'
      ? zentaoCurrentDetailRefreshTaskNos(existingZentaoTasks, artSnapshotTasks, artSeenCandidateTaskNos, aiFlowTaskNos)
      : existingZentaoTaskNos;
    const classicUserTaskDiscovery = await discoverZentaoUserAssignedTaskNos(artUsers, syncOptions);
    for (const taskNo of classicUserTaskDiscovery.taskNos) detailRefreshTaskNos.add(taskNo);
    for (const taskNo of classicUserTaskDiscovery.taskNos) existingZentaoTaskNos.add(taskNo);
    const allTasks = [];
    const executionSummaries = [];
    const detailRefresh = await refreshTrackedZentaoTasks(project, detailRefreshTaskNos, existingZentaoTaskByNo, artAccounts, userNames, detailConcurrency);
    const executions = currentOnlySync
      ? []
      : await resolveZentaoExecutionIds(syncOptions).catch(error => {
        if (interactive) {
          console.warn(`ZenTao execution list fallback: ${error.message || error}`);
          return [];
        }
        throw error;
      });
    const executionScanLimit = Math.min(Math.max(Number(syncOptions.executionScanLimit || (interactive ? 24 : executions.length || 1)), 1), 200);
    const refreshedCurrentExecutionIds = new Set(detailRefresh.tasks
      .filter(task => task.isCurrent !== false)
      .map(task => String(task.zentao?.execution || '').trim())
      .filter(Boolean));
    const scanExecutions = currentOnlySync
      ? []
      : interactive
      ? [...new Set([...refreshedCurrentExecutionIds, ...executions.map(execution => String(execution)).slice(0, executionScanLimit)])]
      : executions;

    for (const execution of scanExecutions) {
      let page = 1;
      let total = 0;
      let fetched = 0;
      let matched = 0;
      try {
        while (page <= maxPages) {
          const payload = await callZentaoRead(({ api: zentaoApi, modules: zentao }) => zentao.listTasks(zentaoApi, { execution, page, limit }));
          const result = payload.result || payload.data || payload;
          const tasks = Array.isArray(result.tasks) ? result.tasks : Array.isArray(result) ? result : [];
          const flatTasks = tasks.flatMap(flattenZentaoTask);
          const scope = syncOptions.scope || syncOptions.taskScope || 'all';
          const artTasks = flatTasks.filter(task => {
            const taskNo = String(task.id || task.taskID || '').trim();
            const tracked = existingZentaoTaskNos.has(taskNo) && isArtTask(task, artAccounts);
            const currentArtTask = isCurrentArtZentaoTask(task, artAccounts);
            return !isBugLikeTaskInput(task)
              && (currentArtTask || tracked)
              && (scope !== 'unfinished' || isUnfinishedZentaoTask(task));
          });
          const currentArtTaskIds = artTasks
            .filter(task => isCurrentArtZentaoTask(task, artAccounts))
            .map(task => `${project.id}_${String(task.id || task.taskID || '').trim()}`);
          total = Number(result.total || tasks.length || total);
          fetched += tasks.length;
          matched += artTasks.length;
          allTasks.push(...artTasks.map(task => ({
            ...normalizeZentaoTask(project, task, execution, userNames),
            isCurrent: currentArtTaskIds.includes(`${project.id}_${String(task.id || task.taskID || '').trim()}`),
            syncStatus: currentArtTaskIds.includes(`${project.id}_${String(task.id || task.taskID || '').trim()}`) ? 'current' : 'non_current'
          })));
          if (!tasks.length || fetched >= total) break;
          page += 1;
        }
        executionSummaries.push({ execution, fetched, matched, total });
      } catch (error) {
        executionSummaries.push({ execution, fetched, matched, total, error: error.message });
      }
    }

    const taskByNo = new Map();
    for (const task of allTasks) taskByNo.set(String(task.taskNo), task);
    for (const task of detailRefresh.tasks) taskByNo.set(String(task.taskNo), task);
    const existingCurrentZentaoTasks = existingZentaoTasks
      .filter(task => task.isCurrent !== false && isArtTask(task, artAccounts));
    const incomingCurrentTaskCount = [...taskByNo.values()].filter(task => task.isCurrent !== false).length;
    const currentSnapshotReliable = isReliableZentaoCurrentSnapshot({
      currentOnlySync,
      classicUserTaskDiscovery,
      detailRefresh,
      detailRefreshCandidateCount: detailRefreshTaskNos.size,
      executionSummaries
    });
    const preserveExistingCurrentTasks = !currentSnapshotReliable
      && existingCurrentZentaoTasks.length >= 10
      && incomingCurrentTaskCount > 0
      && incomingCurrentTaskCount < Math.ceil(existingCurrentZentaoTasks.length * 0.5);
    if (preserveExistingCurrentTasks) {
      for (const task of existingCurrentZentaoTasks) {
        if (task.taskNo && !taskByNo.has(String(task.taskNo))) taskByNo.set(String(task.taskNo), task);
      }
    }

    const noReliableIncomingTasks = !currentSnapshotReliable && incomingCurrentTaskCount === 0 && existingCurrentZentaoTasks.length > 0;
    if (noReliableIncomingTasks) {
      for (const task of existingCurrentZentaoTasks) {
        if (task.taskNo && !taskByNo.has(String(task.taskNo))) taskByNo.set(String(task.taskNo), task);
      }
    }

    const saved = await upsertTasks([...taskByNo.values()]);
    const syncedAt = new Date().toISOString();
    const currentTaskIds = saved.tasks.filter(task => task.isCurrent !== false).flatMap(task => [
      task.id,
      task.projectId && task.taskNo ? `${task.projectId}:${task.taskNo}` : ''
    ]).filter(Boolean);
    const hasReliableCurrentSnapshot = currentSnapshotReliable
      || detailRefresh.refreshed > 0
      || executionSummaries.some(item => Number(item.matched || 0) > 0);
    if (interactive && !hasReliableCurrentSnapshot) {
      for (const task of existingCurrentZentaoTasks) {
        currentTaskIds.push(task.id, task.projectId && task.taskNo ? `${task.projectId}:${task.taskNo}` : '');
      }
    }
    if (interactive) {
      for (const failure of detailRefresh.failed) {
        const existing = existingZentaoTaskByNo.get(String(failure.taskNo));
        if (existing?.isCurrent !== false && isArtTask(existing, artAccounts)) {
          currentTaskIds.push(existing.id || `${project.id}_${failure.taskNo}`, `${project.id}:${failure.taskNo}`);
        }
      }
    }
    const uniqueCurrentTaskIds = [...new Set(currentTaskIds.filter(Boolean))];
    const snapshot = await reconcileZentaoTaskSnapshot(
      project.id,
      uniqueCurrentTaskIds,
      syncedAt
    );
    const currentTaskCount = uniqueCurrentTaskIds.filter(id => String(id || '').includes(':')).length;
    const result = {
      ...saved,
      ...snapshot,
      currentTaskCount,
      artDeptId: zentaoArtDeptId,
      artUserCount: artAccounts.size,
      artUserSource,
      artSeenCandidateTasks: artSeenCandidateTaskNos.length,
      aiFlowTrackedTasks: aiFlowTaskNos.length,
      detailRefresh: {
        refreshed: detailRefresh.refreshed,
        failed: detailRefresh.failed.length,
        failures: detailRefresh.failed
      },
      classicUserTaskDiscovery,
      executions: executionSummaries,
      interactive,
      syncProfile: quickSync ? 'quick' : fullScan ? 'full' : interactive ? 'interactive' : 'standard',
      detailRefreshScope,
      detailRefreshCandidates: detailRefreshTaskNos.size,
      currentSnapshotReliable,
      artSeenCandidateMaxAgeMs,
      currentOnlySync,
      scannedExecutions: scanExecutions.length,
      preservedExistingCurrentTasks: preserveExistingCurrentTasks,
      preservedExistingTasks: noReliableIncomingTasks,
      syncedAt
    };
    const unreliableSyncMessage = currentSnapshotReliable
      ? ''
      : '禅道任务同步未拿到可靠的当前任务快照，已保留上次任务中心数据，请检查禅道登录、部门成员列表和人员页发现。';
    if (unreliableSyncMessage) {
      result.warning = unreliableSyncMessage;
      markZentaoQueueFailed('tasks', unreliableSyncMessage, result.syncedAt, result);
    } else {
      markZentaoQueueSuccess('tasks', result, result.syncedAt);
    }
    zentaoAutoSyncState = {
      ...zentaoAutoSyncState,
      running: hasRunningZentaoQueue(),
      lastFinishedAt: result.syncedAt,
      lastSuccessAt: unreliableSyncMessage ? zentaoAutoSyncState.lastSuccessAt : result.syncedAt,
      lastErrorAt: unreliableSyncMessage ? result.syncedAt : zentaoAutoSyncState.lastErrorAt,
      lastError: unreliableSyncMessage,
      lastSummary: compactZentaoSyncSummary(result)
    };
    broadcastPlatformEvent('tasks.changed', {
      projectId: project.id,
      module: 'task-sync',
      syncKind: 'task',
      syncedAt: result.syncedAt,
      created: result.created || 0,
      updated: result.updated || 0,
      markedCurrent: result.markedCurrent || 0,
      markedNonCurrent: result.markedNonCurrent || 0
    });
    return result;
  } catch (error) {
    const failedAt = new Date().toISOString();
    const message = zentaoSyncErrorMessage(error);
    markZentaoQueueFailed('tasks', message, failedAt);
    zentaoAutoSyncState = {
      ...zentaoAutoSyncState,
      running: hasRunningZentaoQueue(),
      lastFinishedAt: failedAt,
      lastErrorAt: failedAt,
      lastError: message
    };
    throw error;
  }
}

function triggerZentaoTaskSync(project, options = {}, reason = 'manual') {
  const startedAt = new Date().toISOString();
  let taskTrigger = {
    accepted: false,
    running: true,
    startedAt: zentaoQueueState('tasks').lastStartedAt || '',
    message: '已有任务同步正在执行'
  };
  if (!isZentaoQueueRunning('tasks')) {
    markZentaoQueueRunning('tasks', {
      projectId: project.id,
      trigger: reason,
      startedAt
    });
    zentaoAutoSyncState = {
      ...zentaoAutoSyncState,
      running: true,
      projectId: project.id,
      lastStartedAt: startedAt,
      lastError: '',
      trigger: reason
    };
    taskTrigger = { accepted: true, running: true, startedAt };
    syncZentaoTasks(project, { ...options, trigger: reason }).catch(error => {
      const failedAt = new Date().toISOString();
      const message = zentaoSyncErrorMessage(error);
      markZentaoQueueFailed('tasks', message, failedAt);
      zentaoAutoSyncState = {
        ...zentaoAutoSyncState,
        running: hasRunningZentaoQueue(),
        lastFinishedAt: failedAt,
        lastErrorAt: failedAt,
        lastError: message,
        lastSummary: {
          ...compactZentaoSyncSummary(zentaoAutoSyncState.lastSummary || {}),
          preservedExistingTasks: true
        }
      };
      console.error(`ZenTao ${reason} sync failed:`, message);
    });
  }
  const includeBugs = options.includeBugs !== false;
	  const bugTrigger = includeBugs
	    ? triggerZentaoBugSync(project, {
	      products: options.products || options.product || options.productIds || zentaoBugProductIds,
	      limit: options.bugLimit || 100,
	      maxPages: options.bugMaxPages || 10,
	      refreshTracked: options.bugRefreshTracked !== false,
	      trackedConcurrency: options.bugTrackedConcurrency || 4,
	      currentOnly: options.bugCurrentOnly !== false,
	      fullScan: options.bugFullScan === true || options.fullScan === true || options.discovery === true || options.discover === true,
	      discovery: options.bugDiscovery === true || options.discovery === true || options.discover === true,
	      syncProfile: options.bugSyncProfile || options.syncProfile || options.profile || ''
	    }, reason)
    : { accepted: false, running: false, message: '本次只同步任务' };
  return {
    accepted: true,
    running: hasRunningZentaoQueue(),
    startedAt,
    queues: {
      tasks: taskTrigger,
      bugs: bugTrigger
    },
    message: syncTriggerMessage(taskTrigger, bugTrigger),
    zentaoAutoSync: compactZentaoAutoSyncState(zentaoAutoSyncState)
  };
}

async function syncZentaoTasksWithStats(project, options = {}) {
  const syncKind = normalizeZentaoSyncKind(options.syncKind || options.kind || options.mode);
  const jobs = [];
  if (syncKind !== 'bug') {
    jobs.push(['tasks', syncZentaoTasks(project, { ...options, trigger: options.trigger || 'manual' })]);
  }
	  if (syncKind !== 'task') {
	    jobs.push(['bugs', syncZentaoBugs(project, {
	      products: options.products || options.product || options.productIds || zentaoBugProductIds,
	      limit: options.bugLimit || 100,
	      maxPages: options.bugMaxPages || 10,
	      refreshTracked: options.bugRefreshTracked !== false,
	      trackedConcurrency: options.bugTrackedConcurrency || 4,
	      currentOnly: options.bugCurrentOnly !== false,
	      fullScan: options.bugFullScan === true || options.fullScan === true || options.discovery === true || options.discover === true,
	      discovery: options.bugDiscovery === true || options.discovery === true || options.discover === true,
	      syncProfile: options.bugSyncProfile || options.syncProfile || options.profile || '',
	      trigger: options.trigger || 'manual'
	    })]);
  }
  const settled = await Promise.allSettled(jobs.map(([, promise]) => promise));
  const byType = Object.fromEntries(jobs.map(([type], index) => [type, settled[index]]));
  if (settled.length && settled.every(result => result.status === 'rejected')) throw settled[0].reason;
  const tasks = byType.tasks
    ? byType.tasks.status === 'fulfilled' ? byType.tasks.value : {
      error: zentaoSyncErrorMessage(byType.tasks.reason),
      preservedExistingTasks: true
    }
    : { skipped: true };
  const bugs = byType.bugs
    ? byType.bugs.status === 'fulfilled' ? byType.bugs.value : {
      error: zentaoSyncErrorMessage(byType.bugs.reason)
    }
    : { skipped: true };
  const finishedAt = new Date().toISOString();
  zentaoAutoSyncState = {
    ...zentaoAutoSyncState,
    running: hasRunningZentaoQueue(),
    lastFinishedAt: finishedAt,
    lastSuccessAt: tasks.syncedAt || bugs.syncedAt || finishedAt,
    lastError: tasks.error || bugs.error || '',
    lastSummary: compactZentaoSyncSummary({
      ...(zentaoAutoSyncState.lastSummary || {}),
      ...tasks,
      bugs
    })
  };
  return { ...tasks, bugs, zentaoAutoSync: compactZentaoAutoSyncState(zentaoAutoSyncState) };
}

function triggerZentaoBugSyncOnly(project, options = {}, reason = 'manual') {
  const bugTrigger = triggerZentaoBugSync(project, {
    products: options.products || options.product || options.productIds || zentaoBugProductIds,
    limit: options.bugLimit || options.limit || 100,
	    maxPages: options.bugMaxPages || options.maxPages || 10,
	    refreshTracked: options.bugRefreshTracked !== false && options.refreshTracked !== false,
	    trackedConcurrency: options.bugTrackedConcurrency || options.trackedConcurrency || 4,
	    currentOnly: options.bugCurrentOnly !== false && options.currentOnly !== false,
	    fullScan: options.bugFullScan === true || options.fullScan === true || options.discovery === true || options.discover === true,
	    discovery: options.bugDiscovery === true || options.discovery === true || options.discover === true,
	    syncProfile: options.bugSyncProfile || options.syncProfile || options.profile || ''
	  }, reason);
  return {
    accepted: true,
    running: hasRunningZentaoQueue(),
    startedAt: bugTrigger.startedAt || new Date().toISOString(),
    queues: {
      tasks: { accepted: false, running: false, message: '本次只同步 Bug' },
      bugs: bugTrigger
    },
    message: bugTrigger.accepted ? '已开始同步禅道 Bug' : bugTrigger.message || 'Bug 同步正在执行',
    zentaoAutoSync: compactZentaoAutoSyncState(zentaoAutoSyncState)
  };
}

function normalizeZentaoSyncKind(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (['bug', 'bugs'].includes(text)) return 'bug';
  if (['task', 'tasks'].includes(text)) return 'task';
  return 'all';
}

function triggerZentaoBugSync(project, options = {}, reason = 'manual') {
  if (isZentaoQueueRunning('bugs')) {
    return {
      accepted: false,
      running: true,
      startedAt: zentaoQueueState('bugs').lastStartedAt || '',
      message: '已有 Bug 同步正在执行'
    };
  }
  const startedAt = new Date().toISOString();
  markZentaoQueueRunning('bugs', {
    projectId: project.id,
    trigger: reason,
    startedAt
  });
  zentaoAutoSyncState = {
    ...zentaoAutoSyncState,
    running: true,
    projectId: project.id,
    lastStartedAt: startedAt,
    lastError: '',
    trigger: reason
  };
  syncZentaoBugs(project, { ...options, trigger: reason }).catch(error => {
    const failedAt = new Date().toISOString();
    const message = zentaoSyncErrorMessage(error);
    markZentaoQueueFailed('bugs', message, failedAt);
    zentaoAutoSyncState = {
      ...zentaoAutoSyncState,
      running: hasRunningZentaoQueue(),
      lastFinishedAt: failedAt,
      lastErrorAt: failedAt,
      lastError: message,
      lastSummary: {
        ...compactZentaoSyncSummary(zentaoAutoSyncState.lastSummary || {}),
        bugs: { error: message }
      }
    };
    console.error(`ZenTao bug ${reason} sync failed:`, message);
  });
  return {
    accepted: true,
    running: true,
    startedAt,
    message: 'Bug 同步已开始'
  };
}

function compactZentaoAutoSyncState(state = {}) {
  const tasks = compactZentaoQueueState(state.tasks || createZentaoQueueState('tasks'));
  const bugs = compactZentaoQueueState(state.bugs || createZentaoQueueState('bugs'));
  const running = Boolean(state.running || tasks.running || bugs.running);
  const lastError = state.lastError || tasks.lastError || bugs.lastError || '';
  const lastErrorAt = latestDate(tasks.lastErrorAt, bugs.lastErrorAt) || state.lastErrorAt || '';
  const lastSuccessAt = latestDate(tasks.lastSuccessAt, bugs.lastSuccessAt) || state.lastSuccessAt || '';
  return {
    ...state,
    running,
    lastError,
    lastErrorAt,
    lastSuccessAt,
    tasks,
    bugs,
    lastSummary: compactZentaoSyncSummary(state.lastSummary || null)
  };
}

function compactZentaoSyncSummary(summary = null) {
  if (!summary || typeof summary !== 'object') return summary;
  const output = { ...summary };
  if (Array.isArray(output.tasks)) {
    output.taskCount = Number(output.currentTaskCount || 0) || output.tasks.length;
    delete output.tasks;
  }
  if (Array.isArray(output.bugs)) {
    output.bugCount = output.bugs.length;
    delete output.bugs;
  } else if (output.bugs && typeof output.bugs === 'object') {
    output.bugs = compactZentaoSyncSummary(output.bugs);
  }
  return output;
}

function createZentaoQueueState(type) {
  return {
    type,
    running: false,
    projectId: zentaoAutoSyncProjectId,
    trigger: '',
    lastStartedAt: '',
    lastFinishedAt: '',
    lastSuccessAt: '',
    lastErrorAt: '',
    lastError: '',
    lastSummary: null
  };
}

function zentaoQueueState(type) {
  const key = type === 'bugs' ? 'bugs' : 'tasks';
  if (!zentaoAutoSyncState[key] || typeof zentaoAutoSyncState[key] !== 'object') {
    zentaoAutoSyncState[key] = createZentaoQueueState(key);
  }
  return zentaoAutoSyncState[key];
}

function markZentaoQueueRunning(type, options = {}) {
  const state = zentaoQueueState(type);
  zentaoAutoSyncState[type] = {
    ...state,
    type,
    running: true,
    projectId: options.projectId || state.projectId || zentaoAutoSyncProjectId,
    trigger: options.trigger || state.trigger || '',
    lastStartedAt: options.startedAt || new Date().toISOString(),
    lastError: ''
  };
}

function markZentaoQueueSuccess(type, summary = {}, finishedAt = new Date().toISOString()) {
  const state = zentaoQueueState(type);
  zentaoAutoSyncState[type] = {
    ...state,
    type,
    running: false,
    lastFinishedAt: finishedAt,
    lastSuccessAt: finishedAt,
    lastError: '',
    lastSummary: compactZentaoSyncSummary(summary)
  };
}

function markZentaoQueueFailed(type, message = '', failedAt = new Date().toISOString(), summary = null) {
  const state = zentaoQueueState(type);
  zentaoAutoSyncState[type] = {
    ...state,
    type,
    running: false,
    lastFinishedAt: failedAt,
    lastErrorAt: failedAt,
    lastError: message || '禅道同步失败，已保留现有列表。',
    lastSummary: summary ? compactZentaoSyncSummary(summary) : state.lastSummary
  };
}

function isZentaoQueueRunning(type) {
  return Boolean(zentaoQueueState(type).running);
}

function hasRunningZentaoQueue() {
  return isZentaoQueueRunning('tasks') || isZentaoQueueRunning('bugs');
}

function compactZentaoQueueState(state = {}) {
  return {
    ...state,
    lastSummary: compactZentaoSyncSummary(state.lastSummary || null)
  };
}

function syncTriggerMessage(taskTrigger = {}, bugTrigger = {}) {
  if (taskTrigger.accepted && bugTrigger.accepted) return '任务和 Bug 同步已分别开始';
  if (taskTrigger.accepted && bugTrigger.running === false) return '已开始同步禅道任务';
  if (bugTrigger.accepted && taskTrigger.running === false) return '已开始同步禅道 Bug';
  if (taskTrigger.accepted) return '任务同步已开始，Bug 同步已有队列在执行';
  if (bugTrigger.accepted) return 'Bug 同步已开始，任务同步已有队列在执行';
  return '已有同步队列正在执行';
}

async function generateZentaoArtBrief(task = {}) {
  const taskNo = String(task.taskNo || task.zentao?.id || '').trim();
  if (!taskNo) throw new HttpError(400, '这条任务缺少禅道任务号，不能生成美术摘要。');
  const completeTask = await hydrateTaskForArtBrief(task);
  await fs.mkdir(zentaoArtBriefOutDir, { recursive: true });
  const taskJsonPath = path.join(zentaoArtBriefOutDir, `${safeFileSegment(task.id || taskNo)}-task.json`);
  const demandSummaryPayload = {
    result: {
      ...completeTask,
      id: taskNo,
      taskID: taskNo,
      name: completeTask.name || completeTask.title || completeTask.displayTitle || '',
      title: completeTask.title || completeTask.name || completeTask.displayTitle || ''
    }
  };
  await fs.writeFile(taskJsonPath, `${JSON.stringify(demandSummaryPayload, null, 2)}\n`, 'utf8');
  const { stdout, stderr } = await execFileAsync('python3', [
    zentaoArtBriefScript,
    taskNo,
    '--from-json',
    taskJsonPath,
    '--out-dir',
    zentaoArtBriefOutDir
  ], {
    cwd: zentaoArtBriefRoot,
    env: {
      ...process.env,
      PATH: [
        path.join(os.homedir(), '.npm-global', 'bin'),
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
        process.env.PATH || ''
      ].filter(Boolean).join(path.delimiter)
    },
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 16
  }).catch(error => {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    throw new HttpError(502, `禅道美术摘要生成失败：${detail || '脚本执行失败'}`);
  });
  const summary = await parseDemandSummaryOutput(stdout, taskNo);
  const reportFile = summary.htmlPath ? path.resolve(summary.htmlPath) : '';
  const aiWorkFile = summary.aiWorkPath ? path.resolve(summary.aiWorkPath) : '';
  const manifestFile = summary.manifestPath ? path.resolve(summary.manifestPath) : '';
  const message = [
    '需要美术做：',
    `- ${summary.scope || '按 AI 工作说明里的设计范围处理'}`,
    `- ${summary.workType || '生成美术需求摘要'}：${summary.workMethod || '查看摘要和 AI 工作说明确认具体处理点'}`,
    summary.pointsCount ? `- 已整理 ${summary.pointsCount} 条设计处理点。` : '- 处理点请查看 AI 工作说明。',
    '',
    '不需要美术做：',
    '- 不写入禅道备注，不修改任务字段。',
    '',
    '需要确认：',
    summary.confirmationsCount ? `- 已整理 ${summary.confirmationsCount} 条设计前确认点。` : '- 如需求范围不清晰，需要负责人确认后再设计。'
  ].join('\n');
  return {
    ...summary,
    stderr: String(stderr || '').trim(),
    reportFile,
    aiWorkFile,
    manifestFile,
    reportUrl: reportFile ? `/api/artifact?path=${encodeURIComponent(reportFile)}` : '',
    aiWorkUrl: aiWorkFile ? `/api/artifact?path=${encodeURIComponent(aiWorkFile)}&download=${encodeURIComponent(`${taskNo}-AI工作说明.md`)}` : '',
    needs: [
      summary.scope,
      summary.workType,
      summary.workMethod,
      summary.pointsCount ? `${summary.pointsCount} 条设计处理点` : ''
    ].filter(Boolean),
    avoid: ['不写入禅道备注', '不修改任务字段'],
    confirm: [summary.confirmationsCount ? `${summary.confirmationsCount} 条设计前确认点` : '需要负责人确认设计范围'].filter(Boolean),
    summaryText: message,
    generatedAt: new Date().toISOString()
  };
}

async function parseDemandSummaryOutput(stdout = '', taskNo = '') {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const manifestLine = [...lines].reverse().find(line => line.endsWith('summary-manifest.json'));
  const manifestPath = manifestLine ? path.resolve(manifestLine) : '';
  if (manifestPath) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      return {
        ...manifest,
        manifestPath
      };
    } catch (error) {
      throw new HttpError(502, `禅道美术摘要生成失败：manifest 读取失败：${error.message}`);
    }
  }
  const htmlPath = lines.find(line => line.endsWith(`${taskNo}-美术需求摘要.html`) || line.endsWith('-美术需求摘要.html')) || '';
  const aiWorkPath = lines.find(line => line.endsWith(`${taskNo}-AI工作说明.md`) || line.endsWith('-AI工作说明.md')) || '';
  if (!htmlPath && !aiWorkPath) throw new HttpError(502, '禅道美术摘要生成失败：DemandSummary 未返回摘要文件路径。');
  return {
    version: 1,
    taskId: taskNo,
    title: '',
    generatedAt: new Date().toISOString(),
    htmlPath,
    aiWorkPath,
    manifestPath: '',
    scope: '',
    workType: '',
    workMethod: '',
    pointsCount: 0,
    confirmationsCount: 0,
    quality: { status: 'unknown', issues: [], warnings: [] }
  };
}

function normalizeZentaoSiteBaseUrl(value = '') {
  return String(value || '')
    .replace(/\/index\.php.*$/i, '')
    .replace(/\/+$/, '');
}

async function hydrateTaskForArtBrief(task = {}) {
  const taskNo = String(task.taskNo || task.zentao?.id || '').trim();
  if (!taskNo) return task;
  try {
    const payload = await callZentaoRead(({ api: zentaoApi, modules: zentao }) => zentao.getTask(zentaoApi, { id: taskNo }));
    const result = payload.result || payload.data || payload;
    const detail = result.task || result;
    if (!detail || typeof detail !== 'object') return task;
    return mergeZentaoDetailIntoArtBriefTask(task, detail);
  } catch (error) {
    console.warn(`ZenTao art brief detail fallback for ${taskNo}: ${error.message || error}`);
    return task;
  }
}

function mergeZentaoDetailIntoArtBriefTask(task = {}, detail = {}) {
  const taskNo = String(task.taskNo || detail.id || detail.taskID || task.zentao?.id || '').trim();
  const detailTitle = detail.name || detail.title || task.title || task.displayTitle || '';
  const zentao = {
    ...(task.zentao || {}),
    id: detail.id || detail.taskID || task.zentao?.id || taskNo,
    project: detail.project || task.zentao?.project || '',
    parent: detail.parent || task.zentao?.parent || '',
    execution: detail.execution || task.zentao?.execution || '',
    story: detail.story || detail.storyID || task.zentao?.story || '',
    storyTitle: detail.storyTitle || detail.story?.title || task.zentao?.storyTitle || '',
    parentName: detail.parentName || task.zentao?.parentName || '',
    executionName: detail.executionName || task.zentao?.executionName || '',
    openedBy: accountName(detail.openedBy) || task.zentao?.openedBy || '',
    openedByName: userName(detail.openedBy) || task.zentao?.openedByName || '',
    createdBy: accountName(detail.openedBy || detail.createdBy) || task.zentao?.createdBy || '',
    createdByName: userName(detail.openedBy || detail.createdBy) || task.zentao?.createdByName || '',
    storyOpenedBy: accountName(detail.story?.openedBy || detail.storyOpenedBy) || task.zentao?.storyOpenedBy || '',
    storyOpenedByName: userName(detail.story?.openedBy || detail.storyOpenedBy) || task.zentao?.storyOpenedByName || '',
    productOwner: accountName(detail.productOwner || detail.story?.openedBy || detail.storyOpenedBy) || task.zentao?.productOwner || '',
    productOwnerName: userName(detail.productOwner || detail.story?.openedBy || detail.storyOpenedBy) || task.zentao?.productOwnerName || '',
    files: detail.files || task.zentao?.files || {},
    actions: detail.actions || task.zentao?.actions || []
  };
  return {
    ...task,
    id: task.id || `${task.projectId || artProjectId}_${taskNo}`,
    taskNo,
    title: task.title || detailTitle,
    displayTitle: task.displayTitle || detailTitle,
    name: task.name || detailTitle,
    desc: detail.desc || task.desc || task.description || task.requirement || '',
    description: detail.desc || task.description || task.requirement || '',
    requirement: detail.desc || task.requirement || task.description || '',
    storySpec: detail.storySpec || detail.story?.spec || task.storySpec || task.zentao?.storySpec || '',
    storyVerify: detail.storyVerify || detail.story?.verify || task.storyVerify || task.zentao?.storyVerify || '',
    openedBy: accountName(detail.openedBy) || task.openedBy || '',
    openedByName: userName(detail.openedBy) || task.openedByName || '',
    storyOpenedBy: accountName(detail.story?.openedBy || detail.storyOpenedBy) || task.storyOpenedBy || '',
    storyOpenedByName: userName(detail.story?.openedBy || detail.storyOpenedBy) || task.storyOpenedByName || '',
    productOwner: accountName(detail.productOwner || detail.story?.openedBy || detail.storyOpenedBy) || task.productOwner || '',
    productOwnerName: userName(detail.productOwner || detail.story?.openedBy || detail.storyOpenedBy) || task.productOwnerName || '',
    files: detail.files || task.files || {},
    actions: detail.actions || task.actions || [],
    brother: detail.brother || task.brother || {},
    children: detail.children || task.children || [],
    zentao
  };
}

async function getOrGenerateZentaoArtBrief(task = {}, currentUser = {}, options = {}) {
  const group = artBriefGroupForTask(task);
  const existing = await getArtBriefByGroupKey(task.projectId || artProjectId, group.groupKey);
  if (!options.force && existing?.reportFile && await statIfExists(existing.reportFile) && !isEmptyArtBrief(existing) && artBriefRecordMatchesSourceTask(existing, task)) {
    const existingWithAiWork = enrichArtBriefDownloadUrls(existing);
    if (existingWithAiWork.aiWorkFile && await statIfExists(existingWithAiWork.aiWorkFile)) {
      return {
        ...existingWithAiWork,
        reused: true,
        reusedAt: new Date().toISOString(),
        reusedFromTaskId: task.id || '',
        currentTaskId: task.id || '',
        currentTaskNo: task.taskNo || ''
      };
    }
  }
  const sourceTask = await resolveArtBriefSourceTask(task, group);
  const generated = await generateZentaoArtBrief(sourceTask);
  const record = await upsertArtBrief({
    ...generated,
    id: `art_brief_${safeFileSegment(group.groupKey)}`,
    projectId: task.projectId || sourceTask.projectId || artProjectId,
    ...group,
    taskId: sourceTask.id || task.id || '',
    taskNo: sourceTask.taskNo || sourceTask.zentao?.id || task.taskNo || task.zentao?.id || '',
    title: sourceTask.title || sourceTask.name || task.title || '',
    generatedBy: currentUser.id || '',
    generatedByName: currentUser.displayName || currentUser.username || '',
    raw: {
      ...generated,
      requestedTaskId: task.id || '',
      requestedTaskNo: task.taskNo || '',
      sourceTaskId: sourceTask.id || '',
      sourceTaskNo: sourceTask.taskNo || sourceTask.zentao?.id || '',
      sourceTaskTitle: sourceTask.title || sourceTask.name || ''
    }
  });
  return {
    ...enrichArtBriefDownloadUrls({ ...record, reportUrl: record.reportUrl || generated.reportUrl }),
    reused: false,
    regenerated: options.force === true,
    sourceTaskId: sourceTask.id || '',
    sourceTaskNo: sourceTask.taskNo || sourceTask.zentao?.id || '',
    sourceTaskTitle: sourceTask.title || sourceTask.name || '',
    currentTaskId: task.id || '',
    currentTaskNo: task.taskNo || ''
  };
}

function enrichArtBriefDownloadUrls(record = {}) {
  const taskNo = String(record.taskNo || record.taskId || '').trim();
  const reportFile = record.reportFile || record.htmlPath || record.raw?.htmlPath || '';
  const aiWorkFile = record.aiWorkFile
    || record.raw?.aiWorkFile
    || record.raw?.aiWorkPath
    || inferAiWorkFileFromReport(reportFile, taskNo);
  const manifestFile = record.manifestFile || record.raw?.manifestFile || record.raw?.manifestPath || '';
  return {
    ...record,
    reportFile,
    aiWorkFile,
    manifestFile,
    reportUrl: record.reportUrl || (reportFile ? `/api/artifact?path=${encodeURIComponent(reportFile)}` : ''),
    aiWorkUrl: record.aiWorkUrl || (aiWorkFile ? `/api/artifact?path=${encodeURIComponent(aiWorkFile)}&download=${encodeURIComponent(`${taskNo || '任务'}-AI工作说明.md`)}` : '')
  };
}

function inferAiWorkFileFromReport(reportFile = '', taskNo = '') {
  if (!reportFile || !taskNo) return '';
  return path.join(path.dirname(reportFile), `${taskNo}-AI工作说明.md`);
}

function isEmptyArtBrief(record = {}) {
  return !record.needs?.length && !record.avoid?.length && !record.confirm?.length;
}

async function resolveArtBriefSourceTask(task = {}, group = artBriefGroupForTask(task)) {
  const hydratedTask = await hydrateTaskForArtBrief(task);
  const directText = artBriefDirectSourceText(hydratedTask);
  if (directText.trim() || artBriefSourceText(hydratedTask).trim()) return hydratedTask;
  const candidates = await artBriefSourceCandidates(hydratedTask, group);
  const sorted = candidates
    .filter(candidate => artBriefComparableTitle(candidate) === artBriefComparableTitle(hydratedTask))
    .map(candidate => ({ candidate, score: artBriefSourceScore(candidate, hydratedTask) }))
    .sort((a, b) => b.score - a.score);
  return sorted[0]?.candidate || hydratedTask;
}

async function artBriefSourceCandidates(task = {}, group = artBriefGroupForTask(task)) {
  const projectId = task.projectId || artProjectId;
  const hydratedTask = await hydrateTaskForArtBrief(task);
  const rows = [
    hydratedTask,
    ...artBriefSiblingSourceRows(hydratedTask)
  ];
  try {
    rows.push(...await listTasks({ projectId }));
  } catch {}
  try {
    rows.push(...await listArtSnapshotTasks(projectId));
  } catch {}

  const seen = new Set();
  return rows
    .filter(Boolean)
    .map(row => normalizeArtBriefCandidateTask(row, task))
    .filter(row => artBriefGroupForTask(row).groupKey === group.groupKey)
    .filter(row => artBriefSourceMatchesGroup(row, group))
    .filter(row => {
      const key = String(row.id || row.taskNo || row.title || row.name || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function artBriefSiblingSourceRows(task = {}) {
  const rows = [];
  const siblings = task.brother && typeof task.brother === 'object' ? Object.values(task.brother) : [];
  for (const sibling of siblings) {
    if (!sibling || typeof sibling !== 'object') continue;
    rows.push({
      ...sibling,
      id: `${task.projectId || artProjectId}_${sibling.id || sibling.taskID || ''}`,
      projectId: task.projectId || artProjectId,
      taskNo: String(sibling.id || sibling.taskID || '').trim(),
      title: sibling.name || sibling.title || '',
      displayTitle: sibling.name || sibling.title || '',
      name: sibling.name || sibling.title || '',
      requirement: sibling.desc || '',
      description: sibling.desc || '',
      desc: sibling.desc || '',
      files: sibling.files || {},
      actions: sibling.actions || [],
      zentao: {
        ...(task.zentao || {}),
        id: sibling.id || sibling.taskID || '',
        parent: sibling.parent || task.zentao?.parent || '',
        story: sibling.story || sibling.storyID || task.zentao?.story || '',
        storyTitle: sibling.storyTitle || task.zentao?.storyTitle || '',
        execution: sibling.execution || task.zentao?.execution || ''
      }
    });
  }
  return rows;
}

function artBriefSourceMatchesGroup(task = {}, group = {}) {
  if (group.groupType === 'demand') {
    const linkedDemand = artBriefLinkedDemand(task);
    return linkedDemand.id && group.groupKey.endsWith(`:${linkedDemand.id}`);
  }
  if (group.groupType === 'story') {
    const storyId = cleanBriefPart(task.zentao?.story || task.story || task.storyId || task.storyID);
    return storyId && storyId !== '0' && group.groupKey.endsWith(`:${storyId}`);
  }
  return true;
}

function normalizeArtBriefCandidateTask(row = {}, fallback = {}) {
  const taskNo = String(row.taskNo || row.zentao?.id || row.id || '').trim();
  const title = row.title || row.displayTitle || row.name || '';
  const zentao = {
    ...(row.zentao || {}),
    id: row.zentao?.id || row.taskNo || row.id,
    story: row.zentao?.story || row.story || row.storyId || row.storyID || fallback.zentao?.story || fallback.story || '',
    storyTitle: row.zentao?.storyTitle || row.storyTitle || fallback.zentao?.storyTitle || fallback.storyTitle || '',
    parentName: row.zentao?.parentName || row.parentName || fallback.zentao?.parentName || fallback.parentName || '',
    execution: row.zentao?.execution || row.executionId || row.execution || fallback.zentao?.execution || fallback.executionId || ''
  };
  return {
    ...fallback,
    ...row,
    id: row.id ? String(row.id) : `${fallback.projectId || artProjectId}_${taskNo || safeFileSegment(title)}`,
    projectId: row.projectId || fallback.projectId || artProjectId,
    taskNo,
    title,
    displayTitle: row.displayTitle || title,
    name: row.name || title,
    requirement: row.requirement || row.desc || row.description || fallback.requirement || '',
    description: row.description || row.desc || row.requirement || '',
    summary: row.summary || fallback.summary || '',
    zentao
  };
}

function artBriefSourceScore(task = {}, requestedTask = {}) {
  const title = String(task.title || task.displayTitle || task.name || '');
  const text = artBriefSourceText(task);
  const directText = artBriefDirectSourceText(task);
  const sameTask = task.id === requestedTask.id || String(task.taskNo || '') === String(requestedTask.taskNo || '');
  const sameBaseTitle = artBriefComparableTitle(task) && artBriefComparableTitle(task) === artBriefComparableTitle(requestedTask);
  let score = 0;
  if (sameTask) score += directText.trim() ? 160 : 15;
  if (!sameTask && sameBaseTitle && directText.trim()) score += 170;
  if (/【\s*美术单\s*】|美术/.test(title)) score += 90;
  if (/【\s*制作单\s*】/.test(title)) score += 70;
  if (/【\s*需求单\s*】/.test(title)) score += 55;
  if (/美术|效果图|UI|图标|切图|视觉|样式|蒙版|锁住|未解锁|资源|图片|素材/.test(directText)) score += 120;
  else if (/美术|效果图|UI|图标|切图|视觉|样式|蒙版|锁住|未解锁|资源|图片|素材/.test(text)) score += 30;
  if (directText.length > 40) score += Math.min(50, Math.floor(directText.length / 20));
  else if (text.length > 40) score += Math.min(20, Math.floor(text.length / 80));
  if (/<img\b/i.test(directText) || /\{\d+\.(png|jpg|jpeg|webp|gif)\}/i.test(directText)) score += 80;
  if (!directText.trim()) score -= 80;
  if (!text.trim()) score -= 120;
  return score;
}

function artBriefDirectSourceText(task = {}) {
  return [
    task.requirement,
    task.description,
    task.desc,
    task.summary
  ].filter(Boolean).join('\n');
}

function artBriefSourceText(task = {}) {
  return [
    task.requirement,
    task.description,
    task.desc,
    task.summary,
    task.zentao?.storySpec,
    task.zentao?.storyVerify,
    task.storySpec,
    task.storyVerify
  ].filter(Boolean).join('\n');
}

function artBriefComparableTitle(task = {}) {
  return String(task.title || task.displayTitle || task.name || '')
    .replace(/【[^】]+】/g, '')
    .replace(/\b(web|cocos)\s*\d*(?:-\d+)?\b/gi, '')
    .replace(/\bweb\d+(?:-\d+)?\b/gi, '')
    .replace(/\bcocos\d+(?:-\d+)?\b/gi, '')
    .replace(/[-_—]+/g, ' ')
    .replace(/美术|测试|用例|联调|帐服|账服|后端|前端|开发|制作/gi, '')
    .replace(/\s+/g, '')
    .trim();
}

async function attachArtBriefsToTasks(tasks = []) {
  const briefs = await listArtBriefs();
  const taskByNo = new Map(tasks
    .map(task => [String(task.taskNo || task.zentao?.id || '').trim(), task])
    .filter(([taskNo]) => taskNo));
  const briefByGroup = new Map();
  const briefByTaskNo = new Map();
  for (const brief of briefs) {
    if (!brief.reportFile || !(await statIfExists(brief.reportFile))) continue;
    if (!artBriefRecordMatchesSourceTask(brief, taskByNo.get(String(brief.taskNo || '').trim()))) continue;
    const key = `${brief.projectId}:${brief.groupKey}`;
    const record = enrichArtBriefDownloadUrls(brief);
    if (!briefByGroup.has(key)) briefByGroup.set(key, record);
    const relatedTask = taskByNo.get(String(brief.taskNo || '').trim());
    if (relatedTask) {
      const currentGroup = artBriefGroupForTask(relatedTask);
      const currentKey = `${relatedTask.projectId || brief.projectId || artProjectId}:${currentGroup.groupKey}`;
      if (!briefByGroup.has(currentKey)) briefByGroup.set(currentKey, record);
    }
    if (brief.taskNo) briefByTaskNo.set(`${brief.projectId}:${brief.taskNo}`, record);
  }
  return tasks.map(task => {
    const group = artBriefGroupForTask(task);
    const projectId = task.projectId || artProjectId;
    const brief = briefByGroup.get(`${projectId}:${group.groupKey}`)
      || briefByTaskNo.get(`${projectId}:${task.taskNo || task.zentao?.id || ''}`)
      || null;
    return brief ? { ...task, artBrief: brief, artBriefGroup: group } : { ...task, artBriefGroup: group };
  });
}

function artBriefRecordMatchesSourceTask(brief = {}, sourceTask = null) {
  if (!sourceTask) return true;
  const sourceGroup = artBriefGroupForTask(sourceTask);
  if (brief.groupKey === sourceGroup.groupKey) {
    if (brief.taskNo && sourceTask.taskNo && String(brief.taskNo) !== String(sourceTask.taskNo)) {
      const briefTitle = cleanBriefPart(brief.title || brief.groupTitle || '');
      const sourceTitle = cleanBriefPart(sourceTask.title || sourceTask.displayTitle || sourceTask.name || '');
      return Boolean(briefTitle && sourceTitle && (briefTitle.includes(sourceTitle) || sourceTitle.includes(briefTitle)));
    }
    return true;
  }
  if (/^(demand|story):/.test(brief.groupKey) && /^(demand|story):/.test(sourceGroup.groupKey)) return false;
  return false;
}

function artBriefGroupForTask(task = {}) {
  const linkedDemand = artBriefLinkedDemand(task);
  const project = cleanBriefPart(task.projectId || artProjectId);
  if (linkedDemand.id) {
    return {
      groupKey: `demand:${project}:${linkedDemand.id}`,
      groupType: 'demand',
      groupTitle: linkedDemand.title || `需求 #${linkedDemand.id}`
    };
  }
  const storyId = cleanBriefPart(task.zentao?.story || task.story || task.storyId || task.storyID);
  const storyTitle = cleanBriefPart(task.zentao?.storyTitle || task.storyTitle);
  const parentName = cleanBriefPart(task.zentao?.parentName || task.parentName);
  const execution = cleanBriefPart(task.zentao?.execution || task.executionId || task.execution);
  if (storyId && storyId !== '0') {
    return {
      groupKey: `story:${project}:${storyId}`,
      groupType: 'story',
      groupTitle: storyTitle || parentName || `需求 ${storyId}`
    };
  }
  if (parentName) {
    return {
      groupKey: `parent:${project}:${safeFileSegment(parentName)}`,
      groupType: 'parent',
      groupTitle: parentName
    };
  }
  if (storyTitle) {
    return {
      groupKey: `story-title:${project}:${safeFileSegment(storyTitle)}`,
      groupType: 'storyTitle',
      groupTitle: storyTitle
    };
  }
  const taskNo = cleanBriefPart(task.taskNo || task.zentao?.id || task.id);
  return {
    groupKey: `task:${project}:${taskNo || safeFileSegment(task.title || task.id || 'unknown')}`,
    groupType: 'task',
    groupTitle: cleanBriefPart(task.title || task.displayTitle) || (taskNo ? `任务 ${taskNo}` : '未命名任务')
  };
}

function artBriefLinkedDemand(task = {}) {
  const text = [
    task.requirement,
    task.description,
    task.desc,
    task.summary,
    task.zentao?.storyTitle,
    task.zentao?.parentName,
    task.title,
    task.displayTitle,
    task.name
  ].filter(Boolean).join('\n');
  const match = String(text || '').match(/关联需求\s*#\s*(\d+)\s*[：:]\s*([^。\n<]+)/);
  if (match) {
    return {
      id: match[1],
      title: cleanBriefPart(match[2]) || `需求 #${match[1]}`
    };
  }
  return { id: '', title: '' };
}

function cleanBriefPart(value = '') {
  return String(value ?? '').trim();
}

async function refreshTrackedZentaoTasks(project, taskNos = new Set(), existingTaskByNo = new Map(), artAccounts = new Set(), userNames = new Map(), concurrency = 4) {
  const ids = [...taskNos].filter(Boolean);
  const refreshedTasks = [];
  const failed = [];
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const taskNo = ids[cursor];
      cursor += 1;
      try {
        const payload = await callZentaoRead(({ api: zentaoApi, modules: zentao }) => zentao.getTask(zentaoApi, { id: taskNo }));
        const task = unwrapZentaoTaskPayload(payload);
        if (!task || !(task.id || task.taskID)) throw new Error(`ZenTao 未返回任务详情：${describeZentaoPayloadShape(payload)}`);
        for (const detailTask of expandZentaoDetailTasks(task)) {
          const detailTaskNo = String(detailTask.id || detailTask.taskID || '').trim();
          const existingTask = existingTaskByNo.get(detailTaskNo);
          const isRequestedTaskNo = String(taskNo) === detailTaskNo || ids.includes(detailTaskNo);
          const isCurrent = isCurrentArtZentaoTask(detailTask, artAccounts);
          if (!isRequestedTaskNo && !isCurrent) continue;
          const executionId = detailTask.execution || existingTask?.zentao?.execution || '';
          const normalized = normalizeZentaoTask(
            project,
            {
              ...detailTask,
              executionName: detailTask.executionName || existingTask?.zentao?.executionName || ''
            },
            executionId,
            userNames
          );
          refreshedTasks.push({
            ...normalized,
            id: existingTask?.id || normalized.id,
            isCurrent,
            syncStatus: isCurrent ? 'current' : 'non_current',
            archivedAt: isCurrent ? '' : existingTask?.archivedAt || normalized.lastSyncedAt
          });
        }
      } catch (error) {
        failed.push({ taskNo: String(taskNo), error: error.message || String(error) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(ids.length, 1)) }, () => worker()));

  return {
    tasks: refreshedTasks,
    refreshed: refreshedTasks.length,
    failed
  };
}

function unwrapZentaoTaskPayload(payload = {}) {
  const candidates = [
    payload?.result?.task,
    payload?.result,
    payload?.data?.task,
    payload?.data,
    payload?.task,
    payload
  ];
  return candidates.find(candidate => candidate && typeof candidate === 'object' && (candidate.id || candidate.taskID)) || null;
}

function describeZentaoPayloadShape(payload = {}) {
  if (!payload || typeof payload !== 'object') return typeof payload;
  const result = payload.result;
  const data = payload.data;
  return JSON.stringify({
    status: payload.status,
    msg: payload.msg,
    keys: Object.keys(payload).slice(0, 12),
    resultType: Array.isArray(result) ? 'array' : typeof result,
    resultKeys: result && typeof result === 'object' && !Array.isArray(result) ? Object.keys(result).slice(0, 12) : [],
    dataType: Array.isArray(data) ? 'array' : typeof data,
    dataKeys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 12) : []
  });
}

function isReliableZentaoCurrentSnapshot({
  currentOnlySync = false,
  classicUserTaskDiscovery = {},
  detailRefresh = {},
  detailRefreshCandidateCount = 0,
  executionSummaries = []
} = {}) {
  const discoveryUsers = Number(classicUserTaskDiscovery.users || 0);
  const discoveryFailed = Number(classicUserTaskDiscovery.failed || 0);
  const discoveryPages = Number(classicUserTaskDiscovery.pages || 0);
  const discoveryDiscovered = Number(classicUserTaskDiscovery.discovered || classicUserTaskDiscovery.taskNos?.length || 0);
  const discoveryReliable = classicUserTaskDiscovery.enabled !== false
    && !classicUserTaskDiscovery.reason
    && discoveryUsers > 0
    && discoveryPages > 0
    && discoveryFailed < discoveryUsers
    && discoveryDiscovered > 0;
  const refreshFailed = Array.isArray(detailRefresh.failed)
    ? detailRefresh.failed.length
    : Number(detailRefresh.failed || 0);
  const refreshCandidates = Number(detailRefreshCandidateCount || 0);
  const detailReliable = refreshCandidates > 0
    && Number(detailRefresh.refreshed || 0) > 0
    && refreshFailed < refreshCandidates;
  if (currentOnlySync) return discoveryReliable || detailReliable;
  const executionReliable = executionSummaries.some(item => Number(item.matched || 0) > 0 && !item.error);
  return discoveryReliable || detailReliable || executionReliable;
}

async function discoverZentaoUserAssignedTaskNos(artUsers = [], options = {}) {
  if (options.classicUserDiscovery === false || options.userTaskDiscovery === false) {
    return {
      enabled: false,
      reason: 'disabled',
      taskNos: [],
      discovered: 0,
      users: 0,
      pages: 0,
      failed: 0,
      failures: []
    };
  }
  const users = artUsers
    .map(user => ({
      account: zentaoUserAccount(user),
      realname: user.realname || user.name || user.account || '',
      userId: zentaoUserNumericId(user)
    }))
    .filter(user => user.userId);
  const result = {
    enabled: true,
    source: 'zentao-classic-user-task',
    taskNos: [],
    discovered: 0,
    users: users.length,
    pages: 0,
    failed: 0,
    failures: []
  };
  if (!users.length) {
    result.reason = 'missing-user-id';
    return result;
  }

  const taskNos = new Set();
  let cursor = 0;
  const concurrency = Math.min(Math.max(Number(options.userTaskDiscoveryConcurrency || zentaoClassicUserTaskConcurrency), 1), 12);
  async function worker() {
    while (cursor < users.length) {
      const user = users[cursor];
      cursor += 1;
      try {
        const userResult = await discoverZentaoUserAssignedTaskNosForUser(user, options);
        for (const taskNo of userResult.taskNos) taskNos.add(taskNo);
        result.pages += userResult.pages;
      } catch (error) {
        result.failed += 1;
        result.failures.push({
          account: user.account,
          realname: user.realname,
          userId: user.userId,
          error: error.message || String(error)
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(users.length, 1)) }, () => worker()));
  result.taskNos = [...taskNos].sort((a, b) => Number(a) - Number(b));
  result.discovered = result.taskNos.length;
  return result;
}

async function discoverZentaoUserAssignedTaskNosForUser(user = {}, options = {}) {
  const taskNos = new Set();
  const maxPages = Math.min(Math.max(Number(options.userTaskMaxPages || zentaoClassicUserTaskMaxPages), 1), 300);
  let totalPages = 1;
  let pages = 0;
  for (let page = 1; page <= totalPages && page <= maxPages; page += 1) {
    const pathname = `index.php?m=user&f=task&userID=${encodeURIComponent(user.userId)}&type=assignedTo&recTotal=0&recPerPage=1&pageID=${page}`;
    const html = await zentaoClassicGet(pathname);
    pages += 1;
    for (const taskNo of parseZentaoClassicTaskNos(html)) taskNos.add(taskNo);
    if (page === 1) {
      const total = parseZentaoClassicRecTotal(html);
      totalPages = Math.min(Math.max(total || 1, 1), maxPages);
    }
  }
  return {
    account: user.account,
    realname: user.realname,
    userId: user.userId,
    taskNos: [...taskNos],
    pages
  };
}

function parseZentaoClassicTaskNos(html = '') {
  const taskNos = new Set();
  const text = String(html || '');
  for (const match of text.matchAll(/m=task&f=view&taskID=(\d{1,9})/g)) taskNos.add(String(match[1]));
  for (const match of text.matchAll(/task-view-(\d{1,9})\.html/g)) taskNos.add(String(match[1]));
  for (const match of text.matchAll(/data-id=["']?(\d{1,9})["']?/g)) {
    if (new RegExp(`task-(?:view|edit|start|finish|close)-${match[1]}|m=task&f=view&taskID=${match[1]}`).test(text)) {
      taskNos.add(String(match[1]));
    }
  }
  return [...taskNos].filter(taskNo => /^\d+$/.test(taskNo));
}

function parseZentaoClassicRecTotal(html = '') {
  const text = String(html || '');
  const matches = [
    text.match(/recTotal[=:](\d+)/i),
    text.match(/recTotal=(\d+)/i),
    text.match(/data-rec-total=["']?(\d+)["']?/i)
  ];
  for (const match of matches) {
    const total = Number(match?.[1] || 0);
    if (Number.isFinite(total) && total > 0) return total;
  }
  return 1;
}

async function zentaoClassicGet(pathname, refererPath = '') {
  const { api } = await zentaoContext();
  const cookies = await getZentaoActionClassicCookies(api);
  const baseUrl = zentaoClassicBaseUrl(api);
  const url = `${baseUrl}/${String(pathname || '').replace(/^\/+/, '')}`;
  const res = await fetch(url, {
    headers: {
      Cookie: cookies,
      Referer: `${baseUrl}/${String(refererPath || pathname || '').replace(/^\/+/, '')}`
    },
    redirect: 'manual'
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`禅道经典页面 HTTP ${res.status}`);
  if (isZentaoClassicLoginPage(text)) {
    await getZentaoActionClassicCookies(api, { force: true });
    throw new Error('禅道经典页面登录失效，无法读取人员任务页');
  }
  return text;
}

function zentaoClassicBaseUrl(api = {}) {
  const raw = String(api.baseUrl || zentaoBaseUrl || '').replace(/\/$/, '');
  if (!raw) return '';
  return raw.replace(/\/api\.php\/v1.*$/i, '').replace(/\/index\.php.*$/i, '');
}

function isZentaoClassicLoginPage(html = '') {
  return /m=user&f=login|user-login|用户登录|name=["']account["'][\s\S]*name=["']password["']/i.test(String(html || ''));
}

function expandZentaoDetailTasks(task = {}) {
  const children = Array.isArray(task.children) ? task.children : [];
  const brothers = Array.isArray(task.brother)
    ? task.brother
    : task.brother && typeof task.brother === 'object'
      ? Object.values(task.brother)
      : [];
  if (!children.length && !brothers.length) return [task];
  const parentName = task.name || task.title || task.parentName || '';
  const parentExecutionName = task.executionName || task.execution?.name || '';
  const parentStoryTitle = task.storyTitle || task.story?.title || '';
  const related = [
    ...children.map(child => ({
      ...child,
      parentName: child.parentName || parentName,
      executionName: child.executionName || parentExecutionName,
      storyTitle: child.storyTitle || parentStoryTitle,
      story: child.story || task.story || task.storyID || '',
      storyID: child.storyID || task.storyID || task.story || ''
    })),
    ...brothers.map(brother => ({
      ...brother,
      parentName: brother.parentName || parentName,
      executionName: brother.executionName || parentExecutionName,
      storyTitle: brother.storyTitle || parentStoryTitle,
      story: brother.story || task.story || task.storyID || '',
      storyID: brother.storyID || task.storyID || task.story || ''
    }))
  ];
  const byTaskNo = new Map();
  for (const item of [task, ...related]) {
    const taskNo = String(item.id || item.taskID || '').trim();
    if (taskNo) byTaskNo.set(taskNo, item);
  }
  return [...byTaskNo.values()];
}

async function syncZentaoBugs(project, options = {}) {
  const startedAt = new Date().toISOString();
  markZentaoQueueRunning('bugs', {
    projectId: project.id,
    trigger: options.trigger || zentaoAutoSyncState.trigger || 'manual',
    startedAt
  });
  zentaoAutoSyncState = {
    ...zentaoAutoSyncState,
    running: true,
    projectId: project.id,
    lastStartedAt: startedAt,
    lastError: ''
  };
  try {
    const result = await syncZentaoBugsForProject(project, {
      ...options,
      products: options.products || options.product || options.productIds || zentaoBugProductIds,
      artDeptId: zentaoArtDeptId
    });
    markZentaoQueueSuccess('bugs', result, result.syncedAt || new Date().toISOString());
    zentaoAutoSyncState = {
      ...zentaoAutoSyncState,
      running: hasRunningZentaoQueue(),
      lastFinishedAt: result.syncedAt || new Date().toISOString(),
      lastSuccessAt: result.syncedAt || new Date().toISOString(),
      lastError: '',
      lastSummary: compactZentaoSyncSummary({
        ...(zentaoAutoSyncState.lastSummary || {}),
        bugs: result
      })
    };
    broadcastPlatformEvent('tasks.changed', {
      projectId: project.id,
      module: 'bug-sync',
      syncKind: 'bug',
      syncedAt: result.syncedAt || new Date().toISOString(),
      created: result.created || 0,
      updated: result.updated || 0,
      removed: result.removed || 0
    });
    return result;
  } catch (error) {
    const failedAt = new Date().toISOString();
    const message = zentaoSyncErrorMessage(error);
    markZentaoQueueFailed('bugs', message, failedAt);
    if (/product ID/.test(error.message || '')) throw new HttpError(400, error.message);
    throw error;
  }
}

async function resolveZentaoExecutionIds(options = {}) {
  const configured = normalizeExecutionIds(options.executions || options.execution || options.executionIds);
  if (configured.length) return configured;
  const limit = Math.min(Math.max(Number(options.executionLimit || options.limitExecutions || 100), 10), 200);
  const maxPages = Math.min(Math.max(Number(options.executionMaxPages || 50), 1), 100);
  const executions = [];
  let page = 1;
  let total = 0;
  while (page <= maxPages) {
    const payload = await callZentaoRead(({ api: zentaoApi, modules: zentao }) => zentao.listExecutions(zentaoApi, { page, limit }));
    const result = payload.result || payload.data || payload;
    const pageExecutions = Array.isArray(result.executions) ? result.executions : Array.isArray(result) ? result : [];
    total = Number(result.total || pageExecutions.length || total);
    executions.push(...pageExecutions);
    if (!pageExecutions.length || executions.length >= total) break;
    page += 1;
  }
  const activeExecutions = executions.filter(execution => !/closed|done|cancel/i.test(String(execution.status || '')));
  const ids = activeExecutions.map(execution => execution.id || execution.execution || execution.executionID).filter(Boolean);
  if (!ids.length) throw new HttpError(502, 'ZenTao 同步失败：未获取到可同步的执行');
  return [...new Set(ids.map(String))];
}

async function getZentaoArtUsers() {
  let artUsers = await artDepartmentUsers({ fast: false });
  if (artUsers.length && artUsers.some(user => !zentaoUserNumericId(user))) {
    const liveUsers = await fetchZentaoDepartmentUsers();
    if (liveUsers.length) {
      artUsers = liveUsers;
      artDepartmentUsersCache = liveUsers;
      artDepartmentUsersCacheAt = Date.now();
    }
  }
  const artAccounts = new Set(artUsers.map(user => zentaoUserAccount(user)).filter(Boolean));
  if (!artAccounts.size) {
    throw new HttpError(502, `ZenTao 同步失败：未获取到部门 ID=${zentaoArtDeptId} 的美术人员，已保留现有任务列表。`);
  }
  return {
    artAccounts,
    artUserSource: artUsers.some(user => zentaoUserNumericId(user)) ? 'zentao-users' : 'platform-fallback',
    artUsers,
    userNames: new Map(artUsers
      .map(user => [zentaoUserAccount(user), user.realname || user.name || zentaoUserAccount(user)])
      .filter(([account]) => account))
  };
}

function zentaoUserAccount(user = {}) {
  return accountName(user.account || user.user || user.id || user.username);
}

function zentaoUserNumericId(user = {}) {
  const raw = user.userId ?? user.userID ?? user.uid ?? user.id ?? user.idNumber ?? user.user?.id ?? '';
  if (raw && typeof raw === 'object') return zentaoUserNumericId(raw);
  const text = String(raw || '').trim();
  if (!/^\d+$/.test(text)) return '';
  return text;
}

function zentaoUserDeptId(user = {}) {
  const raw = user.dept ?? user.deptID ?? user.deptId ?? user.departmentID ?? user.departmentId ?? user.department?.id ?? user.dept?.id ?? '';
  if (raw && typeof raw === 'object') return zentaoUserDeptId(raw);
  if (typeof raw === 'number') return raw;
  const match = String(raw || '').match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

function normalizeZentaoArtDeptIds(value = '') {
  const ids = String(value || '')
    .split(',')
    .map(item => Number(String(item || '').trim()))
    .filter(Number.isFinite);
  if (!ids.length) ids.push(zentaoArtDeptId || 27);
  return new Set(ids);
}

async function zentaoContext() {
  const [api, modules] = await Promise.all([getZentaoApi(), getZentaoModules()]);
  return { api, modules };
}

function isZentaoUnauthorizedPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return false;
  const text = [
    payload.status,
    payload.msg,
    payload.error,
    payload.result?.error,
    payload.data?.error
  ].map(value => String(value || '')).join('\n');
  return /unauthorized|无权|未授权|未登录|token/i.test(text);
}

async function callZentaoRead(operation) {
  const first = await operation(await zentaoContext());
  if (!isZentaoUnauthorizedPayload(first)) return first;
  resetZentaoApi();
  await getZentaoActionClassicCookies((await zentaoContext()).api, { force: true }).catch(() => {});
  const retry = await operation(await zentaoContext());
  return retry;
}

async function getZentaoArtUserList() {
  return artDepartmentUsers({ fast: true });
}

function parseCommandJson(stdout, command) {
  const raw = String(stdout || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (error) {
        throw new Error(`${command} 输出不是合法 JSON：${error.message}`);
      }
    }
    throw new Error(`${command} 没有返回 JSON`);
  }
}

function zentaoSyncErrorMessage(error) {
  const raw = [
    error?.stderr,
    error?.stdout,
    error?.message,
    String(error || '')
  ].map(value => String(value || '').trim()).find(Boolean) || '';
  if (/ENOTFOUND|getaddrinfo|fetch failed/i.test(raw)) return '当前网络无法连接禅道，已保留现有任务列表。';
  if (/ETIMEDOUT|timeout|timed out/i.test(raw)) return '禅道响应超时，已保留现有任务列表。';
  if (/未获取到可同步的执行/i.test(raw)) return '没有获取到符合美术部筛选条件的执行，已保留现有任务列表。';
  return raw || '禅道同步失败，已保留现有任务列表。';
}

function safeFileSegment(value = '') {
  return String(value || 'task')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'task';
}

function flattenZentaoTask(task) {
  const children = Array.isArray(task.children) ? task.children.flatMap(flattenZentaoTask) : [];
  return [task, ...children];
}

function isArtTask(task, artAccounts) {
  const assignedToCandidates = [
    task.assignedTo,
    task.zentao?.assignedTo
  ].map(accountName).filter(Boolean);
  return assignedToCandidates.some(assignedTo => artAccounts.has(assignedTo));
}

function isCurrentArtZentaoTask(task = {}, artAccounts = new Set()) {
  return isUnfinishedZentaoTask(task) && isArtTask(task, artAccounts);
}

function isArtAcceptanceOrDesignSyncTask(task = {}, existing = null) {
  const titleText = [
    task.name,
    task.title,
    task.storyTitle,
    task.story?.title,
    task.parentName,
    task.executionName,
    task.execution?.name,
    existing?.title,
    existing?.summary,
    existing?.zentao?.storyTitle,
    existing?.zentao?.parentName,
    existing?.zentao?.executionName
  ].map(value => String(value || '')).join('\n');
  if (/(?:美术)?验收单|美术验收|验收走查|走查单|设计同步单|设计同步/.test(titleText)) return true;

  const bodyText = [
    task.desc,
    task.requirement,
    task.type,
    task.taskType,
    existing?.requirement,
    existing?.zentao?.type,
    existing?.zentao?.taskType
  ].map(value => String(value || '')).join('\n');
  return /(?:任务类型|单据类型|流程类型|工单类型|类型)[：:\s]*(?:美术)?(?:验收|验收单|走查|走查单|设计同步|设计同步单)/.test(bodyText);
}

function isArtDepartmentZentaoTask(task = {}, existing = null) {
  if (existing?.source === 'zentao-art-snapshot' || existing?.currentOnArtMember === true) return true;
  const ownText = [
    task.name,
    task.title,
    existing?.title
  ].map(value => String(value || '')).join('\n');
  if (isNonArtWorkText(ownText) && !isArtSpecialSheetText(ownText)) return false;
  const text = [
    task.name,
    task.title,
    task.desc,
    task.requirement,
    task.storyTitle,
    task.story?.title,
    task.executionName,
    task.execution?.name,
    task.parentName,
    existing?.title,
    existing?.summary,
    existing?.requirement,
    existing?.zentao?.storyTitle,
    existing?.zentao?.parentName,
    existing?.zentao?.executionName
  ].map(value => String(value || '')).join('\n');
  if (!text.trim()) return false;
  if (isNonArtWorkText(text) && !isArtSpecialSheetText(text)) return false;
  const artPattern = /美术|制作单|验收单|设计|视觉|UI|UE|交互|图标|入口图|素材|皮肤|弹窗|界面|页面|布局|排版|颜色|字号|间距|圆角|组件|规范|Figma|figma|切图|贴图|资源图|效果图|官网素材|平台入口图|活动入口|导航栏|侧边栏|头像|背景|banner/i;
  if (artPattern.test(text)) return true;
  const assignedTo = accountName(task.assignedTo || existing?.assignedTo || existing?.zentao?.assignedTo);
  return Boolean(assignedTo && defaultArtUsers.some(user => user.account === assignedTo));
}

function isArtSpecialSheetText(text = '') {
  return /(?:美术)?验收单|美术验收|验收走查|走查单|设计同步单|设计同步/.test(String(text || ''));
}

function isNonArtWorkText(text = '') {
  return /【开发单】|前端|后端|客户端开发|服务端|接口|API|代码|自动化测试|技术代码评审/i.test(String(text || ''));
}

function isUnfinishedZentaoTask(task) {
  const status = String(task.status || '').toLowerCase();
  if (['done', 'closed', 'cancel', 'cancelled'].includes(status)) return false;
  if (task.deleted === true || task.deleted === '1') return false;
  return true;
}

async function latestArtSnapshot() {
  try {
    const files = await fs.readdir(artDashboardDataDir);
    const snapshots = files.filter(name => /^art_tasks_\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
    if (!snapshots.length) return null;
    const snapshotPath = path.join(artDashboardDataDir, snapshots.at(-1));
    const report = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
    return { report, snapshotPath };
  } catch {
    return null;
  }
}

async function artDepartmentUsers(options = {}) {
  const fast = options.fast === true;
  const now = Date.now();
  if (artDepartmentUsersCache?.length && now - artDepartmentUsersCacheAt < artDepartmentUsersCacheTtlMs) {
    return artDepartmentUsersCache;
  }
  if (fast) {
    if (!artDepartmentUsersRefreshPromise) {
      artDepartmentUsersRefreshPromise = fetchZentaoDepartmentUsers()
        .then(users => {
          if (users.length) {
            artDepartmentUsersCache = users;
            artDepartmentUsersCacheAt = Date.now();
          }
          return users;
        })
        .catch(error => {
          console.warn(`ZenTao art department user fetch failed: ${error.message}`);
          return [];
        })
        .finally(() => {
          artDepartmentUsersRefreshPromise = null;
        });
    }
    if (artDepartmentUsersCache?.length) return artDepartmentUsersCache;
    return fallbackArtDepartmentUsers();
  }

  const liveUsers = await fetchZentaoDepartmentUsers();
  if (liveUsers.length) {
    artDepartmentUsersCache = liveUsers;
    artDepartmentUsersCacheAt = Date.now();
    return liveUsers;
  }

  return fallbackArtDepartmentUsers();
}

async function fallbackArtDepartmentUsers() {
  const snapshot = await latestArtSnapshot();
  const report = snapshot?.report || {};
  const defaultsByAccount = new Map(defaultArtUsers.map(user => [user.account, user]));
  const defaultOwner = defaultsByAccount.get(report.owner_account || 'zhangqw') || defaultsByAccount.get('zhangqw') || {};
  const owner = {
    ...defaultOwner,
    account: report.owner_account || 'zhangqw',
    realname: report.owner_summary?.name || defaultOwner.realname || '张倩文',
    role: 'owner'
  };
  const members = (report.managed_members || report.art_members || defaultArtUsers)
    .filter(user => user?.account && user.account !== owner.account)
    .map(user => {
      const fallback = defaultsByAccount.get(user.account) || {};
      return {
        ...fallback,
        ...user,
        account: user.account,
        realname: user.realname || user.name || fallback.realname || user.account,
        role: user.role || fallback.role || 'member',
        userId: zentaoUserNumericId(user) || zentaoUserNumericId(fallback),
        userID: zentaoUserNumericId(user) || zentaoUserNumericId(fallback),
        dept: zentaoUserDeptId(user) || zentaoUserDeptId(fallback) || zentaoArtDeptId
      };
    });
  const byAccount = new Map(defaultArtUsers.map(user => [user.account, { ...user, dept: zentaoArtDeptId }]));
  byAccount.set(owner.account, owner);
  for (const member of members) byAccount.set(member.account, member);
  return sortArtDepartmentUsers([...byAccount.values()]);
}

async function fetchZentaoDepartmentUsers(deptId = null) {
  try {
    const deptIds = deptId === null ? zentaoArtDeptIds : new Set([Number(deptId)]);
    const users = [];
    const limit = 1000;
    let page = 1;
    let total = 0;
    while (page <= 20) {
      const payload = await callZentaoRead(({ api: zentaoApi, modules: zentao }) => zentao.listUsers(zentaoApi, { page, limit }));
      const result = payload.result || payload.data || payload;
      const pageUsers = Array.isArray(result.users) ? result.users : Array.isArray(result) ? result : [];
      total = Number(result.total || pageUsers.length || total);
      users.push(...pageUsers);
      if (!pageUsers.length || users.length >= total) break;
      page += 1;
    }
    return sortArtDepartmentUsers(users
      .filter(user => deptIds.has(zentaoUserDeptId(user)))
      .map(user => ({
        account: zentaoUserAccount(user),
        realname: user.realname || user.name || user.account,
        role: user.account === 'zhangqw' ? 'owner' : 'member',
        dept: zentaoUserDeptId(user),
        userId: zentaoUserNumericId(user),
        userID: zentaoUserNumericId(user)
      }))
      .filter(user => user.account));
  } catch (error) {
    console.warn(`ZenTao art department user fetch failed: ${error.message}`);
    return [];
  }
}

function sortArtDepartmentUsers(users = []) {
  const preferred = new Map(defaultArtUsers.map((user, index) => [user.account, index]));
  return [...users].sort((a, b) => {
    const ai = preferred.has(a.account) ? preferred.get(a.account) : 999;
    const bi = preferred.has(b.account) ? preferred.get(b.account) : 999;
    return ai - bi || String(a.realname || a.account).localeCompare(String(b.realname || b.account), 'zh-Hans-CN');
  });
}

async function ensureArtDepartmentSeed() {
  const users = await artDepartmentUsers({ fast: true });
  const existingUsers = await listPublicUsers();
  const byUsername = new Map(existingUsers.map(user => [user.username, user]));
  const byDisplayName = new Map();
  for (const existingUser of existingUsers) {
    const displayName = String(existingUser.displayName || '').trim();
    if (displayName && !byDisplayName.has(displayName)) byDisplayName.set(displayName, existingUser);
  }
  for (const user of users) {
    const isOwner = user.role === 'owner';
    const createInput = {
      username: user.account,
      displayName: user.realname,
      role: isOwner ? 'admin' : 'reviewer',
      projectIds: isOwner ? ['*'] : [artProjectId],
      mustChangePassword: false
    };
    const existing = byUsername.get(user.account) || byDisplayName.get(String(user.realname || '').trim());
    if (existing) {
      const updateInput = {
        username: user.account,
        displayName: user.realname,
        projectIds: existing.projectIds?.length ? existing.projectIds : (isOwner ? ['*'] : [artProjectId]),
        mustChangePassword: existing.mustChangePassword === true
      };
      await updateUser(existing.id, updateInput);
      byUsername.set(user.account, { ...existing, ...updateInput });
    } else {
      await createUser({ ...createInput, password: 'Art@123456' });
    }
  }
}

async function ensureArtDepartmentProject() {
  const project = {
    id: artProjectId,
    name: '美术部门资料库',
    sourceType: 'research',
    relatedProjectName: '美术工作台',
    rootPath: process.env.ART_PLATFORM_PROJECT_ROOT || path.join(paths.dataDir, 'art-git'),
    framework: '美术资料库',
    agentConfigPath: 'Design/README.md',
    skillConfigPath: 'Design/README.md',
    taskDir: '.task',
    git: {
      remoteUrl: process.env.ART_GIT_SKILL_REPO_URL || 'http://192.168.1.28:8090/art-project/Art.git',
      defaultBaseBranch: 'master'
    }
  };
  await upsertProject(project);
}

async function listArtSnapshotTasks(projectId = artProjectId) {
  const snapshot = await latestArtSnapshot();
  if (!snapshot?.report) return [];
  const report = snapshot.report;
  const active = new Set(['wait', 'doing', 'testing', 'pause', 'waittest']);
  return (report.art_open_tasks || [])
    .filter(task => active.has(task.status) && task.currentOnArtMember !== false)
    .map(task => artTaskToPlatformTask(report, task, projectId));
}

async function listArtSeenCandidateTaskNos(options = {}) {
  const names = [
    'zentao_owner_seen_items_zhangqw.json',
    'zentao_seen_items.json',
    'zentao_seen_items_zhangqw.json'
  ];
  const taskNos = new Set();
  const maxAgeMs = Number(options.maxAgeMs || 0);
  const now = Date.now();
  for (const name of names) {
    try {
      const file = path.join(artDashboardDataDir, name);
      if (maxAgeMs > 0) {
        const stat = await fs.stat(file);
        if (now - stat.mtimeMs > maxAgeMs) continue;
      }
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      const seen = data?.seen && typeof data.seen === 'object' ? data.seen : {};
      for (const item of Object.values(seen)) {
        const taskNo = artSeenCandidateTaskNo(item);
        if (taskNo) taskNos.add(taskNo);
      }
    } catch {
      // 旧看板记录只作为禅道详情补刷候选，缺失时忽略。
    }
  }
  return [...taskNos];
}

function zentaoCurrentDetailRefreshTaskNos(existingZentaoTasks = [], artSnapshotTasks = [], artSeenCandidateTaskNos = [], aiFlowTaskNos = []) {
  const taskNos = new Set();
  for (const task of existingZentaoTasks) {
    if (task?.taskNo && task.isCurrent !== false) taskNos.add(String(task.taskNo));
  }
  for (const task of artSnapshotTasks) {
    if (task?.taskNo && task.isCurrent !== false) taskNos.add(String(task.taskNo));
  }
  for (const taskNo of artSeenCandidateTaskNos) {
    if (taskNo) taskNos.add(String(taskNo));
  }
  for (const taskNo of aiFlowTaskNos) {
    if (taskNo) taskNos.add(String(taskNo));
  }
  return taskNos;
}

function artSeenCandidateTaskNo(item = {}) {
  if (!item || String(item.type || '') !== '任务') return '';
  const taskNo = String(item.id || item.taskID || '').trim();
  if (!taskNo) return '';
  const title = item.title || titleFromZentaoSeenLabel(item.label) || '';
  const text = [
    title,
    item.label,
    item.executionName,
    item.storyTitle,
    item.parentName
  ].map(value => String(value || '')).join('\n');
  if (!isArtSpecialSheetText(text)) return '';
  if (hasFinishedOrClosedSeenItem(item)) return '';
  return taskNo;
}

function hasFinishedOrClosedSeenItem(item = {}) {
  const finished = String(item.finishedDate || '').trim();
  const closed = String(item.closedDate || '').trim();
  return Boolean(finished && !/^0{4}-0{2}-0{2}/.test(finished))
    || Boolean(closed && !/^0{4}-0{2}-0{2}/.test(closed));
}

function artSeenItemToPlatformTask(report = {}, item = {}, projectId = artProjectId) {
  if (!item || String(item.type || '') !== '任务') return null;
  const taskNo = String(item.id || item.taskID || '').trim();
  if (!taskNo) return null;
  const title = item.title || titleFromZentaoSeenLabel(item.label) || `美术任务 ${taskNo}`;
  const status = String(item.status || statusFromZentaoSeenLabel(item.label) || 'wait').trim();
  const active = new Set(['wait', 'doing', 'testing', 'pause', 'waittest']);
  if (!active.has(status)) return null;
  if (item.finishedDate && !String(item.finishedDate).startsWith('0000-00-00')) return null;
  if (item.closedDate && !String(item.closedDate).startsWith('0000-00-00')) return null;
  if (!isArtDepartmentZentaoTask({
    id: taskNo,
    name: title,
    title,
    status,
    assignedTo: item.assignedTo,
    executionName: item.executionName
  })) return null;
  const deadline = validDate(item.deadline || deadlineFromZentaoSeenLabel(item.label));
  const syncedAt = toIsoDate(report.updatedAt) || new Date().toISOString();
  const updatedAt = firstIsoDate(item.lastEditedDate, item.assignedDate, item.openedDate, syncedAt) || syncedAt;
  return {
    id: `art_task_${taskNo}`,
    projectId,
    taskNo,
    title,
    developer: item.assignedToRealName || item.assignedTo || '',
    assignedTo: item.assignedTo || '',
    source: 'zentao-art-snapshot',
    status: platformTaskStatus(status, item),
    zentaoStatus: status,
    isCurrent: true,
    syncStatus: 'current',
    lastSyncedAt: syncedAt,
    archivedAt: '',
    deadline,
    zentaoCreatedAt: toIsoDate(item.openedDate || item.assignedDate || ''),
    zentaoProgress: Number(item.progress || 0),
    completion: Number(item.progress || 0),
    summary: item.executionName ? `ZenTao执行：${item.executionName}` : '',
    issues: '',
    requirement: [item.executionName, item.parentName, item.storyTitle].filter(Boolean).join('\n'),
    zentao: {
      id: taskNo,
      taskUrl: item.url || `${zentaoBaseUrl}/index.php?m=task&f=view&taskID=${taskNo}`,
      originalStatus: status,
      assignedTo: item.assignedTo || '',
      assignedToName: item.assignedToRealName || '',
      deadline,
      execution: item.executionId || '',
      executionName: item.executionName || '',
      parentName: item.parentName || '',
      storyTitle: item.storyTitle || '',
      periodLabel: '',
      risks: artTaskRisks({ ...item, status, deadline }, localDateString())
    },
    createdAt: firstIsoDate(item.openedDate, item.assignedDate, syncedAt) || syncedAt,
    updatedAt
  };
}

function titleFromZentaoSeenLabel(label = '') {
  const parts = String(label || '').split('｜');
  return parts.length ? String(parts.at(-1) || '').trim() : '';
}

function statusFromZentaoSeenLabel(label = '') {
  const parts = String(label || '').split('｜').map(item => item.trim());
  const value = parts.find(part => /^(wait|doing|testing|pause|waittest|done|closed|cancel)$/i.test(part));
  return value || '';
}

function deadlineFromZentaoSeenLabel(label = '') {
  return String(label || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
}

async function listArtSnapshotBugs(projectId = artProjectId) {
  const snapshot = await latestArtSnapshot();
  if (!snapshot?.report) return [];
  const rows = [];
  for (const bucket of snapshot.report.bugs_by_person || []) {
    for (const bug of bucket.bugs || []) rows.push(artBugToPlatformBug(bug, bucket, projectId));
  }
  return rows.filter(bug => /active|激活|opened/i.test(bug.status || 'active'));
}

function artTaskToPlatformTask(report = {}, task = {}, projectId = artProjectId) {
  const taskNo = String(task.id || '').trim();
  const deadline = validDate(task.deadline || task._due);
  const snapshotSyncedAt = toIsoDate(report.generated_at) || validDate(report.today) || '';
  const updatedAt = firstIsoDate(task.lastEditedDate, task.assignedDate, task.openedDate, snapshotSyncedAt) || snapshotSyncedAt;
  return {
    id: `art_task_${taskNo}`,
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
    lastSyncedAt: snapshotSyncedAt,
    deadline,
    zentaoCreatedAt: toIsoDate(task.openedDate || task.assignedDate || ''),
    zentaoProgress: Number(task.progress || 0),
    completion: Number(task.progress || 0),
    summary: [task.parentName, task.storyTitle].filter(Boolean).join(' / '),
    issues: artTaskRiskText(task, report.today),
    requirement: [task.parentName, task.storyTitle, task.executionName].filter(Boolean).join('\n'),
    zentao: {
      id: taskNo,
      taskUrl: task.taskUrl || `${report.zentao_base_url || zentaoBaseUrl}/index.php?m=task&f=view&taskID=${taskNo}`,
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
    createdAt: firstIsoDate(task.openedDate, task.assignedDate, snapshotSyncedAt) || snapshotSyncedAt,
    updatedAt
  };
}

function artBugToPlatformBug(bug = {}, bucket = {}, projectId = artProjectId) {
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

function artTaskRiskText(task = {}, today = '') {
  return artTaskRisks(task, today).join('、');
}

function mergeArtSnapshotRows(snapshotRows = [], storedRows = []) {
  const map = new Map();
  for (const row of storedRows || []) {
    const key = rowIdentityKey(row);
    if (key) map.set(key, row);
  }
  for (const row of snapshotRows || []) {
    const key = rowIdentityKey(row);
    if (!key) continue;
    const existing = map.get(key);
    map.set(key, existing ? mergeLiveAndSnapshotRow(existing, row) : row);
  }
  return [...map.values()].sort((a, b) => String(b.updatedAt || b.lastSyncedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.lastSyncedAt || a.createdAt || '')));
}

function mergeLiveAndSnapshotRow(stored = {}, snapshot = {}) {
  const storedTime = comparableRowTime(stored);
  const snapshotTime = comparableRowTime(snapshot);
  const liveIsNewer = storedTime && (!snapshotTime || storedTime >= snapshotTime);
  const primary = liveIsNewer ? stored : snapshot;
  const secondary = liveIsNewer ? snapshot : stored;
  const merged = {
    ...secondary,
    ...primary,
    id: stored.id || snapshot.id,
    projectId: primary.projectId || secondary.projectId,
    taskNo: primary.taskNo || secondary.taskNo,
    bugNo: primary.bugNo || secondary.bugNo,
    source: primary.source || secondary.source,
    createdAt: stored.createdAt || snapshot.createdAt,
    updatedAt: latestDate(stored.updatedAt, snapshot.updatedAt),
    lastSyncedAt: latestDate(stored.lastSyncedAt, snapshot.lastSyncedAt),
    zentao: {
      ...(secondary.zentao || {}),
      ...(primary.zentao || {})
    }
  };
  if (hasManualTaskWorkloadOverride(stored) && !hasManualTaskWorkloadOverride(snapshot)) {
    merged.workloadLevel = stored.workloadLevel || stored.workloadEstimate?.level || '';
    merged.workloadEstimate = stored.workloadEstimate || null;
  }
  return merged;
}

function hasManualTaskWorkloadOverride(task = {}) {
  return Boolean(
    normalizeTaskWorkloadLevelInput(task.workloadLevel || task.workloadEstimate?.level)
    && (!task.workloadEstimate || task.workloadEstimate.source === 'manual')
  );
}

function comparableRowTime(row = {}) {
  return Math.max(
    parseRowDate(row.lastSyncedAt),
    parseRowDate(row.updatedAt),
    parseRowDate(row.createdAt)
  );
}

function parseRowDate(value = '') {
  const text = String(value || '').trim();
  if (!text || /^0{4}-0{2}-0{2}/.test(text)) return 0;
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : 0;
}

function rowIdentityKey(row = {}) {
  const projectId = row.projectId || '';
  const number = row.taskNo || row.bugNo || row.zentao?.id || row.id || '';
  return `${projectId}:${number}`;
}

function latestDate(a = '', b = '') {
  return String(a || '') > String(b || '') ? a : b;
}

function scheduleZentaoAutoSync() {
  if (process.env.ZENTAO_AUTO_SYNC !== '1') {
    console.log('ZenTao auto sync disabled; set ZENTAO_AUTO_SYNC=1 to enable background sync');
    return;
  }
  setTimeout(() => runZentaoAutoSync('initial'), zentaoAutoSyncInitialDelayMs);
  setInterval(() => runZentaoAutoSync('interval'), zentaoAutoSyncIntervalMs);
  console.log(`ZenTao auto sync enabled: project=${zentaoAutoSyncProjectId}, interval=${Math.round(zentaoAutoSyncIntervalMs / 60000)}m`);
}

async function runZentaoAutoSync(reason) {
  if (hasRunningZentaoQueue()) {
    console.log(`ZenTao auto sync skipped (${reason}): previous sync queue is still running`);
    return;
  }
  zentaoAutoSyncRunning = true;
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  markZentaoQueueRunning('tasks', { projectId: zentaoAutoSyncProjectId, trigger: reason, startedAt: startedAtIso });
  markZentaoQueueRunning('bugs', { projectId: zentaoAutoSyncProjectId, trigger: reason, startedAt: startedAtIso });
  zentaoAutoSyncState = {
    ...zentaoAutoSyncState,
    running: true,
    lastStartedAt: startedAtIso,
    lastError: ''
  };
  let summary = null;
  let bugSummary = null;
  let taskError = '';
  try {
    const { stdout } = await execFileAsync(process.execPath, [zentaoAutoSyncScript], {
      cwd: paths.root,
      timeout: Math.max(zentaoAutoSyncIntervalMs - 1000, 60000),
      maxBuffer: 1024 * 1024 * 20,
      env: {
        ...process.env,
        AWP_PROJECT_ID: zentaoAutoSyncProjectId,
        ZENTAO_ART_DEPT_ID: String(zentaoArtDeptId),
        ZENTAO_TASK_SCOPE: 'all'
      }
    });
    summary = parseCommandJson(stdout, 'sync-zentao-art-tasks');
    markZentaoQueueSuccess('tasks', summary, new Date().toISOString());
  } catch (error) {
    const stderr = String(error.stderr || '').trim();
    const stdout = String(error.stdout || '').trim();
    taskError = stderr || stdout || error.message;
    const snapshotFallback = await latestArtSnapshot();
    if (snapshotFallback?.report && process.env.ZENTAO_SNAPSHOT_FALLBACK !== '0') {
      const tasks = await listArtSnapshotTasks(zentaoAutoSyncProjectId);
      const bugs = await listArtSnapshotBugs(zentaoAutoSyncProjectId);
      summary = {
        source: 'art-dashboard-snapshot-fallback',
        snapshot: path.basename(snapshotFallback.snapshotPath),
        matchedTaskCount: tasks.length,
        totalTasks: tasks.length,
        liveSyncError: taskError
      };
      markZentaoQueueFailed('tasks', taskError, new Date().toISOString(), summary);
      console.error(`ZenTao live task sync failed (${reason}), snapshot fallback loaded: ${taskError}`);
    } else {
      markZentaoQueueFailed('tasks', taskError, new Date().toISOString());
      console.error(`ZenTao task auto sync failed (${reason}): ${taskError}`);
    }
  }

  try {
    const { stdout: bugStdout } = await execFileAsync(process.execPath, [zentaoBugSyncScript], {
      cwd: paths.root,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        AWP_PROJECT_ID: zentaoAutoSyncProjectId,
        ZENTAO_ART_DEPT_ID: String(zentaoArtDeptId),
        ZENTAO_BUG_PRODUCT_IDS: zentaoBugProductIds,
        ZENTAO_BUG_LIMIT: '100',
        ZENTAO_BUG_MAX_PAGES: '10'
      }
    });
    bugSummary = parseCommandJson(bugStdout, 'sync-zentao-art-bugs');
    markZentaoQueueSuccess('bugs', bugSummary, new Date().toISOString());
  } catch (error) {
    const stderr = String(error.stderr || '').trim();
    const stdout = String(error.stdout || '').trim();
    const message = stderr || stdout || error.message;
    bugSummary = { error: message };
    markZentaoQueueFailed('bugs', message, new Date().toISOString(), bugSummary);
    console.error(`ZenTao bug auto sync failed (${reason}): ${message}`);
  }

  try {
    const finishedAt = new Date().toISOString();
    const lastError = taskError || bugSummary?.error || '';
    zentaoAutoSyncState = {
      ...zentaoAutoSyncState,
      running: false,
      lastFinishedAt: finishedAt,
      lastSuccessAt: summary || (bugSummary && !bugSummary.error) ? finishedAt : zentaoAutoSyncState.lastSuccessAt,
      lastError,
      lastErrorAt: lastError ? finishedAt : zentaoAutoSyncState.lastErrorAt,
      lastSummary: compactZentaoSyncSummary({ ...summary, bugs: bugSummary })
    };
    console.log(`ZenTao auto sync done (${reason}): matched=${summary?.matchedTaskCount || 0}, bugs=${bugSummary?.total || bugSummary?.bugCount || 0}, ${Date.now() - startedAt}ms`);
  } finally {
    zentaoAutoSyncRunning = false;
    zentaoAutoSyncState = {
      ...zentaoAutoSyncState,
      running: hasRunningZentaoQueue()
    };
  }
}

function normalizeZentaoTask(project, task, execution, userNames = new Map()) {
  const taskNo = String(task.id || task.taskID || '').trim();
  const zentaoStatus = task.status || '';
  const estimate = Number(task.estimate || 0);
  const consumed = Number(task.consumed || 0);
  const left = Number(task.left || 0);
  const taskStatus = platformTaskStatus(zentaoStatus, task);
  const progress = taskStatus === 'passed'
    ? 100
    : Number(task.progress ?? (estimate ? Math.round((consumed / Math.max(estimate, consumed + left)) * 100) : 0));
  const storyTitle = task.storyTitle || task.story?.title || '';
  const openedBy = accountName(task.openedBy);
  const openedByName = userNames.get(openedBy) || userName(task.openedBy);
  const storyOpenedBy = accountName(task.story?.openedBy || task.storyOpenedBy);
  const storyOpenedByName = userNames.get(storyOpenedBy) || userName(task.story?.openedBy || task.storyOpenedBy);
  const productOwner = accountName(task.productOwner || task.story?.openedBy || task.storyOpenedBy);
  const productOwnerName = userNames.get(productOwner) || userName(task.productOwner || task.story?.openedBy || task.storyOpenedBy);
  const executionName = task.executionName || task.execution?.name || '';
  const assignee = accountName(task.assignedTo);
  const assignedTo = userNames.get(assignee) || userName(task.assignedTo) || task.assignedToRealName || '';
  const openedDate = toIsoDate(task.openedDate);
  return {
    id: `${project.id}_${taskNo}`,
    projectId: project.id,
    taskNo,
    title: task.name || task.title || `ZenTao task ${taskNo}`,
    developer: assignedTo,
    source: 'zentao',
    status: taskStatus,
    zentaoStatus,
    isCurrent: true,
    syncStatus: 'current',
    lastSyncedAt: new Date().toISOString(),
    archivedAt: '',
    deadline: validDate(task.deadline),
    zentaoCreatedAt: openedDate,
    zentaoProgress: progress,
    completion: progress,
    summary: [
      executionName ? `ZenTao执行：${executionName}` : `ZenTao执行ID：${execution}`,
      storyTitle ? `关联需求：${storyTitle}` : '',
      task.deadline ? `截止：${task.deadline}` : ''
    ].filter(Boolean).join('；'),
    issues: left ? `剩余工时：${left}` : '',
    requirement: task.desc || '',
    openedBy,
    openedByName,
    storyOpenedBy,
    storyOpenedByName,
    productOwner,
    productOwnerName,
    storySpec: task.storySpec || task.story?.spec || '',
    storyVerify: task.storyVerify || task.story?.verify || '',
    zentao: {
      id: Number(taskNo),
      project: task.project || '',
      execution: task.execution || execution,
      executionName,
      story: task.story || task.storyID || '',
      storyTitle,
      openedBy,
      openedByName,
      createdBy: openedBy,
      createdByName: openedByName,
      storyOpenedBy,
      storyOpenedByName,
      productOwner,
      productOwnerName,
      storySpec: task.storySpec || task.story?.spec || '',
      storyVerify: task.storyVerify || task.story?.verify || '',
      type: task.type || '',
      pri: task.pri || '',
      estimate,
      consumed,
      left,
      deadline: validDate(task.deadline),
      originalStatus: zentaoStatus,
      assignedTo: accountName(task.assignedTo),
      assignedToName: assignedTo,
      assignedToRealName: assignedTo,
      finishedBy: accountName(task.finishedBy),
      openedDate: task.openedDate || '',
      assignedDate: task.assignedDate || '',
      finishedDate: task.finishedDate || '',
      realStarted: task.realStarted || ''
    },
    createdAt: openedDate || new Date().toISOString()
  };
}

function normalizeExecutionIds(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  return [...new Set(raw.split(/[,，\s]+/).map(item => item.trim()).filter(Boolean))];
}

function userName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.realname || value.account || '';
}

function accountName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.account || value.realname || '';
}

function findArtAssignee(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  return defaultArtUsers.find(user => {
    const account = String(user.account || '').toLowerCase();
    const realname = String(user.realname || user.name || '').toLowerCase();
    return text === account || text === realname || text.includes(account) || text.includes(realname);
  }) || null;
}

function validDate(value) {
  const text = String(value || '');
  if (!text || /^0{4}-0{2}-0{2}/.test(text)) return '';
  return text.slice(0, 10);
}

function localDateString(date = new Date()) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toIsoDate(value) {
  const text = String(value || '');
  if (!text || /^0{4}-0{2}-0{2}/.test(text)) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function firstIsoDate(...values) {
  for (const value of values) {
    const parsed = toIsoDate(value);
    if (parsed) return parsed;
  }
  return '';
}

function platformTaskStatus(status = '', task = {}) {
  const value = String(status || '').toLowerCase();
  if (/done|closed|finished|completed|已完成|已关闭|完成/.test(value)) return 'passed';
  if (Number(task.progress || 0) >= 100 || validDate(task.finishedDate)) return 'passed';
  if (/doing|进行/.test(value)) return 'in_progress';
  if (/pause|cancel|暂停|取消/.test(value)) return 'blocked';
  return 'pending';
}

function normalizeTaskWorkloadLevelInput(value = '') {
  const text = String(value || '').trim().toUpperCase();
  return ['XS', 'S', 'M', 'L'].includes(text) ? text : '';
}

function isLowEffortArtAcceptanceTaskInput(task = {}) {
  const titleText = [
    task.title,
    task.displayTitle,
    task.name,
    task.taskName,
    task.taskNameAndNo,
    task.zentao?.name,
    task.zentao?.title,
    task.zentao?.taskName,
    task.zentao?.storyTitle,
    task.zentao?.parentName
  ].filter(Boolean).join('\n');
  if (/(?:美术)?验收单|美术验收|验收走查|走查单|设计同步单|设计同步/.test(titleText)) return true;

  const bodyText = [
    task.summary,
    task.requirement,
    task.description,
    task.type,
    task.taskType,
    task.zentao?.type,
    task.zentao?.taskType
  ].filter(Boolean).join('\n');
  return /(?:任务类型|单据类型|流程类型|工单类型|类型)[：:\s]*(?:美术)?(?:验收|验收单|走查|走查单|设计同步|设计同步单)/.test(bodyText);
}

function taskWorkloadGroupForTask(task = {}) {
  const project = cleanBriefPart(task.projectId || artProjectId);
  if (isIndependentTitleWorkloadOwnerTask(task)) {
    return titleWorkloadGroupForTask(task);
  }
  const demand = artBriefLinkedDemand(task);
  if (demand.id) return `demand:${project}:${demand.id}`;
  const storyId = cleanBriefPart(task.zentao?.story || task.story || task.storyId || task.storyID);
  if (storyId && storyId !== '0') return `story:${project}:${storyId}`;
  const parentId = cleanBriefPart(task.zentao?.parent || task.parent || task.parentId || task.parentID);
  if (parentId && parentId !== '0') return `parent-id:${project}:${parentId}`;
  const parentName = cleanBriefPart(task.zentao?.parentName || task.parentName);
  if (parentName) return `parent:${project}:${safeFileSegment(parentName)}`;
  const storyTitle = cleanBriefPart(task.zentao?.storyTitle || task.storyTitle);
  if (storyTitle) return `story-title:${project}:${safeFileSegment(storyTitle)}`;
  return '';
}

function taskMatchesWorkloadGroup(task = {}, group = '') {
  return taskWorkloadGroupForTask(task) === group || titleWorkloadGroupForTask(task) === group;
}

function titleWorkloadGroupForTask(task = {}) {
  const project = cleanBriefPart(task.projectId || artProjectId);
  const title = cleanBriefPart(cleanTaskCenterWorkloadTitle(task.title || task.displayTitle || task.zentao?.title || task.zentao?.name || task.taskNo || task.id));
  return title ? `title:${project}:${safeFileSegment(title)}` : '';
}

function isIndependentTitleWorkloadOwnerTask(task = {}) {
  const ownerText = [
    task.developer,
    task.assignedTo,
    task.assignedToName,
    task.openedByName,
    task.openedBy,
    task.creator,
    task.creatorName,
    task.createdBy,
    task.createdByName,
    task.storyOpenedBy,
    task.storyOpenedByName,
    task.productOwner,
    task.productOwnerName,
    task.zentao?.assignedTo,
    task.zentao?.assignedToName,
    task.zentao?.assignedToRealName,
    task.zentao?.openedBy,
    task.zentao?.openedByName,
    task.zentao?.createdBy,
    task.zentao?.createdByName,
    task.zentao?.creator,
    task.zentao?.creatorName,
    task.zentao?.storyOpenedBy,
    task.zentao?.storyOpenedByName,
    task.zentao?.productOwner,
    task.zentao?.productOwnerName
  ].map(value => String(value || '').trim()).filter(Boolean).join('\n').toLowerCase();
  return /(?:张晓龙|郑庆有|zhangxiaolong|zhengqinyou)/i.test(ownerText);
}

function hasWorkloadOwnerSourceFields(task = {}) {
  return Boolean(
    task.openedBy
    || task.openedByName
    || task.storyOpenedBy
    || task.storyOpenedByName
    || task.productOwner
    || task.productOwnerName
    || task.zentao?.openedBy
    || task.zentao?.openedByName
    || task.zentao?.storyOpenedBy
    || task.zentao?.storyOpenedByName
    || task.zentao?.productOwner
    || task.zentao?.productOwnerName
  );
}

async function hydrateTaskForWorkloadGrouping(task = {}) {
  const taskNo = String(task.taskNo || task.zentao?.id || '').trim();
  if (!taskNo) return task;
  if (hasWorkloadOwnerSourceFields(task) || isIndependentTitleWorkloadOwnerTask(task)) return task;
  try {
    const payload = await callZentaoRead(({ api: zentaoApi, modules: zentao }) => zentao.getTask(zentaoApi, { id: taskNo }));
    const result = payload.result || payload.data || payload;
    const detail = result.task || result;
    if (!detail || typeof detail !== 'object') return task;
    return mergeZentaoDetailIntoArtBriefTask(task, detail);
  } catch (error) {
    console.warn(`ZenTao workload grouping owner fallback for ${taskNo}: ${error.message || error}`);
    return task;
  }
}

function cleanTaskCenterWorkloadTitle(value = '') {
  return String(value || '')
    .replace(/^\s*\d{3,8}\s*/g, '')
    .replace(/【\s*(?:制作单|验收单|美术单)\s*】/g, '')
    .replace(/\[\s*(?:制作单|验收单|美术单)\s*\]/gi, '')
    .replace(/制作单|验收单|美术单/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·:：\-—_]+|[\s·:：\-—_]+$/g, '')
    .trim();
}

function isWorkbenchArtTask(task = {}) {
  const artAccounts = new Set(defaultArtUsers.map(user => user.account));
  const artNames = new Set(defaultArtUsers.map(user => user.realname).filter(Boolean));
  const accountFields = [
    task.assignedTo,
    task.zentao?.assignedTo
  ].map(accountName).filter(Boolean);
  if (accountFields.some(account => artAccounts.has(account))) return true;
  const nameFields = [
    task.developer,
    task.assignedToName,
    task.zentao?.assignedToName,
    task.zentao?.assignedToRealName
  ].map(value => String(value || '').trim()).filter(Boolean);
  return nameFields.some(name => artNames.has(name));
}

function isBugLikeTaskInput(input = {}) {
  const text = [
    input.title,
    input.name,
    input.summary,
    input.requirement,
    input.sourceType,
    input.zentao?.sourceType
  ].filter(Boolean).join('\n');
  return /【\s*(?:内部|线上)?\s*bug\s*】|内部\s*bug|线上\s*bug|sourceType\s*[:：]?\s*bug/i.test(text);
}

function taskInputToBug(input = {}) {
  const bugNo = String(input.bugNo || input.taskNo || input.zentaoId || input.id || '').match(/\b\d{4,8}\b/)?.[0] || '';
  return {
    id: bugNo ? `zentao_bug_${bugNo}` : input.id,
    projectId: input.projectId || '',
    bugNo,
    title: input.title || input.name || `Bug ${bugNo || ''}`.trim(),
    developer: input.developer || input.assignedTo || '',
    assignedTo: input.assignedTo || input.developer || '',
    productId: input.productId || input.zentao?.product || '',
    status: input.status || input.zentaoStatus || 'active',
    severity: input.severity || input.zentao?.severity || '',
    pri: input.pri || input.zentao?.pri || '',
    deadline: input.deadline || input.zentao?.deadline || '',
    openedAt: input.openedAt || input.zentaoCreatedAt || input.createdAt || '',
    updatedAt: input.updatedAt || new Date().toISOString(),
    createdAt: input.createdAt || input.zentaoCreatedAt || new Date().toISOString(),
    zentao: {
      ...(input.zentao || {}),
      id: bugNo || input.zentao?.id || '',
      sourceType: 'bug'
    }
  };
}

async function serveStatic(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const normalizedPath = safePath.replace(/^\/+/, '');
  const file = resolveInsideRoot(publicDir, normalizedPath);
  if (!file) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  try {
    const content = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': mimeType(file),
      'Cache-Control': safePath === '/index.html'
        ? 'no-store, no-cache, must-revalidate, max-age=0'
        : 'public, max-age=31536000, immutable'
    });
    res.end(content);
  } catch {
    const index = await fs.readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
    });
    res.end(index);
  }
}

async function serveWorkerDownload(res, pathname) {
  const workerFiles = {
    '/worker/art-direct-worker.mjs': path.resolve(__dirname, '..', 'scripts', 'art-direct-worker.mjs'),
    '/worker/install_art_direct_worker_launch_agent.sh': path.resolve(__dirname, '..', 'scripts', 'install_art_direct_worker_launch_agent.sh'),
    '/worker/install_art_direct_worker_windows.ps1': path.resolve(__dirname, '..', 'scripts', 'install_art_direct_worker_windows.ps1')
  };
  const file = workerFiles[pathname];
  if (!file) {
    sendJson(res, 404, { error: 'worker file not found' });
    return;
  }
  const content = await fs.readFile(file);
  res.writeHead(200, {
    'Content-Type': mimeType(file),
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
  });
  res.end(content);
}

async function requireProject(id) {
  const project = await getProject(id);
  if (!project) throw new HttpError(404, `project not found: ${id}`);
  return project;
}

async function requireRun(id) {
  const run = await getRun(id);
  if (!run) throw new HttpError(404, `run not found: ${id}`);
  return run;
}

async function requireTask(id) {
  const task = await getTask(id);
  if (!task) throw new HttpError(404, `task not found: ${id}`);
  return task;
}

async function requireTaskLike(id) {
  const direct = await getTask(id);
  if (direct) return direct;
  const storedRows = await listTasks();
  const projectRows = await listProjects();
  const candidateRows = [...storedRows];
  for (const project of projectRows) {
    candidateRows.push(...await listArtSnapshotTasks(project.id));
  }
  const decoded = decodeURIComponent(String(id || ''));
  const normalized = normalizeTaskLookupKey(decoded);
  const matched = candidateRows.find(task => {
    const keys = [
      task.id,
      task.taskNo,
      task.zentaoId,
      task.zentao?.id,
      rowIdentityKey(task)
    ].map(normalizeTaskLookupKey).filter(Boolean);
    return keys.includes(normalized) || keys.some(key => normalized && key.endsWith(`:${normalized}`));
  });
  if (!matched) throw new HttpError(404, `task not found: ${id}`);
  return matched;
}

function normalizeTaskLookupKey(value = '') {
  return String(value || '').trim();
}

function isSgProjectTask(task = {}) {
  const text = [
    task.projectName,
    task.title,
    task.displayTitle,
    task.summary,
    task.requirement,
    task.zentao?.storyTitle,
    task.zentao?.parentName,
    task.zentao?.executionName
  ].map(value => String(value || '')).join('\n');
  return /(?:^|[^A-Za-z0-9])SG(?:[^A-Za-z0-9]|$)|SG版本需求|SG项目|SG翡翠绿|翡翠绿/i.test(text);
}

async function loadAiMembersSnapshot(currentUser = {}) {
  const boardPath = path.join(aiWeekDir, '美术部AI看板.html');
  const [boardStat, boardHtml] = await Promise.all([
    statIfExists(boardPath),
    readTextIfExists(boardPath)
  ]);
  const embeddedHtml = buildEmbeddedAiBoardHtml(boardHtml);
  return {
    mode: 'all',
    viewer: {
      username: currentUser.username || '',
      displayName: currentUser.displayName || '',
      role: currentUser.role || ''
    },
    source: {
      root: aiWeekDir,
      boardFile: boardPath,
      boardView: '全员看板',
      boardUpdatedAt: boardStat?.mtime?.toISOString?.() || '',
      fetchedAt: new Date().toISOString()
    },
    members: parseAiBoardMembers(boardHtml),
    html: embeddedHtml,
    privacyNotice: '全员视角：原样展示美术部AI看板。'
  };
}

function parseAiBoardMembers(html = '') {
  if (!html) return [];
  const cardMatches = [...html.matchAll(/<article class="member-card">([\s\S]*?)<\/article>/g)];
  const rows = cardMatches.length
    ? cardMatches.map(match => parseAiMemberBlock(match[1]))
    : parseAiMemberTableRows(html);
  return rows
    .filter(row => row.name)
    .map(row => ({
      ...row,
      account: accountForAiMember(row.name),
      productItems: splitAiProductItems(row.product),
      skillCount: splitAiProductItems(row.product).length
    }));
}

function parseAiMemberBlock(block = '') {
  const product = stripHtml(block.match(/<div class="product">([\s\S]*?)<\/div>/)?.[1] || '');
  return {
    name: stripHtml(block.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] || ''),
    level: stripHtml(block.match(/<span class="level[^"]*">([\s\S]*?)<\/span>/)?.[1] || ''),
    status: stripHtml(block.match(/<span class="status[^"]*">([\s\S]*?)<\/span>/)?.[1] || ''),
    summary: stripHtml(block.match(/<p class="summary">([\s\S]*?)<\/p>/)?.[1] || ''),
    product: product.replace(/^累计产物[：:]\s*/, '')
  };
}

function parseAiMemberTableRows(html = '') {
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] || html;
  return [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map(match => {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => stripHtml(cell[1]));
    const productCell = cells.find(cell => /累计产物/.test(cell)) || '';
    return {
      name: cells[0] || '',
      level: cells.find(cell => /青铜|白银|黄金|铂金|钻石|星耀|王者/.test(cell)) || '',
      status: cells.find(cell => /本周|推进|成果/.test(cell)) || '',
      summary: cells[2] || '',
      product: productCell.replace(/^累计产物[：:]\s*/, '')
    };
  });
}

function splitAiProductItems(product = '') {
  const rawText = stripHtml(product).trim();
  const marker = rawText.match(/累计产物[：:]\s*(.+)$/);
  const text = (marker?.[1] || rawText)
    .replace(/^累计产物[：:]\s*/, '')
    .replace(/暂无明确产物或\s*Skill|待补充|暂无/g, '')
    .trim();
  if (!text) return [];
  return text
    .split(/[、，,；;]/)
    .map(item => item.trim())
    .filter(isValidAiBoardProductItem)
    .filter((item, index, array) => array.findIndex(other => aiBoardProductItemKey(other) === aiBoardProductItemKey(item)) === index);
}

function isValidAiBoardProductItem(value = '') {
  const text = cleanText(value)
    .replace(/^[-—•·\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length < 2) return false;
  if (/^(累计产物|产物|产出物|复用沉淀|工具\s*\/\s*场景|本次进展|研究投入|效果\s*\/\s*收获|变化|建议|是否已执行)$/i.test(text)) return false;
  if (/^(已进入|准备进入|暂未进入|进入|正在研究|在实验修改阶段|暂无明确产物或\s*Skill|暂无|待补充)$/i.test(text)) return false;
  if (/是否已执行|已进入\s*\/\s*准备进入\s*\/\s*暂未进入|准备进入\s*\/\s*暂未进入|正在研究|在实验修改阶段|暂未进入/.test(text)) return false;
  if (/本周暂无使用|暂无明确产出|不计入自产累计产物|不能作为累计产物|研究方向、未验证想法/.test(text)) return false;
  return true;
}

function aiBoardProductItemKey(value = '') {
  return cleanText(value)
    .toLowerCase()
    .replace(/\.(md|markdown)$/i, '')
    .replace(/[\\/_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '');
}

function accountForAiMember(name = '') {
  const map = {
    张倩文: 'zhangqw',
    冯淑琪: 'fengshuqi',
    余盛威: 'yushengwei',
    叶君博: 'yejunbo',
    黄剑荣: 'huangjianrong',
    李华玲: 'lilh',
    张宗斌: 'zhangzb',
    兰韩界: 'lanhj'
  };
  return map[name] || '';
}

function buildEmbeddedAiBoardHtml(html = '') {
  if (!html) return '';
  const themeBridge = `
    <style>
      :root {
        color-scheme: light dark;
        --platform-bg: #eef1f7;
        --platform-panel: rgba(255, 255, 255, 0.96);
        --platform-panel-soft: rgba(248, 249, 253, 0.92);
        --platform-text: #11172f;
        --platform-muted: #69738d;
        --platform-line: rgba(22, 34, 68, 0.09);
        --platform-shadow: 0 20px 55px rgba(31, 43, 92, 0.09);
      }
      html, body {
        background: transparent !important;
        color: var(--platform-text) !important;
        overflow: auto !important;
      }
      body::before,
      .hero::after {
        display: none !important;
      }
      .shell {
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .hero,
      .metric,
      .panel,
      .member-card,
      .lane-card,
      .road-card {
        border-color: var(--platform-line) !important;
        background: var(--platform-panel) !important;
        box-shadow: var(--platform-shadow) !important;
      }
      .hero {
        border-radius: 12px !important;
      }
      .panel {
        border-radius: 12px !important;
      }
      .metric,
      .member-card,
      .lane-card,
      .road-card {
        border-radius: 10px !important;
      }
      .hero-note,
      .criteria-item,
      .todo,
      .compare-line,
      .nav a,
      .pill,
      .member-meta span,
      th,
      table {
        border-color: var(--platform-line) !important;
        background: var(--platform-panel-soft) !important;
      }
      h1,
      h2,
      h3,
      .metric-value,
      .metric strong,
      td,
      .summary,
      .plain-product,
      .product {
        color: var(--platform-text) !important;
      }
      .lead,
      .section-copy,
      .metric-label,
      .metric-sub,
      .hero-note p,
      th {
        color: var(--platform-muted) !important;
      }
      html[data-platform-theme="dark"] {
        --platform-bg: #1f242e;
        --platform-panel: rgba(35, 40, 51, 0.94);
        --platform-panel-soft: rgba(255, 255, 255, 0.065);
        --platform-text: #e6e8ef;
        --platform-muted: #a9adba;
        --platform-line: rgba(255, 255, 255, 0.1);
        --platform-shadow: 0 28px 90px rgba(0, 0, 0, 0.32);
        --ink: #e6e8ef;
        --muted: #a9adba;
        --paper: #1f242e;
        --panel: rgba(35, 40, 51, 0.94);
        --line: rgba(255, 255, 255, 0.12);
        --green: #31d17f;
        --green-2: #51df99;
        --amber: #f7b84b;
        --red: #f06a5d;
        --blue: #7aa9f6;
        --clay: #f29b72;
        --gold: #f4c864;
        --silver: #b8c1cc;
        --shadow: 0 28px 90px rgba(0, 0, 0, 0.46);
      }
      html[data-platform-theme="dark"] .hero,
      html[data-platform-theme="dark"] .metric,
      html[data-platform-theme="dark"] .panel,
      html[data-platform-theme="dark"] .member-card,
      html[data-platform-theme="dark"] .lane-card,
      html[data-platform-theme="dark"] .road-card {
        border-color: rgba(255, 255, 255, 0.1) !important;
        background: var(--panel) !important;
      }
      html[data-platform-theme="dark"] .hero-note,
      html[data-platform-theme="dark"] .criteria-item,
      html[data-platform-theme="dark"] .todo,
      html[data-platform-theme="dark"] .compare-line,
      html[data-platform-theme="dark"] th,
      html[data-platform-theme="dark"] table {
        background: rgba(255, 255, 255, 0.065) !important;
      }
      html[data-platform-theme="dark"] .nav a,
      html[data-platform-theme="dark"] .pill,
      html[data-platform-theme="dark"] .member-meta span {
        background: rgba(255, 255, 255, 0.08) !important;
      }
    </style>
    <script>
      (function () {
        function applyTheme() {
          var params = new URLSearchParams(window.location.search);
          document.documentElement.dataset.platformTheme = params.get('theme') || 'light';
        }
        applyTheme();
        window.addEventListener('message', function (event) {
          if (event.data && event.data.type === 'platform-theme') {
            document.documentElement.dataset.platformTheme = event.data.theme || 'light';
          }
        });
      })();
    </script>
  `;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${themeBridge}</head>`);
  return `${themeBridge}${html}`;
}

async function listReadableFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter(entry => entry.isFile())
      .map(async entry => {
        const filePath = path.join(dir, entry.name);
        const stat = await fs.stat(filePath);
        return { name: entry.name, path: filePath, updatedAt: stat.mtime.toISOString(), size: stat.size };
      }));
    return files.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
  } catch {
    return [];
  }
}

async function readTextIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function statIfExists(file) {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

function parseWeeklyPeriod(markdown = '') {
  const title = markdown.match(/^#\s*(.+)$/m)?.[1] || '美术部 AI 使用情况周报';
  const owner = markdown.match(/\*\*部门负责人\*\*[：:]\s*([^｜|\n]+)/)?.[1]?.trim() || '';
  const period = markdown.match(/\*\*填报周期\*\*[：:]\s*([^\n]+)/)?.[1]?.trim() || '';
  return { title, owner, period };
}

function parseWeeklySummaryRows(markdown = '') {
  return markdown.split('\n')
    .filter(line => /^\|\s*\d+\s*\|/.test(line))
    .map(line => {
      const cells = splitMarkdownRow(line);
      return {
        index: Number(cells[0] || 0),
        name: cells[1] || '',
        aiUsage: cells[2] || '',
        researchInput: cells[3] || '',
        weeklySummary: cells[4] || '',
        toolsScene: cells[5] || '',
        outputs: cells[6] || '',
        reusable: cells[7] || '',
        blockers: cells[8] || '',
        nextPlan: cells[9] || ''
      };
    })
    .filter(row => row.name);
}

function parseAiBoardRows(html = '') {
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return [];
  return [...tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)]
    .map(match => {
      const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cleanHtmlText(cell[1]));
      return {
        name: cells[0] || '',
        level: cells[1] || '',
        weeklyStatus: cells[2] || '',
        aiUsage: cells[3] || '',
        researchInput: cells[4] || '',
        weeklySummary: cells[5] || '',
        toolsScene: cells[6] || '',
        cumulativeOutputs: cells[7] || cells[8] || '',
        leaderAdvice: cells[9] || ''
      };
    })
    .filter(row => row.name);
}

function parseAiBoardCriteria(html = '') {
  const firstCriteria = html.match(/<div class="criteria-(?:strip|grid)">([\s\S]*?)<\/div>\s*<div class="table-wrap">/i)?.[1]
    || html.match(/<div class="criteria-(?:strip|grid)">([\s\S]*?)<\/div>/i)?.[1]
    || '';
  return [...firstCriteria.matchAll(/<div class="criteria-item">([\s\S]*?)<\/div>/gi)]
    .map(match => cleanHtmlText(match[1]))
    .filter(Boolean)
    .slice(0, 8);
}

function parseAiBoardActions(html = '') {
  const actionsBlock = html.match(/<section class="panel" id="actions">([\s\S]*?)<\/section>/i)?.[1] || '';
  return [...actionsBlock.matchAll(/<article class="todo">([\s\S]*?)<\/article>/gi)]
    .map(match => {
      const body = match[1];
      return {
        priority: cleanHtmlText(body.match(/<div class="todo-priority">([\s\S]*?)<\/div>/i)?.[1] || ''),
        title: cleanHtmlText(body.match(/<h3>([\s\S]*?)<\/h3>/i)?.[1] || ''),
        text: cleanHtmlText(body.match(/<p>([\s\S]*?)<\/p>/i)?.[1] || '')
      };
    })
    .filter(item => item.title || item.text);
}

function splitMarkdownRow(line = '') {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.replace(/\\\|/g, '|').trim());
}

function inferMemberName(fileName = '', content = '') {
  const fromContent = content.match(/-\s*姓名[：:]\s*([^\n_]+)/)?.[1]?.trim();
  if (fromContent) return fromContent;
  return path.basename(fileName, path.extname(fileName))
    .replace(/[-_ ]?AI.*$/i, '')
    .replace(/\d{4,8}.*$/, '')
    .replace(/\s*[-－]\s*副本.*$/, '')
    .trim();
}

function parseMemberReport(content = '') {
  return {
    period: readListValue(content, '填报周期'),
    mainWork: readListValue(content, '本周主要工作'),
    aiUsage: readListValue(content, '填写'),
    researchPercent: readListValue(content, '研究 AI 占本周工作时间'),
    researchHours: readListValue(content, '约投入'),
    researchDirection: readListValue(content, '主要研究方向'),
    weeklySummary: readFirstValueAfterHeading(content, '本周使用情况'),
    effects: readFirstValueAfterHeading(content, '本周效果 / 收获'),
    reusable: readFirstValueAfterHeading(content, '本周可复用沉淀'),
    blockers: readFirstValueAfterHeading(content, '本周使用卡点'),
    supportNeeded: readFirstValueAfterHeading(content, '需要的支持'),
    nextPlan: readFirstValueAfterHeading(content, '下周计划'),
    nextClosure: readFirstValueAfterHeading(content, '下周最小闭环'),
    tools: parseMarkdownTable(content, ['工具名称', '用在什么事情上', '使用结果']).slice(0, 5),
    outputsTable: parseMarkdownTable(content, ['产出物', '类型', '存放位置', '是否进入实际任务']).slice(0, 5)
  };
}

function readListValue(content = '', label = '') {
  const escaped = escapeRegExp(label);
  const match = content.match(new RegExp(`-\\s*${escaped}[：:]\\s*([^\\n]+)`, 'i'));
  return cleanAiText(match?.[1] || '');
}

function readFirstValueAfterHeading(content = '', heading = '') {
  const escaped = escapeRegExp(heading);
  const match = content.match(new RegExp(`###\\s*\\d*[）)]?\\s*${escaped}[^\\n]*[\\s\\S]*?-\\s*填写[：:]\\s*([^\\n]+)`, 'i'));
  return cleanAiText(match?.[1] || '');
}

function parseMarkdownTable(content = '', expectedHeaders = []) {
  const lines = content.split('\n');
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const cells = splitMarkdownRow(lines[index]);
    if (!expectedHeaders.every(header => cells.includes(header))) continue;
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex];
      if (!rowLine.trim().startsWith('|')) break;
      const values = splitMarkdownRow(rowLine);
      if (values.every(value => !value)) continue;
      rows.push(Object.fromEntries(expectedHeaders.map((header, valueIndex) => [header, cleanAiText(values[valueIndex] || '')])));
    }
  }
  return rows;
}

function normalizeAiMemberReport(row = {}) {
  const tools = Array.isArray(row.tools) && row.tools.length
    ? row.tools
    : parseToolScene(row.toolsScene);
  const outputs = Array.isArray(row.outputsTable) && row.outputsTable.length
    ? row.outputsTable
    : parseOutputText(row.outputs);
  const aiUsagePercent = parsePercent(row.aiUsage);
  const researchHours = parseHours(row.researchHours || row.researchInput);
  return {
    ...row,
    name: cleanAiText(row.name),
    aiUsagePercent,
    aiUsageText: cleanAiText(row.aiUsage) || (aiUsagePercent ? `${aiUsagePercent}%` : ''),
    researchHours,
    researchText: cleanAiText(row.researchInput || [row.researchPercent, row.researchHours, row.researchDirection].filter(Boolean).join(' / ')),
    weeklySummary: cleanAiText(row.weeklySummary || row.mainWork),
    level: cleanAiText(row.level),
    weeklyStatus: cleanAiText(row.weeklyStatus),
    cumulativeOutputs: cleanAiText(row.cumulativeOutputs),
    leaderAdvice: cleanAiText(row.leaderAdvice),
    tools,
    outputs,
    reusable: cleanAiText(row.reusable),
    blockers: cleanAiText(row.blockers),
    effects: cleanAiText(row.effects),
    supportNeeded: cleanAiText(row.supportNeeded),
    nextPlan: cleanAiText(row.nextPlan),
    nextClosure: cleanAiText(row.nextClosure),
    status: inferAiMemberStatus(row)
  };
}

function parseToolScene(value = '') {
  return String(value || '').split(/；|;|\n/)
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map(part => {
      const cells = part.split('/').map(item => cleanAiText(item));
      return { 工具名称: cells[0] || 'AI 工具', 用在什么事情上: cells[1] || cells[0] || '', 使用结果: cells.slice(2).join(' / ') };
    });
}

function parseOutputText(value = '') {
  return String(value || '').split(/；|;|\n/)
    .map(part => cleanAiText(part))
    .filter(Boolean)
    .slice(0, 5)
    .map(part => ({ 产出物: part.split('/')[0]?.trim() || part, 类型: '', 存放位置: '', 是否进入实际任务: part }));
}

function inferAiMemberStatus(row = {}) {
  if (row.weeklyStatus) return cleanAiText(row.weeklyStatus);
  const text = [row.outputs, row.weeklySummary, row.toolsScene, row.nextPlan].join('\n');
  if (/已完成|可直接使用|已进入|1\.0|完成/.test(text)) return '已形成产出';
  if (/进行|准备进入|测试|研究|调整/.test(text)) return '推进中';
  if (/卡点|不可用|断连|问题|暂无/.test([row.blockers, row.supportNeeded].join('\n'))) return '需关注';
  return '待观察';
}

function buildAiMemberTotals(rows = []) {
  const usageRows = rows.filter(row => Number.isFinite(row.aiUsagePercent));
  const totalHours = rows.reduce((total, row) => total + (Number(row.researchHours) || 0), 0);
  const outputCount = rows.reduce((total, row) => total + (row.outputs?.length || 0), 0);
  const blockerCount = rows.filter(row => row.blockers && row.blockers !== '暂无').length;
  return {
    memberCount: rows.length,
    avgAiUsage: usageRows.length ? Math.round(usageRows.reduce((total, row) => total + row.aiUsagePercent, 0) / usageRows.length) : 0,
    researchHours: Math.round(totalHours * 10) / 10,
    outputCount,
    blockerCount
  };
}

function buildDepartmentSummary(markdown = '', visibleRows = []) {
  const lines = markdown.split('\n').map(line => line.trim()).filter(Boolean);
  const bullets = lines.filter(line => /^[-*]\s+/.test(line)).map(line => cleanAiText(line.replace(/^[-*]\s+/, ''))).slice(0, 6);
  if (bullets.length) return bullets;
  return visibleRows
    .map(row => `${row.name}：${row.weeklySummary || row.nextPlan || '本周暂未补充摘要'}`)
    .filter(Boolean)
    .slice(0, 6);
}

function filterAiMemberReportsForUser(rows = [], user = {}) {
  if (user.role === 'admin') return rows;
  const names = new Set([
    user.displayName,
    user.username,
    user.name,
    user.realname,
    user.account,
    String(user.username || '').split('@')[0]
  ].map(normalizePersonName).filter(Boolean));
  const matched = rows.filter(row => names.has(normalizePersonName(row.name)));
  return matched.length ? matched : [];
}

function normalizePersonName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '').replace(/[-_]/g, '');
}

function parsePercent(value = '') {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

function parseHours(value = '') {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*小?时/);
  return match ? Number(match[1]) : 0;
}

function cleanAiText(value = '') {
  return String(value || '')
    .replace(/__+/g, '')
    .replace(/已进入\s*\/\s*准备进入\s*\/\s*暂未进入/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHtmlText(value = '') {
  return cleanAiText(String(value || '')
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>'));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value, null, 2));
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.md' || ext === '.txt' || ext === '.log') return 'text/plain; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml; charset=utf-8';
  return 'application/octet-stream';
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function maintenanceActionLabel(type = '') {
  return {
    'safe-clean': '安全维护清理',
    'operation-logs': '操作日志范围删除',
    runs: 'AI档案 / 执行记录范围删除',
    'art-briefs': '美术摘要产物清理'
  }[String(type || '').trim()] || '维护中心清理';
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
