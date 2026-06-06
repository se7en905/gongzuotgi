<template>
<section v-show="app.activeView === 'agent-workers'" class="content-grid agent-workers-view">
  <div class="flow-helper">
    <span>本机执行状态</span>
    <strong>查看组员 Worker 在线、Figma MCP 自检和直接执行队列</strong>
    <small>直接执行不会在平台服务器写 Figma；必须由执行人本机 Worker 领取并使用本人 Figma 授权。</small>
  </div>

  <ElCard shadow="never" class="panel-card agent-worker-summary-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>组员本机 Worker</h3>
          <p>用于判断谁的本机可以接直接执行，以及 Codex / Figma MCP 是否可用。</p>
        </div>
        <ElButton type="primary" plain :loading="app.loading.agentWorkers" @click="app.refreshAgentWorkers">刷新状态</ElButton>
      </div>
    </template>
    <div class="agent-worker-metrics">
      <div>
        <span>在线 Worker</span>
        <strong>{{ app.agentWorkerOnlineCount }}</strong>
      </div>
      <div>
        <span>Figma MCP 就绪</span>
        <strong>{{ app.agentWorkerFigmaReadyCount }}</strong>
      </div>
      <div>
        <span>待领取直接执行</span>
        <strong>{{ app.directSkillPendingRuns.length }}</strong>
      </div>
      <div>
        <span>本机执行中</span>
        <strong>{{ app.directSkillActiveRuns.length }}</strong>
      </div>
    </div>
    <div class="agent-worker-list">
      <article v-for="worker in app.agentWorkerDisplayRows" :key="worker.id" :class="['agent-worker-card', { online: app.directSkillWorkerOnline(worker), blocked: !worker.figmaMcpReady || !worker.codexReady }]">
        <div class="agent-worker-card-head">
          <div>
            <strong>{{ worker.userName || worker.userId || '未命名组员' }}</strong>
            <span>{{ worker.deviceName || worker.deviceId || '-' }}</span>
          </div>
          <ElTag size="small" :type="app.directSkillWorkerOnline(worker) ? 'success' : 'info'">{{ app.directSkillWorkerOnline(worker) ? '在线' : '离线' }}</ElTag>
        </div>
        <div class="agent-worker-state-grid">
          <div><span>Codex</span><strong>{{ worker.codexReady ? '已就绪' : '未就绪' }}</strong></div>
          <div><span>Figma MCP</span><strong>{{ worker.figmaMcpReady ? '已就绪' : '未就绪' }}</strong></div>
          <div><span>最近心跳</span><strong>{{ app.directSkillWorkerLastSeenText(worker) }}</strong></div>
        </div>
        <p>{{ worker.checks?.figmaMessage || worker.checks?.codexMessage || '等待本机心跳回传。' }}</p>
      </article>
      <div v-if="!app.agentWorkerDisplayRows.length" class="empty-block">暂无本机 Worker 心跳。组员启动本机 Worker 后会显示在这里。</div>
    </div>
  </ElCard>

  <ElCard shadow="never" class="panel-card agent-direct-runs-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>直接执行队列</h3>
          <p>只展示从 Skill / md 发起、等待组员本机 Codex + Figma MCP 处理的任务。</p>
        </div>
        <ElButton plain :loading="app.loading.runs" @click="app.refreshRuns">刷新队列</ElButton>
      </div>
    </template>
    <ElTable class="skill-clean-table" :data="app.directSkillRunRows" table-layout="fixed" empty-text="暂无直接执行任务">
      <ElTableColumn label="任务" min-width="220">
        <template #default="{ row }">
          <button type="button" class="agent-run-title" @click="app.openRun(row)">
            <strong>{{ row.title }}</strong>
            <span>{{ row.primarySkillPath || row.stage || '-' }}</span>
          </button>
        </template>
      </ElTableColumn>
      <ElTableColumn label="执行人" width="110">
        <template #default="{ row }">{{ row.assignedToName || row.developer || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="110">
        <template #default="{ row }">
          <ElTag size="small" :type="app.runTagType(row.status)">{{ app.runStatusLabel(row.status) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="本机 Worker" min-width="240">
        <template #default="{ row }">{{ app.directSkillWorkerStatusText(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="Figma 链接" min-width="180">
        <template #default="{ row }">
          <a v-if="row.figmaLinks" :href="row.figmaLinks" target="_blank" rel="noopener noreferrer">打开 Figma</a>
          <span v-else>-</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="创建时间" width="150">
        <template #default="{ row }">{{ app.formatDateTime(row.createdAt) || '-' }}</template>
      </ElTableColumn>
    </ElTable>
  </ElCard>
</section>
</template>

<script>
export default {
  name: 'AgentWorkersView',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>

<style scoped lang="scss">
.agent-workers-view {
  grid-template-columns: minmax(0, 1fr);
}

.agent-worker-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;

  div {
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
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
    margin-top: 6px;
    color: var(--heading);
    font-size: 24px;
  }
}

.agent-worker-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 0 14px 14px;
}

.agent-worker-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #ffffff;

  &.online {
    border-color: rgba(34, 197, 94, 0.38);
  }

  &.blocked {
    border-color: rgba(245, 158, 11, 0.38);
  }

  p {
    margin: 0;
    color: #64748b;
    font-size: 12px;
    line-height: 1.6;
  }
}

.agent-worker-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;

  div {
    min-width: 0;
  }

  strong,
  span {
    display: block;
  }

  strong {
    overflow: hidden;
    color: var(--heading);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    margin-top: 4px;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.agent-worker-state-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  div {
    min-width: 0;
    padding: 8px;
    border-radius: 6px;
    background: #f8fafc;
  }

  span,
  strong {
    display: block;
  }

  span {
    color: var(--muted);
    font-size: 11px;
  }

  strong {
    margin-top: 4px;
    overflow: hidden;
    color: var(--heading);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.agent-run-title {
  display: grid;
  gap: 4px;
  width: 100%;
  color: inherit;
  text-align: left;

  strong,
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--muted);
    font-size: 12px;
  }
}

@media (max-width: 1200px) {
  .agent-worker-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .agent-worker-metrics,
  .agent-worker-list,
  .agent-worker-state-grid {
    grid-template-columns: 1fr;
  }
}
</style>
