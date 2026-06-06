<template>
<section v-show="app.activeView === 'agent-workers'" class="content-grid agent-workers-view">
  <div class="flow-helper">
    <span>本机执行状态</span>
    <strong>查看组员 Worker 在线、Figma MCP 自检和直接执行队列</strong>
    <small>直接执行不会在平台服务器写 Figma；必须由执行人本机 Worker 领取并使用本人 Figma 授权。</small>
  </div>

  <ElCard shadow="never" class="panel-card agent-worker-guide-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>直接执行启动方式</h3>
          <p>直接执行没有平台侧“开始”按钮；任务创建后由执行人本机 Worker 自动领取。</p>
        </div>
        <ElTag type="warning" effect="plain">必须使用执行人本机 Figma 授权</ElTag>
      </div>
    </template>
    <div class="agent-worker-guide-grid">
      <div class="agent-worker-guide-step">
        <span>1</span>
        <strong>负责人创建直接执行</strong>
        <p>选择 Skill / md、填写 Figma 链接并指派执行人后，任务进入“待领取”。</p>
      </div>
      <div class="agent-worker-guide-step">
        <span>2</span>
        <strong>执行人启动本机 Worker</strong>
        <p>Worker 在组员电脑上登录工作台，检查 Codex 和 Figma MCP。</p>
      </div>
      <div class="agent-worker-guide-step">
        <span>3</span>
        <strong>Worker 自动领取并执行</strong>
        <p>自检通过后自动领取自己的任务，状态会变为“已领取 / 执行中”。</p>
      </div>
      <div class="agent-worker-guide-step">
        <span>4</span>
        <strong>平台展示日志和结果</strong>
        <p>Worker 回传 Codex 输出、阻塞原因和最终执行状态，负责人在执行台查看。</p>
      </div>
    </div>
  </ElCard>

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

  <ElCard shadow="never" class="panel-card agent-worker-member-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>组员准备清单</h3>
          <p>负责人用这里判断谁已经具备直接执行条件，并把 Worker 启动命令发给对应组员。</p>
        </div>
        <ElButton plain :loading="app.loading.users || app.loading.agentWorkers" @click="app.refreshUsers(); app.refreshAgentWorkers(); app.refreshRuns()">刷新准备状态</ElButton>
      </div>
    </template>
    <ElTable class="skill-clean-table" :data="app.directSkillMemberReadinessRows" table-layout="fixed" empty-text="暂无可执行账号">
      <ElTableColumn label="组员" min-width="150">
        <template #default="{ row }">
          <div class="agent-member-cell">
            <strong>{{ row.user.displayName || row.user.username }}</strong>
            <span>{{ row.user.username }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="准备状态" width="140">
        <template #default="{ row }">
          <ElTag size="small" :type="app.directSkillMemberReadyTagType(row)">{{ app.directSkillMemberReadyLabel(row) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="Codex" width="110">
        <template #default="{ row }">{{ row.codexReady ? '已就绪' : '未就绪' }}</template>
      </ElTableColumn>
      <ElTableColumn label="Figma MCP" width="120">
        <template #default="{ row }">{{ row.figmaMcpReady ? '已就绪' : '未就绪' }}</template>
      </ElTableColumn>
      <ElTableColumn label="任务" width="150">
        <template #default="{ row }">待领取 {{ row.pendingRuns.length }} · 执行中 {{ row.activeRuns.length }}</template>
      </ElTableColumn>
      <ElTableColumn label="最近心跳" width="170">
        <template #default="{ row }">{{ app.directSkillWorkerLastSeenText(row.worker) }}</template>
      </ElTableColumn>
      <ElTableColumn label="启动命令" min-width="260" fixed="right">
        <template #default="{ row }">
          <div v-if="app.can('run.directSkill.workerCommand')" class="agent-command-cell">
            <span v-if="!row.user.passwordDisplay">未登记展示密码时，复制后让组员自行填写密码。</span>
            <span v-else>可复制给该组员在自己电脑执行。</span>
            <div>
              <ElButton plain size="small" @click="app.copyDirectSkillWorkerCommand(row.user, false)">复制手动启动</ElButton>
              <ElButton plain size="small" @click="app.copyDirectSkillWorkerCommand(row.user, true)">复制开机自启</ElButton>
            </div>
          </div>
          <span v-else class="muted-text">无复制命令权限</span>
        </template>
      </ElTableColumn>
    </ElTable>
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
          <ElTag size="small" :type="app.runTagType(row.status)">{{ app.directSkillRunStatusLabel(row) }}</ElTag>
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

.agent-worker-guide-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
}

.agent-worker-guide-step {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #ffffff;

  > span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #0f172a;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
  }

  strong {
    color: var(--heading);
    font-size: 14px;
  }

  p {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.6;
  }
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

.agent-member-cell,
.agent-command-cell {
  display: grid;
  gap: 4px;
  min-width: 0;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--muted);
    font-size: 12px;
  }
}

.agent-command-cell {
  div {
    display: flex;
    align-items: center;
    gap: 8px;
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
  .agent-worker-guide-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .agent-worker-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .agent-worker-guide-grid,
  .agent-worker-metrics,
  .agent-worker-list,
  .agent-worker-state-grid {
    grid-template-columns: 1fr;
  }
}
</style>
