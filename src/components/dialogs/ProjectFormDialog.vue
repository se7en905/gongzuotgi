<template>
  <ElDialog v-model="app.projectDrawer" width="560px" :title="app.projectForm.id ? '编辑资料库' : '接入资料库'" class="app-dialog" align-center>
    <ElForm :model="app.projectForm" label-position="top" @submit.prevent>
      <div v-if="!app.projectForm.id" class="project-form-hint">
        填写 Git 仓库、本地目录或共享盘路径后，工作台会扫描里面的 Skill、MD、插件、规范和任务产物。
      </div>
      <ElFormItem label="资料库名称" class="is-required-field"><ElInput v-model="app.projectForm.name" placeholder="例如：美术 AI 研究资料库" /></ElFormItem>
      <ElRow :gutter="12">
        <ElCol :span="12">
          <ElFormItem label="来源类型">
            <ElSelect v-model="app.projectForm.sourceType" @change="app.handleProjectSourceTypeChange">
              <ElOption label="本地目录" value="local" />
              <ElOption label="Git 仓库" value="git" />
              <ElOption label="共享盘" value="shared" />
              <ElOption label="AI 研究" value="research" />
            </ElSelect>
          </ElFormItem>
        </ElCol>
        <ElCol v-if="app.projectForm.sourceType === 'git'" :span="12">
          <ElFormItem label="默认分支">
            <ElInput v-model="app.projectForm.git.defaultBaseBranch" placeholder="main / master，可不填" />
          </ElFormItem>
        </ElCol>
      </ElRow>
      <ElFormItem v-if="app.projectForm.sourceType !== 'git'" label="本地或共享盘路径" class="is-required-field">
        <ElInput v-model="app.projectForm.rootPath" placeholder="例如：/Users/se7en/ArtProject/xxx 或 /Volumes/共享盘/目录">
          <template #append>
            <ElButton v-if="app.can('project.create') || app.can('project.edit')" @click="app.pickProjectDirectory">选择</ElButton>
          </template>
        </ElInput>
      </ElFormItem>
      <ElFormItem v-else label="Git 仓库地址" class="is-required-field">
        <ElInput v-model="app.projectForm.git.remoteUrl" placeholder="http://git.example.com/group/project.git" />
      </ElFormItem>
      <ElRow :gutter="12">
        <ElCol :span="12"><ElFormItem label="Agent 入口"><ElInput v-model="app.projectForm.agentConfigPath" placeholder="AGENTS.md" /></ElFormItem></ElCol>
        <ElCol :span="12"><ElFormItem label="扫描目录"><ElInput v-model="app.projectForm.taskDir" placeholder=".task" /></ElFormItem></ElCol>
      </ElRow>
      <ElButton v-if="app.can(app.projectForm.id ? 'project.edit' : 'project.create')" type="primary" class="full-button" @click="app.createProject">{{ app.projectForm.id ? '保存修改' : '开始扫描' }}</ElButton>
    </ElForm>
  </ElDialog>
</template>

<script>
export default {
  name: 'ProjectFormDialog',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>

<style lang="scss">
.project-form-hint {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-tint);
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

</style>
