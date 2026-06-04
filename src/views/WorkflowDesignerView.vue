<template>
<section v-show="app.activeView === 'workflow-designer'" class="view-grid workflow-designer-view">
  <ElCard shadow="never" class="panel-card page-card workflow-designer-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>自定义工作流</h3>
          <p>把项目技能组合成可复用流程模板，执行时仍复用现有日志、阶段、产物和验收能力。</p>
        </div>
        <div class="panel-actions">
          <ElButton v-if="app.can('workflow.manage')" @click="app.resetWorkflowDesigner">新建模板</ElButton>
          <ElButton v-if="app.can('workflow.manage')" type="primary" @click="app.saveCustomWorkflow">保存模板</ElButton>
        </div>
      </div>
    </template>

    <div class="workflow-designer-layout">
      <aside class="workflow-sidebar">
        <div class="designer-section-head">
          <strong>模板库</strong>
          <span>{{ app.customWorkflows.length }} 个</span>
        </div>
        <div class="preset-template-block">
          <strong>快速生成</strong>
          <div class="preset-template-groups">
            <section v-for="group in app.workflowPresetGroups" :key="group.name">
              <span>{{ group.name }}</span>
              <div class="preset-template-actions">
                <button v-for="preset in group.items" :key="preset.id" type="button" @click="app.applyWorkflowPreset(preset)">
                  {{ preset.name }}
                </button>
              </div>
            </section>
          </div>
        </div>
        <button
          v-for="workflow in app.customWorkflows"
          :key="workflow.id"
          type="button"
          :class="['workflow-template-row', { active: workflow.id === app.workflowDesigner.id }]"
          @click="app.loadCustomWorkflowToDesigner(workflow)"
        >
          <div class="workflow-template-title">
            <strong>{{ workflow.name }}</strong>
            <ElButton v-if="app.can('workflow.manage')" text size="small" @click.stop="app.copyCustomWorkflow(workflow)">复制</ElButton>
          </div>
          <span>{{ app.customWorkflowSummary(workflow) }}</span>
          <small>{{ app.formatDateTime(workflow.updatedAt || workflow.createdAt) }}</small>
        </button>
        <div v-if="!app.customWorkflows.length" class="empty-block">暂无模板，可以先从右侧组合一个流程。</div>
      </aside>

      <main class="workflow-canvas">
        <div class="workflow-form-grid">
          <ElFormItem label="模板名称" class="is-required-field">
            <ElInput v-model="app.workflowDesigner.name" placeholder="例如：Figma 还原验收流程" />
          </ElFormItem>
          <ElFormItem label="适用项目">
            <ElSelect v-model="app.workflowDesigner.projectId" clearable filterable placeholder="不选则作为通用模板">
              <ElOption v-for="project in app.projects" :key="project.id" :label="project.name" :value="project.id" />
            </ElSelect>
          </ElFormItem>
        </div>
        <ElFormItem label="模板说明">
          <ElInput v-model="app.workflowDesigner.description" type="textarea" :rows="2" placeholder="记录这个流程适合的任务类型、证据要求或使用边界。" />
        </ElFormItem>
        <div v-if="!app.workflowDesigner.projectId" class="workflow-scope-note">
          当前是通用模板：不会绑定某个项目的技能库。保存后发起执行时，平台会按目标项目校验所有阶段的 skillId 是否存在。
        </div>

        <div class="designer-section-head stage-head">
          <strong>阶段画布</strong>
          <span>拖拽左侧手柄调整顺序</span>
        </div>
        <div class="level-template-actions">
          <span>从固定流程生成：</span>
          <ElButton v-for="level in app.workflowLevelTemplates" :key="level.level" size="small" @click="app.applyWorkflowLevelTemplate(level)">{{ level.level }} · {{ level.name }}</ElButton>
        </div>
        <div class="custom-stage-list">
          <div
            v-for="(stage, index) in app.workflowDesigner.stages"
            :key="stage.localId"
            class="custom-stage-row"
            draggable="true"
            @dragstart="app.startWorkflowStageDrag(index)"
            @dragover.prevent
            @drop="app.dropWorkflowStage(index)"
          >
            <button type="button" class="stage-drag-handle" aria-label="拖拽排序">
              <ElIcon><Operation /></ElIcon>
            </button>
            <div class="stage-number">{{ index + 1 }}</div>
            <div class="stage-fields">
              <ElInput v-model="stage.name" placeholder="阶段名称" />
              <ElSelect v-model="stage.skillId" filterable clearable placeholder="绑定项目技能">
                <ElOption v-for="skill in app.workflowDesignerSkillOptions" :key="skill.value" :label="skill.label" :value="skill.value" />
              </ElSelect>
              <ElInput v-model="stage.doneCriteria" placeholder="完成判定，例如：有报告和截图证据" />
            </div>
            <div class="stage-flags">
              <ElRadioGroup
                :model-value="app.workflowStageMode(stage)"
                size="small"
                @update:model-value="value => app.setWorkflowStageMode(stage, value)"
              >
                <ElRadioButton label="required">必跑</ElRadioButton>
                <ElRadioButton label="skippable">可跳过</ElRadioButton>
              </ElRadioGroup>
            </div>
            <div class="stage-row-actions">
              <ElButton text :disabled="index === 0" @click="app.moveWorkflowStage(index, -1)">上移</ElButton>
              <ElButton text :disabled="index === app.workflowDesigner.stages.length - 1" @click="app.moveWorkflowStage(index, 1)">下移</ElButton>
              <ElButton text @click="app.copyWorkflowStage(index)">复制</ElButton>
              <ElButton text type="danger" @click="app.removeWorkflowStage(index)">删除</ElButton>
            </div>
          </div>
          <div v-if="!app.workflowDesigner.stages.length" class="empty-block">从右侧技能库添加阶段，或手动新增一个阶段。</div>
        </div>
        <div class="stage-add-actions">
          <ElButton v-if="app.can('workflow.manage')" @click="app.addBlankWorkflowStage">新增空阶段</ElButton>
          <ElButton v-if="app.workflowDesigner.id && app.can('run.create')" type="primary" plain @click="app.createRunFromCustomWorkflow(app.workflowDesigner)">用此模板发起执行</ElButton>
        </div>
      </main>

      <aside class="skill-palette">
        <div class="designer-section-head">
          <strong>技能库</strong>
          <span>{{ app.workflowDesignerSkillOptions.length }} 个</span>
        </div>
        <ElInput v-if="app.workflowDesigner.projectId" v-model="app.workflowDesigner.skillKeyword" clearable placeholder="搜索技能" />
        <div v-if="app.workflowDesigner.projectId" class="skill-palette-list">
          <button v-for="skill in app.filteredWorkflowSkillOptions" :key="skill.value" type="button" class="skill-palette-row" @click="app.addSkillAsWorkflowStage(skill)">
            <strong>{{ skill.value }}</strong>
            <span>{{ skill.title }}</span>
          </button>
          <div v-if="!app.filteredWorkflowSkillOptions.length" class="empty-block">当前项目还没有扫描到技能，或搜索无结果。</div>
        </div>
        <div v-else class="empty-block">选择适用项目后显示该项目技能。通用模板不直接展示任何项目的技能库。</div>
      </aside>
    </div>
  </ElCard>
</section>
</template>

<script>
export default {
  name: 'WorkflowDesignerView',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>
