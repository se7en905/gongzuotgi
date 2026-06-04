<template>
<section v-show="app.activeView === 'skii-repository'" class="view-grid project-list-view">
  <ElCard shadow="never" class="panel-card page-card">
    <ElTable
      class="fill-table"
      :data="app.pagedProjectRows"
      row-key="id"
      highlight-current-row
      :current-row-key="app.selectedProjectId"
      @row-click="row => app.openProjectDetail(row.project)"
      empty-text="暂无资料库"
    >
      <ElTableColumn label="资料来源" width="220">
        <template #default="{ row }">
          <div class="project-cell">
            <strong>{{ row.name }}</strong>
            <span>{{ row.sourceTypeLabel }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="来源位置" min-width="360">
        <template #default="{ row }">
          <div class="repository-source-cell">
            <span class="path-cell path-with-copy">
              <span>{{ row.rootPath || '-' }}</span>
              <button v-if="row.rootPath" type="button" class="copy-path-button" @click.stop="app.copyText(row.rootPath, '资料路径')">复制</button>
            </span>
            <small v-if="row.gitRemoteUrl">Git：{{ row.gitRemoteUrl }}</small>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="扫描内容" width="180">
        <template #default="{ row }">
          <div class="repository-scan-cell">
            <span>Skill {{ row.skillCount }}</span>
            <span>MD {{ row.mdCount }}</span>
            <span>任务 {{ row.taskCount }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="最近同步" width="150">
        <template #default="{ row }">{{ row.lastSyncedAtText }}</template>
      </ElTableColumn>
      <ElTableColumn label="规则状态" width="120">
        <template #default="{ row }">
          <ElTag :type="row.healthType">{{ row.health }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <div class="table-action-row">
            <ElButton v-if="app.can('project.edit')" plain size="small" @click.stop="app.openProjectEditDrawer(row.project)">编辑</ElButton>
            <ElButton type="primary" plain size="small" @click.stop="app.openProjectDetail(row.project)">详情</ElButton>
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
  </ElCard>
</section>
</template>

<script>
export default {
  name: 'SkiiRepositoryView',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>

<style lang="scss" scoped>
.repository-source-cell {
  display: grid;
  gap: 4px;
  min-width: 0;

  small {
    color: var(--muted);
    display: block;
    font-size: 12px;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.repository-scan-cell {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--primary-ink);
    font-size: 12px;
    font-weight: 720;
    line-height: 1;
    padding: 5px 8px;
  }
}
</style>
