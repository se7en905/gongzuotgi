<template>
  <ElDialog v-model="app.runDiffPreview.visible" width="80vw" :title="app.runDiffPreviewTitle" class="app-dialog diff-preview-dialog" align-center>
    <div class="diff-preview">
      <div class="diff-preview-meta">
        <div class="diff-file-meta">
          <ElTag size="small" effect="plain">{{ app.runDiffPreview.mode || 'diff' }}</ElTag>
          <span>{{ app.runDiffPreview.file }}</span>
          <button type="button" class="copy-path-button" @click="app.copyText(app.runDiffPreview.file, '文件路径')">复制</button>
        </div>
        <div v-if="app.runDiffPreview.mode === 'diff' && app.runDiffPreview.diffIndexes?.length" class="diff-nav">
          <span>{{ app.runDiffPreview.currentDiffIndex + 1 }} / {{ app.runDiffPreview.diffIndexes.length }} 处差异</span>
          <ElButton size="small" :disabled="!visibleNav.canPrev" @click="jumpVisibleDiff('prev')">上一个差异</ElButton>
          <ElButton size="small" :disabled="!visibleNav.canNext" @click="jumpVisibleDiff('next')">下一个差异</ElButton>
        </div>
      </div>
      <div v-if="app.runDiffPreview.mode === 'diff' && app.runDiffPreview.rows?.length" class="side-by-side-diff">
        <div class="diff-pane-head">
          <strong>旧版本</strong>
          <strong>新内容</strong>
        </div>
        <div class="diff-pane-body" ref="runDiffBody" @scroll.passive="updateVisibleDiffState">
          <div
            v-for="row in app.runDiffPreview.rows"
            :key="row.no"
            :class="['diff-row', row.type, { active: row.diffIndex === app.runDiffPreview.diffIndexes?.[app.runDiffPreview.currentDiffIndex] }]"
            :data-diff-index="row.diffIndex ?? null"
          >
            <div class="diff-line old-side">
              <span class="line-no">{{ row.oldLine || '' }}</span>
              <code v-html="app.highlightDiffCode(row.oldText)"></code>
            </div>
            <div class="diff-line new-side">
              <span class="line-no">{{ row.newLine || '' }}</span>
              <code v-if="row.note" class="diff-line-note">{{ row.note }}</code>
              <code v-else v-html="app.highlightDiffCode(row.newText)"></code>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="app.runDiffPreview.mode === 'image'" class="diff-image-compare">
        <div class="diff-pane-head">
          <strong>旧版本</strong>
          <strong>新内容</strong>
        </div>
        <div class="diff-image-grid">
          <div class="diff-image-panel">
            <img v-if="app.runDiffPreview.oldImageUrl" :src="app.runDiffPreview.oldImageUrl" :alt="`${app.runDiffPreview.file} 旧版本`" />
            <div v-else class="diff-image-empty">无旧版本</div>
          </div>
          <div class="diff-image-panel">
            <img v-if="app.runDiffPreview.newImageUrl" :src="app.runDiffPreview.newImageUrl" :alt="`${app.runDiffPreview.file} 新内容`" />
            <div v-else class="diff-image-empty">无新内容</div>
          </div>
        </div>
        <p>{{ app.runDiffPreview.content }}</p>
      </div>
      <div v-else-if="app.runDiffPreview.mode === 'binary'" class="diff-binary-preview">
        <strong>无法进行文本对比</strong>
        <p>{{ app.runDiffPreview.content || '该文件不支持文本 Diff。' }}</p>
      </div>
      <pre v-else>{{ app.runDiffPreview.content || '暂无内容。' }}</pre>
    </div>
  </ElDialog>
</template>

<script>
export default {
  name: 'RunDiffPreviewDialog',
  props: {
    app: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      visibleNav: {
        canPrev: false,
        canNext: false
      },
      syncingVisibleIndex: false,
      programmaticScroll: false
    };
  },
  watch: {
    'app.runDiffPreview.currentDiffIndex'() {
      if (this.syncingVisibleIndex) return;
      this.scheduleScrollToCurrent();
    },
    'app.runDiffPreview.visible'(visible) {
      if (visible) this.scheduleScrollToCurrent();
    },
    'app.runDiffPreview.file'() {
      this.scheduleScrollToCurrent();
    }
  },
  methods: {
    scheduleScrollToCurrent() {
      this.$nextTick(() => {
        this.scrollToCurrent(false, true);
        window.setTimeout(() => this.scrollToCurrent(false, true), 80);
        window.setTimeout(() => this.scrollToCurrent(false, true), 240);
      });
    },
    scrollToCurrent(force = false, updateAfter = false) {
      const body = this.$refs.runDiffBody;
      const preview = this.app.runDiffPreview || {};
      const diffIndex = preview.diffIndexes?.[preview.currentDiffIndex];
      if (!body || diffIndex === undefined) return;
      const target = body.querySelector(`[data-diff-index="${diffIndex}"]`);
      if (!target) return;
      const targetTop = target.offsetTop;
      const desiredTop = force
        ? targetTop - Math.max(96, Math.floor((body.clientHeight - target.offsetHeight) / 2))
        : targetTop - 72;
      body.scrollTo({
        top: Math.max(desiredTop, 0),
        behavior: force ? 'smooth' : 'auto'
      });
      if (updateAfter) window.setTimeout(() => this.updateVisibleDiffState(), force ? 260 : 0);
    },
    diffTargets() {
      const body = this.$refs.runDiffBody;
      const indexes = this.app.runDiffPreview?.diffIndexes || [];
      if (!body || !indexes.length) return [];
      return indexes
        .map((diffIndex, index) => {
          const target = body.querySelector(`[data-diff-index="${diffIndex}"]`);
          return target ? { index, diffIndex, top: target.offsetTop, bottom: target.offsetTop + target.offsetHeight } : null;
        })
        .filter(Boolean);
    },
    updateVisibleDiffState() {
      if (this.programmaticScroll) return;
      const body = this.$refs.runDiffBody;
      const targets = this.diffTargets();
      if (!body || !targets.length) {
        this.visibleNav = { canPrev: false, canNext: false };
        return;
      }
      const viewTop = body.scrollTop;
      const viewBottom = body.scrollTop + body.clientHeight;
      const firstVisible = targets.find(item => item.bottom > viewTop + 8 && item.top < viewBottom - 8);
      const firstBelow = targets.find(item => item.top >= viewBottom - 8);
      const lastAbove = [...targets].reverse().find(item => item.bottom <= viewTop + 8);
      const active = firstVisible || firstBelow || lastAbove || targets[0];
      if (active && this.app.runDiffPreview.currentDiffIndex !== active.index) {
        this.syncingVisibleIndex = true;
        this.app.runDiffPreview.currentDiffIndex = active.index;
        this.$nextTick(() => {
          this.syncingVisibleIndex = false;
        });
      }
      this.visibleNav = {
        canPrev: Boolean(lastAbove || (firstVisible && targets.some(item => item.index < firstVisible.index))),
        canNext: Boolean(firstBelow || (firstVisible && targets.some(item => item.index > firstVisible.index)))
      };
    },
    jumpVisibleDiff(direction) {
      const body = this.$refs.runDiffBody;
      const targets = this.diffTargets();
      if (!body || !targets.length) return;
      const viewTop = body.scrollTop;
      const viewBottom = body.scrollTop + body.clientHeight;
      const target = direction === 'prev'
        ? [...targets].reverse().find(item => item.bottom <= viewTop + 8) || targets[Math.max(0, this.app.runDiffPreview.currentDiffIndex - 1)]
        : targets.find(item => item.top >= viewBottom - 8) || targets[Math.min(targets.length - 1, this.app.runDiffPreview.currentDiffIndex + 1)];
      if (!target) return;
      this.programmaticScroll = true;
      this.app.runDiffPreview.currentDiffIndex = target.index;
      this.$nextTick(() => this.scrollToCurrent(true, false));
      window.setTimeout(() => {
        this.programmaticScroll = false;
        this.updateVisibleDiffState();
      }, 420);
    }
  }
};
</script>
