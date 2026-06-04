<template>
  <ElDialog v-model="app.taskSyncDrawer" width="520px" :title="app.taskSyncButtonText" class="app-dialog" align-center>
    <ElForm :model="app.taskSyncForm" label-position="top" @submit.prevent>
      <ElFormItem label="项目" class="is-required-field">
        <ElSelect v-model="app.taskSyncForm.projectId" placeholder="选择要同步到的项目" filterable>
          <ElOption v-for="project in app.projects" :key="project.id" :label="project.name" :value="project.id" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem v-if="app.taskCenterMode === 'bug'" label="Bug 产品 ID">
        <ElInput v-model="app.taskSyncForm.products" placeholder="默认按 ZENTAO_BUG_PRODUCT_IDS，可逗号分隔多个产品" />
      </ElFormItem>
      <ElButton v-if="app.can('task.sync')" type="primary" class="full-button" :loading="app.loading.syncTasks" @click="app.syncZentaoTasks">开始同步</ElButton>
    </ElForm>
  </ElDialog>
</template>

<script>
export default {
  name: 'TaskSyncDialog',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>
