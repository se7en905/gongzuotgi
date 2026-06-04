<template>
<section v-show="app.activeView === 'ai-members'" class="ai-board-embed-view">
  <div v-if="app.isPlatformAdmin" class="ai-board-switcher">
    <ElSegmented v-if="boardModeOptions.length > 1" v-model="app.aiMembersBoardMode" :options="boardModeOptions" />
  </div>
  <iframe
    ref="boardFrame"
    class="ai-board-embed-frame"
    :srcdoc="activeBoardHtml"
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
  watch: {
    'app.theme'() {
      this.syncThemeToFrame();
    },
    activeBoardHtml() {
      this.$nextTick(() => this.syncThemeToFrame());
    }
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
  min-height: calc(100vh - 112px);
}

.ai-board-switcher {
  display: flex;
  justify-content: flex-start;
  padding: 0 2px;
}

.ai-board-embed-frame {
  width: 100%;
  min-height: 0;
  height: calc(100vh - 154px);
  border: 0;
  border-radius: 0;
  background: transparent;
}
</style>
