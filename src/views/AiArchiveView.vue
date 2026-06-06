<template>
<section v-show="app.activeView === 'ai-archive'" class="view-grid ai-archive-view">
  <ElCard shadow="never" class="panel-card page-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>AI档案</h3>
          <p>完整保存美术执行台和直接执行的明细记录；删除明细只清理后端执行数据，不回退产物调用次数。</p>
        </div>
        <label class="ai-archive-search-field">
          <span>关键词</span>
          <ElInput v-model="app.aiExecutionArchiveFilters.keyword" clearable placeholder="执行内容、Skill/md、Figma 链接、执行人" />
        </label>
      </div>
    </template>

    <div class="ai-archive-filters">
      <label class="ai-archive-filter-field">
        <span>执行人 / 操作人</span>
        <ElSelect v-model="app.aiExecutionArchiveFilters.userId" clearable filterable placeholder="全部人员">
          <ElOption v-for="user in app.users" :key="user.id" :label="user.displayName || user.username" :value="user.id" />
        </ElSelect>
      </label>
      <label class="ai-archive-filter-field">
        <span>类型</span>
        <ElSelect v-model="app.aiExecutionArchiveFilters.sourceType" clearable placeholder="全部类型">
          <ElOption label="直接执行" value="direct-skill" />
          <ElOption label="任务执行" value="task" />
          <ElOption label="Bug 执行" value="bug" />
        </ElSelect>
      </label>
      <label class="ai-archive-filter-field">
        <span>状态</span>
        <ElSelect v-model="app.aiExecutionArchiveFilters.status" clearable placeholder="全部状态">
          <ElOption label="待领取" value="pending" />
          <ElOption label="已领取" value="claimed" />
          <ElOption label="执行中" value="running" />
          <ElOption label="已完成" value="completed" />
          <ElOption label="失败" value="failed" />
          <ElOption label="阻塞" value="blocked" />
          <ElOption label="已取消" value="cancelled" />
        </ElSelect>
      </label>
      <label class="ai-archive-filter-field">
        <span>开始时间</span>
        <ElDatePicker v-model="app.aiExecutionArchiveFilters.from" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="不限" />
      </label>
      <label class="ai-archive-filter-field">
        <span>结束时间</span>
        <ElDatePicker v-model="app.aiExecutionArchiveFilters.to" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="不限" />
      </label>
      <div class="ai-archive-filter-actions">
        <ElButton plain @click="app.resetAiExecutionArchiveFilters">重置</ElButton>
        <ElButton v-if="app.can('api.aiArchive.delete')" type="danger" plain :loading="app.loading.runs" @click="app.deleteAiExecutionArchiveRunsByCurrentFilters">删除当前范围</ElButton>
      </div>
    </div>

    <ElTable class="skill-clean-table ai-archive-table" :data="app.aiExecutionArchiveRunRows" table-layout="fixed" empty-text="暂无 AI 执行档案" v-loading="app.loading.runs">
      <ElTableColumn label="执行内容" min-width="260">
        <template #default="{ row }">
          <button type="button" class="ai-archive-run-title" @click="app.openRun(row)">
            <strong>{{ app.directSkillRunContentName(row) }}</strong>
            <span>{{ app.directSkillRunContentKind(row) }}</span>
          </button>
        </template>
      </ElTableColumn>
      <ElTableColumn label="类型" width="100">
        <template #default="{ row }">{{ app.directSkillRunContentKind(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="操作人" width="120">
        <template #default="{ row }">{{ app.directSkillRunOperatorName(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="执行人" width="120">
        <template #default="{ row }">{{ row.assignedToName || row.developer || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="110">
        <template #default="{ row }">
          <ElTag size="small" :type="app.runTagType(row.status)">{{ app.directSkillRunStatusLabel(row) || app.runStatusLabel(row.status) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="Figma 链接" min-width="180">
        <template #default="{ row }">
          <a v-if="row.figmaLinks" :href="row.figmaLinks" target="_blank" rel="noopener noreferrer">打开 Figma</a>
          <span v-else>-</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="创建时间" width="150">
        <template #default="{ row }">{{ app.formatDateTime(row.createdAt) || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="更新时间" width="150">
        <template #default="{ row }">{{ app.directSkillRunUpdatedText(row) }}</template>
      </ElTableColumn>
    </ElTable>
  </ElCard>
</section>
</template>

<script>
export default {
  name: 'AiArchiveView',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>

<style scoped lang="scss">
.ai-archive-view {
  grid-template-columns: minmax(0, 1fr);
}

.ai-archive-filters {
  display: grid;
  grid-template-columns: repeat(5, minmax(150px, 1fr)) auto;
  gap: 12px;
  align-items: end;
  padding: 14px;
}

.ai-archive-search-field {
  display: grid;
  gap: 6px;
  width: min(420px, 34vw);
  min-width: 280px;

  span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }
}

.ai-archive-filter-field {
  display: grid;
  gap: 6px;
  min-width: 0;

  span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }
}

.ai-archive-filter-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ai-archive-run-title {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
  cursor: pointer;
  appearance: none;
  text-align: left;

  strong,
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--muted);
    font-size: 12px;
  }
}

@media (max-width: 1200px) {
  .ai-archive-search-field {
    width: min(360px, 42vw);
    min-width: 220px;
  }

  .ai-archive-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .ai-archive-search-field {
    width: 100%;
    min-width: 0;
  }

  .ai-archive-filters {
    grid-template-columns: 1fr;
  }
}
</style>
