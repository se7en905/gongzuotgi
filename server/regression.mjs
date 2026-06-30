import assert from 'node:assert/strict';
import {
  applyTaskRefreshResult,
  applySkillVersionOverrideRecordState,
  artProgressEventCountsAsUsage,
  applyZentaoAssignResultToTasks,
  buildSkillInventoryStats,
  comparePermissionCatalogs,
  deleteOperationLogRecords,
  displayMetricsForSkillInventoryRow,
  mergeUsageCounterRebuildSnapshot,
  normalizeArtProgressReporterSelfUsageBucketForRegression,
  normalizeTaskArtBriefCumulativeUsageBucket,
  shouldKeepOperationLog,
  shouldReplaceAiMembersBoardHtml,
  splitProjectDeletionSnapshot,
  splitRunsByArchiveDeleteFilters,
  usageCounterBucketIsTechnical,
  usageCounterDisplayCountFromBucket
} from './business-regression-rules.mjs';

function testSkillInventoryStatsStayConsistent() {
  const rows = [
    { id: 'skill-a', productDisplayName: '界面收尾', productKind: 'skill', uploadedAt: '2026-06-01T00:00:00.000Z' },
    { id: 'standard-a', productDisplayName: '交付规范', productKind: 'standard', uploadedAt: '2026-06-01T00:00:00.000Z' },
    { id: 'folder-a', productDisplayName: '图标文件夹', productKind: 'directory', uploadedAt: '2026-06-01T00:00:00.000Z' },
    { id: 'hidden-a', productDisplayName: '隐藏产物', productKind: 'skill', displayHidden: true },
    { id: 'duplicate-as-standard', productDisplayName: '界面收尾', productKind: 'standard', uploadedAt: '2026-06-02T00:00:00.000Z' }
  ];
  const grouped = buildSkillInventoryStats(rows);
  const stats = Object.fromEntries(grouped.stats.map(item => [item.key, item.value]));
  assert.equal(stats.total, grouped.total.length, '产物总计统计必须等于总筛选列表条数');
  assert.equal(stats.skill, grouped.skill.length, 'Skill 统计必须等于点击 Skill 统计卡后的列表条数');
  assert.equal(stats.standard, grouped.standard.length, '规范统计必须等于点击规范统计卡后的列表条数');
  assert.equal(stats.total, 3, '隐藏产物和同名重复产物不得污染总数');
  assert.equal(stats.skill, 1, '同名产物去重时应优先保留 Skill 口径');
  assert.equal(stats.standard, 1, '规范统计只统计最终去重后的规范产物');
}

function testVersionOverrideDoesNotPolluteAliases() {
  const state = applySkillVersionOverrideRecordState({}, {
    key: 'version:project-a:skills/ui/SKILL.md',
    projectId: 'project-a',
    relativePath: 'skills/ui/SKILL.md',
    version: '3.0',
    aliases: ['不应进入别名']
  });
  assert.deepEqual(state.skillVersionOverrides, { 'version:project-a:skills/ui/SKILL.md': '3.0' });
  assert.deepEqual(state.skillAliasOverrides, {}, 'version: 记录不得写入调用别名覆盖');
  assert.deepEqual(state.skillAliasHistoryOverrides, {}, 'version: 记录不得写入别名历史');

  const aliasState = applySkillVersionOverrideRecordState(state, {
    key: 'alias:project-a:skills/ui/SKILL.md',
    aliases: ['界面收尾', 'UI收尾']
  });
  assert.deepEqual(aliasState.skillAliasOverrides['alias:project-a:skills/ui/SKILL.md'], ['界面收尾', 'UI收尾']);
  assert.deepEqual(aliasState.skillVersionOverrides, state.skillVersionOverrides, '别名保存不得反向污染版本覆盖');
}

function testVisibilityRestoreDoesNotRecalculateUsageCounters() {
  const usageCounters = {
    buckets: {
      'alias:界面收尾': { count: 12, people: ['盛威', '小美'] }
    }
  };
  const hiddenMetrics = displayMetricsForSkillInventoryRow({
    hidden: true,
    version: '2.0',
    usageCount: usageCounters.buckets['alias:界面收尾'].count,
    usageRate: 0.8,
    qualityScore: 91
  });
  assert.equal(hiddenMetrics.displayVersionLabel, '1.0', '作废期间版本展示必须置灰为 1.0');
  assert.equal(hiddenMetrics.usageCountLabel, '-', '作废期间调用次数展示必须为横线');
  assert.equal(hiddenMetrics.usageRateLabel, '-', '作废期间有效占比展示必须为横线');
  assert.equal(usageCounters.buckets['alias:界面收尾'].count, 12, '作废展示不得扣减累计调用次数');

  const restoredMetrics = displayMetricsForSkillInventoryRow({
    hidden: false,
    version: '2.0',
    usageCount: usageCounters.buckets['alias:界面收尾'].count,
    usageRate: 0.8,
    qualityScore: 91
  });
  assert.equal(restoredMetrics.displayVersionLabel, '2.0', '恢复后必须继续展示真实版本');
  assert.equal(restoredMetrics.usageCountLabel, '12', '恢复后必须展示作废前累计调用次数');
  assert.equal(usageCounters.buckets['alias:界面收尾'].count, 12, '恢复展示不得重算或清零累计调用次数');
}

function testProjectDeletionKeepsRunsAndWorkflows() {
  const snapshot = {
    projects: [{ id: 'project-a' }, { id: 'project-b' }],
    tasks: [{ id: 'task-a', projectId: 'project-a' }, { id: 'task-b', projectId: 'project-b' }],
    bugs: [{ id: 'bug-a', projectId: 'project-a' }],
    taskReviews: [{ id: 'review-a', projectId: 'project-a' }],
    taskProcessingNotes: [{ id: 'note-a', projectId: 'project-a' }],
    artBriefs: [{ id: 'brief-a', projectId: 'project-a' }],
    runs: [{ id: 'run-a', projectId: 'project-a' }, { id: 'run-b', projectId: 'project-b' }],
    customWorkflows: [{ id: 'workflow-a', projectId: 'project-a' }]
  };
  const result = splitProjectDeletionSnapshot(snapshot, 'project-a');
  assert.deepEqual(result.projects.map(item => item.id), ['project-b']);
  assert.deepEqual(result.tasks.map(item => item.id), ['task-b']);
  assert.deepEqual(result.bugs, []);
  assert.deepEqual(result.taskReviews, []);
  assert.deepEqual(result.taskProcessingNotes, []);
  assert.deepEqual(result.artBriefs, []);
  assert.deepEqual(result.runs.map(item => item.id), ['run-a', 'run-b'], '项目删除不得删除美术执行台和 AI档案执行记录');
  assert.deepEqual(result.customWorkflows.map(item => item.id), ['workflow-a'], '项目删除不得顺带删除自定义流程模板');
  assert.equal(result.retained.runs, 1);
  assert.equal(result.retained.customWorkflows, 1);
}

function testAiArchiveDeleteFiltersMatchVisibleScope() {
  const runs = [
    {
      id: 'run-target',
      projectId: 'deleted-project',
      sourceType: 'direct-skill',
      createdBy: 'admin',
      status: 'completed',
      title: '目标执行',
      createdAt: '2026-06-10T10:00:00.000Z'
    },
    {
      id: 'run-same-project-running',
      projectId: 'deleted-project',
      sourceType: 'direct-skill',
      createdBy: 'admin',
      status: 'running',
      title: '运行中不可删',
      createdAt: '2026-06-10T10:00:00.000Z'
    },
    {
      id: 'run-other-project',
      projectId: 'other-project',
      sourceType: 'direct-skill',
      createdBy: 'admin',
      status: 'completed',
      title: '其它来源',
      createdAt: '2026-06-10T10:00:00.000Z'
    },
    {
      id: 'run-review',
      projectId: 'deleted-project',
      sourceType: 'direct-skill',
      createdBy: 'admin',
      status: 'conditional_pass',
      title: '待验收执行',
      createdAt: '2026-06-10T11:00:00.000Z',
      resultSummary: { status: 'conditional_pass', needsHumanReview: true }
    },
    {
      id: 'run-rework',
      projectId: 'deleted-project',
      sourceType: 'direct-skill',
      createdBy: 'admin',
      status: 'failed',
      title: '待返工执行',
      createdAt: '2026-06-10T12:00:00.000Z'
    },
    {
      id: 'run-partial-without-write-evidence',
      projectId: 'deleted-project',
      sourceType: 'direct-skill',
      executionHost: 'local-worker',
      createdBy: 'admin',
      status: 'partial_write',
      workerStatus: 'partial_write',
      title: '部分写入但实际未写入',
      requirement: '图层清理',
      figmaLinks: 'https://www.figma.com/design/test/file?node-id=1-1',
      createdAt: '2026-06-10T13:00:00.000Z',
      resultSummary: {
        status: 'failed',
        figmaWritten: false,
        figmaVerifiedAfterWrite: false,
        needsHumanReview: true,
        blockerReason: '本机 Figma 写入权限异常'
      },
      figmaWriteResult: {
        written: false,
        createdNodeIds: [],
        mutatedNodeIds: [],
        evidence: [],
        verifiedAfterWrite: false,
        verificationEvidence: [],
        postWriteBlockers: [],
        blockerReason: '本机 Figma 写入权限异常'
      }
    }
  ];
  const byProject = splitRunsByArchiveDeleteFilters(runs, {
    projectId: 'deleted-project',
    from: '2026-06-10T00:00:00.000Z',
    to: '2026-06-11T00:00:00.000Z'
  });
  assert.deepEqual(byProject.deleted.map(run => run.id), ['run-target', 'run-review', 'run-rework', 'run-partial-without-write-evidence'], '按已删除来源 projectId 清理时不得误删其它来源或运行中记录');
  assert.deepEqual(byProject.remaining.map(run => run.id), ['run-same-project-running', 'run-other-project']);

  const byRunId = splitRunsByArchiveDeleteFilters(runs, {
    runId: 'run-target',
    projectId: 'deleted-project',
    from: '2026-06-10T00:00:00.000Z',
    to: '2026-06-11T00:00:00.000Z'
  });
  assert.deepEqual(byRunId.deleted.map(run => run.id), ['run-target'], '后端范围删除必须支持前端传入的 runId 筛选');

  const byClosedBucket = splitRunsByArchiveDeleteFilters(runs, {
    projectId: 'deleted-project',
    archiveBucket: 'closed',
    from: '2026-06-10T00:00:00.000Z',
    to: '2026-06-11T00:00:00.000Z'
  });
  assert.deepEqual(byClosedBucket.deleted.map(run => run.id), ['run-target'], '已闭环删除只应命中闭环记录');

  const byReviewBucket = splitRunsByArchiveDeleteFilters(runs, {
    projectId: 'deleted-project',
    archiveBucket: 'review',
    from: '2026-06-10T00:00:00.000Z',
    to: '2026-06-11T00:00:00.000Z'
  });
  assert.deepEqual(byReviewBucket.deleted.map(run => run.id), ['run-review'], '待验收删除只应命中待验收记录');

  const byReworkBucket = splitRunsByArchiveDeleteFilters(runs, {
    projectId: 'deleted-project',
    archiveBucket: 'rework',
    from: '2026-06-10T00:00:00.000Z',
    to: '2026-06-11T00:00:00.000Z'
  });
  assert.deepEqual(byReworkBucket.deleted.map(run => run.id), ['run-rework', 'run-partial-without-write-evidence'], '待返工删除只应命中待返工记录，包括未产生真实写入证据的 partial_write');
}

function testZentaoAssignFailureKeepsLocalOwner() {
  const tasks = [
    { id: 'task-1', projectId: 'project-a', taskNo: '1001', developer: '原负责人', assignedTo: 'old' }
  ];
  const failedResult = applyZentaoAssignResultToTasks(tasks, tasks[0], null);
  assert.deepEqual(failedResult, tasks, '禅道拖拽指派失败时不得改变本地负责人');

  const successResult = applyZentaoAssignResultToTasks(tasks, tasks[0], {
    id: 'task-1',
    projectId: 'project-a',
    taskNo: '1001',
    developer: '新负责人',
    assignedTo: 'new'
  });
  assert.equal(successResult[0].developer, '新负责人', '只有禅道成功返回更新任务后才允许改本地负责人');
  assert.equal(successResult[0].assignedTo, 'new');
}

function testTaskRefreshEmptyResultKeepsExistingTasks() {
  const currentTasks = [
    { id: 'task-a', title: '已同步任务', taskNo: '1001' }
  ];
  assert.deepEqual(
    applyTaskRefreshResult(currentTasks, []),
    currentTasks,
    '任务接口空数组不得覆盖已有任务中心列表'
  );
  assert.deepEqual(
    applyTaskRefreshResult(currentTasks, null),
    currentTasks,
    '任务接口失败或异常结果不得清空已有任务中心列表'
  );
  assert.deepEqual(
    applyTaskRefreshResult(currentTasks, [{ id: 'task-b', title: '新任务' }]),
    [{ id: 'task-b', title: '新任务' }],
    '任务接口返回真实列表时才允许替换当前列表'
  );
}

function testAiMembersBoardPlaceholderDoesNotReplaceCachedHtml() {
  const cachedHtml = '<html><body><main>真实 AI部门看板</main></body></html>';
  assert.equal(
    shouldReplaceAiMembersBoardHtml(cachedHtml, ''),
    false,
    '空 HTML 不得覆盖已有 AI部门看板缓存'
  );
  assert.equal(
    shouldReplaceAiMembersBoardHtml(cachedHtml, '<div>正在加载 AI部门看板...</div>'),
    false,
    '加载占位不得覆盖已有 AI部门看板缓存'
  );
  assert.equal(
    shouldReplaceAiMembersBoardHtml(cachedHtml, '<html><body><main>新的真实看板</main></body></html>'),
    true,
    '只有真实 HTML 看板才允许替换缓存'
  );
  assert.equal(
    shouldReplaceAiMembersBoardHtml(cachedHtml, '<html><body></body></html>'),
    true,
    '服务端回退逻辑需要自行判断空壳 HTML，规则函数只负责占位和空值过滤'
  );
}

function testOperationLogDeleteDoesNotMutateUsageCounters() {
  const usageCounters = {
    updatedAt: '2026-06-10T00:00:00.000Z',
    buckets: {
      'alias:界面收尾': { count: 5 }
    }
  };
  const result = deleteOperationLogRecords(
    [
      { id: 'log-a', module: 'task' },
      { id: 'log-b', module: 'run' }
    ],
    log => log.module === 'task',
    usageCounters
  );
  assert.deepEqual(result.deleted.map(log => log.id), ['log-a']);
  assert.deepEqual(result.kept.map(log => log.id), ['log-b']);
  assert.strictEqual(result.usageCounters, usageCounters, '删除操作日志不得重算、替换或扣减 usage counters 对象');
  assert.equal(result.usageCounters.buckets['alias:界面收尾'].count, 5);
}

function testOperationLogKeepsOnlyImportantActions() {
  assert.equal(shouldKeepOperationLog({ module: 'auth', action: 'LOGIN', result: 'success', user: { role: 'admin', username: 'admin' } }), false, '负责人成功登录不得写入操作日志');
  assert.equal(shouldKeepOperationLog({ module: 'workbench', action: 'VIEW_PAGE', result: 'success', user: { username: 'zhangqw', displayName: '张倩文' } }), false, '负责人切换页面不得写入操作日志');
  assert.equal(shouldKeepOperationLog({ module: 'auth', action: 'LOGIN', result: 'success', user: { role: 'developer', username: 'lanhj' } }), true, '组员成功登录必须写入操作日志');
  assert.equal(shouldKeepOperationLog({ module: 'workbench', action: 'VIEW_PAGE', result: 'success', user: { role: 'developer', username: 'lanhj' } }), true, '组员切换页面必须写入操作日志');
  assert.equal(shouldKeepOperationLog({ module: 'auth', action: 'LOGIN', result: 'fail' }), true, '失败登录必须保留排障日志');
  assert.equal(shouldKeepOperationLog({ module: 'run', action: 'QUEUE_RUN_LOCAL_WORKER', result: 'success' }), true, '执行台启动执行必须保留操作日志');
  assert.equal(shouldKeepOperationLog({ module: 'run', action: 'DELETE_RUN_RANGE', result: 'success' }), true, '范围删除执行明细必须保留操作日志');
}

function testTaskArtBriefUsageKeepsLegacyCumulativeCount() {
  const bucket = normalizeTaskArtBriefCumulativeUsageBucket({
    key: 'zentaoartbriefproduct',
    target: 'zentao-art-brief-product',
    count: 62,
    usageCount: 4,
    eventKeys: ['old-a', 'old-b', 'new-a', 'new-b'],
    usageEventKeys: ['new-a', 'new-b'],
    people: {
      Admin: 36,
      李华玲: 12,
      张倩文: 8,
      张宗斌: 4,
      叶君博: 2
    },
    usagePeople: {
      叶君博: 2,
      李华玲: 2
    }
  });
  assert.equal(bucket.usageCount, 62, '任务中心摘要旧累计不得被短期操作日志重建压低');
  assert.equal(usageCounterDisplayCountFromBucket(bucket), 62, '摘要产物展示调用次数必须读取累计 usageCount，不得用 usageEventKeys 条数压缩');
  assert.deepEqual(bucket.usagePeople, {
    Admin: 36,
    李华玲: 12,
    张倩文: 8,
    张宗斌: 4,
    叶君博: 2
  }, '摘要产物旧累计成员分布必须随 usagePeople 一起保留');
}

function testArtProgressReporterSelfUsageMigration() {
  const bucket = normalizeArtProgressReporterSelfUsageBucketForRegression({
    key: 'artprogressreporter',
    target: 'art-progress-reporter',
    count: 48,
    usageCount: 0,
    researchSyncCount: 48,
    eventKeys: ['old-a', 'old-b'],
    usageEventKeys: [],
    people: {
      余盛威: 16,
      黄剑荣: 9,
      李华玲: 7,
      冯淑琪: 5,
      叶君博: 5,
      兰韩界: 4,
      张宗斌: 2
    },
    usagePeople: {}
  });
  assert.equal(bucket.usageCount, 48, '研究同步助手产物自身的历史上报累计必须迁移为调用次数');
  assert.equal(usageCounterDisplayCountFromBucket(bucket), 48, 'AI产物清单展示必须读取迁移后的 usageCount');
  assert.deepEqual(bucket.usagePeople, bucket.people, '研究同步助手产物自身的成员明细必须和历史上报人员保持一致');
  assert.deepEqual(bucket.usageEventKeys, ['old-a', 'old-b'], '历史事件键必须并入 usageEventKeys 参与后续去重');

  const notReduced = normalizeArtProgressReporterSelfUsageBucketForRegression({
    key: 'artprogressreporter',
    target: 'art-progress-reporter',
    usageCount: 52,
    researchSyncCount: 48,
    people: { 兰韩界: 48 },
    usagePeople: { 兰韩界: 52 }
  });
  assert.equal(notReduced.usageCount, 52, '历史迁移不得降低已经更高的真实累计次数');
  assert.deepEqual(notReduced.usagePeople, { 兰韩界: 52 }, '历史迁移不得降低已经更高的成员调用明细');
}

function testUsageCounterRebuildNeverReducesRealUsage() {
  const bucket = mergeUsageCounterRebuildSnapshot({
    key: 'alias:界面收尾',
    usageCount: 12,
    usagePeople: { 张倩文: 8, 叶君博: 4 },
    usageEventKeys: ['old-a', 'old-b']
  }, {
    usageCount: 3,
    usagePeople: { 张倩文: 3 },
    usageEventKeys: ['new-a']
  });
  assert.equal(bucket.usageCount, 12, '历史重建只剩少量日志时不得降低真实累计调用次数');
  assert.deepEqual(bucket.usagePeople, { 张倩文: 8, 叶君博: 4 }, '重建人员分布不得因为日志变少降低已有使用人累计');
  assert.deepEqual(bucket.usageEventKeys, ['old-a', 'old-b', 'new-a'], '重建只能合并事件键，不得丢弃旧累计事件键');

  const increased = mergeUsageCounterRebuildSnapshot({ usageCount: 12 }, { usageCount: 13 });
  assert.equal(increased.usageCount, 13, '新的真实调用出现时允许在旧累计上增加');
}

function testArtProgressUsageRequiresStrongEvidence() {
  assert.equal(
    artProgressEventCountsAsUsage({
      eventType: 'research_artifact',
      metadata: {
        source: 'codex-session-summary',
        calledArtifacts: [{ path: 'skills/ui-finalize/SKILL.md' }]
      }
    }),
    false,
    '研究沉淀记录不得直接计入调用次数'
  );
  assert.equal(
    artProgressEventCountsAsUsage({
      eventType: 'tool_used',
      metadata: {
        source: 'codex-session-summary',
        calledArtifacts: [
          { path: 'AGENTS.md' },
          { name: '试用' },
          { name: 'md' }
        ]
      }
    }),
    false,
    '会话摘要里的 AGENTS.md、试用、md 等泛词不得计入调用次数'
  );
  assert.equal(
    artProgressEventCountsAsUsage({
      eventType: 'tool_used',
      metadata: {
        source: 'codex-session-summary',
        calledArtifacts: [{ path: 'skills/ui-finalize/SKILL.md' }]
      }
    }),
    true,
    '会话摘要里明确命中真实 Skill 路径时才允许计入调用次数'
  );
  assert.equal(
    usageCounterBucketIsTechnical({ key: '50a20a8173fa40a8934c354e44f0be7a', target: '50a20a81-73fa-40a8-934c-354e44f0be7a' }),
    true,
    'runId/UUID 技术桶不得长期作为产物调用桶保留'
  );
  assert.equal(
    usageCounterBucketIsTechnical({ key: 'uifinalize', target: 'skills/ui-finalize/SKILL.md' }),
    false,
    '真实 Skill/md 目标不能被技术桶清理规则误删'
  );
}

function testPermissionCatalogsStayAligned() {
  const backend = ['menu.tasks', 'menu.skillList', 'api.operationLogs.delete'];
  const frontend = ['menu.tasks', 'menu.skillList', 'api.operationLogs.delete'];
  assert.deepEqual(comparePermissionCatalogs(backend, frontend), {
    missingInFrontend: [],
    missingInBackend: []
  });
  assert.deepEqual(comparePermissionCatalogs(backend, ['menu.tasks']), {
    missingInFrontend: ['api.operationLogs.delete', 'menu.skillList'],
    missingInBackend: []
  }, '权限目录不一致时必须能被回归测试发现');
}

testSkillInventoryStatsStayConsistent();
testVersionOverrideDoesNotPolluteAliases();
testVisibilityRestoreDoesNotRecalculateUsageCounters();
testProjectDeletionKeepsRunsAndWorkflows();
testAiArchiveDeleteFiltersMatchVisibleScope();
testZentaoAssignFailureKeepsLocalOwner();
testTaskRefreshEmptyResultKeepsExistingTasks();
testAiMembersBoardPlaceholderDoesNotReplaceCachedHtml();
testOperationLogDeleteDoesNotMutateUsageCounters();
testOperationLogKeepsOnlyImportantActions();
testTaskArtBriefUsageKeepsLegacyCumulativeCount();
testArtProgressReporterSelfUsageMigration();
testUsageCounterRebuildNeverReducesRealUsage();
testArtProgressUsageRequiresStrongEvidence();
testPermissionCatalogsStayAligned();

console.log(JSON.stringify({
  ok: true,
  tests: [
    'AI产物清单统计一致',
    '版本覆盖不污染别名',
    '作废恢复不重算调用次数',
    '项目删除不删执行记录',
    'AI档案范围删除筛选一致',
    '禅道拖拽失败不改本地负责人',
    '任务接口空返回不清空任务中心',
    'AI部门看板占位不覆盖真实缓存',
    '操作日志删除不影响累计调用次数',
    '操作日志只保留关键动作',
    '任务中心摘要累计调用不被短期日志压低',
    '研究同步助手产物自身历史上报迁移为调用次数',
    '历史重建不得减少真实调用累计',
    '成员上报调用必须有强证据且过滤技术桶',
    '权限目录前后端一致性'
  ]
}, null, 2));
