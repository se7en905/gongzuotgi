<template>
<section v-show="app.activeView === 'operation-logs'" class="view-grid operation-log-view">
  <ElCard shadow="never" class="panel-card page-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>操作日志</h3>
          <p>关键操作审计台账</p>
        </div>
      </div>
    </template>

    <div class="operation-log-filters">
      <label class="operation-filter-field">
        <span>用户</span>
        <ElSelect v-model="app.operationLogFilters.userId" clearable filterable placeholder="全部用户">
          <ElOption v-for="user in app.users" :key="user.id" :label="user.displayName || user.username" :value="user.id">
            <span>{{ user.displayName || user.username }}</span>
            <small>{{ user.username }}</small>
          </ElOption>
        </ElSelect>
      </label>
      <label class="operation-filter-field">
        <span>模块</span>
        <ElSelect v-model="app.operationLogFilters.module" clearable placeholder="全部模块">
          <ElOption v-for="item in moduleOptions" :key="item.value" :label="item.label" :value="item.value" />
        </ElSelect>
      </label>
      <label class="operation-filter-field">
        <span>结果</span>
        <ElSelect v-model="app.operationLogFilters.result" clearable placeholder="全部结果">
          <ElOption label="成功" value="success" />
          <ElOption label="失败" value="fail" />
        </ElSelect>
      </label>
      <label class="operation-filter-field operation-filter-keyword">
        <span>关键词</span>
        <ElInput v-model="app.operationLogFilters.keyword" clearable placeholder="用户、对象、描述、IP" @keyup.enter="app.refreshOperationLogs" />
      </label>
      <label class="operation-filter-field">
        <span>开始时间</span>
        <ElDatePicker
          v-model="app.operationLogFilters.from"
          type="datetime"
          value-format="YYYY-MM-DD HH:mm:ss"
          placeholder="不限"
        />
      </label>
      <label class="operation-filter-field">
        <span>结束时间</span>
        <ElDatePicker
          v-model="app.operationLogFilters.to"
          type="datetime"
          value-format="YYYY-MM-DD HH:mm:ss"
          placeholder="不限"
        />
      </label>
      <div class="operation-filter-actions">
        <ElButton type="primary" :loading="app.loading.operationLogs" @click="app.refreshOperationLogs">查询</ElButton>
        <ElButton plain @click="app.resetOperationLogFilters">重置</ElButton>
        <ElButton v-if="app.can('api.operationLogs.delete')" type="danger" plain :loading="app.loading.operationLogs" @click="app.deleteOperationLogsByCurrentFilters">删除当前范围</ElButton>
      </div>
    </div>

    <ElTable
      class="fill-table operation-log-table"
      :data="app.operationLogs"
      row-key="id"
      empty-text="暂无操作日志"
      v-loading="app.loading.operationLogs"
    >
      <ElTableColumn label="时间" width="170">
        <template #default="{ row }">{{ app.formatDateTime(row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn label="用户" width="170">
        <template #default="{ row }">
          <div class="operation-user-cell">
            <strong>{{ row.displayName || row.username || '未知用户' }}</strong>
            <span>{{ row.username || row.userId || '-' }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="模块" width="96">
        <template #default="{ row }"><ElTag effect="plain">{{ moduleLabel(row.module) }}</ElTag></template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="180">
        <template #default="{ row }">
          <div class="operation-action-cell">
            <strong>{{ row.actionName || actionLabel(row.action) }}</strong>
            <span>{{ row.action }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="对象" min-width="280">
        <template #default="{ row }">
          <div class="operation-target-cell">
            <strong>{{ row.targetName || row.targetId || '-' }}</strong>
            <span>{{ row.targetType || '-' }} · {{ row.targetId || '-' }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="结果" width="90">
        <template #default="{ row }"><ElTag :type="row.result === 'fail' ? 'danger' : 'success'">{{ row.result === 'fail' ? '失败' : '成功' }}</ElTag></template>
      </ElTableColumn>
      <ElTableColumn label="IP" width="150">
        <template #default="{ row }">{{ app.displayClientIp(row.ip) }}</template>
      </ElTableColumn>
      <ElTableColumn label="说明" min-width="320" show-overflow-tooltip>
        <template #default="{ row }">{{ row.description || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="96" fixed="right">
        <template #default="{ row }">
          <div class="table-action-row">
            <ElButton plain size="small" @click="app.openOperationLogDetail(row)">详情</ElButton>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>

    <div class="pagination-bar operation-log-pagination">
      <span>共 {{ app.operationLogTotal }} 条</span>
      <ElPagination
        :current-page="app.operationLogPage"
        :page-size="app.operationLogPageSize"
        :page-sizes="[10, 50, 100]"
        :total="app.operationLogTotal"
        layout="sizes, prev, pager, next"
        @update:current-page="app.handleOperationLogPageChange"
        @update:page-size="app.handleOperationLogPageSizeChange"
      />
    </div>
  </ElCard>

  <ElDialog v-model="app.operationLogDetail.visible" width="760px" title="操作日志详情" class="app-dialog operation-log-detail-dialog" align-center>
    <template v-if="app.operationLogDetail.row">
      <div class="operation-log-detail">
        <dl>
          <div><dt>操作人</dt><dd>{{ app.operationLogDetail.row.displayName || app.operationLogDetail.row.username || '-' }}</dd></div>
          <div><dt>操作时间</dt><dd>{{ app.formatDateTime(app.operationLogDetail.row.createdAt) }}</dd></div>
          <div><dt>操作</dt><dd>{{ app.operationLogDetail.row.actionName || actionLabel(app.operationLogDetail.row.action) }}</dd></div>
          <div><dt>模块</dt><dd>{{ moduleLabel(app.operationLogDetail.row.module) }}</dd></div>
          <div><dt>对象</dt><dd>{{ app.operationLogDetail.row.targetName || app.operationLogDetail.row.targetId || '-' }}</dd></div>
          <div><dt>结果</dt><dd>{{ app.operationLogDetail.row.result === 'fail' ? '失败' : '成功' }}</dd></div>
          <div><dt>IP</dt><dd>{{ app.displayClientIp(app.operationLogDetail.row.ip) }}</dd></div>
          <div><dt>User Agent</dt><dd>{{ app.operationLogDetail.row.userAgent || '-' }}</dd></div>
        </dl>
        <section>
          <h4>说明</h4>
          <p>{{ app.operationLogDetail.row.description || '-' }}</p>
          <p v-if="app.operationLogDetail.row.errorMessage" class="operation-log-error">{{ app.operationLogDetail.row.errorMessage }}</p>
        </section>
        <ElTabs>
          <ElTabPane label="变更前">
            <pre>{{ app.formatJson(app.operationLogDetail.row.before) || '无' }}</pre>
          </ElTabPane>
          <ElTabPane label="变更后">
            <pre>{{ app.formatJson(app.operationLogDetail.row.after) || '无' }}</pre>
          </ElTabPane>
          <ElTabPane label="元数据">
            <pre>{{ app.formatJson(app.operationLogDetail.row.metadata) || '无' }}</pre>
          </ElTabPane>
        </ElTabs>
      </div>
    </template>
  </ElDialog>
</section>
</template>

<script>
export default {
  name: 'OperationLogView',
  props: {
    app: {
      type: Object,
      required: true
    }
  },
  computed: {
    moduleOptions() {
      return [
        { label: '认证', value: 'auth' },
        { label: '工作台', value: 'workbench' },
        { label: '用户', value: 'user' },
        { label: '角色', value: 'role' },
        { label: '项目', value: 'project' },
        { label: '任务', value: 'task' },
        { label: '执行', value: 'run' },
        { label: 'Codex', value: 'codex' },
        { label: '复核', value: 'review' },
        { label: '工作流', value: 'workflow' }
      ];
    }
  },
  methods: {
    moduleLabel(value = '') {
      return this.moduleOptions.find(item => item.value === value)?.label || value || '-';
    },
    actionLabel(value = '') {
      return String(value || '').replace(/_/g, ' ');
    }
  }
};
</script>

<style lang="scss">
.operation-log-view {
  min-height: calc(100vh - 126px);

  > .page-card {
    overflow: hidden;
  }

  .operation-log-head-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .operation-log-filters {
    display: grid;
    grid-template-columns: 170px 140px 120px minmax(220px, 1fr) 180px 180px auto;
    gap: 12px;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
    background: var(--soft-card);
  }

  .operation-filter-field {
    display: grid;
    gap: 6px;
    min-width: 0;

    > span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    .el-select,
    .el-input,
    .el-input-number {
      width: 100%;
    }
  }

  .operation-filter-actions {
    display: flex;
    align-self: end;
    justify-content: flex-end;
    gap: 8px;
    white-space: nowrap;
  }

  .operation-filter-actions .el-button {
    margin-left: 0;
  }

  .operation-log-table {
    --el-table-row-hover-bg-color: var(--soft-card-strong);
  }

  .operation-log-table .el-table__cell {
    padding: 12px 0;
  }

  .operation-log-table .el-table__row {
    height: 62px;
  }

  .operation-log-pagination {
    border-top: 1px solid var(--line);
  }

  .operation-user-cell,
  .operation-action-cell,
  .operation-target-cell {
    display: grid;
    gap: 2px;

    strong {
      overflow: hidden;
      color: var(--heading);
      font-weight: 800;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .operation-target-cell span {
    max-width: 100%;
  }

  .el-select-dropdown__item small {
    margin-left: 8px;
    color: var(--muted);
  }
}

.operation-log-detail-dialog {
  .operation-log-detail {
    display: grid;
    gap: 14px;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 14px;
    margin: 0;
  }

  dl > div {
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);
  }

  dt {
    color: var(--muted);
    font-size: 12px;
  }

  dd {
    margin: 4px 0 0;
    color: var(--heading);
    word-break: break-word;
  }

  h4 {
    margin: 0 0 8px;
    color: var(--heading);
  }

  p {
    margin: 0;
    color: var(--text);
    line-height: 1.6;
  }

  .operation-log-error {
    margin-top: 8px;
    color: var(--danger);
  }

  pre {
    max-height: 260px;
    overflow: auto;
    margin: 0;
    padding: 12px;
    border-radius: 8px;
    background: var(--code-bg);
    color: var(--code-text);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
}

@media (max-width: 1180px) {
  .operation-log-view {
    .operation-log-filters {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .operation-filter-actions {
      justify-content: flex-start;
    }
  }
}

@media (min-width: 1500px) {
  .operation-log-view {
    .operation-log-filters {
      grid-template-columns: 220px 180px 150px minmax(320px, 520px) auto;
      justify-content: start;
    }
  }
}
</style>
