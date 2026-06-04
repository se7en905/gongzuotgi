<template>
  <ElDialog v-model="app.skillPreview.visible" width="860px" title="内容预览" class="app-dialog skill-preview-dialog" align-center>
    <div v-if="app.skillPreview.skill" class="skill-preview">
      <article class="markdown-report skill-preview-content" v-html="app.skillPreviewHtml || '<div class=&quot;empty-block&quot;>正在读取技能内容...</div>'"></article>
      <div class="skill-preview-manage">
        <div class="skill-preview-version-row">
          <span>版本</span>
          <ElInput
            v-model="app.skillPreviewVersionDraft"
            size="small"
            class="skill-preview-version-input"
            placeholder="例如 1.0"
            :disabled="!app.can('skill.version.manage')"
            @change="app.saveSkillPreviewVersion"
          />
          <ElButton v-if="app.can('skill.version.manage')" size="small" :loading="app.loading.skillVersion" @click="app.saveSkillPreviewVersion">保存版本</ElButton>
        </div>
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
    </div>
  </ElDialog>
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
