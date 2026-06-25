<template>
  <section v-show="app.activeView === 'ai-members'" class="ai-board-embed-view">
  <section v-if="app.canViewAiMemberScore" class="ai-score-panel">
    <div class="ai-score-head">
      <div>
        <h3>当月 AI 评分</h3>
        <p>{{ app.aiScoreMonthDisplay }} · 默认显示上次分值，点击刷新后才重新计算</p>
      </div>
      <div class="ai-score-actions">
        <span v-if="app.aiMemberScoreRowsSnapshotAt">上次刷新 {{ app.formatDateTime(app.aiMemberScoreRowsSnapshotAt) }}</span>
        <span v-else>暂无评分快照</span>
        <ElButton plain @click="scoreRuleDialogVisible = true">
          评分说明
        </ElButton>
        <ElButton
          v-if="app.canRefreshAiMemberScore"
          type="primary"
          :loading="app.aiMemberScoreRefreshing"
          @click="app.refreshAiMemberScoreSnapshotManually()"
        >
          刷新评分
        </ElButton>
      </div>
    </div>
    <div v-if="!app.aiMemberScoreReady" class="ai-score-loading">
      {{ app.canRefreshAiMemberScore ? '暂无上次 AI 评分，点击“刷新评分”后计算。' : '暂无上次 AI 评分。' }}
    </div>
    <div v-else class="ai-score-grid">
      <article
        v-for="member in app.aiMemberScoreRows"
        :key="member.account || member.name"
        :class="['ai-score-card', app.aiScoreClass(member.score)]"
      >
        <div class="ai-score-card-top">
          <div>
            <strong>{{ member.name }}</strong>
          </div>
          <b>{{ member.score }}</b>
        </div>
        <div class="ai-score-bar" aria-hidden="true">
          <i :style="{ width: `${member.score}%` }"></i>
        </div>
        <div class="ai-score-metrics">
          <span>产物 {{ member.productCount }} · {{ member.productValueLevel || '基础沉淀' }}</span>
          <span>使用 {{ member.monthUsageCount }}</span>
          <span>执行 {{ member.monthRunCount }}</span>
        </div>
        <p>{{ member.reason }}</p>
      </article>
    </div>
  </section>
  <ElDialog
    v-model="scoreRuleDialogVisible"
    title="AI 评分说明"
    width="760px"
    class="app-dialog ai-score-rule-dialog"
    append-to-body
    align-center
  >
    <div class="ai-score-rule-dialog__content">
      <section
        v-for="section in scoreRuleSections"
        :key="section.title"
        class="ai-score-rule-dialog__section"
      >
        <h4>{{ section.title }}</h4>
        <p v-for="line in section.lines" :key="line">{{ line }}</p>
      </section>
      <section class="ai-score-rule-dialog__section ai-score-rule-dialog__section--file">
        <h4>7. 负责人配置表</h4>
        <p>完整配置表已整理到项目输出目录，后续调权重时优先看这份文件。</p>
        <p class="ai-score-rule-dialog__path">{{ scoreConfigFilePath }}</p>
        <div class="ai-score-rule-dialog__actions">
          <ElButton plain @click="handleOpenScoreConfig">
            打开配置表
          </ElButton>
        </div>
      </section>
    </div>
  </ElDialog>
  <section class="ai-board-frame-shell" :class="{ locked: !app.canViewAiMembersBoardContent }">
    <div v-if="!app.canViewAiMembersBoardContent" class="ai-board-lock-mask">
      <div class="ai-board-lock-card">
        <strong>AI 看板已锁定</strong>
        <span>当前角色只能进入 AI 部门看板页面，但不能查看底部完整 AI 看板正文。</span>
      </div>
    </div>
    <iframe
      ref="boardFrame"
      class="ai-board-embed-frame"
      :srcdoc="frameHtml || activeBoardHtml"
      title="AI部门看板"
      @load="syncThemeToFrame"
    />
  </section>
</section>
</template>

<script>
export default {
  name: 'AiMembersView',
  props: {
    app: {
      type: Object,
      required: true
    }
  },
  computed: {
    snapshot() {
      return this.app.aiMembersSnapshot || {};
    },
    placeholderBoardHtml() {
      return '<!doctype html><html lang="zh-CN"><body><p>正在加载 AI部门看板...</p></body></html>';
    },
    boardHtml() {
      return this.snapshot.html || this.placeholderBoardHtml;
    },
    hasActiveBoardHtml() {
      const html = this.activeBoardHtml || '';
      return this.app.isAiMembersBoardHtml ? this.app.isAiMembersBoardHtml(html) : html.length > 1000;
    },
    activeBoardHtml() {
      return this.boardHtml;
    },
    scoreRuleSections() {
      return [
        {
          title: '1. 总分怎么来',
          lines: [
            '当前总分 = 产物分 + 使用分 + 执行分，最终按 0 到 100 分封顶。',
            '当前口径已经压低产物分权重、提高执行分权重，更强调真实落地执行，而不是只看沉淀数量。'
          ]
        },
        {
          title: '2. 产物数量怎么数',
          lines: [
            '产物数量按“看板内容 + 刷新后的实时库存”合并后去重统计。',
            '这里只看有没有新增沉淀，不区分是否已验证；同名或同一路径产物会自动去重。'
          ]
        },
        {
          title: '3. 产物分怎么给',
          lines: [
            '单个产物按版本档位计分：1.0 记 1.5 分，2.0 记 3 分，3.0 记 4.5 分；3.0 代表更接近可直接使用。',
            '总产物分上限已下调，作废、废弃、淘汰产物不计分；明显只适合单人、单项目、一次性使用的专项产物会按系数折减。'
          ]
        },
        {
          title: '4. 使用分怎么给',
          lines: [
            '普通成员使用分上限 25 分：按本月去重后的闭环使用产物数、重复使用加分、覆盖人数加分计算。',
            '独立口径成员使用分上限 18 分：按本人闭环使用和覆盖率计算。'
          ]
        },
        {
          title: '5. 执行分怎么给',
          lines: [
            '普通成员执行分上限 30 分：按本月完成执行的 skill 数、重复执行加分，以及互验闭环一并计入。',
            '独立口径成员执行分上限 25 分：同样更强调真实执行活跃度，而不是只看产物堆积。'
          ]
        },
        {
          title: '6. 负责人怎么看这个分',
          lines: [
            '这套分更适合看“本月沉淀、复用、执行活跃度”的综合趋势，适合作为月度管理看板。',
            '如果要直接用于个人绩效结论，建议同时结合任务难度、实际业务价值、返工情况和负责人复核，不建议只看单一分值。'
          ]
        }
      ];
    },
    scoreConfigFilePath() {
      return '/Users/se7en/ArtProject/platform/outputs/ai-score-owner-config.md';
    }
  },
  data() {
    return {
      frameHtml: '',
      lastRealFrameHtml: '',
      frameHtmlUpdateTimer: 0,
      scoreRuleDialogVisible: false
    };
  },
  watch: {
    'app.theme'() {
      this.syncThemeToFrame();
    },
    activeBoardHtml: {
      immediate: true,
      handler(value) {
        const isRealBoardHtml = this.app.isAiMembersBoardHtml ? this.app.isAiMembersBoardHtml(value) : String(value || '').length > 1000;
        const nextValue = isRealBoardHtml ? value : this.lastRealFrameHtml || this.frameHtml || value;
        if (nextValue === this.frameHtml) {
          this.$nextTick(() => this.syncThemeToFrame());
          return;
        }
        if (this.frameHtmlUpdateTimer) window.clearTimeout(this.frameHtmlUpdateTimer);
        this.frameHtmlUpdateTimer = window.setTimeout(() => {
          if (isRealBoardHtml) this.lastRealFrameHtml = value;
          this.frameHtml = nextValue;
          this.frameHtmlUpdateTimer = 0;
          this.$nextTick(() => this.syncThemeToFrame());
        }, 0);
      }
    }
  },
  beforeUnmount() {
    if (this.frameHtmlUpdateTimer) window.clearTimeout(this.frameHtmlUpdateTimer);
  },
  methods: {
    async handleOpenScoreConfig() {
      try {
        await this.app.api('/api/maintenance/open-path', {
          method: 'POST',
          body: JSON.stringify({ path: this.scoreConfigFilePath })
        });
      } catch (error) {
        ElMessage.error(this.app.readApiError?.(error) || '配置表打开失败');
      }
    },
    syncThemeToFrame() {
      const frame = this.$refs.boardFrame;
      if (!frame?.contentWindow) return;
      frame.contentWindow.postMessage({ type: 'platform-theme', theme: this.app.theme || 'light' }, '*');
    }
  }
};
</script>

<style lang="scss">
.ai-board-embed-view {
  display: grid;
  gap: 10px;
  min-height: 0;
}

.ai-board-frame-shell {
  position: relative;
  min-height: 0;
}

.ai-board-frame-shell.locked .ai-board-embed-frame {
  filter: blur(16px) saturate(0.7);
  pointer-events: none;
  user-select: none;
}

.ai-board-lock-mask {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(3px);
}

.ai-board-lock-card {
  display: grid;
  gap: 8px;
  max-width: 360px;
  padding: 18px 20px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--panel) 92%, white 8%);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
  text-align: center;
}

.ai-board-lock-card strong {
  color: var(--heading);
  font-size: 16px;
  font-weight: 780;
  line-height: 1.3;
}

.ai-board-lock-card span {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.ai-score-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: grid;
  gap: 14px;
  padding: 14px;
}

.ai-score-head {
  align-items: start;
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) auto;
}

.ai-score-head h3 {
  color: var(--heading);
  font-size: 15px;
  font-weight: 840;
  line-height: 1.3;
  margin: 0 0 4px;
}

.ai-score-head p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

.ai-score-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  min-width: 0;
}

.ai-score-actions span {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
}

.ai-score-overview {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, minmax(92px, 1fr));
}

.ai-score-overview article {
  background: var(--soft-card);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 8px 10px;
}

.ai-score-overview span,
.ai-score-overview small,
.ai-score-card span,
.ai-score-card small,
.ai-score-card p {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.35;
}

.ai-score-overview strong {
  color: var(--heading);
  font-size: 18px;
  font-weight: 860;
  line-height: 1.1;
}

.ai-score-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.ai-score-loading {
  background: var(--soft-card);
  border: 1px dashed var(--line);
  border-radius: 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
  padding: 12px;
}

.ai-score-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 12px;
}

.ai-score-card-top {
  align-items: start;
  display: flex;
  gap: 10px;
  justify-content: space-between;
  min-width: 0;
}

.ai-score-card-top > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.ai-score-card strong {
  color: var(--heading);
  font-size: 13px;
  font-weight: 820;
  overflow-wrap: anywhere;
  white-space: normal;
}

.ai-score-card b {
  color: var(--primary);
  font-size: 24px;
  font-weight: 900;
  line-height: 1;
}

.ai-score-bar {
  background: var(--soft-card);
  border-radius: 999px;
  height: 6px;
  overflow: hidden;
}

.ai-score-bar i {
  background: var(--primary);
  border-radius: inherit;
  display: block;
  height: 100%;
  max-width: 100%;
}

.ai-score-card.is-good .ai-score-bar i,
.ai-score-card.is-good b {
  color: #16a34a;
}

.ai-score-card.is-good .ai-score-bar i {
  background: #16a34a;
}

.ai-score-card.is-stable .ai-score-bar i,
.ai-score-card.is-stable b {
  color: #2563eb;
}

.ai-score-card.is-stable .ai-score-bar i {
  background: #2563eb;
}

.ai-score-card.is-watch .ai-score-bar i,
.ai-score-card.is-watch b {
  color: #d97706;
}

.ai-score-card.is-watch .ai-score-bar i {
  background: #d97706;
}

.ai-score-card.is-low .ai-score-bar i,
.ai-score-card.is-low b {
  color: #dc2626;
}

.ai-score-card.is-low .ai-score-bar i {
  background: #dc2626;
}

.ai-score-metrics {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.ai-score-metrics span {
  background: var(--soft-card);
  border-radius: 6px;
  color: var(--text);
  font-weight: 720;
  line-height: 1.35;
  min-width: 0;
  padding: 5px 6px;
  text-align: center;
  white-space: normal;
  word-break: keep-all;
}

.ai-score-card p {
  margin: 0;
}

.ai-score-rule-dialog__content {
  display: grid;
  gap: 16px;
}

.ai-score-rule-dialog__section {
  display: grid;
  gap: 8px;
}

.ai-score-rule-dialog__section h4 {
  color: var(--heading);
  font-size: 14px;
  font-weight: 760;
  line-height: 1.4;
  margin: 0;
}

.ai-score-rule-dialog__section p {
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
  margin: 0;
}

.ai-score-rule-dialog__section--file {
  padding-top: 4px;
}

.ai-score-rule-dialog__path {
  border: 1px solid var(--line);
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  padding: 10px 12px;
  background: var(--soft-card);
}

.ai-score-rule-dialog__actions {
  display: flex;
  justify-content: flex-start;
}

.ai-board-switcher {
  display: flex;
  justify-content: flex-start;
  padding: 0 2px;
}

.ai-board-embed-frame {
  width: 100%;
  min-height: 960px;
  height: min(1280px, calc(100vh + 560px));
  border: 0;
  border-radius: 0;
  background: transparent;
}

.ai-board-frame-loading {
  align-items: center;
  background: var(--panel);
  border: 1px dashed var(--line);
  border-radius: 0;
  color: var(--muted);
  display: flex;
  font-size: 12px;
  justify-content: center;
  min-height: 360px;
  padding: 24px;
}

@media (max-width: 1180px) {
  .ai-score-head {
    grid-template-columns: 1fr;
  }

  .ai-score-actions {
    justify-content: flex-start;
  }

  .ai-score-overview,
  .ai-score-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .ai-score-overview,
  .ai-score-grid,
  .ai-score-metrics {
    grid-template-columns: 1fr;
  }

  .ai-board-embed-frame {
    min-height: 760px;
    height: 960px;
  }
}
</style>
