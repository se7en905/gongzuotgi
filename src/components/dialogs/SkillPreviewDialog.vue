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
      <template v-if="app.canViewSkillPreview">
        <div class="skill-preview-manage">
          <div class="skill-preview-direct-run">
            <div>
              <strong>创建直接执行</strong>
              <span>使用美术执行台同一套创建流程；Figma 链接可选，创建后由执行人本机 Worker 领取并回传产物。</span>
            </div>
            <ElButton v-if="app.can('run.create')" type="primary" size="small" @click="app.createRunFromSkillInventoryRow(app.skillPreview.skill)">直接执行</ElButton>
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
          <div v-if="app.skillPreviewCanEditExecutionKind" class="skill-preview-version-row skill-preview-alias-row">
            <span>执行方式</span>
            <ElSelect
              :model-value="app.skillPreviewExecutionKindValue"
              :disabled="app.loading.skillVersion"
              class="skill-preview-execution-kind-select"
              @change="value => app.saveSkillPreviewExecutionKind(value)"
            >
              <ElOption label="默认" value="default" />
              <ElOption label="纯生图" value="image-generation" />
            </ElSelect>
          </div>
        </div>
        <article class="markdown-report skill-preview-content" v-html="app.skillPreviewHtml || '<div class=&quot;empty-block&quot;>正在读取技能内容...</div>'"></article>
      </template>
      <div v-else class="skill-preview-locked">
        <strong>内容预览已关闭</strong>
        <span>当前角色可以进入 AI 产物清单，但不能打开正文预览。</span>
        <div class="empty-block">如需开放，请在角色管理里勾选“查看产物内容预览”。</div>
      </div>
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

<style scoped lang="scss">
.skill-preview-direct-run {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: #f8fafc;

  div {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  strong {
    color: #0f172a;
    font-size: 14px;
  }

  span {
    color: #64748b;
    font-size: 12px;
    line-height: 1.5;
  }
}

.skill-preview-locked {
  display: grid;
  gap: 10px;
  padding: 20px 16px;
}

.skill-preview-locked strong {
  color: #0f172a;
  font-size: 16px;
  font-weight: 700;
}

.skill-preview-locked span {
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}
</style>
