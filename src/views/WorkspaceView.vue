<template>
<section v-show="app.activeView === 'workspace'" class="view-grid workspace-view">
  <div class="metric-grid workspace-metrics">
    <ElCard v-for="metric in app.workspaceMetrics" :key="metric.label" shadow="never" class="metric-card">
      <span>{{ metric.label }}</span>
      <strong>{{ metric.value }}</strong>
      <small>{{ metric.hint }}</small>
    </ElCard>
  </div>

  <ElCard shadow="never" class="panel-card analytics-panel">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>美术任务总控</h3>
          <p>{{ app.loading.projects || app.loading.scan ? '正在索引全部资料库，请稍候。' : '基于美术任务、Skill、报告和交付证据汇总。' }}</p>
        </div>
      </div>
    </template>

    <div class="analytics-grid">
      <section class="analytics-section">
        <div class="analytics-title">
          <strong>资料库状态分布</strong>
          <span>{{ app.projectRows.length }} 个资料库</span>
        </div>
        <div class="health-chart">
          <div class="health-donut" :style="{ background: app.healthDonutGradient }">
            <div class="health-donut-value">
              <strong>{{ app.projectHealthSummary.schedulable }}</strong>
              <span>已接入</span>
            </div>
          </div>
          <div class="health-legend">
            <div v-for="item in app.projectHealthDistribution" :key="item.key">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </div>
      </section>

      <section class="analytics-section">
        <div class="analytics-title">
          <strong>接入规则漏斗</strong>
          <span>{{ app.onboardingFunnel[0]?.value || 0 }} 个注册</span>
        </div>
        <div class="funnel-list">
          <div v-for="item in app.onboardingFunnel" :key="item.label" class="funnel-row">
            <div class="funnel-head">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
            <div class="funnel-track">
              <i :style="{ width: `${item.percent}%` }"></i>
            </div>
          </div>
        </div>
      </section>

      <section class="analytics-section">
        <div class="analytics-title">
          <strong>风险资料库排行</strong>
          <span>前 {{ app.riskProjectRank.length }} 个</span>
        </div>
        <div class="risk-rank-list">
          <button v-for="item in app.riskProjectRank" :key="item.id" class="risk-rank-row" @click="app.openProjectDetail(item.project)">
            <div>
              <strong>{{ item.name }}</strong>
              <span>{{ item.reason }}</span>
            </div>
            <small>{{ item.completion }}% · {{ item.taskCount }} 任务</small>
            <ElTag size="small" :type="item.tagType">{{ item.riskScore }}</ElTag>
          </button>
          <div v-if="!app.riskProjectRank.length" class="empty-block">暂无风险资料库。</div>
        </div>
      </section>
    </div>
  </ElCard>

  <div class="workspace-layout workspace-support-grid">
    <ElCard shadow="never" class="panel-card chart-card">
      <template #header>
        <div class="panel-head">
          <div>
            <h3>美术任务资产分布</h3>
            <p>按资料库展示任务、报告和证据数量。</p>
          </div>
        </div>
      </template>
      <div class="workload-list">
        <div v-for="item in app.projectWorkloadChart" :key="item.id" class="workload-row">
          <div class="workload-title">
            <div>
              <strong>{{ item.name }}</strong>
              <span>{{ item.tasks }} 任务 · {{ item.reports }} 报告 · {{ item.evidence }} 证据</span>
            </div>
            <b>{{ item.total }} 项</b>
          </div>
          <div class="workload-legend">
            <span><i class="task"></i>任务</span>
            <span><i class="report"></i>报告</span>
            <span><i class="evidence"></i>证据</span>
          </div>
          <div class="workload-track">
            <i class="task" :style="{ width: `${item.taskPercent}%` }"></i>
            <i class="report" :style="{ width: `${item.reportPercent}%` }"></i>
            <i class="evidence" :style="{ width: `${item.evidencePercent}%` }"></i>
          </div>
        </div>
        <div v-if="!app.projectWorkloadChart.length" class="empty-block">暂无美术任务资产数据。</div>
      </div>
    </ElCard>

    <ElCard shadow="never" class="panel-card chart-card">
      <template #header>
        <div class="panel-head">
          <div>
            <h3>{{ app.isPlatformAdmin ? '待负责人处理' : '待处理任务' }}</h3>
            <p>跨资料库展示阻塞、有条件或证据不足的美术任务。</p>
          </div>
        </div>
      </template>
      <div class="pending-task-list">
        <button v-for="task in app.pendingTaskList" :key="task.path" class="pending-task-row" @click="app.openTaskFromRow(task)">
          <div>
            <a v-if="app.zentaoTaskUrl(task)" :href="app.zentaoTaskUrl(task)" target="_blank" rel="noopener noreferrer" class="task-title-link" @click.stop>{{ task.name }}</a>
            <strong v-else>{{ task.name }}</strong>
            <span>{{ task.projectName }} · {{ task.reportCount }} 报告 · {{ task.evidenceCount }} 证据</span>
          </div>
          <small>{{ task.completion }}%</small>
          <ElTag size="small" :type="app.statusTagType(task.status)">{{ app.statusLabel(task.status) }}</ElTag>
        </button>
        <div v-if="!app.pendingTaskList.length" class="empty-block">{{ app.isPlatformAdmin ? '暂无待负责人处理任务。' : '暂无待处理任务。' }}</div>
      </div>
    </ElCard>
  </div>

</section>
</template>

<script>
export default {
  name: 'WorkspaceView',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>

<style lang="scss">
.workspace-view {
  .analytics-grid {
    display: grid;
    grid-template-columns: minmax(320px, 1.08fr) minmax(260px, 0.96fr) minmax(260px, 0.96fr);
    align-items: stretch;
  }

  .analytics-panel {
    .el-card__header {
      padding: 14px 18px 12px;
    }

    .el-card__body {
      padding: 0;
    }
  }

  .analytics-section {
    min-width: 0;
    padding: 14px 18px 16px;
    border-right: 1px solid var(--line);

    &:last-child {
      border-right: 0;
    }
  }

  .analytics-title {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    margin-bottom: 12px;

    strong {
      color: var(--heading);
      font-size: 14px;
      font-weight: 850;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
    }
  }

  .health-chart {
    display: grid;
    grid-template-columns: 128px minmax(0, 1fr);
    align-items: center;
    gap: 18px;
  }

  .health-donut {
    position: relative;
    width: 124px;
    aspect-ratio: 1;
    border-radius: 50%;

    &::after {
      content: "";
      position: absolute;
      inset: 31px;
      border-radius: 50%;
      background: var(--panel);
      box-shadow: inset 0 0 0 1px var(--line);
    }

    strong,
    span {
      display: block;
    }

    strong {
      color: var(--heading);
      font-size: 27px;
      line-height: 1;
    }

    span {
      margin-top: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
      line-height: 1.1;
    }
  }

  .health-donut-value {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 1;
    width: 66px;
    transform: translate(-50%, -50%);
    text-align: center;
  }

  .health-legend,
  .funnel-list,
  .risk-rank-list,
  .workload-list,
  .pending-task-list {
    display: grid;
    gap: 9px;
  }

  .health-legend {
    div {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
    }

    i {
      width: 9px;
      height: 9px;
      border-radius: 50%;
    }

    span {
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    strong {
      color: var(--heading);
      font-size: 13px;
    }
  }

  .funnel-row {
    display: grid;
    gap: 7px;
  }

  .funnel-head,
  .workload-title {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .funnel-head {
    span {
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    strong {
      color: var(--heading);
      font-size: 13px;
    }
  }

  .funnel-track,
  .workload-track {
    display: flex;
    overflow: hidden;
    height: 10px;
    border-radius: 999px;
    background: var(--soft-card-strong);
  }

  .funnel-track i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #22c55e, #0ea5e9);
  }

  .risk-rank-row,
  .pending-task-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 48px;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);
    color: var(--text);
    text-align: left;

    &:hover {
      border-color: rgba(34, 197, 94, 0.36);
      background: var(--primary-soft);
    }

    strong {
      display: block;
      overflow: hidden;
      color: var(--heading);
      font-size: 13px;
      font-weight: 760;
      text-decoration: none;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    small {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
      white-space: nowrap;
    }
  }

  .pending-task-row .task-title-link {
    display: block;
    overflow: hidden;
    color: var(--primary);
    font-size: 13px;
    font-weight: 760;
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      text-decoration: underline;
    }
  }

  .workspace-support-grid {
    align-items: stretch;
  }

  .workload-row {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);

    small {
      color: var(--muted);
      font-size: 12px;
    }
  }

  .workload-title {
    align-items: flex-start;

    > div {
      min-width: 0;
    }

    strong {
      display: block;
      overflow: hidden;
      color: var(--heading);
      font-size: 13px;
      font-weight: 760;
      text-decoration: none;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      display: block;
      margin-top: 5px;
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    b {
      flex: 0 0 auto;
      color: var(--heading);
      font-size: 13px;
    }
  }

  .workload-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;

    span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
    }

    i {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
  }

  .workload-track i {
    display: block;
    height: 100%;
  }

  .workload-track .task,
  .workload-legend .task {
    background: #8b5cf6;
  }

  .workload-track .report,
  .workload-legend .report {
    background: #0ea5e9;
  }

  .workload-track .evidence,
  .workload-legend .evidence {
    background: #22c55e;
  }
}
</style>
