<template>
<section v-show="app.activeView === 'project-detail'" class="view-grid project-detail-view">
  <ElBreadcrumb class="nav-crumbs" separator="/">
    <ElBreadcrumbItem>
      <button type="button" @click="app.goProjectList">任务资产</button>
    </ElBreadcrumbItem>
    <ElBreadcrumbItem>资料库详情</ElBreadcrumbItem>
  </ElBreadcrumb>

  <ElCard shadow="never" class="panel-card page-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>{{ selectedProject?.name || '资料库详情' }}</h3>
        </div>
        <div class="panel-actions">
          <ElButton @click="app.goProjectList">返回 skii 仓库</ElButton>
          <ElButton v-if="app.can('run.create')" type="primary" @click="app.openRunCreateDrawer">新建协作任务</ElButton>
        </div>
      </div>
    </template>

    <div v-if="selectedProject" class="project-detail-dashboard">
      <section class="project-stat-strip" aria-label="资料库指标">
        <div v-for="stat in selectedProjectStats" :key="stat.label">
          <span>{{ stat.label }}</span>
          <strong>{{ stat.value }}</strong>
        </div>
      </section>

      <section class="project-info-panel">
        <div class="project-section-head">
          <h4>资料库说明</h4>
          <p>{{ projectDescription }}</p>
        </div>
        <div class="project-meta-grid">
          <div>
            <span>资料路径</span>
            <strong class="path-with-copy">
              <span>{{ selectedProject.rootPath }}</span>
              <button type="button" class="copy-path-button" @click="app.copyText(selectedProject.rootPath, '资料路径')">复制</button>
            </strong>
          </div>
          <div>
            <span>资料类型</span>
            <strong>{{ selectedProject.framework || selectedScan?.framework || '未知' }}</strong>
          </div>
          <div>
            <span>平台产物</span>
            <strong>workspace/artifacts/{{ selectedProject.id }}</strong>
          </div>
          <div>
            <span>开发命令</span>
            <strong>{{ selectedProject.devCommand || '-' }}</strong>
          </div>
          <div>
            <span>AGENTS 入口</span>
            <strong>{{ selectedProject.agentConfigPath || 'AGENTS.md' }}</strong>
          </div>
          <div>
            <span>技能配置</span>
            <strong>{{ selectedProject.skillConfigPath || '.agent-hub/config.md' }}</strong>
          </div>
        </div>
      </section>

      <section class="project-health-panel">
        <div class="project-section-head">
          <h4>接入检查</h4>
          <p>{{ scanSummary }}</p>
        </div>
        <p class="summary-text inspector-summary">{{ scanSummary }}</p>
        <div class="readiness-list compact-readiness">
          <div v-for="item in readiness" :key="item.label" class="readiness-row">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <ElTag size="small" :type="item.type">{{ item.status }}</ElTag>
          </div>
        </div>
      </section>

      <section class="project-skill-panel">
        <div class="project-section-head">
          <h4>技能路由</h4>
          <p>点击技能查看规则内容，执行任务时会按项目技能和流程级别选择合适路线。</p>
        </div>
        <div class="chip-grid project-skill-grid">
          <button
            v-for="skill in visibleSkills"
            :key="skill.id"
            type="button"
            :class="['skill-chip', { active: app.selectedSkill?.id === skill.id }]"
            @click="app.selectSkill(skill)"
          >
            <span>{{ skill.id }}</span>
            <small v-if="skill.source || skill.statusLabel">{{ skill.source || skill.statusLabel }}</small>
          </button>
          <span v-if="!visibleSkills.length" class="muted">暂无项目技能，执行时会使用平台通用美术流程。</span>
        </div>
      </section>
    </div>
    <div v-else class="empty-block">请先从 skii 仓库选择资料库。</div>
  </ElCard>

</section>
</template>

<script>
export default {
  name: 'ProjectDetailView',
  props: {
    app: {
      type: Object,
      required: true
    },
    selectedProject: {
      type: Object,
      default: null
    },
    selectedScan: {
      type: Object,
      default: null
    },
    projectDescription: {
      type: String,
      default: ''
    },
    selectedProjectStats: {
      type: Array,
      default: () => []
    },
    scanSummary: {
      type: String,
      default: ''
    },
    readiness: {
      type: Array,
      default: () => []
    },
    visibleSkills: {
      type: Array,
      default: () => []
    },
    projectTasks: {
      type: Array,
      default: () => []
    },
    pagedProjectTasks: {
      type: Array,
      default: () => []
    },
    taskPage: {
      type: Number,
      default: 1
    },
    taskPageSize: {
      type: Number,
      default: 10
    },
    loadingScan: {
      type: Boolean,
      default: false
    }
  },
  computed: {}
};
</script>

<style lang="scss">
.project-detail-view {
  min-height: auto;
  grid-template-rows: auto;

  .project-detail-dashboard {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(380px, 0.65fr);
    gap: 16px;
    padding: 16px;
  }

  .project-stat-strip,
  .project-info-panel,
  .project-health-panel,
  .project-skill-panel {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);
  }

  .project-stat-strip,
  .project-skill-panel {
    grid-column: 1 / -1;
  }

  .project-stat-strip {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
    padding: 12px;

    div {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-tint);
    }

    span,
    strong {
      display: block;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 780;
    }

    strong {
      margin-top: 6px;
      color: var(--heading);
      font-size: 20px;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
  }

  .project-info-panel,
  .project-health-panel,
  .project-skill-panel {
    padding: 16px;
  }

  .project-section-head {
    margin-bottom: 14px;

    h4 {
      margin: 0 0 8px;
      color: var(--heading);
      font-size: 18px;
    }

    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.65;
    }
  }

  .project-meta-grid {
    display: grid;
    gap: 10px;

    > div {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel-tint);
    }

    span,
    strong {
      display: block;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 780;
    }

    strong {
      margin-top: 7px;
      color: var(--heading);
      overflow-wrap: anywhere;
    }
  }

  .project-meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));

    strong {
      font-size: 14px;
    }
  }

  .compact-readiness {
    margin-top: 0;
  }

  .inspector-summary {
    display: none;
  }

  .project-skill-grid {
    align-content: start;
    max-height: none;
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

  .project-task-card {
    display: block;
    min-height: auto;
  }

  .project-task-card .el-card__body {
    display: block;
    min-height: auto;
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
    .project-detail-dashboard {
      grid-template-columns: 1fr;
    }

    .project-stat-strip,
    .project-meta-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .project-task-list__head,
    .project-task-list__row {
      grid-template-columns: minmax(360px, 1fr) 120px 86px 76px 76px 170px 112px;
      min-width: 1000px;
    }
  }
}
</style>
