<template>
<section v-show="app.activeView === 'agent-workers'" class="content-grid agent-workers-view">
  <div v-if="app.isWorkbenchAdmin" class="flow-helper">
    <span>本机执行状态</span>
    <strong>查看组员 Worker 在线、Figma MCP 自检和执行明细</strong>
    <small>直接执行不会在平台服务器写 Figma；必须由执行人本机 Worker 领取并使用本人 Figma 授权。</small>
  </div>

  <ElCard v-if="app.isWorkbenchAdmin" shadow="never" class="panel-card agent-worker-guide-card">
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
        <strong>工作台管理者创建直接执行</strong>
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
        <p>Worker 回传 Codex 输出、阻塞原因和最终执行状态，工作台管理者在执行台查看。</p>
      </div>
    </div>
  </ElCard>

  <ElCard v-if="app.isWorkbenchAdmin" shadow="never" class="panel-card agent-worker-bind-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>{{ app.isWorkbenchAdmin ? '本机 Worker 绑定与实验操作' : '我的本机 Worker 绑定' }}</h3>
          <p>{{ app.isWorkbenchAdmin ? '需要实际跑一次直接执行实验时，在目标执行人的电脑启动 Worker；启动命令同时包含 Windows 和 macOS 两段。' : '在自己的电脑启动 Worker 后，平台才会显示你的 Codex / Figma MCP 状态，并自动领取分配给你的直接执行任务。' }}</p>
        </div>
      </div>
    </template>
    <div class="agent-worker-bind-grid">
      <div class="agent-worker-bind-copy">
        <strong>{{ app.isWorkbenchAdmin ? '当前账号实验命令' : '我的启动命令' }}</strong>
        <p>如果你现在要在工作台里做一次实验：先用 Skill/md 创建直接执行并指派给自己，再复制“手动启动”。复制出的命令里同时包含 Windows PowerShell 和 macOS 终端两段，按自己电脑系统执行对应段落。Worker 在线且 Figma MCP 就绪后，会自动领取这个任务。</p>
      </div>
      <div class="agent-worker-command-explain">
        <div>
          <strong>手动启动</strong>
          <p>适合临时实验或当天手动执行。复制内容同时支持 Windows 和 macOS；Windows 在 PowerShell 里运行，macOS 在终端里运行。窗口保持运行，关闭后 Worker 停止。</p>
        </div>
        <div>
          <strong>开机自启</strong>
          <p>适合组员长期接任务。复制内容同时支持 Windows 和 macOS；Windows 会注册计划任务，macOS 会安装 LaunchAgent。以后该电脑登录系统时自动启动 Worker。</p>
        </div>
        <div>
          <strong>工作台地址</strong>
          <p>组员电脑不能使用管理者电脑上的 localhost。如果复制出的地址是 127.0.0.1，请替换成组员能访问的工作台服务器 IP 或域名。</p>
        </div>
      </div>
    </div>
  </ElCard>

  <ElCard shadow="never" class="panel-card agent-worker-summary-card">
    <template #header>
      <div class="panel-head agent-worker-summary-head">
        <div>
          <h3>Worker 心跳</h3>
          <p>命令必须在执行人自己的电脑运行。</p>
          <span v-if="!app.canCopyDirectSkillWorkerCommand(app.currentWorkerBindingUser)" class="muted-text">当前账号没有复制 Worker 启动命令的权限。</span>
        </div>
        <div class="agent-worker-toolbar">
          <ElButton v-if="app.canCopyDirectSkillWorkerCommand(app.currentWorkerBindingUser)" type="primary" plain @click="app.copyDirectSkillWorkerCommand(app.currentWorkerBindingUser, false)">复制手动启动</ElButton>
          <ElButton v-if="app.canCopyDirectSkillWorkerCommand(app.currentWorkerBindingUser)" plain @click="app.copyDirectSkillWorkerCommand(app.currentWorkerBindingUser, true)">复制开机自启</ElButton>
          <ElButton plain :loading="app.loading.agentWorkers || app.loading.runs" @click="app.refreshAgentWorkers(); app.refreshRuns()">刷新状态</ElButton>
        </div>
      </div>
    </template>
    <div class="agent-worker-list">
      <article v-for="row in app.agentWorkerHeartbeatRows" :key="row.user.id || row.worker?.id || row.worker?.deviceId" :class="['agent-worker-card', { online: row.online, ready: row.ready, blocked: !row.ready }]">
        <div class="agent-worker-card-head">
          <div>
            <strong>{{ row.user.displayName || row.user.username || row.worker?.userName || '未命名组员' }}</strong>
            <span>{{ row.worker?.deviceName || row.worker?.deviceId || '未启动 Worker' }}</span>
          </div>
          <div :class="['agent-heartbeat-badge', { alive: row.ready, warning: row.online && !row.ready }]">
            <svg v-if="row.ready" viewBox="0 0 112 34" aria-hidden="true">
              <path class="agent-heartbeat-trail" d="M2 22 C14 22, 18 14, 29 15 C39 16, 43 22, 52 22 C61 22, 63 7, 71 7 C80 7, 82 22, 91 22 C101 22, 104 17, 110 17" />
              <path class="agent-heartbeat-draw" d="M2 22 C14 22, 18 14, 29 15 C39 16, 43 22, 52 22 C61 22, 63 7, 71 7 C80 7, 82 22, 91 22 C101 22, 104 17, 110 17" />
            </svg>
            <span v-else>{{ row.online ? '不可执行' : '无心跳' }}</span>
          </div>
        </div>
        <div class="agent-worker-state-grid">
          <div><span>Codex</span><strong>{{ row.codexReady ? '已就绪' : '未就绪' }}</strong></div>
          <div><span>Figma MCP</span><strong>{{ row.figmaMcpReady ? '已就绪' : '未就绪' }}</strong></div>
          <div><span>最近心跳</span><strong>{{ app.directSkillWorkerLastSeenText(row.worker) }}</strong></div>
          <div><span>待领取</span><strong>{{ row.pendingRuns.length }}</strong></div>
          <div><span>执行中</span><strong>{{ row.activeRuns.length }}</strong></div>
          <div><span>已完成</span><strong>{{ row.completedRuns.length }}</strong></div>
        </div>
      </article>
      <div v-if="!app.agentWorkerHeartbeatRows.length" class="empty-block">暂无可查看的 Worker 信息。组员具备执行权限并启动本机 Worker 后会显示在这里。</div>
    </div>
  </ElCard>

  <ElCard shadow="never" class="panel-card agent-direct-runs-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>执行明细</h3>
          <p>仅展示最近 10 条直接执行记录；完整明细请到左侧 AI档案 查看。</p>
        </div>
        <ElButton plain :loading="app.loading.runs" @click="app.refreshRuns">刷新明细</ElButton>
      </div>
    </template>
    <ElTable class="skill-clean-table" :data="app.recentDirectSkillRunRows" table-layout="fixed" empty-text="暂无执行明细">
      <ElTableColumn label="执行内容" min-width="240">
        <template #default="{ row }">
          <button type="button" class="agent-run-title" @click="app.openRun(row)">
            <strong>{{ row.title }}</strong>
            <span>{{ row.primarySkillPath || row.stage || '-' }}</span>
          </button>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作人" width="120">
        <template #default="{ row }">{{ app.directSkillRunOperatorName(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="执行人" width="120">
        <template #default="{ row }">{{ row.assignedToName || row.developer || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="110">
        <template #default="{ row }">
          <ElTag size="small" :type="app.runTagType(row.status)">{{ app.directSkillRunStatusLabel(row) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="领取设备" min-width="150">
        <template #default="{ row }">{{ row.claimedByDeviceId || app.directSkillWorkerForRun(row)?.deviceName || '未领取' }}</template>
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
      <ElTableColumn label="更新时间" width="150">
        <template #default="{ row }">{{ app.directSkillRunUpdatedText(row) }}</template>
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

.agent-worker-bind-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
  gap: 12px;
  padding: 14px;
}

.agent-worker-bind-copy,
.agent-worker-command-explain > div {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #ffffff;

  strong {
    color: var(--heading);
    font-size: 14px;
  }

  p {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.7;
  }
}

.agent-worker-bind-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.agent-worker-command-explain {
  display: grid;
  gap: 12px;
}

.agent-worker-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.agent-worker-summary-head {
  align-items: center;

  > div:first-child {
    min-width: 0;
  }
}

.agent-worker-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
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

.agent-heartbeat-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 70px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 999px;
  background: #fff7f7;
  color: #dc2626;
  font-size: 12px;
  font-weight: 800;

  &.warning {
    border-color: rgba(245, 158, 11, 0.28);
    background: #fffbeb;
    color: #b45309;
  }

  &.alive {
    width: 94px;
    min-width: 94px;
    padding: 0 8px;
    border-color: rgba(20, 184, 166, 0.28);
    background: rgba(236, 253, 245, 0.9);
    box-shadow: inset 0 0 14px rgba(20, 184, 166, 0.12);
  }

  svg {
    width: 76px;
    height: 24px;
    overflow: visible;
  }

  path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

.agent-heartbeat-trail {
  stroke: rgba(20, 184, 166, 0.2);
  stroke-width: 4;
}

.agent-heartbeat-draw {
  stroke: #10f5d4;
  stroke-width: 4;
  stroke-dasharray: 150;
  stroke-dashoffset: 150;
  filter:
    drop-shadow(0 0 2px rgba(45, 212, 191, 0.9))
    drop-shadow(0 0 6px rgba(20, 184, 166, 0.5));
  animation: agent-heartbeat-trace 1.45s ease-in-out infinite;
}

@keyframes agent-heartbeat-trace {
  0% {
    stroke-dashoffset: 150;
    opacity: 0.35;
  }

  45%,
  72% {
    stroke-dashoffset: 0;
    opacity: 1;
  }

  100% {
    stroke-dashoffset: -150;
    opacity: 0.35;
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
    flex-wrap: wrap;
    gap: 8px;
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

  .agent-worker-bind-grid {
    grid-template-columns: 1fr;
  }

  .agent-worker-toolbar {
    justify-content: flex-start;
  }

  .agent-worker-summary-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .agent-worker-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .agent-worker-guide-grid,
  .agent-worker-list,
  .agent-worker-state-grid {
    grid-template-columns: 1fr;
  }
}
</style>
