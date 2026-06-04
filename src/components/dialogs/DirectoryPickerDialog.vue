<template>
  <ElDialog v-model="app.directoryPicker.visible" width="640px" title="选择项目路径" class="app-dialog" align-center>
    <div class="directory-picker">
      <div class="directory-picker-toolbar">
        <ElInput v-model="app.directoryPicker.currentPath" @keyup.enter="app.loadDirectories(app.directoryPicker.currentPath)" />
        <ElButton @click="app.loadDirectories(app.directoryPicker.currentPath)">打开</ElButton>
      </div>
      <div class="directory-picker-actions">
        <ElButton :disabled="!app.directoryPicker.parentPath" @click="app.loadDirectories(app.directoryPicker.parentPath)">上一级</ElButton>
        <span>{{ app.directoryPicker.directories.length }} 个目录</span>
      </div>
      <div v-loading="app.directoryPicker.loading" class="directory-list">
        <button
          v-for="item in app.directoryPicker.directories"
          :key="item.path"
          type="button"
          class="directory-row"
          @click="app.loadDirectories(item.path)"
        >
          <strong>{{ item.name }}</strong>
          <span>{{ item.path }}</span>
        </button>
        <div v-if="!app.directoryPicker.loading && !app.directoryPicker.directories.length" class="empty-block">当前路径下没有可选目录。</div>
      </div>
      <ElButton type="primary" class="full-button" @click="app.useCurrentDirectory">使用此路径</ElButton>
    </div>
  </ElDialog>
</template>

<script>
export default {
  name: 'DirectoryPickerDialog',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>
