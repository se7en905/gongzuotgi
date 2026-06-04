<template>
<section v-show="app.activeView === 'tasks'" class="view-grid task-center-view">
  <div class="task-metrics-shell">
    <div class="task-metrics-head">
      <span>{{ expandedMetricTitle }}</span>
      <ElButton size="small" plain @click="metricsExpanded = !metricsExpanded">
        {{ metricsExpanded ? '收起其他指标' : '展开其他指标' }}
      </ElButton>
    </div>
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
    <div v-show="metricsExpanded" class="metric-grid workspace-metrics task-metrics-secondary">
      <ElCard
        v-for="metric in secondaryTaskMetrics"
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
    <div v-for="person in app.taskPersonStats" :key="person.name" :class="['person-stat-card', { owner: person.isOwnerPerson }]">
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

  <div :class="['task-workbench-grid', { 'processing-collapsed': processingCollapsed }]">
  <ElCard shadow="never" class="panel-card page-card task-list-card">
    <template #header>
      <div class="panel-head">
        <div>
          <div class="panel-title-row">
            <ElSegmented class="task-center-mode-segment" :model-value="app.taskCenterModeForView(revision)" @update:model-value="value => app.switchTaskCenterMode(value)" :options="app.taskCenterModeOptions" />
          </div>
        </div>
        <div class="panel-actions task-filter-actions">
          <ElSelect
            v-if="app.taskCenterModeForView(revision) === 'task'"
            :model-value="app.taskFilters.executionStatus"
            placeholder="全部执行记录"
            clearable
            class="task-filter-select"
            @update:model-value="value => app.updateTaskFilter('executionStatus', value)"
            @change="value => app.updateTaskFilter('executionStatus', value)"
            @clear="app.updateTaskFilter('executionStatus', '')"
          >
            <ElOption label="有执行记录" value="executed" />
            <ElOption label="未执行" value="unexecuted" />
          </ElSelect>
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
          <ElPopover
            placement="bottom-end"
            trigger="click"
            :width="app.canManageTaskCenterFields ? 340 : 260"
            popper-class="task-column-popover"
          >
            <template #reference>
              <ElButton plain class="icon-only-button" aria-label="字段展示">
                <ElIcon><Setting /></ElIcon>
              </ElButton>
            </template>
            <div class="task-column-panel">
              <div class="task-column-panel-head">
                <strong>{{ app.canManageTaskCenterFields ? '字段展示与组员可见' : '选择展示字段' }}</strong>
                <button type="button" @click="showAllColumns">{{ app.canManageTaskCenterFields ? '全选本人' : '全选' }}</button>
              </div>
              <div v-if="app.canManageTaskCenterFields" class="task-column-grid task-column-grid-head">
                <span>字段</span>
                <span>本人显示</span>
                <span>组员可见</span>
              </div>
              <div v-if="app.canManageTaskCenterFields" class="task-column-grid">
                <template v-for="column in currentColumnOptions" :key="column.key">
                  <span class="task-column-name">{{ column.label }}</span>
                  <ElCheckbox :model-value="visibleColumnKeys.includes(column.key)" @change="checked => setColumnVisible(column.key, checked)" />
                  <ElCheckbox :model-value="memberVisibleColumnKeys.includes(column.key)" @change="checked => setMemberColumnVisible(column.key, checked)" />
                </template>
              </div>
              <ElCheckboxGroup v-else v-model="visibleColumnKeys">
                <ElCheckbox
                  v-for="column in currentColumnOptions"
                  :key="column.key"
                  :label="column.key"
                >{{ column.label }}</ElCheckbox>
              </ElCheckboxGroup>
              <div v-if="app.canManageTaskCenterFields" class="task-column-panel-actions">
                <button type="button" @click="showAllMemberColumns">组员全选</button>
                <button type="button" :disabled="savingMemberColumns" @click="saveMemberVisibleColumns">
                  {{ savingMemberColumns ? '保存中' : '保存组员可见字段' }}
                </button>
              </div>
            </div>
          </ElPopover>
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
      <ElTableColumn v-if="isColumnVisible('task')" label="任务" min-width="360">
        <template #default="{ row }">
          <div class="project-cell" @click.stop="selectTask(row)">
            <div class="task-title-row">
              <a
                v-if="app.zentaoTaskUrl(row)"
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
      <ElTableColumn v-if="isColumnVisible('owner')" :label="app.isPlatformAdmin ? '负责人' : '人员'" min-width="110">
        <template #default="{ row }">{{ row.developer || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('aiLevel')" label="AI 估级" width="120">
        <template #default="{ row }">
          <span v-if="app.isLowEffortArtAcceptanceTask(row)" class="muted-cell">-</span>
          <ElTooltip v-else :content="app.workloadEstimateHtml(row.workloadEstimate)" placement="top" effect="dark" raw-content popper-class="workload-estimate-tooltip">
            <div class="workload-level-cell">
              <ElTag :type="app.workloadLevelTagType(row.workloadEstimate?.level)" effect="dark">{{ row.workloadEstimate?.level || '-' }}</ElTag>
              <small>{{ row.workloadEstimate?.confidence || 0 }}%</small>
            </div>
          </ElTooltip>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('zentaoCompletion')" label="禅道完成度" min-width="130">
        <template #default="{ row }">
          <div class="progress-cell">
            <ElProgress :percentage="row.completion" :stroke-width="8" :show-text="false" />
            <small>{{ row.completion }}%</small>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('runCount')" label="执行次数" min-width="100">
        <template #default="{ row }">
          <button type="button" class="inline-metric-link run-count" :disabled="!row.runCount" @click.stop="app.openTaskRunHistory(row)">
            {{ row.runCount }}
          </button>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('aiQuality')" label="AI 质量" width="130">
        <template #default="{ row }">
          <div class="quality-score-cell">
            <strong :class="app.qualityScoreClass(row.quality.aiScore)">{{ row.quality.executed ? `${row.quality.aiScore}%` : '-' }}</strong>
            <small>阶段闭环 {{ row.quality.stageCompletion }}%</small>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('zentaoStatus')" label="禅道状态" min-width="110">
        <template #default="{ row }">
          <ElTag :class="['semantic-status-tag', app.zentaoStatusClass(row.zentaoStatus || row.zentao?.originalStatus)]">{{ app.zentaoStatusLabel(row.zentaoStatus || row.zentao?.originalStatus) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('deliveryStatus')" label="交付状态" min-width="110">
        <template #default="{ row }">
          <ElTooltip v-if="['conditional', 'conditional_accepted', 'rework'].includes(row.platformStatus)" :content="app.businessTaskStatusHint(row)" placement="top">
            <ElTag :class="['semantic-status-tag', app.businessTaskStatusClass(row.platformStatus)]">{{ app.businessTaskStatusLabel(row.platformStatus) }}</ElTag>
          </ElTooltip>
          <ElTag v-else :class="['semantic-status-tag', app.businessTaskStatusClass(row.platformStatus)]">{{ app.businessTaskStatusLabel(row.platformStatus) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('deadline')" label="截止时间" min-width="120">
        <template #default="{ row }">
          <span :class="['deadline-cell', app.deadlineState(row.deadline || row.zentao?.deadline)]">{{ row.deadline || row.zentao?.deadline || '-' }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('zentaoCreatedAt')" label="禅道创建时间" min-width="150">
        <template #default="{ row }">{{ app.formatDateTime(row.zentaoCreatedAt || row.zentao?.openedDate) }}</template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('updatedAt')" label="更新时间" min-width="150">
        <template #default="{ row }">{{ app.formatDateTime(row.lastSyncedAt || row.updatedAt || row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('actions')" label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <div class="table-action-row">
            <ElButton
              v-if="app.can('run.create')"
              size="small"
              type="primary"
              plain
              :class="['task-run-action-button', app.hasTaskRunRecords(row) ? 'repeat' : 'initial']"
              @click.stop="selectTask(row); app.createRunFromTask(row)"
            >{{ app.taskRunButtonLabel(row) }}</ElButton>
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
      <ElTableColumn v-if="isColumnVisible('bug')" label="Bug" min-width="420">
        <template #default="{ row }">
          <div class="project-cell">
            <a v-if="app.zentaoBugUrl(row)" :href="app.zentaoBugUrl(row)" target="_blank" rel="noopener noreferrer" class="task-title-link" @click.stop>{{ row.displayTitle }}</a>
            <strong v-else>{{ row.displayTitle }}</strong>
            <span>{{ row.projectName }} · 归因任务：{{ row.zentao?.task || '未关联' }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('assignee')" label="指派人" min-width="110">
        <template #default="{ row }">{{ row.developer || row.assignedTo || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('bugAiLevel')" label="AI 估级" width="120">
        <template #default="{ row }">
          <ElTooltip :content="app.workloadEstimateHtml(row.workloadEstimate)" placement="top" effect="dark" raw-content popper-class="workload-estimate-tooltip">
            <div class="workload-level-cell">
              <ElTag :type="app.workloadLevelTagType(row.workloadEstimate?.level)" effect="dark">{{ row.workloadEstimate?.level || '-' }}</ElTag>
              <small>{{ row.workloadEstimate?.confidence || 0 }}%</small>
            </div>
          </ElTooltip>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('severity')" label="严重级别">
        <template #default="{ row }">
          <ElTag :type="app.bugSeverityTagType(row.severity)" effect="plain">S{{ row.severity || '-' }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('priority')" label="优先级">
        <template #default="{ row }">
          <ElTag :type="app.bugPriorityTagType(row.pri)" effect="plain">P{{ row.pri || '-' }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('bugStatus')" label="Bug 状态">
        <template #default="{ row }">
          <ElTag :type="app.bugStatusTagType(row.status)">{{ app.bugStatusLabel(row.status) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('bugDeadline')" label="截止时间" min-width="120">
        <template #default="{ row }">
          <span :class="['deadline-cell', app.deadlineState(row.deadline)]">{{ row.deadline || '-' }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('bugCreatedAt')" label="创建时间" min-width="150">
        <template #default="{ row }">{{ app.formatDateTime(row.openedAt || row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('bugUpdatedAt')" label="更新时间" min-width="150">
        <template #default="{ row }">{{ app.formatDateTime(row.updatedAt || row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn v-if="isColumnVisible('bugActions')" label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <div class="table-action-row">
            <ElButton v-if="app.can('run.create')" size="small" type="primary" plain @click.stop="app.createRunFromBug(row)">发起修复</ElButton>
          </div>
        </template>
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

  <aside v-if="app.taskCenterModeForView(revision) === 'task'" :class="['task-processing-sidebar', { collapsed: processingCollapsed }]">
    <button
      v-if="processingCollapsed"
      type="button"
      class="processing-collapse-tab"
      @click="processingCollapsed = false"
      aria-label="展开任务处理单"
    >
      <span>任务处理单</span>
    </button>
    <section class="task-processing-sheet">
      <button type="button" class="processing-sheet-toggle" @click="processingCollapsed = true">收起</button>
      <h4>任务处理单</h4>
      <div class="processing-title">
        <strong>{{ processingTask?.displayTitle || '未选择任务' }}</strong>
        <span v-if="processingTask">{{ processingTask.developer || '未填写人员' }} · 截止 {{ processingTask.deadline || processingTask.zentao?.deadline || '-' }}</span>
        <span v-else>从左侧任务列表选择一条任务后，可记录备注、生成分析指令或发起执行。</span>
      </div>
      <div v-if="processingTask" class="processing-tags">
        <ElTag :class="['semantic-status-tag', app.businessTaskStatusClass(processingTask.platformStatus)]">{{ app.businessTaskStatusLabel(processingTask.platformStatus) }}</ElTag>
        <ElTag :class="['semantic-status-tag', app.zentaoStatusClass(processingTask.zentaoStatus || processingTask.zentao?.originalStatus)]">{{ app.zentaoStatusLabel(processingTask.zentaoStatus || processingTask.zentao?.originalStatus) }}</ElTag>
        <ElTag :class="['semantic-status-tag', app.deadlineState(processingTask.deadline || processingTask.zentao?.deadline) === 'soon' || app.deadlineState(processingTask.deadline || processingTask.zentao?.deadline) === 'overdue' ? 'status-danger' : 'status-muted']">
          {{ processingTask.deadline || processingTask.zentao?.deadline || '无截止' }}
        </ElTag>
        <ElTag v-for="flag in app.taskPriorityFlags(processingTask)" :key="flag.type" :class="['task-flag-tag', 'status-pending', flag.type]">{{ flag.label }}</ElTag>
      </div>
      <div v-else class="processing-tags">
        <ElTag class="semantic-status-tag status-muted">待选择</ElTag>
        <ElTag class="semantic-status-tag status-muted">未进入工作流</ElTag>
      </div>
      <div class="processing-field">
        <label>父任务 / 需求</label>
        <p>{{ processingTask ? (processingTask.zentao?.parentName || processingTask.zentao?.storyTitle || processingTask.requirement || '-') : '选择任务后显示对应父任务、需求或项目来源。' }}</p>
      </div>
      <div class="processing-field">
        <label>美术摘要</label>
        <p>{{ processingTask ? app.taskProcessingSummary(processingTask) : '选择任务后显示美术摘要、产出范围和需要确认的问题。' }}</p>
        <button
          v-if="processingTask && app.taskArtBriefForTask(processingTask)?.reportUrl"
          class="processing-report-link"
          type="button"
          @click="app.openTaskArtBrief(processingTask)"
        >打开美术简报页面</button>
      </div>
      <div class="processing-field">
        <label>工作流状态</label>
        <p>{{ processingTask ? app.taskProcessingStatus(processingTask) : '未选择任务，暂不进入执行或验收流程。' }}</p>
      </div>
      <div class="processing-field">
        <label>处理备注</label>
        <small v-if="processingTask && app.taskProcessingNoteMeta(processingTask)" class="processing-field-meta">{{ app.taskProcessingNoteMeta(processingTask) }}</small>
        <ElInput
          :model-value="processingTask ? app.taskProcessingNote(processingTask) : ''"
          type="textarea"
          :rows="6"
          :disabled="!processingTask"
          :placeholder="processingTask ? app.taskProcessingNotePlaceholder : '请先选择左侧任务'"
          @update:model-value="value => app.updateTaskProcessingNote(processingTask, value)"
        />
      </div>
      <div v-if="app.isPlatformAdmin" class="processing-help">处理备注会同步给团队成员；修改记录写入操作日志。</div>
      <div class="processing-actions">
        <ElButton v-if="app.can('task.note.manage')" :disabled="!processingTask" @click="app.saveTaskProcessingNote(processingTask)">保存备注</ElButton>
        <ElButton
          v-if="app.can('task.artBrief.generate')"
          class="art-brief-action-button"
          :disabled="!processingTask"
          :loading="processingTask ? app.isTaskArtBriefLoading(processingTask) : false"
          @click="app.generateArtBriefForTask(processingTask, { force: !!app.taskArtBriefForTask(processingTask) })"
        >{{ processingTask && app.taskArtBriefForTask(processingTask) ? '重新生成美术摘要' : '生成美术摘要' }}</ElButton>
        <ElButton v-if="app.can('task.codexPrompt.copy')" type="primary" :disabled="!processingTask" @click="app.copyCodexPromptForTask(processingTask)">AI 只分析</ElButton>
        <ElButton
          v-if="app.can('run.create')"
          :disabled="!processingTask"
          :class="['task-run-action-button', app.hasTaskRunRecords(processingTask) ? 'repeat' : 'initial']"
          @click="app.createRunFromTask(processingTask)"
        >AI 自动跑本地工作</ElButton>
        <ElButton v-if="app.can('task.codexPrompt.copy')" :disabled="!processingTask" @click="app.copyCodexPromptForTask(processingTask)">复制给 Codex 的指令</ElButton>
      </div>
    </section>
  </aside>
  </div>

  <ElCard shadow="never" class="panel-card page-card" v-if="app.taskCenterModeForView(revision) === 'bug' && app.selectedBug">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>
            <a v-if="app.zentaoBugUrl(app.selectedBug)" :href="app.zentaoBugUrl(app.selectedBug)" target="_blank" rel="noopener noreferrer" class="task-title-link" @click.stop>{{ app.selectedBug.displayTitle }}</a>
            <span v-else>{{ app.selectedBug.displayTitle }}</span>
          </h3>
          <p>{{ app.selectedBug.projectName }} · {{ app.bugAssigneeName(app.selectedBug) }}</p>
        </div>
        <div class="panel-actions">
          <ElButton v-if="app.can('run.create')" type="primary" class="task-run-action-button initial" @click="app.createRunFromBug(app.selectedBug)">发起修复</ElButton>
        </div>
      </div>
    </template>
    <div class="bug-detail-panel">
      <section>
        <h4>Bug 信息</h4>
        <div class="workload-estimate-panel bug">
          <div>
            <span>AI 估级</span>
            <strong :class="`level-${app.selectedBug.workloadEstimate?.level || 'unknown'}`">{{ app.selectedBug.workloadEstimate?.level || '-' }}</strong>
          </div>
          <p>{{ app.workloadEstimateText(app.selectedBug.workloadEstimate) }}</p>
        </div>
        <div class="bug-detail-grid">
          <div>
            <span>Bug 状态</span>
            <ElTag :type="app.bugStatusTagType(app.selectedBug.status)">{{ app.bugStatusLabel(app.selectedBug.status) }}</ElTag>
          </div>
          <div>
            <span>严重级别</span>
            <ElTag :type="app.bugSeverityTagType(app.selectedBug.severity)" effect="plain">S{{ app.selectedBug.severity || '-' }}</ElTag>
          </div>
          <div>
            <span>优先级</span>
            <ElTag :type="app.bugPriorityTagType(app.selectedBug.pri)" effect="plain">P{{ app.selectedBug.pri || '-' }}</ElTag>
          </div>
          <div>
            <span>截止时间</span>
            <strong :class="['deadline-cell', app.deadlineState(app.selectedBug.deadline)]">{{ app.selectedBug.deadline || '-' }}</strong>
          </div>
          <div>
            <span>归因任务</span>
            <strong>{{ app.selectedBug.zentao?.task || '未关联' }}</strong>
          </div>
          <div>
            <span>更新时间</span>
            <strong>{{ app.formatDateTime(app.selectedBug.updatedAt || app.selectedBug.createdAt) }}</strong>
          </div>
        </div>
      </section>
      <section>
        <h4>处理动作</h4>
        <div class="bug-action-box">
          <strong>按 Bug 修复流程发起一次执行</strong>
          <span>平台会带入 Bug 标题、状态、严重级别、优先级和截止时间，生成复现定位、最小修复、验证与回归说明的执行任务。</span>
          <ElButton v-if="app.can('run.create')" type="primary" class="task-run-action-button initial" @click="app.createRunFromBug(app.selectedBug)">发起修复</ElButton>
        </div>
      </section>
    </div>
  </ElCard>

  <ElCard shadow="never" class="panel-card page-card" v-else-if="app.selectedBusinessTask">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>
            <a v-if="app.zentaoTaskUrl(app.selectedBusinessTask)" :href="app.zentaoTaskUrl(app.selectedBusinessTask)" target="_blank" rel="noopener noreferrer" class="task-title-link" @click.stop>{{ app.selectedBusinessTask.displayTitle }}</a>
            <span v-else>{{ app.selectedBusinessTask.displayTitle }}</span>
          </h3>
          <p>{{ app.selectedBusinessTask.projectName }} · {{ app.selectedBusinessTask.developer || '未填写人员' }}</p>
        </div>
        <div class="panel-actions">
          <ElButton
            v-if="app.can('run.create')"
            type="primary"
            :class="['task-run-action-button', app.hasTaskRunRecords(app.selectedBusinessTask) ? 'repeat' : 'initial']"
            @click="app.createRunFromTask(app.selectedBusinessTask)"
          >{{ app.taskRunButtonLabel(app.selectedBusinessTask) }}</ElButton>
        </div>
      </div>
    </template>
    <div class="business-task-detail">
      <section class="task-processing-sheet">
        <h4>任务处理单</h4>
        <div class="processing-title">
          <strong>{{ app.selectedBusinessTask.displayTitle }}</strong>
          <span>{{ app.selectedBusinessTask.developer || '未填写人员' }} · 截止 {{ app.selectedBusinessTask.deadline || app.selectedBusinessTask.zentao?.deadline || '-' }}</span>
        </div>
        <div class="processing-tags">
          <ElTag :class="['semantic-status-tag', app.businessTaskStatusClass(app.selectedBusinessTask.platformStatus)]">{{ app.businessTaskStatusLabel(app.selectedBusinessTask.platformStatus) }}</ElTag>
          <ElTag :class="['semantic-status-tag', app.zentaoStatusClass(app.selectedBusinessTask.zentaoStatus || app.selectedBusinessTask.zentao?.originalStatus)]">{{ app.zentaoStatusLabel(app.selectedBusinessTask.zentaoStatus || app.selectedBusinessTask.zentao?.originalStatus) }}</ElTag>
          <ElTag :class="['semantic-status-tag', app.deadlineState(app.selectedBusinessTask.deadline || app.selectedBusinessTask.zentao?.deadline) === 'soon' || app.deadlineState(app.selectedBusinessTask.deadline || app.selectedBusinessTask.zentao?.deadline) === 'overdue' ? 'status-danger' : 'status-muted']">
            {{ app.selectedBusinessTask.deadline || app.selectedBusinessTask.zentao?.deadline || '无截止' }}
          </ElTag>
          <ElTag v-for="flag in app.taskPriorityFlags(app.selectedBusinessTask)" :key="flag.type" :class="['task-flag-tag', 'status-pending', flag.type]">{{ flag.label }}</ElTag>
        </div>
        <div class="processing-field">
          <label>美术摘要</label>
          <p>{{ app.taskProcessingSummary(app.selectedBusinessTask) }}</p>
          <button
            v-if="app.taskArtBriefForTask(app.selectedBusinessTask)?.reportUrl"
            class="processing-report-link"
            type="button"
            @click="app.openTaskArtBrief(app.selectedBusinessTask)"
          >打开美术简报页面</button>
        </div>
        <div class="processing-field">
          <label>工作流状态</label>
          <p>{{ app.taskProcessingStatus(app.selectedBusinessTask) }}</p>
        </div>
        <div class="processing-field">
          <label>处理备注</label>
          <small v-if="app.taskProcessingNoteMeta(app.selectedBusinessTask)" class="processing-field-meta">{{ app.taskProcessingNoteMeta(app.selectedBusinessTask) }}</small>
          <ElInput
            :model-value="app.taskProcessingNote(app.selectedBusinessTask)"
            type="textarea"
            :rows="5"
            :placeholder="app.taskProcessingNotePlaceholder"
            @update:model-value="value => app.updateTaskProcessingNote(app.selectedBusinessTask, value)"
          />
        </div>
        <div v-if="app.isPlatformAdmin" class="processing-help">处理备注会同步给团队成员；修改记录写入操作日志。</div>
        <div class="processing-actions">
          <ElButton v-if="app.can('task.note.manage')" @click="app.saveTaskProcessingNote(app.selectedBusinessTask)">保存备注</ElButton>
          <ElButton
            v-if="app.can('task.artBrief.generate')"
            class="art-brief-action-button"
            :loading="app.isTaskArtBriefLoading(app.selectedBusinessTask)"
            @click="app.generateArtBriefForTask(app.selectedBusinessTask, { force: !!app.taskArtBriefForTask(app.selectedBusinessTask) })"
          >{{ app.taskArtBriefForTask(app.selectedBusinessTask) ? '重新生成美术摘要' : '生成美术摘要' }}</ElButton>
          <ElButton v-if="app.can('task.codexPrompt.copy')" type="primary" @click="app.copyCodexPromptForTask(app.selectedBusinessTask)">复制给 Codex 的指令</ElButton>
          <ElButton
            v-if="app.can('run.create')"
            :class="['task-run-action-button', app.hasTaskRunRecords(app.selectedBusinessTask) ? 'repeat' : 'initial']"
            @click="app.createRunFromTask(app.selectedBusinessTask)"
          >{{ app.taskRunButtonLabel(app.selectedBusinessTask) }}</ElButton>
        </div>
      </section>
      <section class="task-quality-section">
        <h4>AI 交付质量</h4>
        <div v-if="!app.isLowEffortArtAcceptanceTask(app.selectedBusinessTask)" class="workload-estimate-panel">
          <div>
            <span>AI 估级</span>
            <strong :class="`level-${app.selectedBusinessTask.workloadEstimate?.level || 'unknown'}`">{{ app.selectedBusinessTask.workloadEstimate?.level || '-' }}</strong>
          </div>
          <p>{{ app.workloadEstimateText(app.selectedBusinessTask.workloadEstimate) }}</p>
        </div>
        <div class="task-quality-grid">
          <div>
            <span>AI 完成度</span>
            <strong :class="app.qualityScoreClass(app.selectedBusinessTask.quality.aiScore)">{{ app.selectedBusinessTask.quality.executed ? `${app.selectedBusinessTask.quality.aiScore}%` : '未执行' }}</strong>
          </div>
          <div>
            <span>阶段闭环</span>
            <strong>{{ app.selectedBusinessTask.quality.stageCompletion }}%</strong>
          </div>
          <div>
            <span>关联 Bug</span>
            <strong>{{ app.selectedBusinessTask.quality.bugCount }}</strong>
          </div>
          <div>
            <span>严重 Bug</span>
            <strong class="danger">{{ app.selectedBusinessTask.quality.criticalBugCount }}</strong>
          </div>
          <div>
            <span>执行耗时</span>
            <strong>{{ app.selectedBusinessTask.quality.durationText }}</strong>
          </div>
        </div>
        <div v-if="app.selectedBusinessTask.quality.latestReview" class="latest-review-note">
          <ElTag size="small" :type="app.taskReviewDecisionTagType(app.selectedBusinessTask.quality.latestReview.decision)">
            {{ app.taskReviewDecisionLabel(app.selectedBusinessTask.quality.latestReview.decision) }}
          </ElTag>
          <span>人工 {{ app.selectedBusinessTask.quality.manualScore }} 分 · {{ app.formatDateTime(app.selectedBusinessTask.quality.latestReview.createdAt) }}</span>
        </div>
        <div v-else class="latest-review-note muted">暂无人工验收，当前评分主要来自执行过程估算。</div>
      </section>
      <section class="task-review-section">
        <h4>人工验收评分</h4>
        <div v-if="!app.hasTaskRunRecords(app.selectedBusinessTask)" class="task-review-locked">
          <strong>尚未执行，不能人工验收</strong>
          <span>人工验收必须基于一次真实执行结果。请先发起执行，生成报告、截图或日志后再评分。</span>
          <ElButton
            v-if="app.can('run.create')"
            type="primary"
            class="task-run-action-button initial"
            @click="app.createRunFromTask(app.selectedBusinessTask)"
          >发起执行</ElButton>
        </div>
        <div v-else class="task-review-form">
          <ElSelect :model-value="app.taskReviewForm.decision" @update:model-value="value => app.taskReviewForm.decision = value" placeholder="验收结论">
            <ElOption label="通过" value="approved" />
            <ElOption label="有条件通过" value="conditional" />
            <ElOption label="驳回" value="rejected" />
          </ElSelect>
          <div class="review-score-grid">
            <label>
              <span>总分</span>
              <ElInputNumber :model-value="app.taskReviewForm.score" @update:model-value="value => app.taskReviewForm.score = value" :min="0" :max="100" />
            </label>
            <label>
              <span>需求覆盖</span>
              <ElInputNumber :model-value="app.taskReviewForm.requirementScore" @update:model-value="value => app.taskReviewForm.requirementScore = value" :min="0" :max="100" />
            </label>
            <label>
              <span>代码质量</span>
              <ElInputNumber :model-value="app.taskReviewForm.qualityScore" @update:model-value="value => app.taskReviewForm.qualityScore = value" :min="0" :max="100" />
            </label>
            <label>
              <span>UI 还原</span>
              <ElInputNumber :model-value="app.taskReviewForm.uiScore" @update:model-value="value => app.taskReviewForm.uiScore = value" :min="0" :max="100" />
            </label>
            <label>
              <span>验证质量</span>
              <ElInputNumber :model-value="app.taskReviewForm.validationScore" @update:model-value="value => app.taskReviewForm.validationScore = value" :min="0" :max="100" />
            </label>
            <label>
              <span>发现 Bug</span>
              <ElInputNumber :model-value="app.taskReviewForm.bugCount" @update:model-value="value => app.taskReviewForm.bugCount = value" :min="0" />
            </label>
            <label>
              <span>严重 Bug</span>
              <ElInputNumber :model-value="app.taskReviewForm.criticalBugCount" @update:model-value="value => app.taskReviewForm.criticalBugCount = value" :min="0" />
            </label>
          </div>
          <ElInput :model-value="app.taskReviewForm.comment" @update:model-value="value => app.taskReviewForm.comment = value" type="textarea" :rows="3" placeholder="记录验收问题、扣分原因、处理要求或通过说明。" />
          <ElButton v-if="app.can('review.submit')" type="primary" @click="app.submitTaskReview(app.selectedBusinessTask)">提交验收</ElButton>
        </div>
        <div class="task-review-history">
          <button v-for="review in app.taskReviewHistory" :key="review.id" type="button" class="task-review-record" @click="app.loadTaskReviewRecord(review)">
            <ElTag size="small" :type="app.taskReviewDecisionTagType(review.decision)">{{ app.taskReviewDecisionLabel(review.decision) }}</ElTag>
            <div>
              <strong>{{ review.score }} 分</strong>
              <span>{{ app.formatDateTime(review.createdAt) }}</span>
              <p>{{ review.comment || '未填写说明。' }}</p>
            </div>
          </button>
          <div v-if="!app.taskReviewHistory.length" class="empty-block">暂无人工验收记录。</div>
        </div>
      </section>
      <section>
        <h4>执行流程阶段</h4>
        <div class="business-stage-list">
          <div v-for="(stage, index) in app.businessTaskStages(app.selectedBusinessTask)" :key="stage.name" :class="['business-stage-row', app.businessStageStatusClass(stage.status)]">
            <span>{{ index + 1 }}. {{ stage.name }}</span>
            <ElTag size="small" effect="dark" :type="app.stageStatusTagType(stage.status)">{{ app.stageStepLabel(stage.status) }}</ElTag>
          </div>
          <div v-if="!app.businessTaskStages(app.selectedBusinessTask).length" class="empty-block">
            尚未生成执行流程。点击“发起执行”后，会按本次选择的执行模式生成阶段记录。
          </div>
        </div>
      </section>
      <section ref="taskRunHistorySection" class="task-run-history-section">
        <h4>执行历史</h4>
        <div class="task-run-list">
          <button v-for="run in app.runsForTask(app.selectedBusinessTask)" :key="run.id" class="task-run-item" @click="app.openRun(run)">
            <div class="task-run-meta">
              <strong>第 {{ app.runAttemptNumber(run) }} 次执行</strong>
              <ElTag size="small" :type="app.runTagType(run.status)">{{ app.runStatusLabel(run.status) }}</ElTag>
              <span>{{ app.workflowRunLabel(run) }}</span>
            </div>
            <time>{{ app.formatDateTime(app.runDisplayTime(run)) }}</time>
          </button>
          <div v-if="!app.runsForTask(app.selectedBusinessTask).length" class="empty-block">暂无执行记录。</div>
        </div>
      </section>
    </div>
  </ElCard>
</section>
</template>

<script>
import { ElMessage } from 'element-plus';
import { Setting } from '@element-plus/icons-vue';

const TASK_COLUMN_STORAGE_KEY = 'platform-task-center-visible-columns';
const TASK_COLUMN_OPTIONS = {
  task: [
    { key: 'task', label: '任务' },
    { key: 'owner', label: '负责人' },
    { key: 'aiLevel', label: 'AI 估级' },
    { key: 'zentaoCompletion', label: '禅道完成度' },
    { key: 'runCount', label: '执行次数' },
    { key: 'aiQuality', label: 'AI 质量' },
    { key: 'zentaoStatus', label: '禅道状态' },
    { key: 'deliveryStatus', label: '交付状态' },
    { key: 'deadline', label: '截止时间' },
    { key: 'zentaoCreatedAt', label: '禅道创建时间' },
    { key: 'updatedAt', label: '更新时间' },
    { key: 'actions', label: '操作' }
  ],
  bug: [
    { key: 'bug', label: 'Bug' },
    { key: 'assignee', label: '指派人' },
    { key: 'bugAiLevel', label: 'AI 估级' },
    { key: 'severity', label: '严重级别' },
    { key: 'priority', label: '优先级' },
    { key: 'bugStatus', label: 'Bug 状态' },
    { key: 'bugDeadline', label: '截止时间' },
    { key: 'bugCreatedAt', label: '创建时间' },
    { key: 'bugUpdatedAt', label: '更新时间' },
    { key: 'bugActions', label: '操作' }
  ]
};

function defaultColumnState() {
  return Object.fromEntries(Object.entries(TASK_COLUMN_OPTIONS).map(([mode, columns]) => [mode, columns.map(column => column.key)]));
}

export default {
  name: 'TaskCenterView',
  components: {
    Setting
  },
  data() {
    return {
      localProcessingTask: null,
      metricsExpanded: false,
      processingCollapsed: true,
      visibleColumns: defaultColumnState(),
      memberVisibleColumns: defaultColumnState(),
      savingMemberColumns: false
    };
  },
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
    processingTask() {
      return this.app.selectedBusinessTask || this.localProcessingTask;
    },
    primaryTaskMetrics() {
      const preferred = ['业务任务', '今天截止', '临期任务', '卡点任务', '急单', '插单'];
      const metrics = this.app.taskCenterMetrics || [];
      const map = new Map(metrics.map(metric => [metric.label, metric]));
      const primary = preferred.map(label => map.get(label)).filter(Boolean);
      return primary.length ? primary : metrics.slice(0, 6);
    },
    secondaryTaskMetrics() {
      const primaryLabels = new Set(this.primaryTaskMetrics.map(metric => metric.label));
      return (this.app.taskCenterMetrics || []).filter(metric => !primaryLabels.has(metric.label));
    },
    expandedMetricTitle() {
      const count = this.secondaryTaskMetrics.length;
      return count ? `核心总览 · 其余 ${count} 项默认收起` : '核心总览';
    },
    currentColumnMode() {
      return this.app.taskCenterModeForView(this.revision);
    },
    currentColumnOptions() {
      const columns = TASK_COLUMN_OPTIONS[this.currentColumnMode] || TASK_COLUMN_OPTIONS.task;
      if (this.app.canManageTaskCenterFields) return columns;
      const allowed = new Set(this.allowedColumnKeysForCurrentUser);
      return columns.filter(column => allowed.has(column.key));
    },
    memberVisibleColumnKeys() {
      const keys = this.memberVisibleColumns[this.currentColumnMode] || [];
      return keys.length ? keys : this.currentColumnOptions.map(column => column.key);
    },
    allowedColumnKeysForCurrentUser() {
      const defaults = (TASK_COLUMN_OPTIONS[this.currentColumnMode] || TASK_COLUMN_OPTIONS.task).map(column => column.key);
      if (this.app.canManageTaskCenterFields) return defaults;
      const configured = this.app.appConfig?.taskCenter?.memberVisibleColumns?.[this.currentColumnMode] || [];
      return configured.length ? configured : defaults;
    },
    visibleColumnKeys: {
      get() {
        const selected = this.visibleColumns[this.currentColumnMode] || this.currentColumnOptions.map(column => column.key);
        const allowed = new Set(this.allowedColumnKeysForCurrentUser);
        return selected.filter(key => allowed.has(key));
      },
      set(value) {
        const allowed = new Set(this.allowedColumnKeysForCurrentUser);
        this.visibleColumns = {
          ...this.visibleColumns,
          [this.currentColumnMode]: value.filter(key => allowed.has(key))
        };
        this.saveVisibleColumns();
      }
    }
  },
  watch: {
    'app.appConfig.taskCenter': {
      deep: true,
      immediate: true,
      handler() {
        this.loadMemberVisibleColumns();
      }
    }
  },
  mounted() {
    this.loadVisibleColumns();
    this.loadMemberVisibleColumns();
  },
  methods: {
    selectTask(row) {
      this.localProcessingTask = row || null;
      this.app.selectBusinessTask(row);
      this.$forceUpdate();
    },
    isColumnVisible(key) {
      return this.visibleColumnKeys.includes(key);
    },
    showAllColumns() {
      this.visibleColumnKeys = this.currentColumnOptions.map(column => column.key);
    },
    showAllMemberColumns() {
      this.memberVisibleColumns = {
        ...this.memberVisibleColumns,
        [this.currentColumnMode]: this.currentColumnOptions.map(column => column.key)
      };
    },
    setColumnVisible(key, checked) {
      const next = new Set(this.visibleColumnKeys);
      if (checked) next.add(key);
      else next.delete(key);
      this.visibleColumnKeys = [...next];
      if (this.app.canManageTaskCenterFields && !checked) this.setMemberColumnVisible(key, false);
    },
    setMemberColumnVisible(key, checked) {
      const next = new Set(this.memberVisibleColumnKeys);
      if (checked) next.add(key);
      else next.delete(key);
      this.memberVisibleColumns = {
        ...this.memberVisibleColumns,
        [this.currentColumnMode]: [...next]
      };
    },
    loadMemberVisibleColumns() {
      const configured = this.app.appConfig?.taskCenter?.memberVisibleColumns || {};
      const defaults = defaultColumnState();
      this.memberVisibleColumns = Object.fromEntries(Object.entries(defaults).map(([mode, keys]) => {
        const allowed = new Set(keys);
        const savedKeys = Array.isArray(configured[mode]) ? configured[mode].filter(key => allowed.has(key)) : [];
        return [mode, savedKeys.length ? savedKeys : keys];
      }));
    },
    async saveMemberVisibleColumns() {
      if (!this.app.canManageTaskCenterFields || this.savingMemberColumns) return;
      this.savingMemberColumns = true;
      try {
        await this.app.saveTaskCenterConfig({ memberVisibleColumns: this.memberVisibleColumns });
        ElMessage.success('组员可见字段已保存');
      } catch (error) {
        ElMessage.error(this.app.readApiError(error) || '字段配置保存失败');
      } finally {
        this.savingMemberColumns = false;
      }
    },
    loadVisibleColumns() {
      try {
        const saved = JSON.parse(localStorage.getItem(TASK_COLUMN_STORAGE_KEY) || '{}');
        const defaults = defaultColumnState();
        this.visibleColumns = Object.fromEntries(Object.entries(defaults).map(([mode, keys]) => {
          const allowed = new Set(keys);
          const savedKeys = Array.isArray(saved[mode]) ? saved[mode].filter(key => allowed.has(key)) : [];
          return [mode, savedKeys.length ? savedKeys : keys];
        }));
      } catch {
        this.visibleColumns = defaultColumnState();
      }
    },
    saveVisibleColumns() {
      localStorage.setItem(TASK_COLUMN_STORAGE_KEY, JSON.stringify(this.visibleColumns));
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

  .task-processing-sidebar {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
    width: 100%;
    align-self: start;
    position: sticky;
    top: 88px;
    z-index: 30;

    &.collapsed {
      min-width: 42px;
      width: 42px;
      justify-self: end;

      .task-processing-sheet {
        display: none;
      }
    }
  }

  .task-metrics-shell {
    display: grid;
    gap: 6px;
  }

  .task-metrics-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 2px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 820;
  }

  .task-metrics-primary,
  .task-metrics-secondary {
    grid-template-columns: repeat(6, minmax(150px, 1fr));
    gap: 8px;

    :deep(.el-card__body) {
      min-height: 92px;
      padding: 12px 14px;
    }
  }

  .task-metrics-secondary {
    padding-top: 4px;
  }

  .task-column-panel {
    display: grid;
    gap: 10px;
  }

  .task-column-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;

    strong {
      color: var(--heading);
      font-size: 13px;
      font-weight: 860;
    }

    button {
      border: 0;
      background: transparent;
      color: var(--primary);
      cursor: pointer;
      font-size: 12px;
      font-weight: 780;
    }
  }

  :deep(.task-column-popover .el-checkbox-group) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 10px;
  }

  :deep(.task-column-popover .el-checkbox) {
    height: 24px;
    margin-right: 0;
  }

  .task-column-grid {
    display: grid;
    grid-template-columns: minmax(96px, 1fr) 74px 74px;
    align-items: center;
    gap: 6px 8px;
  }

  .task-column-grid-head {
    color: var(--muted);
    font-size: 12px;
    font-weight: 780;
  }

  .task-column-name {
    color: var(--heading);
    font-size: 13px;
    font-weight: 780;
  }

  .task-column-grid :deep(.el-checkbox) {
    justify-content: center;
  }

  .task-column-panel-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;

    button {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--heading);
      cursor: pointer;
      font-size: 12px;
      font-weight: 780;
      padding: 6px 10px;

      &:disabled {
        cursor: not-allowed;
        opacity: 0.56;
      }
    }
  }

  .task-workbench-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(340px, clamp(360px, 24vw, 420px));
    grid-template-rows: auto;
    gap: 8px 12px;
    align-items: start;
    width: 100%;
    max-width: 100%;
    min-width: 0;

    &.processing-collapsed {
      grid-template-columns: minmax(0, 1fr) 42px;
    }
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
      .task-title-link,
      strong {
        display: inline;
        overflow: visible;
        color: #324361;
        font-size: 14px;
        font-weight: 680;
        line-height: 1.35;
        text-overflow: clip;
        white-space: normal;
        overflow-wrap: anywhere;
      }

      .task-title-link:hover {
        color: #3f63dd;
      }

      span {
        color: #8a93a6;
        font-weight: 560;
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

  .task-filter-select {
    width: 180px;
  }

  .task-filter-keyword {
    width: 280px;
  }

  .icon-only-button {
    width: 36px;
    min-width: 36px;
    padding: 0;

    .el-icon {
      font-size: 15px;
    }
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

  .task-run-action-button {
    min-width: 72px;
    font-weight: 800;

    :deep(span) {
      color: inherit !important;
    }

    &.initial {
      --el-button-text-color: #ffffff;
      --el-button-bg-color: var(--primary);
      --el-button-border-color: var(--primary);
      --el-button-hover-text-color: #ffffff;
      --el-button-hover-bg-color: var(--el-color-primary-dark-2);
      --el-button-hover-border-color: var(--el-color-primary-dark-2);
      --el-button-active-text-color: #ffffff;
      --el-button-active-bg-color: var(--el-color-primary-dark-2);
      --el-button-active-border-color: var(--el-color-primary-dark-2);

      &,
      :deep(span) {
        color: #ffffff !important;
      }
    }

    &.repeat {
      --el-button-text-color: var(--primary-ink);
      --el-button-bg-color: var(--control-bg);
      --el-button-border-color: var(--line-strong);
      --el-button-hover-text-color: var(--primary-ink);
      --el-button-hover-bg-color: var(--active-bg);
      --el-button-hover-border-color: color-mix(in srgb, var(--primary) 28%, var(--line-strong));
      --el-button-active-text-color: var(--primary-ink);
      --el-button-active-bg-color: color-mix(in srgb, var(--primary) 10%, var(--control-bg));
      --el-button-active-border-color: color-mix(in srgb, var(--primary) 34%, var(--line-strong));

      &,
      :deep(span) {
        color: var(--primary-ink) !important;
      }
    }
  }

  .progress-cell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34px;
    align-items: center;
    gap: 4px;

    small {
      color: var(--muted);
      font-weight: 800;
      text-align: right;
    }
  }

  .quality-score-cell {
    display: grid;
    gap: 2px;

    strong {
      font-size: 14px;
      line-height: 1.2;
    }

    small {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }
  }

  .workload-level-cell {
    display: inline-grid;
    grid-template-columns: auto auto;
    align-items: center;
    gap: 6px;

    .el-tag {
      min-width: 34px;
      justify-content: center;
    }

    small {
      color: var(--muted);
      font-size: 11px;
      font-weight: 680;
    }
  }

  .good {
    color: var(--primary);
  }

  .warn {
    color: #d99205;
  }

  .bad,
  .danger {
    color: #d94a4a;
  }

  .inline-metric-link {
    border: 0;
    background: transparent;
    color: var(--primary);
    cursor: pointer;
    font-size: 14px;
    font-weight: 800;
    text-underline-offset: 3px;

    &.bug {
      color: var(--primary);
    }

    &:hover {
      text-decoration: underline;
    }

    &:disabled {
      color: var(--muted);
      cursor: default;
      text-decoration: none;
    }
  }

  .danger-note {
    display: block;
    margin-top: 2px;
    color: #d94a4a;
    font-size: 11px;
    font-weight: 700;
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

  .business-task-detail {
    display: grid;
    grid-template-columns: minmax(330px, 0.74fr) repeat(2, minmax(260px, 1fr));
    gap: 18px;
    padding: 18px;

    section {
      min-width: 0;
    }

    h4 {
      margin: 0 0 12px;
      color: var(--heading);
      font-size: 14px;
    }

    p {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
      overflow-wrap: anywhere;
    }
  }

  .task-processing-sheet {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    max-height: none;
    overflow: visible;
    padding: 16px;
    border: 1px solid color-mix(in srgb, var(--ok) 26%, var(--line));
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--card) 92%, var(--primary-soft) 8%);
    box-shadow: 0 18px 44px rgba(31, 43, 92, 0.12);
    backdrop-filter: none;

    h4 {
      margin-bottom: 0;
    }
  }

  .processing-collapse-tab {
    position: sticky;
    top: 88px;
    display: grid;
    place-items: center;
    width: 42px;
    min-height: 168px;
    border: 1px solid color-mix(in srgb, var(--primary) 20%, var(--line));
    border-radius: 999px;
    background: color-mix(in srgb, var(--primary) 8%, var(--card));
    box-shadow: 0 14px 34px rgba(31, 43, 92, 0.12);
    color: var(--heading);
    cursor: pointer;
    font-size: 13px;
    font-weight: 860;
    letter-spacing: 0;
    transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;

    span {
      writing-mode: vertical-rl;
      text-orientation: mixed;
    }

    &:hover {
      border-color: color-mix(in srgb, var(--primary) 48%, var(--line));
      background: color-mix(in srgb, var(--primary) 13%, var(--card));
      transform: translateX(-2px);
    }
  }

  .processing-sheet-toggle {
    position: absolute;
    top: 12px;
    right: 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--card);
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    font-weight: 780;
    line-height: 1;
    padding: 6px 10px;

    &:hover {
      border-color: color-mix(in srgb, var(--primary) 42%, var(--line));
      color: var(--primary);
    }
  }

  .processing-title {
    display: grid;
    gap: 6px;

    strong,
    span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    strong {
      color: var(--heading);
      font-size: 15px;
      line-height: 1.45;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
    }
  }

  .processing-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .processing-field {
    display: grid;
    gap: 7px;

    label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 820;
    }

    p {
      margin: 0;
      padding: 10px 11px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--row-bg);
      color: var(--text);
      font-size: 13px;
      line-height: 1.65;
      white-space: pre-line;
    }
  }

  .processing-field-meta {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.35;
  }

  .processing-report-link {
    width: fit-content;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--primary-ink);
    cursor: pointer;
    font-size: 12px;
    font-weight: 820;
    font-family: inherit;
    text-decoration: none;
    text-underline-offset: 3px;

    &:hover {
      text-decoration: underline;
    }
  }

  .processing-help {
    padding: 10px 11px;
    border: 1px solid color-mix(in srgb, var(--warn) 25%, var(--line));
    border-radius: 8px;
    background: color-mix(in srgb, var(--warn) 8%, transparent);
    color: var(--muted);
    font-size: 12px;
    line-height: 1.55;
  }

  .processing-actions {
    display: grid;
    gap: 8px;
    margin-top: auto;

    .el-button {
      width: 100%;
      margin-left: 0 !important;
    }
  }

  .art-brief-action-button {
    --el-button-text-color: var(--primary-ink);
    --el-button-bg-color: var(--control-bg);
    --el-button-border-color: var(--line-strong);
    --el-button-hover-text-color: var(--primary-ink);
    --el-button-hover-bg-color: var(--active-bg);
    --el-button-hover-border-color: color-mix(in srgb, var(--primary) 28%, var(--line-strong));
    --el-button-active-text-color: var(--primary-ink);
    --el-button-active-bg-color: color-mix(in srgb, var(--primary) 10%, var(--control-bg));
    --el-button-active-border-color: color-mix(in srgb, var(--primary) 34%, var(--line-strong));
    font-weight: 840;
  }

  .semantic-status-tag {
    border: 0 !important;
    border-radius: 999px;
    font-weight: 760;
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

  .task-quality-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;

    div {
      min-width: 0;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--row-bg);
    }

    span,
    strong {
      display: block;
    }

    span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 760;
    }

    strong {
      margin-top: 4px;
      color: var(--heading);
      font-size: 15px;
      line-height: 1.3;
    }

    strong.good {
      color: var(--primary);
    }

    strong.warn {
      color: #d99205;
    }

    strong.bad,
    strong.danger {
      color: #d94a4a;
    }
  }

  .workload-estimate-panel {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    gap: 10px;
    margin-bottom: 12px;
    padding: 12px;
    border: 1px solid rgba(20, 184, 166, 0.22);
    border-radius: var(--radius);
    background: rgba(20, 184, 166, 0.08);

    &.bug {
      margin-bottom: 0;
    }

    > div {
      display: grid;
      place-items: center;
      min-height: 74px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.74);
    }

    span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
    }

    strong {
      font-size: 28px;
      font-weight: 900;
      line-height: 1;

      &.level-S {
        color: var(--primary);
      }

      &.level-M {
        color: #d97706;
      }

      &.level-L {
        color: #dc2626;
      }
    }

    p {
      margin: 0;
      color: var(--heading);
      font-size: 12px;
      font-weight: 760;
      line-height: 1.7;
      white-space: pre-line;
    }
  }

  .latest-review-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    color: var(--muted);
    font-size: 12px;

    &.muted {
      line-height: 1.5;
    }
  }

  .task-review-form {
    display: grid;
    gap: 10px;
  }

  .task-review-locked {
    display: grid;
    gap: 10px;
    align-content: center;
    min-height: 220px;
    padding: 22px;
    border: 1px dashed rgba(245, 158, 11, 0.48);
    border-radius: var(--radius);
    background: rgba(245, 158, 11, 0.08);

    strong {
      color: #b45309;
      font-size: 16px;
    }

    > span {
      max-width: 440px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
    }

    .task-run-action-button,
    .task-run-action-button span {
      width: fit-content;
      color: #fff !important;
    }
  }

  .bug-detail-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(360px, 0.8fr);
    gap: 18px;
    padding: 18px;

    section {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
  }

  .bug-detail-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;

    > div {
      display: grid;
      gap: 8px;
      align-content: center;
      min-height: 76px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--soft-card);
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    strong {
      min-width: 0;
      overflow: hidden;
      color: var(--heading);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .bug-action-box {
    display: grid;
    gap: 10px;
    align-content: center;
    min-height: 188px;
    padding: 18px;
    border: 1px solid rgba(34, 197, 94, 0.26);
    border-radius: var(--radius);
    background: rgba(34, 197, 94, 0.08);

    strong {
      color: var(--heading);
      font-size: 15px;
    }

    span {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
    }

    .el-button {
      width: fit-content;
    }
  }

  .review-score-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;

    label {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 760;
    }

    :deep(.el-input-number) {
      width: 100%;
    }
  }

  .task-review-history {
    display: grid;
    gap: 8px;
    margin-top: 12px;
  }

  @media (max-width: 1180px) {
    .task-metrics-primary,
    .task-metrics-secondary {
      grid-template-columns: repeat(3, minmax(180px, 1fr));
    }

    .task-workbench-grid {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto auto;

      &.processing-collapsed {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .person-stat-grid,
    .task-list-card,
    .task-processing-sidebar {
      grid-column: 1;
      grid-row: auto;
    }

    .task-list-card {
      grid-column: 1;
    }

    .task-processing-sidebar {
      position: static;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      bottom: auto;
      top: auto;

      &.collapsed {
        width: auto;
        min-width: 0;
        justify-self: end;
      }
    }

    .task-processing-sheet {
      width: 100%;
    }

    .processing-collapse-tab {
      min-height: 42px;
      width: auto;
      padding: 0 14px;

      span {
        writing-mode: horizontal-tb;
      }
    }

    .business-task-detail {
      grid-template-columns: minmax(320px, 0.9fr) minmax(300px, 1fr);
    }
  }

  @media (min-width: 1181px) and (max-width: 1440px) {
    .task-workbench-grid {
      grid-template-columns: minmax(0, 1fr) minmax(320px, 360px);
    }
  }

  @media (max-width: 760px) {
    .task-metrics-primary,
    .task-metrics-secondary,
    .business-task-detail,
    .bug-detail-panel,
    .bug-detail-grid,
    .task-quality-grid,
    .review-score-grid {
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

    .task-filter-select,
    .task-filter-keyword {
      width: 100% !important;
    }

    .icon-only-button {
      justify-self: end;
    }
  }

  @media (max-width: 520px) {
    .task-filter-actions {
      grid-template-columns: 1fr;
    }

    .icon-only-button {
      justify-self: stretch;
      width: 100% !important;
    }

    .task-processing-sheet {
      padding: 12px;
    }
  }

  .task-review-record {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    width: 100%;
    padding: 9px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--row-bg);
    text-align: left;
    cursor: pointer;

    strong,
    span,
    p {
      display: block;
    }

    strong {
      color: var(--heading);
      font-size: 13px;
    }

    span {
      color: var(--muted);
      font-size: 11px;
    }

    p {
      margin: 3px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
  }

  .business-stage-list {
    display: grid;
    gap: 8px;
  }

  .business-stage-row {
    --stage-row-accent: #94a3b8;
    --stage-row-bg: rgba(148, 163, 184, 0.08);
    display: grid;
    grid-template-columns: minmax(0, 1fr) 132px;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--stage-row-accent) 28%, var(--line));
    border-left: 5px solid var(--stage-row-accent);
    border-radius: var(--radius);
    background: var(--stage-row-bg);

    span {
      min-width: 0;
      color: var(--heading);
      font-size: 13px;
      font-weight: 760;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .el-tag {
      justify-content: center;
      width: 112px;
      border: 0;
      color: #ffffff;
      font-weight: 760;
    }

    &.is-success {
      --stage-row-accent: #16a34a;
      --stage-row-bg: rgba(34, 197, 94, 0.12);
    }

    &.is-conditional {
      --stage-row-accent: #d97706;
      --stage-row-bg: rgba(245, 158, 11, 0.16);
    }

    &.is-danger {
      --stage-row-accent: #dc2626;
      --stage-row-bg: rgba(220, 38, 38, 0.1);
    }

    &.is-running {
      --stage-row-accent: #0284c7;
      --stage-row-bg: rgba(14, 165, 233, 0.14);
      box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.08);
    }

    &.is-skipped {
      --stage-row-accent: #64748b;
      --stage-row-bg: rgba(100, 116, 139, 0.1);
    }

    &.is-pending {
      --stage-row-accent: #94a3b8;
      --stage-row-bg: rgba(148, 163, 184, 0.06);
      opacity: 0.82;
    }
  }

  .task-run-list {
    display: grid;
    gap: 8px;
  }

  .task-run-history-section {
    scroll-margin-top: 88px;
  }

  .task-run-item {
    display: grid;
    gap: 7px;
    width: 100%;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--row-bg);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.18s ease, background 0.18s ease;

    &:hover {
      border-color: rgba(34, 197, 94, 0.32);
      background: rgba(34, 197, 94, 0.06);
    }

    time {
      color: var(--muted);
      font-size: 12px;
    }
  }

  .task-run-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;

    strong {
      color: var(--heading);
      font-size: 13px;
      line-height: 1.4;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.3;
    }
  }
}

.workload-estimate-tooltip {
  max-width: 420px !important;
  padding: 0 !important;
  border: 0 !important;
  background: #111827 !important;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.28);

  .workload-tooltip {
    display: grid;
    gap: 7px;
    padding: 12px 14px;
    color: #ffffff;
    line-height: 1.55;

    strong {
      color: #ffffff;
      font-size: 13px;
      font-weight: 900;
    }

    span {
      color: rgba(255, 255, 255, 0.86);
      font-size: 12px;
      font-weight: 760;
      white-space: normal;
      word-break: break-word;
    }
  }
}

:root[data-theme="dark"] {
  .task-center-view {
    .task-processing-sheet {
      border-color: rgba(148, 163, 184, 0.22);
      background: #252b36;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
      backdrop-filter: none;
    }
  }

  .workload-estimate-tooltip {
    border: 1px solid rgba(148, 163, 184, 0.28) !important;
    background: var(--card) !important;
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.34);

    .workload-tooltip {
      color: var(--text);

      strong {
        color: var(--heading);
      }

      span {
        color: var(--muted);
      }
    }
  }
}
</style>
