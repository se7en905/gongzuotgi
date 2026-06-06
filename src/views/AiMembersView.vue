<template>
<section v-show="app.activeView === 'ai-members'" class="ai-board-embed-view">
  <div v-if="app.isPlatformAdmin" class="ai-board-switcher">
    <ElSegmented v-if="boardModeOptions.length > 1" v-model="app.aiMembersBoardMode" :options="boardModeOptions" />
  </div>
  <section class="ai-score-panel">
    <div class="ai-score-head">
      <div>
        <h3>当月 AI 评分</h3>
        <p>{{ app.aiScoreMonthDisplay }} · {{ app.aiMemberScoreRuleText }}</p>
      </div>
    </div>
    <div v-if="!app.aiMemberScoreReady" class="ai-score-loading">正在整理当月 AI 评分...</div>
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
          <span>验证 {{ member.monthValidationCount }}</span>
          <span>执行 {{ member.monthRunCount }}</span>
        </div>
        <p>{{ member.reason }}</p>
      </article>
    </div>
  </section>
  <div v-if="!app.aiMembersBoardFrameReady" class="ai-board-frame-loading">正在载入 AI 部门看板...</div>
  <iframe
    v-else
    ref="boardFrame"
    class="ai-board-embed-frame"
    :srcdoc="frameHtml"
    title="AI部门看板"
    @load="syncThemeToFrame"
  />
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
    boardModeOptions() {
      return [
        this.app.can('menu.aiMembers.owner') ? { label: '负责人看板', value: 'owner' } : null,
        this.app.can('menu.aiMembers.member') ? { label: '组员看板', value: 'member' } : null
      ].filter(Boolean);
    },
    snapshot() {
      return this.app.aiMembersSnapshot || {};
    },
    boardHtml() {
      return this.snapshot.html || '<!doctype html><html lang="zh-CN"><body><p>正在加载 AI部门看板...</p></body></html>';
    },
    activeBoardHtml() {
      if (!this.app.can('menu.aiMembers.owner')) return this.snapshot.memberHtml || this.boardHtml;
      if (this.app.aiMembersBoardMode === 'owner' && !this.snapshot.ownerHtml) return this.snapshot.memberHtml || this.boardHtml;
      return this.app.aiMembersBoardMode === 'member'
        ? (this.snapshot.memberHtml || this.boardHtml)
        : (this.snapshot.ownerHtml || this.boardHtml);
    }
  },
  data() {
    return {
      frameHtml: '',
      frameHtmlUpdateTimer: 0
    };
  },
  watch: {
    'app.theme'() {
      this.syncThemeToFrame();
    },
    activeBoardHtml: {
      immediate: true,
      handler(value) {
        if (!this.app.aiMembersBoardFrameReady) return;
        if (value === this.frameHtml) {
          this.$nextTick(() => this.syncThemeToFrame());
          return;
        }
        if (this.frameHtmlUpdateTimer) window.clearTimeout(this.frameHtmlUpdateTimer);
        this.frameHtmlUpdateTimer = window.setTimeout(() => {
          this.frameHtml = value;
          this.frameHtmlUpdateTimer = 0;
          this.$nextTick(() => this.syncThemeToFrame());
        }, 0);
      }
    },
    'app.aiMembersBoardFrameReady'(ready) {
      if (!ready) return;
      const value = this.activeBoardHtml;
      if (value === this.frameHtml) {
        this.$nextTick(() => this.syncThemeToFrame());
        return;
      }
      if (this.frameHtmlUpdateTimer) window.clearTimeout(this.frameHtmlUpdateTimer);
      this.frameHtmlUpdateTimer = window.setTimeout(() => {
        this.frameHtml = value;
        this.frameHtmlUpdateTimer = 0;
        this.$nextTick(() => this.syncThemeToFrame());
      }, 0);
    }
  },
  beforeUnmount() {
    if (this.frameHtmlUpdateTimer) window.clearTimeout(this.frameHtmlUpdateTimer);
  },
  methods: {
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
  grid-template-columns: minmax(0, 1fr);
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
