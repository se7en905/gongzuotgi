<template>
  <ElDrawer
    v-model="app.skillPreview.visible"
    title="内容预览"
    direction="rtl"
    size="50%"
    class="app-dialog art-progress-log-drawer skill-preview-drawer"
    append-to-body
    :with-header="true"
  >
    <div v-if="app.skillPreview.skill" class="skill-preview">
      <div class="skill-preview-manage">
        <div class="skill-preview-version-row skill-preview-alias-row">
          <span>调用别名</span>
          <ElInput
            v-model="app.skillPreviewAliasesDraft"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            class="skill-preview-alias-input"
            placeholder="多个别名用顿号、逗号或换行隔开"
            :disabled="!app.can('skill.alias.manage')"
          />
          <ElButton v-if="app.can('skill.alias.manage')" size="small" :loading="app.loading.skillVersion" @click="app.saveSkillPreviewAlias">保存别名</ElButton>
        </div>
        <div class="skill-trigger-list skill-preview-alias-tags">
          <strong>当前别名</strong>
          <span v-for="alias in app.skillPreviewEffectiveAliases" :key="alias">{{ alias }}</span>
          <span v-if="!app.skillPreviewEffectiveAliases.length">暂无别名</span>
        </div>
      </div>
      <article class="markdown-report skill-preview-content" v-html="app.skillPreviewHtml || '<div class=&quot;empty-block&quot;>正在读取技能内容...</div>'"></article>
    </div>
  </ElDrawer>
</template>

<script>
export default {
  name: 'SkillPreviewDialog',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>
