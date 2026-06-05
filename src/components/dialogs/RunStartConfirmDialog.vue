<template>
  <ElDialog v-model="app.startConfirm.visible" width="680px" title="确认启动执行" class="app-dialog" align-center>
    <div v-if="app.selectedRun" class="start-confirm">
      <div class="confirm-summary">
        <div>
          <span>项目</span>
          <strong>{{ app.selectedRun.projectId }}</strong>
          <small>{{ app.selectedRunProject?.rootPath || '-' }}</small>
        </div>
        <div>
          <span>任务</span>
          <strong>{{ app.selectedRun.title }}</strong>
          <small>ZenTao：{{ app.selectedRun.zentaoId || '未填写' }}</small>
        </div>
        <div>
          <span>模式</span>
          <strong>{{ app.workflowRunLabel(app.selectedRun) }}</strong>
          <small>{{ app.selectedRun.workflow }}</small>
        </div>
      </div>

      <div class="confirm-section">
        <strong>将执行的阶段</strong>
        <div class="workflow-stage-list">
          <span v-for="stage in app.selectedRun.stages || []" :key="stage.no">{{ stage.no }}. {{ stage.name }}</span>
        </div>
      </div>

      <div class="confirm-section">
        <strong>项目规则与安全边界</strong>
        <ul>
          <li>规则来源：{{ app.selectedRunProject?.skillConfigPath || '.agent-hub/config.md' }}</li>
          <li>Agent 入口：{{ app.selectedRunProject?.agentConfigPath || 'AGENTS.md' }}</li>
          <li>历史任务目录：{{ app.selectedRunProject?.taskDir || '.task' }}</li>
          <li>允许写入：目标项目中的业务代码，以及平台侧产物目录中的报告、截图和日志。</li>
          <li>产物边界：执行报告、截图和日志只写入平台产物目录，不写入接入资料库。</li>
          <li>禁止命令：{{ app.forbiddenCommandText(app.selectedRunProject) }}</li>
        </ul>
      </div>

      <div class="confirm-warning">
        启动后会通过 <code>codex exec</code> 进入目标资料库执行，可能真实修改业务文件。请确认资料库、任务和执行级别无误。
      </div>
    </div>
    <template #footer>
      <ElButton @click="app.startConfirm.visible = false" :disabled="app.startConfirm.submitting">取消</ElButton>
      <ElButton v-if="app.can('run.codex.execute')" type="primary" @click="app.confirmStartRun" :loading="app.startConfirm.submitting" :disabled="app.isRunInProgress(app.selectedRun)">确认启动</ElButton>
    </template>
  </ElDialog>
</template>

<script>
export default {
  name: 'RunStartConfirmDialog',
  props: {
    app: {
      type: Object,
      required: true
    }
  }
};
</script>
