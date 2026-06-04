<template>
  <ElDialog v-model="app.runDrawer" width="680px" :title="app.runDialogTitle" class="app-dialog art-run-dialog" align-center>
    <ElForm :model="app.runForm" label-position="top" @submit.prevent>
      <ElFormItem label="项目" class="is-required-field">
        <ElSelect v-model="app.runForm.projectId" placeholder="选择项目">
          <ElOption v-for="project in app.projects" :key="project.id" :label="project.name" :value="project.id" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="关联业务任务">
        <ElSelect v-model="app.runForm.taskId" placeholder="可选；建议关联禅道任务，方便自动归档和验收" clearable filterable>
          <ElOption
            v-for="task in app.businessTasksForProject(app.runForm.projectId)"
            :key="task.id"
            :label="app.taskDisplayTitle(task)"
            :value="task.id"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="美术执行方式" class="is-required-field">
        <ElSelect v-model="app.runForm.executionMode" :disabled="app.isBugFixRun">
          <ElOption label="按任务复杂度自动执行" value="level-process" />
          <ElOption label="只执行一个规范 / Skill" value="single-skill" />
          <ElOption label="按自定义美术流程执行" value="custom-workflow" />
        </ElSelect>
        <div class="field-hint">自动执行会读取任务资料、Figma 线索、规范 md 和项目 Skill；只执行一个 Skill 适合单独验证规范、走查或生成指定产物。</div>
      </ElFormItem>
      <ElFormItem v-if="app.isLevelProcessRun" label="执行范围" class="is-required-field">
        <ElSegmented v-model="app.runForm.workflowLevel" :options="app.workflowLevelOptions" />
      </ElFormItem>
      <ElFormItem v-if="app.isCustomWorkflowRun" label="自定义美术流程" class="is-required-field">
        <ElSelect v-model="app.runForm.customWorkflowId" filterable placeholder="选择一个已保存的自定义工作流">
          <ElOption v-for="workflow in app.runnableCustomWorkflows" :key="workflow.id" :label="app.customWorkflowOptionLabel(workflow)" :value="workflow.id" />
        </ElSelect>
      </ElFormItem>
      <div v-if="app.selectedWorkflowPlan" class="workflow-plan-preview">
        <div class="workflow-plan-head">
          <div>
            <strong>{{ app.selectedWorkflowPlan.level }} · {{ app.selectedWorkflowPlan.name }}</strong>
            <span>{{ app.selectedWorkflowPlan.summary }}</span>
          </div>
          <ElTag size="small" effect="plain">{{ app.selectedWorkflowPlan.workflow }}</ElTag>
        </div>
        <div class="workflow-stage-list">
          <span v-for="stage in app.selectedWorkflowPlan.stages" :key="stage.no">{{ stage.no }}. {{ stage.name }}</span>
        </div>
        <p>{{ app.selectedWorkflowRuleText }}</p>
      </div>
      <ElFormItem :label="app.isBugFixRun ? 'Bug 标题' : '美术任务标题'" class="is-required-field"><ElInput v-model="app.runForm.title" :placeholder="app.isBugFixRun ? 'Bug 标题' : '例如：弹窗规范走查 / Figma 页面生成 / Skill 验证'" /></ElFormItem>
      <ElRow :gutter="12">
        <ElCol :span="12">
          <ElFormItem label="规范 / Skill / 执行类型" :class="{ 'is-required-field': app.isSingleSkillRun }">
            <ElSelect
              v-if="app.currentProjectSkillOptions.length"
              v-model="app.runForm.stage"
              filterable
              clearable
              :placeholder="app.isSingleSkillRun ? '选择要执行的规范或 Skill' : '可选；留空由系统按任务自动推荐'"
            >
              <ElOption
                v-for="skill in app.currentProjectSkillOptions"
                :key="skill.value"
                :label="skill.label"
                :value="skill.value"
              >
                <div class="skill-option-row">
                  <strong>{{ skill.value }}</strong>
                  <span>{{ skill.title }}</span>
                </div>
              </ElOption>
            </ElSelect>
            <ElInput v-else v-model="app.runForm.stage" placeholder="项目还未扫描到 Skill，可填写规范名、md 文件名或执行类型" />
          </ElFormItem>
        </ElCol>
        <ElCol :span="12"><ElFormItem label="禅道 ID"><ElInput v-model="app.runForm.zentaoId" placeholder="48031" /></ElFormItem></ElCol>
      </ElRow>
      <ElFormItem label="负责人 / 执行人"><ElInput v-model="app.runForm.developer" placeholder="成员姓名" /></ElFormItem>
      <ElFormItem :label="app.isBugFixRun ? '影响页面' : '目标页面 / Figma 放置位置'"><ElInput v-model="app.runForm.targetPage" placeholder="例如：任务中心弹窗 / Figma 指定页面或 Frame / 本地产物目录" /></ElFormItem>
      <template v-if="!app.isBugFixRun">
        <ElFormItem label="Figma 线索">
          <ElInput v-model="app.runForm.figmaLinks" type="textarea" :rows="3" placeholder="可填写多个 Figma 地址或 node-id，每行一个；多主题项目按主题分别填写。" />
          <div class="field-hint">创建后会写入本次执行目录的资料.md；启动后 Codex 会优先读取 Figma 线索，能写入 Figma 时才生成或放置界面。</div>
        </ElFormItem>
        <ElFormItem label="规范 md / Skill 线索">
          <ElInput v-model="app.runForm.showdocHints" type="textarea" :rows="3" placeholder="填写规范 md、SKILL.md、产物清单路径或关键词；留空则按任务标题和项目 Skill 自动匹配。" />
          <div class="field-hint">这里可以填按钮规范、弹窗规范、图标规范、figma-use、gpt-image、ui-ux-pro-max 等线索。</div>
        </ElFormItem>
      </template>
      <ElFormItem :label="app.isBugFixRun ? '修复要求' : '美术执行说明'"><ElInput v-model="app.runForm.requirement" type="textarea" :rows="8" :placeholder="app.isBugFixRun ? '描述复现方式、实际表现、期望结果、验证范围。' : '补充任务背景、需要生成/走查/套用的内容、验收标准、放置位置和不能改动的范围。'" /></ElFormItem>
      <ElButton v-if="app.can('run.create')" type="primary" class="full-button" @click="app.createRun">{{ app.runSubmitLabel }}</ElButton>
    </ElForm>
  </ElDialog>
</template>

<script>
export default {
  name: 'RunCreateDialog',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>
