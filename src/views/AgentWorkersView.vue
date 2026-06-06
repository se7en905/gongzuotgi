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

  <ElCard shadow="never" class="panel-card agent-worker-bind-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>{{ app.isWorkbenchAdmin ? '本机 Worker 绑定与实验操作' : '我的本机 Worker 绑定' }}</h3>
          <p>{{ app.isWorkbenchAdmin ? '需要实际跑一次直接执行实验时，在目标执行人的电脑启动 Worker；启动命令同时包含 Windows 和 macOS 两段。' : '在自己的电脑启动 Worker 后，平台才会显示你的 Codex / Figma MCP 状态，并自动领取分配给你的直接执行任务。' }}</p>
        </div>
        <ElTag type="info" effect="plain">命令必须在执行人自己的电脑运行</ElTag>
      </div>
    </template>
    <div class="agent-worker-bind-grid">
      <div class="agent-worker-bind-copy">
        <strong>{{ app.isWorkbenchAdmin ? '当前账号实验命令' : '我的启动命令' }}</strong>
        <p>如果你现在要在工作台里做一次实验：先用 Skill/md 创建直接执行并指派给自己，再复制“手动启动”。复制出的命令里同时包含 Windows PowerShell 和 macOS 终端两段，按自己电脑系统执行对应段落。Worker 在线且 Figma MCP 就绪后，会自动领取这个任务。</p>
        <div v-if="app.canCopyDirectSkillWorkerCommand(app.currentWorkerBindingUser)" class="agent-worker-bind-actions">
          <ElButton type="primary" plain @click="app.copyDirectSkillWorkerCommand(app.currentWorkerBindingUser, false)">复制手动启动</ElButton>
          <ElButton plain @click="app.copyDirectSkillWorkerCommand(app.currentWorkerBindingUser, true)">复制开机自启</ElButton>
        </div>
        <span v-else class="muted-text">当前账号没有复制 Worker 启动命令的权限。</span>
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
      <div class="panel-head">
        <div>
          <h3>Worker 心跳</h3>
        </div>
        <ElButton type="primary" plain :loading="app.loading.agentWorkers || app.loading.runs" @click="app.refreshAgentWorkers(); app.refreshRuns()">刷新状态</ElButton>
      </div>
    </template>
    <div class="agent-worker-list">
      <article v-for="row in app.agentWorkerHeartbeatRows" :key="row.user.id || row.worker?.id || row.worker?.deviceId" :class="['agent-worker-card', { online: row.online, ready: row.ready, blocked: !row.ready }]">
        <div class="agent-worker-card-head">
          <div>
            <strong>{{ row.user.displayName || row.user.username || row.worker?.userName || '未命名组员' }}</strong>
            <span>{{ row.worker?.deviceName || row.worker?.deviceId || '未启动 Worker' }}</span>
          </div>
          <ElTag size="small" :type="row.ready ? 'success' : row.online ? 'warning' : 'danger'">{{ row.ready ? '可直接执行' : row.online ? '不可执行' : '无心跳' }}</ElTag>
        </div>
        <div :class="['agent-heartbeat-line', { alive: row.ready }]">
          <span></span>
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
          <p>展示所有人从 Skill / md 发起的直接执行记录、执行人、本机 Worker 和处理状态。</p>
        </div>
        <ElButton plain :loading="app.loading.runs" @click="app.refreshRuns">刷新明细</ElButton>
      </div>
    </template>
    <ElTable class="skill-clean-table" :data="app.directSkillRunRows" table-layout="fixed" empty-text="暂无执行明细">
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

.agent-heartbeat-line {
  position: relative;
  height: 36px;
  overflow: hidden;
  border-radius: 6px;
  background: #fff7f7;

  &::before {
    position: absolute;
    top: 50%;
    right: 10px;
    left: 10px;
    height: 2px;
    background: #ef4444;
    content: "";
    transform: translateY(-50%);
  }

  span {
    display: none;
  }

  &.alive {
    background: #f0fdf4;

    &::before {
      background: rgba(22, 163, 74, 0.18);
    }

    span {
      position: absolute;
      top: 50%;
      left: 0;
      display: block;
      width: 200%;
      height: 24px;
      background:
        linear-gradient(90deg, transparent 0 8px, #16a34a 8px 10px, transparent 10px 20px) 0 11px / 40px 2px repeat-x,
        linear-gradient(135deg, transparent 0 42%, #16a34a 42% 47%, transparent 47% 100%) 18px 4px / 40px 18px repeat-x,
        linear-gradient(45deg, transparent 0 42%, #16a34a 42% 47%, transparent 47% 100%) 30px 4px / 40px 18px repeat-x;
      filter: drop-shadow(0 0 3px rgba(22, 163, 74, 0.35));
      transform: translateY(-50%);
      animation: agent-heartbeat-flow 1.35s linear infinite;
    }
  }
}

@keyframes agent-heartbeat-flow {
  from {
    transform: translate3d(0, -50%, 0);
  }

  to {
    transform: translate3d(-40px, -50%, 0);
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
