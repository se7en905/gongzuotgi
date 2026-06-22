<template>
<section v-show="app.activeView === 'maintenance-center'" class="view-grid maintenance-center-view">
  <ElCard shadow="never" class="panel-card page-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>维护中心</h3>
          <p>管理员集中查看本机数据体量，并按明确范围预览和销毁不再需要的数据。</p>
        </div>
        <ElButton type="primary" plain :loading="app.loading.maintenance" @click="app.refreshMaintenanceOverview">刷新概览</ElButton>
      </div>
    </template>

    <div class="maintenance-summary-grid">
      <article
        v-for="item in app.maintenanceOverview.storage || []"
        :key="item.key"
        class="maintenance-summary-card"
        :class="`is-${item.cleanupLevel || 'caution'}`"
      >
        <button type="button" class="maintenance-card-title" @click="handleOpenPath(item)">
          <i aria-hidden="true"></i>
          <span>{{ item.label }}</span>
        </button>
        <ElTag class="maintenance-level-tag" :type="cleanupLevelTagType(item.cleanupLevel)" effect="plain">{{ item.cleanupLevelLabel || '需确认' }}</ElTag>
        <button type="button" class="maintenance-card-number" @click="handleWorkbenchAction(item)">
          <strong>{{ app.formatBytes(item.bytes) }}</strong>
          <em v-if="Number(item.count || 0)">{{ item.count }} 项</em>
        </button>
        <small>{{ item.note }}</small>
        <ElButton
          v-if="canCleanDirectly(item)"
          class="maintenance-direct-clean-button"
          type="danger"
          plain
          size="small"
          :disabled="!Number(item.count || 0)"
          :loading="app.loading.maintenancePreview || app.loading.maintenanceApply"
          @click.stop="applyDirectSafeCleanup(item)"
        >
          删除这些垃圾数据
        </ElButton>
      </article>
    </div>

    <div class="maintenance-record-grid">
      <article
        v-for="item in app.maintenanceOverview.records || []"
        :key="item.key"
        class="maintenance-record-card"
        :class="`is-${item.cleanupLevel || 'caution'}`"
      >
        <button type="button" class="maintenance-card-title" @click="handleOpenPath(item)">
          <i aria-hidden="true"></i>
          <span>{{ item.label }}</span>
        </button>
        <ElTag class="maintenance-level-tag" :type="cleanupLevelTagType(item.cleanupLevel)" effect="plain">{{ item.cleanupLevelLabel || '需确认' }}</ElTag>
        <button type="button" class="maintenance-card-number" @click="handleWorkbenchAction(item)">
          <strong>{{ item.count }}</strong>
        </button>
        <small>{{ item.note || (item.protected ? '受保护，不参与范围清理' : item.file) }}</small>
      </article>
    </div>
  </ElCard>

  <ElCard shadow="never" class="panel-card page-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>范围清理</h3>
          <p>先预览命中数量和预计释放空间，再确认执行；执行记录、摘要和日志互不越权清理。</p>
        </div>
      </div>
    </template>

    <div class="maintenance-action-layout">
      <aside class="maintenance-action-list">
        <button
          v-for="item in actionOptions"
          :key="item.value"
          type="button"
          :class="{ active: app.maintenanceForm.type === item.value }"
          @click="app.setMaintenanceActionType(item.value)"
        >
          <strong>{{ item.label }}</strong>
          <span>{{ item.description }}</span>
        </button>
      </aside>

      <div class="maintenance-action-panel">
        <div class="maintenance-warning">
          <strong>{{ selectedAction.label }}</strong>
          <span>{{ selectedAction.notice }}</span>
        </div>

        <div v-if="app.maintenanceForm.type === 'safe-clean'" class="maintenance-safe-preview">
          <p>安全维护只处理 `.DS_Store`、过期 JSON 临时文件和 runs.json 已不存在的孤儿执行工作区。</p>
          <ElTag type="success" effect="plain">不删除业务 JSON、有效执行工作区、正式产物或累计指标</ElTag>
        </div>

        <div v-else class="maintenance-filter-grid">
          <label v-if="app.maintenanceForm.type === 'art-briefs'" class="maintenance-filter-field">
            <span>任务号</span>
            <ElInput v-model="app.maintenanceForm.filters.taskNo" clearable placeholder="例如 51218" />
          </label>
          <label class="maintenance-filter-field">
            <span>关键词</span>
            <ElInput v-model="app.maintenanceForm.filters.keyword" clearable :placeholder="keywordPlaceholder" />
          </label>
          <label v-if="app.maintenanceForm.type === 'operation-logs'" class="maintenance-filter-field">
            <span>模块</span>
            <ElSelect v-model="app.maintenanceForm.filters.module" clearable placeholder="全部模块">
              <ElOption label="任务" value="task" />
              <ElOption label="执行" value="run" />
              <ElOption label="维护中心" value="maintenance" />
              <ElOption label="项目" value="project" />
              <ElOption label="用户" value="user" />
              <ElOption label="角色" value="role" />
            </ElSelect>
          </label>
          <label v-if="app.maintenanceForm.type === 'operation-logs'" class="maintenance-filter-field">
            <span>结果</span>
            <ElSelect v-model="app.maintenanceForm.filters.result" clearable placeholder="全部结果">
              <ElOption label="成功" value="success" />
              <ElOption label="失败" value="fail" />
            </ElSelect>
          </label>
          <label v-if="app.maintenanceForm.type === 'runs'" class="maintenance-filter-field">
            <span>状态</span>
            <ElSelect v-model="app.maintenanceForm.filters.status" clearable placeholder="全部非运行状态">
              <ElOption label="已完成" value="completed" />
              <ElOption label="失败" value="failed" />
              <ElOption label="阻塞" value="blocked" />
              <ElOption label="已取消" value="cancelled" />
            </ElSelect>
          </label>
          <label v-if="app.maintenanceForm.type === 'runs'" class="maintenance-filter-field">
            <span>类型</span>
            <ElSelect v-model="app.maintenanceForm.filters.sourceType" clearable placeholder="全部类型">
              <ElOption label="直接执行" value="direct-skill" />
              <ElOption label="独立执行" value="standalone" />
              <ElOption label="任务执行" value="task" />
              <ElOption label="Bug 执行" value="bug" />
            </ElSelect>
          </label>
          <label v-if="app.maintenanceForm.type === 'runs'" class="maintenance-filter-field">
            <span>执行人 / 操作人</span>
            <ElSelect v-model="app.maintenanceForm.filters.userId" clearable filterable placeholder="全部人员">
              <ElOption v-for="user in app.users" :key="user.id" :label="user.displayName || user.username" :value="user.id" />
            </ElSelect>
          </label>
          <label class="maintenance-filter-field">
            <span>开始时间</span>
            <ElDatePicker v-model="app.maintenanceForm.filters.from" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="必须选择开始时间" />
          </label>
          <label class="maintenance-filter-field">
            <span>结束时间</span>
            <ElDatePicker v-model="app.maintenanceForm.filters.to" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="必须选择结束时间" />
          </label>
        </div>

        <div class="maintenance-actions">
          <ElButton plain @click="app.resetMaintenanceFilters">重置条件</ElButton>
          <ElButton type="primary" plain :loading="app.loading.maintenancePreview" @click="app.previewMaintenanceAction">预览范围</ElButton>
          <ElButton type="danger" :disabled="!app.maintenancePreviewReady" :loading="app.loading.maintenanceApply" @click="app.applyMaintenanceAction">确认删除</ElButton>
        </div>

        <div v-if="app.maintenancePreview" class="maintenance-preview-panel">
          <div class="maintenance-preview-metrics">
            <div>
              <span>命中数量</span>
              <strong>{{ app.maintenancePreviewCount }}</strong>
            </div>
            <div>
              <span>预计释放</span>
              <strong>{{ app.formatBytes(app.maintenancePreviewBytes) }}</strong>
            </div>
            <div>
              <span>清理类型</span>
              <strong>{{ selectedAction.label }}</strong>
            </div>
          </div>

          <ElTable
            class="fill-table maintenance-preview-table"
            :data="app.maintenancePreviewRows"
            table-layout="fixed"
            empty-text="当前预览没有命中项"
          >
            <ElTableColumn label="对象" min-width="220">
              <template #default="{ row }">
                <div class="maintenance-preview-object">
                  <strong>{{ row.title || row.targetName || row.label || row.id || row.relativePath || '-' }}</strong>
                  <span>{{ row.relativePath || row.path || row.id || row.taskNo || '-' }}</span>
                </div>
              </template>
            </ElTableColumn>
            <ElTableColumn label="时间" width="170">
              <template #default="{ row }">{{ app.formatDateTime(row.createdAt || row.generatedAt || row.updatedAt) || '-' }}</template>
            </ElTableColumn>
            <ElTableColumn label="状态 / 类型" width="140">
              <template #default="{ row }">{{ row.status || row.kind || row.module || row.type || '-' }}</template>
            </ElTableColumn>
            <ElTableColumn label="大小" width="120">
              <template #default="{ row }">{{ app.formatBytes(row.bytes || row.estimatedBytes || 0) }}</template>
            </ElTableColumn>
          </ElTable>
        </div>
      </div>
    </div>
  </ElCard>
</section>
</template>

<script>
import { ElMessage } from 'element-plus';

export default {
  name: 'MaintenanceCenterView',
  props: {
    app: {
      type: Object,
      required: true
    }
  },
  computed: {
    actionOptions() {
      return [
        {
          value: 'safe-clean',
          label: '安全维护清理',
          description: '清理系统元数据、过期临时文件和孤儿工作区。',
          notice: '只处理已确认无业务意义的安全项，不触碰业务 JSON 和正式产物。'
        },
        {
          value: 'operation-logs',
          label: '操作日志范围删除',
          description: '按时间、模块、结果或关键词删除审计日志。',
          notice: '必须选择开始和结束时间；删除后日志不再留存，但不会回退 AI 产物累计调用次数。'
        },
        {
          value: 'runs',
          label: 'AI档案 / 执行记录删除',
          description: '按时间、状态、类型、执行人删除执行档案和产物目录。',
          notice: '必须选择开始和结束时间；运行中记录不会被删除。'
        },
        {
          value: 'art-briefs',
          label: '美术摘要产物清理',
          description: '按任务号、关键词或生成时间清理摘要 HTML / AI 工作说明。',
          notice: '必须选择时间范围、任务号或关键词之一；只删除 outputs/art-briefs 中命中的摘要目录，并同步摘要索引。'
        }
      ];
    },
    selectedAction() {
      return this.actionOptions.find(item => item.value === this.app.maintenanceForm.type) || this.actionOptions[0];
    },
    keywordPlaceholder() {
      if (this.app.maintenanceForm.type === 'operation-logs') return '用户、对象、描述、IP';
      if (this.app.maintenanceForm.type === 'runs') return '执行内容、Skill/md、Figma 链接';
      if (this.app.maintenanceForm.type === 'art-briefs') return '摘要标题、任务号、目录名';
      return '关键词';
    }
  },
  methods: {
    cleanupLevelTagType(level = '') {
      if (level === 'safe') return 'success';
      if (level === 'range') return 'primary';
      if (level === 'protected') return 'danger';
      return 'warning';
    },
    canCleanDirectly(item = {}) {
      return item.cleanupLevel === 'safe' && item.maintenanceType === 'safe-clean';
    },
    async applyDirectSafeCleanup(item = {}) {
      if (!this.canCleanDirectly(item)) return;
      this.app.setMaintenanceActionType('safe-clean');
      await this.$nextTick();
      const preview = await this.app.previewMaintenanceAction();
      const count = Number(preview?.matchedCount || 0);
      if (!count) return;
      const bytes = this.app.formatBytes(Number(preview?.estimatedBytes || 0));
      await this.app.applyMaintenanceAction({
        confirmTitle: '删除安全垃圾数据',
        confirmButtonText: '删除垃圾数据',
        confirmMessage: `已预览到 ${count} 项可直接清理的系统垃圾，预计释放 ${bytes}。只会删除 .DS_Store、过期临时 JSON 和没有执行记录对应的孤儿工作区，不会影响任务、模板、AI档案、AI产物统计或禅道数据。确认删除后文件会被彻底销毁。`
      });
    },
    async handleOpenPath(item = {}) {
      const targetPath = String(item.path || item.file || '').trim();
      if (!targetPath) return;
      try {
        await this.app.api('/api/maintenance/open-path', {
          method: 'POST',
          body: JSON.stringify({ path: targetPath })
        });
      } catch (error) {
        ElMessage.error(this.app.readApiError?.(error) || '项目路径打开失败');
      }
    },
    handleWorkbenchAction(item = {}) {
      if (item.route) {
        this.app.pushRoute(item.route);
        return;
      }
      if (item.maintenanceType) {
        this.app.setMaintenanceActionType(item.maintenanceType);
        this.$nextTick(() => {
          document.querySelector('.maintenance-action-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
      }
    }
  }
};
</script>

<style scoped>
.maintenance-summary-grid,
.maintenance-record-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.maintenance-record-grid {
  margin-top: 14px;
}

.maintenance-summary-card,
.maintenance-record-card {
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 8px;
  padding: 12px;
  text-align: left;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 10px;
  min-height: 168px;
  position: relative;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.maintenance-summary-card:hover,
.maintenance-record-card:hover {
  border-color: var(--primary);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
  transform: translateY(-1px);
}

.maintenance-summary-card.is-safe,
.maintenance-record-card.is-safe {
  border-color: rgba(22, 163, 74, 0.35);
}

.maintenance-summary-card.is-range,
.maintenance-record-card.is-range {
  border-color: rgba(37, 99, 235, 0.28);
}

.maintenance-summary-card.is-caution,
.maintenance-record-card.is-caution {
  border-color: rgba(245, 158, 11, 0.35);
}

.maintenance-summary-card.is-protected,
.maintenance-record-card.is-protected {
  border-color: rgba(220, 38, 38, 0.3);
}

.maintenance-summary-card strong,
.maintenance-record-card strong {
  font-size: 22px;
  line-height: 1.1;
  color: var(--text);
}

.maintenance-summary-card span,
.maintenance-record-card span {
  color: inherit;
}

.maintenance-card-title {
  border: 0;
  background: color-mix(in srgb, var(--panel) 82%, var(--muted) 10%);
  border-radius: 6px;
  padding: 9px 148px 9px 10px;
  margin: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.2;
  text-align: left;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  min-width: 100%;
  max-width: 100%;
}

.maintenance-card-title:hover span {
  color: var(--primary);
  text-decoration: underline;
}

.maintenance-card-title i {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #f59e0b;
  flex: 0 0 auto;
}

.maintenance-card-title span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.maintenance-card-number {
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 74%, var(--primary) 8%);
  border-radius: 6px;
  padding: 12px;
  color: var(--text);
  text-align: left;
  display: grid;
  gap: 6px;
  cursor: pointer;
  width: 100%;
}

.maintenance-card-number:hover {
  border-color: var(--primary);
  background: rgba(37, 99, 235, 0.06);
}

.maintenance-card-number em {
  color: var(--muted);
  font-size: 12px;
  font-style: normal;
}

.maintenance-card-meta {
  padding-right: 92px;
}

.maintenance-level-tag {
  position: absolute;
  top: 21px;
  right: 22px;
  max-width: 134px;
  height: auto;
  white-space: normal;
  text-align: center;
  line-height: 1.15;
  padding: 3px 7px;
  font-size: 11px;
}

.maintenance-summary-card small,
.maintenance-record-card small {
  background: color-mix(in srgb, var(--panel) 88%, var(--muted) 8%);
  border-radius: 6px;
  padding: 10px;
  color: var(--muted);
  line-height: 1.45;
  word-break: break-all;
  font-size: 12px;
}

.maintenance-direct-clean-button {
  width: 100%;
  min-height: 30px;
}

.maintenance-action-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 18px;
}

.maintenance-action-list {
  display: grid;
  gap: 10px;
  align-content: start;
}

.maintenance-action-list button {
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 8px;
  padding: 12px;
  text-align: left;
  display: grid;
  gap: 6px;
  cursor: pointer;
}

.maintenance-action-list button.active {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
}

.maintenance-action-list strong {
  color: var(--text);
}

.maintenance-action-list span,
.maintenance-warning span,
.maintenance-safe-preview,
.maintenance-filter-field span {
  color: var(--muted);
  font-size: 13px;
}

.maintenance-action-panel {
  display: grid;
  gap: 14px;
}

.maintenance-warning {
  border: 1px solid var(--border);
  border-left: 4px solid #f59e0b;
  border-radius: 8px;
  padding: 12px 14px;
  display: grid;
  gap: 4px;
}

.maintenance-filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}

.maintenance-filter-field {
  display: grid;
  gap: 6px;
}

.maintenance-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.maintenance-preview-panel {
  border-top: 1px solid var(--border);
  padding-top: 14px;
  display: grid;
  gap: 14px;
}

.maintenance-preview-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.maintenance-preview-metrics > div {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  display: grid;
  gap: 6px;
}

.maintenance-preview-metrics span {
  color: var(--muted);
  font-size: 13px;
}

.maintenance-preview-metrics strong {
  color: var(--text);
  font-size: 20px;
}

.maintenance-preview-object {
  display: grid;
  gap: 4px;
}

.maintenance-preview-object span {
  color: var(--muted);
  font-size: 12px;
  word-break: break-all;
}

@media (max-width: 1500px) {
  .maintenance-summary-grid,
  .maintenance-record-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 1200px) {
  .maintenance-summary-grid,
  .maintenance-record-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .maintenance-summary-grid,
  .maintenance-record-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .maintenance-action-layout {
    grid-template-columns: 1fr;
  }

  .maintenance-preview-metrics {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .maintenance-summary-grid,
  .maintenance-record-grid {
    grid-template-columns: 1fr;
  }
}
</style>
