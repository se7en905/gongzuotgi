<template>
  <ElDialog v-model="app.projectDrawer" width="920px" title="接入扫描" class="app-dialog asset-scan-dialog" align-center>
    <section class="asset-scan-form-section">
      <div class="asset-scan-section-head">
        <div>
          <h3>{{ app.projectForm.id ? '编辑扫描源' : '新增扫描源' }}</h3>
          <p>填写 Git 仓库、本地目录或共享盘路径后，工作台会扫描里面的 Skill、MD、插件、规范和任务产物。</p>
        </div>
        <ElButton v-if="app.projectForm.id" plain @click="app.openAssetScanConnect">新增来源</ElButton>
      </div>
      <ElForm :model="app.projectForm" label-position="top" class="asset-scan-form" @submit.prevent>
        <ElFormItem label="扫描源名称" class="is-required-field"><ElInput v-model="app.projectForm.name" placeholder="例如：美术 AI 产物库" /></ElFormItem>
        <ElRow :gutter="12">
          <ElCol :span="24">
            <ElFormItem label="来源类型">
              <ElSelect v-model="app.projectForm.sourceType" @change="app.handleProjectSourceTypeChange">
                <ElOption label="本地目录" value="local" />
                <ElOption label="Git 仓库" value="git" />
                <ElOption label="共享盘" value="shared" />
              </ElSelect>
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
        <ElButton v-if="app.can(app.projectForm.id ? 'project.edit' : 'project.create')" type="primary" class="full-button" @click="app.createProject">{{ app.projectForm.id ? '保存修改并扫描' : '开始扫描' }}</ElButton>
      </ElForm>
    </section>

    <section class="asset-scan-source-section">
      <div class="asset-scan-section-head">
        <div>
          <h3>已接入来源</h3>
          <p>AI 产物清单从这些来源去重读取，页面不再单独展开来源列表。</p>
        </div>
        <ElButton :loading="app.loading.scan" @click="app.scanAllProjects">刷新库存</ElButton>
      </div>
      <ElTable
        class="fill-table skill-source-table"
        :data="app.pagedProjectRows"
        row-key="id"
        highlight-current-row
        :current-row-key="app.selectedProjectId"
        empty-text="暂无扫描来源"
      >
        <ElTableColumn label="来源名称" width="180">
          <template #default="{ row }">
            <div class="project-cell">
              <strong>{{ row.name }}</strong>
              <span>{{ row.sourceTypeLabel }}</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="来源位置" min-width="300">
          <template #default="{ row }">
            <div class="repository-source-cell">
              <span class="path-cell path-with-copy">
                <span>{{ row.rootPath || row.gitRemoteUrl || '-' }}</span>
                <button v-if="row.rootPath || row.gitRemoteUrl" type="button" class="copy-path-button" @click.stop="app.copyText(row.rootPath || row.gitRemoteUrl, '资料路径')">复制</button>
              </span>
              <small v-if="row.rootPath && row.gitRemoteUrl">Git：{{ row.gitRemoteUrl }}</small>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="扫描内容" width="150">
          <template #default="{ row }">
            <div class="repository-scan-cell">
              <span>Skill {{ row.skillCount }}</span>
              <span>MD {{ row.mdCount }}</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="最近同步" width="140">
          <template #default="{ row }">{{ row.lastSyncedAtText }}</template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="100">
          <template #default="{ row }">
            <ElTag :type="row.healthType">{{ row.health }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="170" fixed="right" align="center">
          <template #default="{ row }">
            <div class="table-action-row">
              <ElButton v-if="app.can('project.edit')" plain size="small" @click.stop="app.openProjectEditDrawer(row.project)">编辑</ElButton>
              <ElButton v-if="app.can('project.delete')" type="danger" plain size="small" @click.stop="app.deleteProject(row.project)">删除</ElButton>
            </div>
          </template>
        </ElTableColumn>
      </ElTable>
      <div class="pagination-bar">
        <span>共 {{ app.projectRows.length }} 条</span>
        <ElPagination
          :current-page="app.projectPage" @update:current-page="value => app.projectPage = value"
          :page-size="app.projectPageSize" @update:page-size="value => app.setWorkbenchPageSize(value, 'projectPage')"
          :page-sizes="[10, 50, 100]"
          :total="app.projectRows.length"
          page-size-label="条/页"
          layout="sizes, prev, pager, next"
        />
      </div>
    </section>
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
.asset-scan-dialog {
  .el-dialog__body {
    display: grid;
    gap: 14px;
  }
}

.asset-scan-form-section,
.asset-scan-source-section {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  display: grid;
  gap: 12px;
  padding: 14px;
}

.asset-scan-section-head {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-width: 0;
}

.asset-scan-section-head h3 {
  color: var(--heading);
  font-size: 14px;
  font-weight: 860;
  line-height: 1.3;
  margin: 0 0 4px;
}

.asset-scan-section-head p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
}

.asset-scan-form {
  display: grid;
  gap: 0;
}

.asset-scan-source-section .skill-source-table {
  max-height: 360px;
}

</style>
