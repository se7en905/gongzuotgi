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
        <div class="skill-preview-direct-run">
          <div>
            <strong>直接执行到 Figma</strong>
            <span>创建后由执行人本机 Worker 领取，使用执行人自己的 Figma MCP 和 Figma 授权写入。</span>
          </div>
          <ElButton v-if="app.can('run.directSkill.create')" type="primary" size="small" @click="app.openDirectSkillRunDialog(app.skillPreview.skill)">直接执行</ElButton>
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
      <article class="markdown-report skill-preview-content" v-html="app.skillPreviewHtml || '<div class=&quot;empty-block&quot;>正在读取技能内容...</div>'"></article>
    </div>
    <ElDialog v-model="app.directSkillRunDialog.visible" title="直接执行 Skill / md" width="520px" class="app-dialog" append-to-body align-center>
      <ElForm label-position="top" @submit.prevent>
        <ElFormItem label="执行产物">
          <ElInput :model-value="app.directSkillRunDialog.row?.title || app.directSkillRunDialog.row?.productDisplayName || app.directSkillRunDialog.row?.id || '-'" disabled />
        </ElFormItem>
        <ElFormItem label="Figma 链接">
          <ElInput v-model="app.directSkillRunDialog.figmaLinks" type="textarea" :rows="3" placeholder="需要处理 Figma 时粘贴带 node-id 的 Frame 或节点链接；纯生图、本地产物可不填" />
        </ElFormItem>
        <ElFormItem label="写入方式">
          <ElSelect v-model="app.directSkillRunDialog.figmaWriteMode">
            <ElOption label="写入指定节点" value="target-node" />
            <ElOption label="新建页面 / Frame" value="create-page" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="执行人">
          <ElSelect v-model="app.directSkillRunDialog.assignedToUserId" filterable>
            <ElOption
              v-for="user in app.directSkillAssigneeOptions"
              :key="user.id"
              :label="user.displayName || user.username || user.id"
              :value="user.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="补充要求">
          <ElInput v-model="app.directSkillRunDialog.requirement" type="textarea" :rows="4" placeholder="像在本机 Codex 里引用该 Skill / md 后一样，直接说明要做什么。" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="app.directSkillRunDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="app.directSkillRunDialog.submitting" @click="app.createDirectSkillRun">创建直接执行</ElButton>
      </template>
    </ElDialog>
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
</style>
