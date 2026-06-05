<template>
  <ElDialog v-model="app.runDrawer" width="760px" :title="app.runDialogTitle" class="app-dialog art-run-dialog" align-center>
    <ElForm :model="app.runForm" label-position="top" @submit.prevent>
      <ElFormItem label="执行来源" class="is-required-field">
        <ElSegmented
          v-model="app.runForm.sourceMode"
          class="art-run-source-segment"
          :options="[
            { label: '禅道任务', value: 'zentao-task' },
            { label: '已完成任务 ID', value: 'completed-task' },
            { label: 'Figma 链接', value: 'figma-link' }
          ]"
        />
        <div class="field-hint">选择这次工作从哪里发起：接入中的禅道任务、已有完成任务继续处理，或直接用 Figma 界面链接发起。</div>
      </ElFormItem>
      <ElFormItem label="项目" class="is-required-field">
        <ElSelect v-model="app.runForm.projectId" placeholder="选择项目">
          <ElOption v-for="project in app.projects" :key="project.id" :label="project.name" :value="project.id" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem v-if="app.runForm.sourceMode === 'zentao-task'" label="接入禅道任务">
        <ElSelect v-model="app.runForm.taskId" placeholder="可选；建议关联禅道任务，方便自动归档和验收" clearable filterable>
          <ElOption
            v-for="task in app.businessTasksForProject(app.runForm.projectId)"
            :key="task.id"
            :label="app.taskDisplayTitle(task)"
            :value="task.id"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem v-else-if="app.runForm.sourceMode === 'completed-task'" label="已完成任务 ID / 禅道 ID" class="is-required-field">
        <ElInput v-model="app.runForm.zentaoId" placeholder="例如：48270；用于让 Codex 找到历史产物、报告和上下文继续处理" />
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
        <ElSegmented v-model="app.runForm.workflowLevel" class="art-run-level-segment" :options="app.workflowLevelOptions" />
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
      <ElFormItem :label="app.isBugFixRun ? 'Bug 标题' : '本次工作标题'" class="is-required-field"><ElInput v-model="app.runForm.title" :placeholder="app.isBugFixRun ? 'Bug 标题' : '例如：角色一致性生图 / Figma 收尾检查 / 弹窗规范走查'" /></ElFormItem>
      <ElRow :gutter="12">
        <ElCol :span="12">
        <ElFormItem label="主执行 Skill / 类型" :class="{ 'is-required-field': app.isSingleSkillRun }">
            <ElSelect
              v-if="app.currentProjectSkillOptions.length"
              v-model="app.runForm.stage"
              filterable
              clearable
              :placeholder="app.isSingleSkillRun ? '选择要执行的 md 或 Skill' : '可选；留空由系统按任务自动推荐'"
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
            <div class="field-hint">这里保存具体 md / SKILL.md 路径，作为主执行依据；需要补充多个规范时用下方资料库选择。</div>
          </ElFormItem>
        </ElCol>
        <ElCol :span="12"><ElFormItem label="任务 ID / 禅道 ID"><ElInput v-model="app.runForm.zentaoId" placeholder="48031" /></ElFormItem></ElCol>
      </ElRow>
      <ElFormItem label="负责人 / 执行人"><ElInput v-model="app.runForm.developer" placeholder="成员姓名" /></ElFormItem>
      <ElFormItem :label="app.isBugFixRun ? '影响页面' : '目标页面备注 / Figma 放置说明'">
        <ElInput v-model="app.runForm.targetPage" placeholder="例如：指定页面、指定 Frame、分区名称、整页处理或本地产物目录" />
        <div class="field-hint">这是给执行时看的备注；真实读取或写入的 Figma 文件、页面、Frame、分区，以下面粘贴的 Figma 链接为准。</div>
      </ElFormItem>
      <template v-if="!app.isBugFixRun">
        <ElFormItem :label="app.runForm.sourceMode === 'figma-link' ? 'Figma 界面链接' : 'Figma 线索'" :class="{ 'is-required-field': app.runForm.sourceMode === 'figma-link' }">
          <ElInput v-model="app.runForm.figmaLinks" type="textarea" :rows="3" placeholder="粘贴 Figma URL、node-id 或 Frame 链接；每行一个。" />
          <div class="field-hint">这里是实际 Figma 操作目标。提供页面、Frame、分区或整页链接后，Codex 启动时会按该 URL 解析 file key / node-id；具备写入能力时可直接在该位置修改。</div>
        </ElFormItem>
        <ElFormItem label="从 Git 资料库选择 md / Skill">
          <ElSelect
            v-model="app.runForm.selectedMaterialHints"
            multiple
            filterable
            clearable
            collapse-tags
            collapse-tags-tooltip
            placeholder="选择要让 Codex 读取并执行的 md、SKILL.md 或技能"
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
          <div class="field-hint">选择后会自动写入下面的规范 / Skill 线索；执行时 Codex 会按这些 Git 上的 md 或 Skill 作为操作依据。</div>
        </ElFormItem>
        <ElFormItem label="规范 md / Skill 线索">
          <ElInput v-model="app.runForm.showdocHints" type="textarea" :rows="3" placeholder="填写规范 md、SKILL.md、产物清单路径或关键词；留空则按任务标题和项目 Skill 自动匹配。" />
          <div class="field-hint">也可以手动补充按钮规范、弹窗规范、same-ip-image、ui-finalize、gpt-image 等线索。</div>
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
