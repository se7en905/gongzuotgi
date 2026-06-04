<template>
<section v-show="app.activeView === 'ai-archive'" class="view-grid ai-archive-view">
  <div class="metric-grid workspace-metrics">
    <ElCard v-for="metric in app.aiArchiveMetrics" :key="metric.label" shadow="never" class="metric-card">
      <span>{{ metric.label }}</span>
      <strong>{{ metric.value }}</strong>
      <small>{{ metric.hint }}</small>
    </ElCard>
  </div>

  <ElCard shadow="never" class="panel-card page-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>AI 档案</h3>
          <p>沉淀组员验证记录、AI 协作质量、验收、Bug 和导出数据。</p>
        </div>
        <div class="panel-actions archive-filter-actions">
          <ElSelect :model-value="app.archiveFilters.projectId" @update:model-value="value => app.archiveFilters.projectId = value" placeholder="全部项目" clearable class="archive-filter-select">
            <ElOption v-for="project in app.projects" :key="project.id" :label="project.name" :value="project.id" />
          </ElSelect>
          <ElSelect :model-value="app.archiveFilters.qualityStatus" @update:model-value="value => app.archiveFilters.qualityStatus = value" placeholder="全部质量状态" clearable class="archive-filter-select">
            <ElOption label="已验收" value="passed" />
            <ElOption label="待验收" value="conditional" />
            <ElOption label="失败/阻塞" value="blocked" />
          </ElSelect>
          <ElInput :model-value="app.archiveFilters.keyword" @update:model-value="value => app.archiveFilters.keyword = value" :placeholder="app.isPlatformAdmin ? '搜索任务号、名称、负责人' : '搜索任务号、名称、人员'" clearable class="archive-filter-keyword" />
          <ElButton v-if="app.can('archive.export')" plain @click="app.exportAiArchiveCsv">导出台账</ElButton>
        </div>
      </div>
    </template>

    <ElTable
      class="fill-table"
      :data="app.pagedAiArchiveRows"
      row-key="id"
      empty-text="暂无 AI 产物记录"
      @row-click="app.selectAiArchiveTask"
    >
      <ElTableColumn label="任务" width="440">
        <template #default="{ row }">
          <div class="project-cell">
            <a v-if="app.zentaoTaskUrl(row)" :href="app.zentaoTaskUrl(row)" target="_blank" rel="noopener noreferrer" class="task-title-link" @click.stop>{{ row.displayTitle }}</a>
            <strong v-else>{{ row.displayTitle }}</strong>
            <span>{{ row.projectName }} · {{ row.archiveRowType === 'manual-only' ? '人工记录' : '平台执行' }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn :label="app.isPlatformAdmin ? '任务负责人' : '任务人员'" width="120">
        <template #default="{ row }">
          <strong class="archive-owner">{{ row.developer || app.zentaoTaskOwner(row) || '未分配' }}</strong>
        </template>
      </ElTableColumn>
      <ElTableColumn label="执行" width="90">
        <template #default="{ row }">
          <button type="button" class="archive-count-link" @click.stop="app.openTaskRunHistory(row)">{{ row.runCount }}</button>
        </template>
      </ElTableColumn>
      <ElTableColumn label="AI 质量" width="120">
        <template #default="{ row }">
          <strong :class="app.qualityScoreClass(row.quality.aiScore)">{{ row.quality.executed ? `${row.quality.aiScore}%` : '-' }}</strong>
        </template>
      </ElTableColumn>
      <ElTableColumn label="阶段闭环" width="110">
        <template #default="{ row }">{{ row.quality.stageCompletion }}%</template>
      </ElTableColumn>
      <ElTableColumn label="全流程完成度" width="150">
        <template #default="{ row }">
          <div class="flow-record-cell">
            <strong v-if="row.manualFlowRecord">{{ row.manualFlowRecord.flowCompletion || 0 }}%</strong>
            <span v-else>-</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="关联 Bug" width="100">
        <template #default="{ row }">{{ row.quality.bugCount }}</template>
      </ElTableColumn>
      <ElTableColumn label="严重 Bug" width="100">
        <template #default="{ row }">
          <strong :class="{ danger: row.quality.criticalBugCount > 0 }">{{ row.quality.criticalBugCount }}</strong>
        </template>
      </ElTableColumn>
      <ElTableColumn label="禅道状态">
        <template #default="{ row }">
          <ElTag :type="app.zentaoStatusTagType(row.zentaoStatus || row.zentao?.originalStatus)">{{ app.zentaoStatusLabel(row.zentaoStatus || row.zentao?.originalStatus) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="交付状态">
        <template #default="{ row }">
          <button
            v-if="row.manualFlowRecord || row.platformStatus === 'manual_record'"
            type="button"
            class="manual-record-tag-button"
            @click.stop="app.openAiFlowRecordDialog(row)"
          >
            <ElTag :type="app.statusTagType(row.platformStatus)">{{ app.businessTaskStatusLabel(row.platformStatus) }}</ElTag>
          </button>
          <ElTag v-else :type="app.statusTagType(row.platformStatus)">{{ app.businessTaskStatusLabel(row.platformStatus) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="最近执行">
        <template #default="{ row }">{{ app.formatDateTime(row.latestRunAt) }}</template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <div class="archive-table-actions">
            <ElButton size="small" type="primary" plain @click.stop="app.openArchiveTaskResult(row)">执行详情</ElButton>
            <ElButton v-if="app.can('archive.record.manage')" size="small" plain @click.stop="app.openAiFlowRecordDialog(row)">
              {{ row.manualFlowRecord ? '编辑' : '补录' }}
            </ElButton>
            <ElButton v-if="app.can('archive.export')" size="small" plain @click.stop="app.exportTaskArchive(row)">导出</ElButton>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>

    <div class="pagination-bar">
      <span>共 {{ app.aiArchiveTotal }} 条</span>
      <ElPagination
        :current-page="app.aiArchivePage" @update:current-page="value => app.aiArchivePage = value"
        :page-size="app.aiArchivePageSize" @update:page-size="value => app.setWorkbenchPageSize(value, 'aiArchivePage')"
        :page-sizes="[10, 50, 100]"
        :total="app.aiArchiveTotal"
        page-size-label="条/页"
        layout="sizes, prev, pager, next"
      />
    </div>
  </ElCard>

  <ElCard shadow="never" class="panel-card page-card archive-artifact-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>历史任务产物</h3>
          <p>从平台产物目录扫描到的历史执行结果、报告和证据。</p>
        </div>
        <ElTag>{{ app.filteredAiArtifactRows.length }} 个产物</ElTag>
      </div>
    </template>
    <ElTable
      class="fill-table"
      :data="app.pagedAiArtifactRows"
      row-key="path"
      empty-text="暂无历史产物"
      @row-click="app.openTaskAudit"
    >
      <ElTableColumn label="任务" min-width="440">
        <template #default="{ row }">
          <div class="project-cell">
            <a v-if="app.zentaoTaskUrl(row)" :href="app.zentaoTaskUrl(row)" target="_blank" rel="noopener noreferrer" class="task-title-link" @click.stop>{{ row.name }}</a>
            <strong v-else>{{ row.name }}</strong>
            <span>{{ row.projectName }} · {{ row.path }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="结果状态" width="120">
        <template #default="{ row }">
          <ElTag :type="app.statusTagType(row.status)">{{ app.statusLabel(row.status) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="闭环度" width="100">
        <template #default="{ row }">{{ row.completion || 0 }}%</template>
      </ElTableColumn>
      <ElTableColumn label="报告" width="90">
        <template #default="{ row }">{{ row.reportCount || 0 }}</template>
      </ElTableColumn>
      <ElTableColumn label="证据" width="90">
        <template #default="{ row }">{{ row.evidenceCount || 0 }}</template>
      </ElTableColumn>
      <ElTableColumn label="更新时间" width="180">
        <template #default="{ row }">{{ app.formatDateTime(row.updatedAt) }}</template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <div class="table-action-row">
            <ElButton size="small" type="primary" plain @click.stop="app.openTaskAudit(row)">执行详情</ElButton>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>
    <div class="pagination-bar">
      <span>共 {{ app.filteredAiArtifactRows.length }} 条</span>
      <ElPagination
        :current-page="app.aiArtifactPage" @update:current-page="value => app.aiArtifactPage = value"
        :page-size="app.aiArtifactPageSize" @update:page-size="value => app.setWorkbenchPageSize(value, 'aiArtifactPage')"
        :page-sizes="[10, 50, 100]"
        :total="app.filteredAiArtifactRows.length"
        page-size-label="条/页"
        layout="sizes, prev, pager, next"
      />
    </div>
  </ElCard>

</section>
</template>

<script>
export default {
  name: 'AiArchiveView',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>

<style lang="scss">
.ai-archive-view {
  .archive-count-link {
    display: inline-flex;
    min-width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: rgba(34, 197, 94, 0.1);
    color: var(--primary);
    cursor: pointer;
    font-size: 13px;
    font-weight: 800;
    line-height: 1;

    &:hover {
      background: rgba(34, 197, 94, 0.18);
    }
  }

  .archive-filter-actions {
    flex: 0 0 auto;
    flex-wrap: nowrap;
    align-items: center;
  }

  .archive-filter-select {
    width: 160px;
  }

  .archive-filter-keyword {
    width: 280px;
  }

  .archive-table-actions {
    display: inline-flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    width: 100%;
    white-space: nowrap;
  }

  .flow-record-cell {
    display: grid;
    gap: 2px;

    strong {
      color: var(--primary);
      font-weight: 800;
    }

    span,
    small {
      color: var(--muted);
      font-size: 12px;
    }
  }

  .archive-owner {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    color: var(--heading);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .manual-record-tag-button {
    display: inline-flex;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    line-height: 1;
  }

  .archive-artifact-card {
    display: block;

    .el-card__body {
      display: block;
      min-height: auto;
    }
  }

  @media (max-width: 1180px) {
    .archive-filter-actions {
      flex-wrap: wrap;
    }

  }
}
</style>
