<template>
<section v-show="app.activeView === 'project-list'" class="view-grid project-list-view art-project-sheet-view">
  <ElCard shadow="never" class="panel-card page-card sheet-table-card">
    <template #header>
      <div class="sheet-table-toolbar">
        <div class="panel-actions">
          <ElInput
            v-model="app.artProjectSheetKeyword"
            clearable
            class="sheet-search-input"
            placeholder="搜索项目名或链接"
          />
          <ElButton :loading="app.loading.artProjectSheet" @click="app.refreshArtProjectSheet">刷新 Google 表</ElButton>
          <ElButton v-if="app.can('artProjectSheet.manage')" type="primary" @click="app.openArtProjectSheetRowCreate">新增项目</ElButton>
          <ElButton v-if="app.can('artProjectSheet.manage')" plain @click="app.openArtProjectSheetFieldCreate">新增字段</ElButton>
          <ElButton type="primary" plain tag="a" :href="app.artProjectSheetSourceUrl" target="_blank" rel="noopener noreferrer">打开原表</ElButton>
        </div>
      </div>
    </template>

    <ElTable
      class="fill-table"
      :data="app.pagedArtProjectSheetRows"
      row-key="id"
      empty-text="暂无项目表数据"
    >
      <ElTableColumn
        v-for="field in app.visibleArtProjectSheetFields"
        :key="field.key"
        :label="field.label"
        :min-width="field.key === 'file' ? 220 : 170"
        :fixed="field.key === 'file' ? 'left' : false"
      >
        <template #default="{ row }">
          <div class="project-cell sheet-dynamic-cell">
            <strong v-if="field.key === 'file'">{{ displayValue(app.artProjectSheetFieldValue(row, field)) }}</strong>
            <a
              v-else-if="app.isArtProjectSheetUrlField(field, app.artProjectSheetFieldValue(row, field)) && app.artProjectSheetFieldValue(row, field)"
              :href="app.artProjectSheetHref(app.artProjectSheetFieldValue(row, field))"
              target="_blank"
              rel="noopener noreferrer"
              class="table-link"
              :title="app.artProjectSheetHref(app.artProjectSheetFieldValue(row, field))"
            >{{ app.artProjectSheetLinkText(field, app.artProjectSheetFieldValue(row, field)) }}</a>
            <span v-else>{{ displayValue(app.artProjectSheetFieldValue(row, field)) }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="app.can('artProjectSheet.manage')" label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <div class="table-action-row">
            <ElButton plain size="small" @click="app.openArtProjectSheetRowEdit(row)">编辑</ElButton>
            <ElButton type="danger" plain size="small" @click="app.deleteArtProjectSheetRow(row)">删除</ElButton>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>
    <div class="pagination-bar">
      <span>共 {{ app.filteredArtProjectSheetRows.length }} 条</span>
      <ElPagination
        :current-page="app.artProjectSheetPage" @update:current-page="value => app.artProjectSheetPage = value"
        :page-size="app.artProjectSheetPageSize" @update:page-size="value => app.setWorkbenchPageSize(value, 'artProjectSheetPage')"
        :page-sizes="[10, 50, 100]"
        :total="app.filteredArtProjectSheetRows.length"
        page-size-label="条/页"
        layout="sizes, prev, pager, next"
      />
    </div>
  </ElCard>

  <ElDialog v-model="app.artProjectSheetDialog.visible" width="720px" :title="app.artProjectSheetDialog.form.id ? '编辑项目字段' : '新增项目'" class="app-dialog" align-center>
    <ElForm :model="app.artProjectSheetDialog.form" label-position="top" @submit.prevent>
      <div class="project-sheet-form-grid">
        <ElFormItem
          v-for="field in app.visibleArtProjectSheetFields"
          :key="field.key"
          :label="field.label"
          :class="{ 'is-required-field': field.key === 'file' }"
        >
          <ElInput
            :model-value="app.artProjectSheetFieldValue(app.artProjectSheetDialog.form, field)"
            :placeholder="field.type === 'url' ? 'https://...' : `请输入${field.label}`"
            @update:model-value="value => app.setArtProjectSheetFieldValue(app.artProjectSheetDialog.form, field, value)"
          />
        </ElFormItem>
      </div>
      <ElButton type="primary" class="full-button" :loading="app.loading.artProjectSheet" @click="app.saveArtProjectSheetRow">保存项目</ElButton>
    </ElForm>
  </ElDialog>

  <ElDialog v-model="app.artProjectSheetFieldDialog.visible" width="460px" :title="app.artProjectSheetFieldDialog.form.key ? '编辑字段' : '新增字段'" class="app-dialog" align-center>
    <ElForm :model="app.artProjectSheetFieldDialog.form" label-position="top" @submit.prevent>
      <ElFormItem label="字段名称" class="is-required-field">
        <ElInput v-model="app.artProjectSheetFieldDialog.form.label" placeholder="例如：美术验收链接" />
      </ElFormItem>
      <ElFormItem label="字段类型">
        <ElSegmented
          v-model="app.artProjectSheetFieldDialog.form.type"
          :options="[{ label: '文本', value: 'text' }, { label: '链接', value: 'url' }]"
        />
      </ElFormItem>
      <ElFormItem label="排序">
        <ElInputNumber v-model="app.artProjectSheetFieldDialog.form.order" :min="1" :step="10" />
      </ElFormItem>
      <div class="form-actions">
        <ElButton
          v-if="app.artProjectSheetFieldDialog.form.key && !app.artProjectSheetFieldDialog.form.locked"
          type="danger"
          plain
          :loading="app.loading.artProjectSheet"
          @click="app.deleteArtProjectSheetField(app.artProjectSheetFieldDialog.form)"
        >删除字段</ElButton>
        <ElButton type="primary" :loading="app.loading.artProjectSheet" @click="app.saveArtProjectSheetField">保存字段</ElButton>
      </div>
    </ElForm>
  </ElDialog>
</section>
</template>

<script>
export default {
  name: 'ProjectListView',
  props: {
    app: {
      type: Object,
      required: true
    }
  },
  methods: {
    displayValue(value) {
      return String(value || '').trim();
    }
  }
};
</script>

<style lang="scss">
.art-project-sheet-view {
  display: grid;
  gap: 0;

  .sheet-table-card {
    min-height: 0;
  }

  .sheet-table-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
  }

  .sheet-search-input {
    width: 260px;
  }

  .table-link {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    color: color-mix(in srgb, var(--el-text-color-regular) 82%, var(--primary) 18%);
    font-weight: 760;
    text-decoration: none;
    text-overflow: ellipsis;
    vertical-align: bottom;
    white-space: nowrap;

    &:hover {
      color: var(--primary-ink);
      text-decoration: underline;
    }
  }

  .empty-cell {
    display: inline-block;
    min-height: 1px;
  }

  .sheet-dynamic-cell {
    min-height: 20px;

    strong {
      color: var(--el-text-color-regular);
      font-weight: 760;
    }

    span {
      color: var(--text);
    }
  }

  .project-sheet-form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 12px;
  }

  @media (max-width: 900px) {
    .sheet-table-toolbar {
      align-items: stretch;
      flex-direction: column;
    }

    .panel-actions,
    .sheet-search-input {
      width: 100%;
    }
  }
}
</style>
