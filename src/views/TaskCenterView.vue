<template>
<section v-show="app.activeView === 'tasks'" class="view-grid task-center-view">
  <div class="task-metrics-shell">
  <div class="metric-grid workspace-metrics task-metrics-primary">
    <ElCard
      v-for="metric in primaryTaskMetrics"
      :key="metric.label"
      shadow="never"
      :class="['metric-card', { clickable: metric.filter }]"
      @click="metric.filter && app.applyTaskMetricFilter(metric.filter)"
    >
      <span>{{ metric.label }}</span>
      <button
        v-if="metric.filter"
        type="button"
        class="metric-value-button"
        :class="[app.metricValueClass(metric.filter), { active: app.isTaskMetricActive(metric.filter) }]"
        @click.stop="app.applyTaskMetricFilter(metric.filter)"
      >{{ metric.value }}</button>
      <strong v-else>{{ metric.value }}</strong>
      <small>{{ metric.hint }}</small>
    </ElCard>
  </div>
  </div>

  <div class="person-stat-grid">
    <div
      v-for="person in app.taskPersonStats"
      :key="person.name"
      :class="['person-stat-card', { owner: person.isOwnerPerson, 'drop-ready': app.draggingTaskId }]"
      @dragover.prevent="app.canAssignTaskByDrag ? $event.dataTransfer.dropEffect = 'move' : null"
      @drop="app.handleTaskDropToPerson(person)"
    >
      <div class="person-stat-main">
        <div class="person-stat-name">
          <strong>{{ person.name }}</strong>
        </div>
        <div class="person-stat-values">
          <div>
            <span>任务</span>
            <button type="button" class="person-stat-number task" :class="{ active: app.isPersonStatActive(person.name, 'task') }" @click="app.applyPersonStatFilter(person.name, 'task')">{{ person.taskCount }}</button>
          </div>
          <div>
            <span>今日截止</span>
            <button type="button" class="person-stat-number due-today" :class="{ active: app.isPersonStatActive(person.name, 'dueToday') }" @click="app.applyPersonStatFilter(person.name, 'dueToday')">{{ person.todayDueCount }}</button>
          </div>
          <div>
            <span>卡点</span>
            <button type="button" class="person-stat-number risk" :class="{ active: app.isPersonStatActive(person.name, 'risk') }" @click="app.applyPersonStatFilter(person.name, 'risk')">{{ person.riskCount }}</button>
          </div>
          <div>
            <span>Bug</span>
            <button type="button" class="person-stat-number bug" :class="{ active: app.isPersonStatActive(person.name, 'bug') }" @click="app.applyPersonStatFilter(person.name, 'bug')">{{ person.bugCount }}</button>
          </div>
        </div>
      </div>
      <div v-if="app.can('task.personPressure.view')" class="person-pressure-pill" :class="{ owner: person.isOwnerPerson }">
        <span>{{ person.isOwnerPerson ? (app.isPlatformAdmin ? '负责人提醒' : '处理提醒') : app.isPlatformAdmin ? '分配判断' : '拆单判断' }}</span>
        <strong>{{ person.isOwnerPerson ? person.ownerReminder : app.isPlatformAdmin ? person.acceptanceSuggestion : person.ownerTaskSuggestion }}</strong>
        <ElTooltip v-if="!person.isOwnerPerson" :content="`${person.acceptanceBasis}。${person.acceptanceRule}`" placement="top" effect="dark">
          <small>压力 {{ person.pressureScore }}</small>
        </ElTooltip>
      </div>
    </div>
  </div>

  <div :class="['task-workbench-grid', { 'processing-open': app.taskProcessingSheetOpen }]">
  <ElCard shadow="never" class="panel-card page-card task-list-card">
    <template #header>
      <div class="panel-head">
        <div>
          <div class="panel-title-row">
            <ElSegmented class="task-center-mode-segment" :model-value="app.taskCenterModeForView(revision)" @update:model-value="value => app.switchTaskCenterMode(value)" :options="app.taskCenterModeOptions" />
          </div>
        </div>
        <div class="panel-actions task-filter-actions">
          <ElInput
            v-if="!app.isTaskPersonStatFilterActive"
            :model-value="app.taskFilters.keyword"
            :placeholder="app.taskCenterModeForView(revision) === 'bug' ? '搜索 Bug 号、标题、指派人' : '搜索任务号、名称、人员'"
            clearable
            class="task-filter-keyword"
            @update:model-value="value => app.updateTaskFilter('keyword', value)"
            @input="value => app.updateTaskFilter('keyword', value)"
            @clear="app.updateTaskFilter('keyword', '')"
          />
          <ElButton v-if="app.hasActiveTaskFiltersForView(revision)" plain @click="app.clearTaskFilters">清除筛选</ElButton>
        </div>
      </div>
    </template>

    <ElTable
      v-if="app.taskCenterModeForView(revision) === 'task'"
      class="fill-table"
      :data="app.pagedBusinessTaskRowsForView(revision)"
      row-key="id"
      :current-row-key="app.selectedBusinessTaskId"
      highlight-current-row
      :empty-text="app.hasActiveTaskFiltersForView(revision) ? '当前筛选下暂无任务' : '暂无任务'"
      @cell-click="row => selectTask(row)"
      @row-click="app.selectBusinessTask"
    >
      <ElTableColumn label="任务" min-width="420">
        <template #default="{ row }">
          <div class="project-cell draggable-task-cell" draggable="true" @dragstart.stop="event => app.startTaskAssignDrag(row, event)" @dragend="app.clearTaskAssignDrag" @click.stop="selectTask(row)">
            <div class="task-title-row">
              <ElPopover
                v-if="app.taskRequirementPreviewHtml(row)"
                trigger="hover"
                placement="right-start"
                popper-class="task-requirement-popover"
                :width="520"
                :show-after="220"
                :hide-after="80"
                :teleported="true"
              >
                <template #reference>
                  <a
                    v-if="app.zentaoTaskUrl(row)"
                    :href="app.zentaoTaskUrl(row)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="task-title-link task-title-preview-trigger"
                    @click.stop
                  >{{ row.displayTitle }}</a>
                  <strong v-else class="task-title-preview-trigger" @click.stop="selectTask(row)">{{ row.displayTitle }}</strong>
                </template>
                <div class="task-requirement-preview">
                  <div class="task-requirement-preview-head">
                    <strong>{{ row.displayTitle }}</strong>
                    <span>{{ row.developer || '未指定' }} · {{ row.deadline || row.zentao?.deadline || '无截止时间' }}</span>
                  </div>
                  <div class="task-requirement-preview-body" v-html="app.taskRequirementPreviewHtml(row)"></div>
                </div>
              </ElPopover>
              <a
                v-else-if="app.zentaoTaskUrl(row)"
                :href="app.zentaoTaskUrl(row)"
                target="_blank"
                rel="noopener noreferrer"
                class="task-title-link"
                @click.stop
              >{{ row.displayTitle }}</a>
              <strong v-else @click.stop="selectTask(row)">{{ row.displayTitle }}</strong>
              <ElTag v-for="tag in app.taskPriorityFlags(row)" :key="tag.type" size="small" :class="['task-flag-tag', 'status-pending', tag.type]" effect="dark">{{ tag.label }}</ElTag>
            </div>
            <span>{{ row.projectName }} · {{ row.sourceLabel }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="负责人" min-width="110">
        <template #default="{ row }">{{ row.developer || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="禅道状态" min-width="110" align="center">
        <template #default="{ row }">
          <span :class="['semantic-status-tag', 'zentao-status-pill', app.zentaoStatusClass(row.zentaoStatus || row.zentao?.status || row.zentao?.originalStatus || row.status)]">
            {{ app.zentaoStatusLabel(row.zentaoStatus || row.zentao?.status || row.zentao?.originalStatus || row.status) }}
          </span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="优先级" min-width="80">
        <template #default="{ row }">
          <ElTag :type="app.bugPriorityTagType(row.pri || row.priority || row.zentao?.pri)" effect="plain">P{{ row.pri || row.priority || row.zentao?.pri || '-' }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="AI评估" min-width="132" align="center">
        <template #default="{ row }">
          <ElTooltip
            :content="row.isLowEffortAcceptance ? '设计同步单/验收单不参与 AI 量级评估' : app.workloadEstimateText(row.workloadEstimate)"
            placement="top"
            effect="dark"
            :show-after="180"
          >
            <ElSelect
              v-if="app.isPlatformAdmin && !row.isLowEffortAcceptance"
              :model-value="app.taskWorkloadDisplayLevel(row)"
              size="small"
              class="task-workload-select"
              :disabled="app.loading.taskWorkload"
              @click.stop
              @change="value => app.saveTaskWorkloadLevel(row, value)"
            >
              <ElOption v-for="option in app.taskWorkloadLevelOptions" :key="option.value" :label="option.label" :value="option.value" />
            </ElSelect>
            <span v-else :class="['task-workload-pill', { empty: app.taskWorkloadDisplayLevel(row) === '-' }]">{{ app.taskWorkloadDisplayLevel(row) }}</span>
          </ElTooltip>
        </template>
      </ElTableColumn>
      <ElTableColumn label="预计工时" min-width="110">
        <template #default="{ row }">
          {{ row.zentao?.estimate ?? row.estimate ?? '-' }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="截止时间" min-width="136">
        <template #default="{ row }">
          <span :class="['deadline-cell', app.deadlineState(row.deadline || row.zentao?.deadline)]">{{ row.deadline || row.zentao?.deadline || '-' }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="创建时间" min-width="150">
        <template #default="{ row }">{{ app.formatDateTime(row.zentaoCreatedAt || row.zentao?.openedDate || row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="200" fixed="right" align="center">
        <template #default="{ row }">
          <div class="table-action-row">
            <ElButton v-if="app.shouldShowTaskSplitButton(row)" size="small" type="primary" plain class="task-split-button" @click.stop="app.openTaskSplitDialog(row)">拆单</ElButton>
            <ElButton v-if="app.can('run.create')" type="primary" plain size="small" @click.stop="startRun(row)">发起执行</ElButton>
            <ElButton v-if="app.canDeletePlatformTask(row)" type="danger" plain size="small" @click.stop="deleteTask(row)">删除</ElButton>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>
    <ElTable
      v-else-if="app.taskCenterModeForView(revision) === 'bug'"
      class="fill-table"
      :data="app.pagedBugRowsForView(revision)"
      row-key="id"
      :empty-text="app.hasActiveTaskFiltersForView(revision) ? '当前筛选下暂无 Bug' : '暂无 Bug'"
      @row-click="app.selectBug"
    >
      <ElTableColumn label="Bug" min-width="420">
        <template #default="{ row }">
          <div class="project-cell">
            <a v-if="app.zentaoBugUrl(row)" :href="app.zentaoBugUrl(row)" target="_blank" rel="noopener noreferrer" class="task-title-link" @click.stop>{{ row.displayTitle }}</a>
            <strong v-else>{{ row.displayTitle }}</strong>
            <span>{{ row.projectName }} · 归因任务：{{ row.zentao?.task || '未关联' }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="指派人" min-width="110">
        <template #default="{ row }">{{ row.developer || row.assignedTo || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="创建人" min-width="110">
        <template #default="{ row }">
          {{ row.zentao?.openedByName || row.zentao?.openedBy || row.openedByName || row.openedBy || row.createdBy || '-' }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="Bug 状态" min-width="110">
        <template #default="{ row }">
          <ElTag :type="app.bugStatusTagType(row.status)">{{ app.bugStatusLabel(row.status) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="截止时间" min-width="136">
        <template #default="{ row }">
          <span :class="['deadline-cell', app.deadlineState(row.deadline)]">{{ row.deadline || '-' }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="创建时间" min-width="150">
        <template #default="{ row }">{{ app.formatDateTime(row.openedAt || row.createdAt) }}</template>
      </ElTableColumn>
    </ElTable>
    <div class="pagination-bar">
      <span>共 {{ app.taskCenterTotalForView(revision) }} 条</span>
      <ElPagination
        v-model:current-page="app.businessTaskPage"
        :page-size="app.businessTaskPageSize"
        @update:page-size="value => app.setWorkbenchPageSize(value, 'businessTaskPage')"
        :page-sizes="[10, 50, 100]"
        :total="app.taskCenterTotalForView(revision)"
        page-size-label="条/页"
        layout="sizes, prev, pager, next"
      />
    </div>
  </ElCard>

  <aside :class="['task-processing-sheet', { open: app.taskProcessingSheetOpen }]">
    <button type="button" class="task-processing-tab" @click="app.toggleTaskProcessingSheet">
      <span>任务处理单</span>
    </button>
    <div class="task-processing-panel">
      <div class="task-processing-head">
        <div>
          <strong>任务处理单</strong>
          <span v-if="app.selectedBusinessTask">{{ app.taskDisplayTitle(app.selectedBusinessTask) }}</span>
          <span v-else>请先在左侧任务列表选择任务</span>
        </div>
        <ElButton size="small" plain @click="app.toggleTaskProcessingSheet">收起</ElButton>
      </div>
      <template v-if="app.selectedBusinessTask">
        <div class="task-processing-meta">
          <article>
            <span>负责人</span>
            <strong>{{ app.selectedBusinessTask.developer || '-' }}</strong>
          </article>
          <article>
            <span>截止时间</span>
            <strong>{{ app.selectedBusinessTask.deadline || app.selectedBusinessTask.zentao?.deadline || '-' }}</strong>
          </article>
          <article>
            <span>处理状态</span>
            <strong>{{ app.taskProcessingStatus(app.selectedBusinessTask) }}</strong>
          </article>
          <article class="task-processing-workload">
            <span>AI评估</span>
            <ElSelect
              v-if="app.isPlatformAdmin && !app.selectedBusinessTask.isLowEffortAcceptance"
              :model-value="app.taskWorkloadDisplayLevel(app.selectedBusinessTask)"
              size="small"
              class="task-workload-select"
              :disabled="app.loading.taskWorkload"
              @change="value => app.saveTaskWorkloadLevel(app.selectedBusinessTask, value)"
            >
              <ElOption v-for="option in app.taskWorkloadLevelOptions" :key="option.value" :label="option.label" :value="option.value" />
            </ElSelect>
            <strong v-else :class="['task-workload-pill', { empty: app.taskWorkloadDisplayLevel(app.selectedBusinessTask) === '-' }]">{{ app.taskWorkloadDisplayLevel(app.selectedBusinessTask) }}</strong>
          </article>
        </div>
        <section class="task-processing-block">
          <div class="task-processing-block-head">
            <strong>美术摘要</strong>
            <div>
              <ElButton v-if="app.taskArtBriefForTask(app.selectedBusinessTask)" size="small" plain @click="app.openTaskArtBrief(app.selectedBusinessTask)">查看摘要</ElButton>
              <ElButton size="small" plain :loading="app.isTaskArtBriefLoading(app.selectedBusinessTask)" @click="app.downloadTaskAiWorkBrief(app.selectedBusinessTask)">AI工作说明</ElButton>
              <ElButton v-if="app.can('task.artBrief.generate')" size="small" type="primary" plain :loading="app.isTaskArtBriefLoading(app.selectedBusinessTask)" @click="app.generateArtBriefForTask(app.selectedBusinessTask, { force: Boolean(app.taskArtBriefForTask(app.selectedBusinessTask)) })">
                {{ app.taskArtBriefForTask(app.selectedBusinessTask) ? '重生成摘要' : '生成摘要' }}
              </ElButton>
            </div>
          </div>
          <p>{{ app.taskProcessingSummary(app.selectedBusinessTask) }}</p>
        </section>
        <section class="task-processing-block">
          <div class="task-processing-block-head">
            <strong>处理备注</strong>
            <small>{{ app.taskProcessingNoteMeta(app.selectedBusinessTask) || '未保存' }}</small>
          </div>
          <ElInput
            :model-value="app.taskProcessingNote(app.selectedBusinessTask)"
            type="textarea"
            :rows="6"
            :placeholder="app.taskProcessingNotePlaceholder"
            @update:model-value="value => app.updateTaskProcessingNote(app.selectedBusinessTask, value)"
          />
        </section>
        <div class="task-processing-actions">
          <ElButton v-if="app.can('task.codexPrompt.copy')" plain @click="app.copyCodexPromptForTask(app.selectedBusinessTask)">复制指令</ElButton>
          <ElButton v-if="app.can('task.note.manage')" type="primary" :loading="app.loading.taskNotes" @click="app.saveTaskProcessingNote(app.selectedBusinessTask)">保存备注</ElButton>
        </div>
      </template>
      <div v-else class="task-processing-empty">选择任务后可记录处理备注、生成美术摘要和复制 Codex 指令。</div>
    </div>
  </aside>
  </div>
</section>
</template>

<script>
export default {
  name: 'TaskCenterView',
  props: {
    app: {
      type: Object,
      required: true
    },
    revision: {
      type: Number,
      default: 0
    }
  },
  computed: {
    primaryTaskMetrics() {
      const preferred = ['业务任务', '今天截止', '临期任务', '卡点任务', '美术待处理 Bug'];
      const metrics = this.app.taskCenterMetrics || [];
      const map = new Map(metrics.map(metric => [metric.label, metric]));
      const primary = preferred.map(label => map.get(label)).filter(Boolean);
      return primary.length ? primary : metrics.slice(0, 5);
    }
  },
  methods: {
    selectTask(row) {
      this.app.selectBusinessTask(row);
      this.$forceUpdate();
    },
    startRun(row) {
      this.app.selectBusinessTask(row);
      this.app.createRunFromTask(row);
      this.app.activeView = 'runs';
      this.app.pushRoute('/runs');
    },
    deleteTask(row) {
      this.app.deletePlatformTask(row);
    }
  }
};
</script>

<style lang="scss">
.task-center-view {
  display: grid;
  grid-template-columns: 1fr;
  align-items: start;
  gap: 14px;

  > .task-metrics-shell,
  > .person-stat-grid,
  > .task-workbench-grid {
    grid-column: 1 / -1;
  }

  > .page-card {
    display: flex;
    min-height: 0;

    .el-card__body {
      flex: 1;
    }
  }

  .task-list-card {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
    width: 100%;
  }

  .task-metrics-shell {
    display: grid;
    gap: 6px;
  }

  .task-metrics-primary {
    grid-template-columns: repeat(5, minmax(150px, 1fr));
    gap: 8px;

    :deep(.el-card__body) {
      min-height: 92px;
      padding: 12px 14px;
    }
  }

  .task-workbench-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 58px;
    grid-template-rows: auto;
    gap: 12px;
    align-items: start;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    transition: grid-template-columns 0.18s ease;

    &.processing-open {
      grid-template-columns: minmax(560px, 1fr) minmax(360px, 420px);
    }
  }

  .task-processing-sheet {
    position: relative;
    grid-column: 2;
    width: 58px;
    max-width: 100%;
    min-height: 0;
    transition: width 0.18s ease;

    &.open {
      width: 100%;
    }

    &:not(.open) {
      display: flex;
      justify-content: center;
      width: 58px;
      min-height: 168px;
      padding-top: 0;
      border-color: transparent;
      background: transparent;
      box-shadow: none;
    }
  }

  .task-processing-tab {
    position: sticky;
    top: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    width: 42px;
    min-width: 42px;
    max-width: 42px;
    height: 168px;
    border: 1px solid #cdd8e6;
    border-radius: 999px;
    background: #eef3f9;
    color: #1f2d44;
    cursor: pointer;
    box-shadow: var(--shadow-soft);
    padding: 0;

    span {
      writing-mode: vertical-rl;
      letter-spacing: 2px;
      font-size: 13px;
      font-weight: 860;
      line-height: 1.1;
    }
  }

  .task-processing-sheet.open .task-processing-tab {
    display: none;
  }

  .task-processing-panel {
    display: none;
  }

  .task-processing-sheet.open .task-processing-panel {
    display: grid;
    gap: 12px;
    width: 100%;
    min-width: 0;
    min-height: 420px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    box-shadow: var(--shadow-soft);
  }

  .task-processing-head,
  .task-processing-block-head,
  .task-processing-actions {
    align-items: center;
    display: flex;
    gap: 10px;
    justify-content: space-between;
  }

  .task-processing-head > div {
    display: grid;
    gap: 4px;
    min-width: 0;

    strong {
      color: var(--heading);
      font-size: 14px;
      font-weight: 860;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 680;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .task-processing-meta {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;

    article {
      display: grid;
      gap: 4px;
      padding: 9px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--soft-card);
      min-width: 0;
    }

    span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 740;
    }

    strong {
      color: var(--heading);
      font-size: 12px;
      font-weight: 820;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .task-processing-workload {
    :deep(.el-select) {
      width: 100%;
    }
  }

  .task-workload-select {
    width: 56px;

    :deep(.el-select__wrapper) {
      min-height: 24px;
      padding: 0 6px 0 10px;
      border-radius: 999px;
      overflow: hidden;
      font-weight: 820;
      box-shadow: none;
      background: #fdf0d6;
    }

    :deep(.el-select__wrapper.is-focused) {
      box-shadow: 0 0 0 1px var(--brand) inset;
    }

    :deep(.el-select__selection),
    :deep(.el-select__selected-item),
    :deep(.el-select__placeholder) {
      color: var(--heading);
      font-size: 12px;
      font-weight: 860;
      justify-content: center;
    }

    :deep(.el-select__suffix) {
      margin-left: 0;
      color: var(--muted);

      .el-icon {
        width: 11px;
        height: 11px;
      }
    }
  }

  .task-workload-pill {
    align-items: center;
    display: inline-flex;
    justify-content: center;
    min-width: 34px;
    min-height: 24px;
    padding: 0 8px;
    border-radius: 999px;
    background: #fdf0d6;
    color: var(--heading);
    font-size: 12px;
    font-weight: 860;
    line-height: 1;

    &.empty {
      background: #f3f5f9;
      color: var(--muted);
    }
  }

  .task-processing-block {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--card);

    p {
      margin: 0;
      color: var(--text);
      font-size: 12px;
      line-height: 1.55;
      max-height: 132px;
      overflow: auto;
      white-space: pre-wrap;
    }

    small {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }
  }

  .task-processing-empty {
    display: grid;
    place-items: center;
    min-height: 180px;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }

  .fill-table {
    color: #26324c;
    width: 100%;

    :deep(.el-table__inner-wrapper),
    :deep(.el-scrollbar__view) {
      min-width: 100%;
    }

    .el-table__header th,
    .el-table__header .cell {
      color: #7a8498;
      font-size: 12px;
      font-weight: 720;
    }

    .el-table__body .cell {
      color: #2f3a55;
      font-weight: 520;
    }

    .project-cell {
      display: grid;
      gap: 4px;
      width: 100%;
      max-width: 100%;
      min-width: 0;

      .task-title-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      .task-title-link,
      strong {
        display: inline-block;
        min-width: 0;
        max-width: 100%;
        overflow: visible;
        color: #324361;
        font-size: 14px;
        font-weight: 680;
        line-height: 1.35;
        text-overflow: clip;
        white-space: normal;
        overflow-wrap: break-word;
        word-break: normal;
      }

      .task-title-link:hover {
        color: #3f63dd;
      }

      &.draggable-task-cell {
        cursor: grab;

        &:active {
          cursor: grabbing;
        }
      }

      .task-split-button {
        height: 24px;
        padding: 0 8px;
      }

      span {
        color: #8a93a6;
        font-size: 12px;
        font-weight: 560;
        line-height: 1.25;
      }
    }

    .el-tag {
      height: 22px;
      border: 0;
      border-radius: 999px;
      padding: 0 9px;
      font-size: 12px;
      font-weight: 720;
      line-height: 22px;
      letter-spacing: 0;
    }

    .el-tag--primary,
    .el-tag--primary.is-light,
    .el-tag--primary.is-dark {
      background: #e9edff;
      color: #4059c8;
    }

    .el-tag--success,
    .el-tag--success.is-light,
    .el-tag--success.is-dark {
      background: #e7f4ee;
      color: #2e7b5d;
    }

    .el-tag--warning,
    .el-tag--warning.is-light,
    .el-tag--warning.is-dark {
      background: #fff1d7;
      color: #9d6816;
    }

    .el-tag--danger,
    .el-tag--danger.is-light,
    .el-tag--danger.is-dark {
      background: #f9dddd;
      color: #c84d43;
    }

    .el-tag--info,
    .el-tag--info.is-light,
    .el-tag--info.is-dark {
      background: #eef1f6;
      color: #657084;
    }
  }

  .task-filter-actions {
    flex: 0 0 auto;
    flex-wrap: wrap;
    align-items: center;
  }

  .task-filter-keyword {
    width: 280px;
  }

  .task-filter-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
    padding: 9px 12px;
    border: 1px solid rgba(34, 197, 94, 0.24);
    border-radius: var(--radius);
    background: rgba(34, 197, 94, 0.08);
    color: var(--primary-ink);
    font-size: 12px;
    font-weight: 800;

    span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    button {
      flex: 0 0 auto;
      border: 0;
      background: transparent;
      color: var(--primary);
      font-weight: 900;
      text-underline-offset: 3px;

      &:hover {
        text-decoration: underline;
      }
    }
  }

  .pagination-bar {
    justify-content: space-between;
    gap: 12px;
    background: color-mix(in srgb, var(--primary) 3%, var(--card));

    > span {
      color: var(--heading);
      font-weight: 820;
    }

    :deep(.el-pagination) {
      --el-pagination-button-color: var(--heading);
      --el-pagination-hover-color: var(--primary);
      --el-pagination-button-bg-color: transparent;
      --el-pagination-button-disabled-bg-color: transparent;
      font-weight: 780;
    }

    :deep(.el-pager li.is-active) {
      background: var(--primary);
      color: #ffffff;
      border-radius: 6px;
      font-weight: 900;
    }
  }

  .person-stat-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    margin: 0;
  }

  .person-stat-card {
    display: grid;
    gap: 0;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--soft-card);
    overflow: visible;
    box-shadow: var(--shadow);
    transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;

    &.owner {
      border-color: #cbd6e6;
      background: #eef3f9;
      box-shadow: none;
    }

    &:hover {
      border-color: color-mix(in srgb, var(--accent) 28%, var(--line));
      box-shadow: var(--lift-shadow);
      transform: translateY(-2px);
    }

    &.drop-ready {
      outline: 1px dashed color-mix(in srgb, var(--primary) 58%, transparent);
      outline-offset: 2px;
    }
  }

  .person-stat-card.owner {
    background: #eef3f9;
  }

  .person-stat-main {
    display: grid;
    grid-template-columns: minmax(64px, 0.8fr) minmax(0, 3.2fr);
    align-items: stretch;
    min-width: 0;
    min-height: 68px;
  }

  .person-pressure-pill {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    justify-self: stretch;
    max-width: 100%;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, #000000 14%, transparent);
    border-width: 1px 0 0;
    border-radius: var(--radius);
    border-top-left-radius: 0;
    border-top-right-radius: 0;
    background: rgba(255, 255, 255, 0.38);

    span,
    small {
      color: var(--muted);
      font-size: 10px;
      font-weight: 760;
      white-space: nowrap;
    }

    small {
      cursor: help;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 3px;
    }

    strong {
      min-width: 0;
      overflow: visible;
      color: var(--heading);
      font-size: 11px;
      font-weight: 860;
      line-height: 1.25;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    &.owner {
      grid-template-columns: auto minmax(0, 1fr);
      border-color: color-mix(in srgb, var(--warn) 22%, var(--line));
      background: rgba(255, 255, 255, 0.38);
    }
  }

  .person-stat-name {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: center;
    align-items: center;
    min-width: 0;
    padding: 0 14px;
    border-right: 1px solid var(--line);

    > strong {
      color: var(--heading);
      font-size: 14px;
      font-weight: 860;
      line-height: 1.2;
      white-space: nowrap;
      overflow-wrap: normal;
      word-break: keep-all;
    }
  }

  .person-stat-values {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    align-items: stretch;
    min-width: 0;

    > div {
      display: grid;
      align-content: center;
      gap: 4px;
      min-width: 0;
      padding: 0 4px;
      border-right: 1px solid var(--line);
      text-align: center;

      &:last-child {
        border-right: 0;
      }

      span {
        display: block;
        color: var(--muted);
        font-size: 11px;
        font-weight: 760;
        line-height: 1.2;
        white-space: normal;
        word-break: keep-all;
      }
    }
  }

  .person-stat-number {
    display: block;
    width: 100%;
    border: 0;
    background: transparent;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    font-weight: 800;
    line-height: 1;
    text-underline-offset: 3px;
    transition: color 0.18s ease;

    &.task {
      color: #000000;
    }

    &.due-today {
      color: var(--warn);
    }

    &.risk {
      color: var(--warn);
    }

    &.bug {
      color: var(--danger);
    }

    &:hover,
    &.active {
      text-decoration: underline;
    }
  }

  @media (max-width: 920px) {
    .person-stat-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 560px) {
    .person-stat-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 420px) {
    .person-stat-main {
      grid-template-columns: 1fr;
      min-height: unset;
    }

    .person-stat-name {
      grid-template-columns: minmax(0, 1fr) auto;
      min-height: 44px;
      padding: 0 12px;
      border-bottom: 1px solid var(--line);
      border-right: 0;
    }

    .person-stat-values {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .semantic-status-tag {
    align-items: center;
    border: 0 !important;
    border-radius: 999px;
    display: inline-flex;
    font-weight: 760;
    justify-content: center;
    line-height: 1;
    min-width: 54px;
    padding: 6px 10px;
    white-space: nowrap;
  }

  .zentao-status-pill {
    font-size: 12px;
  }

  .status-danger {
    background: rgba(239, 68, 68, 0.14) !important;
    color: #dc3f3f !important;
  }

  .status-active {
    background: rgba(34, 197, 94, 0.15) !important;
    color: #18804b !important;
  }

  .status-paused {
    background: rgba(100, 116, 139, 0.16) !important;
    color: #657084 !important;
  }

  .status-pending {
    background: rgba(148, 163, 184, 0.14) !important;
    color: #6d7688 !important;
  }

  .status-review {
    background: rgba(245, 158, 11, 0.15) !important;
    color: #a66a05 !important;
  }

  .status-done {
    background: rgba(20, 184, 166, 0.14) !important;
    color: #0f7f77 !important;
  }

  .status-muted {
    background: rgba(148, 163, 184, 0.14) !important;
    color: #6d7688 !important;
  }

  .deadline-cell.overdue,
  .deadline-cell.soon {
    color: #dc3f3f;
    font-weight: 780;
  }

  @media (max-width: 1180px) {
    .task-metrics-primary {
      grid-template-columns: repeat(3, minmax(180px, 1fr));
    }

    .task-workbench-grid {
      grid-template-columns: minmax(0, 1fr) 48px;
      grid-template-rows: auto;

      &.processing-open {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .person-stat-grid,
    .task-list-card,
    .task-processing-sheet {
      grid-column: 1;
      grid-row: auto;
    }

    .task-processing-sheet,
    .task-processing-sheet.open {
      width: 100%;
      min-height: 0;
    }

    .task-processing-tab {
      position: static;
      width: 100%;
      height: 44px;
      border-radius: 8px;

      span {
        writing-mode: horizontal-tb;
        letter-spacing: 0;
      }
    }

  }

  @media (max-width: 760px) {
    .task-metrics-primary {
      grid-template-columns: 1fr;
    }

    .panel-head {
      align-items: stretch;
      display: grid;
      grid-template-columns: 1fr;
    }

    .task-filter-actions {
      display: grid;
      grid-template-columns: 1fr auto;
      justify-content: stretch;
      width: 100%;
    }

    .task-filter-keyword {
      width: 100% !important;
    }

    .task-workbench-grid {
      grid-template-columns: 1fr;
    }

    .task-processing-sheet,
    .task-processing-sheet.open {
      grid-column: 1;
      width: 100%;
      min-height: 0;
    }

    .task-processing-tab {
      position: static;
      width: 100%;
      height: 44px;
      border-radius: 8px;

      span {
        writing-mode: horizontal-tb;
        letter-spacing: 0;
      }
    }
  }

  @media (max-width: 520px) {
    .task-filter-actions {
      grid-template-columns: 1fr;
    }
  }
}

.task-split-dialog {
  .task-split-panel {
    display: grid;
    gap: 14px;
  }

  .task-split-head {
    align-items: center;
    display: flex;
    gap: 12px;
    justify-content: space-between;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);

    > div {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    strong {
      color: var(--heading);
      font-size: 14px;
      font-weight: 860;
      line-height: 1.35;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 680;
    }
  }

  .task-split-form {
    .form-grid.two {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
  }

  .task-split-table-head {
    align-items: center;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .task-split-table {
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;

    :deep(.el-input-number) {
      width: 100%;
    }
  }
}
</style>
