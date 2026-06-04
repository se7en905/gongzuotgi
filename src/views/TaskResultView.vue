<template>
<section v-show="app.activeView === 'task-result'" class="view-grid task-result-view">
  <ElBreadcrumb class="nav-crumbs" separator="/">
    <ElBreadcrumbItem>
      <button type="button" @click="app.goAiArchive">AI 档案</button>
    </ElBreadcrumbItem>
    <ElBreadcrumbItem>执行详情</ElBreadcrumbItem>
  </ElBreadcrumb>

  <div v-if="app.selectedTask" class="task-audit task-result-page">
    <div class="audit-hero">
      <div>
        <ElTag :type="app.statusTagType(app.selectedTask.audit?.status)">{{ app.statusLabel(app.selectedTask.audit?.status) }}</ElTag>
        <h2>
          <a v-if="app.zentaoTaskUrl(app.selectedTask)" :href="app.zentaoTaskUrl(app.selectedTask)" target="_blank" rel="noopener noreferrer" class="task-title-link">{{ app.selectedTask.name }}</a>
          <span v-else>{{ app.selectedTask.name }}</span>
        </h2>
        <div class="task-meta-line">
          <p class="path-with-copy">
            <span>位置：{{ app.selectedTask.path }}</span>
            <button type="button" class="copy-path-button" @click="app.copyText(app.selectedTask.path, '任务路径')">复制</button>
          </p>
        </div>
      </div>
      <div class="audit-score">
        <strong>{{ app.selectedTask.audit?.gateScore || 0 }}/{{ app.selectedTask.audit?.gateTotal || 6 }}</strong>
        <span>交付门禁</span>
      </div>
    </div>

    <div class="metric-grid audit-metrics">
      <ElCard shadow="never" v-for="metric in app.taskMetrics" :key="metric.label" class="metric-card">
        <span>{{ metric.label }}</span>
        <strong>{{ metric.value }}</strong>
        <small>{{ metric.hint }}</small>
      </ElCard>
    </div>

    <ElTabs :model-value="app.auditTab" @update:model-value="value => app.auditTab = value" class="audit-tabs">
      <ElTabPane :label="`阶段审计 ${app.auditStages.length}`" name="overview">
        <div class="audit-workspace">
          <div class="stage-rail">
            <button
              v-for="stage in app.auditStages"
              :key="stage.no"
              class="audit-stage"
              :class="[`is-${app.statusTagType(stage.status)}`, { active: String(stage.no) === String(app.selectedStageNo) }]"
              @click="app.selectedStageNo = stage.no"
            >
              <span>{{ stage.no }}</span>
              <div>
                <strong>{{ stage.name }}</strong>
                <small>{{ app.artifactsForStage(app.auditReports, stage).length }} 报告 · {{ app.artifactsForStage(app.auditImages, stage).length }} 图片</small>
              </div>
              <ElTag class="stage-status-tag" :type="app.statusTagType(stage.status)">{{ app.stageStepLabel(stage.status) }}</ElTag>
            </button>
          </div>
          <div class="stage-panel" v-if="app.selectedStage">
            <div class="stage-head">
              <div>
                <h3>{{ app.selectedStage.name }}</h3>
                <p v-if="app.selectedStage.output" class="path-with-copy">
                  <span>{{ app.selectedStage.output }}</span>
                  <button type="button" class="copy-path-button" @click="app.copyText(app.selectedStage.output, '阶段报告路径')">复制</button>
                </p>
                <p v-else>未声明阶段报告路径</p>
              </div>
              <ElTag :type="app.statusTagType(app.selectedStage.status)">{{ app.stageStepLabel(app.selectedStage.status) }}</ElTag>
            </div>

            <div class="gate-strip">
              <div v-for="item in app.selectedStageExecutionFacts" :key="item.label" class="gate-item ok">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
              <div v-for="gate in app.selectedStageGates" :key="gate.label" :class="['gate-item', gate.ok ? 'ok' : 'warn']">
                <span>{{ gate.label }}</span>
                <strong>{{ gate.value }}</strong>
              </div>
            </div>

            <section class="stage-summary">
              <div>
                <h4>{{ app.selectedStageSummary.title }}</h4>
                <p>{{ app.selectedStageSummary.description }}</p>
              </div>
              <div class="summary-checks">
                <button
                  v-for="check in app.selectedStageSummary.checks"
                  :key="check.label"
                  type="button"
                  :class="check.status"
                  :disabled="check.action !== 'review'"
                  @click="app.openStageSummaryReview(check)"
                >
                  <span>{{ check.label }}</span>
                  <strong v-if="check.action === 'review'">去复核</strong>
                </button>
              </div>
            </section>

            <div class="stage-grid">
              <section>
                <h4>关联报告</h4>
                <button v-for="report in app.selectedStageReports" :key="report.path" class="stage-artifact" @click="app.openAuditReport(report)">
                  <div>
                    <strong>{{ app.artifactDisplayTitle(report) }}</strong>
                    <ElTag size="small" effect="plain">{{ app.artifactStageLabel(report) }}</ElTag>
                  </div>
                  <span class="artifact-path path-with-copy">
                    <span>{{ app.compactArtifactPath(report) }}</span>
                    <button type="button" class="copy-path-button" @click.stop="app.copyText(report.relativePath || report.path, '报告路径')">复制</button>
                  </span>
                </button>
                <div v-if="!app.selectedStageReports.length" class="empty-block">该阶段没有匹配到报告文件。</div>
              </section>
              <section>
                <h4>图片证据</h4>
                <button v-for="image in app.selectedStageImages.slice(0, 6)" :key="image.path" class="image-thumb" @click="app.openAuditImage(image)">
                  <img :src="app.artifactUrl(image.path)" :alt="image.name" />
                  <span>{{ image.title || image.name }}</span>
                  <small>{{ image.evidenceType || image.stage }}</small>
                </button>
                <div v-if="!app.selectedStageImages.length" class="empty-block">该阶段没有匹配到图片证据。</div>
              </section>
            </div>

            <section class="audit-section">
              <h4>人工审核清单</h4>
              <div class="review-grid">
                <div v-for="item in app.selectedStageReview" :key="item.key" :class="['review-item', item.status]">
                  <strong>{{ item.label }}</strong>
                  <p>{{ item.detail }}</p>
                  <ElTag v-if="app.manualReviewRecordFor(item)" size="small" :type="app.manualReviewDecisionTagType(app.manualReviewRecordFor(item).decision)">
                    {{ app.manualReviewDecisionLabel(app.manualReviewRecordFor(item).decision) }}
                  </ElTag>
                  <ElButton size="small" @click="app.openManualReview(item)">
                    {{ app.manualReviewRecordFor(item) ? '查看复核记录' : item.status === 'ready' ? '查看复核材料' : '进入人工复核' }}
                  </ElButton>
                </div>
              </div>
            </section>

            <section class="audit-section">
              <h4>人工复核记录</h4>
              <div class="manual-record-list">
                <button
                  v-for="record in app.taskManualReviewRecords"
                  :key="record.id"
                  type="button"
                  class="manual-record-item"
                  @click="app.openManualReviewRecord(record)"
                >
                  <ElTag size="small" :type="app.manualReviewDecisionTagType(record.decision)">
                    {{ app.manualReviewDecisionLabel(record.decision) }}
                  </ElTag>
                  <div>
                    <strong>{{ record.reviewLabel }}</strong>
                    <span>{{ record.stageName }} · {{ app.formatDateTime(record.createdAt) }}</span>
                    <p>{{ record.comment || '未填写复核说明。' }}</p>
                  </div>
                </button>
                <div v-if="!app.taskManualReviewRecords.length" class="empty-block">暂无人工复核记录。</div>
              </div>
            </section>

            <section class="audit-section">
              <h4>风险与下一步</h4>
              <div class="issue-list">
                <div v-for="issue in app.selectedStageIssues" :key="issue.issue" class="issue-item">
                  <ElTag :type="/P0|P1/.test(issue.priority) ? 'danger' : 'warning'">{{ issue.priority }}</ElTag>
                  <div>
                    <strong>{{ issue.issue }}</strong>
                    <p>影响：{{ issue.impact }}</p>
                    <p>建议：{{ issue.suggestion }}</p>
                  </div>
                </div>
                <div v-if="!app.selectedStageIssues.length" class="empty-block">未解析到 P0/P1/P2 风险项。</div>
              </div>
            </section>
          </div>
        </div>
      </ElTabPane>

      <ElTabPane label="人工全流程记录" name="manual-flow">
        <div class="manual-flow-panel">
          <div class="manual-flow-head">
            <div>
              <h3>人工全流程记录</h3>
              <p>记录需求、模型、Figma、API、质检、报告、评估和修复过程。</p>
            </div>
            <div class="panel-actions">
              <ElTag :type="app.selectedTaskManualFlowRecord?.status === 'confirmed' ? 'success' : 'warning'">
                {{ app.aiFlowRecordStatusLabel(app.selectedTaskManualFlowRecord?.status) }}
              </ElTag>
              <ElButton v-if="app.can('archive.record.manage')" type="primary" plain @click="app.openAiFlowRecordDialog(app.selectedTaskArchiveRow)">
                {{ app.selectedTaskManualFlowRecord ? '编辑记录' : '补充记录' }}
              </ElButton>
            </div>
          </div>
          <template v-if="app.selectedTaskManualFlowRecord">
            <div class="manual-flow-summary">
              <div>
                <span>智能体/模型</span>
                <strong>{{ app.selectedTaskManualFlowRecord.agentModel || '-' }}</strong>
              </div>
              <div>
                <span>全流程完成度</span>
                <strong>{{ app.selectedTaskManualFlowRecord.flowCompletion || 0 }}%</strong>
              </div>
              <div>
                <span>生成总时长</span>
                <strong>{{ app.selectedTaskManualFlowRecord.totalDuration || '-' }}</strong>
              </div>
              <div>
                <span>最近更新</span>
                <strong>{{ app.formatDateTime(app.selectedTaskManualFlowRecord.updatedAt || app.selectedTaskManualFlowRecord.importedAt) }}</strong>
              </div>
            </div>
            <div class="manual-flow-grid">
              <section v-for="field in app.aiFlowStageFields" :key="field.key">
                <h4>{{ field.label }}</h4>
                <p>{{ app.selectedTaskManualFlowRecord[field.key] || '未记录。' }}</p>
              </section>
            </div>
            <section class="manual-flow-issues">
              <h4>总结和问题</h4>
              <p>{{ app.selectedTaskManualFlowRecord.summaryIssues || '未记录。' }}</p>
            </section>
          </template>
          <div v-else class="empty-block">当前任务还没有人工全流程记录。</div>
        </div>
      </ElTabPane>

      <ElTabPane :label="`报告阅读 ${app.auditReports.length}`" name="reports">
        <div class="report-workbench">
          <div class="artifact-nav">
            <section v-for="group in app.groupedAuditReports" :key="group.key" class="artifact-group">
              <div class="artifact-group-title">
                <span>{{ group.title }}</span>
                <small>{{ group.items.length }} 份</small>
              </div>
              <button
                v-for="report in group.items"
                :key="report.path"
                type="button"
                :class="{ active: app.selectedReport?.path === report.path }"
                @click="app.openAuditReport(report)"
              >
                <strong>{{ app.artifactDisplayTitle(report) }}</strong>
              </button>
            </section>
            <div v-if="!app.groupedAuditReports.length" class="empty-block">没有可阅读的报告。</div>
          </div>
          <article
            class="markdown-report"
            v-html="app.selectedReportHtml || '<div class=&quot;empty-block&quot;>选择左侧报告阅读内容。</div>'"
            @click="app.handleReportContentClick"
          ></article>
        </div>
      </ElTabPane>

      <ElTabPane :label="`图片证据 ${app.auditImages.length}`" name="images">
        <div class="image-workbench">
          <div class="evidence-panel">
            <div class="evidence-toolbar">
              <strong>全部证据</strong>
              <span>{{ app.visibleAuditImages.length }} 张</span>
            </div>
            <div class="evidence-groups">
              <section v-for="group in app.groupedAuditImages" :key="group.key" class="evidence-group">
                <div class="evidence-group-head">
                  <strong>{{ group.label }}</strong>
                  <span>{{ group.images.length }}</span>
                </div>
                <button
                  v-for="image in group.images"
                  :key="image.path"
                  :class="['evidence-row', { active: app.selectedImage?.path === image.path }]"
                  type="button"
                  @click="app.openAuditImage(image)"
                >
                  <img :src="app.artifactUrl(image.path)" :alt="image.name" loading="lazy" />
                  <div>
                    <strong>{{ image.title || image.name }}</strong>
                    <span>{{ image.evidenceType || image.stage || '图片证据' }}</span>
                    <small>{{ image.reviewFocus || image.meaning || image.relativePath }}</small>
                  </div>
                  <ElTag size="small" :type="app.imageEvidenceTagType(image)">{{ app.imageEvidenceStatus(image) }}</ElTag>
                </button>
              </section>
              <div v-if="!app.visibleAuditImages.length" class="empty-block">{{ app.emptyImageEvidenceText }}</div>
            </div>
          </div>
          <aside class="image-preview">
            <template v-if="app.selectedImage">
              <div class="image-preview-head">
                <div>
                  <strong>{{ app.selectedImage.title || app.selectedImage.name }}</strong>
                  <span>{{ app.selectedImage.evidenceType || app.selectedImage.stage }}</span>
                </div>
              </div>
              <div class="evidence-summary-strip">
                <div>
                  <span>证据类型</span>
                  <strong>{{ app.imageEvidenceGroupLabel(app.selectedImage) }}</strong>
                </div>
                <div>
                  <span>所属阶段</span>
                  <strong>{{ app.selectedImage.stage || '未标记' }}</strong>
                </div>
                <div>
                  <span>建议状态</span>
                  <strong>{{ app.imageEvidenceStatus(app.selectedImage) }}</strong>
                </div>
              </div>
              <div v-if="app.selectedImage.leftLabel || app.selectedImage.rightLabel" class="compare-legend">
                <span v-if="app.selectedImage.leftLabel">{{ app.selectedImage.leftLabel }}</span>
                <span v-if="app.selectedImage.rightLabel">{{ app.selectedImage.rightLabel }}</span>
              </div>
              <div class="image-preview-stage">
                <ElImage
                  ref="selectedImagePreview"
                  class="review-main-image"
                  :src="app.artifactUrl(app.selectedImage.path)"
                  :alt="app.selectedImage.name"
                  :preview-src-list="[app.artifactUrl(app.selectedImage.path)]"
                  :initial-index="0"
                  fit="contain"
                  preview-teleported
                />
              </div>
              <div class="image-explanation">
                <section>
                  <h4>这张图说明什么</h4>
                  <p>{{ app.selectedImage.meaning || '任务执行过程中留存的图片证据。' }}</p>
                </section>
                <section>
                  <h4>人工审核重点</h4>
                  <p>{{ app.selectedImage.reviewFocus || '确认图片内容与报告结论一致。' }}</p>
                </section>
                <code class="path-with-copy">
                  <span>{{ app.selectedImage.relativePath }}</span>
                  <button type="button" class="copy-path-button" @click="app.copyText(app.selectedImage.relativePath || app.selectedImage.path, '图片路径')">复制</button>
                </code>
              </div>
              <div class="image-decision">
                <h4>人工结论</h4>
                <ElRadioGroup :model-value="app.imageReviewForm.decision" @update:model-value="value => app.imageReviewForm.decision = value">
                  <ElRadioButton label="passed">通过</ElRadioButton>
                  <ElRadioButton label="failed">有问题</ElRadioButton>
                  <ElRadioButton label="ignored">不适用</ElRadioButton>
                </ElRadioGroup>
                <ElInput
                  :model-value="app.imageReviewForm.comment" @update:model-value="value => app.imageReviewForm.comment = value"
                  type="textarea"
                  :rows="3"
                  placeholder="记录该截图的人工判断、问题位置或忽略理由。"
                />
                <ElButton v-if="app.can('review.image.submit')" type="primary" plain @click="app.submitImageReview">保存</ElButton>
              </div>
              <div class="image-review-records">
                <div class="image-review-records-head">
                  <h4>人工复核记录</h4>
                  <span>{{ app.imageReviewRecordList.length }} 条</span>
                </div>
                <button
                  v-for="record in app.imageReviewRecordList"
                  :key="record.imagePath"
                  type="button"
                  class="image-review-record"
                  @click="app.openImageReviewRecord(record)"
                >
                  <ElTag size="small" :type="app.imageDecisionTagType(record.decision)">{{ app.imageDecisionLabel(record.decision) }}</ElTag>
                  <div>
                    <strong>{{ record.imageTitle }}</strong>
                    <span>{{ app.formatDateTime(record.createdAt) }}</span>
                    <p>{{ record.comment || '未填写备注。' }}</p>
                  </div>
                </button>
                <div v-if="!app.imageReviewRecordList.length" class="empty-block">暂无人工复核记录。</div>
              </div>
            </template>
            <div v-else class="empty-block">选择一张截图查看大图。</div>
          </aside>
        </div>
      </ElTabPane>
    </ElTabs>
  </div>
  <div v-else class="empty-block">请选择一个任务查看结果。</div>
</section>
</template>

<script>
export default {
  name: 'TaskResultView',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>

<style lang="scss">
.task-result-view {
  min-height: 0;

  .task-audit {
    display: grid;
    gap: 16px;
    min-height: 0;
  }

  .task-result-page {
    min-height: 0;
  }

  .audit-hero {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: center;
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--audit-hero-bg);

    h2 {
      margin: 9px 0 6px;
      font-size: 24px;

      .task-title-link {
        color: var(--primary);
        text-decoration: none;

        &:hover {
          text-decoration: underline;
        }
      }
    }

    p {
      margin: 0;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
  }

  .task-meta-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
  }

  .audit-score {
    min-width: 118px;
    text-align: right;

    strong,
    span {
      display: block;
    }

    strong {
      color: var(--heading);
      font-size: 34px;
    }

    span {
      color: var(--muted);
    }
  }

  .audit-tabs {
    min-height: 0;

    .el-tabs__nav-wrap::after {
      background: var(--line);
    }

    .el-tabs__header {
      padding-top: 10px;
    }

    &,
    .el-tabs__content,
    .el-tab-pane {
      min-height: 0;
    }
  }

  .audit-workspace,
  .report-workbench,
  .image-workbench {
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr);
    gap: 14px;
    align-items: stretch;
    min-height: 0;
    overflow: hidden;
  }

  .audit-workspace {
    grid-template-columns: 370px minmax(0, 1fr);
  }

  .image-workbench {
    grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  }

  .stage-rail,
  .artifact-nav {
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--soft-card);
  }

  .audit-workspace {
    .stage-rail,
    .stage-panel {
      min-height: 0;
      overflow: auto;
      max-height: calc(100vh - 320px);
    }
  }

  .audit-stage {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) 108px;
    align-items: start;
    gap: 8px 10px;
    width: 100%;
    padding: 12px 14px 12px 12px;
    border: 0;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;

    &.is-warning {
      --stage-accent: #f59e0b;
      --stage-accent-ink: #92400e;
      --stage-accent-bg: rgba(245, 158, 11, 0.13);
      --stage-accent-border: rgba(245, 158, 11, 0.32);
    }

    &.is-success {
      --stage-accent: var(--primary);
      --stage-accent-ink: var(--primary-ink);
      --stage-accent-bg: rgba(34, 197, 94, 0.1);
      --stage-accent-border: rgba(34, 197, 94, 0.28);
    }

    &.is-danger {
      --stage-accent: var(--danger);
      --stage-accent-ink: #b91c1c;
      --stage-accent-bg: rgba(248, 113, 113, 0.12);
      --stage-accent-border: rgba(248, 113, 113, 0.3);
    }

    &.is-info,
    &.is-primary {
      --stage-accent: var(--accent);
      --stage-accent-ink: var(--accent);
      --stage-accent-bg: rgba(14, 165, 233, 0.1);
      --stage-accent-border: rgba(14, 165, 233, 0.26);
    }

    > span {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--stage-accent-bg, var(--primary-soft));
      color: var(--stage-accent-ink, var(--primary-ink));
      font-weight: 850;
    }

    > div {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    strong {
      min-width: 0;
      color: var(--heading);
      line-height: 1.35;
    }

    small {
      color: var(--muted);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .el-tag {
      display: inline-flex;
      grid-column: 3;
      grid-row: 1 / span 2;
      justify-self: end;
      width: fit-content;
      min-width: max-content;
      max-width: 108px;
      justify-content: center;
      white-space: nowrap;
    }

    &:hover,
    &.active {
      background: transparent;
      box-shadow: inset 3px 0 0 var(--stage-accent, var(--primary));
    }
  }

  .stage-panel,
  .image-preview {
    min-width: 0;
    min-height: 0;
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel-tint);
  }

  .markdown-report {
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }

  .stage-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 15px;
    border-bottom: 1px solid var(--line);

    h3 {
      margin: 5px 0 6px;
      font-size: 22px;
    }

    p {
      margin: 0;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
  }

  .gate-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-top: 14px;
  }

  .gate-item {
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--soft-card-strong);

    &.ok {
      border-color: rgba(34, 197, 94, 0.42);
      background: rgba(34, 197, 94, 0.08);
    }

    &.warn {
      border-color: rgba(245, 158, 11, 0.46);
      background: rgba(245, 158, 11, 0.08);
    }

    span,
    strong {
      display: block;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 780;
    }

    strong {
      margin-top: 6px;
      color: var(--heading);
    }
  }

  .stage-summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    margin-top: 14px;
    padding: 14px;
    border: 1px solid rgba(56, 189, 248, 0.28);
    border-radius: var(--radius);
    background: rgba(56, 189, 248, 0.08);

    h4 {
      margin: 4px 0 8px;
      color: var(--heading);
    }

    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.55;
    }
  }

  .summary-checks {
    display: flex;
    flex-wrap: nowrap;
    justify-content: flex-end;
    gap: 7px;
    max-width: none;
    overflow-x: auto;

    button {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 5px 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font: inherit;
      font-size: 12px;
      font-weight: 780;
      white-space: nowrap;

      &:disabled {
        cursor: default;
      }

      span,
      strong {
        display: inline-flex;
        align-items: center;
      }

      strong {
        padding-left: 7px;
        border-left: 1px solid currentColor;
        font-size: 12px;
      }
    }

    .ok {
      color: var(--primary-ink);
      border-color: rgba(34, 197, 94, 0.42);
      background: rgba(34, 197, 94, 0.08);
    }

    .warn {
      border-color: rgba(217, 119, 6, 0.55);
      background: #f59e0b;
      color: #1f2937;
      box-shadow: 0 6px 14px rgba(245, 158, 11, 0.22);
    }

    .action {
      cursor: pointer;
    }

    .action:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 20px rgba(245, 158, 11, 0.28);
    }

    .failed {
      color: #fecaca;
      border-color: rgba(248, 113, 113, 0.46);
      background: rgba(248, 113, 113, 0.08);
    }

    .critical {
      padding: 7px 11px;
      border-color: #991b1b;
      background: #dc2626;
      color: #ffffff;
      font-size: 13px;
      letter-spacing: 0;
      box-shadow: 0 8px 18px rgba(220, 38, 38, 0.32);
    }
  }

  .stage-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
    margin-top: 18px;

    h4 {
      margin: 4px 0 8px;
      color: var(--heading);
    }
  }

  .audit-section {
    margin-top: 18px;

    h4 {
      margin: 4px 0 8px;
      color: var(--heading);
    }
  }

  .review-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .evidence-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--soft-card);
  }

  .evidence-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;

    strong {
      color: var(--heading);
      font-size: 13px;
    }

    > span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 780;
      white-space: nowrap;
    }
  }

  .evidence-groups {
    display: grid;
    align-content: start;
    gap: 12px;
    flex: 1 1 auto;
    overflow: auto;
    min-height: 0;
    padding-right: 2px;
  }

  .evidence-group {
    display: grid;
    gap: 8px;
  }

  .evidence-group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--heading);
    font-size: 13px;

    span {
      color: var(--muted);
    }
  }

  .evidence-row {
    display: grid;
    grid-template-columns: 74px minmax(0, 1fr);
    gap: 9px;
    align-items: center;
    width: 100%;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--text);
    text-align: left;
    cursor: pointer;

    &.active,
    &:hover {
      border-color: rgba(34, 197, 94, 0.55);
      background: rgba(34, 197, 94, 0.08);
    }

    img {
      display: block;
      width: 74px;
      height: 48px;
      object-fit: cover;
      object-position: top;
      border: 1px solid var(--line);
      border-radius: calc(var(--radius) - 2px);
    }

    .el-tag {
      grid-column: 2;
      justify-self: start;
      max-width: 100%;
    }

    div {
      min-width: 0;
    }

    strong,
    span,
    small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    strong {
      color: var(--heading);
    }

    span {
      margin-top: 3px;
      color: var(--primary-ink);
      font-size: 12px;
      font-weight: 800;
    }

    small {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }
  }

  .image-preview {
    height: 100%;
    min-height: 0;
    overflow: auto;
  }

  .image-preview-head {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: flex-start;
    margin-bottom: 12px;

    strong,
    span {
      display: block;
    }

    span {
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
    }
  }

  .compare-legend {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;

    span {
      padding: 8px;
      border: 1px solid rgba(34, 197, 94, 0.34);
      border-radius: var(--radius);
      background: rgba(34, 197, 94, 0.08);
      color: var(--primary-ink);
      font-size: 12px;
      font-weight: 800;
    }
  }

  .evidence-summary-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 12px;

    > div {
      min-width: 0;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--soft-card);
    }

    span,
    strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 780;
    }

    strong {
      margin-top: 5px;
      color: var(--heading);
    }
  }

  .image-preview-stage {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    width: 100%;
    max-height: min(68vh, 820px);
    overflow: auto;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--empty-bg);
  }

  .review-main-image {
    display: inline-flex;
    justify-content: center;
    width: auto;
    max-width: 100%;
    height: auto;

    img {
      display: block;
      width: auto;
      max-width: 100%;
      height: auto;
      border-radius: var(--radius);
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
    }
  }

  .image-explanation {
    display: grid;
    gap: 10px;
    margin-top: 12px;

    section,
    code {
      display: block;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--soft-card);
    }

    h4 {
      margin: 0;
    }

    p {
      margin: 6px 0 0;
      color: var(--muted);
      line-height: 1.55;
    }
  }

  .image-decision {
    display: grid;
    gap: 10px;
    margin-top: 12px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--soft-card);

    h4 {
      margin: 0;
    }

    .el-radio-group {
      align-self: start;
    }

    .el-textarea__inner {
      min-height: 76px !important;
    }

    .el-button {
      justify-self: start;
    }
  }

  .image-review-records {
    display: grid;
    gap: 8px;
    margin-top: 12px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--soft-card);
  }

  .image-review-records-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;

    h4 {
      margin: 0;
      color: var(--heading);
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 780;
    }
  }

  .image-review-record {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    width: 100%;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--text);
    cursor: pointer;
    text-align: left;

    &:hover {
      border-color: rgba(34, 197, 94, 0.5);
      background: rgba(34, 197, 94, 0.08);
    }

    strong,
    span,
    p {
      display: block;
    }

    strong {
      overflow: hidden;
      color: var(--heading);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
    }

    p {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
  }

  .manual-flow-panel {
    display: grid;
    gap: 12px;

    > .empty-block {
      padding: 12px 14px;
    }
  }

  .manual-flow-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;

    h3,
    p {
      margin: 0;
    }

    p {
      margin-top: 4px;
      color: var(--muted);
    }
  }

  .manual-flow-summary,
  .manual-flow-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .manual-flow-summary > div,
  .manual-flow-grid > section,
  .manual-flow-issues {
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel-soft);
  }

  .manual-flow-summary span,
  .manual-flow-summary strong {
    display: block;
  }

  .manual-flow-summary span {
    color: var(--muted);
    font-size: 12px;
  }

  .manual-flow-summary strong {
    margin-top: 6px;
    color: var(--heading);
  }

  .manual-flow-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));

    h4,
    p {
      margin: 0;
    }

    p {
      margin-top: 8px;
      color: var(--text);
      white-space: pre-wrap;
      line-height: 1.55;
    }
  }

  .manual-flow-issues {
    h4,
    p {
      margin: 0;
    }

    p {
      margin-top: 8px;
      white-space: pre-wrap;
      line-height: 1.55;
    }
  }

  @media (max-width: 1180px) {
    .image-workbench {
      grid-template-columns: 1fr;
      height: auto;
      max-height: none;
      overflow: visible;
    }

    .evidence-panel {
      max-height: 520px;
    }

    .image-preview {
      max-height: none;
      overflow: visible;
    }

    .manual-flow-summary,
    .manual-flow-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
