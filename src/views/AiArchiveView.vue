<template>
<section v-show="app.activeView === 'ai-archive'" class="view-grid ai-archive-view">
  <ElCard shadow="never" class="panel-card page-card">
    <template #header>
      <div class="panel-head">
        <div class="ai-archive-head-copy">
          <h3>AI档案</h3>
          <div class="ai-archive-head-meta">
            <p>累计归档任务 {{ app.archiveMetrics.totalArchivedRuns || 0 }} 条，删除明细不回退产物调用次数。</p>
          </div>
        </div>
        <label class="ai-archive-search-field">
          <span>关键词</span>
          <ElInput v-model="app.aiExecutionArchiveFilters.keyword" clearable placeholder="执行内容、Skill/md、Figma 链接、执行人" />
        </label>
      </div>
    </template>

    <div class="ai-archive-summary-strip" aria-label="AI档案汇总筛选">
      <button
        v-for="metric in app.aiExecutionArchiveSummaryMetrics"
        :key="metric.label"
        type="button"
        :class="['ai-archive-summary-item', metric.tone, { active: app.isAiExecutionArchiveMetricActive(metric) }]"
        @click="app.applyAiExecutionArchiveBucket(metric)"
      >
        <span>{{ metric.label }}</span>
        <strong>{{ metric.value }}</strong>
        <small>{{ metric.hint }}</small>
      </button>
    </div>
    <p class="ai-archive-summary-hint">点击上方任一归档区域，下面列表会只显示对应记录；再次点击“归档任务”可回到当前筛选范围全部记录。</p>

    <div class="ai-archive-filters">
      <label class="ai-archive-filter-field">
        <span>执行人 / 操作人</span>
        <ElSelect v-model="app.aiExecutionArchiveFilters.userId" clearable filterable placeholder="全部人员">
          <ElOption v-for="user in app.users" :key="user.id" :label="user.displayName || user.username" :value="user.id" />
        </ElSelect>
      </label>
      <label class="ai-archive-filter-field">
        <span>类型</span>
        <ElSelect v-model="app.aiExecutionArchiveFilters.sourceType" clearable placeholder="全部类型">
          <ElOption label="直接执行" value="direct-skill" />
          <ElOption label="独立执行" value="standalone" />
          <ElOption label="任务执行" value="task" />
          <ElOption label="Bug 执行" value="bug" />
        </ElSelect>
      </label>
      <label class="ai-archive-filter-field">
        <span>状态</span>
        <ElSelect v-model="app.aiExecutionArchiveFilters.status" clearable placeholder="全部状态">
          <ElOption label="待领取" value="pending" />
          <ElOption label="已领取" value="claimed" />
          <ElOption label="执行中" value="running" />
          <ElOption label="已完成" value="completed" />
          <ElOption label="失败" value="failed" />
          <ElOption label="阻塞" value="blocked" />
          <ElOption label="已取消" value="cancelled" />
        </ElSelect>
      </label>
      <label class="ai-archive-filter-field">
        <span>开始时间</span>
        <ElDatePicker v-model="app.aiExecutionArchiveFilters.from" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="不限" />
      </label>
      <label class="ai-archive-filter-field">
        <span>结束时间</span>
        <ElDatePicker v-model="app.aiExecutionArchiveFilters.to" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="不限" />
      </label>
      <div class="ai-archive-filter-actions">
        <ElButton plain @click="app.resetAiExecutionArchiveFilters">重置</ElButton>
        <ElButton v-if="app.can('api.aiArchive.delete')" type="danger" plain :loading="app.loading.runs" @click="app.deleteAiExecutionArchiveRunsByCurrentFilters">删除当前范围</ElButton>
      </div>
    </div>
    <div v-if="app.aiExecutionArchiveProjectFilterName" class="ai-archive-source-filter-note">
      <span>当前只显示来源「{{ app.aiExecutionArchiveProjectFilterName }}」保留的执行记录。</span>
      <ElButton link type="primary" @click="app.resetAiExecutionArchiveFilters">查看全部档案</ElButton>
    </div>

    <ElTable class="skill-clean-table ai-archive-table" :data="app.aiExecutionArchivePagedRunRows" table-layout="fixed" empty-text="暂无 AI 执行档案" v-loading="app.loading.runs">
      <ElTableColumn label="执行内容" min-width="250">
        <template #default="{ row }">
          <button type="button" class="ai-archive-run-title" :disabled="!app.canViewAiArchiveDetail" @click="app.openAiExecutionArchiveDetail(row)">
            <strong>{{ app.directSkillRunContentName(row) }}</strong>
          </button>
        </template>
      </ElTableColumn>
      <ElTableColumn label="类型" width="96">
        <template #default="{ row }">{{ app.directSkillRunContentKind(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="操作人" width="110">
        <template #default="{ row }">{{ app.directSkillRunOperatorName(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="执行人" width="110">
        <template #default="{ row }">{{ app.directSkillRunExecutorName(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="150">
        <template #default="{ row }">
          <div class="ai-archive-status-row">
            <ElTag size="small" :type="app.runTagType(app.effectiveResultStatus(row))">{{ app.directSkillRunStatusLabel(row) || app.runStatusLabel(app.runDisplayStatusValue(row)) }}</ElTag>
            <ElTag v-if="app.isRunSourceDeleted(row)" size="small" type="warning">来源已删除</ElTag>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="Figma 链接" width="110">
        <template #default="{ row }">
          <a v-if="row.figmaLinks && app.canViewAiArchiveLinks" :href="row.figmaLinks" target="_blank" rel="noopener noreferrer">打开 Figma</a>
          <span v-else-if="row.figmaLinks">打开 Figma</span>
          <span v-else>-</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="创建时间" width="190">
        <template #default="{ row }">{{ app.formatDateTime(row.createdAt) || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="更新时间" width="190">
        <template #default="{ row }">{{ app.directSkillRunUpdatedText(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="96" fixed="right" align="right">
        <template #default="{ row }">
          <ElButton link type="primary" :disabled="!app.canViewAiArchiveDetail" @click="app.openAiExecutionArchiveDetail(row)">明细</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>
    <div class="ai-archive-pagination">
      <ElPagination
        v-model:current-page="app.aiExecutionArchivePage"
        v-model:page-size="app.aiExecutionArchivePageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="app.aiExecutionArchiveRunRows.length"
        layout="total, sizes, prev, pager, next"
      />
    </div>
  </ElCard>

  <ElDrawer
    v-model="app.aiExecutionArchiveDetail.visible"
    title="执行明细"
    direction="rtl"
    size="50%"
    class="app-dialog ai-archive-detail-drawer"
    append-to-body
    @closed="app.closeAiExecutionArchiveDetail"
  >
    <div v-if="app.aiExecutionArchiveDetailRun" class="ai-archive-detail">
      <header class="ai-archive-detail-head">
        <div>
          <span>{{ app.directSkillRunContentKind(app.aiExecutionArchiveDetailRun) }}</span>
          <h3>{{ app.directSkillRunContentName(app.aiExecutionArchiveDetailRun) }}</h3>
        </div>
        <ElTag :type="app.runTagType(app.effectiveResultStatus(app.aiExecutionArchiveDetailRun))">
          {{ app.resultStatusLabel(app.effectiveResultStatus(app.aiExecutionArchiveDetailRun)) }}
        </ElTag>
      </header>

      <div class="ai-archive-detail-metrics">
        <div v-for="metric in app.aiExecutionArchiveDetailStats.summaryCards" :key="metric.label" :class="['ai-archive-detail-metric', metric.tone]">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
          <small>{{ metric.hint }}</small>
        </div>
      </div>

      <section class="ai-archive-detail-section">
        <h4>交付结论</h4>
        <strong>{{ app.aiExecutionArchiveDetailStats.resultTitle }}</strong>
        <p>{{ app.aiExecutionArchiveDetailStats.resultText }}</p>
        <p class="ai-archive-next-action">{{ app.aiExecutionArchiveDetailStats.nextAction }}</p>
      </section>

      <section class="ai-archive-detail-section">
        <h4>执行对象</h4>
        <div class="ai-archive-detail-grid">
          <div v-for="item in app.aiExecutionArchiveDetailStats.targetRows" :key="item.label">
            <span>{{ item.label }}</span>
            <a v-if="item.href && app.canViewAiArchiveLinks" :href="item.href" target="_blank" rel="noopener noreferrer">{{ item.value }}</a>
            <strong v-else-if="item.href">{{ item.value }}</strong>
            <strong v-else>{{ item.value }}</strong>
          </div>
        </div>
      </section>

      <section class="ai-archive-detail-section">
        <h4>给 Codex 的执行要求</h4>
        <div v-if="app.aiExecutionArchiveDetailStats.requirementText" class="ai-archive-requirement-text">
          {{ app.aiExecutionArchiveDetailStats.requirementText }}
        </div>
        <p v-else>创建任务时未填写额外执行要求。</p>
      </section>

      <section class="ai-archive-detail-section">
        <h4>执行环境</h4>
        <div class="ai-archive-detail-grid">
          <div v-for="item in app.aiExecutionArchiveDetailStats.environmentRows" :key="item.label">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </section>

      <section class="ai-archive-detail-section">
        <h4>问题与待处理</h4>
        <div class="ai-archive-issue-list">
          <div v-for="item in app.aiExecutionArchiveDetailStats.issueRows" :key="item.label" :class="item.tone">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </section>

      <section class="ai-archive-detail-section">
        <h4>本次检查了什么</h4>
        <div class="ai-archive-evidence-grid">
          <div>
            <span>具体数据类</span>
            <strong v-for="item in app.aiExecutionArchiveDetailStats.dataRows" :key="item.label">{{ item.label }}：{{ item.value }}</strong>
          </div>
          <div>
            <span>阶段扫描点</span>
            <div v-if="app.aiExecutionArchiveDetailStats.stageRows.length" class="ai-archive-stage-list">
              <div v-for="stage in app.aiExecutionArchiveDetailStats.stageRows" :key="stage.key">
                <strong>{{ stage.name }}</strong>
                <ElTag size="small" :type="stage.type">{{ stage.label }}</ElTag>
              </div>
            </div>
            <small v-else>暂无阶段记录。</small>
          </div>
          <div>
            <span>验证命令</span>
            <code v-for="item in app.aiExecutionArchiveDetailStats.validationRows" :key="item.key">{{ item.value }}</code>
            <small v-if="!app.aiExecutionArchiveDetailStats.validationRows.length">暂无验证命令。</small>
          </div>
        </div>
      </section>

      <section class="ai-archive-detail-section">
        <h4>产物与证据</h4>
        <div class="ai-archive-evidence-grid two-columns">
          <div>
            <span>文件变更</span>
            <strong v-for="item in app.aiExecutionArchiveDetailStats.changeRows.slice(0, 12)" :key="item.key">{{ item.path }}</strong>
            <small v-if="app.aiExecutionArchiveDetailStats.changeRows.length > 12">另有 {{ app.aiExecutionArchiveDetailStats.changeRows.length - 12 }} 个变更点未展开。</small>
            <small v-if="!app.aiExecutionArchiveDetailStats.changeRows.length">暂无文件变更。</small>
          </div>
          <div>
            <span>产物证据</span>
            <strong v-for="item in app.aiExecutionArchiveDetailStats.artifactRows.slice(0, 12)" :key="item.key">{{ item.value }}</strong>
            <small v-if="app.aiExecutionArchiveDetailStats.artifactRows.length > 12">另有 {{ app.aiExecutionArchiveDetailStats.artifactRows.length - 12 }} 个证据未展开。</small>
            <small v-if="!app.aiExecutionArchiveDetailStats.artifactRows.length">暂无产物证据。</small>
          </div>
        </div>
      </section>

      <details
        v-if="app.runInputAttachments(app.aiExecutionArchiveDetailRun).length"
        :key="`archive-input-attachments-${app.aiExecutionArchiveDetailRun?.id || 'run'}`"
        class="ai-archive-detail-section ai-archive-input-attachment-section"
      >
        <summary class="ai-archive-input-attachment-summary">
          <h4>本次输入附件</h4>
          <span :data-count="`${app.runInputAttachments(app.aiExecutionArchiveDetailRun).length} 张参考图 / 修改说明截图`">{{ app.runInputAttachments(app.aiExecutionArchiveDetailRun).length }} 张参考图 / 修改说明截图 · 点击展开</span>
        </summary>
        <div class="ai-archive-generated-image-grid ai-archive-input-attachment-grid">
          <article
            v-for="image in app.runInputAttachments(app.aiExecutionArchiveDetailRun)"
            :key="image.path"
            class="ai-archive-generated-image-card"
          >
            <a
              class="ai-archive-generated-image-thumb"
              :href="app.canDownloadRunArtifacts ? image.url : undefined"
              :target="app.canDownloadRunArtifacts ? '_blank' : undefined"
              :rel="app.canDownloadRunArtifacts ? 'noopener noreferrer' : undefined"
            >
              <img :src="image.url" :alt="image.name" loading="lazy" />
            </a>
            <div class="ai-archive-generated-image-meta">
              <strong :title="image.name">{{ image.name }}</strong>
              <span>{{ image.size ? app.formatBytes(image.size) : '已保存' }}</span>
            </div>
            <div class="ai-archive-generated-image-actions">
              <ElButton
                size="small"
                plain
                :disabled="!app.canDownloadRunArtifacts"
                :tag="app.canDownloadRunArtifacts ? 'a' : 'button'"
                :href="app.canDownloadRunArtifacts ? image.url : undefined"
                target="_blank"
                rel="noopener noreferrer"
              >
                打开
              </ElButton>
              <ElButton
                size="small"
                type="primary"
                plain
                :disabled="!app.canDownloadRunArtifacts"
                :tag="app.canDownloadRunArtifacts ? 'a' : 'button'"
                :href="app.canDownloadRunArtifacts ? image.downloadUrl : undefined"
              >
                下载
              </ElButton>
            </div>
          </article>
        </div>
      </details>

      <section
        v-if="app.isNoFigmaImageGenerationRun(app.aiExecutionArchiveDetailRun) || app.runGeneratedImageArtifacts(app.aiExecutionArchiveDetailRun).length"
        class="ai-archive-detail-section"
      >
        <h4>生成图片产物</h4>
        <div v-if="app.runGeneratedImageArtifacts(app.aiExecutionArchiveDetailRun).length" class="ai-archive-generated-image-grid">
          <article
            v-for="image in app.runGeneratedImageArtifacts(app.aiExecutionArchiveDetailRun)"
            :key="image.path"
            class="ai-archive-generated-image-card"
          >
            <a
              class="ai-archive-generated-image-thumb"
              :href="app.canDownloadRunArtifacts ? image.url : undefined"
              :target="app.canDownloadRunArtifacts ? '_blank' : undefined"
              :rel="app.canDownloadRunArtifacts ? 'noopener noreferrer' : undefined"
            >
              <img :src="image.url" :alt="image.name" loading="lazy" />
            </a>
            <div class="ai-archive-generated-image-meta">
              <strong :title="image.name">{{ image.name }}</strong>
              <span>{{ image.size ? app.formatBytes(image.size) : '已归档' }}</span>
            </div>
            <div class="ai-archive-generated-image-actions">
              <ElButton
                size="small"
                plain
                :disabled="!app.canDownloadRunArtifacts"
                :tag="app.canDownloadRunArtifacts ? 'a' : 'button'"
                :href="app.canDownloadRunArtifacts ? image.url : undefined"
                target="_blank"
                rel="noopener noreferrer"
              >
                打开
              </ElButton>
              <ElButton
                size="small"
                type="primary"
                plain
                :disabled="!app.canDownloadRunArtifacts"
                :tag="app.canDownloadRunArtifacts ? 'a' : 'button'"
                :href="app.canDownloadRunArtifacts ? image.downloadUrl : undefined"
              >
                下载
              </ElButton>
            </div>
          </article>
        </div>
        <div v-else class="ai-archive-generated-image-empty">
          <strong>未检测到可下载成图。</strong>
          <span>无 Figma 链接的纯生图任务会在这里展示成品图；如果这里为空，说明本次执行没有把最终成品图归档到“生成图片/”或“outputs/”目录。</span>
        </div>
      </section>
    </div>
  </ElDrawer>
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

<style scoped lang="scss">
.ai-archive-view {
  grid-template-columns: minmax(0, 1fr);
}

.ai-archive-head-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.ai-archive-head-meta {
  min-width: 0;

  p {
    margin: 0;
    min-width: 0;
  }
}

.ai-archive-filters {
  display: grid;
  grid-template-columns: repeat(5, minmax(150px, 1fr)) auto;
  gap: 12px;
  align-items: end;
  padding: 14px;
}

.ai-archive-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 14px 14px 12px;
}

.ai-archive-summary-item {
  position: relative;
  display: grid;
  gap: 4px;
  min-width: 0;
  min-height: 92px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-soft);
  box-shadow: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
  appearance: none;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;

  &::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    border-radius: 8px 0 0 8px;
    background: var(--accent);
    opacity: 0.55;
  }

  &:hover,
  &.active {
    border-color: var(--accent);
    background: var(--panel);
    transform: translateY(-1px);
  }

  &.closed::before {
    background: var(--primary);
  }

  &.rework::before {
    background: var(--danger);
  }

  &.review::before {
    background: var(--warn);
  }

  span,
  small {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }

  strong {
    color: var(--text);
    font-size: 28px;
    line-height: 1.1;
  }

  &.active strong {
    color: var(--accent);
  }
}

.ai-archive-summary-hint {
  margin: 0;
  padding: 0 14px 2px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.ai-archive-search-field {
  display: grid;
  gap: 6px;
  width: min(420px, 34vw);
  min-width: 280px;

  span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }
}

.ai-archive-filter-field {
  display: grid;
  gap: 6px;
  min-width: 0;

  span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }
}

.ai-archive-filter-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ai-archive-source-filter-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 14px 12px;
  padding: 10px 12px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.08);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
}

.ai-archive-status-row {
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  min-width: 0;
}

.ai-archive-run-title {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
  cursor: pointer;
  appearance: none;
  text-align: left;

  strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.ai-archive-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 14px;
}

.ai-archive-detail {
  display: grid;
  gap: 20px;
  color: var(--text);
}

.ai-archive-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;

  div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }

  h3 {
    margin: 0;
    color: var(--text);
    font-size: 22px;
    line-height: 1.25;
  }
}

.ai-archive-detail-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.ai-archive-detail-metric {
  display: grid;
  gap: 4px;
  min-width: 0;

  span,
  small {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }

  strong {
    color: var(--text);
    font-size: 26px;
    line-height: 1.1;
  }

  &.success strong {
    color: var(--primary);
  }

  &.danger strong {
    color: var(--danger);
  }

  &.warning strong {
    color: var(--warn);
  }
}

.ai-archive-detail-section {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding-top: 16px;
  border-top: 1px solid var(--line);

  h4,
  p {
    margin: 0;
  }

  h4 {
    color: var(--text);
    font-size: 14px;
  }

  > strong {
    color: var(--text);
    font-size: 15px;
  }

  p {
    color: var(--muted);
    line-height: 1.7;
  }
}

.ai-archive-next-action {
  color: var(--text) !important;
}

.ai-archive-requirement-text {
  max-height: 260px;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--soft-card);
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.ai-archive-detail-grid,
.ai-archive-data-list,
.ai-archive-stage-list,
.ai-archive-issue-list {
  display: grid;
  gap: 10px;
}

.ai-archive-detail-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.ai-archive-detail-grid > div,
.ai-archive-data-list > div,
.ai-archive-stage-list > div,
.ai-archive-issue-list > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.ai-archive-stage-list > div {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.ai-archive-detail-grid span,
.ai-archive-data-list span,
.ai-archive-stage-list span,
.ai-archive-issue-list span,
.ai-archive-evidence-grid span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.ai-archive-detail-grid strong,
.ai-archive-data-list strong,
.ai-archive-stage-list strong,
.ai-archive-issue-list strong,
.ai-archive-evidence-grid strong,
.ai-archive-detail-grid a {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
}

.ai-archive-issue-list > div {
  padding-left: 10px;
  border-left: 3px solid var(--line);

  &.danger {
    border-left-color: var(--danger);
  }

  &.warning {
    border-left-color: var(--warn);
  }
}

.ai-archive-evidence-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;

  > div {
    display: grid;
    align-content: start;
    gap: 8px;
    min-width: 0;
  }

  code {
    overflow-wrap: anywhere;
    white-space: normal;
  }

  small {
    color: var(--muted);
    font-size: 12px;
  }

  &.two-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.ai-archive-generated-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.ai-archive-input-attachment-section {
  &[open] .ai-archive-input-attachment-summary span {
    font-size: 0;
  }

  &[open] .ai-archive-input-attachment-summary span::before,
  &[open] .ai-archive-input-attachment-summary span::after {
    font-size: 12px;
  }

  &[open] .ai-archive-input-attachment-summary span::before {
    content: attr(data-count);
  }

  &[open] .ai-archive-input-attachment-summary span::after {
    content: ' · 点击收起';
  }
}

.ai-archive-input-attachment-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  list-style: none;
  cursor: pointer;

  &::-webkit-details-marker {
    display: none;
  }

  h4 {
    margin: 0;
  }

  span {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.ai-archive-input-attachment-grid .ai-archive-generated-image-thumb {
  background: #f8fafc;
}

.ai-archive-generated-image-empty {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px dashed rgba(20, 184, 166, 0.32);
  border-radius: 8px;
  background: rgba(240, 253, 250, 0.54);

  strong {
    color: var(--text);
    font-size: 13px;
  }

  span {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.7;
  }
}

.ai-archive-generated-image-card {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}

.ai-archive-generated-image-thumb {
  display: block;
  aspect-ratio: 1 / 1;
  background: #0f172a;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

.ai-archive-generated-image-meta {
  display: grid;
  gap: 2px;
  padding: 10px 10px 0;

  strong {
    overflow: hidden;
    color: var(--text);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--muted);
    font-size: 12px;
  }
}

.ai-archive-generated-image-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px;
}

.ai-archive-empty {
  color: var(--muted);
}

@media (max-width: 1200px) {
  .ai-archive-search-field {
    width: min(360px, 42vw);
    min-width: 220px;
  }

  .ai-archive-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ai-archive-summary-strip,
  .ai-archive-detail-metrics,
  .ai-archive-evidence-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .ai-archive-search-field {
    width: 100%;
    min-width: 0;
  }

  .ai-archive-filters {
    grid-template-columns: 1fr;
  }

  .ai-archive-summary-strip,
  .ai-archive-detail-metrics,
  .ai-archive-detail-grid,
  .ai-archive-evidence-grid {
    grid-template-columns: 1fr;
  }

  .ai-archive-pagination {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
