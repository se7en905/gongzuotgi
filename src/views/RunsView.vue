<template>
<section v-show="app.activeView === 'runs'" class="content-grid runs-view">
  <div class="flow-helper">
    <span>执行顺序</span>
    <strong>{{ app.runFlowHelperTitle(app.selectedRun) }}</strong>
    <small>{{ app.runFlowHelperDescription(app.selectedRun) }}</small>
  </div>
  <ElCard shadow="never" class="panel-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>美术执行清单</h3>
          <p>选择一条执行记录后，右侧查看当前任务从需求到产物的推进状态。</p>
        </div>
        <div class="run-list-header-actions">
          <ElButton plain @click="openTemplateManagerDialog">模板管理</ElButton>
          <ElButton v-if="app.can('run.create')" type="primary" @click="app.openRunCreateDrawer">新建美术执行</ElButton>
        </div>
      </div>
    </template>
    <div class="run-list">
      <button
        v-for="run in app.runListRows"
        :key="run.id"
        class="run-item"
        :class="[app.runDisplayStatusClass(run), { active: run.id === app.selectedRunId }]"
        :aria-current="run.id === app.selectedRunId ? 'true' : undefined"
        @click="app.selectRunFromList(run)"
      >
        <div class="run-item-head">
          <div v-if="app.isSavedTemplateWorkflowRun(run)" class="run-template-list-title">
            <a v-if="app.runTaskUrl(run)" :href="app.runTaskUrl(run)" target="_blank" rel="noopener noreferrer" class="task-title-link" @click.stop>{{ app.runTemplateTitle(run) }}</a>
            <strong v-else>{{ app.runTemplateTitle(run) }}</strong>
            <span class="run-template-skill-pill">{{ app.runTemplateSkillName(run) }}</span>
          </div>
          <template v-else>
            <a v-if="app.runTaskUrl(run)" :href="app.runTaskUrl(run)" target="_blank" rel="noopener noreferrer" class="task-title-link" @click.stop>{{ app.runGroupTitle(run) }}</a>
            <strong v-else>{{ app.runGroupTitle(run) }}</strong>
          </template>
          <span class="run-status-tag">{{ app.runDisplayStatusLabel(run) }}</span>
        </div>
        <p v-if="app.isSavedTemplateWorkflowRun(run) && app.runTemplateDescription(run)" class="run-item-template-description">
          {{ app.runTemplateDescription(run) }}
        </p>
        <div class="run-item-meta">
          <span>第 {{ app.runAttemptNumber(run) }} 次执行</span>
          <small>{{ app.workflowRunLabel(run) }}</small>
          <small>{{ app.formatDateTime(app.runDisplayTime(run)) }}</small>
        </div>
        <div class="run-item-action-tags">
          <span
            v-for="action in app.highlightedRunSkillActions(run).filter(item => item.count > 0)"
            :key="action.key"
            :class="['run-action-chip', action.status]"
          >
            {{ action.type }} {{ action.count }}
          </span>
          <span v-if="app.runReferenceCount(run)" class="run-action-chip reference">
            md 引用 {{ app.runReferenceCount(run) }}
          </span>
          <span v-if="app.isCurrentAccountRunExecutor(run)" class="run-action-chip current-account">
            {{ app.currentAccountRunExecutorTag(run) }}
          </span>
          <span v-if="app.isRunSourceDeleted(run)" class="run-action-chip source-deleted">来源已删除</span>
          <span v-if="run.id === app.selectedRunId" class="run-action-chip current-detail">当前明细</span>
        </div>
        <span class="run-item-executor">{{ app.runListExecutorName(run) }}</span>
      </button>
      <div v-if="!app.runListRows.length" class="empty-block">还没有美术执行记录，点击“新建美术执行”开始。</div>
    </div>
  </ElCard>

  <ElDialog
    v-model="templateManagerVisible"
    width="820px"
    title="自定义流程模板管理"
    class="app-dialog run-template-dialog"
    align-center
  >
    <div class="run-template-dialog-body">
      <section class="run-template-create-panel">
        <div class="run-template-section-head">
          <div>
            <strong>{{ templateForm.id ? '编辑模板' : '新建模板' }}</strong>
            <span>{{ templateForm.id ? '修改当前模板名称、说明和步骤，保存后会同步到执行方式选项。' : '把常用的多个 md / Skill 顺序保存下来，后续新建执行时可以直接套用。' }}</span>
          </div>
        </div>
        <ElForm :model="templateForm" label-position="top" @submit.prevent>
          <ElFormItem label="模板名称" class="is-required-field">
            <ElInput v-model="templateForm.name" placeholder="例如：Figma 收尾标准流程" />
          </ElFormItem>
          <ElFormItem label="模板说明">
            <ElInput v-model="templateForm.description" type="textarea" :rows="3" placeholder="说明这个模板适合什么场景。" />
          </ElFormItem>
          <ElFormItem label="按顺序选择 md / Skill" class="is-required-field">
            <ElSelect
              v-model="templateForm.materialHints"
              multiple
              filterable
              clearable
              collapse-tags
              collapse-tags-tooltip
              placeholder="按执行顺序选择多个 md、SKILL.md 或技能"
            >
              <ElOption
                v-for="item in templateMaterialOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              >
                <div class="skill-option-row">
                  <strong>{{ item.label }}</strong>
                  <span>{{ item.subtitle }}</span>
                </div>
              </ElOption>
            </ElSelect>
            <div v-if="normalizedTemplateMaterialHints.length" class="run-template-stage-preview">
              <article
                v-for="(value, index) in normalizedTemplateMaterialHints"
                :key="`${value}-${index}`"
              >
                <span>{{ String(index + 1).padStart(2, '0') }}</span>
                <strong>{{ templateMaterialDisplayName(value) }}</strong>
                <button type="button" @click.stop.prevent="removeTemplateMaterial(index)">删除</button>
              </article>
            </div>
          </ElFormItem>
          <div class="run-template-create-actions">
            <ElButton @click="resetTemplateForm">{{ templateForm.id ? '取消编辑' : '清空' }}</ElButton>
            <ElButton
              v-if="app.can('workflow.manage') && app.can('api.workflow.manage')"
              type="primary"
              :loading="templateSubmitting"
              @click="saveTemplateFromDialog"
            >
              {{ templateForm.id ? '保存修改' : '保存模板' }}
            </ElButton>
          </div>
        </ElForm>
      </section>
      <section class="run-template-saved-panel">
        <div class="run-template-section-head">
          <div>
            <strong>已保存模板</strong>
            <span>新增模板会直接出现在新建美术执行弹窗的“美术执行方式”里。</span>
          </div>
        </div>
        <div v-if="app.customWorkflows.length" class="run-template-list">
          <article v-for="workflow in app.customWorkflows" :key="workflow.id" class="run-template-item">
            <div class="run-template-item-main">
              <div class="run-template-title-row">
                <strong>{{ workflow.name }}</strong>
                <span class="run-template-skill-pill">{{ workflowPrimaryMaterialName(workflow) }}</span>
              </div>
              <p class="run-template-description">{{ workflow.description || '暂无模板说明' }}</p>
              <span class="run-template-meta">{{ workflowMetaText(workflow) }}</span>
            </div>
            <div v-if="app.can('workflow.manage') && app.can('api.workflow.manage')" class="run-template-item-actions">
              <ElButton size="small" plain @click.stop="editTemplateFromDialog(workflow)">编辑</ElButton>
              <ElButton
                size="small"
                type="danger"
                plain
                @click.stop="deleteTemplateFromDialog(workflow)"
              >
                删除
              </ElButton>
            </div>
          </article>
        </div>
        <div v-else class="run-template-empty">
          <strong>暂无已保存自定义流程</strong>
          <span>保存左侧模板后，就能在新建美术执行里选择使用。</span>
        </div>
      </section>
    </div>
  </ElDialog>

  <ElCard shadow="never" class="panel-card run-detail">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>{{ app.runDetailTitle(app.selectedRun) }}</h3>
          <p>{{ app.runDetailDescription(app.selectedRun) }}</p>
        </div>
        <div class="run-actions">
          <ElButton v-if="app.can('run.codex.execute') && !app.isDirectSkillRun(app.selectedRun)" type="primary" @click="app.startSelectedRun" :disabled="!app.selectedRun || app.isRunSourceDeleted(app.selectedRun) || app.isRunInProgress(app.selectedRun) || app.isRunWaitingForLocalWorker(app.selectedRun)" :loading="app.isRunInProgress(app.selectedRun)">{{ app.selectedRunActionLabel }}</ElButton>
          <ElButton v-if="app.can('run.codex.execute') && app.canRestartSelectedRun" plain @click="app.restartSelectedRun" :disabled="!app.selectedRun || app.isRunSourceDeleted(app.selectedRun) || app.isRunInProgress(app.selectedRun) || app.isRunWaitingForLocalWorker(app.selectedRun)">重新执行</ElButton>
          <ElButton v-if="app.can('run.codex.execute')" @click="app.cancelSelectedRun" :disabled="!app.selectedRun || !app.isRunInProgress(app.selectedRun)">中断</ElButton>
          <ElButton v-if="app.can('run.delete')" type="danger" plain @click="app.deleteSelectedRun" :disabled="!app.selectedRun || app.isRunInProgress(app.selectedRun)">删除</ElButton>
          <ElTooltip content="原始执行日志" placement="bottom">
            <button
              type="button"
              class="top-log-icon-button run-log-icon-button"
              aria-label="原始执行日志"
              :disabled="!app.selectedRun"
              @click="app.openSelectedRunLogDrawer"
            >
              <ElIcon>
                <Clock />
              </ElIcon>
            </button>
          </ElTooltip>
        </div>
      </div>
    </template>
    <section v-if="app.selectedRun" class="focused-run-flow-panel">
      <ElAlert
        v-if="app.isRunSourceDeleted(app.selectedRun)"
        class="run-source-deleted-alert"
        type="warning"
        :closable="false"
        title="来源已删除"
        :description="app.runSourceDeletedText(app.selectedRun)"
      />
      <div class="run-section-head">
        <div>
          <h4>执行步骤明细</h4>
          <p>查看当前任务的执行步骤明细。</p>
        </div>
        <span class="focused-run-total-time">
          <small>累计执行耗时</small>
          <strong>{{ app.liveRunClockDurationText(app.selectedRun) }}</strong>
          <em v-if="app.hasWorkerDurationEvidence(app.selectedRun)">本机计时</em>
        </span>
      </div>
      <div class="focused-run-step-flow">
        <article
          v-for="step in app.focusedRunStepFlow(app.selectedRun)"
          :key="step.key"
          :class="['focused-run-step', step.className]"
        >
          <div class="focused-step-dot">{{ step.no }}</div>
          <div class="focused-step-body">
            <strong>{{ step.title }}</strong>
            <span>{{ step.summary }}</span>
            <small class="focused-step-status">{{ step.label }}</small>
            <small class="focused-step-duration">{{ step.durationClockText }}</small>
            <small v-if="step.timeRangeText" class="focused-step-time">{{ step.timeRangeText }}</small>
          </div>
        </article>
      </div>
      <div class="run-reference-list focused-run-mode-line">
        <span>执行模式：</span>
        <strong>{{ app.focusedRunExecutionModeText(app.selectedRun) }}</strong>
      </div>
    </section>
    <section v-if="app.selectedRun && app.isLocalWorkerRun(app.selectedRun)" class="run-worker-panel">
      <div class="run-section-head">
        <div>
          <h4>执行人本机状态</h4>
          <p>{{ app.localWorkerRunNeedsFigma(app.selectedRun) ? '本机执行由当前操作人电脑上的 Worker 领取，使用操作人自己的 Codex、Figma MCP 和 Figma 账号授权。' : '本机执行由当前操作人电脑上的 Worker 领取，使用操作人自己的 Codex、本机工具、网络和账号配置；产物回传到工作台。' }}</p>
        </div>
        <ElButton size="small" :loading="app.loading.agentWorkers" @click="app.refreshAgentWorkers">刷新状态</ElButton>
      </div>
      <div class="run-worker-grid">
        <div>
          <span>执行人</span>
          <strong>{{ app.selectedRun.queuedForName || app.selectedRun.assignedToName || app.selectedRun.developer || '-' }}</strong>
        </div>
        <div>
          <span>领取设备</span>
          <strong>{{ app.directSkillRunDeviceDisplayName(app.selectedRun) }}</strong>
        </div>
        <div>
          <span>本机状态</span>
          <strong>{{ app.directSkillWorkerStatusText(app.selectedRun) }}</strong>
        </div>
        <div>
          <span>最近心跳</span>
          <strong>{{ app.directSkillWorkerLastSeenText(app.directSkillWorkerForRun(app.selectedRun)) }}</strong>
        </div>
      </div>
      <div class="run-worker-note">
        <span
          v-if="app.directSkillRunSyncBadge(app.selectedRun).label"
          :class="['run-worker-sync-badge', app.directSkillRunSyncBadge(app.selectedRun).tone]"
        >
          {{ app.directSkillRunSyncBadge(app.selectedRun).label }}
        </span>
        <span v-if="app.isDirectSkillPartialWriteRun(app.selectedRun)">Figma 已有真实改动，但最终回读/截图验收未闭环；请让执行人恢复本机 Figma MCP 授权后继续执行。</span>
        <span v-else-if="app.isDirectSkillFailedRun(app.selectedRun)">该任务已由执行人本机 Worker 自动领取后执行失败；请点击右上角日志图标查看具体原因。</span>
        <span v-else-if="!app.directSkillWorkerForRun(app.selectedRun)">执行人需要启动本机 Worker 后，任务才会从“待领取”变为“已领取 / 执行中”。</span>
        <span v-else-if="!app.isDirectSkillWorkerReady(app.directSkillWorkerForRun(app.selectedRun), app.selectedRun)">{{ app.directSkillRunSyncBadge(app.selectedRun).detail || app.directSkillWorkerIssueText(app.directSkillWorkerForRun(app.selectedRun), app.selectedRun) }}</span>
        <span v-else>{{ app.directSkillRunSyncBadge(app.selectedRun).detail || '本机 Worker 会把 Codex 日志和执行结果回传到当前执行记录。' }}</span>
      </div>
      <div v-if="app.isDirectSkillClaimedRun(app.selectedRun)" class="run-worker-claim-evidence">
        <span>自动领取：{{ app.formatDateTime(app.selectedRun.claimedAt) || '-' }}</span>
        <span>开始执行：{{ app.formatDateTime(app.selectedRun.startedAt) || '-' }}</span>
        <span v-if="app.selectedRun.exitCode !== null && app.selectedRun.exitCode !== undefined">Codex 退出码：{{ app.selectedRun.exitCode }}</span>
      </div>
      <div v-if="/pending|created/i.test(app.runDisplayStatusValue(app.selectedRun))" class="run-worker-command-box">
        <div>
          <strong>当前不显示平台“开始”按钮</strong>
          <span>{{ app.localWorkerRunNeedsFigma(app.selectedRun) ? `直接执行必须由 ${app.selectedRun.assignedToName || app.selectedRun.developer || '执行人'} 的电脑启动 Worker 后自动领取，确保使用本人 Figma 账号和本机 Figma MCP。` : `直接执行必须由 ${app.selectedRun.assignedToName || app.selectedRun.developer || '执行人'} 的电脑启动 Worker 后自动领取；本次产物回传到工作台产物区。` }}</span>
        </div>
        <div class="run-worker-command-actions">
          <ElButton v-if="app.can('run.directSkill.workerCommand')" size="small" plain @click="app.copyDirectSkillWorkerCommand(app.directSkillAssigneeOptions.find(user => user.id === app.selectedRun.assignedToUserId) || app.currentUser, false)">复制 Worker 启动命令</ElButton>
          <ElButton v-if="app.can('menu.agentWorkers')" size="small" @click="app.switchView('agent-workers')">查看本机执行状态</ElButton>
        </div>
      </div>
    </section>
    <section v-if="app.selectedRun" class="direct-run-overview-panel">
      <div class="run-section-head">
        <div>
          <h4>{{ app.isDirectSkillRun(app.selectedRun) ? '直接执行结果' : app.isSkillOrMdFocusedRun(app.selectedRun) ? '单技能执行结果' : '执行结果明细' }}</h4>
          <p>{{ app.isDirectSkillRun(app.selectedRun) ? '这条记录来自 Skill/md 引用，只看执行对象、Worker 回传和当前结论。' : app.isSkillOrMdFocusedRun(app.selectedRun) ? '这条记录只引用一个 md/Skill，结果区域只展示交付判定、执行对象、环境和待处理问题。' : '这条记录按统一任务明细展示交付判定、执行对象、环境和待处理问题；关键动作和任务链路在下方补充。' }}</p>
        </div>
        <ElTag size="large" effect="dark" class="run-result-status-tag" :type="app.runTagType(app.effectiveResultStatus(app.selectedRun))">{{ app.resultStatusLabel(app.effectiveResultStatus(app.selectedRun)) }}</ElTag>
      </div>
      <div class="direct-run-summary-grid">
        <div
          v-for="card in focusedRunDetail.summaryCards"
          :key="card.label"
          :class="['direct-run-summary-card', card.tone]"
        >
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.hint }}</small>
        </div>
      </div>
      <div class="direct-run-info-grid">
        <div class="direct-run-info-group">
          <span class="direct-run-group-title">执行对象</span>
          <div v-for="row in focusedRunDetail.targetRows" :key="row.label" class="direct-run-info-row">
            <span>{{ row.label }}</span>
            <a v-if="row.href" :href="row.href" target="_blank" rel="noopener noreferrer">{{ row.value }}</a>
            <strong v-else>{{ row.value }}</strong>
          </div>
        </div>
        <div class="direct-run-info-group">
          <span class="direct-run-group-title">执行环境</span>
          <div v-for="row in focusedRunDetail.environmentRows" :key="row.label" class="direct-run-info-row">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </div>
      <div v-if="focusedRunDetail.issueRows.length" class="direct-run-issue-list">
        <div
          v-for="row in focusedRunDetail.issueRows"
          :key="row.label"
          :class="['direct-run-issue-row', row.tone]"
        >
          <span>{{ row.label }}</span>
          <strong>{{ row.value }}</strong>
        </div>
      </div>
      <div v-if="app.runGeneratedImageArtifacts(app.selectedRun).length" class="run-generated-image-panel">
        <div class="run-generated-image-head">
          <strong>生成图片产物</strong>
          <span>{{ app.runGeneratedImageArtifacts(app.selectedRun).length }} 张，可预览和下载</span>
        </div>
        <div class="run-generated-image-grid">
          <article
            v-for="image in app.runGeneratedImageArtifacts(app.selectedRun)"
            :key="image.path"
            class="run-generated-image-card"
          >
            <a :href="image.url" target="_blank" rel="noopener noreferrer" class="run-generated-image-thumb">
              <img :src="image.url" :alt="image.name" loading="lazy" />
            </a>
            <div class="run-generated-image-meta">
              <strong :title="image.name">{{ image.name }}</strong>
              <span>{{ image.size ? app.formatBytes(image.size) : '已归档' }}</span>
            </div>
            <div class="run-generated-image-actions">
              <ElButton size="small" plain tag="a" :href="image.url" target="_blank" rel="noopener noreferrer">打开</ElButton>
              <ElButton size="small" type="primary" plain tag="a" :href="image.downloadUrl">下载</ElButton>
            </div>
          </article>
        </div>
      </div>
      <div class="direct-run-actions">
        <span>{{ focusedRunDetail.nextAction }}</span>
        <div>
          <ElButton type="primary" @click="app.openRunArchive(app.selectedRun)">查看档案</ElButton>
          <ElButton v-if="!app.isDirectSkillRun(app.selectedRun) && app.can('review.submit') && app.businessTaskForRun(app.selectedRun)" @click="app.openRunBusinessTaskReview(app.selectedRun)">去人工验收</ElButton>
          <ElButton v-if="app.isDirectSkillRun(app.selectedRun) && app.can('menu.agentWorkers')" @click="app.switchView('agent-workers')">Worker 心跳</ElButton>
        </div>
      </div>
    </section>
    <section v-if="app.shouldShowRunSkillActionsPanel(app.selectedRun)" class="run-skill-actions-panel">
      <div class="run-section-head">
        <div>
          <h4>关键动作概览</h4>
          <p>这里只判断本次任务是否发生过关键动作；调用明细在产物列表里查看。</p>
        </div>
        <span>{{ app.selectedRunSkillActionTotal }} 次动作</span>
      </div>
      <div class="run-skill-action-grid">
        <div
          v-for="action in app.selectedRunHighlightedSkillActions"
          :key="action.key"
          :class="['run-skill-action-card', action.status]"
        >
          <div class="run-skill-action-head">
            <div>
              <span>{{ action.type }}</span>
              <strong>{{ action.name }}</strong>
            </div>
            <ElTag size="small" :type="app.runActionTagType(action.status)">{{ app.runActionStatusLabel(action.status) }}</ElTag>
          </div>
          <p>{{ action.summary }}</p>
          <div class="run-skill-action-meta">
            <span>{{ action.count ? `发生 ${action.count} 次` : '未发生' }}</span>
            <span>{{ action.lastAt ? app.formatDateTime(action.lastAt) : '暂无时间' }}</span>
          </div>
        </div>
      </div>
      <div v-if="app.selectedRunOtherSkillActionSummary.count" class="run-other-action-row">
        <span>其它 skill / 工具动作</span>
        <strong>{{ app.selectedRunOtherSkillActionSummary.count }} 类，合计 {{ app.selectedRunOtherSkillActionSummary.total }} 次</strong>
      </div>
    </section>
    <section v-if="app.shouldShowRunChainPanel(app.selectedRun)" class="run-chain-panel">
      <div class="run-section-head">
        <div>
          <h4>任务链路</h4>
          <p>按任务推进顺序梳理关键节点，便于判断当前卡在哪一步。</p>
        </div>
        <span>任务 {{ app.runChainTaskNo(app.selectedRun) || '-' }}</span>
      </div>
      <div class="run-chain-list">
        <div
          v-for="step in app.runChainTimeline(app.selectedRun)"
          :key="step.key"
          :class="['run-chain-step', app.runChainStepClass(step.status)]"
        >
          <div class="run-chain-marker"></div>
          <div class="run-chain-content">
            <div class="run-chain-title">
              <strong>{{ step.title }}</strong>
              <span>{{ step.time ? app.formatDateTime(step.time) : app.runActionStatusLabel(step.status) }}</span>
            </div>
            <p>{{ step.summary }}</p>
            <div v-if="step.meta?.length" class="run-chain-meta">
              <span v-for="item in step.meta" :key="item">{{ item }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="app.selectedRunReferenceCount" class="run-reference-list">
        <span>md / SKILL.md 引用</span>
        <strong>{{ app.selectedRunReferenceCount }} 个引用，明细在产物列表查看</strong>
      </div>
    </section>
    <Teleport to="body">
      <div
        v-if="app.shouldShowRunCodexChatPanel(app.selectedRun)"
        ref="runCodexFloating"
        class="run-codex-floating"
        :class="{ dragging: codexDrag.dragging }"
        :style="codexFloatingStyle"
      >
        <button
          type="button"
          class="run-codex-floating-button"
          :class="{ active: app.runChatPanelOpen }"
          aria-label="打开 Codex 对话"
          @click="toggleRunCodexPanel"
          @pointerdown="startCodexDrag"
        >
          <img src="/codex-icon.png" alt="" />
        </button>
        <section v-if="app.runChatPanelOpen" class="run-codex-floating-panel">
          <header class="run-codex-floating-head">
            <div class="run-codex-title-block">
              <img src="/codex-icon.png" alt="" />
              <div>
                <h4>Codex</h4>
                <span>{{ app.selectedRun ? app.runGroupTitle(app.selectedRun) : '美术执行' }}</span>
              </div>
            </div>
            <button type="button" class="run-codex-close" aria-label="关闭 Codex 对话" @click="app.runChatPanelOpen = false">×</button>
          </header>
          <div class="run-codex-floating-messages">
            <article class="run-codex-message assistant">
              <span class="run-codex-avatar"><img src="/codex-icon.png" alt="" /></span>
              <div class="run-codex-bubble">
                <strong>继续处理当前执行</strong>
                <p>我会基于当前执行记录、Figma 线索、规范 md / Skill 线索创建一次新的追加执行，不默认读取历史长日志。</p>
              </div>
            </article>
            <article v-if="app.runChatInput.trim()" class="run-codex-message user">
              <div class="run-codex-bubble">{{ app.runChatInput.trim() }}</div>
            </article>
          </div>
          <ElInput
            v-model="app.runChatForm.requestStandard"
            class="run-codex-standard-input"
            type="textarea"
            :rows="2"
            maxlength="2000"
            show-word-limit
            placeholder="请求标准：验收标准、输出格式和限制"
          />
          <div class="run-codex-composer">
            <ElInput
              v-model="app.runChatInput"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 6 }"
              placeholder="向 Codex 发送追加要求"
              @keydown.meta.enter.prevent="app.submitRunChatInstruction"
              @keydown.ctrl.enter.prevent="app.submitRunChatInstruction"
            />
            <div class="run-codex-composer-footer">
              <div class="run-codex-inline-config" aria-label="Codex 模型和推理设置">
                <ElSelect v-model="app.runChatForm.model" size="small" placeholder="模型" class="run-codex-inline-select model" popper-class="run-codex-inline-popper">
                  <ElOption v-for="model in app.codexModelOptions" :key="model" :label="model" :value="model" />
                </ElSelect>
                <span>·</span>
                <ElSelect v-model="app.runChatForm.reasoningEffort" size="small" placeholder="推理" class="run-codex-inline-select reasoning" popper-class="run-codex-inline-popper">
                  <ElOption v-for="option in app.codexReasoningOptions" :key="option.value" :label="`推理 ${option.label}`" :value="option.value" />
                </ElSelect>
              </div>
              <ElButton
                v-if="app.can('run.codex.execute')"
                circle
                type="primary"
                :loading="app.runChatSubmitting"
                :disabled="!app.runChatInput.trim() || app.isRunInProgress(app.selectedRun)"
                @click="app.submitRunChatInstruction"
              >
                ↑
              </ElButton>
            </div>
          </div>
        </section>
      </div>
    </Teleport>
    <section v-if="app.selectedRun && app.selectedRunChangeItems.length" class="run-change-summary">
      <div class="run-change-head">
        <div>
          <h4>文件变更清单</h4>
          <p>本次执行结束后采集到的产物或工作区变更，点击文件可查看对比或预览。</p>
        </div>
        <div class="change-metric-row">
          <span>新增 {{ app.selectedRunChangeMetrics.added }}</span>
          <span>修改 {{ app.selectedRunChangeMetrics.changed }}</span>
          <span>移除 {{ app.selectedRunChangeMetrics.removed }}</span>
        </div>
      </div>
      <div class="change-file-list">
        <div v-for="item in app.selectedRunChangeItems" :key="`${item.status}-${item.path}`" class="change-file-row">
          <button type="button" class="change-file-open" @click="app.openRunFileDiff(item)">
            <ElTag size="small" effect="plain" :type="app.runChangeItemTagType(item)">
              {{ app.runChangeItemLabel(item) }}
            </ElTag>
            <span>{{ item.path }}</span>
          </button>
        </div>
      </div>
    </section>
  </ElCard>
  <ElDrawer
    v-model="app.runLogDrawerVisible"
    title="原始执行日志"
    direction="rtl"
    size="50%"
    class="run-log-drawer"
    append-to-body
    :with-header="true"
  >
    <div class="run-log-drawer-shell">
      <div class="run-log-drawer-head">
        <div>
          <span>当前执行</span>
          <strong>{{ app.selectedRun ? app.runGroupTitle(app.selectedRun) : '未选择执行记录' }}</strong>
        </div>
        <small v-if="app.isRunInProgress(app.selectedRun)" :key="app.logPulse" class="log-live-indicator">实时接收中</small>
        <small v-else>只读取尾部日志摘要</small>
      </div>
      <article
        ref="runLogBody"
        :class="['run-log-drawer-markdown', 'log-markdown', 'markdown-report', { 'is-live': app.isRunInProgress(app.selectedRun) }]"
        @click="app.handleRunLogContentClick"
        v-html="app.logHtml"
      ></article>
    </div>
  </ElDrawer>
</section>
</template>

<script>
import { ElMessage } from 'element-plus';

const RUN_CODEX_FLOATING_POSITION_KEY = 'awp-run-codex-floating-window-position-v2';
const RUN_CODEX_FLOATING_SIZE = 54;
const RUN_CODEX_FLOATING_PADDING = 12;
const RUN_CODEX_FLOATING_DEFAULT_OFFSET = 28;

export default {
  name: 'RunsView',
  props: {
    app: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      codexPosition: {
        x: null,
        y: null
      },
      codexDrag: {
        dragging: false,
        moved: false,
        suppressClick: false,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0
      },
      templateManagerVisible: false,
      templateSubmitting: false,
      templateForm: {
        id: '',
        name: '',
        description: '',
        materialHints: []
      }
    };
  },
  computed: {
    templateMaterialOptions() {
      return this.app.currentProjectExecutionMaterialOptions || [];
    },
    normalizedTemplateMaterialHints() {
      return this.normalizeTemplateMaterialHints(this.templateForm.materialHints);
    },
    logScrollSignal() {
      return [
        this.app.selectedRunId || '',
        this.app.runLogDrawerVisible ? 'drawer' : '',
        this.app.logPulse || 0,
        this.app.logText?.length || 0,
        Array.isArray(this.app.runLogCollapse) ? this.app.runLogCollapse.join(',') : ''
      ].join('|');
    },
    directRunDetail() {
      if (!this.app.selectedRun || !this.app.isDirectSkillRun(this.app.selectedRun)) {
        return {
          summaryCards: [],
          targetRows: [],
          environmentRows: [],
          issueRows: [],
          nextAction: ''
        };
      }
      return this.app.directSkillRunOverviewMetrics(this.app.selectedRun);
    },
    focusedRunDetail() {
      if (!this.app.selectedRun) {
        return {
          summaryCards: [],
          targetRows: [],
          environmentRows: [],
          issueRows: [],
          nextAction: ''
        };
      }
      return this.app.focusedRunOverviewMetrics(this.app.selectedRun);
    },
    codexFloatingStyle() {
      const position = Number.isFinite(this.codexPosition.x) && Number.isFinite(this.codexPosition.y)
        ? this.clampCodexFloatingPosition(this.codexPosition.x, this.codexPosition.y)
        : this.defaultCodexFloatingPosition();
      return {
        left: `${position.x}px`,
        top: `${position.y}px`
      };
    }
  },
  watch: {
    logScrollSignal() {
      this.scrollRunLogToBottom();
    }
  },
  mounted() {
    this.restoreCodexFloatingPosition();
    this.scrollRunLogToBottom();
    window.addEventListener('resize', this.keepCodexFloatingInViewport);
  },
  beforeUnmount() {
    this.stopCodexDrag();
    window.removeEventListener('resize', this.keepCodexFloatingInViewport);
  },
  methods: {
    toggleRunCodexPanel() {
      if (this.codexDrag.suppressClick) {
        this.codexDrag.suppressClick = false;
        return;
      }
      this.app.runChatPanelOpen = !this.app.runChatPanelOpen;
    },
    startCodexDrag(event) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      const fallback = this.defaultCodexFloatingPosition();
      const originX = Number.isFinite(this.codexPosition.x) ? this.codexPosition.x : fallback.x;
      const originY = Number.isFinite(this.codexPosition.y) ? this.codexPosition.y : fallback.y;
      this.codexPosition = this.clampCodexFloatingPosition(originX, originY);
      this.codexDrag = {
        dragging: true,
        moved: false,
        suppressClick: false,
        startX: event.clientX,
        startY: event.clientY,
        originX,
        originY
      };
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      window.addEventListener('pointermove', this.moveCodexFloating);
      window.addEventListener('pointerup', this.stopCodexDrag);
      window.addEventListener('pointercancel', this.stopCodexDrag);
    },
    moveCodexFloating(event) {
      if (!this.codexDrag.dragging) return;
      const dx = event.clientX - this.codexDrag.startX;
      const dy = event.clientY - this.codexDrag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 5) this.codexDrag.moved = true;
      const nextX = this.codexDrag.originX + dx;
      const nextY = this.codexDrag.originY + dy;
      this.codexPosition = this.clampCodexFloatingPosition(nextX, nextY);
    },
    stopCodexDrag() {
      if (this.codexDrag.dragging && this.codexDrag.moved) {
        this.codexDrag.suppressClick = true;
        this.saveCodexFloatingPosition();
      }
      this.codexDrag.dragging = false;
      window.removeEventListener('pointermove', this.moveCodexFloating);
      window.removeEventListener('pointerup', this.stopCodexDrag);
      window.removeEventListener('pointercancel', this.stopCodexDrag);
    },
    defaultCodexFloatingPosition() {
      return {
        x: Math.max(RUN_CODEX_FLOATING_PADDING, window.innerWidth - RUN_CODEX_FLOATING_SIZE - RUN_CODEX_FLOATING_DEFAULT_OFFSET),
        y: Math.max(RUN_CODEX_FLOATING_PADDING, window.innerHeight - RUN_CODEX_FLOATING_SIZE - RUN_CODEX_FLOATING_DEFAULT_OFFSET)
      };
    },
    restoreCodexFloatingPosition() {
      let position = this.defaultCodexFloatingPosition();
      try {
        const stored = JSON.parse(localStorage.getItem(RUN_CODEX_FLOATING_POSITION_KEY) || 'null');
        if (Number.isFinite(stored?.x) && Number.isFinite(stored?.y)) {
          position = { x: stored.x, y: stored.y };
        }
      } catch {
        position = this.defaultCodexFloatingPosition();
      }
      this.codexPosition = this.clampCodexFloatingPosition(position.x, position.y);
    },
    saveCodexFloatingPosition() {
      if (!Number.isFinite(this.codexPosition.x) || !Number.isFinite(this.codexPosition.y)) return;
      try {
        localStorage.setItem(RUN_CODEX_FLOATING_POSITION_KEY, JSON.stringify({
          x: Math.round(this.codexPosition.x),
          y: Math.round(this.codexPosition.y)
        }));
      } catch {
        // 悬浮位置只是本地 UI 偏好，保存失败不影响执行台操作。
      }
    },
    keepCodexFloatingInViewport() {
      if (!Number.isFinite(this.codexPosition.x) || !Number.isFinite(this.codexPosition.y)) {
        this.restoreCodexFloatingPosition();
        return;
      }
      const next = this.clampCodexFloatingPosition(this.codexPosition.x, this.codexPosition.y);
      if (next.x !== this.codexPosition.x || next.y !== this.codexPosition.y) {
        this.codexPosition = next;
        this.saveCodexFloatingPosition();
      }
    },
    clampCodexFloatingPosition(x, y) {
      return {
        x: Math.min(Math.max(RUN_CODEX_FLOATING_PADDING, x), Math.max(RUN_CODEX_FLOATING_PADDING, window.innerWidth - RUN_CODEX_FLOATING_SIZE - RUN_CODEX_FLOATING_PADDING)),
        y: Math.min(Math.max(RUN_CODEX_FLOATING_PADDING, y), Math.max(RUN_CODEX_FLOATING_PADDING, window.innerHeight - RUN_CODEX_FLOATING_SIZE - RUN_CODEX_FLOATING_PADDING))
      };
    },
    scrollRunLogToBottom() {
      this.$nextTick(() => {
        const logBody = this.$refs.runLogBody;
        if (!logBody) return;
        logBody.scrollTop = logBody.scrollHeight;
        window.requestAnimationFrame(() => {
          logBody.scrollTop = logBody.scrollHeight;
        });
      });
    },
    emptyTemplateForm() {
      return {
        id: '',
        name: '',
        description: '',
        materialHints: []
      };
    },
    async openTemplateManagerDialog() {
      this.templateManagerVisible = true;
      this.app.refreshCustomWorkflows().catch(() => {});
      if (!this.templateForm.name && !this.templateForm.materialHints.length) this.resetTemplateForm();
      const projectId = this.app.selectedProjectId || this.app.runForm.projectId || this.app.projects[0]?.id || '';
      if (projectId && !this.app.scans[projectId]) {
        this.app.ensureRunProjectScanCache(projectId).catch(() => {});
      }
    },
    resetTemplateForm() {
      this.templateForm = this.emptyTemplateForm();
    },
    editTemplateFromDialog(workflow = {}) {
      if (!workflow?.id) return;
      this.templateForm = {
        id: workflow.id || '',
        name: workflow.name || '',
        description: workflow.description || '',
        materialHints: this.app.materialHintsFromCustomWorkflow(workflow)
      };
    },
    async deleteTemplateFromDialog(workflow = {}) {
      await this.app.deleteCustomWorkflowTemplate(workflow);
      if (this.templateForm.id && this.templateForm.id === workflow?.id) this.resetTemplateForm();
    },
    normalizeTemplateMaterialHints(value = this.templateForm.materialHints) {
      const source = Array.isArray(value) ? value : [value];
      const seen = new Set();
      return source
        .map(item => String(item || '').trim())
        .filter(item => {
          if (!item || seen.has(item)) return false;
          seen.add(item);
          return true;
        });
    },
    removeTemplateMaterial(index) {
      const hints = this.normalizedTemplateMaterialHints;
      if (index < 0 || index >= hints.length) return;
      hints.splice(index, 1);
      this.templateForm.materialHints = hints;
    },
    templateMaterialDisplayName(value = '') {
      return this.app.runMaterialDisplayName(value);
    },
    workflowPrimaryMaterialName(workflow = {}) {
      return this.app.customWorkflowPrimaryMaterialName(workflow);
    },
    workflowMetaText(workflow = {}) {
      return this.app.customWorkflowMetaText(workflow);
    },
    async saveTemplateFromDialog() {
      const name = String(this.templateForm.name || '').trim();
      const materialHints = this.normalizedTemplateMaterialHints;
      if (!name) {
        ElMessage.warning('请填写模板名称');
        return;
      }
      if (!materialHints.length) {
        ElMessage.warning('请按顺序选择至少一个 md / Skill');
        return;
      }
      this.templateSubmitting = true;
      try {
        const payload = {
          id: this.templateForm.id || '',
          name,
          description: String(this.templateForm.description || '').trim(),
          projectId: this.app.selectedProjectId || this.app.runForm.projectId || this.app.projects[0]?.id || '',
          stages: materialHints.map((value, index) => this.app.runMaterialStageFromValue(value, index, this.app.selectedProjectId || this.app.runForm.projectId || this.app.projects[0]?.id || ''))
        };
        await this.app.api('/api/custom-workflows', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        await this.app.refreshCustomWorkflows();
        this.resetTemplateForm();
        ElMessage.success('自定义流程模板已保存');
      } catch (error) {
        ElMessage.error(this.app.readApiError?.(error) || '自定义流程模板保存失败');
      } finally {
        this.templateSubmitting = false;
      }
    }
  }
};
</script>

<style lang="scss">
.content-grid.runs-view {
  grid-template-columns: 700px minmax(0, 1fr);
  gap: 18px;

  > .flow-helper {
    min-height: 44px;
  }

  > .panel-card {
    min-height: 0;
  }

  .panel-head {
    align-items: center;
  }

  .panel-head p {
    max-width: 520px;
  }

  .run-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 0 0 auto;
  }

  .run-list-header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 0 0 auto;
  }

  .run-log-icon-button {
    &:disabled {
      cursor: not-allowed;
      opacity: 0.48;
    }
  }

  .run-list {
    gap: 10px;
    padding: 14px;
    max-height: calc(100vh - 260px);
    overflow: auto;
    scrollbar-gutter: stable;
  }

  .run-item {
    position: relative;
    display: grid;
    gap: 10px;
    padding: 14px 16px 22px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--row-bg);
    box-shadow: none;
    --run-success-color: #16a34a;
    --run-success-soft: rgba(22, 163, 74, 0.12);
    --run-warning-color: var(--warn);
    --run-warning-soft: rgba(245, 158, 11, 0.1);
    --run-muted-color: #64748b;
    --run-muted-soft: rgba(100, 116, 139, 0.1);

    &.is-failed,
    &.is-blocked {
      border-color: rgba(220, 38, 38, 0.48);
      background: linear-gradient(90deg, rgba(220, 38, 38, 0.1), transparent 46%), var(--row-bg);
      box-shadow: inset 4px 0 0 var(--danger);

      strong {
        color: var(--heading);
      }
    }

    &.is-running {
      border-color: rgba(14, 165, 233, 0.42);
      background: linear-gradient(90deg, rgba(14, 165, 233, 0.1), transparent 46%), var(--row-bg);
      box-shadow: inset 4px 0 0 var(--accent);
    }

    &.is-success {
      border-color: rgba(34, 197, 94, 0.42);
      background: linear-gradient(90deg, var(--run-success-soft), transparent 46%), var(--row-bg);
      box-shadow: inset 4px 0 0 var(--run-success-color);
    }

    &.is-conditional,
    &.is-partial-write {
      border-color: rgba(245, 158, 11, 0.46);
      background: linear-gradient(90deg, var(--run-warning-soft), transparent 46%), var(--row-bg);
      box-shadow: inset 4px 0 0 var(--run-warning-color);
    }

    &.is-cancelled {
      border-color: rgba(100, 116, 139, 0.36);
      background: linear-gradient(90deg, var(--run-muted-soft), transparent 46%), var(--row-bg);
      box-shadow: inset 4px 0 0 var(--run-muted-color);
    }
  }

  .run-item:hover {
    border-color: rgba(34, 197, 94, 0.32);
    background: var(--soft-card);
  }

  .run-item.active {
    border-color: rgba(22, 101, 52, 0.72);
    background:
      linear-gradient(90deg, rgba(34, 197, 94, 0.18), rgba(34, 197, 94, 0.06) 52%, transparent),
      var(--primary-soft);
    box-shadow:
      inset 5px 0 0 var(--primary),
      0 0 0 2px rgba(34, 197, 94, 0.16);
    position: relative;
  }

  .run-item.is-running.active {
    border-color: rgba(14, 165, 233, 0.58);
    background: rgba(14, 165, 233, 0.1);
    box-shadow:
      inset 5px 0 0 var(--accent),
      0 0 0 2px rgba(14, 165, 233, 0.16);
  }

  .run-item.is-failed.active,
  .run-item.is-blocked.active {
    border-color: rgba(220, 38, 38, 0.62);
    background: rgba(220, 38, 38, 0.1);
    box-shadow:
      inset 5px 0 0 var(--danger),
      0 0 0 2px rgba(220, 38, 38, 0.14);
  }

  .run-item.is-success.active {
    border-color: rgba(22, 163, 74, 0.62);
    background: var(--run-success-soft);
    box-shadow:
      inset 5px 0 0 var(--run-success-color),
      0 0 0 2px rgba(22, 163, 74, 0.14);
  }

  .run-item.is-conditional.active,
  .run-item.is-partial-write.active {
    border-color: rgba(245, 158, 11, 0.62);
    background: var(--run-warning-soft);
    box-shadow:
      inset 5px 0 0 var(--run-warning-color),
      0 0 0 2px rgba(245, 158, 11, 0.16);
  }

  .run-item.is-cancelled.active {
    border-color: rgba(100, 116, 139, 0.52);
    background: var(--run-muted-soft);
    box-shadow:
      inset 5px 0 0 var(--run-muted-color),
      0 0 0 2px rgba(100, 116, 139, 0.14);
  }

  .run-item-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;

    .run-status-tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      min-width: 72px;
      height: 24px;
      padding: 0 10px;
      border-radius: 4px;
      background: #64748b;
      color: #ffffff;
      line-height: 1;
      font-weight: 800;
      font-size: 12px;
      text-align: center;
      position: relative;
      overflow: hidden;

      &::after {
        content: '';
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.2);
        opacity: 0;
        pointer-events: none;
      }
    }
  }

  .run-item.is-failed,
  .run-item.is-blocked,
  .run-item.is-conditional,
  .run-item.is-partial-write,
  .run-item.is-cancelled,
  .run-item.is-running,
  .run-item.is-success {
    .run-status-tag {
      --run-status-color: var(--danger);
      background-color: var(--run-status-color);
      color: #ffffff;
      text-align: center;
    }
  }

  .run-item.is-conditional .run-status-tag {
    --run-status-color: var(--warn);
  }

  .run-item.is-partial-write .run-status-tag {
    --run-status-color: var(--run-warning-color);
  }

  .run-item.is-cancelled .run-status-tag {
    --run-status-color: var(--run-muted-color);
  }

  .run-item.is-running .run-status-tag {
    --run-status-color: var(--accent);
  }

  .run-item.is-running .run-status-tag::after {
    animation: runStatusPulse 1.5s ease-in-out infinite;
  }

  .run-item.is-success .run-status-tag {
    --run-status-color: var(--run-success-color);
  }

  .run-item strong {
    min-width: 0;
    overflow: hidden;
    color: var(--heading);
    font-size: 14px;
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-item .task-title-link {
    min-width: 0;
    overflow: hidden;
    color: var(--primary);
    font-size: 14px;
    font-weight: 800;
    line-height: 1.45;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: none;
  }

  .run-item .task-title-link:hover {
    text-decoration: underline;
  }

  .run-template-list-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .run-template-list-title strong,
  .run-template-list-title .task-title-link {
    flex: 0 1 auto;
  }

  .run-template-list-title .run-template-skill-pill {
    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    max-width: 160px;
    height: 24px;
    padding: 0 10px;
    border: 1px solid rgba(99, 102, 241, 0.25);
    border-radius: 999px;
    background: rgba(99, 102, 241, 0.1);
    color: #3730a3;
    font-size: 12px;
    font-weight: 850;
    line-height: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-item-template-description {
    margin: -2px 0 0;
    color: var(--text);
    font-size: 12px;
    line-height: 1.45;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-item .run-item-meta {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, auto) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--muted);
    font-size: 12px;

    span,
    small {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      color: var(--primary-ink);
      font-weight: 780;
    }

    small + small {
      text-align: right;
    }
  }

  .run-item small {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }

  .run-item-action-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-right: 96px;
    min-height: 0;
  }

  .run-item-executor {
    position: absolute;
    right: 16px;
    bottom: 12px;
    max-width: 92px;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-action-chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border: 1px solid rgba(100, 116, 139, 0.24);
    border-radius: 4px;
    background: rgba(100, 116, 139, 0.08);
    color: var(--muted);
    font-size: 12px;
    font-weight: 780;
    line-height: 1;

    &.completed,
    &.recorded {
      border-color: rgba(34, 197, 94, 0.28);
      background: rgba(34, 197, 94, 0.1);
      color: #15803d;
    }

    &.running {
      border-color: rgba(14, 165, 233, 0.28);
      background: rgba(14, 165, 233, 0.1);
      color: #0369a1;
    }

    &.blocked,
    &.failed {
      border-color: rgba(220, 38, 38, 0.28);
      background: rgba(220, 38, 38, 0.1);
      color: #b91c1c;
    }

    &.reference {
      border-color: rgba(99, 102, 241, 0.24);
      background: rgba(99, 102, 241, 0.08);
      color: #4338ca;
    }

    &.current-account {
      border-color: rgba(14, 165, 233, 0.3);
      background: rgba(14, 165, 233, 0.1);
      color: #0369a1;
    }

    &.source-deleted {
      border-color: rgba(245, 158, 11, 0.34);
      background: rgba(245, 158, 11, 0.12);
      color: #92400e;
    }

    &.current-detail {
      border-color: rgba(22, 101, 52, 0.34);
      background: #166534;
      color: #ffffff;
    }
  }

  .stage-steps-wrap {
    overflow-x: auto;
    overflow-y: visible;
    border-bottom: 1px solid var(--line);
  }

  .focused-run-flow-panel {
    display: grid;
    gap: 14px;
    min-width: 0;
    margin: 14px 18px 14px;
    padding: 14px;
    border: 1px solid rgba(245, 158, 11, 0.24);
    border-radius: 8px;
    background: rgba(255, 251, 235, 0.62);
  }

  .run-source-deleted-alert {
    border-radius: 8px;
  }

  .focused-run-total-time {
    display: grid;
    justify-items: end;
    gap: 3px;
    min-width: 112px;

    small,
    strong {
      display: block;
      white-space: nowrap;
    }

    small {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    strong {
      color: var(--heading);
      font-size: 16px;
      font-weight: 900;
      line-height: 1.2;
    }

    em {
      display: inline-flex;
      align-items: center;
      min-height: 18px;
      padding: 1px 7px;
      border: 1px solid rgba(14, 165, 233, 0.26);
      border-radius: 999px;
      background: rgba(14, 165, 233, 0.08);
      color: #0369a1;
      font-size: 11px;
      font-style: normal;
      font-weight: 850;
      line-height: 1.2;
      white-space: nowrap;
    }
  }

  .focused-run-step-flow {
    display: grid;
    grid-auto-columns: minmax(190px, 1fr);
    grid-auto-flow: column;
    gap: 0;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow-x: auto;
    padding: 4px 0 10px;
    scrollbar-gutter: stable;
  }

  .focused-run-step {
    position: relative;
    display: grid;
    grid-template-rows: 34px minmax(128px, auto);
    justify-items: center;
    min-width: 190px;
    color: #64748b;

    &::before {
      content: '';
      position: absolute;
      top: 16px;
      left: 0;
      right: 50%;
      height: 2px;
      background: rgba(148, 163, 184, 0.34);
    }

    &::after {
      content: '';
      position: absolute;
      top: 16px;
      left: 50%;
      right: 0;
      height: 2px;
      background: rgba(148, 163, 184, 0.34);
    }

    &:first-child::before,
    &:last-child::after {
      display: none;
    }

    &.is-done {
      color: #047857;

      &::before,
      &::after {
        background: rgba(16, 185, 129, 0.46);
      }
    }

    &.is-current {
      color: #d97706;

      &::before {
        background: rgba(16, 185, 129, 0.46);
      }

      &::after {
        background: linear-gradient(90deg, rgba(245, 158, 11, 0.82), rgba(245, 158, 11, 0.1));
        background-size: 200% 100%;
        animation: focusedStepLineFlow 1.1s linear infinite;
      }
    }

    &.is-warning {
      color: #b45309;
    }

    &.is-failed {
      color: #b91c1c;

      &::before,
      &::after {
        background: rgba(220, 38, 38, 0.4);
      }
    }
  }

  .focused-step-dot {
    position: relative;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 2px solid currentColor;
    border-radius: 50%;
    background: #ffffff;
    color: currentColor;
    font-size: 13px;
    font-weight: 900;
    box-shadow: 0 0 0 5px rgba(255, 251, 235, 0.9);
  }

  .focused-run-step.is-current .focused-step-dot {
    background: #f59e0b;
    color: #ffffff;
    animation: currentStagePulse 1.25s ease-in-out infinite;
    box-shadow: 0 0 0 7px rgba(245, 158, 11, 0.16), 0 10px 24px rgba(245, 158, 11, 0.28);
  }

  .focused-run-step.is-done .focused-step-dot {
    background: #ecfdf5;
  }

  .focused-run-step.is-failed .focused-step-dot {
    background: #fef2f2;
  }

  .focused-step-body {
    display: grid;
    gap: 6px;
    justify-items: center;
    width: 176px;
    min-width: 0;
    padding-top: 6px;
    text-align: center;

    strong,
    span,
    small {
      display: block;
      width: 100%;
      min-width: 0;
    }

    strong {
      color: var(--heading);
      font-size: 13px;
      font-weight: 900;
      line-height: 1.35;
      white-space: normal;
    }

    span {
      color: var(--text);
      font-size: 12px;
      line-height: 1.4;
      white-space: normal;
      word-break: break-word;
    }

    small {
      font-size: 12px;
      font-weight: 760;
      line-height: 1.25;
      white-space: normal;
    }

    .focused-step-status {
      color: currentColor;
      font-weight: 900;
    }

    .focused-step-duration {
      color: currentColor;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-weight: 850;
    }

    .focused-step-time {
      color: var(--muted);
      font-size: 11px;
      font-weight: 650;
      line-height: 1.35;
    }
  }

  .stage-steps {
    display: flex;
    min-width: max-content;
    overflow: visible;
    padding: 20px 22px 28px;

    .el-step {
      position: relative;
      flex-basis: 150px !important;
      min-width: 150px;
      text-align: center;
      --stage-color: #94a3b8;
      --stage-line: rgba(148, 163, 184, 0.42);
      --stage-bg: var(--panel);

      &::after {
        position: absolute;
        top: 11px;
        left: calc(50% + 20px);
        right: calc(-50% + 20px);
        z-index: 0;
        height: 2px;
        border-radius: 999px;
        background: var(--stage-line);
        content: '';
      }

      &:last-child::after {
        display: none;
      }
    }

    .el-step__head {
      margin: 0 auto;
    }

    .el-step__main {
      display: grid;
      justify-items: center;
      width: 150px;
      padding-top: 8px;
      text-align: center;
    }

    .el-step__title {
      display: block;
      width: 132px;
      max-width: 132px;
      overflow: hidden;
      color: var(--heading);
      font-size: 13px;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .el-step__description {
      display: block;
      width: 132px;
      max-width: 132px;
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      white-space: normal;
    }

    .stage-step-detail {
      display: inline-grid;
      gap: 3px;
      color: var(--stage-color);
    }

    .stage-step-detail small {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
      white-space: nowrap;
    }

    .el-step__head.is-success,
    .el-step__title.is-success,
    .el-step__description.is-success {
      color: var(--stage-color);
      border-color: var(--stage-color);
    }

    .el-step__head.is-process,
    .el-step__title.is-process,
    .el-step__description.is-process {
      color: var(--stage-color);
      border-color: var(--stage-color);
    }

    .el-step__head.is-wait,
    .el-step__title.is-wait,
    .el-step__description.is-wait {
      color: var(--stage-color);
      border-color: var(--stage-color);
    }

    .el-step__head,
    .el-step__title,
    .el-step__description {
      color: var(--stage-color) !important;
      border-color: var(--stage-color) !important;
    }

    .el-step__head {
      position: relative;
      z-index: 2;
      width: 24px;
    }

    .el-step__icon {
      position: relative;
      z-index: 3;
      width: 24px;
      height: 24px;
      background: var(--stage-bg);
      border-color: var(--stage-color);
      color: var(--stage-color);
      font-weight: 850;
      box-shadow: none;
    }

    .el-step__line {
      display: none;
    }

    .el-step__line-inner {
      border-color: var(--stage-color) !important;
    }

    .is-passed-stage {
      --stage-color: var(--primary);
      --stage-line: rgba(34, 197, 94, 0.42);
      --stage-bg: rgba(34, 197, 94, 0.1);
    }

    .is-conditional-stage {
      --stage-color: #d97706;
      --stage-line: rgba(217, 119, 6, 0.48);
      --stage-bg: rgba(245, 158, 11, 0.14);
    }

    .is-skipped-stage {
      --stage-color: #64748b;
      --stage-line: rgba(100, 116, 139, 0.42);
      --stage-bg: rgba(100, 116, 139, 0.1);
    }

    .is-failed-stage {
      --stage-color: var(--danger);
      --stage-line: rgba(220, 38, 38, 0.48);
      --stage-bg: rgba(220, 38, 38, 0.12);
    }

    .is-running-stage {
      --stage-color: var(--accent);
      --stage-line: rgba(14, 165, 233, 0.48);
      --stage-bg: rgba(14, 165, 233, 0.12);
    }

    .is-current-running-stage {
      --stage-color: #0284c7;
      --stage-line: rgba(14, 165, 233, 0.58);
      --stage-bg: #ffffff;

      &::after {
        background: linear-gradient(90deg, rgba(14, 165, 233, 0.18), rgba(14, 165, 233, 0.95), rgba(14, 165, 233, 0.18));
        background-size: 220% 100%;
        animation: stageLineFlow 1.2s linear infinite;
      }

      .el-step__icon {
        animation: currentStagePulse 1.25s ease-in-out infinite;
        box-shadow: 0 0 0 7px rgba(14, 165, 233, 0.14), 0 0 22px rgba(14, 165, 233, 0.42);
      }

      .el-step__title,
      .el-step__description {
        font-weight: 850;
      }
    }

    .is-pending-stage {
      --stage-color: #94a3b8;
      --stage-line: rgba(148, 163, 184, 0.42);
      --stage-bg: var(--panel);
    }
  }

  .run-detail .el-card__body {
    overflow: hidden;
  }

  .run-live-status {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin: 18px 18px 0;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);

    div {
      min-width: 0;
    }

    span,
    strong {
      display: block;
    }

    span {
      color: var(--muted);
      font-size: 12px;
    }

    strong {
      margin-top: 4px;
      overflow: hidden;
      color: var(--heading);
      font-size: 14px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .run-live-status.is-running {
    position: relative;
    overflow: hidden;
    border-color: rgba(14, 165, 233, 0.45);
    background: rgba(14, 165, 233, 0.08);
    box-shadow: inset 0 0 0 1px rgba(14, 165, 233, 0.08), 0 12px 28px rgba(14, 165, 233, 0.08);

    &::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: -30%;
      width: 28%;
      background: linear-gradient(90deg, transparent, rgba(14, 165, 233, 0.18), transparent);
      animation: liveStatusSweep 1.8s ease-in-out infinite;
      pointer-events: none;
    }

    strong {
      color: #075985;
    }
  }

  .run-worker-panel {
    display: grid;
    gap: 12px;
    margin: 14px 18px 0;
    padding: 14px;
    border: 1px solid rgba(14, 165, 233, 0.22);
    border-radius: 8px;
    background: rgba(248, 250, 252, 0.92);
  }

  .run-worker-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;

    div {
      min-width: 0;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #ffffff;
    }

    span,
    strong {
      display: block;
    }

    span {
      color: var(--muted);
      font-size: 12px;
    }

    strong {
      margin-top: 4px;
      overflow: hidden;
      color: var(--heading);
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .run-worker-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: #475569;
    font-size: 12px;
    line-height: 1.6;
  }

  .run-worker-sync-badge {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    min-height: 22px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 900;
    line-height: 1.25;

    &.running {
      background: rgba(14, 165, 233, 0.11);
      color: #0369a1;
    }

    &.warning {
      background: rgba(245, 158, 11, 0.13);
      color: #92400e;
    }

    &.success {
      background: rgba(22, 163, 74, 0.12);
      color: #166534;
    }

    &.danger {
      background: rgba(239, 68, 68, 0.12);
      color: #b91c1c;
    }

    &.muted {
      background: rgba(100, 116, 139, 0.1);
      color: #475569;
    }
  }

  .run-worker-claim-evidence {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    span {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.78);
      color: #475569;
      font-size: 12px;
      line-height: 1.3;
    }
  }

  .run-worker-command-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border: 1px dashed rgba(14, 165, 233, 0.34);
    border-radius: 8px;
    background: #ffffff;

    > div:first-child {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    strong,
    span {
      display: block;
    }

    strong {
      color: var(--heading);
      font-size: 13px;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
  }

  .run-worker-command-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }

  @media (max-width: 1100px) {
    .run-worker-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .run-worker-command-box {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (max-width: 720px) {
    .run-worker-grid {
      grid-template-columns: 1fr;
    }
  }

  @keyframes runStatusPulse {
    0%,
    100% {
      opacity: 0;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes currentStagePulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.14);
    }
  }

  @keyframes stageLineFlow {
    from {
      background-position: 0 0;
    }
    to {
      background-position: 220% 0;
    }
  }

  @keyframes focusedStepLineFlow {
    from {
      background-position: 0 0;
    }
    to {
      background-position: 200% 0;
    }
  }

  @keyframes liveStatusSweep {
    0% {
      transform: translateX(0);
    }
    100% {
      transform: translateX(520%);
    }
  }

  .log-live-indicator {
    position: relative;
    padding-left: 14px;
    color: #0284c7 !important;

    &::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #0ea5e9;
      transform: translateY(-50%);
      animation: logLivePulse 1s ease-in-out infinite;
    }
  }

  @keyframes logLivePulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.35);
      opacity: 1;
    }
    50% {
      box-shadow: 0 0 0 6px rgba(14, 165, 233, 0);
      opacity: 0.72;
    }
  }

  @keyframes logCursorBlink {
    0%,
    45% {
      opacity: 1;
    }
    46%,
    100% {
      opacity: 0;
    }
  }

  .run-result-summary,
  .run-change-summary {
    margin: 0 18px 18px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);
  }

  .run-result-summary {
    display: grid;
    gap: 12px;
    border-left: 4px solid var(--result-accent, var(--line-strong));

    &.is-danger {
      --result-accent: var(--danger);
      background: rgba(220, 38, 38, 0.06);
      border-color: rgba(220, 38, 38, 0.24);
      border-left-color: var(--danger);
    }

    &.is-warning {
      --result-accent: #d97706;
      background: rgba(245, 158, 11, 0.08);
      border-color: rgba(217, 119, 6, 0.24);
      border-left-color: #d97706;
    }

    &.is-success {
      --result-accent: var(--primary);
      background: rgba(34, 197, 94, 0.06);
      border-color: rgba(34, 197, 94, 0.2);
      border-left-color: var(--primary);
    }
  }

  .direct-run-overview-panel {
    display: grid;
    gap: 14px;
    margin: 14px 18px 18px;
    padding: 14px;
    border: 1px solid rgba(34, 197, 94, 0.22);
    border-left: 4px solid var(--primary);
    border-radius: 8px;
    background: rgba(34, 197, 94, 0.05);
  }

  .direct-run-summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 8px;
    background: #ffffff;
  }

  .direct-run-summary-card {
    display: grid;
    gap: 5px;
    min-width: 0;
    padding: 11px 12px;
    border-right: 1px solid rgba(148, 163, 184, 0.18);

    &:last-child {
      border-right: 0;
    }

    span,
    strong,
    small {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      color: var(--muted);
      font-size: 12px;
    }

    strong {
      color: var(--heading);
      font-size: 18px;
      font-weight: 900;
      line-height: 1.1;
    }

    small {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.2;
    }

    &.success strong {
      color: #047857;
    }

    &.warning strong {
      color: #b45309;
    }

    &.danger strong {
      color: #b91c1c;
    }

    &.primary strong {
      color: #0369a1;
    }

    &.muted strong {
      color: var(--muted);
    }
  }

  .direct-run-info-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .direct-run-info-group {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 12px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    background: #ffffff;
  }

  .direct-run-group-title {
    color: var(--heading);
    font-size: 13px;
    font-weight: 900;
  }

  .direct-run-info-row {
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr);
    gap: 10px;
    align-items: baseline;
    min-width: 0;

    span {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    strong,
    a {
      min-width: 0;
      overflow: hidden;
      color: var(--heading);
      font-size: 13px;
      font-weight: 820;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    a {
      color: var(--primary-ink);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }

  .direct-run-issue-list {
    display: grid;
    gap: 8px;
  }

  .direct-run-issue-row {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 8px;
    background: #ffffff;

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    strong {
      color: var(--heading);
      font-size: 13px;
      line-height: 1.45;
    }

    &.danger {
      border-color: rgba(220, 38, 38, 0.24);
      background: rgba(220, 38, 38, 0.06);

      strong {
        color: #b91c1c;
      }
    }

    &.warning {
      border-color: rgba(245, 158, 11, 0.28);
      background: rgba(245, 158, 11, 0.08);

      strong {
        color: #b45309;
      }
    }

    &.muted strong {
      color: var(--muted);
    }
  }

  .run-generated-image-panel {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid rgba(20, 184, 166, 0.22);
    border-radius: 8px;
    background: #ffffff;
  }

  .run-generated-image-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;

    strong {
      color: var(--heading);
      font-size: 14px;
      font-weight: 900;
      white-space: nowrap;
    }

    span {
      min-width: 0;
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .run-generated-image-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }

  .run-generated-image-card {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 8px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 8px;
    background: rgba(248, 250, 252, 0.72);
  }

  .run-generated-image-thumb {
    display: block;
    overflow: hidden;
    aspect-ratio: 4 / 3;
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 6px;
    background: #f8fafc;

    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
  }

  .run-generated-image-meta {
    display: grid;
    gap: 3px;
    min-width: 0;

    strong,
    span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    strong {
      color: var(--heading);
      font-size: 12px;
      font-weight: 850;
    }

    span {
      color: var(--muted);
      font-size: 12px;
    }
  }

  .run-generated-image-actions {
    display: flex;
    gap: 6px;

    .el-button {
      flex: 1;
      min-width: 0;
    }
  }

  .direct-run-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border: 1px solid rgba(14, 165, 233, 0.18);
    border-radius: 8px;
    background: rgba(14, 165, 233, 0.06);

    > span {
      min-width: 0;
      color: var(--heading);
      font-size: 13px;
      font-weight: 760;
      line-height: 1.5;
    }

    > div {
      display: flex;
      flex: 0 0 auto;
      gap: 8px;
    }
  }

  @media (max-width: 1200px) {
    .direct-run-summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .direct-run-summary-card:nth-child(2n) {
      border-right: 0;
    }

    .direct-run-summary-card:nth-child(-n + 2) {
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    }

    .direct-run-info-grid {
      grid-template-columns: 1fr;
    }

    .direct-run-actions {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  .run-progress-panel {
    position: relative;
    display: grid;
    gap: 6px;
    margin: 0 18px 18px;
    padding: 14px 16px 14px 18px;
    overflow: hidden;
    border: 1px solid rgba(14, 165, 233, 0.28);
    border-left: 4px solid var(--accent);
    border-radius: 8px;
    background: rgba(14, 165, 233, 0.07);

    &::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: -25%;
      width: 22%;
      background: linear-gradient(90deg, transparent, rgba(14, 165, 233, 0.18), transparent);
      animation: liveStatusSweep 1.8s ease-in-out infinite;
    }

    strong {
      color: #075985;
      font-size: 15px;
    }

    span,
    small {
      color: var(--text);
      font-size: 13px;
      line-height: 1.55;
    }

    small {
      color: var(--muted);
    }
  }

  .run-skill-actions-panel,
  .run-chain-panel {
    display: grid;
    gap: 12px;
    margin: 0 18px 18px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);
  }

  .run-chain-panel-top {
    margin-top: 14px;
    margin-bottom: 14px;
    background: #ffffff;
  }

  .run-section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;

    h4 {
      margin: 0 0 5px;
      color: var(--heading);
      font-size: 15px;
      font-weight: 900;
      line-height: 1.25;
    }

    p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    > span {
      flex: 0 0 auto;
      color: var(--primary-ink);
      font-size: 12px;
      font-weight: 850;
      white-space: nowrap;
    }
  }

  .run-skill-action-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .run-skill-action-card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--line);
    border-left: 4px solid #94a3b8;
    border-radius: 8px;
    background: var(--panel);

    &.completed,
    &.recorded {
      border-left-color: var(--primary);
    }

    &.running {
      border-left-color: var(--accent);
    }

    &.blocked,
    &.failed {
      border-left-color: var(--danger);
    }

    p {
      min-height: 40px;
      margin: 0;
      color: var(--text);
      font-size: 13px;
      line-height: 1.55;
    }
  }

  .run-skill-action-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;

    div {
      min-width: 0;
    }

    span,
    strong {
      display: block;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    strong {
      margin-top: 3px;
      overflow: hidden;
      color: var(--heading);
      font-size: 15px;
      font-weight: 900;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .run-skill-action-meta,
  .run-other-action-row,
  .run-chain-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .run-skill-action-meta span,
  .run-chain-meta span {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    padding: 0 8px;
    border-radius: 4px;
    background: rgba(100, 116, 139, 0.08);
    color: var(--muted);
    font-size: 12px;
    font-weight: 740;
  }

  .run-other-action-row {
    align-items: center;
    padding-top: 2px;

    > span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 850;
    }

    > strong {
      color: var(--heading);
      font-size: 13px;
      font-weight: 850;
    }
  }

  .run-chain-list {
    display: grid;
    gap: 0;
  }

  .run-chain-step {
    position: relative;
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 10px;
    padding: 0 0 14px;

    &::before {
      position: absolute;
      top: 20px;
      bottom: 0;
      left: 9px;
      width: 2px;
      border-radius: 999px;
      background: var(--line);
      content: '';
    }

    &:last-child {
      padding-bottom: 0;

      &::before {
        display: none;
      }
    }

    &.is-completed .run-chain-marker {
      border-color: var(--primary);
      background: var(--primary);
    }

    &.is-running .run-chain-marker {
      border-color: var(--accent);
      background: var(--accent);
      box-shadow: 0 0 0 5px rgba(14, 165, 233, 0.12);
    }

    &.is-problem .run-chain-marker {
      border-color: var(--danger);
      background: var(--danger);
    }
  }

  .run-chain-marker {
    position: relative;
    z-index: 1;
    width: 20px;
    height: 20px;
    border: 2px solid #94a3b8;
    border-radius: 50%;
    background: var(--panel);
  }

  .run-chain-content {
    display: grid;
    gap: 7px;
    min-width: 0;
    padding: 0 0 0 2px;

    p {
      margin: 0;
      color: var(--text);
      font-size: 13px;
      line-height: 1.5;
    }
  }

  .run-chain-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;

    strong {
      color: var(--heading);
      font-size: 14px;
      font-weight: 900;
    }

    span {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 12px;
      font-weight: 740;
      white-space: nowrap;
    }
  }

  .run-reference-list {
    display: grid;
    gap: 7px;
    padding-top: 2px;

    > span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 850;
    }

    > strong {
      color: var(--heading);
      font-size: 13px;
      font-weight: 850;
    }

    code {
      display: block;
      overflow: hidden;
      padding: 7px 9px;
      border-radius: 6px;
      background: var(--code-bg, rgba(15, 23, 42, 0.06));
      color: var(--heading);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .focused-run-mode-line {
    display: flex;
    align-self: start;
    align-items: baseline;
    gap: 0;
    max-width: 100%;

    > span,
    > strong {
      white-space: normal;
      word-break: break-word;
    }

    > span {
      flex: 0 0 auto;
    }
  }

  .run-result-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;

    span,
    strong {
      display: block;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    strong {
      margin-top: 4px;
      color: var(--heading);
      font-size: 17px;
      line-height: 1.45;
    }
  }

  .run-change-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;

    h4 {
      margin: 0 0 6px;
      color: var(--heading);
      font-size: 15px;
      font-weight: 900;
      line-height: 1.25;
    }

    p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
  }

  .run-result-status-tag {
    display: inline-flex;
    align-items: center;
    min-width: 72px;
    height: 24px;
    padding: 0 10px;
    border-color: #b45309 !important;
    border-radius: 4px;
    background: #b45309 !important;
    color: #ffffff !important;
    justify-content: center;
    font-weight: 850;
    font-size: 12px;
    line-height: 24px;
    text-align: center;
    --el-tag-text-color: #ffffff;
    --el-tag-bg-color: #b45309;
    --el-tag-border-color: #b45309;

    .el-tag__content {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      color: #ffffff !important;
      line-height: 24px;
      text-align: center;
    }
  }

  .run-result-summary-text {
    margin: 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--panel-tint);
    color: var(--text);
    font-size: 13px;
    line-height: 1.6;
  }

  .result-fact-list {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
  }

  .result-fact-item {
    min-width: 0;
    padding: 10px 12px;
    border-right: 1px solid var(--line);

    &:last-child {
      border-right: 0;
    }

    span,
    strong {
      display: block;
      overflow-wrap: anywhere;
    }

    span {
      color: var(--muted);
      font-size: 12px;
    }

    strong {
      margin-top: 4px;
      color: var(--heading);
      font-size: 13px;
      line-height: 1.45;
    }

    &.success strong {
      color: #047857;
    }

    &.warning strong {
      color: #b45309;
    }

    &.danger strong {
      color: #b91c1c;
    }

    &.muted strong {
      color: var(--muted);
    }
  }

  .result-action-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border: 1px solid rgba(14, 165, 233, 0.22);
    border-radius: 8px;
    background: rgba(14, 165, 233, 0.07);

    span {
      min-width: 0;
      color: var(--heading);
      font-size: 13px;
      font-weight: 760;
      line-height: 1.5;
    }

    div {
      display: flex;
      flex: 0 0 auto;
      gap: 8px;
    }

    .el-button--primary {
      --el-button-text-color: #ffffff;
      --el-button-hover-text-color: #ffffff;
      --el-button-active-text-color: #ffffff;
      color: #ffffff !important;

      &:hover,
      &:focus {
        color: #ffffff !important;
      }

      span {
        color: #ffffff !important;
      }
    }
  }

  .result-list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;

    span {
      color: var(--muted);
      font-size: 12px;
    }

    code {
      padding: 4px 7px;
      border-radius: 6px;
      background: var(--code-bg);
      color: var(--code-text);
      font-size: 12px;
    }
  }

  .change-metric-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 10px 0;

    span {
      padding: 5px 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--muted);
      font-size: 12px;
    }
  }

  .change-file-list {
    display: grid;
    gap: 8px;
    max-height: 180px;
    overflow: auto;

    .change-file-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
    }

    .change-file-open {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      width: 100%;
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-tint);
      color: var(--text);
      font-size: 12px;
      text-align: left;
    }

    .change-file-open:hover {
      border-color: rgba(34, 197, 94, 0.45);
      background: var(--primary-soft);
    }

    .change-file-open span:last-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

  }
}

.run-log-drawer.el-drawer.rtl,
.run-log-drawer.el-drawer.rtl .el-drawer__header,
.run-log-drawer.el-drawer.rtl .el-drawer__body {
  border-radius: 0 !important;
}

.run-log-drawer .el-drawer__body {
  padding: 0;
  overflow: hidden;
  background: var(--panel);
}

.run-log-drawer-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}

.run-log-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--soft-card);

  > div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 760;
  }

  strong {
    overflow: hidden;
    color: var(--heading);
    font-size: 14px;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    flex: 0 0 auto;
    color: var(--muted);
    font-size: 12px;
    font-weight: 760;
    white-space: nowrap;
  }
}

.run-log-drawer .log-live-indicator {
  position: relative;
  padding-left: 14px;
  color: #0284c7 !important;

  &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #0ea5e9;
    transform: translateY(-50%);
    animation: logLivePulse 1s ease-in-out infinite;
  }
}

.run-log-drawer-markdown {
  position: relative;
  min-height: 0;
  height: 100%;
  margin: 0;
  overflow: auto;
  padding: 16px 18px 28px;
  border: 0;
  border-radius: 0;
  background: var(--panel);

  &.is-live::after {
    content: '▋';
    display: inline-block;
    margin-left: 4px;
    color: #38bdf8;
    animation: logCursorBlink 0.8s steps(2, start) infinite;
  }
}

.run-codex-floating {
  position: fixed;
  z-index: 18;
  display: block;
  pointer-events: none;

  &.dragging {
    user-select: none;
  }
}

.run-codex-floating-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 50%;
  background: #111827;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.24);
  cursor: pointer;
  pointer-events: auto;
  touch-action: none;
  transition: box-shadow 0.18s ease, border-color 0.18s ease;

  img {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    object-fit: cover;
  }

  &:hover,
  &.active {
    border-color: rgba(14, 165, 233, 0.38);
    box-shadow: 0 20px 48px rgba(14, 165, 233, 0.22), 0 18px 44px rgba(15, 23, 42, 0.18);
  }
}

.run-codex-floating-panel {
  position: absolute;
  right: 0;
  bottom: 68px;
  display: grid;
  grid-template-rows: auto minmax(120px, 1fr) auto auto auto;
  gap: 12px;
  width: min(520px, calc(100vw - 56px));
  max-height: min(680px, calc(100vh - 128px));
  padding: 14px;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.22);
  pointer-events: auto;
}

.run-codex-floating-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.run-codex-title-block {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;

  > img {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    object-fit: cover;
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
  }

  h4 {
    margin: 0;
    color: var(--heading);
    font-size: 16px;
    font-weight: 900;
    line-height: 1.2;
  }

  span {
    display: block;
    max-width: 360px;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.run-codex-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.06);
  color: var(--muted);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
}

.run-codex-floating-messages {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 120px;
  overflow-y: auto;
  padding: 4px 2px;
}

.run-codex-message {
  display: flex;
  gap: 9px;
  min-width: 0;

  &.user {
    justify-content: flex-end;

    .run-codex-bubble {
      max-width: 82%;
      background: #f3f4f6;
      color: var(--heading);
    }
  }

  &.assistant .run-codex-bubble {
    border: 1px solid rgba(15, 23, 42, 0.08);
    background: #ffffff;
  }
}

.run-codex-avatar {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: #111827;

  img {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    object-fit: cover;
  }
}

.run-codex-bubble {
  display: grid;
  gap: 5px;
  max-width: 88%;
  padding: 10px 12px;
  border-radius: 16px;
  color: var(--text);
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;

  strong {
    color: var(--heading);
    font-size: 13px;
    font-weight: 900;
  }

  p {
    margin: 0;
  }
}

.run-codex-standard-input {
  .el-textarea__inner {
    min-height: 62px !important;
    resize: none;
    border-radius: 14px;
    background: #f8fafc;
    font-size: 13px;
    line-height: 1.55;
  }
}

.run-codex-composer {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);

  .el-textarea__inner {
    min-height: 54px !important;
    resize: none;
    border: 0;
    box-shadow: none;
    padding: 4px 2px;
    color: var(--heading);
    font-size: 14px;
    line-height: 1.55;
  }
}

.run-codex-composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  > span {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .el-button {
    width: 36px;
    height: 36px;
    font-size: 18px;
    font-weight: 900;
  }
}

.run-template-dialog {
  .run-template-dialog-body {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(260px, 0.95fr);
    gap: 18px;
  }

  .run-template-create-panel,
  .run-template-saved-panel {
    display: grid;
    align-content: start;
    gap: 14px;
    min-width: 0;
  }

  .run-template-section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;

    div {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    strong {
      color: var(--heading);
      font-size: 14px;
      font-weight: 900;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
  }

  .run-template-stage-preview {
    display: grid;
    gap: 8px;
    width: 100%;
    margin-top: 10px;

    article {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      padding: 9px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--soft-card);
    }

    span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.1);
      color: var(--primary);
      font-size: 12px;
      font-weight: 850;
    }

    strong {
      min-width: 0;
      color: var(--heading);
      font-size: 13px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 58px;
      height: 26px;
      padding: 0 12px;
      border: 1px solid rgba(220, 38, 38, 0.42);
      border-radius: 999px;
      background: #fff;
      color: #dc2626;
      font-size: 12px;
      font-weight: 760;
      cursor: pointer;
    }
  }

  .run-template-create-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .run-template-list {
    display: grid;
    gap: 8px;
    max-height: 430px;
    overflow: auto;
  }

  .run-template-empty {
    display: grid;
    gap: 5px;
    padding: 12px;
    border: 1px dashed var(--line);
    border-radius: 8px;
    background: var(--panel-tint);

    strong {
      color: var(--heading);
      font-size: 13px;
      font-weight: 850;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.55;
    }
  }

  .run-template-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);

    .run-template-item-main {
      display: grid;
      gap: 7px;
      min-width: 0;
    }

    .run-template-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--heading);
      font-size: 13px;
      font-weight: 850;
    }

    .run-template-skill-pill {
      display: inline-flex;
      align-items: center;
      max-width: 180px;
      height: 26px;
      padding: 0 12px;
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.1);
      color: #3730a3;
      font-size: 12px;
      font-weight: 850;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .run-template-description {
      margin: 0;
      color: var(--text);
      font-size: 12px;
      line-height: 1.55;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .run-template-meta {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .run-template-item-actions {
    display: grid;
    gap: 6px;
    justify-items: end;
    white-space: nowrap;

    .el-button {
      width: 58px;
      height: 32px;
      margin: 0;
      padding: 0 12px;
      justify-content: center;
    }
  }
}

@media (max-width: 860px) {
  .run-template-dialog {
    .run-template-dialog-body {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}

.run-codex-inline-config {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: calc(100% - 52px);
  color: var(--muted);
  font-size: 12px;
  font-weight: 760;

  > span {
    color: rgba(100, 116, 139, 0.72);
    font-weight: 900;
  }
}

.run-codex-inline-select {
  flex: 0 0 auto;
  width: auto;

  &.model {
    width: 104px;
  }

  &.reasoning {
    width: 112px;
  }

  .el-select__wrapper {
    min-height: 26px;
    padding: 0 6px;
    border-radius: 8px;
    background: transparent;
    box-shadow: none;
  }

  .el-select__placeholder,
  .el-select__selected-item {
    overflow: visible;
    color: var(--muted);
    font-size: 12px;
    font-weight: 760;
    text-overflow: clip;
    white-space: nowrap;
  }

  .el-select__caret {
    color: rgba(100, 116, 139, 0.72);
    font-size: 12px;
  }
}

.run-codex-inline-popper {
  min-width: 120px;
}

@media (max-width: 860px) {
  .run-codex-floating-panel {
    right: 10px;
    bottom: 76px;
    width: calc(100vw - 36px);
    max-height: calc(100vh - 112px);
    border-radius: 16px;
  }

  .run-codex-floating-button {
    width: 50px;
    height: 50px;
  }

  .run-codex-inline-config {
    max-width: calc(100% - 48px);
  }

  .run-codex-inline-select.model,
  .run-codex-inline-select.reasoning {
    width: 104px;
  }
}
</style>
