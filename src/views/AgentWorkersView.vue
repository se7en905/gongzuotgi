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
          <p>{{ app.isWorkbenchAdmin ? '需要给目标执行人的电脑安装 Worker 时，按系统复制对应的开机自启命令。' : '在自己的电脑安装 Worker 开机自启后，平台才会显示你的 Codex / Figma MCP 状态，并自动领取分配给你的直接执行任务。' }}</p>
        </div>
      </div>
    </template>
    <div class="agent-worker-bind-grid">
      <div class="agent-worker-bind-copy">
        <strong>{{ app.isWorkbenchAdmin ? '当前账号安装命令' : '我的安装命令' }}</strong>
        <p>请按执行人电脑系统复制对应的开机自启命令。安装完成后，该电脑登录系统会自动启动 Worker，并持续回传心跳、自检 Codex / Figma MCP、自动领取分配给自己的任务。</p>
      </div>
      <div class="agent-worker-command-explain">
        <div>
          <strong>开机自启</strong>
          <p>适合组员长期接任务。Windows 版会创建当前用户计划任务，macOS 版会安装 LaunchAgent。以后该电脑登录系统时自动启动 Worker。</p>
        </div>
        <div>
          <strong>工作台地址</strong>
          <p>组员电脑不能使用管理者电脑上的 localhost。如果复制出的地址是 127.0.0.1，请替换成组员能访问的工作台服务器 IP 或域名。</p>
        </div>
      </div>
    </div>
  </ElCard>

  <ElCard shadow="never" class="panel-card agent-direct-runs-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>执行明细</h3>
          <p>仅展示最近 10 条执行工作台记录；完整明细请到左侧 AI档案 查看。</p>
        </div>
        <ElButton plain :loading="app.loading.runs" @click="app.refreshRuns">刷新明细</ElButton>
      </div>
    </template>
    <ElTable class="skill-clean-table agent-worker-runs-table" :data="app.recentExecutionRunRows" table-layout="fixed" empty-text="暂无执行明细">
      <ElTableColumn label="执行内容" min-width="250">
        <template #default="{ row }">
          <button type="button" class="agent-run-title" @click="app.openRun(row)">
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
        <template #default="{ row }">{{ row.assignedToName || row.developer || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="150">
        <template #default="{ row }">
          <div class="agent-run-status-row">
            <ElTag size="small" :type="app.runTagType(app.effectiveResultStatus(row))">{{ app.directSkillRunStatusLabel(row) || app.runStatusLabel(app.runDisplayStatusValue(row)) }}</ElTag>
            <ElTag v-if="app.isRunSourceDeleted(row)" size="small" type="warning">来源已删除</ElTag>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="领取设备" min-width="150">
        <template #default="{ row }">{{ app.directSkillRunDeviceDisplayName(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="本机 Worker" min-width="220">
        <template #default="{ row }">{{ app.directSkillWorkerStatusText(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="平台诊断" min-width="260">
        <template #default="{ row }">{{ app.directSkillRunDiagnosisSummary(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="Figma" width="92">
        <template #default="{ row }">
          <a v-if="row.figmaLinks" :href="row.figmaLinks" target="_blank" rel="noopener noreferrer">打开 Figma</a>
          <span v-else>-</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="创建时间" width="190">
        <template #default="{ row }">{{ app.formatDateTime(row.createdAt) || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="更新时间" width="190">
        <template #default="{ row }">{{ app.directSkillRunUpdatedText(row) }}</template>
      </ElTableColumn>
    </ElTable>
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
          <ElButton v-if="app.canCopyDirectSkillWorkerCommand(app.currentWorkerBindingUser)" type="primary" plain @click="app.copyDirectSkillWorkerCommand(app.currentWorkerBindingUser, true, 'windows')">复制 Windows 开机自启</ElButton>
          <ElButton v-if="app.canCopyDirectSkillWorkerCommand(app.currentWorkerBindingUser)" plain @click="app.copyDirectSkillWorkerCommand(app.currentWorkerBindingUser, true, 'mac')">复制 macOS 开机自启</ElButton>
          <ElButton plain :loading="app.loading.agentWorkers || app.loading.runs" @click="app.refreshAgentWorkerStatusView">刷新状态</ElButton>
        </div>
      </div>
    </template>
    <div class="agent-worker-impact-panel">
      <div>
        <strong>当前执行影响</strong>
        <p>生图类 Skill/md 默认走执行人电脑上的原生 image2 / gpt-image-2；平台服务器、负责人电脑和 admin 凭据不代跑。</p>
      </div>
      <div>
        <strong>命令影响</strong>
        <p>本次已更新 Worker 启动命令和 Windows 开机自启安装命令，新增自动继承执行人本机 `OPENAI_BASE_URL` / `CODEX_HOME/config.toml` 中转入口的逻辑。</p>
      </div>
      <div>
        <strong>需要组员操作</strong>
        <p>组员需要按自己系统重新复制并执行一次最新 `复制 Windows 开机自启` 或 `复制 macOS 开机自启` 命令。后续若命令再次变化，这里会继续明确提示。</p>
      </div>
      <div>
        <strong>已运行任务</strong>
        <p>已领取并正在执行的任务不中途切换；新规则从下一次领取、继续执行或重新执行开始生效。</p>
      </div>
    </div>
    <div class="agent-worker-list">
      <article v-for="row in app.agentWorkerHeartbeatRows" :key="row.user.id || row.worker?.id || row.worker?.deviceId" :class="['agent-worker-card', { online: row.online, ready: row.ready, blocked: !row.ready, syncing: row.runningWhileDisconnected }]">
        <div class="agent-worker-card-head">
          <div>
            <strong>{{ row.user.displayName || row.user.username || row.worker?.userName || '未命名组员' }}</strong>
            <span>
              {{ app.directSkillWorkerDisplayName(row.worker) }}
              <button v-if="app.canEditDirectSkillWorkerAlias(row.worker)" type="button" class="agent-worker-rename-button" @click="app.renameDirectSkillWorker(row.worker)">改名</button>
            </span>
          </div>
          <div :class="['agent-heartbeat-badge', { alive: row.ready, warning: row.online && !row.ready }]">
            <svg v-if="row.ready" viewBox="0 0 112 34" aria-hidden="true">
              <path class="agent-heartbeat-trail" d="M2 22 C14 22, 18 14, 29 15 C39 16, 43 22, 52 22 C61 22, 63 7, 71 7 C80 7, 82 22, 91 22 C101 22, 104 17, 110 17" />
              <path class="agent-heartbeat-draw" d="M2 22 C14 22, 18 14, 29 15 C39 16, 43 22, 52 22 C61 22, 63 7, 71 7 C80 7, 82 22, 91 22 C101 22, 104 17, 110 17" />
            </svg>
            <span v-else>{{ row.runningWhileDisconnected ? '待补传' : row.online ? '不可执行' : row.installed ? '离线' : '未安装' }}</span>
          </div>
        </div>
        <div class="agent-worker-state-grid">
          <div><span>状态</span><strong>{{ app.directSkillMemberReadyLabel(row) }}</strong></div>
          <div><span>Codex</span><strong>{{ row.codexReady ? '已就绪' : '未就绪' }}</strong></div>
          <div><span>Figma MCP</span><strong>{{ row.figmaMcpReady ? '已就绪' : '未就绪' }}</strong></div>
          <div><span>最近心跳</span><strong>{{ app.directSkillWorkerLastSeenText(row.worker) }}</strong></div>
          <div><span>最近退出</span><strong>{{ app.directSkillWorkerRunnerExitSummary(row.worker) }}</strong></div>
          <div><span>待领取</span><strong>{{ row.pendingRuns.length }}</strong></div>
          <div><span>执行中</span><strong>{{ row.activeRuns.length }}</strong></div>
          <div><span>已完成</span><strong>{{ row.completedRuns.length }}</strong></div>
        </div>
        <div class="agent-worker-image2-section">
          <strong>Image2 生图链路</strong>
          <div class="agent-worker-image2-grid">
            <div><span>Image2 自检</span><strong>{{ app.directSkillWorkerImage2DisplayLabel(row) }}</strong></div>
            <div><span>Image2 来源</span><strong>{{ app.directSkillWorkerImage2SourceLabel(row.worker) }}</strong></div>
            <div><span>Image2 入口</span><strong>{{ app.directSkillWorkerImage2BaseUrlLabel(row.worker) }}</strong></div>
          </div>
        </div>
        <p v-if="row.worker && !row.ready" class="agent-worker-issue">{{ app.directSkillWorkerIssueText(row.worker) }}</p>
        <div class="agent-worker-card-actions">
          <ElButton plain size="small" @click="openWorkerDiagnosis(row)">查看任务能力与健康诊断</ElButton>
        </div>
      </article>
      <div v-if="!app.agentWorkerHeartbeatRows.length" class="empty-block">暂无可查看的 Worker 信息。组员具备执行权限并启动本机 Worker 后会显示在这里。</div>
    </div>
  </ElCard>

  <ElDialog
    v-model="workerDiagnosisVisible"
    title="任务能力与健康诊断"
    width="720px"
    destroy-on-close
  >
    <template v-if="workerDiagnosisRow">
      <div class="agent-worker-diagnosis-dialog">
        <div class="agent-worker-diagnosis-summary">
          <strong>{{ workerDiagnosisRow.user.displayName || workerDiagnosisRow.user.username || workerDiagnosisRow.worker?.userName || '未命名组员' }}</strong>
          <span>{{ app.directSkillWorkerDisplayName(workerDiagnosisRow.worker) }}</span>
          <p>{{ app.directSkillWorkerDiagnosisSummary(workerDiagnosisRow) }}</p>
        </div>
        <div class="agent-worker-health-card">
          <strong>任务能力</strong>
          <div class="agent-worker-health-grid">
            <div><span>普通任务</span><strong>{{ app.directSkillWorkerNormalTaskLabel(workerDiagnosisRow) }}</strong></div>
            <div><span>Figma 任务</span><strong>{{ app.directSkillWorkerFigmaTaskLabel(workerDiagnosisRow) }}</strong></div>
            <div><span>生图任务</span><strong>{{ app.directSkillWorkerImageTaskLabel(workerDiagnosisRow) }}</strong></div>
            <div><span>最近生图</span><strong>{{ app.directSkillRecentImageRunStatusLabel(workerDiagnosisRow) }}</strong></div>
          </div>
        </div>
        <div class="agent-worker-health-card">
          <strong>Worker 健康诊断</strong>
          <div class="agent-worker-health-grid">
            <div v-for="item in app.directSkillWorkerHealthRows(workerDiagnosisRow)" :key="item.label">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
          <p class="agent-worker-health-summary">{{ app.directSkillWorkerDiagnosisSummary(workerDiagnosisRow) }}</p>
        </div>
      </div>
    </template>
  </ElDialog>

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
  },
  data() {
    return {
      workerDiagnosisVisible: false,
      workerDiagnosisRow: null
    };
  },
  methods: {
    openWorkerDiagnosis(row) {
      this.workerDiagnosisRow = row;
      this.workerDiagnosisVisible = true;
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

.agent-worker-impact-panel {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 14px 0;
  padding: 12px;
  border: 1px solid rgba(37, 99, 235, 0.16);
  border-radius: 8px;
  background: #f8fbff;

  > div {
    min-width: 0;
    padding: 10px;
    border-radius: 6px;
    background: #ffffff;
  }

  strong {
    display: block;
    color: var(--heading);
    font-size: 13px;
  }

  p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.55;
  }
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
  gap: 8px;

  div {
    min-width: 0;
  }

  strong {
    display: block;
  }

  strong {
    color: var(--heading);
    line-height: 1.4;
    white-space: normal;
    word-break: break-word;
  }

  span {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
    white-space: normal;
    word-break: break-word;
  }
}

.agent-worker-state-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;

  div {
    min-width: 0;
    padding: 8px 9px;
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
    margin-top: 5px;
    color: var(--heading);
    font-size: 12px;
    line-height: 1.45;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
}

.agent-worker-card-actions {
  display: flex;
  justify-content: flex-end;
}

.agent-worker-image2-section {
  display: grid;
  gap: 8px;

  > strong {
    color: var(--heading);
    font-size: 12px;
    line-height: 1.4;
  }
}

.agent-worker-image2-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;

  > div {
    display: grid;
    gap: 4px;
    min-width: 0;
    padding: 8px 9px;
    border-radius: 6px;
    background: #f8fafc;
  }

  span {
    color: var(--muted);
    font-size: 11px;
  }

  strong {
    color: var(--heading);
    font-size: 12px;
    line-height: 1.45;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
}

.agent-worker-issue {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid rgba(245, 158, 11, 0.24);
  border-radius: 6px;
  background: #fffbeb;
  color: #92400e;
  font-size: 12px;
  line-height: 1.6;
}

.agent-worker-health-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(248, 250, 252, 0.9);
}

.agent-worker-health-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.agent-worker-health-grid > div {
  display: grid;
  gap: 4px;
}

.agent-worker-health-grid span {
  color: #64748b;
  font-size: 12px;
}

.agent-worker-health-grid strong {
  color: var(--heading);
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.agent-worker-health-summary {
  margin: 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.6;
}

.agent-worker-diagnosis-dialog {
  display: grid;
  gap: 14px;
}

.agent-worker-diagnosis-summary {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f8fafc;

  strong {
    color: var(--heading);
    font-size: 15px;
  }

  span {
    color: var(--muted);
    font-size: 12px;
  }

  p {
    margin: 0;
    color: var(--text);
    font-size: 13px;
    line-height: 1.7;
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

.agent-run-status-row {
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  min-width: 0;
}

.agent-worker-runs-table {
  :deep(.el-table__cell) {
    white-space: nowrap;
  }

  :deep(.cell) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  a,
  span {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  a {
    vertical-align: bottom;
  }

  :deep(.el-tag) {
    max-width: 100%;
  }
}

.agent-run-title span {
    color: var(--muted);
    font-size: 12px;
}

.agent-worker-rename-button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
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

  .agent-worker-impact-panel {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .agent-worker-guide-grid,
  .agent-worker-impact-panel,
  .agent-worker-list,
  .agent-worker-state-grid,
  .agent-worker-health-grid,
  .agent-worker-image2-grid {
    grid-template-columns: 1fr;
  }
}
</style>
