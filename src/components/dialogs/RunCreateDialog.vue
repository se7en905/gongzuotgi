<template>
  <ElDialog v-model="app.runDrawer" width="760px" :title="app.runDialogTitle" class="app-dialog art-run-dialog" align-center>
    <ElForm :model="app.runForm" label-position="top" @submit.prevent>
      <ElFormItem label="执行来源" class="is-required-field">
        <ElSegmented
          v-model="app.runForm.sourceMode"
          class="art-run-source-segment"
          :options="[
            { label: '关联任务', value: 'zentao-task' },
            { label: '独立执行', value: 'standalone' }
          ]"
        />
        <div class="field-hint">执行台默认用于实验、复查和独立操作，只保留执行过程与结果追溯；只有从任务中心发起或主动关联任务时，才和任务中心记录挂靠。</div>
      </ElFormItem>
      <ElFormItem v-if="app.runForm.sourceMode === 'zentao-task'" label="关联任务中心记录">
        <ElSelect v-model="app.runForm.taskId" placeholder="选择后才会和任务中心挂靠；不选则只创建独立执行记录" clearable filterable>
          <ElOption
            v-for="task in app.businessTasksForProject('')"
            :key="task.id"
            :label="app.taskDisplayTitle(task)"
            :value="task.id"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="美术执行方式" class="is-required-field">
        <ElSelect v-model="app.runForm.executionMode" :disabled="app.isBugFixRun">
          <ElOption label="只执行一个规范 / Skill" value="single-skill" />
          <ElOption label="自定义流程" value="custom-workflow" />
          <ElOption v-if="app.isBugFixRun" label="Bug 修复" value="bug-fix" />
        </ElSelect>
        <div class="field-hint">只执行一个适合单独执行某个 md / Skill；自定义流程会按下方选择顺序从前到后逐个完整执行。</div>
      </ElFormItem>
      <div v-if="app.isBugFixRun && app.selectedWorkflowPlan" class="workflow-plan-preview">
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
      <ElFormItem v-if="app.isBugFixRun" label="Bug 标题" class="is-required-field"><ElInput v-model="app.runForm.title" placeholder="Bug 标题" /></ElFormItem>
      <ElFormItem label="负责人 / 执行人"><ElInput v-model="app.runForm.developer" placeholder="成员姓名" /></ElFormItem>
      <ElFormItem v-if="app.isBugFixRun" label="影响页面">
        <ElInput v-model="app.runForm.targetPage" placeholder="例如：指定页面、指定 Frame、分区名称、整页处理或本地产物目录" />
        <div class="field-hint">这是给执行时看的备注；真实读取或写入的 Figma 文件、页面、Frame、分区，以下面粘贴的 Figma 链接为准。</div>
      </ElFormItem>
      <ElFormItem label="Figma 链接" :class="{ 'is-required-field': !app.isBugFixRun }">
        <ElInput v-model="app.runForm.figmaLinks" type="textarea" :rows="3" placeholder="粘贴要执行到的具体 Frame、分区或整页 Figma 链接；每行一个。" />
        <div class="field-hint">这里是本次执行的真实目标。Codex 会按该链接解析文件、页面或 node-id，并把执行结果落到对应位置或记录阻塞原因。</div>
      </ElFormItem>
      <template v-if="!app.isBugFixRun">
        <ElFormItem :label="app.isCustomWorkflowRun ? '按顺序选择多个 md / Skill' : '从 Git 仓库选择 md / Skill'" class="is-required-field">
          <ElSelect
            :model-value="app.runMaterialSelectionValue"
            @update:model-value="app.updateRunMaterialSelection"
            :multiple="app.isCustomWorkflowRun"
            filterable
            clearable
            collapse-tags
            collapse-tags-tooltip
            :placeholder="app.isCustomWorkflowRun ? '按执行顺序选择多个 md、SKILL.md 或技能' : '选择一个要执行的 md、SKILL.md 或技能'"
          >
            <ElOption
              v-for="item in app.currentProjectExecutionMaterialOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            >
              <div class="skill-option-row">
                <strong>{{ item.label }}</strong>
                <span>{{ item.subtitle }}</span>
              </div>
            </ElOption>
          </ElSelect>
          <div class="field-hint">{{ app.isCustomWorkflowRun ? '执行时会按当前选择顺序从前到后逐个完整执行。' : '只执行当前选择的一个 md / Skill，不自动扩展为其它流程。' }}</div>
        </ElFormItem>
      </template>
      <ElFormItem :label="app.isBugFixRun ? '修复要求' : '给 Codex 的执行要求'"><ElInput v-model="app.runForm.requirement" type="textarea" :rows="8" :placeholder="app.isBugFixRun ? '描述复现方式、实际表现、期望结果、验证范围。' : '像在本机 Codex 对话一样描述：要处理什么、读取哪些资料、输出到哪里、验收标准、不能改动的范围。'" /></ElFormItem>
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
