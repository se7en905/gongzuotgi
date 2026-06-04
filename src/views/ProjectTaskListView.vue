<template>
  <ElCard v-if="projectId" shadow="never" class="panel-card page-card project-task-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>任务列表</h3>
          <p>平台侧沉淀的历史任务产物。点击执行详情进入对应结果页面。</p>
        </div>
        <ElTag>{{ tasks.length }} 个任务</ElTag>
      </div>
    </template>
    <div v-loading="loading && !tasks.length" class="project-task-list" role="table" aria-label="任务列表">
      <div class="project-task-list__head" role="row">
        <span role="columnheader">任务</span>
        <span role="columnheader">状态</span>
        <span role="columnheader">闭环度</span>
        <span role="columnheader">报告</span>
        <span role="columnheader">证据</span>
        <span role="columnheader">更新时间</span>
        <span role="columnheader">操作</span>
      </div>
      <div v-for="row in pagedTasks" :key="row.path || row.name" class="project-task-list__row" role="row">
        <div class="project-cell project-task-main" role="cell">
          <a v-if="zentaoTaskUrl(row)" :href="zentaoTaskUrl(row)" target="_blank" rel="noopener noreferrer" class="task-title-link" @click.stop>{{ row.name }}</a>
          <strong v-else>{{ row.name }}</strong>
          <span class="task-platform-path path-with-copy">
            <span>平台任务路径：{{ projectTaskDisplayPath(row) }}</span>
            <button type="button" class="copy-path-button" @click.stop="copyText(projectTaskDisplayPath(row), '平台任务路径')">复制</button>
          </span>
        </div>
        <div class="project-task-status" role="cell">
          <ElTag :type="statusTagType(row.audit?.status)">{{ statusLabel(row.audit?.status) }}</ElTag>
        </div>
        <div class="project-task-number" role="cell">{{ row.audit?.completion || 0 }}%</div>
        <div class="project-task-number" role="cell">{{ row.audit?.reportCount || 0 }}</div>
        <div class="project-task-number" role="cell">{{ row.audit?.evidenceCount || 0 }}</div>
        <div class="project-task-time" role="cell">{{ formatDateTime(row.updatedAt) }}</div>
        <div class="project-task-action" role="cell">
          <ElButton type="primary" plain size="small" @click.stop="$emit('open-task', row)">执行详情</ElButton>
        </div>
      </div>
      <div v-if="!tasks.length && !loading" class="empty-block">{{ error || '暂无任务' }}</div>
    </div>
    <div class="pagination-bar">
      <span>共 {{ tasks.length }} 条</span>
      <ElPagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 50, 100]"
        :total="tasks.length"
        page-size-label="条/页"
        layout="sizes, prev, pager, next"
      />
    </div>
  </ElCard>
</template>

<script>
export default {
  name: 'ProjectTaskListView',
  props: {
    projectId: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      tasks: [],
      page: 1,
      pageSize: 10,
      loading: false,
      error: ''
    };
  },
  computed: {
    pagedTasks() {
      const start = (this.page - 1) * this.pageSize;
      return this.tasks.slice(start, start + this.pageSize);
    }
  },
  watch: {
    projectId: {
      immediate: true,
      handler() {
        this.page = 1;
        this.loadTasks();
      }
    }
  },
  methods: {
    async loadTasks() {
      if (!this.projectId) {
        this.tasks = [];
        return;
      }
      this.loading = true;
      this.error = '';
      try {
        const scan = await this.readJson(`/api/projects/${encodeURIComponent(this.projectId)}/scan`);
        this.tasks = Array.isArray(scan?.tasks) ? scan.tasks : [];
      } catch (error) {
        this.tasks = [];
        this.error = `任务读取失败：${error?.message || error}`;
      } finally {
        this.loading = false;
      }
    },
    readJson(url) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
            return;
          }
          try {
            resolve(JSON.parse(xhr.responseText || '{}'));
          } catch (error) {
            reject(error);
          }
        };
        xhr.onerror = () => reject(new Error('网络请求失败'));
        xhr.send();
      });
    },
    projectTaskDisplayPath(task = {}) {
      return task.latestRunPath || task.path || '';
    },
    zentaoTaskUrl(task = {}) {
      return task.zentaoUrl || '';
    },
    statusLabel(status = '') {
      return {
        passed: '通过',
        failed: '阻塞',
        blocked: '阻塞',
        conditional: '有条件通过',
        skipped: '跳过',
        unknown: '待复核'
      }[status] || '待复核';
    },
    statusTagType(status = '') {
      return {
        passed: 'success',
        failed: 'danger',
        blocked: 'danger',
        conditional: 'warning',
        skipped: 'info'
      }[status] || 'info';
    },
    formatDateTime(value) {
      const raw = String(value || '').trim();
      if (!raw || /^0{4}[./-]0{1,2}[./-]0{1,2}/.test(raw)) return '-';
      if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{1,2}/.test(raw)) {
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return raw;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
      }
      const match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
      if (match) {
        const hasTime = match[4] !== undefined && match[5] !== undefined;
        const date = hasTime
          ? new Date(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T${String(match[4]).padStart(2, '0')}:${String(match[5]).padStart(2, '0')}:${String(match[6] || '0').padStart(2, '0')}`)
          : new Date(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00`);
        if (Number.isNaN(date.getTime())) return raw;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        if (!hasTime) return `${y}-${m}-${d}`;
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
      }
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return raw;
      const hasTime = /T\d{1,2}:\d{1,2}| \d{1,2}:\d{1,2}/.test(raw);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      if (!hasTime) return `${y}-${m}-${d}`;
      const h = String(date.getHours()).padStart(2, '0');
      const min = String(date.getMinutes()).padStart(2, '0');
      const s = String(date.getSeconds()).padStart(2, '0');
      return `${y}-${m}-${d} ${h}:${min}:${s}`;
    },
    async copyText(value, label = '内容') {
      const text = String(value || '').trim();
      if (!text) return;
      await navigator.clipboard?.writeText(text);
      if (window.ElMessage) window.ElMessage.success(`${label}已复制`);
    }
  }
};
</script>

<style lang="scss">
.project-task-card {
  display: block;
  min-height: auto;

  .el-card__body {
    display: block;
    min-height: auto;
  }
}

.project-cell .task-platform-path {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;

  > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.project-task-list {
  width: 100%;
  overflow-x: auto;
}

.project-task-list__head,
.project-task-list__row {
  display: grid;
  grid-template-columns: minmax(420px, 1fr) 128px 92px 82px 82px 178px 118px;
  min-width: 1120px;
  align-items: center;
}

.project-task-list__head {
  position: sticky;
  top: 0;
  z-index: 1;
  min-height: 44px;
  border-bottom: 1px solid var(--line);
  background: var(--table-header-bg);
  color: var(--muted);
  font-size: 13px;
  font-weight: 760;

  > span {
    padding: 12px 14px;
    white-space: nowrap;
  }
}

.project-task-list__row {
  min-height: 76px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);

  &:hover {
    background: var(--row-bg);
  }

  > div {
    min-width: 0;
    padding: 14px;
  }
}

.project-task-main {
  min-width: 0;
}

.project-task-status,
.project-task-number,
.project-task-time,
.project-task-action {
  display: flex;
  align-items: center;
  min-height: 76px;
}

.project-task-number {
  color: var(--heading);
  font-weight: 760;
}

.project-task-time {
  color: var(--muted);
  font-size: 13px;
}

.project-task-action {
  position: sticky;
  right: 0;
  justify-content: center;
  border-left: 1px solid var(--line);
  background: var(--panel);
  box-shadow: -8px 0 14px rgba(15, 23, 42, 0.04);
}

.project-task-list__row:hover .project-task-action {
  background: var(--row-bg);
}

@media (max-width: 960px) {
  .project-task-list__head,
  .project-task-list__row {
    grid-template-columns: minmax(360px, 1fr) 120px 86px 76px 76px 170px 112px;
    min-width: 1000px;
  }
}
</style>
