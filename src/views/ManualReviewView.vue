<template>
<section v-show="app.activeView === 'manual-review'" class="view-grid manual-review-view">
  <ElBreadcrumb class="nav-crumbs" separator="/">
    <ElBreadcrumbItem>
      <button type="button" @click="app.goAiArchive">AI 档案</button>
    </ElBreadcrumbItem>
    <ElBreadcrumbItem>
      <button type="button" @click="app.goTaskResult">执行详情</button>
    </ElBreadcrumbItem>
    <ElBreadcrumbItem>人工复核</ElBreadcrumbItem>
  </ElBreadcrumb>

  <div v-if="app.selectedTask" class="manual-review-page">
    <section class="review-hero">
      <div>
        <ElTag :type="app.selectedReviewItem?.status === 'ready' ? 'success' : 'warning'">
          {{ app.selectedReviewItem?.status === 'ready' ? '材料已具备' : '待人工复核' }}
        </ElTag>
        <h2>{{ app.selectedReviewItem?.label || '人工复核' }}</h2>
        <p>{{ app.selectedTask.name }} · {{ app.selectedStage?.name || '未选择阶段' }}</p>
      </div>
      <div class="audit-score">
        <strong>{{ app.selectedReviewPercent }}%</strong>
        <span>复核置信度</span>
      </div>
    </section>

    <div class="manual-review-grid">
      <ElCard shadow="never" class="manual-review-card">
        <template #header>
          <div class="panel-head">
            <div>
              <h3>复核说明</h3>
              <p>{{ app.selectedReviewItem?.detail || app.selectedStageSummary.description }}</p>
            </div>
          </div>
        </template>
        <div class="review-facts">
          <div>
            <span>任务路径</span>
            <strong class="path-with-copy">
              <span>{{ app.selectedTask.path }}</span>
              <button type="button" class="copy-path-button" @click="app.copyText(app.selectedTask.path, '任务路径')">复制</button>
            </strong>
          </div>
          <div>
            <span>复核阶段</span>
            <strong>{{ app.selectedStage?.name || '-' }}</strong>
          </div>
          <div>
            <span>阶段状态</span>
            <strong>{{ app.selectedStage?.status || '-' }}</strong>
          </div>
          <div>
            <span>触发原因</span>
            <strong>{{ app.selectedReviewReason }}</strong>
          </div>
        </div>

        <div class="review-decision">
          <div class="review-outcome">
            <h4>复核会改变什么</h4>
            <strong>{{ app.manualReviewOutcome.title }}</strong>
            <p>{{ app.manualReviewOutcome.description }}</p>
          </div>
          <h4>复核结论</h4>
          <ElRadioGroup :model-value="app.manualReviewForm.decision" @update:model-value="value => app.manualReviewForm.decision = value">
            <ElRadioButton label="approved">通过复核</ElRadioButton>
            <ElRadioButton label="rejected">驳回补充</ElRadioButton>
            <ElRadioButton label="accepted_risk">风险接受</ElRadioButton>
          </ElRadioGroup>
          <div class="review-score-field">
            <span>人工评分</span>
            <ElInputNumber
              :model-value="app.manualReviewForm.score"
              @update:model-value="value => app.manualReviewForm.score = value"
              :min="0"
              :max="100"
              :step="5"
            />
          </div>
          <ElInput
            :model-value="app.manualReviewForm.comment" @update:model-value="value => app.manualReviewForm.comment = value"
            type="textarea"
            :rows="5"
            placeholder="必须填写：说明为什么通过、需要补什么证据，或为什么接受该风险。"
          />
          <ElButton v-if="app.can('review.submit')" type="primary" @click="app.submitManualReview">提交并更新任务验收状态</ElButton>
        </div>
        <div class="manual-review-records">
          <div class="manual-review-records-head">
            <h4>复核记录</h4>
            <span>{{ app.currentReviewRecords.length }} 条</span>
          </div>
          <div class="manual-record-list">
            <button
              v-for="record in app.currentReviewRecords"
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
            <div v-if="!app.currentReviewRecords.length" class="empty-block">提交复核后会在这里显示记录。</div>
          </div>
        </div>
      </ElCard>

      <ElCard shadow="never" class="manual-review-card">
        <template #header>
          <div class="panel-head">
            <div>
              <h3>证据与风险</h3>
              <p>关联当前阶段的报告、截图和 P0/P1/P2 风险。</p>
            </div>
          </div>
        </template>

        <div class="review-evidence-list">
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
            <div v-if="!app.selectedStageReports.length" class="empty-block">没有匹配到阶段报告。</div>
          </section>

          <section>
            <h4>图片证据</h4>
            <button v-for="image in app.selectedStageImages.slice(0, 4)" :key="image.path" class="image-thumb" @click="app.openAuditImage(image)">
              <img :src="app.artifactUrl(image.path)" :alt="image.name" />
              <span>{{ image.title || image.name }}</span>
              <small>{{ image.reviewFocus || image.relativePath }}</small>
            </button>
            <div v-if="!app.selectedStageImages.length" class="empty-block">没有匹配到图片证据。</div>
          </section>

          <section>
            <h4>风险项</h4>
            <div class="issue-list">
              <div v-for="issue in app.selectedStageIssues" :key="issue.issue" class="issue-item">
                <ElTag :type="/P0|P1/.test(issue.priority) ? 'danger' : 'warning'">{{ issue.priority }}</ElTag>
                <div>
                  <strong>{{ issue.issue }}</strong>
                  <p>建议：{{ issue.suggestion }}</p>
                </div>
              </div>
              <div v-if="!app.selectedStageIssues.length" class="empty-block">当前阶段未解析到高优风险项。</div>
            </div>
          </section>
        </div>
      </ElCard>
    </div>
  </div>
  <div v-else class="empty-block">请选择一个任务后进入人工复核。</div>
</section>
</template>

<script>
export default {
  name: 'ManualReviewView',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>

<style lang="scss">
.manual-review-view {
  .manual-review-page {
    display: grid;
    gap: 16px;
  }

  .review-hero {
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
      color: var(--heading);
      font-size: 24px;
    }

    p {
      margin: 0;
      color: var(--muted);
    }
  }

  .manual-review-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.95fr) minmax(420px, 1.05fr);
    gap: 16px;
    align-items: start;
  }

  .manual-review-card .el-card__body {
    display: grid;
    gap: 16px;
    padding: 18px;
  }

  .review-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;

    > div {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--soft-card);
    }

    span,
    strong {
      display: block;
    }

    span {
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 780;
    }

    strong {
      overflow-wrap: anywhere;
      color: var(--heading);
    }
  }

  .review-decision,
  .review-evidence-list {
    display: grid;
    gap: 12px;

    h4 {
      margin: 0 0 4px;
      color: var(--heading);
    }
  }

  .review-outcome {
    display: grid;
    gap: 6px;
    padding: 12px;
    border: 1px solid rgba(14, 165, 233, 0.28);
    border-radius: var(--radius);
    background: rgba(14, 165, 233, 0.08);

    h4,
    p {
      margin: 0;
    }

    strong {
      color: var(--heading);
    }

    p {
      color: var(--muted);
      line-height: 1.5;
    }
  }

  .review-score-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--soft-card);

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 780;
    }
  }

  .manual-review-records {
    display: grid;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }

  .manual-review-records-head {
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

  .manual-record-list {
    display: grid;
    gap: 8px;
  }
}
</style>
