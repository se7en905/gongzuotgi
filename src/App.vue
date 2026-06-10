<template>
  <LoginView v-if="authChecked && !currentUser" :model="loginForm" :error="loginError" :loading="loginLoading"
    :theme="theme" @submit="login" />

  <div v-else-if="!authChecked" class="boot-shell" :data-theme="theme">
    <ElIcon class="boot-icon">
      <Monitor />
    </ElIcon>
    <span>正在检查登录状态...</span>
  </div>

  <ElContainer v-else class="app-shell" :class="{ collapsed: isSidebarCollapsed }" :data-theme="theme">
    <ElAside class="side-nav" :width="isSidebarCollapsed ? '82px' : '236px'">
      <div class="side-head">
        <button type="button" class="brand" @click="switchView('tasks')" aria-label="回到任务中心">
          <div class="brand-mark" aria-hidden="true">
            <span></span>
            <i></i>
          </div>
          <div>
            <strong>美术部工作台</strong>
            <span>禅道任务实时看板</span>
          </div>
        </button>
        <ElTooltip :content="isSidebarCollapsed ? '展开侧栏' : '收起侧栏'" placement="right">
          <button type="button" class="side-collapse-button" data-testid="sidebar-toggle" @click="toggleSidebar">
            <ElIcon>
              <Operation />
            </ElIcon>
          </button>
        </ElTooltip>
      </div>

      <ElMenu class="nav-menu" :default-active="activeNav" :default-openeds="navDefaultOpeneds" @select="switchView">
        <ElMenuItem v-if="can('menu.tasks')" index="tasks">
            <ElIcon>
              <Tickets />
            </ElIcon>
          <span>任务中心</span>
        </ElMenuItem>
        <ElMenuItem v-if="can('menu.skillList')" index="skill-assets">
            <ElIcon>
              <FolderChecked />
            </ElIcon>
          <span>AI 产物清单</span>
        </ElMenuItem>
        <ElMenuItem v-if="can('menu.aiMembers')" index="ai-members">
            <ElIcon>
              <User />
            </ElIcon>
          <span>AI部门看板</span>
        </ElMenuItem>
        <ElMenuItem v-if="can('menu.codexConfig')" index="codex-config">
            <ElIcon>
              <Key />
            </ElIcon>
          <span>Codex 配置</span>
        </ElMenuItem>
        <ElMenuItem v-if="can('menu.runs')" index="runs">
            <ElIcon>
              <Operation />
            </ElIcon>
          <span>美术执行台</span>
        </ElMenuItem>
        <ElMenuItem v-if="can('menu.agentWorkers')" index="agent-workers">
            <ElIcon>
              <Monitor />
            </ElIcon>
          <span>本机执行状态</span>
        </ElMenuItem>
        <ElMenuItem v-if="can('menu.aiArchive')" index="ai-archive">
            <ElIcon>
              <Clock />
            </ElIcon>
          <span>AI档案</span>
        </ElMenuItem>
        <ElMenuItem v-if="can('menu.users')" index="user-access">
            <ElIcon>
              <User />
            </ElIcon>
          <span>用户管理</span>
        </ElMenuItem>
        <ElMenuItem v-if="can('menu.roles')" index="role-management">
            <ElIcon>
              <Key />
            </ElIcon>
          <span>角色管理</span>
        </ElMenuItem>
      </ElMenu>

      <div class="side-controls">
        <ElTooltip :content="theme === 'dark' ? '切换浅色模式' : '切换深色模式'" placement="right">
          <button type="button" data-testid="theme-toggle" @click="toggleTheme">
            <ElIcon>
              <Sunny v-if="theme === 'dark'" />
              <Moon v-else />
            </ElIcon>
            <span>{{ theme === 'dark' ? '浅色模式' : '深色模式' }}</span>
          </button>
        </ElTooltip>
      </div>
    </ElAside>

    <ElContainer>
      <ElHeader class="top-bar" height="72px">
        <div class="top-title-row">
          <h1>{{ pageMeta.title }}</h1>
          <template v-if="activeView === 'tasks'">
            <ElButton v-if="can('task.sync')" type="primary" :loading="loading.syncTasks" @click="syncZentaoTasks">{{
              taskSyncButtonText }}</ElButton>
            <span class="sync-time" :class="{ error: zentaoSyncLastError }">
              <ElIcon>
                <Timer />
              </ElIcon>
              {{ zentaoAutoSyncTimeText }}
            </span>
          </template>
        </div>
        <div class="top-right-tools">
          <div class="top-user">
            <span class="user-avatar" :style="userAvatarStyle(currentUser)" aria-hidden="true">
              {{ userAvatarText(currentUser) }}
            </span>
            <strong>{{ currentUser?.displayName || currentUser?.username }}</strong>
            <span class="user-role">({{ currentUserRoleLabel }})</span>
            <button type="button" class="top-logout-button" @click="logout">退出</button>
          </div>
          <ElTooltip v-if="can('menu.operationLogs')" content="操作日志" placement="bottom">
            <button type="button" class="top-log-icon-button" aria-label="操作日志" @click="switchView('operation-logs')">
              <ElIcon>
                <Clock />
              </ElIcon>
            </button>
          </ElTooltip>
        </div>
      </ElHeader>

      <main
        :class="['el-main', 'main-stage', { 'is-task-result-stage': activeView === 'task-result' }]">
        <SkillInventoryView v-if="isSkillInventoryViewActive" :app="appBridge" />

        <TaskCenterView v-if="activeView === 'tasks'" :app="appBridge" :revision="taskCenterRevision" />

        <AiMembersView v-if="aiMembersViewMounted" v-show="activeView === 'ai-members'" :app="appBridge" />

        <section v-show="activeView === 'codex-config'" class="view-grid codex-config-view">
          <ElCard shadow="never" class="panel-card page-card codex-config-card">
            <template #header>
              <div class="panel-head">
                <div>
                  <h3>Codex 配置</h3>
                  <p>只保留模型、Base URL 和 API Key，页面更适合日常快速维护。</p>
                </div>
              </div>
            </template>
            <ElForm :model="codexConfigForm" label-position="top" class="codex-config-form" @submit.prevent>
              <ElFormItem label="模型" class="codex-config-field">
                <ElSelect v-model="codexConfigForm.model" placeholder="请选择模型">
                  <ElOption v-for="model in codexModelOptions" :key="model" :label="model" :value="model" />
                </ElSelect>
              </ElFormItem>
              <ElFormItem label="Base URL" class="codex-config-field">
                <ElInput v-model="codexConfigForm.baseUrl" placeholder="留空使用本机 Codex 配置" />
              </ElFormItem>
              <ElFormItem label="API Key" class="codex-config-field codex-config-field-wide">
                <ElInput
                  v-model="codexApiKeyDraft"
                  :type="codexApiKeyVisible ? 'text' : 'password'"
                  autocomplete="new-password"
                  :placeholder="codexConfigForm.hasApiKey ? '已保存 Key，留空表示保留当前 Key' : '请输入 Codex API Key'"
                  @input="handleCodexApiKeyInput"
                >
                  <template #suffix>
                    <button type="button" class="password-toggle" @click="codexApiKeyVisible = !codexApiKeyVisible">
                      <ElIcon>
                        <View v-if="!codexApiKeyVisible" />
                        <Hide v-else />
                      </ElIcon>
                    </button>
                  </template>
                </ElInput>
              </ElFormItem>
              <ElCheckbox v-if="codexConfigForm.hasApiKey" v-model="codexConfigForm.clearApiKey" class="codex-config-field-wide">清除已保存的 API Key</ElCheckbox>
              <div class="config-hint codex-config-field-wide">
                {{ codexConfigStatusText }}。保存后新启动的执行会使用这些配置，已运行中的任务不受影响。API Key 不会回显到页面、日志或 Codex prompt。
              </div>
              <div class="form-actions codex-config-field-wide">
                <ElButton @click="loadCodexConfig" :loading="loading.codexConfig">重新加载</ElButton>
                <ElButton v-if="can('codex.config.manage')" type="primary" :loading="loading.codexConfig" @click="saveCodexConfig">保存配置</ElButton>
              </div>
            </ElForm>
          </ElCard>
        </section>

        <ProjectDetailView v-if="activeView === 'project-detail'" :app="appBridge" :selected-project="selectedProject"
          :selected-scan="projectRows.find(item => item.id === selectedProjectId)?.scan || null"
          :project-description="projectDescription" :selected-project-stats="selectedProjectStats"
          :scan-summary="scanSummary" :readiness="readiness" :visible-skills="visibleSkills" :project-tasks="[]"
          :paged-project-tasks="[]" :task-page="taskPage" :task-page-size="taskPageSize"
          :loading-scan="loading.scan && !projectDetailTasks().length" @update:task-page="taskPage = $event"
          @update:task-page-size="taskPageSize = $event" />

        <RunsView v-if="activeView === 'runs'" :app="appBridge" />
        <AgentWorkersView v-if="activeView === 'agent-workers'" :app="appBridge" />
        <AiArchiveView v-if="activeView === 'ai-archive'" :app="appBridge" />

        <TaskResultView v-if="activeView === 'task-result'" :app="appBridge" />

        <ManualReviewView v-if="activeView === 'manual-review'" :app="appBridge" />

        <UserAccessView v-if="activeView === 'user-access'" :app="appBridge" />

        <RoleManagementView v-if="activeView === 'role-management'" :app="appBridge" />

        <OperationLogView v-if="activeView === 'operation-logs'" :app="appBridge" />

      </main>
    </ElContainer>
  </ElContainer>

  <RunCreateDialog :app="appBridge" />
  <RunStartConfirmDialog :app="appBridge" />
  <RunDiffPreviewDialog :app="appBridge" />
  <TaskSyncDialog :app="appBridge" />
  <ProjectFormDialog :app="appBridge" />
  <DirectoryPickerDialog :app="appBridge" />
  <SkillPreviewDialog :app="appBridge" />
  <ElDrawer
    v-if="!isSkillInventoryViewActive"
    v-model="skillUsageDialog.visible"
    title="使用明细"
    direction="rtl"
    size="50%"
    class="app-dialog art-progress-log-drawer skill-usage-drawer"
    append-to-body
    :with-header="true"
  >
    <div class="skill-usage-panel">
      <div class="skill-usage-head">
        <div class="skill-usage-title-row">
          <div>
            <span>当前产物</span>
            <strong>{{ skillUsageDialog.row?.productDisplayName || skillUsageDialog.row?.productFileName || skillUsageDialog.row?.title || 'AI 产物' }}</strong>
          </div>
          <div class="skill-usage-version-badge">
            <span>当前版本</span>
            <strong>{{ skillVersionDisplayLabel(skillUsageDialog.row || skillUsageDialog.row?.version || skillUsageDialog.row?.skill?.version) }}</strong>
          </div>
        </div>
        <div class="skill-usage-version-note">
          {{ skillVersionDescription(skillUsageDialog.row || skillUsageDialog.row?.version || skillUsageDialog.row?.skill?.version) }}
        </div>
        <div class="skill-usage-member-stats">
          <div class="skill-usage-member-stats-head">
            <strong>成员调用统计</strong>
          </div>
          <div v-if="skillUsageDialog.memberStats?.length" class="skill-usage-member-list">
            <article v-for="member in skillUsageDialog.memberStats" :key="member.name" class="skill-usage-member-item">
              <div>
                <strong>{{ member.name }}</strong>
              </div>
              <div>
                <b>{{ member.count }}</b>
                <small>调用次数</small>
              </div>
            </article>
          </div>
          <div v-else class="art-progress-log-empty compact">暂无成员调用记录</div>
        </div>
        <div class="skill-usage-history-block">
          <div class="skill-usage-member-stats-head">
            <strong>更新与版本迭代</strong>
            <span>{{ skillUsageDialog.versionEntries?.length || 0 }} 条记录</span>
          </div>
          <div v-if="skillUsageDialog.versionEntries?.length" class="skill-usage-version-list">
            <article v-for="entry in skillUsageDialog.versionEntries" :key="entry.fullCommit || entry.commit || `${entry.time}-${entry.title}`" class="skill-usage-version-item">
              <div>
                <strong>{{ entry.title }}</strong>
                <span>{{ entry.author || '-' }} · {{ formatDateTime(entry.time) || '-' }}</span>
              </div>
              <small>{{ entry.commit || '未记录提交号' }}</small>
            </article>
          </div>
          <div v-else class="art-progress-log-empty compact">暂无版本迭代记录</div>
        </div>
      </div>
    </div>
  </ElDrawer>
  <ElDialog v-model="skillOwnerDialog.visible" title="调整产物贡献人" width="420px" class="app-dialog" append-to-body align-center>
    <ElForm label-position="top" @submit.prevent>
      <ElFormItem label="产物">
        <ElInput :model-value="skillOwnerDialog.row?.productDisplayName || skillOwnerDialog.row?.title || '-'" disabled />
      </ElFormItem>
      <ElFormItem label="贡献人">
        <ElSelect v-model="skillOwnerDialog.owner" filterable allow-create default-first-option multiple placeholder="选择或输入成员">
          <ElOption v-for="member in skillOwnerCandidateMembers" :key="member.name" :label="member.name" :value="member.name" />
        </ElSelect>
        <small class="form-help-text">多人协作可选择多个成员，也可以直接输入后保存。</small>
      </ElFormItem>
    </ElForm>
    <template #footer>
      <div class="dialog-footer-actions">
        <ElButton plain @click="skillOwnerDialog = { visible: false, row: null, owner: [] }">取消</ElButton>
        <ElButton type="primary" :loading="loading.skillVersion" @click="saveSkillOwnerOverride">保存</ElButton>
      </div>
    </template>
  </ElDialog>
  <ElDialog v-model="skillHistoryDialog.visible" title="历史版本" width="760px" class="app-dialog skill-history-dialog" append-to-body>
    <div class="skill-history-panel">
      <div class="skill-history-meta">
        <div><span>技能</span><strong>{{ skillHistoryDialog.row?.title || skillHistoryDialog.row?.id || '-' }}</strong></div>
        <div><span>仓库路径</span><strong>{{ skillHistoryDialog.row?.relativePath || skillHistoryDialog.row?.path || '-' }}</strong></div>
      </div>
      <div class="skill-history-list">
        <article v-for="entry in skillHistoryDialog.entries" :key="entry.fullCommit || entry.commit" class="skill-history-card">
          <strong>{{ entry.title }}</strong>
          <span>{{ entry.author }} · {{ entry.email }} · {{ formatDateTime(entry.time) }}</span>
          <p>{{ entry.summary }}</p>
          <small>{{ entry.commit || '-' }} · 查看提交</small>
        </article>
        <div v-if="!skillHistoryDialog.entries.length" class="empty-block">暂无历史版本记录</div>
      </div>
    </div>
  </ElDialog>
  <ElDialog
    v-model="taskSplitDialog.visible"
    title="工作台拆单"
    width="980px"
    class="app-dialog task-split-dialog"
    :close-on-click-modal="false"
    append-to-body
  >
    <div class="task-split-panel">
      <div class="task-split-head">
        <div>
          <strong>{{ taskSplitDialog.plan.title || taskSplitDialog.task?.displayTitle || taskSplitDialog.task?.title || '未选择任务' }}</strong>
          <span>禅道任务：{{ taskSplitDialog.plan.taskId || taskSplitDialog.task?.taskNo || '-' }} · 截止：{{ taskSplitDialog.plan.deadline || '-' }}</span>
        </div>
        <ElTag type="info" effect="plain">在工作台确认后写入禅道</ElTag>
      </div>
      <ElForm label-position="top" class="task-split-form" @submit.prevent>
        <div class="form-grid two">
          <ElFormItem label="主单负责人">
            <ElSelect v-model="taskSplitDialog.plan.mainAssignee" filterable placeholder="选择主单负责人">
              <ElOption v-for="member in taskSplitDialog.assignees" :key="member.account" :label="member.realname" :value="member.account" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="所属版本">
            <ElInput v-model="taskSplitDialog.plan.executionId" disabled />
          </ElFormItem>
        </div>
      </ElForm>
      <div class="task-split-table-head">
        <strong>子单列表</strong>
        <ElButton size="small" plain @click="addTaskSplitChild">新增子单</ElButton>
      </div>
      <ElTable class="task-split-table" :data="taskSplitDialog.plan.children" row-key="id" size="small" empty-text="暂无子单">
        <ElTableColumn label="启用" width="72">
          <template #default="{ row }">
            <ElCheckbox v-model="row.enabled" />
          </template>
        </ElTableColumn>
        <ElTableColumn label="子单名称" min-width="320">
          <template #default="{ row }">
            <ElInput v-model="row.name" />
          </template>
        </ElTableColumn>
        <ElTableColumn label="负责人" width="150">
          <template #default="{ row }">
            <ElSelect v-model="row.assignedTo" filterable>
              <ElOption v-for="member in taskSplitDialog.assignees" :key="member.account" :label="member.realname" :value="member.account" />
            </ElSelect>
          </template>
        </ElTableColumn>
        <ElTableColumn label="截止时间" width="150">
          <template #default="{ row }">
            <ElInput v-model="row.deadline" placeholder="YYYY-MM-DD" />
          </template>
        </ElTableColumn>
        <ElTableColumn label="预计工时" width="120">
          <template #default="{ row }">
            <ElInputNumber v-model="row.estimate" :min="0" :step="0.5" controls-position="right" />
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="90" align="center">
          <template #default="{ $index }">
            <ElButton size="small" type="danger" plain @click="removeTaskSplitChild($index)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>
    <template #footer>
      <div class="dialog-footer-actions">
        <ElButton @click="taskSplitDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="loading.taskSplit" @click="submitTaskSplitPlan">确认写入禅道</ElButton>
      </div>
    </template>
  </ElDialog>
  <ElDialog
    v-model="forcePasswordDialog"
    width="460px"
    title="首次登录请修改密码"
    class="app-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    align-center
  >
    <ElForm :model="forcePasswordForm" label-position="top" @submit.prevent>
      <ElAlert
        type="warning"
        :closable="false"
        title="当前账号使用的是初始密码，修改完成后才能继续使用平台。"
        class="login-error"
      />
      <ElFormItem label="当前密码" class="is-required-field">
        <ElInput v-model="forcePasswordForm.currentPassword" type="password" show-password autocomplete="current-password" />
      </ElFormItem>
      <ElFormItem label="新密码" class="is-required-field">
        <ElInput v-model="forcePasswordForm.password" type="password" show-password autocomplete="new-password" placeholder="至少 8 位" />
      </ElFormItem>
      <ElFormItem label="确认新密码" class="is-required-field">
        <ElInput v-model="forcePasswordForm.confirmPassword" type="password" show-password autocomplete="new-password" placeholder="再次输入新密码" />
      </ElFormItem>
      <ElButton type="primary" class="full-button" :loading="loginLoading" @click="changeOwnPassword">确认修改并重新登录</ElButton>
    </ElForm>
  </ElDialog>
  <ElDialog v-model="aiFlowRecordDialog.visible" :title="aiFlowRecordDialog.form.id ? '编辑人工全流程记录' : '新增人工全流程记录'"
    width="860px" class="ai-flow-record-dialog">
    <ElForm label-position="top" class="ai-flow-record-form">
      <div class="form-grid two">
        <ElFormItem label="所属项目">
          <ElSelect v-model="aiFlowRecordDialog.form.projectId" filterable placeholder="请选择项目">
            <ElOption v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="记录状态">
          <ElRadioGroup v-model="aiFlowRecordDialog.form.status">
            <ElRadioButton label="draft">草稿</ElRadioButton>
            <ElRadioButton label="confirmed">已确认</ElRadioButton>
          </ElRadioGroup>
        </ElFormItem>
      </div>
      <ElFormItem label="任务名称和单号">
        <ElInput v-model="aiFlowRecordDialog.form.taskNameAndNo" placeholder="例如：48254 活动入口图适配..." />
      </ElFormItem>
      <div class="form-grid three">
        <ElFormItem label="任务号">
          <ElInput v-model="aiFlowRecordDialog.form.taskNo" placeholder="自动或手动填写" />
        </ElFormItem>
        <ElFormItem label="执行人员">
          <ElInput v-model="aiFlowRecordDialog.form.developer" />
        </ElFormItem>
        <ElFormItem label="使用智能体 + 模型">
          <ElInput v-model="aiFlowRecordDialog.form.agentModel" />
        </ElFormItem>
      </div>
      <div class="form-grid two">
        <ElFormItem label="全流程完成度">
          <ElInputNumber v-model="aiFlowRecordDialog.form.flowCompletion" :min="0" :max="100" :step="5" />
        </ElFormItem>
        <ElFormItem label="生成总时长">
          <ElInput v-model="aiFlowRecordDialog.form.totalDuration" placeholder="例如：2h 30m" />
        </ElFormItem>
      </div>
      <div class="form-grid two">
        <ElFormItem v-for="field in aiFlowStageFields" :key="field.key" :label="field.label">
          <ElInput v-model="aiFlowRecordDialog.form[field.key]" type="textarea" :rows="3" />
        </ElFormItem>
      </div>
      <ElFormItem label="总结和问题">
        <ElInput v-model="aiFlowRecordDialog.form.summaryIssues" type="textarea" :rows="4" />
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton @click="aiFlowRecordDialog.visible = false">取消</ElButton>
      <ElButton type="primary" :loading="loading.aiFlowRecords" @click="saveAiFlowRecord">保存记录</ElButton>
    </template>
  </ElDialog>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus';
import TaskCenterView from './views/TaskCenterView.vue';
import SkillInventoryView from './views/SkillInventoryView.vue';
import AiMembersView from './views/AiMembersView.vue';
import ProjectDetailView from './views/ProjectDetailView.vue';
import RunsView from './views/RunsView.vue';
import AgentWorkersView from './views/AgentWorkersView.vue';
import AiArchiveView from './views/AiArchiveView.vue';
import TaskResultView from './views/TaskResultView.vue';
import ManualReviewView from './views/ManualReviewView.vue';
import LoginView from './views/LoginView.vue';
import UserAccessView from './views/UserAccessView.vue';
import RoleManagementView from './views/RoleManagementView.vue';
import OperationLogView from './views/OperationLogView.vue';
import RunCreateDialog from './components/dialogs/RunCreateDialog.vue';
import RunStartConfirmDialog from './components/dialogs/RunStartConfirmDialog.vue';
import RunDiffPreviewDialog from './components/dialogs/RunDiffPreviewDialog.vue';
import TaskSyncDialog from './components/dialogs/TaskSyncDialog.vue';
import ProjectFormDialog from './components/dialogs/ProjectFormDialog.vue';
import DirectoryPickerDialog from './components/dialogs/DirectoryPickerDialog.vue';
import SkillPreviewDialog from './components/dialogs/SkillPreviewDialog.vue';
import { Hide, View } from '@element-plus/icons-vue';

const DEFAULT_ZENTAO_BUG_PRODUCTS = 'all';
const DEFAULT_AI_FLOW_SHEET = {
  spreadsheetId: '1tP9XTqxIMUQ6E6rq47fq0A0T7kxvJvnVEPKBpnoIpiw',
  gid: '1127778149',
  sheetSourceUrl: 'https://docs.google.com/spreadsheets/d/1tP9XTqxIMUQ6E6rq47fq0A0T7kxvJvnVEPKBpnoIpiw/edit?pli=1&gid=1127778149#gid=1127778149'
};
const AI_FLOW_STAGE_FIELDS = [
  { key: 'requirementDoc', label: '需求文档输出' },
  { key: 'dataModelBuild', label: '数据模型智能构建' },
  { key: 'figmaToPage', label: 'Figma To Page' },
  { key: 'apiOrchestration', label: 'API 取调编排' },
  { key: 'autoCodeQuality', label: '自动质检代码' },
  { key: 'devQualityReport', label: '开发质检报告' },
  { key: 'qualificationAssessment', label: '达标/合格率评估' },
  { key: 'autoFix', label: '自动修复' }
];
const CODEX_MODEL_OPTIONS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2'];
const CODEX_REASONING_OPTIONS = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '极高', value: 'xhigh' }
];
const RUN_LOG_FETCH_TAIL_BYTES = 48 * 1024;
const RUN_LOG_BUFFER_MAX_CHARS = 160 * 1024;
const RUN_LOG_RENDER_MAX_CHARS = 80 * 1024;
const RUN_LOG_RENDER_MAX_LINES = 400;
const RUN_LOG_LINE_MAX_CHARS = 2400;

const roleLevelPermissionPresets = {
  4: [
    'menu.tasks', 'menu.skillList', 'menu.aiMembers', 'menu.aiMembers.owner', 'menu.aiMembers.member', 'menu.codexConfig', 'menu.runs', 'menu.agentWorkers', 'menu.aiArchive', 'menu.users', 'menu.roles', 'menu.operationLogs',
    'task.sync', 'task.note.manage', 'task.artBrief.generate', 'task.codexPrompt.copy', 'task.personPressure.view', 'task.platform.delete',
    'run.create', 'run.codex.execute', 'run.directSkill.create', 'run.directSkill.workerCommand', 'run.start', 'run.cancel', 'run.delete', 'review.submit', 'review.image.submit',
    'skill.scan.refresh', 'skill.source.connect', 'skill.source.edit', 'skill.source.delete', 'skill.asset.create', 'skill.asset.void', 'skill.assetOwner.manage', 'skill.version.manage', 'skill.alias.manage', 'skill.usageLogs.view',
    'aiMembers.score.view', 'aiMembers.score.refresh',
    'codex.config.manage', 'user.manage', 'role.manage',
    'api.skillSources.manage', 'api.skillSources.delete', 'api.skillScan.run', 'api.taskNotes.manage', 'api.taskArtBrief.generate', 'api.tasks.deletePlatform', 'api.runs.execute', 'api.agentRuns.create', 'api.agentWorkers.read', 'api.agentWorkers.heartbeat', 'api.agentWorkers.alias', 'api.agentRuns.claim', 'api.agentRuns.log', 'api.agentRuns.status', 'api.runs.delete', 'api.aiArchive.delete', 'api.reviews.submit', 'api.skillVersion.manage', 'api.skillAlias.manage', 'api.skillAsset.create', 'api.skillAsset.void', 'api.aiMembers.read', 'api.aiMembers.score.read', 'api.aiMembers.refresh', 'api.codex.config.read', 'api.codex.config.manage', 'api.users.manage', 'api.roles.manage', 'api.taskCenter.config.manage', 'api.operationLogs.read', 'api.operationLogs.delete'
  ],
  3: [
    'menu.tasks', 'menu.skillList', 'menu.aiMembers', 'menu.aiMembers.member', 'menu.codexConfig', 'menu.runs', 'menu.agentWorkers', 'menu.aiArchive',
    'task.sync', 'task.note.manage', 'task.artBrief.generate', 'task.codexPrompt.copy',
    'run.create', 'run.codex.execute', 'run.directSkill.create', 'run.directSkill.workerCommand', 'run.start', 'run.cancel', 'review.submit', 'review.image.submit',
    'skill.scan.refresh', 'skill.source.connect', 'skill.source.edit', 'skill.asset.create', 'skill.assetOwner.manage', 'skill.version.manage', 'skill.alias.manage', 'skill.usageLogs.view',
    'aiMembers.score.view',
    'api.taskNotes.manage', 'api.taskArtBrief.generate', 'api.runs.execute', 'api.agentRuns.create', 'api.agentWorkers.read', 'api.agentWorkers.heartbeat', 'api.agentWorkers.alias', 'api.agentRuns.claim', 'api.agentRuns.log', 'api.agentRuns.status', 'api.reviews.submit', 'api.codex.config.read', 'api.skillSources.manage', 'api.skillScan.run', 'api.skillVersion.manage', 'api.skillAlias.manage', 'api.skillAsset.create', 'api.aiMembers.read', 'api.aiMembers.score.read'
  ],
  2: [
    'menu.tasks', 'menu.skillList', 'menu.aiMembers', 'menu.aiMembers.member', 'menu.runs', 'menu.aiArchive',
    'task.codexPrompt.copy', 'review.submit', 'review.image.submit', 'skill.alias.manage', 'skill.usageLogs.view', 'aiMembers.score.view', 'api.reviews.submit', 'api.skillAlias.manage', 'api.aiMembers.read', 'api.aiMembers.score.read'
  ],
  1: ['menu.tasks', 'menu.skillList', 'menu.aiMembers', 'menu.aiMembers.member', 'skill.usageLogs.view', 'aiMembers.score.view', 'api.aiMembers.read', 'api.aiMembers.score.read']
};

export default {
  components: {
    TaskCenterView,
    SkillInventoryView,
    AiMembersView,
    ProjectDetailView,
    RunsView,
    AgentWorkersView,
    AiArchiveView,
    TaskResultView,
    ManualReviewView,
    LoginView,
    UserAccessView,
    RoleManagementView,
    OperationLogView,
    RunCreateDialog,
    RunStartConfirmDialog,
    RunDiffPreviewDialog,
    TaskSyncDialog,
    ProjectFormDialog,
    DirectoryPickerDialog,
    SkillPreviewDialog,
    Hide,
    View
  },

  data() {
    return {
      appBridge: null,
      authChecked: false,
      workbenchStateRestoring: false,
      currentUser: null,
      loginLoading: false,
      loginError: '',
      loginForm: {
        username: 'admin',
        password: ''
      },
      activeView: 'tasks',
      currentPath: typeof window !== 'undefined' ? window.location.pathname : '/',
      theme: 'light',
      isSidebarCollapsed: false,
      projectPage: 1,
      projectPageSize: 10,
      artProjectSheetRows: [],
      artProjectSheetHeaders: [],
      artProjectSheetFields: [],
      artProjectSheetFetchedAt: '',
      artProjectSheetSourceUrl: 'https://docs.google.com/spreadsheets/d/18MyY-8UudwHjUcjt0dFgXUHhrqNqhoc1MOrn_b6gsmg/edit?usp=sharing',
      artProjectSheetKeyword: '',
      artProjectSheetPage: 1,
      artProjectSheetPageSize: 10,
      artProjectSheetDialog: {
        visible: false,
        form: emptyArtProjectSheetRowForm()
      },
      artProjectSheetFieldDialog: {
        visible: false,
        form: emptyArtProjectSheetFieldForm()
      },
      skillInventoryKeyword: '',
      skillInventorySource: '',
      skillInventoryMemberFilter: '',
      skillInventoryPreferMine: false,
      skillInventoryKindFilter: '',
      skillInventoryTab: 'list',
      skillInventoryPage: 1,
      skillInventoryPageSize: 10,
      skillInventoryShowHidden: false,
      skillSourceDisplayDialog: {
        visible: false,
        keyword: ''
      },
      skillInventoryScanCacheLoaded: false,
      aiAssetKeyword: '',
      aiAssetStatusFilter: '',
      aiAssetShowHidden: false,
      aiAssetPage: 1,
      aiAssetPageSize: 10,
      aiAssetVisibleColumns: [],
      skillValidationRows: [],
      skillValidationMeta: null,
      skillValidationRefreshPromise: null,
      skillValidationLastRefreshAt: 0,
      skillValidationDirty: false,
      skillValidationPage: 1,
      skillValidationPageSize: 10,
      skillValidationVisibleColumns: [],
      skillValidationDetailDrawer: false,
      skillValidationDetailPage: 1,
      skillValidationDetailPageSize: 10,
      skillValidationDialog: {
        visible: false,
        form: emptySkillValidationForm()
      },
      artProgressSummary: null,
      artProgressEvents: [],
      artProgressLifecycleLogRows: [],
      artProgressOperationLogRows: [],
      taskArtBriefUsageLogs: [],
      usageCounters: null,
      artProgressLogDialog: false,
      artProgressLogType: 'operation',
      artProgressPage: 1,
      artProgressPageSize: 10,
      artProgressLogPage: 1,
      artProgressLogPageSize: 10,
      artProgressLogMemberFilter: '',
      artProgressDetailDialog: emptyArtProgressDetailDialog(),
      artProgressDialog: {
        visible: false,
        form: emptyArtProgressEventForm()
      },
      taskPage: 1,
      taskPageSize: 10,
      detailProjectTasks: [],
      detailPagedProjectTasks: [],
      themeOptions: [
        { label: '深色模式', value: 'dark' },
        { label: '浅色模式', value: 'light' }
      ],
      projects: [],
      customWorkflows: [],
      businessTasks: [],
      bugs: [],
      aiFlowRecords: [],
      taskReviews: [],
      aiMembersSnapshot: null,
      aiMembersViewMounted: false,
      aiMemberScoreReady: false,
      aiMemberScoreRowsSnapshot: [],
      aiMemberScoreRowsSnapshotKey: '',
      aiMemberScoreRowsSnapshotAt: '',
      aiMemberScoreRefreshing: false,
      aiMembersBoardFrameReady: false,
      aiMembersBoardFrameReadyTimer: 0,
      users: [],
      roles: [],
      operationLogs: [],
      operationLogTotal: 0,
      operationLogPage: 1,
      operationLogPageSize: 10,
      operationLogFilters: {
        userId: '',
        module: '',
        result: '',
        keyword: '',
        from: '',
        to: ''
      },
      operationLogDetail: {
        visible: false,
        row: null
      },
      permissionCatalog: [],
      runs: [],
      agentWorkers: [],
      codexModelOptions: CODEX_MODEL_OPTIONS,
      codexConfigForm: emptyCodexConfigForm(),
      codexApiKeyDraft: '',
      codexApiKeyVisible: false,
      nowTick: Date.now(),
      logPulse: 0,
      runDurationTimer: null,
      scans: {},
      appConfig: {
        zentaoBaseUrl: '',
        codex: null,
        zentaoAutoSync: null,
        zentaoArtUsers: [],
        taskCenter: null,
        workflowLevels: []
      },
      taskCenterConfigReady: false,
      selectedProjectId: 'art_department',
      selectedRunId: null,
      selectedSkillId: '',
      skillContentCache: {},
      skillInventoryMetricsCache: {},
      skillOwnerOverrides: {},
      skillDisplayNameOverrides: {},
      skillAliasOverrides: {},
      skillAliasHistoryOverrides: {},
      skillInventoryKindOverrides: {},
      skillSourceDisplayDrafts: {},
      skillPreview: {
        visible: false,
        skill: null,
        html: ''
      },
      directSkillRunDialog: {
        visible: false,
        row: null,
        figmaLinks: '',
        figmaWriteMode: 'target-node',
        assignedToUserId: '',
        requirement: '',
        submitting: false
      },
      aiExecutionArchiveFilters: {
        keyword: '',
        userId: '',
        status: '',
        archiveBucket: '',
        sourceType: '',
        runId: '',
        from: '',
        to: ''
      },
      aiExecutionArchivePage: 1,
      aiExecutionArchivePageSize: 20,
      aiExecutionArchiveDetail: {
        visible: false,
        run: null
      },
      skillUsageDialog: { visible: false, row: null, metrics: [], logs: [], start: '', end: '', page: 1, pageSize: 10 },
      skillHistoryDialog: { visible: false, row: null, entries: [] },
      skillOwnerDialog: { visible: false, row: null, owner: [] },
      skillPreviewVersionDraft: '',
      skillPreviewAliasesDraft: '',
      aiAssetSheetRows: [],
      aiAssetSheetMeta: null,
      aiAssetDialog: { visible: false, readonly: false, mode: 'asset', form: emptyAiAssetForm() },
      eventSource: null,
      platformEventSource: null,
      platformEventRefreshTimers: {},
      zentaoSyncTimer: null,
      zentaoAutoSyncPollTimer: null,
      zentaoAutoSyncWasRunning: false,
      manualZentaoSyncPending: false,
      taskBriefRealtimeTimer: null,
      taskBriefRealtimeRunning: false,
      taskBriefRealtimeLastAt: 0,
      aiArchiveBugSyncLastAt: {},
      aiArchiveTaskSyncLastAt: {},
      runCodexFloatingRunId: '',
      runLogDrawerVisible: false,
      runLogCollapse: [],
      logText: '选择一个任务后查看执行日志。',
      selectedArtifact: null,
      artifactPreview: {},
      selectedTask: null,
      draggingTaskId: '',
      draggingTask: null,
      taskSplitDialog: {
        visible: false,
        task: null,
        assignees: [],
        plan: {
          taskId: '',
          title: '',
          deadline: '',
          executionId: '',
          mainAssignee: '',
          children: []
        }
      },
      selectedStageNo: null,
      selectedReport: null,
      selectedReportHtml: '',
      reportRequestId: 0,
      selectedImage: null,
      selectedReviewKey: '',
      auditTab: 'overview',
      imageReviewForm: {
        decision: 'passed',
        comment: ''
      },
      imageReviewRecords: {},
      manualReviewForm: {
        decision: 'approved',
        comment: '',
        score: 80
      },
      taskReviewForm: emptyTaskReviewForm(),
      taskProcessingNotes: {},
      taskProcessingSheetOpen: false,
      taskArtBriefs: {},
      taskArtBriefLoading: {},
      manualReviewRecords: [],
      scanOutput: '等待扫描。',
      loading: {
        projects: false,
        tasks: false,
        runs: false,
        agentWorkers: false,
        scan: false,
        skillInventoryCache: false,
        syncTasks: false,
        taskNotes: false,
        aiArchiveTaskSync: false,
        aiArchiveBugSync: false,
        aiFlowRecords: false,
        aiFlowImport: false,
        aiMembers: false,
        users: false,
        roles: false,
        operationLogs: false,
        codexConfig: false,
        artProjectSheet: false,
        skillValidations: false,
        artProgressEvents: false,
        aiAssetSheet: false,
        skillVersion: false,
        taskAssign: false,
        taskSplit: false
      },
      runDrawer: false,
      startConfirm: {
        visible: false,
        submitting: false
      },
      runDiffPreview: {
        visible: false,
        file: '',
        status: '',
        mode: '',
        content: '',
        imageUrl: '',
        oldContent: '',
        newContent: '',
        rows: [],
        diffIndexes: [],
        currentDiffIndex: 0
      },
      projectDrawer: false,
      taskSyncDrawer: false,
      taskCenterMode: 'task',
      taskCenterRevision: 0,
      aiMembersBoardMode: 'owner',
      taskCenterModeOptions: [
        { label: '任务大厅', value: 'task' },
        { label: 'Bug大厅', value: 'bug' }
      ],
      preserveMetricOnModeSwitch: false,
      preservePersonFilterOnModeSwitch: false,
      businessTaskPage: 1,
      businessTaskPageSize: 10,
      aiArchivePage: 1,
      aiArchivePageSize: 10,
      aiArtifactPage: 1,
      aiArtifactPageSize: 10,
      selectedBusinessTaskId: '',
      selectedBugId: '',
      selectedAiArchiveTaskId: '',
      taskFilters: {
        projectId: '',
        zentaoStatus: '',
        platformStatus: '',
        metric: '',
        keyword: ''
      },
      archiveFilters: {
        projectId: '',
        qualityStatus: '',
        keyword: ''
      },
      aiFlowRecordDialog: {
        visible: false,
        form: emptyAiFlowRecordForm()
      },
      personStatFilter: {
        person: '',
        type: ''
      },
      runForm: {
        sourceMode: 'zentao-task',
        taskId: '',
        projectId: '',
        executionMode: 'level-process',
        workflow: 'art-standard-process',
        workflowLevel: 'M',
        customWorkflowId: '',
        title: '',
        stage: '',
        zentaoId: '',
        developer: '',
        targetPage: '',
        figmaLinks: '',
        showdocHints: '',
        selectedMaterialHints: [],
        requirement: '',
        sourceType: 'task'
      },
      runChatInput: '',
      runChatPanelOpen: false,
      runChatSubmitting: false,
      runChatForm: {
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        requestStandard: '沿用当前任务上下文，只处理本次补充要求；输出交付结论、变更点、验证方式和下一步。'
      },
      codexReasoningOptions: CODEX_REASONING_OPTIONS,
      projectForm: emptyProjectForm(),
      taskSyncForm: {
        projectId: '',
        products: DEFAULT_ZENTAO_BUG_PRODUCTS
      },
      userDrawer: false,
      passwordDrawer: false,
      passwordRecordDrawer: false,
      forcePasswordDialog: false,
      roleDrawer: false,
      userForm: emptyUserForm(),
      roleForm: emptyRoleForm(),
      passwordForm: {
        id: '',
        username: '',
        password: ''
      },
      passwordRecordForm: {
        id: '',
        username: '',
        password: ''
      },
      forcePasswordForm: {
        currentPassword: '',
        password: '',
        confirmPassword: ''
      },
      workflowDesigner: emptyWorkflowDesigner(),
      workflowStageDragIndex: null,
      directoryPicker: {
        visible: false,
        loading: false,
        currentPath: '',
        parentPath: '',
        directories: []
      }
    };
  },

  computed: {
    activeNav() {
      if (['user-access', 'role-management', 'operation-logs'].includes(this.activeView)) return this.activeView;
      if (['task-result', 'manual-review'].includes(this.activeView)) return 'tasks';
      if (this.isSkillInventoryViewActive) return 'skill-assets';
      if (['ai-members'].includes(this.activeView)) return 'ai-members';
      return this.activeView;
    },

    isSkillInventoryViewActive() {
      return ['skill-inventory', 'skill-assets'].includes(this.activeView);
    },

    aiFlowStageFields() {
      return AI_FLOW_STAGE_FIELDS;
    },

    skillInventoryPageTitle() {
      return {
        list: 'AI 产物清单',
        assets: 'AI 产物清单'
      }[this.skillInventoryTab] || '技能管理';
    },

    navDefaultOpeneds() {
      return [];
    },

    pageMeta() {
      return {
        'skill-inventory': { eyebrow: '技能管理', title: this.skillInventoryPageTitle },
        'ai-members': { eyebrow: 'AI 管理', title: 'AI部门看板' },
        tasks: { eyebrow: '任务中心', title: '任务中心' },
        'codex-config': { eyebrow: 'AI 管理', title: 'Codex 配置' },
        'user-access': { eyebrow: '账户管理', title: '账户管理' },
        'role-management': { eyebrow: '角色管理', title: '角色管理' },
        'operation-logs': { eyebrow: '操作日志', title: '操作日志' },
        'project-detail': { eyebrow: '资料库详情', title: this.selectedProject?.name || '资料库详情' },
        runs: { eyebrow: '执行管理', title: '美术执行台' },
        'agent-workers': { eyebrow: '执行管理', title: '本机执行状态' },
        'ai-archive': { eyebrow: '执行管理', title: 'AI档案' },
        'task-result': { eyebrow: '任务产物', title: this.selectedTask?.name || '任务产物' },
        'manual-review': { eyebrow: '人工复核', title: '人工复核' }
      }[this.activeView];
    },

    selectedProject() {
      return this.projects.find(project => project.id === this.selectedProjectId) || null;
    },

    selectedScan() {
      return this.scans[this.selectedProjectId] || null;
    },

    selectedRun() {
      return this.runs.find(run => run.id === this.selectedRunId) || null;
    },

    enabledRoles() {
      return this.roles.filter(role => role.disabled !== true);
    },

    directSkillAssigneeOptions() {
      const rows = this.can('api.users.manage') && this.users.length
        ? this.users
        : [this.currentUser].filter(Boolean);
      return rows
        .filter(user => user && user.disabled !== true)
        .filter(user => this.directSkillUserCanExecute(user))
        .map(user => ({
          id: user.id,
          username: user.username || '',
          displayName: user.displayName || user.realname || user.name || user.username || user.id,
          role: user.role || '',
          permissions: user.permissions || [],
          passwordDisplay: user.passwordDisplay || ''
        }));
    },

    agentWorkerDisplayRows() {
      return [...(this.agentWorkers || [])].sort((a, b) => {
        const onlineDiff = Number(this.directSkillWorkerOnline(b)) - Number(this.directSkillWorkerOnline(a));
        if (onlineDiff) return onlineDiff;
        return String(b.lastHeartbeatAt || '').localeCompare(String(a.lastHeartbeatAt || ''));
      });
    },

    directSkillRunRows() {
      return (this.runs || [])
        .filter(run => this.isDirectSkillRun(run))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    },

    recentDirectSkillRunRows() {
      return this.directSkillRunRows.slice(0, 10);
    },

    recentExecutionRunRows() {
      return [...(this.runs || [])]
        .sort((a, b) => String(b.createdAt || b.updatedAt || b.finishedAt || b.startedAt || '').localeCompare(String(a.createdAt || a.updatedAt || a.finishedAt || a.startedAt || '')))
        .slice(0, 10);
    },

    aiExecutionArchiveRunRows() {
      return this.filteredAiExecutionArchiveRuns();
    },

    aiExecutionArchiveSummaryMetrics() {
      const rows = this.filteredAiExecutionArchiveRuns({ ignoreBucket: true });
      const closed = rows.filter(run => this.isAiExecutionArchiveClosedRun(run)).length;
      const rework = rows.filter(run => this.isAiExecutionArchiveReworkRun(run)).length;
      const review = rows.filter(run => this.isAiExecutionArchiveReviewRun(run)).length;
      return [
        { label: '归档任务', value: rows.length, hint: '当前筛选范围', bucket: '', tone: 'all' },
        { label: '已闭环', value: closed, hint: '完成且无需返工', bucket: 'closed', tone: 'closed' },
        { label: '待返工', value: rework, hint: '失败 / 阻塞 / 返工', bucket: 'rework', tone: 'rework' },
        { label: '待验收', value: review, hint: '完成后需人工确认', bucket: 'review', tone: 'review' }
      ];
    },

    aiExecutionArchivePagedRunRows() {
      const rows = this.aiExecutionArchiveRunRows || [];
      const pageSize = Math.max(Number(this.aiExecutionArchivePageSize) || 20, 1);
      const maxPage = Math.max(Math.ceil(rows.length / pageSize), 1);
      const page = Math.min(Math.max(Number(this.aiExecutionArchivePage) || 1, 1), maxPage);
      const start = (page - 1) * pageSize;
      return rows.slice(start, start + pageSize);
    },

    aiExecutionArchiveDetailRun() {
      const id = String(this.aiExecutionArchiveDetail?.run?.id || '').trim();
      if (!id) return null;
      return (this.runs || []).find(run => String(run.id || '') === id) || this.aiExecutionArchiveDetail.run;
    },

    aiExecutionArchiveDetailStats() {
      return this.aiExecutionArchiveDetailMetrics(this.aiExecutionArchiveDetailRun);
    },

    directSkillPendingRuns() {
      return this.directSkillRunRows.filter(run => /pending|queued/i.test(String(run.status || '')));
    },

    directSkillActiveRuns() {
      return this.directSkillRunRows.filter(run => /claimed|running|in_progress/i.test(String(run.status || '')));
    },

    directSkillCompletedRuns() {
      return this.directSkillRunRows.filter(run => /done|success|passed|completed|finished/i.test(String(run.status || '')));
    },

    directSkillMemberReadinessRows() {
      const rows = this.users.length
        ? this.users
        : [this.currentUser].filter(Boolean);
      return rows
        .filter(user => user && user.disabled !== true)
        .filter(user => this.directSkillUserCanExecute(user))
        .map(user => {
          const worker = this.directSkillWorkerForUser(user);
          const online = this.directSkillWorkerOnline(worker);
          const pendingRuns = this.directSkillPendingRunsForUser(user);
          const activeRuns = this.directSkillActiveRunsForUser(user);
          const completedRuns = this.directSkillCompletedRunsForUser(user);
          return {
            user,
            worker,
            online,
            pendingRuns,
            activeRuns,
            completedRuns,
            codexReady: worker?.codexReady === true,
            figmaMcpReady: worker?.figmaMcpReady === true,
            ready: online && worker?.codexReady === true && worker?.figmaMcpReady === true
          };
        });
    },

    agentWorkerHeartbeatRows() {
      const map = new Map();
      for (const row of this.directSkillMemberReadinessRows) {
        const key = String(row.user?.id || row.worker?.userId || '').trim();
        if (key) map.set(key, row);
      }
      for (const worker of this.agentWorkerDisplayRows) {
        const userId = String(worker.userId || '').trim();
        const key = userId || `worker:${worker.id || worker.deviceId || worker.userName || map.size}`;
        if (map.has(key)) continue;
        const matchedUser = this.users.find(user => String(user.id || '') === userId)
          || (String(this.currentUser?.id || '') === userId ? this.currentUser : null);
        const user = {
          id: matchedUser?.id || userId,
          username: matchedUser?.username || worker.userName || userId || '未命名组员',
          displayName: matchedUser?.displayName || matchedUser?.username || worker.userName || userId || '未命名组员',
          role: matchedUser?.role || ''
        };
        const online = this.directSkillWorkerOnline(worker);
        map.set(key, {
          user,
          worker,
          online,
          pendingRuns: userId ? this.directSkillPendingRunsForUser(user) : [],
          activeRuns: userId ? this.directSkillActiveRunsForUser(user) : [],
          completedRuns: userId ? this.directSkillCompletedRunsForUser(user) : [],
          codexReady: worker?.codexReady === true,
          figmaMcpReady: worker?.figmaMcpReady === true,
          ready: online && worker?.codexReady === true && worker?.figmaMcpReady === true
        });
      }
      return [...map.values()].sort((a, b) => {
        const readyDiff = Number(b.ready) - Number(a.ready);
        if (readyDiff) return readyDiff;
        const onlineDiff = Number(b.online) - Number(a.online);
        if (onlineDiff) return onlineDiff;
        const timeDiff = String(b.worker?.lastHeartbeatAt || '').localeCompare(String(a.worker?.lastHeartbeatAt || ''));
        if (timeDiff) return timeDiff;
        return String(a.user?.displayName || a.user?.username || '').localeCompare(String(b.user?.displayName || b.user?.username || ''), 'zh-Hans-CN');
      });
    },

    permissionSet() {
      return new Set(this.currentUser?.permissions || []);
    },

    isPlatformAdmin() {
      return this.currentUser?.role === 'admin';
    },

    canManageTaskCenterFields() {
      return this.can('api.taskCenter.config.manage');
    },

    zentaoSyncRunning() {
      const sync = this.appConfig.zentaoAutoSync || {};
      return Boolean(this.manualZentaoSyncPending || sync.running || sync.tasks?.running || sync.bugs?.running);
    },

    zentaoSyncLastError() {
      const sync = this.appConfig.zentaoAutoSync || {};
      return sync.lastError || sync.tasks?.lastError || sync.bugs?.lastError || '';
    },

    canAssignTaskByDrag() {
      return this.isPlatformAdmin && this.can('task.sync') && !this.loading.taskAssign;
    },

    canManageSkillValidationColumns() {
      return this.can('skill.validationColumns.manage') || this.canManageTaskCenterFields;
    },

    currentAccountPersonNames() {
      const user = this.currentUser || {};
      const names = [
        user.displayName,
        user.username,
        user.name,
        user.realname,
        user.account
      ];
      if (String(user.username || '').includes('@')) names.push(String(user.username).split('@')[0]);
      const baseKeys = new Set(names.map(name => normalizePersonName(name)).filter(Boolean));
      (this.artDepartmentUsers || []).forEach(person => {
        const aliases = [person.realname, person.name, person.account].filter(Boolean);
        if (aliases.some(alias => baseKeys.has(normalizePersonName(alias)))) {
          names.push(...aliases);
        }
      });
      return [...new Map(names
        .map(name => String(name || '').trim())
        .filter(Boolean)
        .map(name => [normalizePersonName(name), name])
      ).values()];
    },

    currentAccountPrimaryPersonName() {
      if (this.isOwnerWorkbenchAccount) return this.defaultSkillInventoryOwnerName();
      return this.currentAccountPersonNames[0] || '当前账号';
    },

    isOwnerWorkbenchAccount() {
      const user = this.currentUser || {};
      return this.isPlatformAdmin
        || [user.username, user.displayName, user.name, user.realname, user.account]
          .some(value => samePerson(value, 'zhangqw') || samePerson(value, '张倩文') || samePerson(value, 'admin'));
    },

    artDeptPeopleAliasMap() {
      const map = new Map();
      [...DEFAULT_ART_DEPT_PEOPLE, ...this.artDepartmentUsers].forEach(person => {
        const displayName = person.realname || person.name || person.account || '';
        if (!displayName) return;
        [person.realname, person.name, person.account].filter(Boolean).forEach(alias => {
          map.set(normalizePersonName(alias), displayName);
        });
      });
      ART_PERSON_ALIASES.forEach((displayName, alias) => {
        if (displayName) map.set(normalizePersonName(alias), displayName);
      });
      return map;
    },

    currentUserRoleLabel() {
      return this.roleLabel(this.currentUser?.role, this.currentUser?.roleName);
    },

    isWorkbenchAdmin() {
      return this.currentUser?.role === 'admin' || this.can('api.users.manage') || this.can('role.manage');
    },

    currentWorkerBindingUser() {
      const currentId = String(this.currentUser?.id || '').trim();
      return this.directSkillAssigneeOptions.find(user => String(user.id || '') === currentId) || this.currentUser || {};
    },

    hasCriticalNotifications() {
      if (!this.currentUser || !this.can('menu.tasks')) return false;
      const today = localDateKey(new Date());
      const dueToday = this.taskCenterCurrentArtMemberTaskRows.filter(task => task.deadline === today && !/closed|cancel|cancelled/i.test(task.zentaoStatus || task.zentao?.originalStatus || task.status || '')).length;
      const riskTasks = this.taskCenterCurrentArtMemberTaskRows.filter(task => this.isArtTaskRisk(task)).length;
      const activeBugs = this.taskCenterBugRows.filter(bug => !/closed/i.test(bug.status || bug.zentao?.status || '')).length;
      const overdueBugs = this.taskCenterBugRows.filter(bug => bug.deadline && bug.deadline < today && !/closed/i.test(bug.status || bug.zentao?.status || '')).length;
      return dueToday + riskTasks + activeBugs + overdueBugs > 0;
    },

    artDepartmentUsers() {
      return this.appConfig.zentaoArtUsers || [];
    },

    codexConfigStatusText() {
      const config = this.appConfig.codex || {};
      return [
        config.model ? `模型 ${config.model}` : '使用本机模型',
        config.baseUrl ? `已配置 Base URL` : '使用本机 Base URL',
        config.hasApiKey ? `Key 已配置${config.keyFingerprint ? `（${config.keyFingerprint}）` : ''}` : 'Key 未配置'
      ].join(' · ');
    },

    selectedRunChangeItems() {
      if (this.activeView !== 'runs' && !this.runDiffPreview.visible) return [];
      const summary = this.selectedRun?.changeSummary || {};
      const groups = [
        ['added', 'added'],
        ['changed', 'changed'],
        ['removed', 'removed']
      ];
      const items = groups.flatMap(([key, category]) => (summary[key] || []).map(item => ({
        ...item,
        changeCategory: item.changeCategory || category
      })));
      if (items.length) return items;
      return (summary.after || []).map(item => ({
        ...item,
        changeCategory: this.gitChangeCategoryFromStatus(item.status)
      }));
    },

    selectedRunChangeMetrics() {
      return this.selectedRunChangeItems.reduce((metrics, item) => {
        const category = item.changeCategory || this.gitChangeCategoryFromStatus(item.status);
        if (category === 'added') metrics.added += 1;
        else if (category === 'removed') metrics.removed += 1;
        else metrics.changed += 1;
        return metrics;
      }, { added: 0, changed: 0, removed: 0 });
    },

    selectedRunActionLabel() {
      if (this.isDirectSkillRun(this.selectedRun)) return this.selectedRun?.status === 'pending' ? '等待 Worker 自动领取' : '本机执行';
      if (this.isRunInProgress(this.selectedRun)) return '执行中';
      if (this.canResumeRun(this.selectedRun)) return '继续执行';
      return this.hasRunExecuted(this.selectedRun) ? '再次执行' : '发起执行';
    },

    canRestartSelectedRun() {
      return Boolean(this.selectedRun && !this.isDirectSkillRun(this.selectedRun) && !this.isRunInProgress(this.selectedRun) && this.hasRunExecuted(this.selectedRun));
    },

    runDiffPreviewTitle() {
      if (this.runDiffPreview.mode === 'image') return '图片变更预览';
      if (this.runDiffPreview.mode === 'binary') return '二进制文件预览';
      return this.runDiffPreview.mode === 'content' ? '文件内容预览' : '文件对比预览';
    },

    selectedRunTaskUrl() {
      return this.runTaskUrl(this.selectedRun);
    },

    logHtml() {
      const text = normalizeLogMarkdown(this.logText);
      if (!text.trim()) return '<div class="empty-block">暂无日志。</div>';
      return this.renderMarkdown(text, this.selectedRun?.logPath || '');
    },

    currentProjectSkillOptions() {
      const scan = this.scans[this.runForm.projectId] || null;
      const rows = (scan?.skills || []).map(skill => {
        const path = skill.git?.relativePath || skill.relativePath || skill.path || '';
        const fileName = this.fileNameFromPath(path);
        const title = skillDisplayText(skill);
        const value = path || skill.id;
        return {
          value,
          title,
          path,
          kind: this.skillInventoryKind(skill),
          label: [fileName || skill.id, title].filter(Boolean).join(' · ')
        };
      });
      const seen = new Set();
      return rows.filter(row => {
        const key = String(row.value || '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },

    currentProjectExecutionMaterialOptions() {
      const scan = this.scans[this.runForm.projectId] || null;
      const skills = Array.isArray(scan?.skills) ? scan.skills : [];
      const rows = skills
        .map(skill => {
          const path = skill.git?.relativePath || skill.relativePath || skill.path || '';
          const fileName = this.fileNameFromPath(path);
          const isMd = /\.(md|markdown)$/i.test(path || skill.id || '');
          const kind = this.skillInventoryKind(skill);
          if (!path && !skill.id) return null;
          return {
            value: path || skill.id,
            label: `${kind === 'skill' ? 'Skill' : isMd ? 'md' : '资料'} · ${skill.title || fileName || skill.id}`,
            subtitle: path || skill.id,
            kind
          };
        })
        .filter(Boolean);
      const seen = new Set();
      return rows.filter(row => {
        const key = String(row.value || '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },

    isBugFixRun() {
      return this.runForm.workflow === 'bug-fix';
    },

    isSingleSkillRun() {
      return !this.isBugFixRun && this.runForm.executionMode === 'single-skill';
    },

    isCustomWorkflowRun() {
      return !this.isBugFixRun && this.runForm.executionMode === 'custom-workflow';
    },

    isLevelProcessRun() {
      return !this.isBugFixRun && !this.isSingleSkillRun && !this.isCustomWorkflowRun;
    },

    runnableCustomWorkflows() {
      return this.customWorkflows.filter(workflow => !workflow.projectId || !this.runForm.projectId || workflow.projectId === this.runForm.projectId);
    },

    selectedCustomWorkflow() {
      return this.customWorkflows.find(workflow => workflow.id === this.runForm.customWorkflowId) || null;
    },

    workflowDesignerSkillOptions() {
      const projectId = this.workflowDesigner.projectId;
      if (!projectId) return [];
      const scan = this.scans[projectId] || null;
      return (scan?.skills || []).map(skill => ({
        value: skill.id,
        title: skillDisplayText(skill),
        label: `${skill.id} · ${skillDisplayText(skill)}`
      }));
    },

    filteredWorkflowSkillOptions() {
      if (!this.workflowDesigner.projectId) return [];
      const keyword = String(this.workflowDesigner.skillKeyword || '').trim().toLowerCase();
      return this.workflowDesignerSkillOptions.filter(skill => {
        const haystack = `${skill.value}\n${skill.title}`.toLowerCase();
        return !keyword || haystack.includes(keyword);
      });
    },

    workflowLevelTemplates() {
      return this.appConfig.workflowLevels?.length ? this.appConfig.workflowLevels : DEFAULT_WORKFLOW_LEVELS;
    },

    workflowPresetGroups() {
      return [
        {
          name: '开发交付',
          items: [
            {
              id: 'light-change-flow',
              name: '轻量改动流',
              description: '适合文案、样式、小逻辑和单点修复。',
              stages: [
                { name: '需求解析', skillId: 'parse-task', doneCriteria: '确认改动范围和验收点' },
                { name: '轻量运行验证', skillId: 'dev-smoke', doneCriteria: '记录验证命令或运行证据' },
                { name: '代码审查', skillId: 'code-review', doneCriteria: '输出代码审查结论' },
                { name: '交付报告', skillId: 'delivery-report', doneCriteria: '输出交付结论和剩余风险' }
              ]
            },
            {
              id: 'standard-dev-flow',
              name: '标准开发流',
              description: '适合普通页面、组件优化、接口联动和局部多主题改动。',
              stages: [
                { name: '需求解析', skillId: 'parse-task', doneCriteria: '产出需求清单' },
                { name: '页面实现与联调', skillId: 'figma-to-code', doneCriteria: '完成页面或组件实现' },
                { name: '多语言自动追加', skillId: 'i18n-generator', doneCriteria: '补齐多语言 Key 和文案' },
                { name: '轻量运行验证', skillId: 'dev-smoke', doneCriteria: '保留运行态证据' },
                { name: '兼容检查', skillId: 'compat-check', doneCriteria: '输出兼容检查结论' },
                { name: '代码审查', skillId: 'code-review', doneCriteria: '输出审查结论' },
                { name: '质检报告', skillId: 'dev-report', doneCriteria: '核对需求覆盖率和问题清单' },
                { name: '交付报告', skillId: 'delivery-report', doneCriteria: '输出交付结论' }
              ]
            },
            {
              id: 'delivery-flow',
              name: '完整交付流',
              description: '适合新页面、新模块、多接口、多主题、多状态和设计稿还原的 12 阶段完整交付。',
              stages: [
                { name: '需求解析', skillId: 'parse-task', doneCriteria: '产出需求清单' },
                { name: 'Figma / ShowDoc 资料整理', skillId: 'parse-task', doneCriteria: '整理设计、接口和主题覆盖资料' },
                { name: 'ShowDoc 模型生成', skillId: 'showdoc-generator', doneCriteria: '生成或确认接口类型与请求封装' },
                { name: '页面实现与 API 联调', skillId: 'figma-to-code', doneCriteria: '完成页面实现和 API 联调' },
                { name: '多语言自动追加', skillId: 'i18n-generator', doneCriteria: '补齐多语言 Key 和文案' },
                { name: '轻量运行验证', skillId: 'dev-smoke', doneCriteria: '保留运行态证据' },
                { name: '多主题 / 多端适配验证', skillId: 'compat-check', doneCriteria: '输出主题和端适配检查结论' },
                { name: 'Figma 还原度验收', skillId: 'figma-fidelity-report', doneCriteria: '输出前后对比和还原度结论' },
                { name: '代码审查', skillId: 'code-review', doneCriteria: '输出审查结论' },
                { name: '功能质检报告', skillId: 'dev-report', doneCriteria: '核对需求覆盖率和问题清单' },
                { name: '自动修复', skillId: 'auto-fix', doneCriteria: '记录自动修复内容或跳过原因' },
                { name: '最终交付报告', skillId: 'delivery-report', doneCriteria: '输出交付结论' }
              ]
            }
          ]
        },
        {
          name: '设计还原',
          items: [
            {
              id: 'figma-fidelity-flow',
              name: 'Figma 还原流',
              description: '适合页面实现后集中做截图、还原度对比和交付验收。',
              stages: [
                { name: '需求解析', skillId: 'parse-task', doneCriteria: '确认 Figma 节点和页面范围' },
                { name: '页面实现确认', skillId: 'figma-to-code', doneCriteria: '确认页面入口和实现范围' },
                { name: '运行截图验证', skillId: 'dev-smoke', doneCriteria: '保留目标页面运行截图' },
                { name: 'Figma 还原度验收', skillId: 'figma-fidelity-report', doneCriteria: '输出前后对比和还原度结论' },
                { name: '兼容检查', skillId: 'compat-check', doneCriteria: '确认多主题/多端影响' },
                { name: '交付报告', skillId: 'delivery-report', doneCriteria: '输出最终交付报告' }
              ]
            },
            {
              id: 'multi-theme-flow',
              name: '多主题兼容流',
              description: '适合 Web5 多主题、多端和响应式适配检查。',
              stages: [
                { name: '需求解析', skillId: 'parse-task', doneCriteria: '确认主题覆盖矩阵' },
                { name: '轻量运行验证', skillId: 'dev-smoke', doneCriteria: '保留基础运行证据' },
                { name: '多主题 / 多端适配验证', skillId: 'compat-check', doneCriteria: '输出主题和端适配检查结论' },
                { name: 'Figma 还原度验收', skillId: 'figma-fidelity-report', doneCriteria: '有设计稿时输出对比报告' },
                { name: '功能质检报告', skillId: 'dev-report', doneCriteria: '汇总覆盖率和问题清单' },
                { name: '最终交付报告', skillId: 'delivery-report', doneCriteria: '输出交付结论' }
              ]
            }
          ]
        },
        {
          name: '接口文案',
          items: [
            {
              id: 'api-integration-flow',
              name: '接口联调流',
              description: '适合 ShowDoc、API、Store 与页面联动任务。',
              stages: [
                { name: '需求解析', skillId: 'parse-task', doneCriteria: '确认接口线索和页面用途' },
                { name: 'ShowDoc 模型生成', skillId: 'showdoc-generator', doneCriteria: '生成接口类型和请求封装' },
                { name: 'API 取调编排', skillId: 'api-compose', doneCriteria: '完成页面、Store 与接口联调' },
                { name: '轻量运行验证', skillId: 'dev-smoke', doneCriteria: '保留联调运行证据' },
                { name: '功能质检报告', skillId: 'dev-report', doneCriteria: '核对接口联调完成率' },
                { name: '最终交付报告', skillId: 'delivery-report', doneCriteria: '输出交付结论' }
              ]
            },
            {
              id: 'i18n-flow',
              name: '多语言补齐流',
              description: '适合新增文案、多语言 Key、polyglot 和翻译补充。',
              stages: [
                { name: '需求解析', skillId: 'parse-task', doneCriteria: '确认文案范围和页面文件' },
                { name: '多语言自动追加', skillId: 'i18n-generator', doneCriteria: '补齐多语言 Key 和文案' },
                { name: '轻量运行验证', skillId: 'dev-smoke', doneCriteria: '确认页面文案显示正常' },
                { name: '代码审查', skillId: 'code-review', doneCriteria: '检查多语言使用风险' },
                { name: '交付报告', skillId: 'delivery-report', doneCriteria: '输出交付结论' }
              ]
            }
          ]
        },
        {
          name: '质量修复',
          items: [
            {
              id: 'code-review-flow',
              name: '代码审查流',
              description: '适合只检查改动风险、补充轻量验证和交付说明。',
              stages: [
                { name: '代码审查', skillId: 'code-review', doneCriteria: '输出代码审查报告' },
                { name: '轻量运行验证', skillId: 'dev-smoke', doneCriteria: '记录验证命令或运行证据' },
                { name: '交付报告', skillId: 'delivery-report', doneCriteria: '输出交付结论和剩余风险' }
              ]
            },
            {
              id: 'bug-fix-flow',
              name: 'Bug 修复流',
              description: '适合普通 Bug 修复后的定位、验证、审查和交付闭环。',
              stages: [
                { name: 'Bug 审计定位', skillId: 'bug-audit-report', doneCriteria: '输出 Bug 风险和定位结论' },
                { name: '轻量运行验证', skillId: 'dev-smoke', doneCriteria: '保留修复验证证据' },
                { name: '代码审查', skillId: 'code-review', doneCriteria: '检查修复改动风险' },
                { name: '交付报告', skillId: 'delivery-report', doneCriteria: '输出修复说明和回归建议' }
              ]
            }
          ]
        },
        {
          name: '专项工具',
          items: [
            {
              id: 'dialog-dev-flow',
              name: '弹窗开发流',
              description: '适合业务弹窗、活动弹窗和弹窗适配实现。',
              stages: [
                { name: '需求解析', skillId: 'parse-task', doneCriteria: '确认弹窗触发、状态和适配范围' },
                { name: '弹窗开发', skillId: 'dialog-generator', doneCriteria: '完成弹窗组件实现' },
                { name: '多语言自动追加', skillId: 'i18n-generator', doneCriteria: '补齐弹窗文案 Key' },
                { name: '轻量运行验证', skillId: 'dev-smoke', doneCriteria: '保留弹窗运行截图或交互证据' },
                { name: '兼容检查', skillId: 'compat-check', doneCriteria: '确认多端/多主题表现' },
                { name: '交付报告', skillId: 'delivery-report', doneCriteria: '输出交付结论' }
              ]
            },
            {
              id: 'image-resource-flow',
              name: '图片资源处理流',
              description: '适合图片转 WebP、资源替换和活动图优化。',
              stages: [
                { name: '图片资源处理', skillId: 'xnconvert-webp', doneCriteria: '完成图片转换或资源替换' },
                { name: '轻量运行验证', skillId: 'dev-smoke', doneCriteria: '确认页面资源正常加载' },
                { name: '代码审查', skillId: 'code-review', doneCriteria: '检查资源引用风险' },
                { name: '交付报告', skillId: 'delivery-report', doneCriteria: '输出交付结论' }
              ]
            },
            {
              id: 'branch-prepare-flow',
              name: '分支准备流',
              description: '适合开工前创建/切换分支并沉淀初始需求资料。',
              stages: [
                { name: '分支准备', skillId: 'git-branch', doneCriteria: '确认分支创建或切换结果' },
                { name: '需求解析', skillId: 'parse-task', doneCriteria: '产出需求清单和上下文' },
                { name: '阶段报告初始化', skillId: 'stage-report', doneCriteria: '初始化阶段执行报告' }
              ]
            }
          ]
        }
      ];
    },

    workflowPresetTemplates() {
      return this.workflowPresetGroups.flatMap(group => group.items);
    },

    workflowLevelOptions() {
      const levels = this.appConfig.workflowLevels?.length ? this.appConfig.workflowLevels : DEFAULT_WORKFLOW_LEVELS;
      return levels.map(level => ({
        label: `${level.level} ${level.name.replace('流程', '')}`,
        value: level.level
      }));
    },

    selectedWorkflowPlan() {
      if (this.isBugFixRun) {
        return {
          level: 'BUG',
          name: 'Bug 修复流程',
          workflow: 'bug-fix',
          summary: '复现或定位问题，做最小修复，并输出回归说明。',
          stages: ['Bug 复现与定位', '最小修复', '针对性验证', '回归说明'].map((name, index) => ({ no: index + 1, name }))
        };
      }
      if (this.isSingleSkillRun) {
        return {
          level: 'Single',
          name: '单个规范 / Skill 执行',
          workflow: 'art-single-skill',
          summary: '只执行目标规范、md 或 Skill，不自动扩展为全流程。',
          stages: [{ no: 1, name: this.runForm.stage || '等待填写规范 / Skill' }]
        };
      }
      if (this.isCustomWorkflowRun) {
        const workflow = this.selectedCustomWorkflow;
        return {
          level: 'Custom',
          name: workflow?.name || '自定义工作流',
          workflow: 'custom-workflow',
          summary: workflow?.description || '按已保存模板组合阶段执行。',
          stages: (workflow?.stages || []).map((stage, index) => ({ no: index + 1, name: stage.name }))
        };
      }
      const levels = this.appConfig.workflowLevels?.length ? this.appConfig.workflowLevels : DEFAULT_WORKFLOW_LEVELS;
      const level = levels.find(item => item.level === this.runForm.workflowLevel) || levels.find(item => item.level === 'M') || levels[0];
      return {
        ...level,
        stages: (level.stages || []).map((name, index) => ({ no: index + 1, name }))
      };
    },

    selectedWorkflowRuleText() {
      const scan = this.scans[this.runForm.projectId] || null;
      const profile = scan?.workflowProfile;
      const source = profile?.ruleSource?.skillConfigPath || this.projects.find(project => project.id === this.runForm.projectId)?.skillConfigPath || '.agent-hub/config.md';
      const skillCount = profile?.skillCount ?? scan?.skills?.length ?? 0;
      return `项目规则来源：${source}；已识别 ${skillCount} 个项目 Skill。执行时会按该项目自己的规则、规范 md 和 Skill 运行。`;
    },

    runDialogTitle() {
      return this.isBugFixRun ? '新建 Bug 修复' : '新建美术执行';
    },

    runSubmitLabel() {
      return this.isBugFixRun ? '创建修复任务' : '创建美术执行';
    },

    metrics() {
      const scans = Object.values(this.scans);
      const skillCount = scans.reduce((sum, scan) => sum + (scan.skills?.length || 0), 0);
      const taskCount = scans.reduce((sum, scan) => sum + (scan.tasks?.length || 0), 0);
      return [
        { label: '项目', value: this.projects.length, hint: '已注册仓库' },
        { label: '技能', value: skillCount, hint: '技能配置路由' },
        { label: '任务资产', value: taskCount, hint: '历史审计记录' },
        { label: 'AI 执行', value: this.runs.length, hint: '美术执行记录' }
      ];
    },

    businessTaskRows() {
      return this.businessTasks.filter(task => !isBugLikeTask(task)).map(task => {
        const project = this.projects.find(item => item.id === task.projectId);
        const relatedRuns = this.runsForTask(task);
        const latestRun = relatedRuns[0] || null;
        const relatedReviews = this.reviewsForTask(task);
        const platformStatus = this.platformStatusForTask(latestRun, relatedReviews);
        const quality = this.taskQualityMetrics(task, relatedRuns, platformStatus);
        const isLowEffortAcceptance = isLowEffortArtAcceptanceTask(task);
        const workloadEstimate = isLowEffortAcceptance ? null : inferTaskWorkloadLevel(task, project);
        return {
          ...task,
          displayTitle: this.taskDisplayTitle(task),
          isLowEffortAcceptance,
          priorityFlags: isLowEffortAcceptance ? [] : this.taskPriorityFlags(task),
          projectName: project?.name || task.projectId || '-',
          sourceLabel: task.source === 'zentao-art-snapshot' ? '美术禅道快照' : task.source === 'google-sheet' ? '表格导入' : task.source === 'platform' ? '平台创建' : task.source === 'zentao' ? 'ZenTao同步' : '人工录入',
          zentaoStatus: task.zentaoStatus || task.zentao?.status || task.zentao?.originalStatus || task.status || '',
          isCurrent: task.isCurrent !== false,
          syncStatus: task.syncStatus || (task.isCurrent === false ? 'non_current' : 'current'),
          deadline: task.deadline || task.zentao?.deadline || '',
          zentaoCreatedAt: task.zentaoCreatedAt || task.zentao?.openedDate || '',
          completion: clampPercent(task.zentaoProgress ?? task.completion),
          runCount: relatedRuns.length,
          latestRun,
          platformStatus,
          quality,
          workloadEstimate
        };
      });
    },

    isTasksRoute() {
      const path = typeof window !== 'undefined' ? window.location.pathname : this.currentPath;
      return this.activeView === 'tasks' || this.currentPath === '/tasks' || path === '/tasks';
    },


    bugRows() {
      return this.bugs.map(bug => {
        const project = this.projects.find(item => item.id === bug.projectId);
        return {
          ...bug,
          displayTitle: this.bugDisplayTitle(bug),
          projectName: project?.name || bug.projectId || '-',
          workloadEstimate: inferBugWorkloadLevel(bug, project)
        };
      });
    },

    taskCenterBusinessTaskRows() {
      return this.businessTaskRows;
    },

    taskCenterArtMemberTaskRows() {
      return this.taskCenterBusinessTaskRows.filter(task => this.isArtDepartmentTask(task));
    },

    taskCenterCurrentBusinessTaskRows() {
      return this.taskCenterBusinessTaskRows.filter(task => task.isCurrent !== false);
    },

    taskCenterCurrentArtMemberTaskRows() {
      return this.taskCenterArtMemberTaskRows.filter(task => task.isCurrent !== false);
    },

    taskCenterMetricTaskRows() {
      return this.taskCenterCurrentArtMemberTaskRows.filter(task => !this.isLowEffortArtAcceptanceTask(task));
    },

    taskCenterBugRows() {
      return this.bugRows.filter(bug => this.isArtDepartmentBug(bug));
    },

    filteredBusinessTaskRows() {
      return this.filteredBusinessTaskRowsForView(this.taskCenterRevision);
    },

    filteredBugRows() {
      return this.filteredBugRowsForView(this.taskCenterRevision);
    },

    currentTaskCenterRows() {
      return this.taskCenterRowsForView(this.taskCenterRevision);
    },

    pagedTaskCenterRows() {
      return paginate(this.currentTaskCenterRows, this.businessTaskPage, this.businessTaskPageSize);
    },

    pagedBusinessTaskRows() {
      return this.pagedBusinessTaskRowsForView(this.taskCenterRevision);
    },

    pagedBugRows() {
      return this.pagedBugRowsForView(this.taskCenterRevision);
    },

    aiArchiveRows() {
      const taskRows = this.currentBusinessTaskRows
        .filter(task => task.runCount > 0)
        .filter(task => this.isArtDeptPerson(task.developer))
        .map(task => ({
          ...task,
          latestRunAt: task.latestRun ? this.runDisplayTime(task.latestRun) : '',
          manualFlowRecord: this.aiFlowRecordForTask(task),
          archiveRowType: 'task'
        }));
      const taskKeys = new Set(taskRows.map(task => `${task.projectId}:${task.taskNo || task.id}`));
      const manualOnlyRows = this.aiFlowRecords
        .filter(record => record.status !== 'deleted')
        .filter(record => !taskKeys.has(`${record.projectId}:${record.taskNo || record.taskId}`))
        .map(record => this.aiFlowManualOnlyArchiveRow(record));
      return [...taskRows, ...manualOnlyRows];
    },

    aiArtifactRows() {
      return this.taskRows.filter(task => task.material || task.reportCount > 0 || task.evidenceCount > 0 || task.latestRunPath || task.path);
    },

    filteredAiArtifactRows() {
      const keyword = this.archiveFilters.keyword.trim().toLowerCase();
      return this.aiArtifactRows.filter(task => {
        const projectMatched = !this.archiveFilters.projectId || task.projectId === this.archiveFilters.projectId;
        const qualityMatched = !this.archiveFilters.qualityStatus || statusBucket(task.status) === this.archiveFilters.qualityStatus;
        const haystack = `${task.name || ''}\n${task.projectName || ''}\n${task.path || ''}`.toLowerCase();
        return projectMatched && qualityMatched && (!keyword || haystack.includes(keyword));
      });
    },

    pagedAiArtifactRows() {
      return paginate(this.filteredAiArtifactRows, this.aiArtifactPage, this.aiArtifactPageSize);
    },

    filteredAiArchiveRows() {
      const keyword = this.archiveFilters.keyword.trim().toLowerCase();
      return this.aiArchiveRows.filter(task => {
        if (task.archiveRowType === 'task') {
          const activeZentaoTask = task.isCurrent !== false
            && !/done|closed|cancel|cancelled/i.test(String(task.zentaoStatus || task.zentao?.originalStatus || ''));
          if (!activeZentaoTask) return false;
          if (!this.isArtDeptPerson(task.developer)) return false;
        }
        if (task.archiveRowType === 'manual-only' && task.developer && !this.isArtDeptPerson(task.developer)) return false;
        const projectMatched = !this.archiveFilters.projectId || task.projectId === this.archiveFilters.projectId;
        const qualityMatched = !this.archiveFilters.qualityStatus || statusBucket(task.platformStatus) === this.archiveFilters.qualityStatus;
        const haystack = `${task.taskNo || ''}\n${task.title || ''}\n${task.developer || ''}\n${task.manualFlowRecord?.agentModel || ''}\n${task.manualFlowRecord?.summaryIssues || ''}`.toLowerCase();
        return projectMatched && qualityMatched && (!keyword || haystack.includes(keyword));
      });
    },

    pagedAiArchiveRows() {
      return paginate(this.filteredAiArchiveRows, this.aiArchivePage, this.aiArchivePageSize);
    },

    aiArchiveTotal() {
      return this.filteredAiArchiveRows.length;
    },

    selectedAiArchiveTask() {
      if (!this.selectedAiArchiveTaskId) return null;
      return this.aiArchiveRows.find(task => task.id === this.selectedAiArchiveTaskId) || null;
    },

    selectedTaskManualFlowRecord() {
      return this.selectedTask ? this.aiFlowRecordForTask(this.selectedTask) : null;
    },

    selectedTaskArchiveRow() {
      if (!this.selectedTask) return null;
      const project = this.projects.find(item => item.id === this.selectedTask.projectId || item.id === this.selectedProjectId);
      return {
        ...this.selectedTask,
        projectId: this.selectedTask.projectId || this.selectedProjectId,
        projectName: project?.name || this.selectedProjectId || '-',
        taskNo: this.selectedTask.taskNo || this.selectedTask.zentaoId || '',
        title: this.selectedTask.title || this.selectedTask.name || '',
        displayTitle: this.selectedTask.name || this.selectedTask.title || this.selectedTask.taskNo || '',
        developer: this.selectedTask.developer || '',
        manualFlowRecord: this.selectedTaskManualFlowRecord,
        archiveRowType: 'task'
      };
    },

    aiArchiveMetrics() {
      const rows = this.aiArchiveRows;
      const reviewed = rows.filter(task => task.quality.reviewed).length;
      const avgScoreRows = rows.filter(task => task.quality.executed || task.quality.reviewed);
      const avgScore = avgScoreRows.length
        ? Math.round(avgScoreRows.reduce((sum, task) => sum + task.quality.aiScore, 0) / avgScoreRows.length)
        : 0;
      const bugCount = rows.reduce((sum, task) => sum + task.quality.bugCount, 0);
      const criticalBugCount = rows.reduce((sum, task) => sum + task.quality.criticalBugCount, 0);
      const runCount = rows.reduce((sum, task) => sum + task.runCount, 0);
      const flowRecords = this.aiFlowRecords.filter(record => record.status !== 'deleted');
      const confirmedRecords = flowRecords.filter(record => record.status === 'confirmed');
      const avgFlow = flowRecords.length
        ? Math.round(flowRecords.reduce((sum, record) => sum + Number(record.flowCompletion || 0), 0) / flowRecords.length)
        : 0;
      const pendingFlow = rows.filter(task => !task.manualFlowRecord).length;
      return [
        { label: '开发库任务', value: rows.length, hint: '仅包含已跑 AI 执行的单子' },
        { label: '执行次数', value: runCount, hint: '所有任务的 AI 执行合计' },
        { label: '人工记录', value: flowRecords.length, hint: `${confirmedRecords.length} 条已确认` },
        { label: '流程完成度', value: flowRecords.length ? `${avgFlow}%` : '-', hint: '来自人工全流程记录' },
        { label: '待补充记录', value: pendingFlow, hint: '有开发库记录但未补人工流程记录' },
        { label: '历史产物', value: this.aiArtifactRows.length, hint: '扫描到的历史任务结果' },
        { label: '人工验收', value: reviewed, hint: '已有验收评分的任务' },
        { label: '平均质量', value: avgScoreRows.length ? `${avgScore}%` : '-', hint: '基于执行与验收数据' },
        { label: '关联 Bug', value: bugCount, hint: '按禅道任务号归因' },
        { label: '严重 Bug', value: criticalBugCount, hint: 'P1/P2 或 S1/S2' }
      ];
    },

    taskCenterTotal() {
      return this.taskCenterTotalForView(this.taskCenterRevision);
    },

    effectiveTaskCenterMode() {
      return this.taskCenterModeForView(this.taskCenterRevision);
    },

    hasActiveTaskFilters() {
      return this.hasActiveTaskFiltersForView(this.taskCenterRevision);
    },

    activeTaskFilterText() {
      return this.activeTaskFilterTextForView(this.taskCenterRevision);
    },

    taskMetricMatched(task) {
      const metric = this.taskFilters.metric;
      if (!metric) return true;
      if (this.taskMetricMode(metric) !== 'task') return false;
      const today = localDateKey(new Date());
      if (metric === 'allTasks') return true;
      if (metric === 'todayDue') return task.deadline === today;
      if (metric === 'soonDue') return ['soon', 'overdue'].includes(this.deadlineState(task.deadline || task.zentao?.deadline));
      if (metric === 'currentTasks') return task.isCurrent !== false;
      if (metric === 'nonCurrentTasks') return task.isCurrent === false;
      if (metric === 'urgentTask') return this.isUrgentTask(task);
      if (metric === 'insertTask') return this.isInsertTask(task);
      if (metric === 'riskTask') return this.isArtTaskRisk(task);
      if (metric === 'executed') return task.runCount > 0;
      if (metric === 'unexecuted') return task.runCount === 0;
      if (this.isLowEffortArtAcceptanceTask(task)) return false;
      if (metric === 'levelXS') return task.workloadEstimate?.level === 'XS';
      if (metric === 'levelS') return task.workloadEstimate?.level === 'S';
      if (metric === 'levelM') return task.workloadEstimate?.level === 'M';
      if (metric === 'levelL') return task.workloadEstimate?.level === 'L';
      if (metric === 'quality') return task.quality.executed || task.quality.reviewed;
      if (metric === 'taskRelatedBug') return task.quality.bugCount > 0;
      if (metric === 'passed') return statusBucket(task.platformStatus) === 'passed';
      if (metric === 'blocked') return ['blocked', 'failed'].includes(statusBucket(task.platformStatus));
      return false;
    },

    bugMetricMatched(bug) {
      const metric = this.taskFilters.metric;
      if (!metric) return true;
      if (this.taskMetricMode(metric) !== 'bug') return false;
      if (metric === 'webBug') return true;
      if (metric === 'activeBug') return /active|激活|opened|delay/i.test(bug.status || '');
      if (metric === 'pendingCloseBug') return /pending_close|resolved/i.test(bug.status || '') && !bug.zentao?.closedBy && !bug.zentao?.closedDate;
      if (metric === 'onlineBug') return /线上\s*bug|线上/i.test(bug.title || bug.displayTitle || '');
      if (metric === 'internalBug') return !/线上\s*bug|线上/i.test(bug.title || bug.displayTitle || '');
      if (metric === 'urgentBug') return Number(bug.pri || 0) <= 2 || Number(bug.severity || 0) <= 2;
      if (metric === 'bugRelatedTask') return Boolean(bug.zentao?.task);
      return false;
    },

    taskCenterDescription() {
      if (this.effectiveTaskCenterMode === 'bug') return 'Bug 主数据，按项目、指派人和状态跟踪修复闭环。';
      return '业务任务主数据，执行记录会按任务号或任务 ID 自动归档。';
    },

    taskSyncButtonText() {
      if (this.loading.syncTasks || this.zentaoSyncRunning) return '同步中...';
      return this.effectiveTaskCenterMode === 'bug' ? '同步 Bug' : '同步任务';
    },

    zentaoStatusOptions() {
      if (this.effectiveTaskCenterMode === 'bug') {
        return [
          { label: '激活', value: 'active' },
          { label: '待关闭', value: 'pending_close' },
          { label: '已解决', value: 'resolved' },
          { label: '延期', value: 'delay' },
          { label: '已关闭', value: 'closed' }
        ];
      }
      return [
        { label: '未开始', value: 'wait' },
        { label: '进行中', value: 'doing' },
        { label: '已暂停', value: 'pause' },
        { label: '已完成', value: 'done' },
        { label: '已关闭', value: 'closed' }
      ];
    },

    selectedBusinessTask() {
      if (this.effectiveTaskCenterMode !== 'task' || !this.selectedBusinessTaskId) return null;
      return this.taskCenterBusinessTaskRows.find(task => task.id === this.selectedBusinessTaskId) || null;
    },

    currentBusinessTaskRows() {
      return this.businessTaskRows.filter(task => task.isCurrent !== false);
    },

    selectedBug() {
      if (this.effectiveTaskCenterMode !== 'bug' || !this.selectedBugId) return null;
      return this.taskCenterBugRows.find(bug => bug.id === this.selectedBugId) || null;
    },

    taskReviewHistory() {
      return this.selectedBusinessTask ? this.reviewsForTask(this.selectedBusinessTask) : [];
    },

    taskCenterMetrics() {
      if (this.effectiveTaskCenterMode === 'bug') {
        const rows = this.taskCenterBugRows;
        const active = rows.filter(bug => /active|激活|opened|delay/i.test(bug.status)).length;
        const pendingClose = rows.filter(bug => /pending_close|resolved/i.test(bug.status || '') && !bug.zentao?.closedBy && !bug.zentao?.closedDate).length;
        const online = rows.filter(bug => /线上\s*bug|线上/i.test(bug.title || bug.displayTitle || '')).length;
        const internal = rows.length - online;
        const urgent = rows.filter(bug => Number(bug.pri || 0) <= 2 || Number(bug.severity || 0) <= 2).length;
        return [
          { label: 'Bug 总数', value: rows.length, hint: 'ZenTao Bug 数据', filter: 'webBug' },
          { label: '待处理', value: active, hint: '状态为激活', filter: 'activeBug' },
          { label: '待关闭', value: pendingClose, hint: '已解决，等待确认关闭', filter: 'pendingCloseBug' },
          { label: '线上 Bug', value: online, hint: '标题标记为线上', filter: 'onlineBug' },
          { label: '内部 Bug', value: internal, hint: '内部或未标记来源', filter: 'internalBug' },
          { label: '高优先级', value: urgent, hint: 'P1/P2 或 S1/S2', filter: 'urgentBug' }
        ];
      }
      const rows = this.taskCenterCurrentArtMemberTaskRows;
      const today = localDateKey(new Date());
      const current = rows.filter(task => task.isCurrent).length;
      const nonCurrent = rows.length - current;
      const todayDue = rows.filter(task => task.deadline === today).length;
      const soonDue = rows.filter(task => ['soon', 'overdue'].includes(this.deadlineState(task.deadline || task.zentao?.deadline))).length;
      const urgent = rows.filter(task => this.isUrgentTask(task)).length;
      const inserted = rows.filter(task => this.isInsertTask(task)).length;
      const riskTasks = rows.filter(task => this.isArtTaskRisk(task)).length;
      const done = rows.filter(task => statusBucket(task.platformStatus) === 'passed').length;
      const blocked = rows.filter(task => ['blocked', 'failed', 'rework'].includes(statusBucket(task.platformStatus))).length;
      const metricRows = this.taskCenterMetricTaskRows;
      const linkedRuns = rows.filter(task => task.runCount > 0).length;
      const unexecuted = rows.length - linkedRuns;
      const extraSmallTasks = metricRows.filter(task => task.workloadEstimate?.level === 'XS').length;
      const smallTasks = metricRows.filter(task => task.workloadEstimate?.level === 'S').length;
      const mediumTasks = metricRows.filter(task => task.workloadEstimate?.level === 'M').length;
      const largeTasks = metricRows.filter(task => task.workloadEstimate?.level === 'L').length;
      const executedRows = rows.filter(task => task.quality.executed);
      const reviewedRows = rows.filter(task => task.quality.reviewed);
      const qualityRows = reviewedRows.length ? reviewedRows : executedRows;
      const avgAiScore = qualityRows.length
        ? Math.round(qualityRows.reduce((sum, task) => sum + task.quality.aiScore, 0) / qualityRows.length)
        : 0;
      const totalRelatedBugs = rows.reduce((sum, task) => sum + task.quality.bugCount, 0);
      const webBugCount = this.taskCenterBugRows.length;
      const qualityHint = reviewedRows.length
        ? `基于 ${reviewedRows.length} 条人工验收`
        : executedRows.length
          ? `基于 ${executedRows.length} 条执行记录估算`
          : '暂无执行/验收数据';
      return [
        { label: '业务任务', value: rows.length, hint: `当前 ${current} / 非当前 ${nonCurrent}`, filter: 'allTasks' },
        { label: '今天截止', value: todayDue, hint: '截止日期为今天', filter: 'todayDue' },
        { label: '临期任务', value: soonDue, hint: '逾期或 2 天内截止', filter: 'soonDue' },
        { label: '卡点任务', value: riskTasks, hint: '逾期、临期、暂停、未开始或需拆分', filter: 'riskTask' },
        { label: '急单', value: urgent, hint: '标题或需求明确标记急单/紧急/加急', filter: 'urgentTask' },
        { label: '插单', value: inserted, hint: '禅道优先级 P1 或插单关键词', filter: 'insertTask' },
        { label: '已关联执行', value: linkedRuns, hint: '存在 run 记录', filter: 'executed' },
        { label: '未执行', value: unexecuted, hint: '暂未创建执行记录', filter: 'unexecuted' },
        { label: 'XS 单', value: extraSmallTasks, hint: '人工 0.25 天 / AI 5-15 分钟（不包含人工审核）', filter: 'levelXS' },
        { label: 'S 单', value: smallTasks, hint: '人工 0.5 天 / AI 10-30 分钟（不包含人工审核）', filter: 'levelS' },
        { label: 'M 单', value: mediumTasks, hint: '人工 1-2 天 / AI 30-90 分钟（不包含人工审核）', filter: 'levelM' },
        { label: 'L 单', value: largeTasks, hint: '人工 3 天以上 / AI 1.5-4 小时（不包含人工审核）', filter: 'levelL' },
        { label: reviewedRows.length ? '人工质量均分' : '执行质量估分', value: qualityRows.length ? `${avgAiScore}%` : '-', hint: qualityHint, filter: 'quality' },
        { label: '美术待处理 Bug', value: webBugCount, hint: '同步禅道 Bug 总数', filter: 'webBug', mode: 'bug' },
        { label: '关联 Bug', value: totalRelatedBugs, hint: '按禅道任务号关联', filter: 'taskRelatedBug' },
        { label: '交付已验收', value: done, hint: '交付状态为已验收/已通过', filter: 'passed' },
        { label: '交付阻塞', value: blocked, hint: '交付状态需要处理', filter: 'blocked' }
      ];
    },

    taskPersonStats() {
      const bugCounts = new Map();
      this.taskCenterBugRows.forEach(bug => {
        const person = this.bugAssigneeName(bug);
        if (!this.isArtDeptPerson(person)) return;
        bugCounts.set(person, (bugCounts.get(person) || 0) + 1);
      });
      const today = localDateKey(new Date());
      const map = new Map();
      this.artDeptDisplayPeople.forEach(name => {
        map.set(name, { name, taskCount: 0, todayDueCount: 0, riskCount: 0, bugCount: 0, tasks: [] });
      });
      this.taskCenterCurrentArtMemberTaskRows.forEach(task => {
        const name = this.taskAssigneeDisplayName(task);
        if (!this.isArtDeptPerson(name)) return;
        const row = map.get(name) || { name, taskCount: 0, todayDueCount: 0, riskCount: 0, bugCount: 0, tasks: [] };
        row.taskCount += 1;
        row.tasks.push(task);
        if (task.deadline && task.deadline === today) row.todayDueCount += 1;
        if (this.isArtTaskRisk(task)) row.riskCount += 1;
        map.set(name, row);
      });
      bugCounts.forEach((count, name) => {
        if (!map.has(name)) return;
        const row = map.get(name) || { name, taskCount: 0, todayDueCount: 0, riskCount: 0, bugCount: 0, tasks: [] };
        row.bugCount = count;
        map.set(name, row);
      });
      return [...map.values()]
        .map(row => ({
          ...row,
          ...this.taskAcceptanceAssessmentForPerson(row.name, row.tasks || [], row.bugCount)
        }))
        .sort((a, b) => this.taskPersonCardSortRank(a) - this.taskPersonCardSortRank(b) || b.todayDueCount - a.todayDueCount || b.riskCount - a.riskCount || b.bugCount - a.bugCount || b.taskCount - a.taskCount || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    },

    artDeptDisplayPeople() {
      const map = new Map();
      [...DEFAULT_ART_DEPT_PEOPLE, ...this.artDepartmentUsers].forEach(user => {
        const name = user.realname || user.name || user.account || '';
        if (!name) return;
        const key = normalizePersonName(name);
        if (!key || map.has(key)) return;
        map.set(key, name);
      });
      return [...map.values()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    },

    defaultRunDeveloperName() {
      const currentNames = this.currentAccountPersonNames || [];
      const matched = currentNames
        .map(name => this.canonicalArtDeptPerson(name) || String(name || '').trim())
        .find(name => name && name !== 'admin' && name !== '当前账号');
      if (matched) return matched;
      return this.currentUser?.displayName || this.currentUser?.realname || this.currentUser?.name || this.currentUser?.username || this.currentUser?.account || '';
    },

    skillValidationPersonOptions() {
      const map = new Map();
      this.artDeptDisplayPeople.forEach(name => {
        if (name) map.set(normalizePersonName(name), name);
      });
      ART_PERSON_ALIASES.forEach(name => {
        if (name) map.set(normalizePersonName(name), name);
      });
      return [...map.values()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    },

    artDeptPersonNames() {
      return [...DEFAULT_ART_DEPT_PEOPLE, ...this.artDepartmentUsers]
        .flatMap(user => [user.realname, user.name, user.account])
        .filter(Boolean);
    },

    zentaoAutoSyncText() {
      const sync = this.appConfig.zentaoAutoSync || {};
      if (this.zentaoSyncRunning) return sync.trigger === 'manual' ? '同步中...' : '自动同步中...';
      if (sync.lastSuccessAt) return `自动同步：${formatDateTime(sync.lastSuccessAt)}`;
      if (sync.lastErrorAt) return `同步失败：${formatDateTime(sync.lastErrorAt)}`;
      return sync.enabled === false ? '自动同步已关闭' : '等待自动同步';
    },

    zentaoAutoSyncLabel() {
      const sync = this.appConfig.zentaoAutoSync || {};
      if (this.zentaoSyncRunning) return sync.trigger === 'manual' ? '正在同步' : '自动同步中';
      if (this.zentaoSyncLastError || sync.lastErrorAt) return '同步失败';
      return sync.enabled === false ? '自动同步已关闭' : '自动同步';
    },

    zentaoAutoSyncTimeText() {
      const sync = this.appConfig.zentaoAutoSync || {};
      if (this.zentaoSyncRunning) return '同步中...';
      if (sync.lastSuccessAt) return formatDateTime(sync.lastSuccessAt);
      if (sync.lastErrorAt) return formatDateTime(sync.lastErrorAt);
      return '-';
    },

    projectRows() {
      return this.projects.map(project => {
        const scan = this.scans[project.id];
        const scanError = scan?.error || '';
        const tasks = scan?.tasks || [];
        const skills = Array.isArray(scan?.skills) ? scan.skills : [];
        const sourceType = project.sourceType || inferRepositorySourceType(project, scan);
        const configOk = scan?.configs?.agentConfig?.exists && scan?.configs?.skillConfig?.exists;
        const skillCount = skills.length;
        const mdCount = skills.filter(skill => /\.md$/i.test(skill.path || skill.source || skill.id || '') || /md|markdown|规范|文档/i.test(`${skill.title || ''} ${skill.description || ''}`)).length;
        const evidenceCount = tasks.reduce((sum, task) => sum + (task.audit?.evidenceCount || 0), 0);
        const reportCount = tasks.reduce((sum, task) => sum + (task.audit?.reportCount || 0), 0);
        const completion = tasks.length
          ? Math.round(tasks.reduce((sum, task) => sum + (task.audit?.completion || 0), 0) / tasks.length)
          : 0;
        const sourceScanOnly = ['local', 'shared'].includes(String(sourceType || '').toLowerCase());
        const health = scanError
          ? '扫描失败'
          : !scan
            ? '待扫描'
            : sourceScanOnly
              ? '已扫描'
            : configOk && skillCount && tasks.length
              ? '已接入'
              : configOk && skillCount
                ? '无任务'
                : '待完善';
        const latestTask = tasks[0] || null;
        return {
          ...project,
          project,
          sourceType,
          sourceTypeLabel: repositorySourceTypeLabel(sourceType),
          gitRemoteUrl: project.git?.remoteUrl || project.gitRemoteUrl || '',
          framework: project.framework || scan?.detected?.framework || '未知',
          scan,
          scanError,
          scanned: Boolean(scan && !scanError),
          agentConfigOk: Boolean(scan?.configs?.agentConfig?.exists),
          skillConfigOk: Boolean(scan?.configs?.skillConfig?.exists),
          packageManagerOk: Boolean(scan?.detected?.packageManager && scan.detected.packageManager !== 'unknown'),
          configOk: Boolean(configOk),
          skillCount,
          mdCount,
          taskCount: tasks.length,
          evidenceCount,
          reportCount,
          completion,
          health,
          healthType: ['已接入', '已扫描'].includes(health) ? 'success' : health === '扫描失败' ? 'danger' : health === '待完善' ? 'warning' : 'info',
          latestTaskName: latestTask?.name || '暂无任务',
          latestTaskTime: latestTask?.updatedAt ? formatDateTime(latestTask.updatedAt) : '-',
          lastSyncedAtText: scan?.scannedAt ? formatDateTime(scan.scannedAt) : (scan ? '已扫描' : '待扫描'),
          createdAtText: project.createdAt ? formatDateTime(project.createdAt) : '-'
        };
      });
    },

    pagedProjectRows() {
      return paginate(this.projectRows, this.projectPage, this.projectPageSize);
    },

    skillInventoryRows() {
      const rows = this.projectRows.flatMap(projectRow => {
        const skills = Array.isArray(projectRow.scan?.skills) ? projectRow.scan.skills : [];
        return skills
          .filter(skill => this.isMemberArtReporterRow(skill) || !this.isFigmaUseConnectorArtifact(skill))
          .map(skill => this.buildSkillInventoryRow(projectRow, skill));
      });
      return this.dedupeSkillInventoryRows(rows).sort((a, b) => {
        const timeDiff = String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''));
        return timeDiff || a.title.localeCompare(b.title);
      });
    },

    skillInventoryValidationCandidateRows() {
      const rows = this.projectRows.flatMap(projectRow => {
        const skills = Array.isArray(projectRow.scan?.skills) ? projectRow.scan.skills : [];
        return skills
          .filter(skill => this.isMemberArtReporterRow(skill) || !this.isFigmaUseConnectorArtifact(skill))
          .map(skill => this.buildSkillInventoryValidationCandidateRow(projectRow, skill));
      });
      return this.dedupeSkillInventoryRows([
        ...rows,
        ...this.skillInventoryMemberProductRows()
      ]).filter(row => row.displayHidden !== true && row.hidden !== true && this.isVisibleSkillInventoryProductRow(row));
    },

    skillInventoryVisibleRows() {
      return this.skillInventoryRows
        .filter(row => row.displayHidden !== true)
        .filter(row => (row.hidden !== true || this.canOperateSkillInventoryManage) && this.isVisibleSkillInventoryProductRow(row));
    },

    canManageSkillSourceDisplay() {
      return this.canEditSkillInventorySource || this.isPlatformAdmin;
    },

    skillSourceDisplaySourceRows() {
      return this.projectRows
        .filter(project => ['local', 'shared'].includes(String(project.sourceType || '').toLowerCase()))
        .filter(project => Array.isArray(project.scan?.skills) && project.scan.skills.length);
    },

    skillSourceDisplayRows() {
      const keyword = String(this.skillSourceDisplayDialog.keyword || '').trim().toLowerCase();
      const rows = this.skillSourceDisplaySourceRows.flatMap(projectRow => {
        const skills = Array.isArray(projectRow.scan?.skills) ? projectRow.scan.skills : [];
        return skills
          .filter(skill => this.isMemberArtReporterRow(skill) || !this.isFigmaUseConnectorArtifact(skill))
          .map(skill => this.buildSkillInventoryRow(projectRow, skill));
      });
      return this.dedupeSkillSourceDisplayRows(rows)
        .filter(row => {
          if (!keyword) return true;
          const haystack = [
            row.productDisplayName,
            row.productFileName,
            row.title,
            row.projectName,
            row.relativePath,
            row.path,
            row.source
          ].join('\n').toLowerCase();
          return haystack.includes(keyword);
        })
        .sort((a, b) => String(a.projectName || '').localeCompare(String(b.projectName || ''), 'zh-Hans-CN') || String(a.productDisplayName || a.title || '').localeCompare(String(b.productDisplayName || b.title || ''), 'zh-Hans-CN'));
    },

    skillSourceDisplayAllVisible() {
      const rows = this.skillSourceDisplayRows;
      return rows.length > 0 && rows.every(row => row.displayHidden !== true);
    },

    skillSourceDisplayPartlyVisible() {
      const rows = this.skillSourceDisplayRows;
      if (!rows.length) return false;
      const visibleCount = rows.filter(row => row.displayHidden !== true).length;
      return visibleCount > 0 && visibleCount < rows.length;
    },

    skillInventoryDocumentRows() {
      return [];
    },

    skillInventoryAssetRows() {
      return this.skillInventoryVisibleRows;
    },

    skillInventorySourceOptions() {
      return [...new Set(this.skillInventoryRows.map(row => row.source).filter(Boolean))];
    },

    filteredSkillInventoryRows() {
      const keyword = String(this.skillInventoryKeyword || '').trim().toLowerCase();
      const kindFilter = String(this.skillInventoryKindFilter || '').trim();
      const rows = this.skillInventoryVisibleRows.filter(row => {
        if (this.skillInventoryMemberFilter && !this.skillInventoryRowDirectlyBelongsToMember(row, this.skillInventoryMemberFilter)) return false;
        if (kindFilter === 'skill' && !this.isSkillInventorySkillProduct(row)) return false;
        if (kindFilter === 'standard' && !this.isSkillInventoryStandardProduct(row)) return false;
        if (!keyword) return true;
        const haystack = [
          row.id,
          row.title,
          row.uploader,
          row.source,
          row.category,
          row.version,
          row.projectName,
          row.relativePath,
          row.skill?.productGroupPath,
          row.productFileName,
          row.productDisplayName,
          this.skillSceneText(row)
        ].join('\n').toLowerCase();
        return haystack.includes(keyword);
      });
      if (this.skillInventoryMemberFilter) {
        return [...rows].sort((a, b) => {
          const usageDiff = Number(b.usageCount || 0) - Number(a.usageCount || 0);
          if (usageDiff) return usageDiff;
          return String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')) || a.title.localeCompare(b.title);
        });
      }
      if (!this.skillInventoryPreferMine || this.skillInventoryMemberFilter) return rows;
      const mine = this.currentAccountPrimaryPersonName || '';
      return [...rows].sort((a, b) => {
        const aMine = this.skillInventoryRowBelongsToMember(a, mine) ? 1 : 0;
        const bMine = this.skillInventoryRowBelongsToMember(b, mine) ? 1 : 0;
        if (aMine !== bMine) return bMine - aMine;
        return String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')) || a.title.localeCompare(b.title);
      });
    },

    pagedSkillInventoryRows() {
      return paginate(this.filteredSkillInventoryRows, this.skillInventoryPage, this.skillInventoryPageSize);
    },


    aiAssetColumnOptions() {
      return [
        { key: 'rowNumber', label: '表格行' },
        { key: 'title', label: '产物名称' },
        { key: 'owner', label: '贡献人' },
        { key: 'usage', label: '调用次数' },
        { key: 'progressStatus', label: '进度状态' },
        { key: 'dailyNote', label: '每日进展' },
        { key: 'path', label: '产物目录 / 项目名' },
        { key: 'validation', label: '验证信息' },
        { key: 'publicStatus', label: '公用' },
        { key: 'skillPath', label: 'Skill 路径' },
        { key: 'fileLink', label: '文件链接' },
        { key: 'source', label: '来源' },
        { key: 'actions', label: '操作' }
      ];
    },

    aiAssetStatusOptions() {
      const values = this.aiAssetSheetRows
        .filter(row => this.aiAssetShowHidden || row.deleted !== true)
        .map(row => String(row.progressStatus || '').trim())
        .filter(Boolean);
      return [...new Set(values)];
    },

    filteredAiAssetRows() {
      const keyword = String(this.aiAssetKeyword || '').trim().toLowerCase();
      const status = String(this.aiAssetStatusFilter || '').trim();
      return this.aiAssetSheetRows.filter(row => {
        if (this.aiAssetShowHidden) {
          if (row.deleted !== true) return false;
        } else if (row.deleted === true) {
          return false;
        }
        if (status && String(row.progressStatus || '') !== status) return false;
        if (!keyword) return true;
        const haystack = [
          row.rowNumber,
          row.title,
          this.aiAssetDisplayFileName(row),
          row.suites,
          row.owner,
          this.displayPersonList(row.owner),
          row.progressStatus,
          row.dailyNote,
          row.finalPath,
          row.projectName,
          row.verifyStatus,
          row.availablePeople,
          row.publicStatus,
          row.skillPath,
          row.fileLink,
          row.source
        ].join('\n').toLowerCase();
        return haystack.includes(keyword);
      });
    },

    pagedAiAssetRows() {
      return paginate(this.filteredAiAssetRows, this.aiAssetPage, this.aiAssetPageSize);
    },


    filteredSkillUsageLogs() {
      const logs = Array.isArray(this.skillUsageDialog.logs) ? this.skillUsageDialog.logs : [];
      const start = this.skillUsageDialog.start ? new Date(this.skillUsageDialog.start).getTime() : 0;
      const end = this.skillUsageDialog.end ? new Date(this.skillUsageDialog.end).getTime() : 0;
      return logs.filter(item => {
        const time = item.time ? new Date(item.time).getTime() : 0;
        if (start && (!time || time < start)) return false;
        if (end && (!time || time > end)) return false;
        return true;
      });
    },

    pagedSkillUsageLogs() {
      const page = Number(this.skillUsageDialog.page || 1);
      const pageSize = Number(this.skillUsageDialog.pageSize || 10);
      return paginate(this.filteredSkillUsageLogs, page, pageSize);
    },

    skillInventoryMemberSummaries() {
      const members = Array.isArray(this.aiMembersSnapshot?.members) ? this.aiMembersSnapshot.members : [];
      const inventoryRows = this.skillInventoryAssetRows.filter(row => row.hidden !== true);
      return members.map(member => {
        const boardProductItems = this.visibleAiBoardMemberProductItems(member);
        const matchedRows = inventoryRows
          .filter(row => row.hidden !== true)
          .filter(row => this.isFinishedSkillInventoryRow(row))
          .filter(row => this.skillInventoryRowBelongsToMember(row, member.name, boardProductItems, []));
        const inventoryProductItems = matchedRows
          .map(row => this.skillInventoryRowProductName(row))
          .filter(Boolean);
        const memberProductItems = this.dedupeMemberProductItems([...boardProductItems, ...inventoryProductItems]);
        return {
          name: member.name,
          account: member.account,
          level: member.level,
          status: member.status,
          productSkillCount: memberProductItems.length,
          inventorySkillCount: matchedRows.length,
          aiAssetCount: 0,
          totalSkillCount: memberProductItems.length,
          purposes: memberProductItems,
          productNames: memberProductItems.join('、'),
          inventoryRows: matchedRows,
          aiAssetRows: []
        };
      });
    },

    skillOwnerCandidateMembers() {
      const candidates = [
        ...this.skillInventoryMemberSummaries.map(member => ({
          name: member.name,
          account: member.account
        })),
        { name: this.defaultSkillInventoryOwnerName(), account: 'zhangqw' },
        { name: this.currentAccountPrimaryPersonName, account: this.currentUser?.username || this.currentUser?.account || '' }
      ];
      const seen = [];
      return candidates
        .map(member => ({
          name: this.canonicalArtDeptPerson(member.name) || String(member.name || '').trim(),
          account: String(member.account || '').trim()
        }))
        .filter(member => member.name)
        .filter(member => {
          const duplicated = seen.some(item => samePerson(item.name, member.name) || samePerson(item.account, member.account));
          if (!duplicated) seen.push(member);
          return !duplicated;
        });
    },

    skillInventoryMemberOverview() {
      const rows = this.skillInventoryMemberSummaries;
      const ownerProducts = this.skillInventoryOwnerProductItems();
      const productNames = rows
        .flatMap(row => row.purposes || [])
        .concat(ownerProducts)
        .filter(Boolean)
        .join('、');
      return {
        memberCount: rows.length,
        productSkillCount: rows.reduce((sum, row) => sum + row.productSkillCount, 0) + ownerProducts.length,
        inventorySkillCount: this.skillInventoryAssetRows.length,
        aiAssetCount: this.aiAssetSheetRows.filter(row => row.deleted !== true).length,
        activeMemberCount: rows.filter(row => row.totalSkillCount > 0).length + (ownerProducts.length ? 1 : 0),
        productNames
      };
    },

    aiScoreMonthLabel() {
      return this.aiScoreMonthKey(new Date());
    },

    aiScoreMonthDisplay() {
      const [year, month] = this.aiScoreMonthLabel.split('-');
      return year && month ? `${year}年${month}月` : '本月';
    },

    aiMemberScoreRows() {
      if (Array.isArray(this.aiMemberScoreRowsSnapshot) && this.aiMemberScoreRowsSnapshot.length) {
        return this.aiMemberScoreRowsSnapshot;
      }
      return [];
    },

    aiMemberScoreOverview() {
      const rows = this.aiMemberScoreRows;
      const avg = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length) : 0;
      const active = rows.filter(row => row.monthUsageCount + row.monthRunCount + row.monthValidationCount > 0).length;
      const high = rows.filter(row => row.score >= 85).length;
      return [
        { label: '月均评分', value: avg, hint: `${rows.length || 0} 人` },
        { label: '当月活跃', value: active, hint: '有使用、验证或执行记录' },
        { label: '高分成员', value: high, hint: '85 分及以上' }
      ];
    },

    canViewAiMemberScore() {
      return this.can('aiMembers.score.view') || this.isPlatformAdmin;
    },

    canRefreshAiMemberScore() {
      return this.can('aiMembers.score.refresh') || this.isPlatformAdmin;
    },

    aiMemberScoreRuleText() {
      return '普通组员按产物价值 55、使用 30、执行 15 计算；盛威单线入口图按本人有效使用计算版本和价值。';
    },

    skillInventoryProductStats() {
      const products = this.skillInventoryUniqueProductsByName(this.skillInventoryRowsForProductStats || []);
      const skillRows = products.filter(row => this.isSkillInventorySkillProduct(row));
      const standardRows = products.filter(row => this.isSkillInventoryStandardProduct(row));
      return [
        { key: 'total', label: '产物总计', value: products.length },
        { key: 'skill', label: '技能总数', value: skillRows.length },
        { key: 'standard', label: '规范总数', value: standardRows.length }
      ];
    },

    skillInventoryRowsForProductStats() {
      const keyword = String(this.skillInventoryKeyword || '').trim().toLowerCase();
      return this.skillInventoryVisibleRows.filter(row => {
        if (row.hidden === true) return false;
        if (this.skillInventoryMemberFilter && !this.skillInventoryRowDirectlyBelongsToMember(row, this.skillInventoryMemberFilter)) return false;
        if (!keyword) return true;
        const haystack = [
          row.id,
          row.title,
          row.uploader,
          row.source,
          row.category,
          row.version,
          row.projectName,
          row.relativePath,
          row.skill?.productGroupPath,
          row.productFileName,
          row.productDisplayName,
          this.skillSceneText(row)
        ].join('\n').toLowerCase();
        return haystack.includes(keyword);
      });
    },

    skillInventoryUniqueProductsByName() {
      return (rows = []) => {
        const map = new Map();
        for (const row of Array.isArray(rows) ? rows : []) {
          const key = this.skillInventoryProductNameKey(row);
          if (!key) continue;
          const existing = map.get(key);
          if (!existing) {
            map.set(key, row);
            continue;
          }
          if (this.isSkillInventorySkillProduct(row) && !this.isSkillInventorySkillProduct(existing)) {
            map.set(key, row);
          }
        }
        return [...map.values()];
      };
    },

    dedupeSkillSourceDisplayRows() {
      return (rows = []) => {
        const map = new Map();
        for (const row of Array.isArray(rows) ? rows : []) {
          const key = [
            row.projectId || '',
            row.relativePath || row.path || row.skill?.git?.relativePath || row.skill?.path || '',
            row.productDisplayName || row.productFileName || row.title || row.id || ''
          ].map(value => String(value || '').trim().toLowerCase()).join('::');
          if (!key.replace(/:/g, '')) continue;
          if (!map.has(key)) map.set(key, row);
        }
        return [...map.values()];
      };
    },

    skillInventoryProductNameKey() {
      return (row = {}) => {
        const name = row.productDisplayName || row.productFileName || row.title || row.id || '';
        return this.normalizeValidationMatchText(name);
      };
    },

    skillInventoryTableRowKey() {
      return (row = {}) => {
        const key = [
          row.projectId || '',
          row.skillInventoryKind || row.skill?.inventoryKind || '',
          row.relativePath || row.skill?.git?.relativePath || row.path || '',
          row.productDisplayName || row.productFileName || row.title || row.id || '',
          row.hidden === true ? 'hidden' : 'visible'
        ]
          .map(value => String(value || '').trim())
          .join('::');
        return key || String(row.uid || row.id || row.title || '');
      };
    },

    skillInventoryRowProductName() {
      return (row = {}) => String(
        row.productDisplayName
        || row.productFileName
        || row.title
        || this.fileNameFromPath(row.relativePath || row.path || row.skill?.git?.relativePath || row.skill?.path || '')
        || row.id
        || ''
      ).trim();
    },

    isSkillInventorySkillProduct() {
      return (row = {}) => {
        if (row.skillInventoryKind === 'directory' || row.skill?.inventoryKind === 'directory') return false;
        if (row.skillInventoryKind === 'skill' || row.skill?.inventoryKind === 'skill') return true;
        const text = [row.skillInventoryKind, row.relativePath, row.path, row.productFileName, row.productDisplayName, row.title].join('\n');
        return /(^|\/)SKILL\.md$/i.test(text)
          || /(^|\/)skills?\//i.test(text);
      };
    },

    isSkillInventoryStandardProduct() {
      return (row = {}) => {
        if (row.skillInventoryKind === 'directory' || row.skill?.inventoryKind === 'directory') return false;
        if (this.isSkillInventorySkillProduct(row)) return false;
        const text = [row.relativePath, row.path, row.productFileName, row.productDisplayName, row.title, row.category, row.scenes?.join(' ')].join('\n');
        return row.skillInventoryKind === 'document'
          || row.skill?.inventoryKind === 'document'
          || /规范|规则|模板|说明|指南|标准|交付|命名|清单|流程|design|handoff|template|guide|standard/i.test(text);
      };
    },

    skillValidationMappedRows() {
      return this.skillValidationRows.map(row => {
        if (!this.isSkillValidationScopeRecord(row)) {
          return {
            ...row,
            matchedSkillCount: 0,
            matchedMemberSkills: [],
            matchedAiAssets: [],
            matchedInventoryTarget: '',
            validationScopeExcluded: row.forceDisplayInValidation !== true
          };
        }
        let matchedAiAssets = [];
        let matchedMemberSkills = [];
        try {
          matchedAiAssets = this.aiAssetRowsForValidation(row);
          matchedMemberSkills = this.skillRowsForValidation(row);
        } catch (error) {
          console.warn('验证回填映射失败，已保留记录展示', row?.id || row?.artifactName || row?.scope || '', error);
        }
        const mappedOwnerName = this.validationMappedOwnerName(row, matchedMemberSkills, matchedAiAssets);
        const selfValidation = this.isSelfSkillValidationRecord({
          ...row,
          matchedMemberSkills,
          matchedAiAssets,
          mappedOwnerName
        });
        return {
          ...row,
          matchedSkillCount: matchedMemberSkills.length || matchedAiAssets.length,
          matchedMemberSkills,
          matchedAiAssets,
          mappedOwnerName,
          matchedInventoryTarget: matchedMemberSkills.length ? 'members' : matchedAiAssets.length ? 'assets' : '',
          selfValidation,
          validationScopeExcluded: row.forceDisplayInValidation !== true && !(matchedMemberSkills.length || matchedAiAssets.length)
        };
      });
    },

    matchedSkillValidationRows() {
      const mappedById = new Map(this.skillValidationMappedRows.map(row => [row.id, row]));
      const rows = this.skillValidationRows
        .filter(row => this.isDisplayableSkillValidationRecord(mappedById.get(row.id) || row))
        .map(row => mappedById.get(row.id) || {
          ...row,
          matchedSkillCount: 0,
          matchedMemberSkills: [],
          matchedAiAssets: [],
          matchedInventoryTarget: ''
        });
      const countMap = this.skillValidationArtifactCountMap;
      return rows.map(row => ({
        ...row,
        validationArtifactCount: countMap.get(this.skillValidationArtifactCountKey(row)) || 1
      }));
    },

    unmatchedSkillValidationRows() {
      return this.skillValidationMappedRows
        .filter(row => row.validationScopeExcluded)
        .filter(row => !this.isDistributedConfigValidationRecord(row));
    },

    pagedSkillValidationMappedRows() {
      return paginate(this.matchedSkillValidationRows, this.skillValidationPage, this.skillValidationPageSize);
    },

    pagedUnmatchedSkillValidationRows() {
      return paginate(this.unmatchedSkillValidationRows, this.skillValidationDetailPage, this.skillValidationDetailPageSize);
    },

    skillValidationOverview() {
      const rows = this.skillValidationRows;
      return {
        total: rows.length,
        completed: rows.filter(row => row.deliverableReady || /可直接复用|部分可用|建议.*复用/.test(`${row.status || ''} ${row.reuseAdvice || ''}`)).length,
        deliverable: rows.filter(row => row.deliverableReady).length,
        walkthroughDone: rows.filter(row => row.walkthroughDone).length,
        pending: rows.filter(row => !row.deliverableReady).length
      };
    },

    skillValidationArtifactCountMap() {
      const map = new Map();
      for (const row of this.skillValidationMappedRows) {
        if (!this.isDisplayableSkillValidationRecord(row)) continue;
        if (!this.validationRecordValidatorMatchesSingleOwner(row)) continue;
        const key = this.skillValidationArtifactCountKey(row);
        if (!key) continue;
        map.set(key, (map.get(key) || 0) + 1);
      }
      return map;
    },

    skillValidationOwnerRows() {
      const map = new Map();
      for (const row of this.skillValidationRows) {
        const key = row.owner || row.walkthroughOwner || '未指定';
        const current = map.get(key) || { owner: key, total: 0, completed: 0, deliverable: 0, walkthroughDone: 0 };
        current.total += 1;
        if (row.deliverableReady || /可直接复用|部分可用|建议.*复用/.test(`${row.status || ''} ${row.reuseAdvice || ''}`)) current.completed += 1;
        if (row.deliverableReady) current.deliverable += 1;
        if (row.walkthroughDone) current.walkthroughDone += 1;
        map.set(key, current);
      }
      return [...map.values()].sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner));
    },

    artProgressMetricCards() {
      const events = this.researchArtProgressEvents;
      const todayKey = localDateKey(new Date());
      const today = events.filter(event => {
        const time = Date.parse(event.createdAt || '');
        return Number.isFinite(time) && localDateKey(new Date(time)) === todayKey;
      }).length;
      const blocked = events.filter(event => event.status === 'blocked' || event.eventType === 'task_blocked' || event.eventType === 'research_blocked').length;
      const failed = events.filter(event => event.status === 'failed' || event.eventType === 'task_failed').length;
      const completed = events.filter(event => event.status === 'completed' || event.eventType === 'task_completed' || event.eventType === 'research_finding' || event.eventType === 'research_summary' || event.eventType === 'research_artifact').length;
      return [
        { label: '今日同步', value: today, hint: `累计 ${events.length} 条` },
        { label: '研究中', value: Math.max(events.length - blocked - failed - completed, 0), hint: '研究过程和工具试用' },
        { label: '待补材料', value: blocked, hint: '需要补充样例或输入' },
        { label: '阶段结论', value: completed, hint: '发现、规则和总结' }
      ];
    },

    artProgressMemberRows() {
      const map = new Map();
      for (const event of this.researchArtProgressEvents.map(item => decorateArtProgressEventRecord(item))) {
        const label = event.displayMemberName || '-';
        const current = map.get(label) || { label, count: 0, blocked: 0, failed: 0, completed: 0, events: [] };
        current.count += 1;
        if (event.status === 'blocked' || event.eventType === 'task_blocked' || event.eventType === 'research_blocked') current.blocked += 1;
        if (event.status === 'failed' || event.eventType === 'task_failed') current.failed += 1;
        if (event.status === 'completed' || event.eventType === 'task_completed' || event.eventType === 'research_finding' || event.eventType === 'research_summary' || event.eventType === 'research_artifact') current.completed += 1;
        current.events.push(event);
        map.set(label, current);
      }
      return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 8);
    },

    artProgressSkillRows() {
      const map = new Map();
      for (const event of this.researchArtProgressEvents.map(item => decorateArtProgressEventRecord(item))) {
        const label = normalizeArtProgressTextRecord(event.displaySkillName || event.skillName || event.skillId || event.stage || '-');
        const current = map.get(label) || { label, count: 0, blocked: 0, failed: 0, completed: 0, events: [] };
        current.count += 1;
        if (event.status === 'blocked' || event.eventType === 'task_blocked' || event.eventType === 'research_blocked') current.blocked += 1;
        if (event.status === 'failed' || event.eventType === 'task_failed') current.failed += 1;
        if (event.status === 'completed' || event.eventType === 'task_completed' || event.eventType === 'research_finding' || event.eventType === 'research_summary' || event.eventType === 'research_artifact') current.completed += 1;
        current.events.push(event);
        map.set(label, current);
      }
      return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 8);
    },

    recentArtProgressEvents() {
      return this.pagedArtProgressEvents;
    },

    researchArtProgressEvents() {
      return this.artProgressEvents
        .filter(event => isResearchArtProgressEventRecord(event))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    },

    pagedArtProgressEvents() {
      return paginate(this.researchArtProgressEvents, this.artProgressPage, this.artProgressPageSize).map(event => decorateArtProgressEventRecord(event));
    },

    artProgressOperationEventRows() {
      return this.artProgressEvents
        .filter(event => isCodexOperationArtProgressEventRecord(event))
        .map(event => decorateArtProgressEventRecord({ ...event, logSource: 'art-progress-event' }));
    },

    artProgressLogEvents() {
      if (this.artProgressLogType === 'operation') {
        const operationLogs = this.artProgressOperationLogRows.map(log => decorateArtProgressOperationLogRecord(log));
        const existingEventIds = new Set(operationLogs.map(row => row.eventId || row.id).filter(Boolean));
        const operationEvents = this.artProgressOperationEventRows.filter(row => !existingEventIds.has(row.id));
        return [...operationLogs, ...operationEvents].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      }
      return this.artProgressLifecycleLogRows
        .map(event => decorateArtProgressEventRecord(event))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    },

    artProgressLogMemberOptions() {
      const names = this.artProgressLogEvents
        .map(row => row.displayMemberName || '')
        .filter(name => name && name !== '-');
      return [...new Set(names)].sort((a, b) => a.localeCompare(b));
    },

    filteredArtProgressLogEvents() {
      if (!this.artProgressLogMemberFilter) return this.artProgressLogEvents;
      return this.artProgressLogEvents.filter(row => row.displayMemberName === this.artProgressLogMemberFilter);
    },

    pagedArtProgressLogEvents() {
      return paginate(this.filteredArtProgressLogEvents, this.artProgressLogPage, this.artProgressLogPageSize);
    },

    artProgressLogTypeOptions() {
      const operationLogCount = this.artProgressOperationLogRows.length + this.artProgressOperationEventRows.length;
      return [
        this.canViewArtProgressOperationRecords ? { label: 'Codex 操作记录 ' + operationLogCount, value: 'operation' } : null,
        this.canViewArtProgressAccessLogs ? { label: '接入测试记录 ' + this.artProgressLifecycleLogRows.length, value: 'lifecycle' } : null
      ].filter(Boolean);
    },

    artProgressLifecycleEvents() {
      return this.artProgressEvents.filter(event => !isResearchArtProgressEventRecord(event));
    },

    canViewArtProgressOperationLog() {
      return this.canViewArtProgressOperationRecords || this.canViewArtProgressAccessLogs;
    },

    canViewArtProgressOperationRecords() {
      return this.can('api.skillAsset.create') || this.isPlatformAdmin;
    },

    canViewArtProgressAccessLogs() {
      return this.can('api.skillAsset.create') || this.isPlatformAdmin;
    },

    canManageArtProgress() {
      return this.can('api.skillAsset.create') || this.isPlatformAdmin;
    },

    canManageArtProgressLogs() {
      return this.can('api.skillAsset.void') || this.isPlatformAdmin;
    },

    displayedArtProgressLogSourceIds() {
      const ids = new Set();
      for (const event of this.artProgressEvents || []) {
        const metadata = event?.metadata && typeof event.metadata === 'object' ? event.metadata : {};
        const sourceIds = [
          metadata.sourceLogId,
          metadata.sourceOperationLogId,
          metadata.originalEventId,
          metadata.sourceRef
        ].map(value => String(value || '').trim()).filter(Boolean);
        sourceIds.forEach(id => ids.add(id));
      }
      return ids;
    },

    canViewSkillValidationLogs() {
      return this.can('api.skillAsset.create') || this.isPlatformAdmin;
    },

    canDeleteSkillValidationDetailLogs() {
      return this.can('api.skillAsset.void') || this.isPlatformAdmin;
    },

    canBackfillSkillValidationDetailLogs() {
      return this.can('api.skillAsset.create') || this.isPlatformAdmin;
    },

    canViewSkillUsageLogs() {
      return this.can('skill.usageLogs.view') || this.isPlatformAdmin;
    },

    canViewSkillInventoryDetail() {
      return this.can('menu.skillList') || this.isPlatformAdmin;
    },

    canManageSkillAssets() {
      return this.canAny([
        'skill.scan.refresh',
        'skill.source.connect',
        'skill.source.edit',
        'skill.source.delete',
        'skill.asset.create',
        'skill.asset.void',
        'skill.assetOwner.manage',
        'skill.version.manage',
        'skill.alias.manage'
      ]) || this.isPlatformAdmin;
    },

    canRefreshSkillInventoryScan() {
      return this.can('skill.scan.refresh') || this.isPlatformAdmin;
    },

    canConnectSkillInventorySource() {
      return this.can('skill.source.connect') || this.isPlatformAdmin;
    },

    canEditSkillInventorySource() {
      return this.can('skill.source.edit') || this.isPlatformAdmin;
    },

    canDeleteSkillInventorySource() {
      return this.can('skill.source.delete') || this.isPlatformAdmin;
    },

    canCreateSkillInventoryAsset() {
      return this.can('skill.asset.create') || this.isPlatformAdmin;
    },

    canVoidSkillInventoryAsset() {
      return this.can('skill.asset.void') || this.isPlatformAdmin;
    },

    canOperateSkillInventoryManage() {
      return this.canVoidSkillInventoryAsset && this.isOwnerWorkbenchAccount;
    },

    canManageSkillValidationOwner() {
      return this.can('skill.validationOwner.manage') || this.isOwnerWorkbenchAccount;
    },

    canManageSkillAssetOwner() {
      return this.can('skill.assetOwner.manage') || this.isOwnerWorkbenchAccount;
    },

    canOperateSkillInventoryOwner() {
      return this.canManageSkillAssetOwner && this.isOwnerWorkbenchAccount;
    },

    skillInventoryActionColumnWidth() {
      const visibleCount = [
        this.can('run.create'),
        true,
        this.canOperateSkillInventoryOwner,
        this.canOperateSkillInventoryManage
      ].filter(Boolean).length;
      return visibleCount > 2 ? 192 : 144;
    },

    artProgressRefreshHint() {
      return this.isPlatformAdmin
        ? '刷新同步：重新读取组员 Codex 已同步到工作台的研究沉淀、工具试用、产物沉淀和连接记录。不会主动扫描组员电脑。'
        : '刷新同步：重新读取已同步到工作台的研究沉淀、工具试用和产物沉淀。';
    },

    skillInventoryRefreshHint() {
      return this.isPlatformAdmin
        ? '刷新库存：重新扫描已接入的 Git、共享盘和本地路径，只在这里抓取新增和修改；默认页面展示上次库存缓存。'
        : '刷新库存：重新读取当前产物列表、版本和贡献人信息。';
    },

    taskProcessingNotePlaceholder() {
      return this.isPlatformAdmin ? '记录沟通、产出路径、待负责人确认的问题' : '记录沟通、产出路径、待确认的问题';
    },



    visibleArtProjectSheetFields() {
      const visibleKeys = ['file', 'devLink', 'viewLink', 'pcPreviewLink', 'wapPreviewLink'];
      return this.artProjectSheetFields.filter(field => visibleKeys.includes(field.key));
    },

    filteredArtProjectSheetRows() {
      const keyword = String(this.artProjectSheetKeyword || '').trim().toLowerCase();
      if (!keyword) return this.artProjectSheetRows;
      return this.artProjectSheetRows.filter(row => {
        const haystack = this.visibleArtProjectSheetFields
          .map(field => this.artProjectSheetFieldValue(row, field))
          .join('\n')
          .toLowerCase();
        return haystack.includes(keyword);
      });
    },

    pagedArtProjectSheetRows() {
      return paginate(this.filteredArtProjectSheetRows, this.artProjectSheetPage, this.artProjectSheetPageSize);
    },

    artProjectSheetOwnerCount() {
      return new Set(this.artProjectSheetRows.map(row => row.owner).filter(Boolean)).size;
    },

    artProjectSheetPreviewCount() {
      return this.artProjectSheetRows.filter(row => row.pcPreviewLink || row.wapPreviewLink).length;
    },

    projectTasks() {
      const tasks = this.selectedScan?.tasks;
      return Array.isArray(tasks) ? tasks : [];
    },

    pagedProjectTasks() {
      const rows = paginate(this.projectTasks, this.taskPage, this.taskPageSize);
      return rows.length || !this.projectTasks.length ? rows : paginate(this.projectTasks, 1, this.taskPageSize);
    },

    projectTaskDisplayPath(task = {}) {
      return task.path || '';
    },

    projectDescription() {
      if (!this.selectedProject) return '';
      const taskCount = this.projectTasks.length;
      const skillCount = this.selectedScan?.skills?.length || 0;
      const detectedFramework = this.selectedScan?.framework || this.selectedProject.framework || 'unknown';
      const frameworkText = detectedFramework === 'unknown' ? '资料类型待识别' : `识别为 ${detectedFramework}`;
      return `${this.selectedProject.name} 已接入美术工作台，当前${frameworkText}，已索引 ${taskCount} 个任务、${skillCount} 个 Skill 路由。这里用于沉淀需求资料、任务执行记录、复核结论和交付证据。`;
    },

    selectedProjectStats() {
      const row = this.projectRows.find(item => item.id === this.selectedProjectId);
      if (!row) return [];
      return [
        { label: 'Skill 路由数', value: row.skillCount },
        { label: '任务数', value: row.taskCount },
        { label: '报告数', value: row.reportCount },
        { label: '证据数', value: row.evidenceCount },
        { label: '平均闭环度', value: `${row.completion}%` },
        { label: '接入状态', value: row.health }
      ];
    },

    taskRows() {
      return this.projectRows.flatMap(projectRow => {
        const scan = this.scans[projectRow.id];
        return (scan?.tasks || []).map(task => ({
          ...task,
          projectId: projectRow.id,
          projectName: projectRow.name,
          completion: task.audit?.completion || 0,
          evidenceCount: task.audit?.evidenceCount || 0,
          reportCount: task.audit?.reportCount || 0,
          hasRuntimeEvidence: Boolean(task.audit?.hasRuntimeEvidence),
          hasDeliveryReport: Boolean(task.audit?.hasDeliveryReport),
          status: task.audit?.status || 'unknown'
        }));
      }).sort((a, b) => {
        const statusWeight = status => ({ blocked: 0, failed: 1, conditional: 2, unknown: 3, passed: 4 })[status] ?? 3;
        return statusWeight(a.status) - statusWeight(b.status) || a.completion - b.completion;
      });
    },

    workspaceMetrics() {
      if (!this.isPlatformAdmin) {
        const rows = this.taskCenterCurrentArtMemberTaskRows.filter(task => !this.isLowEffortArtAcceptanceTask(task));
        const riskRows = rows.filter(task => this.taskPriorityFlags(task).length > 0 || ['blocked', 'failed', 'rework'].includes(statusBucket(task.platformStatus)) || this.deadlineState(task.deadline) === 'overdue');
        const today = localDateKey(new Date());
        const todayDue = rows.filter(task => task.deadline === today).length;
        return [
          { label: '我的任务', value: rows.length, hint: `${todayDue} 个今天截止` },
          { label: '我的卡点', value: riskRows.length, hint: '逾期、临期、暂停或待补证' },
          { label: 'Skill', value: this.projectRows.reduce((sum, row) => sum + row.skillCount, 0), hint: '可查看产物资产' },
          { label: '我的执行', value: this.runs.filter(run => this.isCurrentAccountPerson(run.developer)).length, hint: '已创建执行记录' }
        ];
      }
      const rows = this.projectRows;
      const taskRows = this.taskRows;
      const scannedCount = rows.filter(row => row.scanned).length;
      const schedulableProjects = rows.filter(row => row.health === '已接入').length;
      const incompleteProjects = rows.filter(row => ['待完善', '扫描失败'].includes(row.health) || !row.packageManagerOk).length;
      const reportCount = rows.reduce((sum, row) => sum + row.reportCount, 0);
      const evidenceCount = rows.reduce((sum, row) => sum + row.evidenceCount, 0);
      const pendingTasks = taskRows.filter(task => task.status !== 'passed').length;
      const avgCompletion = taskRows.length
        ? Math.round(taskRows.reduce((sum, task) => sum + task.completion, 0) / taskRows.length)
        : 0;
      return [
        { label: '扫描来源', value: this.projects.length, hint: `${scannedCount} 个已扫描` },
        { label: '可调度来源', value: schedulableProjects, hint: '规则完整且有任务' },
        { label: '待补规则', value: incompleteProjects, hint: '缺配置、扫描失败或类型未知' },
        { label: '历史任务', value: taskRows.length, hint: `${pendingTasks} 个待复核/待补证` },
        { label: '交付报告', value: reportCount, hint: `${evidenceCount} 个截图/证据文件` },
        { label: '平均闭环度', value: `${avgCompletion}%`, hint: '按全部美术任务完成度计算' }
      ];
    },

    projectHealthSummary() {
      return this.projectHealthDistribution.reduce((summary, item) => {
        summary[item.key] = item.value;
        return summary;
      }, {});
    },

    projectHealthDistribution() {
      const rows = this.projectRows;
      return [
        { key: 'schedulable', label: '已接入', color: '#22c55e', value: rows.filter(row => row.health === '已接入').length },
        { key: 'pending', label: '待扫描', color: '#94a3b8', value: rows.filter(row => row.health === '待扫描').length },
        { key: 'incomplete', label: '待完善', color: '#f59e0b', value: rows.filter(row => row.health === '待完善').length },
        { key: 'empty', label: '无任务', color: '#38bdf8', value: rows.filter(row => row.health === '无任务').length },
        { key: 'failed', label: '扫描失败', color: '#ef4444', value: rows.filter(row => row.health === '扫描失败').length }
      ];
    },

    healthDonutGradient() {
      const total = Math.max(this.projectRows.length, 1);
      let cursor = 0;
      const segments = this.projectHealthDistribution
        .filter(item => item.value > 0)
        .map(item => {
          const start = cursor;
          cursor += (item.value / total) * 100;
          return `${item.color} ${start}% ${cursor}%`;
        });
      return `conic-gradient(${segments.length ? segments.join(', ') : '#e5e7eb 0% 100%'})`;
    },

    onboardingFunnel() {
      const rows = this.projectRows;
      const registered = rows.length;
      const base = Math.max(registered, 1);
      const items = [
        { label: '注册项目', value: registered },
        { label: '完成扫描', value: rows.filter(row => row.scanned).length },
        { label: 'AGENTS 存在', value: rows.filter(row => row.agentConfigOk).length },
        { label: '技能配置存在', value: rows.filter(row => row.skillConfigOk).length },
        { label: '有历史任务', value: rows.filter(row => row.taskCount > 0).length },
        { label: '有交付证据', value: rows.filter(row => row.evidenceCount > 0).length }
      ];
      return items.map(item => ({ ...item, percent: Math.round((item.value / base) * 100) }));
    },

    riskProjectRank() {
      return this.projectRows
        .map(row => {
          const tasks = this.scans[row.id]?.tasks || [];
          const blocked = tasks.filter(task => ['blocked', 'failed'].includes(statusBucket(task.audit?.status))).length;
          const conditional = tasks.filter(task => statusBucket(task.audit?.status) === 'conditional').length;
          const missingEvidence = tasks.filter(task => (task.audit?.evidenceCount || 0) === 0).length;
          const lowCompletion = row.taskCount > 0 ? Math.max(0, 80 - row.completion) : 20;
          const configPenalty = row.health === '扫描失败' ? 50 : row.health === '待完善' ? 30 : row.health === '待扫描' ? 20 : row.health === '无任务' ? 12 : 0;
          const riskScore = blocked * 25 + conditional * 12 + missingEvidence * 8 + lowCompletion + configPenalty;
          const reasons = [];
          if (row.health !== '已接入') reasons.push(row.health);
          if (blocked) reasons.push(`${blocked} 个阻塞`);
          if (conditional) reasons.push(`${conditional} 个待复核`);
          if (missingEvidence) reasons.push(`${missingEvidence} 个缺证据`);
          if (!reasons.length) reasons.push('暂无明显风险');
          return {
            ...row,
            riskScore,
            reason: reasons.slice(0, 2).join(' · '),
            tagType: riskScore >= 80 ? 'danger' : riskScore >= 35 ? 'warning' : 'success'
          };
        })
        .filter(row => row.riskScore > 0)
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 5);
    },

    projectWorkloadChart() {
      const maxTotal = Math.max(...this.projectRows.map(row => row.taskCount + row.reportCount + row.evidenceCount), 1);
      return this.projectRows
        .filter(row => row.taskCount || row.reportCount || row.evidenceCount)
        .sort((a, b) => (b.taskCount + b.reportCount + b.evidenceCount) - (a.taskCount + a.reportCount + a.evidenceCount))
        .slice(0, 8)
        .map(row => {
          const total = row.taskCount + row.reportCount + row.evidenceCount;
          return {
            id: row.id,
            name: row.name,
            tasks: row.taskCount,
            reports: row.reportCount,
            evidence: row.evidenceCount,
            total,
            taskPercent: total ? Math.max((row.taskCount / maxTotal) * 100, row.taskCount ? 3 : 0) : 0,
            reportPercent: total ? Math.max((row.reportCount / maxTotal) * 100, row.reportCount ? 3 : 0) : 0,
            evidencePercent: total ? Math.max((row.evidenceCount / maxTotal) * 100, row.evidenceCount ? 3 : 0) : 0
          };
        });
    },

    pendingTaskList() {
      return this.taskRows
        .filter(task => ['blocked', 'failed', 'conditional', 'unknown'].includes(statusBucket(task.status)) || task.evidenceCount === 0)
        .slice(0, 8);
    },

    scanSummary() {
      if (this.loading.scan) return '正在扫描资料库配置、Skill 和历史任务。';
      const scan = this.selectedScan;
      if (!scan) return '选择资料库后自动扫描配置、Skill 和历史任务。';
      const configOk = scan.configs?.agentConfig?.exists && scan.configs?.skillConfig?.exists;
      const hasSkills = (scan.skills || []).length > 0;
      const framework = scan.framework || 'unknown';
      const frameworkText = framework === 'unknown' ? '暂未识别技术栈' : `已识别技术栈 ${framework}`;
      return configOk && hasSkills
        ? `${frameworkText}，并识别到 ${scan.skills.length} 个 Skill、${scan.tasks.length} 个历史任务，资料库可进入工作台调度。`
        : `${frameworkText}。资料库可读取，但 Skill 协议不完整，将使用平台通用流程兜底。`;
    },

    healthLabel() {
      if (this.loading.scan) return '扫描中';
      if (!this.selectedScan) return '待扫描';
      return this.healthTagType === 'success' ? '健康' : '不完整';
    },

    healthTagType() {
      const scan = this.selectedScan;
      if (!scan) return this.loading.scan ? 'warning' : 'info';
      const ok = scan.configs?.agentConfig?.exists && scan.configs?.skillConfig?.exists && (scan.skills || []).length > 0;
      return ok ? 'success' : 'warning';
    },

    readiness() {
      const scan = this.selectedScan;
      if (!scan) {
        return [
          { label: '技术栈', value: this.loading.scan ? '...' : '待扫描', status: '待扫描', type: 'info' },
          { label: 'AGENTS 入口', value: this.loading.scan ? '...' : '待扫描', status: '待扫描', type: 'info' },
          { label: 'Skill 配置', value: this.loading.scan ? '...' : '待扫描', status: '待扫描', type: 'info' },
          { label: '资料类型', value: this.loading.scan ? '...' : '待扫描', status: '待扫描', type: 'info' }
        ];
      }
      return [
        {
          label: '技术栈',
          value: scan.framework && scan.framework !== 'unknown' ? scan.framework : '未识别',
          status: scan.framework && scan.framework !== 'unknown' ? '已识别' : '待补充',
          type: scan.framework && scan.framework !== 'unknown' ? 'success' : 'warning'
        },
        {
          label: 'AGENTS 入口',
          value: scan.configs?.agentConfig?.exists ? '已发现' : '缺失',
          status: scan.configs?.agentConfig?.exists ? '正常' : '缺失',
          type: scan.configs?.agentConfig?.exists ? 'success' : 'warning'
        },
        {
          label: 'Skill 配置',
          value: scan.configs?.skillConfig?.exists ? '已接入' : '未接入',
          status: scan.configs?.skillConfig?.exists ? '正常' : '待补',
          type: scan.configs?.skillConfig?.exists ? 'success' : 'warning'
        },
        {
          label: '资料类型',
          value: scan.detected?.packageManager || '未知',
          status: scan.detected?.packageManager === 'unknown' ? '待确认' : '正常',
          type: scan.detected?.packageManager === 'unknown' ? 'warning' : 'success'
        }
      ];
    },

    visibleSkills() {
      return (this.selectedScan?.skills || []).slice(0, 18);
    },

    selectedSkill() {
      return this.visibleSkills.find(skill => skill.id === this.selectedSkillId) || this.visibleSkills[0] || null;
    },

    selectedSkillContent() {
      if (!this.selectedSkill) return '';
      return this.selectedSkill.preview || this.skillContentCache[this.selectedSkill.id] || '';
    },

    skillPreviewHtml() {
      return this.skillPreview.html;
    },

    skillPreviewTitle() {
      return '内容预览';
    },

    skillPreviewEffectiveAliases() {
      if (typeof this.skillPreviewAliasesDraft === 'string' || Array.isArray(this.skillPreviewAliasesDraft)) {
        return this.normalizeSkillAliasList(this.skillPreviewAliasesDraft);
      }
      const saved = this.normalizeSkillAliasList(this.skillPreview.skill?.manualAliases || []);
      const generated = this.generateSkillAliases(this.skillPreview.skill || {});
      return this.normalizeSkillAliasList(saved.length ? saved : generated);
    },

    activeRunStage() {
      if (this.activeView !== 'runs') return 0;
      const stages = this.selectedRunDisplayStages;
      const running = stages.findIndex(stage => /running/.test(stage.displayStatus || stage.status || ''));
      if (running >= 0) return running + 1;
      const current = this.currentRunStageIndex(this.selectedRun);
      if (current >= 0) return current + 1;
      return stages.filter(stage => /done|success|passed|conditional|skipped|通过|有条件|跳过|✅|⏭️/.test(stage.displayStatus || stage.status || '')).length;
    },

    selectedRunDisplayStages() {
      if (this.activeView !== 'runs') return [];
      const run = this.selectedRun;
      const stages = this.displayRunStages(run);
      return stages.map((stage, index) => {
        const displayStatus = this.displayStageStatusFromDisplayStages(stages, stage, index, run);
        return {
          ...stage,
          displayStatus,
          stepStatus: this.stepStatus(displayStatus),
          stepLabel: this.stageStepLabel(displayStatus),
          stepClass: this.stageStepClass(displayStatus),
          isCurrent: this.isCurrentRunStageFromDisplayStages(stages, index, run),
          durationText: this.stageDurationText(stage, run, index)
        };
      });
    },

    selectedRunSkillActionRows() {
      if (this.activeView !== 'runs') return [];
      return this.runChainSkillActions(this.selectedRun);
    },

    selectedRunHighlightedSkillActions() {
      const byKey = new Map(this.selectedRunSkillActionRows.map(item => [item.key, item]));
      return ['sameipimage', 'uifinalize'].map(key => byKey.get(key) || {
        key,
        name: this.displayRunActionSkillName(key),
        type: this.runActionTypeLabel(key),
        count: 0,
        status: 'pending',
        people: [],
        lastAt: '',
        summary: this.defaultRunActionSummary(key),
        records: []
      });
    },

    selectedRunSkillActionTotal() {
      return this.selectedRunSkillActionRows.reduce((sum, item) => sum + item.count, 0);
    },

    selectedRunOtherSkillActionSummary() {
      const rows = this.selectedRunSkillActionRows.filter(item => !['sameipimage', 'uifinalize'].includes(item.key)).slice(0, 8);
      return {
        rows,
        count: rows.length,
        total: rows.reduce((sum, item) => sum + item.count, 0)
      };
    },

    selectedRunReferenceItems() {
      return this.runChainReferenceItems(this.selectedRun);
    },

    selectedRunReferenceCount() {
      return this.selectedRunReferenceItems.length;
    },

    audit() {
      return this.selectedTask?.audit || {};
    },

    selectedTaskLatestRun() {
      if (!this.selectedTask) return null;
      const zentaoId = String(this.selectedTask.zentaoId || '').trim();
      const latestRoot = this.normalizeArtifactPath(this.selectedTask.latestRunRoot || this.selectedTask.artifactRoot || '');
      return this.runs.find(run => {
        if (zentaoId && String(run.zentaoId || '') === zentaoId) return true;
        const artifactRoot = this.normalizeArtifactPath(run.artifactRoot || '');
        return artifactRoot && latestRoot && (artifactRoot.includes(latestRoot) || latestRoot.includes(artifactRoot));
      }) || null;
    },

    auditStages() {
      const runStages = (this.selectedTaskLatestRun?.stages || []).filter(stage => stage?.name);
      if (runStages.length) {
        return runStages.map((stage, index) => ({
          ...stage,
          no: stage.no || index + 1,
          output: stage.output || this.stageOutputForRunStage(stage)
        }));
      }
      return this.audit.stages || [];
    },

    auditReports() {
      return this.audit.reports || [];
    },

    orderedAuditReports() {
      return [...this.auditReports].sort(compareReportsByStage);
    },

    groupedAuditReports() {
      const groups = new Map();
      this.orderedAuditReports.forEach(report => {
        const meta = reportStageMeta(report);
        if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, items: [] });
        groups.get(meta.key).items.push(report);
      });
      return [...groups.values()];
    },

    auditImages() {
      return this.audit.images || [];
    },

    auditReview() {
      return this.audit.manualReview || [];
    },

    auditIssues() {
      return this.audit.issueRows || [];
    },

    selectedStage() {
      return this.auditStages.find(stage => String(stage.no) === String(this.selectedStageNo)) || this.auditStages[0] || null;
    },

    selectedStageReports() {
      return this.artifactsForStage(this.auditReports, this.selectedStage);
    },

    selectedStageImages() {
      return this.artifactsForStage(this.auditImages, this.selectedStage);
    },

    visibleAuditImages() {
      return [...this.auditImages].sort((a, b) => this.imageEvidencePriority(a) - this.imageEvidencePriority(b));
    },

    emptyImageEvidenceText() {
      return '暂无图片证据。';
    },

    groupedAuditImages() {
      const groups = [
        { key: 'comparison', label: '对比图', images: [] },
        { key: 'issue', label: '异常截图', images: [] },
        { key: 'compat', label: '兼容截图', images: [] },
        { key: 'key', label: '关键截图', images: [] },
        { key: 'raw', label: '原始截图', images: [] }
      ];
      const map = Object.fromEntries(groups.map(group => [group.key, group]));
      this.visibleAuditImages.forEach(image => {
        map[this.imageEvidenceGroupKey(image)].images.push(image);
      });
      return groups.filter(group => group.images.length);
    },

    imageReviewRecordList() {
      return Object.values(this.imageReviewRecords)
        .filter(record => this.auditImages.some(image => image.path === record.imagePath))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    selectedStageIssues() {
      return this.auditIssues.filter(issue => /P0|P1|P2/.test(issue.priority));
    },

    selectedStageReview() {
      return this.reviewForStage(this.auditReview, this.selectedStage, this.audit);
    },

    selectedReviewItem() {
      return this.selectedStageReview.find(item => item.key === this.selectedReviewKey) || this.selectedStageReview[0] || null;
    },

    taskManualReviewRecords() {
      if (!this.selectedTask) return [];
      return this.manualReviewRecords
        .filter(record => record.taskPath === this.selectedTask.path)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    currentReviewRecords() {
      if (!this.selectedReviewItem) return [];
      return this.taskManualReviewRecords.filter(record => record.reviewKey === this.selectedReviewItem.key);
    },

    selectedReviewPercent() {
      if (this.selectedReviewItem?.status === 'ready') return 100;
      const gateScore = Number(this.audit.gateScore || 0);
      const gateTotal = Number(this.audit.gateTotal || 0);
      if (gateTotal > 0) return Math.round((gateScore / gateTotal) * 100);
      return 50;
    },

    selectedReviewReason() {
      if (!this.selectedReviewItem) return '未选择复核项';
      if (this.selectedReviewItem.status === 'ready') return '复核材料已具备，建议人工确认关键结论。';
      return this.selectedReviewItem.detail || '证据链不足或结果存在不确定性，需要人工确认。';
    },

    selectedTaskLatestRun() {
      if (!this.selectedTask) return null;
      return this.runsForTask(this.selectedTask)[0] || null;
    },

    manualReviewOutcome() {
      const decision = this.manualReviewForm.decision;
      if (decision === 'approved') {
        return {
          title: '提交后：解除该复核项，任务进入人工已确认',
          description: '平台会写入人工验收记录，任务中心从待验收转为已验收，质量分会合并人工评分。'
        };
      }
      if (decision === 'rejected') {
        return {
          title: '提交后：任务进入返工',
          description: '平台会标记需要返工，任务中心显示返工状态，并把该结论作为下一轮执行或补证依据。'
        };
      }
      return {
        title: '提交后：有条件验收',
        description: '平台会记录风险接受，任务可继续交付，但开发库和任务中心会保留风险说明。'
      };
    },

    selectedStageSummary() {
      return this.summarizeStageAudit(
        this.selectedStage,
        this.selectedStageReports,
        this.selectedStageImages,
        this.selectedStageReview,
        this.selectedStageIssues,
        this.audit
      );
    },

    selectedStageGates() {
      return [
        { label: '阶段报告', ok: this.selectedStageReports.length > 0, value: `${this.selectedStageReports.length} 份` },
        { label: '图片证据', ok: this.selectedStageImages.length > 0 || !this.stageNeedsImageEvidence(this.selectedStage), value: `${this.selectedStageImages.length} 张` },
        { label: '运行证据', ok: this.audit.hasRuntimeEvidence, value: this.audit.hasRuntimeEvidence ? '已识别' : '待补' },
        { label: '最终交付', ok: this.audit.hasDeliveryReport, value: this.audit.hasDeliveryReport ? '已生成' : '待生成' }
      ];
    },

    selectedStageExecutionFacts() {
      const stage = this.selectedStage;
      const run = this.selectedTaskLatestRun;
      if (!stage || !run) return [];
      const index = this.auditStages.findIndex(item => String(item.no) === String(stage.no));
      return [
        { label: '执行开始', value: this.formatDateTime(stage.startedAt) },
        { label: '执行结束', value: this.formatDateTime(stage.finishedAt) },
        { label: '阶段耗时', value: Number(stage.durationMs) > 0 ? this.formatDuration(stage.durationMs) : this.stageDurationText(stage, run, index).replace(/^累计\s*/, '') }
      ];
    },

    taskMetrics() {
      const review = this.auditReview;
      const issues = this.auditIssues;
      return [
        { label: '阶段闭环', value: this.audit.stageCount || 0, hint: `${this.audit.statusCounts?.pass || 0} 通过 / ${this.audit.conditionalCount || 0} 条件` },
        { label: '报告可读', value: this.audit.reportCount || 0, hint: 'Markdown 产物' },
        { label: '图片证据', value: this.auditImages.length, hint: '截图 / 对比图' },
        { label: '待复核', value: review.filter(item => item.status !== 'ready').length + issues.length, hint: '人工审核入口' }
      ];
    }
  },

  watch: {
    theme(value) {
      this.applyTheme(value);
    },

    isSidebarCollapsed(value) {
      localStorage.setItem('awp-sidebar-collapsed', value ? '1' : '0');
    },

    selectedProjectId(value) {
      this.runForm.projectId = value || this.runForm.projectId;
      this.taskPage = 1;
      this.selectedSkillId = '';
      this.skillContentCache = {};
      this.syncDetailProjectTasks();
    },

    taskPageSize() {
      this.taskPage = 1;
      this.syncDetailProjectTasks();
    },

    taskPage() {
      this.syncDetailProjectTasks();
    },

    selectedRunId(value) {
      if (value) {
        if (this.runCodexFloatingRunId && this.runCodexFloatingRunId !== value) {
          this.runCodexFloatingRunId = '';
        }
        this.runChatPanelOpen = false;
        this.resetRunChatForm();
        this.runLogDrawerVisible = false;
        this.runLogCollapse = [];
        if (this.isRunInProgress(this.selectedRun)) this.loadSelectedRunLog();
        else this.logText = '原始执行日志默认收起，展开后读取尾部摘要。';
      } else {
        this.runCodexFloatingRunId = '';
        this.runChatPanelOpen = false;
        this.runLogDrawerVisible = false;
        this.runLogCollapse = [];
        this.logText = '选择一个任务后查看执行日志。';
        this.selectedArtifact = null;
        this.artifactPreview = {};
      }
    },

    'taskFilters.projectId'() {
      this.businessTaskPage = 1;
    },

    'taskFilters.zentaoStatus'() {
      this.businessTaskPage = 1;
    },

    'taskFilters.platformStatus'() {
      this.businessTaskPage = 1;
    },

    'taskFilters.metric'() {
      this.businessTaskPage = 1;
    },

    'taskFilters.keyword'() {
      this.businessTaskPage = 1;
    },

    'archiveFilters.projectId'() {
      this.aiArchivePage = 1;
      this.aiArtifactPage = 1;
      this.refreshAiFlowRecords();
    },

    'archiveFilters.qualityStatus'() {
      this.aiArchivePage = 1;
      this.aiArtifactPage = 1;
    },

    'archiveFilters.keyword'() {
      this.aiArchivePage = 1;
      this.aiArtifactPage = 1;
    },

    aiExecutionArchiveFilters: {
      deep: true,
      handler() {
        this.aiExecutionArchivePage = 1;
      }
    },

    selectedBusinessTaskId() {
      this.seedTaskReviewForm();
    },

    runLogCollapse(value) {
      if (Array.isArray(value) && value.includes('raw-log') && this.selectedRun?.id) {
        if (!this.logText || /默认收起|选择一个任务后查看执行日志/.test(this.logText)) {
          this.loadSelectedRunLog().catch(() => {});
        }
      }
    },

    artProjectSheetKeyword() {
      this.artProjectSheetPage = 1;
    },

    skillInventoryKeyword() {
      this.skillInventoryPage = 1;
    },

    skillInventorySource() {
      this.skillInventoryPage = 1;
    },

    skillInventoryMemberFilter() {
      this.skillInventoryPage = 1;
    },

    skillInventoryKindFilter() {
      this.skillInventoryPage = 1;
    },

    taskCenterMode() {
      this.businessTaskPage = 1;
      this.taskFilters = {
        ...this.taskFilters,
        zentaoStatus: '',
        platformStatus: '',
        keyword: ''
      };
      if (!this.preservePersonFilterOnModeSwitch) {
        this.personStatFilter = { person: '', type: '' };
      }
      if (this.taskCenterMode === 'task') {
        this.selectedBugId = '';
      } else if (this.taskCenterMode === 'bug') {
        this.selectedBusinessTaskId = '';
      } else {
        this.selectedBusinessTaskId = '';
        this.selectedBugId = '';
      }
      if (!this.preserveMetricOnModeSwitch && this.taskFilters.metric && this.taskMetricMode(this.taskFilters.metric) !== this.taskCenterMode) {
        this.taskFilters = { ...this.taskFilters, metric: '' };
      }
      this.bumpTaskCenterRevision();
    },

    'runForm.taskId'(value) {
      const task = this.businessTasks.find(item => item.id === value);
      if (!task) return;
      const project = this.projects.find(item => item.id === task.projectId);
      const workloadLevel = inferTaskWorkloadLevel(task, project)?.level || 'M';
      this.runForm.projectId = task.projectId;
      this.runForm.title = task.title || this.runForm.title;
      this.runForm.zentaoId = task.taskNo || this.runForm.zentaoId;
      this.runForm.developer = task.developer || this.runForm.developer;
      this.runForm.requirement = executionInstructionForTask(task) || this.runForm.requirement;
      if (!this.isBugFixRun && this.runForm.executionMode === 'level-process') {
        this.runForm.workflowLevel = workloadLevel;
        this.runForm.workflow = workflowForLevel(workloadLevel);
      }
    },

    'runForm.sourceMode'(value) {
      if (value === 'figma-link') {
        this.runForm.taskId = '';
        if (!this.runForm.title) this.runForm.title = 'Figma 界面执行';
      }
      if (value === 'standalone') {
        this.runForm.taskId = '';
        this.runForm.zentaoId = '';
        if (!this.runForm.title) this.runForm.title = '独立执行实验';
      }
      if (value === 'completed-task') {
        this.runForm.taskId = '';
        if (!this.runForm.title) this.runForm.title = '基于已完成任务继续处理';
      }
    },

    'runForm.selectedMaterialHints'(value) {
      const hints = Array.isArray(value) ? value : [];
      const manual = String(this.runForm.showdocHints || '')
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(item => item && !this.currentProjectExecutionMaterialOptions.some(option => option.value === item));
      this.runForm.showdocHints = [...manual, ...hints].filter(Boolean).join('\n');
    },

    'runForm.workflowLevel'(value) {
      if (!this.isBugFixRun) this.runForm.workflow = workflowForLevel(value);
    },

    'runForm.executionMode'(value) {
      if (this.isBugFixRun) return;
      this.runForm.workflow = value === 'single-skill'
        ? 'art-single-skill'
        : value === 'custom-workflow'
          ? 'custom-workflow'
          : workflowForLevel(this.runForm.workflowLevel);
    },

    'runForm.projectId'(value) {
      if (value && !this.scans[value]) this.loadProjectScanCacheForInventory().catch(() => {});
      if (this.runForm.customWorkflowId && !this.runnableCustomWorkflows.some(workflow => workflow.id === this.runForm.customWorkflowId)) {
        this.runForm.customWorkflowId = '';
      }
    },

    selectedSkill(skill) {
      if (skill && !this.selectedSkillContent) this.loadSkillContent(skill);
    },

    activeView(value) {
      document.title = `${this.pageMeta.title} · 美术部工作台`;
      if (value === 'ai-members') this.prepareAiMembersView();
      else this.cancelAiMembersDeferredWork();
      this.ensureActiveViewData(value);
      if (value === 'tasks') {
        this.stopZentaoAutoSyncPolling();
      }
    },

    skillInventoryTab(value) {
      if (this.isSkillInventoryViewActive) this.ensureSkillInventoryTabData(value || 'assets');
    },

  },

  created() {
    this.appBridge = this;
  },

  mounted() {
    this.theme = localStorage.getItem('awp-theme') || 'light';
    this.clearDeprecatedWorkbenchDisplayCache();
    this.applyRememberedWorkbenchPageSize();
    this.restoreWorkbenchDisplayCache();
    this.isSidebarCollapsed = localStorage.getItem('awp-sidebar-collapsed') === '1';
    this.taskProcessingNotes = this.loadTaskProcessingNotes();
    this.taskArtBriefs = this.loadTaskArtBriefs();
    this.applyTheme(this.theme);
    window.addEventListener('popstate', this.syncRoute);
    this.bootstrapAuth();
    this.runDurationTimer = setInterval(() => {
      if (this.isRunInProgress(this.selectedRun)) this.nowTick = Date.now();
    }, 1000);
  },

  beforeUnmount() {
    if (this.zentaoSyncTimer) clearTimeout(this.zentaoSyncTimer);
    if (this.aiMembersBoardFrameReadyTimer) clearTimeout(this.aiMembersBoardFrameReadyTimer);
    this.stopZentaoAutoSyncPolling();
    this.stopTaskBriefRealtimeSync();
    this.stopPlatformEventSync();
    if (this.runDurationTimer) clearInterval(this.runDurationTimer);
    window.removeEventListener('popstate', this.syncRoute);
  },

  methods: {
    selectSkillInventoryKindFilter(key = '') {
      const next = key === 'skill' || key === 'standard' ? key : '';
      this.skillInventoryKindFilter = this.skillInventoryKindFilter === next ? '' : next;
      this.skillInventoryPage = 1;
    },

    isSkillInventoryProductStatActive(key = '') {
      if (key === 'total') return !this.skillInventoryKindFilter;
      return this.skillInventoryKindFilter === key;
    },

    safeValidationText(value = '') {
      if (Array.isArray(value)) return value.map(item => this.safeValidationText(item)).filter(Boolean).join(' ');
      if (value && typeof value === 'object') {
        return String(value.label || value.name || value.title || value.value || value.text || value.url || value.href || '').trim();
      }
      return String(value ?? '').trim();
    },

    isSkillValidationScopeRecord(row = {}) {
      if (this.isFigmaUseConnectorRecord(row)) return false;
      if (this.isDistributedConfigValidationRecord(row)) return false;
      const text = [
        row.researchName,
        row.artifactName,
        row.artifactLocation,
        row.workflowScene,
        row.validationResult,
        row.reuseAdvice,
        row.notes,
        row.scope
      ].map(value => this.safeValidationText(value)).join('\n');
      if (this.isSkillCreationDraftValidationText(text)) return false;
      return true;
    },

    isDistributedConfigValidationText(text = '') {
      const normalized = String(text || '').replace(/\s+/g, '');
      if (!normalized) return false;
      return /(?:Codex|CodeX)?(?:全局|生图|本地)?前置(?:设置|配置)(?:\(\d+\))?(?:\.md)?/i.test(normalized)
        || /(?:Codex|CodeX)生图本地前置配置通用指南/i.test(normalized)
        || /(?:Codex|CodeX)?(?:全局|生图|本地)?前置(?:设置|配置).{0,24}(?:配置文件|配置文档|分发|安装|设置)/i.test(normalized);
    },

    isDistributedConfigValidationRecord(row = {}) {
      const text = [
        row.researchName,
        row.artifactName,
        row.artifactLocation,
        row.workflowScene,
        row.validationResult,
        row.reuseAdvice,
        row.notes,
        row.scope,
        row.sourceRef
      ].map(value => this.safeValidationText(value)).join('\n');
      return this.isDistributedConfigValidationText(text);
    },

    filterVisibleSkillValidationRecords(records = []) {
      return Array.isArray(records)
        ? records.filter(row => !this.isDistributedConfigValidationRecord(row))
        : [];
    },

    isSelfSkillValidationRecord(row = {}) {
      const validator = this.validationDisplayValidatorName(row);
      const mappedOwner = row.mappedOwnerName || this.validationDisplayOwnerName(row, row.matchedMemberSkills, row.matchedAiAssets);
      const owners = this.personList(mappedOwner || row.owner || row.walkthroughOwner)
        .filter(owner => owner && owner !== '待确认');
      if (!validator || !owners.length) return false;
      return owners.some(owner => samePerson(validator, owner));
    },

    isAutoSkillValidationRecord(row = {}) {
      const text = [
        row.id,
        row.source,
        row.originalSource,
        row.sourceRef,
        row.notes,
        row.updatedBy
      ].map(value => this.safeValidationText(value)).join('\n');
      return /skill-validation-from-art-progress|Codex|自动|上报|art-progress|research/i.test(text);
    },

    isDisplayableSkillValidationRecord(row = {}) {
      if (!this.isSkillValidationScopeRecord(row)) return false;
      if (row.forceDisplayInValidation === true) return true;
      if (this.isLooseSkillValidationRecord(row)) return false;
      const hasMatch = Number(row.matchedSkillCount || 0) > 0
        || (Array.isArray(row.matchedMemberSkills) && row.matchedMemberSkills.length > 0)
        || (Array.isArray(row.matchedAiAssets) && row.matchedAiAssets.length > 0);
      return hasMatch;
    },

    skillValidationBackfillKey(row = {}) {
      return [
        row.id,
        this.validationDisplayArtifactName(row) || row.artifactName || row.scope || row.researchName,
        this.validationDisplayValidatorName(row) || row.validator || row.walkthroughOwner,
        row.submittedAt || row.createdAt || ''
      ].map(value => String(value || '').trim()).join('|');
    },

    isSkillValidationDetailBackfilled(row = {}) {
      if (row.forceDisplayInValidation === true || row.manualBackfill === true) return true;
      const targetId = String(row.id || '').trim();
      const targetKey = this.skillValidationBackfillKey(row);
      return (this.skillValidationRows || []).some(record => {
        if (record === row) return false;
        if (record.forceDisplayInValidation !== true && record.manualBackfill !== true) return false;
        const recordRefs = [
          record.id,
          record.sourceRef,
          record.originalSourceId,
          record.originalSource
        ].map(value => String(value || '').trim()).filter(Boolean);
        if (targetId && recordRefs.some(value => value === targetId || value === `skill-validation-backfill-${targetId}`)) return true;
        return this.skillValidationBackfillKey(record) === targetKey;
      });
    },

    isLooseSkillValidationRecord(row = {}) {
      const primaryText = [
        row.artifactName,
        row.scope,
        row.artifactLocation
      ].map(value => this.safeValidationText(value)).join('\n');
      const primaryKey = this.normalizeValidationMatchText(primaryText);
      if (/^\s*#?\s*(AGENTS|README|CODEX_RULES|CLAUDE|memory)\.md\s*$/i.test(String(row.artifactName || '').trim())) return true;
      if (/^(agents|readme|codexrules|claude|memory|codexfigma|figmamcp|mcpfigma|figma|codex|文件本体)$/i.test(primaryKey)) return true;
      const text = [
        row.artifactName,
        row.researchName,
        row.artifactLocation,
        row.scope
      ].map(value => this.safeValidationText(value)).join('\n');
      const normalized = this.normalizeValidationMatchText(text);
      if (!normalized) return true;
      const hasExplicitFile = this.validationExplicitFileKeysFromRecord(row).length > 0;
      const hasAssetSignal = (Array.isArray(row.matchedMemberSkills) && row.matchedMemberSkills.length > 0)
        || (Array.isArray(row.matchedAiAssets) && row.matchedAiAssets.length > 0);
      if (/agents|readme|codexrules|claude|memory|environmentcontext/i.test(text) && !hasAssetSignal) return true;
      if (/^(codexfigma|figmamcp|mcpfigma|figma|codex|skill|skills|md|markdown|文件本体)$/i.test(normalized) && !hasAssetSignal) return true;
      if (!hasExplicitFile && !hasAssetSignal && this.isGenericValidationMatchName(normalized)) return true;
      return false;
    },

    skillValidationArtifactCountKey(row = {}) {
      const ownerKey = this.normalizeValidationOwnerCountKey(row);
      const canonicalProductKey = this.validationCanonicalProductCountKey(row);
      if (canonicalProductKey) return `${canonicalProductKey}::${ownerKey || 'unknown'}`;
      const firstMember = Array.isArray(row.matchedMemberSkills) ? row.matchedMemberSkills[0] : null;
      const firstAsset = Array.isArray(row.matchedAiAssets) ? row.matchedAiAssets[0] : null;
      const values = firstMember
        ? [
            firstMember.productDisplayName,
            firstMember.productFileName,
            firstMember.title,
            firstMember.relativePath,
            firstMember.path,
            firstMember.skill?.git?.relativePath
          ]
        : firstAsset
          ? [
              this.aiAssetDisplayFileName(firstAsset),
              firstAsset.title,
              firstAsset.finalPath,
              firstAsset.skillPath,
              firstAsset.fileLink,
              firstAsset.projectName
            ]
          : [
              row.artifactName,
              row.researchName,
              row.scope,
              row.artifactLocation,
              row.sourceRef
            ];
      const candidates = values
        .flatMap(value => [value, this.fileNameFromPath(value), ...this.validationConcreteNamesFromPath(value)])
        .map(value => this.normalizeValidationMatchText(value))
        .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value));
      const productKey = candidates[0] || this.normalizeValidationMatchText(row.id || '');
      return productKey ? `${productKey}::${ownerKey || 'unknown'}` : '';
    },

    normalizeValidationOwnerCountKey(row = {}) {
      const productOwners = this.validationOwnerListFromMemberProducts(row);
      const owner = productOwners.length
        ? productOwners.join('、')
        : row.mappedOwnerName
          || this.validationOwnerListFromMemberRows(row.matchedMemberSkills).join('、')
          || this.validationOwnerListFromAiRows(row.matchedAiAssets).join('、')
          || row.owner
          || row.uploader
          || row.walkthroughOwner
          || row.flowOwner
          || '';
      const people = this.personList(owner)
        .map(person => this.canonicalArtDeptPerson(person) || person)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
      return people.join('|') || this.normalizeValidationMatchText(owner);
    },

    validationCanonicalProductCountKey(row = {}) {
      const matches = this.validationBestProductOwnerEntryMatches(row);
      const productName = matches[0]?.productName || '';
      const productKey = this.normalizeValidationMatchText(productName);
      return productKey && productKey.length >= 4 && !this.isGenericValidationMatchName(productKey) ? productKey : '';
    },

    isSkillCreationDraftValidationText(text = '') {
      const normalized = this.safeValidationText(text);
      const asksToCreateSkill = /(帮我|给我|写|生成|创建|新增|整理|提炼).{0,40}(一条)?\s*skill\.md/i.test(normalized)
        || /(写成|做成|生成|创建|新增|整理成|提炼成).{0,60}(SKILL\.md|skill\s*说明|独立技能|技能说明)/i.test(normalized)
        || /(触发语覆盖|frontmatter|技能规范|技能发现规则|可发现的英文副本|无需调用插件也能按同样规范)/i.test(normalized);
      const appliesExistingArtifact = /(用|使用|基于|按照).{0,80}(已有|现有|清单|资源|规范|文档|沉淀).{0,160}(验证|验收|实任务|重命名|处理|检查|修改|应用)/i.test(normalized);
      return asksToCreateSkill && !appliesExistingArtifact;
    },

    skillSceneText(row = {}, fallback = '') {
      const scenes = Array.isArray(row.scenes)
        ? row.scenes
        : String(row.scenes || '').split(/；|;|\n/);
      const text = scenes
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .join('；');
      return text || row.skill?.description || fallback;
    },

    ensureSkillInventoryTabData(tab = 'assets') {
      if (tab === 'validations') {
        this.restoreWorkbenchDisplayCacheKey('skillValidationRows');
        return;
      }
      if (tab === 'events') {
        this.restoreWorkbenchDisplayCacheKey('artProgressEvents');
        this.restoreWorkbenchDisplayCacheKey('aiAssetSheetRows');
        this.restoreWorkbenchDisplayCacheKey('usageCounters');
        return;
      }
      if (['assets', 'list'].includes(tab)) {
        this.restoreWorkbenchDisplayCacheKey('projects');
        this.restoreWorkbenchDisplayCacheKey('scans');
        this.restoreWorkbenchDisplayCacheKey('aiAssetSheetRows');
        this.restoreWorkbenchDisplayCacheKey('usageCounters');
        if (!this.loading.skillInventoryCache) {
          this.loadSkillInventorySavedSnapshot({ force: !this.skillInventoryRows.length }).catch(() => {});
        }
        if (this.skillInventoryRows.length) {
          this.skillInventoryScanCacheLoaded = true;
        }
      }
    },

    ensureActiveViewData(view = this.activeView) {
      if (view === 'tasks') {
        if (!this.loading.tasks) this.refreshTasks().catch(() => {});
        if (!this.loading.config) this.refreshConfig().catch(() => {});
      }
      if (['skill-inventory', 'skill-assets'].includes(view)) {
        if (view === 'skill-assets' || view === 'skill-inventory') this.skillInventoryTab = 'assets';
        this.ensureSkillInventoryTabData(this.skillInventoryTab || 'assets');
      }
      if (view === 'ai-members') {
        this.ensureAiMemberScoreData();
        this.restoreAiMembersBoardHtmlSnapshot();
        if (!this.loading.aiMembers && !this.hasAiMembersBoardHtml(this.aiMembersSnapshot)) {
          this.refreshAiMembers().catch(() => {});
        }
      }
      if (view === 'codex-config') {
        if (!this.loading.codexConfig) this.loadCodexConfig().catch(() => {});
      }
      if (view === 'user-access') {
        if (!this.users.length && !this.loading.users) this.refreshUsers().catch(() => {});
        if (!this.roles.length && !this.loading.roles) this.refreshRoles().catch(() => {});
      }
      if (view === 'role-management') {
        if ((!this.roles.length || !this.permissionCatalog.length) && !this.loading.roles) this.refreshRoles().catch(() => {});
      }
      if (view === 'runs') {
        this.restoreWorkbenchDisplayCacheKey('artProgressEvents');
        if (!this.loading.runs) this.refreshRuns().catch(() => {});
        if (!this.agentWorkers.length && !this.loading.agentWorkers) this.refreshAgentWorkers().catch(() => {});
        if ((this.can('api.users.manage') || this.can('api.agentWorkers.read')) && !this.users.length && !this.loading.users) this.refreshUsers().catch(() => {});
      }
      if (view === 'agent-workers') {
        if (!this.loading.runs) this.refreshRuns().catch(() => {});
        if (!this.agentWorkers.length && !this.loading.agentWorkers) this.refreshAgentWorkers().catch(() => {});
        if ((this.can('api.users.manage') || this.can('api.agentWorkers.read')) && !this.users.length && !this.loading.users) this.refreshUsers().catch(() => {});
      }
      if (view === 'ai-archive') {
        if (!this.loading.runs) this.refreshRuns().catch(() => {});
        if ((this.can('api.users.manage') || this.can('api.agentWorkers.read')) && !this.users.length && !this.loading.users) this.refreshUsers().catch(() => {});
      }
      if (view === 'operation-logs') {
        if (!this.users.length && !this.loading.users) this.refreshUsers().catch(() => {});
        if (!this.operationLogs.length && !this.loading.operationLogs) this.refreshOperationLogs().catch(() => {});
      }
    },

    workbenchPageSizeKeys() {
      return [
        'projectPageSize',
        'artProjectSheetPageSize',
        'skillInventoryPageSize',
        'skillValidationPageSize',
        'skillValidationDetailPageSize',
        'aiAssetPageSize',
        'artProgressPageSize',
        'artProgressLogPageSize',
        'skillUsagePageSize',
        'taskPageSize',
        'operationLogPageSize',
        'businessTaskPageSize',
        'aiArchivePageSize',
        'aiArtifactPageSize'
      ];
    },

    normalizedWorkbenchPageSize(size) {
      const value = Number(size || 10);
      return [10, 50, 100].includes(value) ? value : 10;
    },

    applyRememberedWorkbenchPageSize() {
      const size = this.normalizedWorkbenchPageSize(localStorage.getItem('awp-workbench-page-size'));
      this.workbenchPageSizeKeys().forEach(key => {
        this[key] = size;
      });
    },

    setWorkbenchPageSize(size, pageKey = '') {
      const nextSize = this.normalizedWorkbenchPageSize(size);
      localStorage.setItem('awp-workbench-page-size', String(nextSize));
      this.workbenchPageSizeKeys().forEach(key => {
        this[key] = nextSize;
      });
      const pageKeys = [
        'projectPage',
        'artProjectSheetPage',
        'skillInventoryPage',
        'skillValidationPage',
        'skillValidationDetailPage',
        'aiAssetPage',
        'artProgressPage',
        'artProgressLogPage',
        'skillUsagePage',
        'taskPage',
        'operationLogPage',
        'businessTaskPage',
        'aiArchivePage',
        'aiArtifactPage'
      ];
      pageKeys.forEach(key => { this[key] = 1; });
      if (pageKey) this[pageKey] = 1;
      if (pageKey === 'operationLogPage' || this.activeView === 'operation-logs') this.refreshOperationLogs();
    },

    isArtDeptPerson(name = '') {
      const people = this.artDeptPersonNames;
      if (!people.length) return true;
      return people.some(person => samePerson(person, name));
    },

    canonicalArtDeptPerson(name = '') {
      const value = String(name || '').trim();
      if (!value) return '';
      return this.artDeptPeopleAliasMap.get(normalizePersonName(value)) || canonicalSkillValidationPerson(value) || value;
    },

    canonicalPersonList(value = '') {
      return this.personList(value)
        .map(person => this.canonicalArtDeptPerson(person) || person)
        .filter(Boolean)
        .filter((person, index, array) => array.findIndex(item => samePerson(item, person)) === index);
    },

    personList(value = '') {
      return String(value || '')
        .split(/[、,，;；|/\\\s]+/)
        .map(item => this.canonicalArtDeptPerson(item) || String(item || '').trim())
        .filter(Boolean)
        .filter((item, index, array) => array.findIndex(other => samePerson(other, item)) === index);
    },

    displayPersonList(value = '') {
      const people = this.personList(value);
      return people.length ? people.join('、') : '-';
    },

    displayChinesePersonList(value = '') {
      const people = this.personList(value)
        .map(person => this.canonicalArtDeptPerson(person) || person)
        .filter(person => /[\u4e00-\u9fa5]/.test(person))
        .filter((person, index, array) => array.findIndex(item => samePerson(item, person)) === index);
      return people.length ? people.join('、') : '-';
    },

    validationOwnerSelection(value = '') {
      return this.personList(value).filter(person => person && person !== '-' && person !== '待确认');
    },

    defaultSkillInventoryOwnerName() {
      const owner = (Array.isArray(this.aiMembersSnapshot?.members) ? this.aiMembersSnapshot.members : [])
        .find(member => samePerson(member.name, '张倩文') || samePerson(member.account, 'zhangqw') || member.role === 'owner');
      return owner?.name || '张倩文';
    },

    isCurrentAccountPerson(name = '') {
      if (this.isPlatformAdmin) return true;
      const value = String(name || '').trim();
      if (!value) return false;
      return this.currentAccountPersonNames.some(person => samePerson(person, value));
    },

    taskPersonCardSortRank(person = {}) {
      if (person.isOwnerPerson) return 0;
      if (!this.isPlatformAdmin && this.isCurrentAccountPerson(person.name)) return 1;
      return 2;
    },

    isCurrentAccountTask(task = {}) {
      if (this.isPlatformAdmin) return true;
      return this.isCurrentAccountPerson(task.developer)
        || this.isCurrentAccountPerson(task.assignedTo)
        || this.isCurrentAccountPerson(task.zentao?.assignedTo)
        || this.isCurrentAccountPerson(task.zentao?.assignedToName)
        || this.isCurrentAccountPerson(task.owner)
        || this.isCurrentAccountPerson(task.creator);
    },

    taskBelongsToPerson(task = {}, person = '') {
      if (!person) return true;
      const aliases = [
        person,
        this.canonicalArtDeptPerson(person)
      ].filter(Boolean);
      const fields = [
        task.developer,
        task.assignedTo,
        task.assignedToName,
        task.owner,
        task.creator,
        task.zentao?.assignedTo,
        task.zentao?.assignedToName,
        task.zentao?.openedBy
      ];
      return fields.some(field => aliases.some(alias => samePerson(field, alias)));
    },

    taskAssigneeDisplayName(task = {}) {
      const fields = [
        task.developer,
        task.assignedToName,
        task.assignedTo,
        task.zentao?.assignedToName,
        task.zentao?.assignedToRealName,
        task.zentao?.assignedTo,
        task.owner,
        task.creator
      ];
      for (const field of fields) {
        const name = this.canonicalArtDeptPerson(field);
        if (name && this.isArtDeptPerson(name)) return name;
      }
      return this.canonicalArtDeptPerson(task.developer || task.assignedTo || task.zentao?.assignedTo || '') || '';
    },

    isArtDepartmentTask(task = {}) {
      return this.isArtDeptPerson(task.developer)
        || this.isArtDeptPerson(task.assignedTo)
        || this.isArtDeptPerson(task.assignedToName)
        || this.isArtDeptPerson(task.zentao?.assignedTo)
        || this.isArtDeptPerson(task.zentao?.assignedToName)
        || this.isArtDeptPerson(task.zentao?.assignedToRealName);
    },

    isCurrentAccountBug(bug = {}) {
      if (this.isPlatformAdmin) return true;
      return this.isCurrentAccountPerson(this.bugAssigneeName(bug))
        || this.isCurrentAccountPerson(bug.openedBy)
        || this.isCurrentAccountPerson(bug.resolvedBy)
        || this.isCurrentAccountPerson(bug.zentao?.openedBy)
        || this.isCurrentAccountPerson(bug.zentao?.resolvedBy);
    },

    bugBelongsToPerson(bug = {}, person = '') {
      if (!person) return true;
      const aliases = [
        person,
        this.canonicalArtDeptPerson(person)
      ].filter(Boolean);
      const fields = [
        this.bugAssigneeName(bug),
        bug.assignedTo,
        bug.assignedToName,
        bug.developer,
        bug.openedBy,
        bug.resolvedBy,
        bug.zentao?.assignedTo,
        bug.zentao?.assignedToName,
        bug.zentao?.openedBy,
        bug.zentao?.resolvedBy
      ];
      return fields.some(field => aliases.some(alias => samePerson(field, alias)));
    },

    isArtDepartmentBug(bug = {}) {
      return this.isArtDeptPerson(this.bugAssigneeName(bug))
        || this.isArtDeptPerson(bug.assignedTo)
        || this.isArtDeptPerson(bug.assignedToName)
        || this.isArtDeptPerson(bug.developer)
        || this.isArtDeptPerson(bug.openedBy)
        || this.isArtDeptPerson(bug.openedByName)
        || this.isArtDeptPerson(bug.resolvedBy)
        || this.isArtDeptPerson(bug.resolvedByName)
        || this.isArtDeptPerson(bug.zentao?.assignedTo)
        || this.isArtDeptPerson(bug.zentao?.assignedToName)
        || this.isArtDeptPerson(bug.zentao?.openedBy)
        || this.isArtDeptPerson(bug.zentao?.openedByName)
        || this.isArtDeptPerson(bug.zentao?.resolvedBy)
        || this.isArtDeptPerson(bug.zentao?.resolvedByName);
    },

    async bootstrapAuth() {
      try {
        const result = await this.api('/api/auth/me', {}, { allowUnauthorized: true });
        this.currentUser = result.user || null;
        this.authChecked = true;
        if (this.currentUser) {
          this.forcePasswordDialog = this.currentUser.mustChangePassword === true;
          this.syncRoute();
          await this.refreshConfig();
          await this.restoreWorkbenchServerState();
          this.ensureActiveViewData(this.activeView);
        } else if (window.location.pathname !== '/login') {
          this.pushRoute('/login');
        }
      } catch {
        this.currentUser = null;
        this.authChecked = true;
        if (window.location.pathname !== '/login') this.pushRoute('/login');
      }
    },

    async login() {
      this.loginError = '';
      this.loginLoading = true;
      try {
        const result = await this.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(this.loginForm)
        }, { allowUnauthorized: true });
        this.currentUser = result.user;
        this.loginForm.password = '';
        this.forcePasswordDialog = this.currentUser?.mustChangePassword === true;
        if (window.location.pathname === '/login') this.pushRoute(this.firstAllowedRoute());
        else this.syncRoute();
        await this.refreshConfig();
        await this.restoreWorkbenchServerState();
        this.ensureActiveViewData(this.activeView);
      } catch (error) {
        this.loginError = this.readApiError(error) || '登录失败';
      } finally {
        this.loginLoading = false;
      }
    },

    async logout() {
      await this.api('/api/auth/logout', { method: 'POST' }, { allowUnauthorized: true }).catch(() => { });
      this.stopTaskBriefRealtimeSync();
      this.stopPlatformEventSync();
      this.currentUser = null;
      this.forcePasswordDialog = false;
      this.forcePasswordForm = { currentPassword: '', password: '', confirmPassword: '' };
      this.projects = [];
      this.runs = [];
      this.businessTasks = [];
      this.bugs = [];
      this.taskReviews = [];
      this.users = [];
      this.roles = [];
      this.operationLogs = [];
      this.permissionCatalog = [];
      this.scans = {};
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      if (this.platformEventSource) {
        this.platformEventSource.close();
        this.platformEventSource = null;
      }
      this.pushRoute('/login');
    },

    async restoreWorkbenchServerState() {
      if (!this.currentUser) return;
      this.workbenchStateRestoring = true;
      const jobs = [];
      const lightRunViews = ['runs', 'agent-workers', 'ai-archive'];
      const aiMembersView = this.activeView === 'ai-members';
      try {
        if (lightRunViews.includes(this.activeView)) {
          jobs.push(['执行记录', () => this.refreshRuns()]);
          if (['runs', 'agent-workers'].includes(this.activeView) && this.can('api.agentWorkers.read')) {
            jobs.push(['Worker 状态', () => this.refreshAgentWorkers()]);
          }
          if ((this.can('api.users.manage') || this.can('api.agentWorkers.read')) && !this.users.length) {
            jobs.push(['账号列表', () => this.refreshUsers()]);
          }
        } else if (!aiMembersView && this.can('menu.skillList')) {
          jobs.push(['库存缓存', () => this.loadSkillInventorySavedSnapshot()]);
          jobs.push(['人工研究清单', () => this.refreshAiAssetSheet()]);
          jobs.push(['验证回填', () => this.refreshSkillValidations({ force: true, silent: true })]);
          jobs.push(['调用次数', () => this.refreshUsageCounters()]);
          jobs.push(['版本覆盖', () => this.refreshSkillVersionOverrides()]);
        }
        if (!lightRunViews.includes(this.activeView) && !aiMembersView && (this.can('menu.skillList') || this.can('menu.aiMembers'))) {
          jobs.push(['AI 研究同步', () => this.refreshArtProgressEvents()]);
        }
        if (aiMembersView && this.can('api.aiMembers.read')) {
          this.restoreAiMembersBoardHtmlSnapshot();
          if (!this.hasAiMembersBoardHtml(this.aiMembersSnapshot)) {
            jobs.push(['成员快照', () => this.refreshAiMembers({ silent: true })]);
          }
        } else if (!lightRunViews.includes(this.activeView) && this.can('menu.aiMembers')) {
          jobs.push(['成员快照', () => this.refreshAiMembers()]);
        }
        const results = await Promise.allSettled(jobs.map(([, run]) => run()));
        results.forEach((result, index) => {
          if (result.status === 'rejected') console.warn(`${jobs[index][0]}恢复失败，已保留当前页面状态`, result.reason);
        });
        if (!lightRunViews.includes(this.activeView) && !aiMembersView && this.can('menu.skillList')) {
          this.applySkillAliasOverridesToScans();
          this.saveWorkbenchDisplayCache('scans', this.scans);
        }
        if (!this.platformEventSource) this.startPlatformEventSync();
      } finally {
        this.workbenchStateRestoring = false;
        if (this.activeView === 'ai-members') {
          this.aiMembersBoardFrameReady = true;
          this.restoreAiMemberScoreSnapshot();
        }
      }
    },

    roleLabel(role = '', fallbackName = '') {
      if (fallbackName) return fallbackName;
      const label = {
        ...Object.fromEntries(this.roles.map(item => [item.id, item.name])),
        admin: '管理员',
        developer: '美术执行人',
        reviewer: '美术验证人',
        viewer: '组员只读'
      }[role];
      if (label) return label;
      if (!role) return '未登录';
      if (String(role).startsWith('role-')) return '自定义角色';
      return role;
    },

    can(permission) {
      if (!permission) return true;
      if (this.currentUser?.role === 'admin') return true;
      return this.permissionSet.has(permission);
    },

    canAny(permissions = []) {
      return permissions.some(permission => this.can(permission));
    },

    firstAllowedRoute() {
      const routes = [
        ['menu.tasks', '/tasks'],
        ['menu.skillList', '/skills/list'],
        ['menu.aiMembers', '/ai-members'],
        ['menu.runs', '/runs'],
        ['menu.agentWorkers', '/agent-workers'],
        ['menu.aiArchive', '/ai-archive'],
        ['menu.codexConfig', '/codex-config'],
        ['menu.users', '/user-access'],
        ['menu.roles', '/role-management'],
        ['menu.operationLogs', '/operation-logs']
      ];
      return routes.find(([permission]) => this.can(permission))?.[1] || '/login';
    },

    userAvatarText(user) {
      const name = String(user?.displayName || user?.username || '用').trim();
      return name.slice(0, 1).toUpperCase();
    },

    userAvatarStyle(user) {
      const seed = String(user?.username || user?.displayName || 'default');
      const palettes = [
        ['#16a34a', '#22c55e'],
        ['#2563eb', '#38bdf8'],
        ['#7c3aed', '#a78bfa'],
        ['#dc2626', '#fb7185'],
        ['#0f766e', '#2dd4bf'],
        ['#c2410c', '#fb923c']
      ];
      const hash = Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0);
      const [from, to] = palettes[hash % palettes.length];
      return { background: `linear-gradient(135deg, ${from}, ${to})` };
    },

    pushRoute(path) {
      if (window.location.pathname !== path) {
        window.history.pushState({}, '', path);
      }
      this.currentPath = window.location.pathname;
      this.syncRoute();
    },

    syncRoute() {
      const path = decodeURI(window.location.pathname);
      this.currentPath = path;
      if (path === '/login') {
        if (this.authChecked && this.currentUser) this.pushRoute(this.firstAllowedRoute());
        return;
      }
      if (this.authChecked && !this.currentUser) {
        this.activeView = 'tasks';
        if (path !== '/login') this.pushRoute('/login');
        return;
      }
      const projectMatch = path.match(/^\/projects\/([^/]+)$/);
      const taskReviewMatch = path.match(/^\/projects\/([^/]+)\/tasks\/(.+)\/review$/);
      const taskResultMatch = path.match(/^\/projects\/([^/]+)\/tasks\/(.+)\/result$/);

      if (path === '/' || path === '/workspace') {
        if (!this.can('menu.tasks')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.pushRoute('/tasks');
        return;
      }
      if (path === '/projects') {
        if (!this.can('menu.tasks')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.pushRoute('/tasks');
        return;
      }
      if (path === '/skii-repository') {
        this.pushRoute('/skills/assets');
        return;
      }
      const skillRouteMatch = path.match(/^\/skills(?:\/(list|members|validations|events|assets))?$/);
      const adminSkillRouteMatch = path.match(/^\/admin\/skills(?:\/(list|members|validations|events|assets))?$/);
      if (skillRouteMatch || adminSkillRouteMatch || path === '/skill-inventory') {
        if (!this.can('menu.skillList')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        const matchedSkillTab = skillRouteMatch?.[1] || adminSkillRouteMatch?.[1] || '';
        if (['validations', 'events'].includes(matchedSkillTab)) {
          this.pushRoute('/skills/assets');
          return;
        }
        const routeTab = matchedSkillTab === 'members' ? 'assets' : matchedSkillTab || 'assets';
        const tab = routeTab === 'list' ? 'assets' : routeTab;
        const requiredPermission = {
          list: 'menu.skillList',
          assets: 'menu.skillList'
        }[tab] || 'menu.skillList';
        if (!this.can(requiredPermission)) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.skillInventoryTab = tab;
        this.activeView = 'skill-inventory';
        this.ensureActiveViewData('skill-inventory');
        this.$nextTick(() => this.ensureSkillInventoryTabData(tab));
        return;
      }
      if (path === '/ai-members') {
        if (!this.can('menu.aiMembers')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.prepareAiMembersView();
        this.activeView = 'ai-members';
        this.ensureActiveViewData('ai-members');
        return;
      }
      if (path === '/tasks') {
        if (!this.can('menu.tasks')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.activeView = 'tasks';
        return;
      }
      if (path === '/codex-config') {
        if (!this.can('menu.codexConfig')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.activeView = 'codex-config';
        this.ensureActiveViewData('codex-config');
        this.loadCodexConfig();
        return;
      }
      if (path === '/runs') {
        if (!this.can('menu.runs')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.activeView = 'runs';
        this.ensureActiveViewData('runs');
        return;
      }
      if (path === '/agent-workers') {
        if (!this.can('menu.agentWorkers')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.activeView = 'agent-workers';
        this.ensureActiveViewData('agent-workers');
        return;
      }
      if (path === '/ai-archive') {
        if (!this.can('menu.aiArchive')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.activeView = 'ai-archive';
        this.ensureActiveViewData('ai-archive');
        return;
      }
      if (path === '/workflow-designer') {
        this.pushRoute(this.firstAllowedRoute());
        return;
      }
      if (path === '/user-access') {
        if (!this.can('menu.users')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.activeView = 'user-access';
        this.ensureActiveViewData('user-access');
        return;
      }
      if (path === '/role-management') {
        if (!this.can('menu.roles')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.activeView = 'role-management';
        this.ensureActiveViewData('role-management');
        return;
      }
      if (path === '/operation-logs') {
        if (!this.can('menu.operationLogs')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.activeView = 'operation-logs';
        this.ensureActiveViewData('operation-logs');
        return;
      }
      if (projectMatch) {
        if (!this.can('menu.skillList')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.selectedProjectId = projectMatch[1];
        this.activeView = 'project-detail';
        return;
      }
      if (taskResultMatch) {
        if (!this.can('menu.skillList')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        this.selectedProjectId = taskResultMatch[1];
        const taskPath = decodeURIComponent(taskResultMatch[2]);
        this.activeView = 'task-result';
        this.ensureTaskRoute(taskPath);
        return;
      }
      if (taskReviewMatch) {
        if (!this.can('review.submit')) {
          this.pushRoute(this.firstAllowedRoute());
          return;
        }
        const params = new URLSearchParams(window.location.search);
        this.selectedProjectId = taskReviewMatch[1];
        const taskPath = decodeURIComponent(taskReviewMatch[2]);
        this.activeView = 'manual-review';
        this.ensureTaskRoute(taskPath, {
          stage: params.get('stage'),
          review: params.get('review')
        });
        return;
      }
      this.pushRoute(this.firstAllowedRoute());
    },

    async ensureTaskRoute(taskPath, options = {}) {
      if (!this.scans[this.selectedProjectId]) await this.loadProjectScanCacheForInventory();
      const task = (this.scans[this.selectedProjectId]?.tasks || []).find(item => item.path === taskPath || encodeURIComponent(item.path) === taskPath);
      if (task) {
        this.prepareTaskResult(task);
        if (options.stage) this.selectedStageNo = options.stage;
        if (options.review) this.selectedReviewKey = options.review;
      }
    },

    applyTheme(theme) {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
      localStorage.setItem('awp-theme', theme);
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
    },

    toggleSidebar() {
      this.isSidebarCollapsed = !this.isSidebarCollapsed;
    },

    async copyText(value, label = '内容') {
      const text = String(value || '').trim();
      if (!text) {
        ElMessage.warning(`没有可复制的${label}`);
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          throw new Error('clipboard api unavailable');
        }
        ElMessage.success(`${label}已复制`);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
          const copied = document.execCommand('copy');
          if (!copied) throw new Error('copy command failed');
          ElMessage.success(`${label}已复制`);
        } catch {
          ElMessage.error(`${label}复制失败`);
        } finally {
          document.body.removeChild(textarea);
        }
      }
    },

    workbenchDisplayCacheKey(key = '') {
      return `awp-display-cache:${key}`;
    },

    clearDeprecatedWorkbenchDisplayCache() {
    },

    saveWorkbenchDisplayCache(key = '', value) {
      if (!key) return;
      try {
        const payload = JSON.stringify({
          value,
          savedAt: new Date().toISOString()
        });
        const maxPayloadLength = ['aiMembersSnapshot', 'aiMembersBoardHtmlSnapshot'].includes(key) ? 900 * 1024 : 220 * 1024;
        if (payload.length > maxPayloadLength) {
          localStorage.removeItem(this.workbenchDisplayCacheKey(key));
          return;
        }
        localStorage.setItem(this.workbenchDisplayCacheKey(key), payload);
      } catch {
      }
    },

    isAiMembersPlaceholderHtml(html = '') {
      return /正在加载\s*AI部门看板/.test(String(html || ''));
    },

    isAiMembersBoardHtml(html = '') {
      const text = String(html || '');
      return text.length > 1000 && /<!doctype\s+html|<html[\s>]/i.test(text) && !this.isAiMembersPlaceholderHtml(text);
    },

    hasAiMembersBoardHtml(snapshot = {}) {
      if (!snapshot || typeof snapshot !== 'object') return false;
      return ['html', 'ownerHtml', 'memberHtml'].some(key => this.isAiMembersBoardHtml(snapshot[key]));
    },

    readAiMembersBoardHtmlSnapshot() {
      try {
        const raw = localStorage.getItem(this.workbenchDisplayCacheKey('aiMembersBoardHtmlSnapshot'));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const value = parsed?.value && typeof parsed.value === 'object' ? parsed.value : parsed;
        return this.hasAiMembersBoardHtml(value) ? value : null;
      } catch {
        return null;
      }
    },

    saveAiMembersBoardHtmlSnapshot(snapshot = {}) {
      if (!this.hasAiMembersBoardHtml(snapshot)) return;
      const payload = {
        mode: snapshot.mode || '',
        source: snapshot.source || {},
        html: this.isAiMembersBoardHtml(snapshot.html) ? snapshot.html : '',
        ownerHtml: this.isAiMembersBoardHtml(snapshot.ownerHtml) ? snapshot.ownerHtml : '',
        memberHtml: this.isAiMembersBoardHtml(snapshot.memberHtml) ? snapshot.memberHtml : ''
      };
      if (!payload.html) payload.html = payload.ownerHtml || payload.memberHtml || '';
      this.saveWorkbenchDisplayCache('aiMembersBoardHtmlSnapshot', payload);
    },

    mergeAiMembersSnapshotWithBoardCache(snapshot = {}) {
      const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
      const current = this.aiMembersSnapshot && typeof this.aiMembersSnapshot === 'object' ? this.aiMembersSnapshot : {};
      const cached = this.readAiMembersBoardHtmlSnapshot() || {};
      const merged = { ...current, ...cached, ...source };
      ['html', 'ownerHtml', 'memberHtml'].forEach(key => {
        const sourceHtml = source[key];
        const currentHtml = current[key];
        const cachedHtml = cached[key];
        merged[key] = this.isAiMembersBoardHtml(sourceHtml)
          ? sourceHtml
          : this.isAiMembersBoardHtml(currentHtml)
            ? currentHtml
            : this.isAiMembersBoardHtml(cachedHtml)
              ? cachedHtml
              : sourceHtml || currentHtml || cachedHtml || '';
      });
      if (!this.isAiMembersBoardHtml(merged.html)) {
        merged.html = merged.mode === 'member'
          ? (merged.memberHtml || merged.ownerHtml || merged.html || '')
          : (merged.ownerHtml || merged.memberHtml || merged.html || '');
      }
      return merged;
    },

    restoreAiMembersBoardHtmlSnapshot() {
      const merged = this.mergeAiMembersSnapshotWithBoardCache(this.aiMembersSnapshot || {});
      if (!this.hasAiMembersBoardHtml(merged)) return false;
      this.aiMembersSnapshot = merged;
      return true;
    },

    restoreWorkbenchDisplayCacheKey(key = '') {
      if (!key) return false;
      try {
        const raw = localStorage.getItem(this.workbenchDisplayCacheKey(key));
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'value')) return false;
        if (Array.isArray(this[key]) && Array.isArray(parsed.value)) {
          this[key] = parsed.value;
          return true;
        }
        if (this[key] === null || typeof this[key] === 'object') {
          this[key] = parsed.value;
          return true;
        }
      } catch {
      }
      return false;
    },

    restoreAiMemberScoreSnapshot() {
      try {
        const raw = localStorage.getItem(this.workbenchDisplayCacheKey('aiMemberScoreRowsSnapshot'));
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed?.rows) ? parsed.rows : Array.isArray(parsed?.value?.rows) ? parsed.value.rows : [];
        if (!rows.length) return false;
        this.aiMemberScoreRowsSnapshot = rows;
        this.aiMemberScoreRowsSnapshotKey = parsed.key || parsed.value?.key || '';
        this.aiMemberScoreRowsSnapshotAt = parsed.savedAt || parsed.value?.savedAt || '';
        this.aiMemberScoreReady = true;
        return true;
      } catch {
        return false;
      }
    },

    saveAiMemberScoreSnapshot(rows = [], key = '') {
      if (!Array.isArray(rows) || !rows.length) return;
      const payload = {
        rows,
        key,
        savedAt: new Date().toISOString()
      };
      this.aiMemberScoreRowsSnapshot = rows;
      this.aiMemberScoreRowsSnapshotKey = key;
      this.aiMemberScoreRowsSnapshotAt = payload.savedAt;
      try {
        localStorage.setItem(this.workbenchDisplayCacheKey('aiMemberScoreRowsSnapshot'), JSON.stringify(payload));
      } catch {
      }
    },

    restoreWorkbenchDisplayCacheKeyIfEmpty(key = '') {
      if (!key) return false;
      const current = this[key];
      if (Array.isArray(current) && current.length) return false;
      if (current && typeof current === 'object' && !Array.isArray(current) && Object.keys(current).length) return false;
      if (current !== null && current !== undefined && !Array.isArray(current) && typeof current !== 'object') return false;
      return this.restoreWorkbenchDisplayCacheKey(key);
    },

    restoreWorkbenchDisplayCache() {
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      if (['/runs', '/agent-workers', '/ai-archive'].includes(path)) {
        ['runs', 'projects', 'agentWorkers'].forEach(key => this.restoreWorkbenchDisplayCacheKey(key));
        return;
      }
      [
        'businessTasks',
        'projects',
        'bugs',
        'taskReviews',
        'taskProcessingNotes',
        'scans',
        'aiAssetSheetRows',
        'aiMembersSnapshot',
        'runs',
        'artProgressEvents',
        'skillValidationRows',
        'operationLogs',
        'artProgressSummary',
        'usageCounters'
      ].forEach(key => this.restoreWorkbenchDisplayCacheKey(key));
      this.restoreAiMembersBoardHtmlSnapshot();
      this.restoreAiMemberScoreSnapshot();
    },

    async refreshAll() {
      const jobs = [
        ['配置', () => this.refreshConfig()],
        ['项目列表', () => this.refreshProjects()],
        ['项目表格', () => this.refreshArtProjectSheet()],
        ['任务中心', () => this.refreshTasks()],
        ['Bug 列表', () => this.refreshBugs()],
        ['任务处理记录', () => this.refreshTaskProcessingNotes()]
      ];
      const results = await Promise.allSettled(jobs.map(([, run]) => run()));
      results.forEach((result, index) => {
        if (result.status === 'rejected') console.warn(`${jobs[index][0]}刷新失败，已保留当前页面数据`, result.reason);
      });
    },

    startPlatformEventSync() {
      this.stopPlatformEventSync();
      if (!this.currentUser || typeof EventSource === 'undefined') return;
      const source = new EventSource('/api/platform-events');
      this.platformEventSource = source;
      source.addEventListener('message', event => {
        try {
          this.handlePlatformEvent(JSON.parse(event.data || '{}'));
        } catch {}
      });
      source.onerror = () => {
        if (this.platformEventSource === source) {
          source.close();
          this.platformEventSource = null;
          window.setTimeout(() => {
            if (this.currentUser && !this.platformEventSource) this.startPlatformEventSync();
          }, 3000);
        }
      };
    },

    stopPlatformEventSync() {
      if (this.platformEventSource) {
        this.platformEventSource.close();
        this.platformEventSource = null;
      }
      Object.values(this.platformEventRefreshTimers || {}).forEach(timer => clearTimeout(timer));
      this.platformEventRefreshTimers = {};
    },

    schedulePlatformRefresh(key, callback, delay = 250) {
      if (!this.currentUser || typeof callback !== 'function') return;
      if (this.platformEventRefreshTimers[key]) clearTimeout(this.platformEventRefreshTimers[key]);
      this.platformEventRefreshTimers[key] = window.setTimeout(async () => {
        delete this.platformEventRefreshTimers[key];
        try {
          await callback();
        } catch (error) {
          console.warn(`${key} 自动刷新失败`, error);
        }
      }, delay);
    },

    handlePlatformEvent(event = {}) {
      const type = String(event.type || '').trim();
      if (type === 'skill-version-overrides.changed' && this.can('menu.skillList')) {
        this.schedulePlatformRefresh('skill-version-overrides', async () => {
          await this.refreshSkillVersionOverrides();
          this.applySkillAliasOverridesToScans();
          this.saveWorkbenchDisplayCache('scans', this.scans);
        });
      }
      if (type === 'usage-counters.changed' && this.can('menu.skillList')) {
        this.schedulePlatformRefresh('usage-counters', async () => {
          await this.refreshUsageCounters();
        }, 300);
      }
      if (type === 'project-scan-cache.changed' && this.can('menu.skillList')) {
        this.schedulePlatformRefresh('project-scan-cache', async () => {
          await this.loadProjectScanCacheForInventory();
        }, 400);
      }
      if (type === 'runs.changed' && this.can('menu.runs')) {
        this.schedulePlatformRefresh('runs', async () => {
          await this.refreshRuns();
        }, 300);
      }
      if (type === 'tasks.changed' && this.can('menu.tasks')) {
        if (event.payload?.deleted) this.removeDeletedTaskFromLocalState(event.payload);
        this.schedulePlatformRefresh('tasks', async () => {
          await Promise.all([
            this.refreshTasks(),
            this.refreshTaskProcessingNotes(),
            this.refreshConfig()
          ]);
        }, 300);
      }
      if (type === 'agent-workers.changed' && this.can('menu.agentWorkers')) {
        if (document.visibilityState === 'hidden') return;
        if (!['agent-workers', 'runs'].includes(this.activeView)) return;
        this.schedulePlatformRefresh('agent-workers', async () => {
          await this.refreshAgentWorkers();
        }, 500);
      }
    },

    async refreshCurrentUserPermissions() {
      const result = await this.api('/api/auth/me', {}, { allowUnauthorized: true });
      if (!result.user) {
        this.currentUser = null;
        this.stopPlatformEventSync();
        if (window.location.pathname !== '/login') this.pushRoute('/login');
        return;
      }
      this.currentUser = result.user;
      this.forcePasswordDialog = this.currentUser?.mustChangePassword === true;
      this.syncRoute();
    },

    async refreshConfig() {
      try {
        this.appConfig = await this.api('/api/config');
        this.taskCenterConfigReady = true;
      } catch (error) {
        if (!this.appConfig || !Object.keys(this.appConfig).length) {
          this.appConfig = { zentaoBaseUrl: '', codex: null, zentaoAutoSync: null, zentaoArtUsers: [], taskCenter: null, workflowLevels: DEFAULT_WORKFLOW_LEVELS };
        }
        this.taskCenterConfigReady = Boolean(this.appConfig?.taskCenter);
      }
      this.syncAiAssetVisibleColumnsFromConfig();
      this.syncSkillValidationVisibleColumnsFromConfig();
    },

    startZentaoAutoSyncPolling() {
      if (!this.currentUser || this.zentaoAutoSyncPollTimer) return;
      this.zentaoAutoSyncWasRunning = this.zentaoSyncRunning;
      this.zentaoAutoSyncPollTimer = window.setInterval(() => {
        this.refreshZentaoAutoSyncStatus();
      }, 1000);
      this.refreshZentaoAutoSyncStatus();
    },

    stopZentaoAutoSyncPolling() {
      if (this.zentaoAutoSyncPollTimer) window.clearInterval(this.zentaoAutoSyncPollTimer);
      this.zentaoAutoSyncPollTimer = null;
      this.zentaoAutoSyncWasRunning = false;
    },

    async refreshZentaoAutoSyncStatus() {
      if (!this.currentUser || this.activeView !== 'tasks' || document.visibilityState === 'hidden') return;
      const wasRunning = Boolean(this.zentaoSyncRunning || this.zentaoAutoSyncWasRunning);
      try {
        await this.refreshConfig();
      } catch {
        return;
      }
      const isRunning = this.zentaoSyncRunning;
      if (wasRunning && !isRunning) {
        await Promise.all([this.refreshTasks(), this.refreshBugs()]);
        this.stopZentaoAutoSyncPolling();
      }
      this.zentaoAutoSyncWasRunning = isRunning;
    },

    async saveTaskCenterConfig(patch = {}) {
      const config = await this.api('/api/task-center/config', {
        method: 'POST',
        body: JSON.stringify(patch)
      });
      this.appConfig = {
        ...this.appConfig,
        taskCenter: config
      };
      this.taskCenterConfigReady = true;
      if (Object.prototype.hasOwnProperty.call(patch, 'aiAssetVisibleColumns')) this.syncAiAssetVisibleColumnsFromConfig();
      if (Object.prototype.hasOwnProperty.call(patch, 'skillValidationVisibleColumns')) this.syncSkillValidationVisibleColumnsFromConfig();
      return config;
    },

    defaultAiAssetColumnKeys() {
      return this.aiAssetColumnOptions.map(column => column.key);
    },

    effectiveAiAssetVisibleColumns() {
      const hasConfigured = Array.isArray(this.appConfig?.taskCenter?.aiAssetVisibleColumns);
      const configured = hasConfigured ? this.appConfig.taskCenter.aiAssetVisibleColumns : [];
      const defaults = this.defaultAiAssetColumnKeys();
      const local = this.aiAssetVisibleColumns || [];
      const source = this.canManageSkillAssets
        ? (local.length ? local : (hasConfigured ? configured : defaults))
        : (hasConfigured ? configured : []);
      const allowed = new Set(defaults);
      const normalized = source.filter(key => allowed.has(key));
      return normalized.length ? normalized : (hasConfigured ? [] : (this.canManageSkillAssets ? defaults : ['title', 'usage']));
    },

    syncAiAssetVisibleColumnsFromConfig() {
      const hasConfigured = Array.isArray(this.appConfig?.taskCenter?.aiAssetVisibleColumns);
      const configured = hasConfigured ? this.appConfig.taskCenter.aiAssetVisibleColumns : [];
      const defaults = this.defaultAiAssetColumnKeys();
      const allowed = new Set(defaults);
      const next = configured.filter(key => allowed.has(key));
      this.aiAssetVisibleColumns = hasConfigured ? next : (this.canManageSkillAssets ? defaults : ['title', 'usage']);
    },

    async saveAiAssetColumnConfig() {
      if (!this.canManageSkillAssets) return;
      try {
        await this.saveTaskCenterConfig({ aiAssetVisibleColumns: this.effectiveAiAssetVisibleColumns() });
        ElMessage.success('AI 产物清单字段已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '字段配置保存失败');
      }
    },

    skillValidationColumnOptions() {
      return [
        { key: 'source', label: '来源' },
        { key: 'submittedDate', label: '提交日期' },
        { key: 'artifactName', label: '产物文件名' },
        { key: 'validator', label: '验证人' },
        { key: 'owner', label: '贡献人' },
        { key: 'artifactType', label: '产物类型' },
        { key: 'workflowScene', label: '工作场景' },
        { key: 'validationResult', label: '验证结果' },
        { key: 'mapping', label: '清单映射' },
        { key: 'validationInfo', label: '验证信息' },
        { key: 'actions', label: '操作' }
      ];
    },

    defaultSkillValidationColumnKeys() {
      return this.skillValidationColumnOptions().map(column => column.key);
    },

    effectiveSkillValidationVisibleColumns() {
      const hasConfigured = Array.isArray(this.appConfig?.taskCenter?.skillValidationVisibleColumns);
      const configured = hasConfigured ? this.appConfig.taskCenter.skillValidationVisibleColumns : [];
      const defaults = this.defaultSkillValidationColumnKeys();
      const local = this.skillValidationVisibleColumns || [];
      const source = this.canManageSkillValidationColumns
        ? (local.length ? local : (hasConfigured ? configured : defaults))
        : (hasConfigured ? configured : defaults);
      const allowed = new Set(defaults);
      const normalized = source.filter(key => allowed.has(key));
      return normalized.length ? normalized : (hasConfigured ? [] : defaults);
    },

    isSkillValidationColumnVisible(key = '') {
      if (!this.taskCenterConfigReady) return false;
      return this.effectiveSkillValidationVisibleColumns().includes(key);
    },

    syncSkillValidationVisibleColumnsFromConfig() {
      const hasConfigured = Array.isArray(this.appConfig?.taskCenter?.skillValidationVisibleColumns);
      const configured = hasConfigured ? this.appConfig.taskCenter.skillValidationVisibleColumns : [];
      const defaults = this.defaultSkillValidationColumnKeys();
      const allowed = new Set(defaults);
      const next = configured.filter(key => allowed.has(key));
      this.skillValidationVisibleColumns = hasConfigured ? next : defaults;
    },

    setSkillValidationColumnVisible(key, checked) {
      if (!this.canManageSkillValidationColumns) return;
      const next = new Set(this.effectiveSkillValidationVisibleColumns());
      if (checked) next.add(key);
      else next.delete(key);
      this.skillValidationVisibleColumns = this.defaultSkillValidationColumnKeys().filter(item => next.has(item));
    },

    showAllSkillValidationColumns() {
      if (!this.canManageSkillValidationColumns) return;
      this.skillValidationVisibleColumns = this.defaultSkillValidationColumnKeys();
    },

    async saveSkillValidationColumnConfig() {
      if (!this.canManageSkillValidationColumns) return;
      try {
        const columns = this.effectiveSkillValidationVisibleColumns();
        await this.saveTaskCenterConfig({ skillValidationVisibleColumns: columns });
        ElMessage.success('产物验证区字段已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '字段配置保存失败');
      }
    },

    async refreshCodexConfig() {
      if (!this.can('api.codex.config.read')) return null;
      const config = await this.api('/api/codex/config');
      this.appConfig = { ...this.appConfig, codex: config };
      return config;
    },

    async loadCodexConfig() {
      let config = this.appConfig.codex || {};
      try {
        config = await this.refreshCodexConfig() || config;
      } catch {
        // Use the cached config when the dedicated endpoint is temporarily unavailable.
      }
      this.codexConfigForm = emptyCodexConfigForm(config);
      this.runChatForm.model = this.codexConfigForm.model || this.runChatForm.model || 'gpt-5.5';
      this.codexApiKeyDraft = '';
      this.codexApiKeyVisible = false;
    },

    async saveCodexConfig() {
      if (this.codexConfigForm.clearApiKey !== true && !this.codexApiKeyDraft && !this.codexConfigForm.hasApiKey) {
        ElMessage.warning('请填写 API Key，或先保存一个空配置后继续使用本机 Codex 登录态');
        return;
      }
      this.loading.codexConfig = true;
      try {
        const submittedApiKey = this.codexApiKeyDraft;
        const shouldClearApiKey = this.codexConfigForm.clearApiKey === true;
        const config = await this.api('/api/codex/config', {
          method: 'POST',
          body: JSON.stringify({
            ...this.codexConfigForm,
            apiKey: submittedApiKey
          })
        });
        this.appConfig = { ...this.appConfig, codex: config };
        this.codexConfigForm = {
          ...emptyCodexConfigForm(config),
          hasApiKey: shouldClearApiKey ? false : (config.hasApiKey === true || Boolean(submittedApiKey))
        };
        this.runChatForm.model = this.codexConfigForm.model || this.runChatForm.model || 'gpt-5.5';
        this.codexApiKeyDraft = shouldClearApiKey ? '' : submittedApiKey;
        ElMessage.success('Codex 配置已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || 'Codex 配置保存失败');
      } finally {
        this.loading.codexConfig = false;
      }
    },

    handleCodexApiKeyInput(value = '') {
      if (String(value || '').trim()) {
        this.codexConfigForm.clearApiKey = false;
      }
    },

    async refreshProjects() {
      this.loading.projects = true;
      try {
        this.projects = await this.api('/api/projects');
        this.saveWorkbenchDisplayCache('projects', this.projects);
        if (this.selectedProjectId && !this.projects.some(project => project.id === this.selectedProjectId)) {
          this.selectedProjectId = this.projects[0]?.id || '';
        }
        if (!this.selectedProjectId && this.projects[0]) this.selectedProjectId = this.projects[0].id;
        if (!this.runDrawer && !this.runForm.projectId) this.runForm.projectId = this.selectedProjectId || this.projects[0]?.id || '';
        if (this.isSkillInventoryViewActive) {
          this.$nextTick(() => this.ensureSkillInventoryTabData(this.skillInventoryTab || 'assets'));
        }
      } finally {
        this.loading.projects = false;
      }
    },

    async refreshSkillVersionOverrides() {
      try {
        const result = await this.api('/api/skill-version-overrides');
        const overrides = result.overrides || {};
        const ownerOverrides = {};
        const displayNameOverrides = {};
        const aliasOverrides = {};
        const aliasHistoryOverrides = {};
        const inventoryKindOverrides = {};
        for (const [key, record] of Object.entries(overrides)) {
          const owner = this.displayPersonList(record?.owner || record?.uploader || '');
          const overrideKeys = [
            key,
            record?.key,
            record?.relativePath,
            record?.path,
            record?.id
          ].map(value => String(value || '').trim()).filter(Boolean);
          if (owner && owner !== '-') {
            overrideKeys.forEach(itemKey => {
              ownerOverrides[itemKey] = owner;
            });
          }
          if (Object.prototype.hasOwnProperty.call(record || {}, 'displayName') || Object.prototype.hasOwnProperty.call(record || {}, 'commonName')) {
            const displayName = String(record?.displayName ?? record?.commonName ?? '').trim();
            const displayNameKeys = String(key || '').startsWith('name:') || String(record?.key || '').startsWith('name:')
              ? [key, record?.key].map(value => String(value || '').trim()).filter(Boolean)
              : overrideKeys;
            displayNameKeys.forEach(itemKey => {
              displayNameOverrides[itemKey] = displayName;
            });
          }
          if (Array.isArray(record?.aliases)) {
            const aliasKeys = String(key || '').startsWith('alias:') || String(record?.key || '').startsWith('alias:')
              ? [key, record?.key].map(value => String(value || '').trim()).filter(Boolean)
              : overrideKeys;
            aliasKeys.forEach(itemKey => {
              aliasOverrides[itemKey] = record.aliases;
            });
          }
          if (Array.isArray(record?.aliasHistory) || Array.isArray(record?.aliases)) {
            const history = this.normalizeSkillAliasHistoryList([
              ...(Array.isArray(record?.aliasHistory) ? record.aliasHistory : []),
              ...(Array.isArray(record?.aliases) ? record.aliases : [])
            ]);
            const aliasKeys = String(key || '').startsWith('alias:') || String(record?.key || '').startsWith('alias:')
              ? [key, record?.key].map(value => String(value || '').trim()).filter(Boolean)
              : overrideKeys;
            aliasKeys.forEach(itemKey => {
              aliasHistoryOverrides[itemKey] = history;
            });
          }
          if (Object.prototype.hasOwnProperty.call(record || {}, 'inventoryKind')) {
            const kindKeys = String(key || '').startsWith('kind:') || String(record?.key || '').startsWith('kind:')
              ? [key, record?.key].map(value => String(value || '').trim()).filter(Boolean)
              : overrideKeys;
            kindKeys.forEach(itemKey => {
              inventoryKindOverrides[itemKey] = record.inventoryKind;
            });
          }
        }
        this.skillOwnerOverrides = ownerOverrides;
        this.skillDisplayNameOverrides = displayNameOverrides;
        this.skillAliasOverrides = aliasOverrides;
        this.skillAliasHistoryOverrides = aliasHistoryOverrides;
        this.skillInventoryKindOverrides = inventoryKindOverrides;
        return true;
      } catch {
        this.skillOwnerOverrides = this.skillOwnerOverrides || {};
        this.skillDisplayNameOverrides = this.skillDisplayNameOverrides || {};
        this.skillAliasOverrides = this.skillAliasOverrides || {};
        this.skillAliasHistoryOverrides = this.skillAliasHistoryOverrides || {};
        this.skillInventoryKindOverrides = this.skillInventoryKindOverrides || {};
        return false;
      }
    },

    async refreshArtProjectSheet() {
      this.loading.artProjectSheet = true;
      try {
        const result = await this.api('/api/art-project-sheet');
        this.artProjectSheetRows = result.rows || [];
        this.artProjectSheetHeaders = result.headers || [];
        this.artProjectSheetFields = result.fields || [];
        this.artProjectSheetFetchedAt = result.fetchedAt || '';
        this.artProjectSheetSourceUrl = result.sheetSourceUrl || this.artProjectSheetSourceUrl;
        this.artProjectSheetPage = 1;
      } catch (error) {
        ElMessage.error(this.readApiError(error) || 'Google 项目表读取失败');
      } finally {
        this.loading.artProjectSheet = false;
      }
    },

    openArtProjectSheetRowCreate() {
      this.artProjectSheetDialog = {
        visible: true,
        form: emptyArtProjectSheetRowForm()
      };
    },

    openArtProjectSheetRowEdit(row = {}) {
      this.artProjectSheetDialog = {
        visible: true,
        form: {
          ...emptyArtProjectSheetRowForm(),
          id: row.id || '',
          rowNumber: row.rowNumber || 0,
          file: row.file || '',
          devLink: row.devLink || '',
          viewLink: row.viewLink || '',
          pcPreviewLink: row.pcPreviewLink || '',
          wapPreviewLink: row.wapPreviewLink || '',
          owner: row.owner || '',
          figmaName: row.figmaName || '',
          remark: row.remark || '',
          extra: { ...(row.extra || {}) },
          source: row.source || 'manual'
        }
      };
    },

    artProjectSheetFieldValue(row = {}, field = {}) {
      const key = String(field.key || '').trim();
      if (!key) return '';
      if (key.startsWith('extra.')) return String(row.extra?.[key.slice(6)] || row.extra?.[key] || '').trim();
      return String(row[key] || '').trim();
    },

    setArtProjectSheetFieldValue(form = {}, field = {}, value = '') {
      const key = String(field.key || '').trim();
      if (!key) return;
      if (key.startsWith('extra.')) {
        const extraKey = key.slice(6);
        form.extra = { ...(form.extra || {}), [extraKey]: value };
        return;
      }
      form[key] = value;
    },

    isArtProjectSheetUrlField(field = {}, value = '') {
      return field.type === 'url' || /^https?:\/\//i.test(String(value || '').trim());
    },

    artProjectSheetLinkText(field = {}, value = '') {
      const text = String(value || '').trim();
      if (!text) return '';
      return text.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    },

    artProjectSheetHref(value = '') {
      const text = String(value || '').trim();
      if (!text) return '';
      if (/^https?:\/\//i.test(text)) return text;
      if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(text)) return `https://${text}`;
      return text;
    },

    openArtProjectSheetFieldCreate() {
      this.artProjectSheetFieldDialog = {
        visible: true,
        form: {
          ...emptyArtProjectSheetFieldForm(),
          order: 1000 + this.artProjectSheetFields.length
        }
      };
    },

    openArtProjectSheetFieldEdit(field = {}) {
      this.artProjectSheetFieldDialog = {
        visible: true,
        form: {
          ...emptyArtProjectSheetFieldForm(),
          ...field
        }
      };
    },

    async saveArtProjectSheetField() {
      const form = this.artProjectSheetFieldDialog.form;
      if (!String(form.label || '').trim()) {
        ElMessage.warning('请填写字段名称');
        return;
      }
      const payload = { ...form };
      if (!String(payload.key || '').trim()) payload.key = `extra.${String(payload.label || '').trim()}`;
      this.loading.artProjectSheet = true;
      try {
        await this.api('/api/art-project-sheet/fields', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        this.artProjectSheetFieldDialog = { visible: false, form: emptyArtProjectSheetFieldForm() };
        await this.refreshArtProjectSheet();
        ElMessage.success('字段配置已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '字段配置保存失败');
      } finally {
        this.loading.artProjectSheet = false;
      }
    },

    async deleteArtProjectSheetField(field = {}) {
      if (!field.key || field.locked) return;
      await ElMessageBox.confirm(`确认删除字段「${field.label || field.key}」？已有行数据会保留在本地，不再展示。`, '删除字段', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      });
      this.loading.artProjectSheet = true;
      try {
        await this.api(`/api/art-project-sheet/fields/${encodeURIComponent(field.key)}`, { method: 'DELETE' });
        await this.refreshArtProjectSheet();
        ElMessage.success('字段已删除');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '字段删除失败');
      } finally {
        this.loading.artProjectSheet = false;
      }
    },

    async saveArtProjectSheetRow() {
      const form = this.artProjectSheetDialog.form;
      if (!String(form.file || '').trim()) {
        ElMessage.warning('请先填写项目名');
        return;
      }
      this.loading.artProjectSheet = true;
      try {
        await this.api('/api/art-project-sheet/rows', {
          method: 'POST',
          body: JSON.stringify(form)
        });
        this.artProjectSheetDialog = { visible: false, form: emptyArtProjectSheetRowForm() };
        await this.refreshArtProjectSheet();
        ElMessage.success('项目字段已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '项目字段保存失败');
      } finally {
        this.loading.artProjectSheet = false;
      }
    },

    async deleteArtProjectSheetRow(row = {}) {
      if (!row.id) return;
      await ElMessageBox.confirm(`确认删除项目列表里的「${row.file || row.id}」？`, '删除项目字段', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      });
      this.loading.artProjectSheet = true;
      try {
        await this.api(`/api/art-project-sheet/rows/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        await this.refreshArtProjectSheet();
        ElMessage.success('项目字段已删除');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '项目字段删除失败');
      } finally {
        this.loading.artProjectSheet = false;
      }
    },

    async refreshSkillValidations(options = {}) {
      const force = options.force === true;
      const silent = options.silent === true;
      if (!force && this.skillValidationRefreshPromise) return this.skillValidationRefreshPromise;
      if (!force && this.skillValidationRows.length && !this.skillValidationDirty) {
        return this.skillValidationMeta;
      }
      if (!silent) this.loading.skillValidations = true;
      this.skillValidationRefreshPromise = (async () => {
        await this.ensureValidationMappingSources();
        const result = await this.api('/api/skill-validations');
        if (!Array.isArray(result.records)) {
          const message = result.error || result.message || '验证回填接口未返回有效记录，已保留当前列表';
	          if (!silent) ElMessage.warning(message);
	          if (silent) throw new Error(message);
	          return;
	        }
        this.skillValidationRows = this.filterVisibleSkillValidationRecords(result.records);
	        this.skillValidationMeta = result;
          this.saveWorkbenchDisplayCache('skillValidationRows', this.skillValidationRows);
          this.skillValidationLastRefreshAt = Date.now();
          this.skillValidationDirty = false;
          this.clearValidationMatchCache();
          this.clearSkillUsageLogCache();
          return result;
      })();
      try {
        return await this.skillValidationRefreshPromise;
	      } catch (error) {
	        if (!silent) ElMessage.error(this.readApiError(error) || 'Skill 验证信息读取失败');
	        if (silent) throw error;
      } finally {
        if (!silent) this.loading.skillValidations = false;
        this.skillValidationRefreshPromise = null;
      }
    },

    async forceRefreshSkillValidations() {
      this.skillValidationDirty = true;
      await this.refreshSkillValidations({ force: true });
    },

    mergeSkillValidationRecordIntoState(record = {}) {
      if (!record || !record.id) return;
      if (this.isDistributedConfigValidationRecord(record)) return;
      const index = (this.skillValidationRows || []).findIndex(item => String(item.id || '') === String(record.id || ''));
      if (index >= 0) {
        this.skillValidationRows.splice(index, 1, record);
      } else {
        this.skillValidationRows.unshift(record);
      }
    },

    async ensureValidationMappingSources() {
      this.restoreWorkbenchDisplayCacheKey('aiMembersSnapshot');
      this.restoreWorkbenchDisplayCacheKey('aiAssetSheetRows');
    },

    openSkillValidationCreate() {
      this.skillValidationDialog = {
        visible: true,
        form: emptySkillValidationForm({
          submittedAt: formatSheetDate(new Date()),
          validator: this.isPlatformAdmin ? '' : this.currentAccountPrimaryPersonName,
          source: '工作台人工回填'
        })
      };
    },

    validationDisplayRecordForForm(row = {}) {
      const aiMatches = Array.isArray(row.matchedAiAssets) ? row.matchedAiAssets : this.aiAssetRowsForValidation(row);
      const memberMatches = Array.isArray(row.matchedMemberSkills) ? row.matchedMemberSkills : this.skillRowsForValidation(row);
      const mappedRow = {
        ...row,
        matchedAiAssets: aiMatches,
        matchedMemberSkills: memberMatches,
        matchedSkillCount: memberMatches.length || aiMatches.length
      };
      const displayOwner = this.validationDisplayOwnerName(mappedRow, memberMatches, aiMatches);
      const ownerText = displayOwner && displayOwner !== '-' ? displayOwner : row.owner;
      const validator = this.validationDisplayValidatorName(mappedRow) || row.validator || row.walkthroughOwner || '';
      const artifactName = this.validationDisplayArtifactName(mappedRow) || row.artifactName || row.scope || row.researchName || '';
      return {
        ...mappedRow,
        validator,
        owner: ownerText,
        ownerList: this.validationOwnerSelection(ownerText),
        artifactName,
        scope: artifactName || row.scope || row.researchName || '',
        submittedAt: row.submittedAt || formatSheetDate(new Date())
      };
    },

    openSkillValidationEdit(row = {}) {
      const displayRow = this.validationDisplayRecordForForm(row);
      this.skillValidationDialog = {
        visible: true,
        form: emptySkillValidationForm(displayRow)
      };
    },

    async backfillSkillValidation(row = {}) {
      if (!this.canBackfillSkillValidationDetailLogs) {
        ElMessage.warning('当前角色没有确认验证明细回填的权限');
        return;
      }
      if (!row.id) return;
      const displayRow = this.validationDisplayRecordForForm(row);
      const payload = {
        ...displayRow,
        owner: displayRow.owner || row.owner || '',
        ownerList: this.validationOwnerSelection(displayRow.owner || row.owner || ''),
        artifactName: displayRow.artifactName || row.artifactDisplayName || row.scope || row.researchName || '',
        scope: displayRow.scope || row.scope || row.artifactName || row.researchName || row.artifactDisplayName || '',
        source: row.source || '工作台确认回填',
        forceDisplayInValidation: true,
        manualBackfill: true
      };
      if (!payload.artifactName && !payload.researchName) {
        ElMessage.warning('这条明细缺少产物名称，无法回填到产物验证区');
        return;
      }
      this.loading.skillValidations = true;
      try {
        const result = await this.api('/api/skill-validations/backfill', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!Array.isArray(result.records)) {
          ElMessage.warning(result.error || result.message || '验证明细回填后未返回有效记录，已保留当前列表');
          return;
        }
        if (result.savedRecord?.id) this.mergeSkillValidationRecordIntoState(result.savedRecord);
        this.skillValidationRows = this.filterVisibleSkillValidationRecords(result.records);
        this.skillValidationMeta = result;
        this.clearValidationMatchCache();
        this.clearSkillUsageLogCache();
        this.skillValidationDetailPage = 1;
        ElMessage.success('已回填到产物验证区');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '验证明细回填失败');
      } finally {
        this.loading.skillValidations = false;
      }
    },

    closeSkillValidationDialog() {
      this.skillValidationDialog = {
        visible: false,
        form: emptySkillValidationForm()
      };
    },

    openSkillValidationDetailDrawer() {
      if (!this.canViewSkillValidationLogs) {
        ElMessage.warning('当前角色没有查看验证明细的权限');
        return;
      }
      this.skillValidationDetailDrawer = true;
      this.skillValidationDetailPage = 1;
    },

    async saveSkillValidation() {
      const form = this.skillValidationDialog.form;
      if (!String(form.artifactName || form.researchName || '').trim()) {
        ElMessage.warning('请填写研究项名称或产物文件名');
        return;
      }
      const payload = { ...form };
      const selectedOwners = Array.isArray(form.ownerList) ? form.ownerList : this.validationOwnerSelection(form.owner);
      payload.owner = this.displayPersonList(selectedOwners.join('、'));
      if (payload.owner === '-') payload.owner = '';
      if (!this.canManageSkillValidationOwner) {
        const original = this.skillValidationRows.find(row => row.id === payload.id);
        payload.owner = original?.owner || form.owner || '';
        payload.ownerList = this.validationOwnerSelection(payload.owner);
        payload.manualOwnerOverride = original?.manualOwnerOverride === true;
      } else {
        const displayOwner = this.displayPersonList(payload.owner || '');
        payload.owner = displayOwner === '-' ? '' : displayOwner;
        payload.ownerList = this.validationOwnerSelection(payload.owner);
        payload.manualOwnerOverride = Boolean(payload.owner);
      }
      form.submittedAt = formatSheetDate(new Date());
      payload.submittedAt = form.submittedAt;
      this.loading.skillValidations = true;
      try {
        const result = await this.api('/api/skill-validations', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!Array.isArray(result.records)) {
          ElMessage.warning(result.error || result.message || '验证回填保存后未返回有效记录，已保留当前列表');
          return;
        }
        this.skillValidationRows = this.filterVisibleSkillValidationRecords(result.records);
        this.skillValidationMeta = result;
        this.clearValidationMatchCache();
        this.clearSkillUsageLogCache();
        this.refreshUsageCounters();
        this.closeSkillValidationDialog();
        ElMessage.success('验证回填已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '验证回填保存失败');
      } finally {
        this.loading.skillValidations = false;
      }
    },

    async deleteSkillValidation(row = {}) {
      if (!row.id) return;
      await ElMessageBox.confirm(`确认删除「${row.artifactName || row.researchName || row.scope || row.id}」这条验证回填？删除只影响工作台展示，不会修改 Google 表源数据。`, '删除验证回填', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      });
      this.loading.skillValidations = true;
      try {
        const result = await this.api(`/api/skill-validations/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        if (!Array.isArray(result.records)) {
          ElMessage.warning(result.error || result.message || '验证回填删除后未返回有效记录，已保留当前列表');
          return;
        }
        this.skillValidationRows = this.filterVisibleSkillValidationRecords(result.records);
        this.skillValidationMeta = result;
        this.clearValidationMatchCache();
        this.clearSkillUsageLogCache();
        this.refreshUsageCounters();
        ElMessage.success('验证回填已删除');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '验证回填删除失败');
      } finally {
        this.loading.skillValidations = false;
      }
    },


    canEditAiAsset(row = {}) {
      return this.canCreateSkillInventoryAsset;
    },

    canRestoreAiAsset(row = {}) {
      return this.canCreateSkillInventoryAsset;
    },

    shouldValidateAiAsset(row = {}) {
      const text = `${row.progressStatus || ''} ${row.finalPath || ''} ${row.fileLink || ''} ${row.skillPath || ''} ${row.publicStatus || ''}`;
      if (/不继续|不继续，现有东西可以复用|不适用|不用验证/.test(text)) return false;
      return /待其他人验证结果|准备研究|进行|已公用|是|skill|md|\\|\/|http/i.test(text);
    },

    openAiAssetView(row = {}) {
      this.aiAssetDialog = {
        visible: true,
        readonly: true,
        mode: 'asset',
        form: emptyAiAssetForm(row)
      };
    },

    openAiAssetEdit(row = {}) {
      if (!this.canEditAiAsset(row)) {
        ElMessage.warning('当前账号没有权限修改人工研究记录。');
        return;
      }
      this.aiAssetDialog = {
        visible: true,
        readonly: false,
        mode: 'asset',
        form: emptyAiAssetForm(row)
      };
    },

    closeAiAssetDialog() {
      this.aiAssetDialog = { visible: false, readonly: false, mode: 'asset', form: emptyAiAssetForm() };
    },

    async saveAiAsset() {
      const form = this.aiAssetDialog.form;
      if (!String(form.title || '').trim()) {
        ElMessage.warning('请填写资产名称。');
        return;
      }
      const payload = { ...form };
      if (Array.isArray(payload.owner)) {
        payload.owner = payload.owner.join('、');
      }
      if (this.aiAssetDialog.mode === 'manualSkill') {
        payload.progressStatus = payload.progressStatus || '待验证';
        payload.publicStatus = payload.publicStatus || '否';
        payload.skillPath = payload.skillPath || payload.finalPath || '';
        payload.fileLink = payload.fileLink || payload.finalPath || '';
        payload.templateNote = payload.templateNote || '手动创建';
      }
      if (!this.canManageSkillAssetOwner) {
        const original = this.aiAssetSheetRows.find(row => row.id === payload.id);
        payload.owner = original?.owner || payload.owner || '';
      }
      this.loading.aiAssetSheet = true;
      try {
        const isManualSkill = this.aiAssetDialog.mode === 'manualSkill';
        const result = await this.api('/api/ai-asset-sheet/rows', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        this.aiAssetSheetRows = result.rows || [];
        this.aiAssetSheetMeta = result;
        this.closeAiAssetDialog();
        ElMessage.success(isManualSkill ? '技能已保存' : '人工研究记录已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '人工研究记录保存失败');
      } finally {
        this.loading.aiAssetSheet = false;
      }
    },

    async deleteAiAsset(row = {}) {
      if (!this.canEditAiAsset(row)) {
        ElMessage.warning('当前账号没有权限隐藏人工研究记录。');
        return;
      }
      const confirmed = await ElMessageBox.confirm(`确认从人工研究清单隐藏「${row.title || row.id}」？不会删除 Google 表源数据。`, '隐藏人工研究记录', {
        confirmButtonText: '隐藏',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }).then(() => true).catch(() => false);
      if (!confirmed) return;
      this.loading.aiAssetSheet = true;
      try {
        const result = await this.api(`/api/ai-asset-sheet/rows/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        this.aiAssetSheetRows = result.rows || [];
        this.aiAssetSheetMeta = result;
        ElMessage.success('已隐藏该人工研究记录');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '人工研究记录隐藏失败');
      } finally {
        this.loading.aiAssetSheet = false;
      }
    },

    async restoreAiAsset(row = {}) {
      if (!this.canRestoreAiAsset(row)) {
        ElMessage.warning('当前账号没有权限恢复人工研究记录。');
        return;
      }
      this.loading.aiAssetSheet = true;
      try {
        const result = await this.api(`/api/ai-asset-sheet/rows/${encodeURIComponent(row.id)}/restore`, { method: 'POST' });
        this.aiAssetSheetRows = result.rows || [];
        this.aiAssetSheetMeta = result;
        ElMessage.success('人工研究记录已恢复');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '人工研究记录恢复失败');
      } finally {
        this.loading.aiAssetSheet = false;
      }
    },

    async toggleAiAssetHiddenView() {
      this.aiAssetShowHidden = !this.aiAssetShowHidden;
      this.aiAssetPage = 1;
      await this.refreshAiAssetSheet();
    },

    openAiAssetValidation(row = {}) {
      this.skillInventoryTab = 'validations';
      this.skillValidationDialog = {
        visible: true,
        form: emptySkillValidationForm({
          submittedAt: formatSheetDate(new Date()),
          validator: this.isPlatformAdmin ? '' : this.currentAccountPrimaryPersonName,
          owner: row.owner || row.flowOwner || '',
          sourceRef: `AI 产物清单 ${row.rowNumber ? `#${row.rowNumber}` : row.id}`,
          researchName: row.title || '',
          artifactType: row.skillPath ? 'Skill' : 'AI 产物',
          artifactName: row.title || '',
          artifactLocation: row.finalPath || row.skillPath || row.fileLink || '',
          workflowScene: row.projectName || row.suites || '',
          evidenceLink: /^https?:\/\//i.test(row.fileLink || '') ? row.fileLink : '',
          validationResult: '',
          notes: [row.progressStatus, row.dailyNote, row.description].filter(Boolean).join('；'),
          source: 'AI 产物清单'
        })
      };
    },

    openSkillInventoryValidation(row = {}) {
      this.skillInventoryTab = 'validations';
      this.skillValidationDialog = {
        visible: true,
        form: emptySkillValidationForm({
          submittedAt: formatSheetDate(new Date()),
          validator: this.isPlatformAdmin ? '' : this.currentAccountPrimaryPersonName,
          owner: row.uploader || '',
          sourceRef: row.relativePath || row.path || row.id || '',
          researchName: row.title || row.id || '',
          artifactType: row.skillInventoryKind === 'document' ? '文档' : 'Skill',
          artifactName: row.title || row.id || '',
          artifactLocation: row.relativePath || row.path || '',
          workflowScene: row.category || '',
          source: '技能清单'
        })
      };
    },

    async refreshAiAssetSheet() {
      this.loading.aiAssetSheet = true;
      try {
        const query = this.aiAssetShowHidden ? '?includeDeleted=1' : '';
        const result = await this.api(`/api/ai-asset-sheet${query}`);
        if (!Array.isArray(result.rows)) {
          ElMessage.warning(result.error || result.message || '人工研究清单接口未返回有效记录，已保留当前列表');
          return;
        }
        this.aiAssetSheetRows = result.rows;
        this.aiAssetSheetMeta = result;
        this.clearValidationMatchCache();
        this.saveWorkbenchDisplayCache('aiAssetSheetRows', this.aiAssetSheetRows);
      } catch (error) {
        this.restoreWorkbenchDisplayCacheKey('aiAssetSheetRows');
        ElMessage.error(this.readApiError(error) || '人工研究清单读取失败');
      } finally {
        this.loading.aiAssetSheet = false;
      }
    },

    aiAssetRowStatusType(row = {}) {
      const text = `${row.progressStatus || ''} ${row.verifyStatus || ''}`;
      if (/完成|已验证|可用|进行/.test(text)) return 'success';
      if (/待|验证|研究|准备/.test(text)) return 'warning';
      if (/不继续|停|不用|否/.test(text)) return 'info';
      return 'info';
    },


    isAiAssetColumnVisible(key) {
      return this.effectiveAiAssetVisibleColumns().includes(key);
    },

    setAiAssetColumnVisible(key, checked) {
      const next = new Set(this.effectiveAiAssetVisibleColumns());
      if (checked) next.add(key);
      else next.delete(key);
      this.aiAssetVisibleColumns = this.defaultAiAssetColumnKeys().filter(keyName => next.has(keyName));
    },

    aiAssetPathHref(value) {
      const text = String(value || '').trim();
      if (!text) return '';
      if (/^https?:\/\//i.test(text)) return text;
      if (/^\\/.test(text)) return `file:${text.replace(/\\/g, '/')}`;
      if (/^\/\//.test(text)) return `file:${text}`;
      if (/^[A-Za-z]:\\/.test(text)) return `file:///${text.replace(/\\/g, '/')}`;
      return '';
    },
    async refreshArtProgressEvents(options = {}) {
      const silent = options.silent === true;
      if (!silent) this.loading.artProgressEvents = true;
      try {
        const [summary, events] = await Promise.all([
          this.api('/api/art-progress-events/summary'),
          this.api(this.canViewArtProgressOperationLog ? '/api/art-progress-events?scope=log' : '/api/art-progress-events')
        ]);
        this.artProgressSummary = summary || null;
        if (!Array.isArray(events)) {
          const message = 'AI 研究同步接口未返回有效记录，已保留当前列表';
          if (!silent) ElMessage.warning(message);
          if (silent) throw new Error(message);
          return;
        }
        this.artProgressEvents = events;
        this.clearSkillUsageLogCache();
        this.saveWorkbenchDisplayCache('artProgressSummary', this.artProgressSummary);
        this.saveWorkbenchDisplayCache('artProgressEvents', this.artProgressEvents);
        this.artProgressPage = 1;
        this.artProgressLogPage = 1;
        if (this.canViewArtProgressAccessLogs) await this.refreshArtProgressLifecycleLogs();
      } catch (error) {
        this.restoreWorkbenchDisplayCacheKey('artProgressSummary');
        if (!silent) ElMessage.error(this.readApiError(error) || 'AI 研究同步读取失败');
        if (silent) throw error;
      } finally {
        if (!silent) this.loading.artProgressEvents = false;
      }
    },

    mergeArtProgressEventIntoState(event = {}) {
      if (!event || !event.id) return;
      const index = (this.artProgressEvents || []).findIndex(item => String(item.id || '') === String(event.id || ''));
      if (index >= 0) {
        this.artProgressEvents.splice(index, 1, event);
      } else {
        this.artProgressEvents.unshift(event);
      }
      this.artProgressEvents = [...this.artProgressEvents].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      this.clearSkillUsageLogCache();
    },



    async refreshArtProgressOperationLogs() {
      if (!this.canViewArtProgressOperationRecords) {
        this.artProgressOperationLogRows = [];
        return;
      }
      try {
        const result = await this.api('/api/operation-logs?module=art-progress&includeArtProgress=1&pageSize=200');
        const rows = Array.isArray(result) ? result : (result?.rows || result?.items || []);
        this.artProgressOperationLogRows = rows.filter(log => isResearchArtProgressOperationLogRecord(log));
        this.clearSkillUsageLogCache();
      } catch (error) {
        console.warn('研究同步操作日志读取失败，已保留当前列表', error);
      }
    },

    async refreshTaskArtBriefUsageLogs() {
      if (!this.canViewSkillUsageLogs) {
        this.taskArtBriefUsageLogs = [];
        return;
      }
      try {
        const result = await this.api('/api/skill-usage/task-art-brief?pageSize=200');
        const rows = Array.isArray(result) ? result : (result?.rows || result?.items || []);
        this.taskArtBriefUsageLogs = rows.filter(log => this.isTaskArtBriefUsageLog(log));
        this.clearSkillUsageLogCache();
      } catch (error) {
        console.warn('美术摘要使用日志读取失败，已保留当前列表', error);
      }
    },

    async refreshArtProgressLifecycleLogs() {
      if (!this.canViewArtProgressAccessLogs) {
        this.artProgressLifecycleLogRows = [];
        return;
      }
      try {
        const events = await this.api('/api/art-progress-events/lifecycle');
        this.artProgressLifecycleLogRows = Array.isArray(events) ? events : [];
      } catch (error) {
        this.artProgressLifecycleLogRows = [];
      }
    },

    async openArtProgressLogDrawer() {
      if (!this.canViewArtProgressOperationLog) {
        ElMessage.warning('当前角色没有查看操作日志的权限');
        return;
      }
      this.artProgressLogType = this.canViewArtProgressOperationRecords ? 'operation' : 'lifecycle';
      this.artProgressLogPage = 1;
      this.artProgressLogMemberFilter = '';
      await Promise.all([this.refreshArtProgressOperationLogs(), this.refreshArtProgressLifecycleLogs()]);
      if (!this.artProgressLogTypeOptions.some(option => option.value === this.artProgressLogType)) {
        this.artProgressLogType = this.artProgressLogTypeOptions[0]?.value || 'operation';
      }
      this.artProgressLogDialog = true;
    },

    openArtProgressEventEdit(row = {}) {
      this.artProgressDialog = {
        visible: true,
        form: emptyArtProgressEventForm(row)
      };
    },

    closeArtProgressEventDialog() {
      this.artProgressDialog = {
        visible: false,
        form: emptyArtProgressEventForm()
      };
    },

    openArtProgressDetail(scope = 'event', row = {}) {
      const events = this.resolveArtProgressDetailEvents(scope, row);
      const title = this.buildArtProgressDetailTitle(scope, row);
      const primary = events[0] || row || {};
      this.artProgressDetailDialog = {
        ...emptyArtProgressDetailDialog(),
        visible: true,
        title: `${title} 内容预览`,
        headTitle: title,
        path: this.buildArtProgressDetailPath(scope, row, events),
        description: this.buildArtProgressDetailSubtitle(scope, row, events),
        tags: this.buildArtProgressDetailTags(scope, primary, events),
        meta: this.buildArtProgressDetailMeta(primary, events),
        triggers: this.buildArtProgressDetailTriggers(scope, row, events),
        rows: events,
        outline: this.buildArtProgressDetailOutline(events)
      };
    },

    closeArtProgressDetailDialog() {
      this.artProgressDetailDialog = emptyArtProgressDetailDialog();
    },

    resolveArtProgressDetailEvents(scope = 'event', row = {}) {
      if (Array.isArray(row.events) && row.events.length) return row.events.map(event => decorateArtProgressEventRecord(event));
      if (scope === 'log') return row.id ? [row] : [];
      const events = this.researchArtProgressEvents.map(event => decorateArtProgressEventRecord(event));
      if (scope === 'member') {
        const member = normalizeArtMemberNameRecord(row.label || row.displayMemberName || '');
        return events.filter(event => event.displayMemberName === member);
      }
      if (scope === 'skill') {
        const label = normalizeArtProgressTextRecord(row.label || row.displaySkillName || '');
        return events.filter(event => normalizeArtProgressTextRecord(event.displaySkillName || event.skillName || event.skillId || event.stage || '-') === label);
      }
      return row.id ? [decorateArtProgressEventRecord(row)] : [];
    },

    buildArtProgressDetailTitle(scope = 'event', row = {}) {
      if (scope === 'member') return `${normalizeArtMemberNameRecord(row.label || row.displayMemberName || '-')}的研究内容`;
      if (scope === 'skill') return row.label || row.displaySkillName || '工具与 Skill 内容';
      if (scope === 'log') return row.displaySkillName || row.skillName || row.title || '操作日志';
      return row.displaySkillName || row.skillName || row.title || '研究内容';
    },

    buildArtProgressDetailSubtitle(scope = 'event', row = {}, events = []) {
      if (scope === 'member') return `共 ${events.length} 条有进度的研究事项，当前只展示该成员相关内容。`;
      if (scope === 'skill') return `共 ${events.length} 条相关记录，内容来自成员使用 Codex 过程中的同步回写。`;
      if (scope === 'log') return [row.displayStage || row.stage, row.displayMemberName || row.memberName, row.displayProjectName || row.projectName].filter(Boolean).join(' · ') || '成员各自电脑 Codex 使用的操作上报明细。';
      return [row.displayStage || row.stage, row.displayMemberName || row.memberName, row.displayProjectName || row.projectName].filter(Boolean).join(' · ') || '成员使用和研究过程同步记录。';
    },

    buildArtProgressDetailPath(scope = 'event', row = {}, events = []) {
      const primary = events[0] || row || {};
      if (scope === 'log') return '操作日志 / Codex 操作记录';
      const parts = [];
      if (primary.repoPath) parts.push(primary.repoPath);
      if (primary.displayProjectName || primary.projectName) parts.push(primary.displayProjectName || primary.projectName);
      if (primary.zentaoTaskId || primary.taskNo) parts.push(`禅道任务 ${primary.zentaoTaskId || primary.taskNo}`);
      if (scope === 'member') parts.unshift('研究同步 / 成员记录');
      if (scope === 'skill') parts.unshift('研究同步 / 工具与 Skill');
      return parts.filter(Boolean).join(' / ') || '研究同步记录';
    },

    buildArtProgressDetailTags(scope = 'event', row = {}, events = []) {
      const tags = [];
      const push = value => {
        const text = normalizeArtProgressTextRecord(value || '');
        if (text && text !== '-' && !tags.includes(text)) tags.push(text);
      };
      push(scope === 'member' ? '成员研究' : scope === 'skill' ? '工具与 Skill' : scope === 'log' ? '操作日志' : this.artProgressEventTypeLabel(row.eventType));
      push(row.displayMemberName || row.memberName);
      push(row.displayStage || row.stage);
      if (events.length > 1) push(`${events.length} 条记录`);
      return tags.slice(0, 4);
    },

    buildArtProgressDetailMeta(row = {}, events = []) {
      const primary = row || {};
      const meta = [];
      const contributor = primary.displayMemberName || primary.memberName;
      if (contributor) meta.push({ label: '贡献人', value: contributor });
      const createdAt = primary.createdAt ? this.formatDateTime(primary.createdAt) : '';
      if (createdAt) meta.push({ label: '提交', value: createdAt });
      meta.push({ label: '来源', value: row.logSource === 'operation-log' ? '操作日志' : '研究同步' });
      if (events.length > 1) meta.push({ label: '记录数', value: `${events.length} 条` });
      return meta;
    },

    buildArtProgressDetailTriggers(scope = 'event', row = {}, events = []) {
      const triggers = [];
      const push = value => {
        const text = normalizeArtProgressTextRecord(value || '');
        if (text && text !== '-' && !triggers.includes(text)) triggers.push(text);
      };
      for (const event of events.length ? events : [row]) {
        push(event.displaySkillName || event.skillName || event.skillId);
        push(event.displayProjectName || event.projectName);
        push(event.zentaoTaskId || event.taskNo);
      }
      push(scope === 'member' ? row.label || row.displayMemberName : 'Codex 同步');
      return triggers.slice(0, 8);
    },

    buildArtProgressDetailOutline(events = []) {
      const outline = [];
      const seen = new Set();
      for (const event of events) {
        const title = normalizeArtProgressTextRecord(event.displayStage || event.stage || event.displaySkillName || event.skillName || event.title || '研究事项');
        const summary = normalizeArtProgressTextRecord(event.displaySummary || event.summary || event.title || '');
        const key = `${title}::${summary}`;
        if (seen.has(key)) continue;
        seen.add(key);
        outline.push({ title, summary });
      }
      return outline;
    },

    async deleteArtProgressSkillGroup(row = {}) {
      if (!this.canManageArtProgress) {
        ElMessage.warning('当前角色没有删除研究同步记录的权限');
        return;
      }
      const events = this.resolveArtProgressDetailEvents('skill', row).filter(event => event.id);
      if (!events.length) {
        ElMessage.warning('当前工具 / Skill 没有可删除的研究同步记录');
        return;
      }
      await ElMessageBox.confirm(`确认删除「${row.label || '该工具 / Skill'}」下 ${events.length} 条研究同步记录？删除后会从工作台数据中移除，刷新后也不会恢复。`, '删除工具 / Skill 记录', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      });
      this.loading.artProgressEvents = true;
      try {
        for (const event of events) {
          await this.api(`/api/art-progress-events/${encodeURIComponent(event.id)}`, { method: 'DELETE' });
        }
        await this.refreshArtProgressEvents();
        this.closeArtProgressDetailDialog();
        ElMessage.success('工具 / Skill 记录已删除');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '工具 / Skill 记录删除失败');
      } finally {
        this.loading.artProgressEvents = false;
      }
    },

    async saveArtProgressEventEdit() {
      if (!this.canManageArtProgress) {
        ElMessage.warning('当前角色没有维护研究同步记录的权限');
        return;
      }
      const form = this.artProgressDialog.form;
      if (!form.id) return;
      if (!String(form.summary || form.title || form.stage || '').trim()) {
        ElMessage.warning('请填写研究主题或摘要');
        return;
      }
      this.loading.artProgressEvents = true;
      try {
        await this.api(`/api/art-progress-events/${encodeURIComponent(form.id)}`, {
          method: 'PUT',
          body: JSON.stringify(form)
        });
        this.closeArtProgressEventDialog();
        await this.refreshArtProgressEvents();
        ElMessage.success('研究同步已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '研究同步保存失败');
      } finally {
        this.loading.artProgressEvents = false;
      }
    },

    async deleteArtProgressEvent(row = {}) {
      if (!this.canManageArtProgress) {
        ElMessage.warning('当前角色没有删除研究同步记录的权限');
        return;
      }
      if (!row.id) return;
      await ElMessageBox.confirm(`确认删除「${row.title || row.stage || row.summary || row.id}」这条研究同步？删除只影响工作台展示，不会修改禅道或组员本机文件。`, '删除研究同步', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      });
      this.loading.artProgressEvents = true;
      try {
        await this.api(`/api/art-progress-events/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        await this.refreshArtProgressEvents();
        ElMessage.success('研究同步已删除');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '研究同步删除失败');
      } finally {
        this.loading.artProgressEvents = false;
      }
    },

    isArtProgressLogDisplayed(row = {}) {
      const sourceIds = [
        row.id,
        row.eventId
      ].map(value => String(value || '').trim()).filter(Boolean);
      if (!sourceIds.length) return false;
      return sourceIds.some(id => this.displayedArtProgressLogSourceIds.has(id))
        || this.researchArtProgressEvents.some(event => sourceIds.includes(String(event.id || '')));
    },

    artProgressLogSourceEvent(row = {}) {
      const eventId = String(row.eventId || (row.logSource === 'art-progress-event' ? row.id : '') || '').trim();
      if (!eventId) return null;
      return (this.artProgressEvents || []).find(event => String(event.id || '') === eventId) || null;
    },

    artProgressLogResearchPayload(row = {}, existingEvent = null) {
      const clean = value => this.normalizeArtProgressText(value || '');
      const sourceMetadata = existingEvent?.metadata && typeof existingEvent.metadata === 'object' ? existingEvent.metadata : {};
      const rowMetadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const skillName = clean(existingEvent?.skillName || row.displaySkillName || row.skillName || row.skillId || row.actionName || row.action || '操作日志同步记录');
      const stage = clean(existingEvent?.stage || row.displayStage || row.stage || row.actionName || row.action || '操作日志同步展示');
      const summary = clean(existingEvent?.summary || row.displaySummary || row.summary || row.description || row.title || skillName);
      const memberName = this.normalizeArtMemberName(row.displayMemberName || existingEvent?.memberName || row.memberName || row.displayName || row.username || '');
      const createdAt = existingEvent?.createdAt || row.createdAt || new Date().toISOString();
      return {
        eventType: existingEvent?.eventType || (row.eventType && !['REPORT_ART_PROGRESS', 'DELETE_ART_PROGRESS'].includes(row.eventType) ? row.eventType : 'research_progress'),
        title: clean(existingEvent?.title || row.title || skillName || stage || summary),
        memberAccount: existingEvent?.memberAccount || row.memberAccount || row.username || '',
        memberName,
        skillId: existingEvent?.skillId || row.skillId || row.displaySkillName || '',
        skillName,
        stage,
        status: existingEvent?.status || row.status || 'running',
        summary,
        repoPath: existingEvent?.repoPath || row.repoPath || '',
        projectName: clean(existingEvent?.projectName || row.displayProjectName || row.projectName || row.targetName || ''),
        zentaoTaskId: existingEvent?.zentaoTaskId || row.zentaoTaskId || row.taskNo || '',
        taskNo: existingEvent?.taskNo || row.taskNo || row.zentaoTaskId || '',
        createdAt,
        metadata: {
          ...sourceMetadata,
          ...rowMetadata,
          artProgressListVisible: true,
          skipValidationAutoBackfill: true,
          displaySource: 'operation-log-display',
          sourceLogId: row.id || '',
          sourceOperationLogId: row.logSource === 'operation-log' ? row.id || '' : '',
          originalEventId: existingEvent?.id || row.eventId || (row.logSource === 'art-progress-event' ? row.id || '' : ''),
          displayedAt: new Date().toISOString(),
          displayedBy: this.currentUser?.displayName || this.currentUser?.username || ''
        }
      };
    },

    async showArtProgressLogInResearchList(row = {}) {
      if (!this.canManageArtProgress) {
        ElMessage.warning('当前角色没有维护研究同步记录的权限');
        return;
      }
      if (!row?.id && !row?.eventId) return;
      if (this.isArtProgressLogDisplayed(row)) {
        ElMessage.info('该操作日志已在研究列表展示');
        return;
      }
      this.loading.artProgressEvents = true;
      try {
        const sourceEvent = this.artProgressLogSourceEvent(row);
        const payload = this.artProgressLogResearchPayload(row, sourceEvent);
        let savedEvent = null;
        if (sourceEvent?.id) {
          const result = await this.api(`/api/art-progress-events/${encodeURIComponent(sourceEvent.id)}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          savedEvent = result?.event || null;
        } else {
          const result = await this.api('/api/art-progress-events', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          savedEvent = result?.event || null;
        }
        if (savedEvent?.id) this.mergeArtProgressEventIntoState(savedEvent);
        await this.refreshArtProgressEvents();
        await this.refreshArtProgressOperationLogs();
        this.artProgressPage = 1;
        ElMessage.success('已展示到研究列表');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '操作日志展示失败');
      } finally {
        this.loading.artProgressEvents = false;
      }
    },

    async deleteArtProgressLogRow(row = {}) {
      if (!this.canManageArtProgressLogs) {
        ElMessage.warning('当前角色没有删除操作日志的权限');
        return;
      }
      if (!row.id) return;
      const isOperationLog = this.artProgressLogType === 'operation' && row.logSource !== 'art-progress-event';
      const title = row.displaySummary || row.displaySkillName || row.actionName || row.stage || row.summary || row.id;
      await ElMessageBox.confirm(`确认删除「${title}」这条${isOperationLog ? '操作日志' : '接入测试记录'}？删除后会从工作台数据中移除，刷新后也不会恢复。`, '删除操作日志', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      });
      try {
        const endpoint = isOperationLog ? '/api/operation-logs' : '/api/art-progress-events';
        await this.api(`${endpoint}/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        if (isOperationLog) {
          await this.refreshArtProgressOperationLogs();
          if (this.activeView === 'operation-logs') await this.refreshOperationLogs();
        } else {
          await this.refreshArtProgressLifecycleLogs();
          await this.refreshArtProgressEvents();
        }
        ElMessage.success('记录已删除');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '记录删除失败');
      }
    },

    artProgressEventTypeLabel(type = '') {
      return {
        task_started: '启动',
        task_progress: '进度',
        skill_called: '工具使用',
        task_blocked: '阻塞',
        task_completed: '完成',
        task_failed: '失败',
        research_started: '开始研究',
        research_progress: '研究过程',
        tool_used: '工具使用',
        research_finding: '研究发现',
        research_artifact: '产物沉淀',
        research_blocked: '待补材料',
        research_summary: '阶段总结',
        reporter_installed: '接入完成',
        reporter_test: '连接测试'
      }[type] || type || '进度';
    },

    truncateText(value = '', maxLength = 80) {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (text.length <= maxLength) return text;
      return text.slice(0, Math.max(0, maxLength - 1)) + '…';
    },

    normalizeArtProgressText(value = '') {
      const text = String(value || '').trim();
      const map = {
        'art-progress-reporter': '美术工作台研究沉淀同步',
        'install-test': '安装测试',
        'install-completed': '安装完成',
        'install-complete': '安装完成',
        'research-sync-install': '研究沉淀同步安装',
        'Art progress reporter install': '研究沉淀同步安装',
        'Research sync install test succeeded.': '研究沉淀同步测试成功。',
        'Art progress reporter test succeeded.': '研究沉淀同步测试成功。',
        'AI research': 'AI 研究',
        'Sync one AI research or tool usage note to art workbench.': '同步一次 AI 研究或工具使用经验到美术工作台。'
      };
      if (map[text]) return map[text];
      const installMatch = text.match(/^(.+?) completed research sync installation\.$/);
      if (installMatch) return `${installMatch[1]} 已完成研究沉淀同步安装。`;
      const reporterInstallMatch = text.match(/^(.+?) completed art progress reporter installation\.$/);
      if (reporterInstallMatch) return `${reporterInstallMatch[1]} 已完成研究沉淀同步安装。`;
      return text;
    },

    normalizeArtMemberName(value = '') {
      const text = String(value || '').trim();
      const aliases = {
        yejunbo: '叶君博',
        huangjianrong: '黄剑荣',
        fengshuqi: '冯淑琪',
        yushengwei: '余盛威',
        lilh: '李华玲',
        zhangzb: '张宗斌',
        lanhj: '兰韩界'
      };
      const lower = text.toLowerCase();
      for (const [key, name] of Object.entries(aliases)) {
        if (lower === key || lower.includes(key) || text.includes(name)) return name;
      }
      const chinese = text.match(/[\u4e00-\u9fa5]{2,4}/);
      return chinese ? chinese[0] : text;
    },

    artProgressStatusType(status = '', eventType = '') {
      if (status === 'failed' || eventType === 'task_failed') return 'danger';
      if (status === 'blocked' || eventType === 'task_blocked' || eventType === 'research_blocked') return 'warning';
      if (status === 'completed' || eventType === 'task_completed' || eventType === 'research_finding' || eventType === 'research_summary' || eventType === 'research_artifact') return 'success';
      return 'info';
    },

    async refreshAiMembers(options = {}) {
      const silent = options.silent === true;
      if (!silent) this.loading.aiMembers = true;
      try {
        const snapshot = await this.api('/api/ai-members');
        this.aiMembersSnapshot = this.mergeAiMembersSnapshotWithBoardCache(snapshot);
        this.saveAiMembersBoardHtmlSnapshot(this.aiMembersSnapshot);
        this.saveWorkbenchDisplayCache('aiMembersSnapshot', this.aiMembersSnapshot);
      } catch (error) {
        this.restoreAiMembersBoardHtmlSnapshot();
        if (!silent) ElMessage.error(this.readApiError(error) || 'AI 部门成员数据读取失败');
        if (silent) throw error;
      } finally {
        if (!silent) this.loading.aiMembers = false;
      }
    },

    ensureAiMemberScoreData() {
      this.restoreWorkbenchDisplayCacheKeyIfEmpty('projects');
      this.restoreWorkbenchDisplayCacheKeyIfEmpty('scans');
      this.restoreWorkbenchDisplayCacheKeyIfEmpty('artProgressEvents');
      this.restoreWorkbenchDisplayCacheKeyIfEmpty('skillValidationRows');
      this.restoreWorkbenchDisplayCacheKeyIfEmpty('runs');
      this.restoreWorkbenchDisplayCacheKeyIfEmpty('aiAssetSheetRows');
      this.restoreWorkbenchDisplayCacheKeyIfEmpty('usageCounters');
    },

    aiScoreMonthKey(value = new Date()) {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    },

    isAiScoreMonthTime(value = '') {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return false;
      return this.aiScoreMonthKey(date) === this.aiScoreMonthLabel;
    },

    normalizeAiScorePersonKey(value = '') {
      return normalizePersonName(this.canonicalArtDeptPerson(value) || value);
    },

    dedupeAiScoreMembers(members = []) {
      const map = new Map();
      for (const member of Array.isArray(members) ? members : []) {
        const name = this.canonicalArtDeptPerson(member.name || member.realname || member.account) || member.name || member.realname || member.account || '';
        const key = this.normalizeAiScorePersonKey(name || member.account);
        if (!key) continue;
        const existing = map.get(key) || {};
        map.set(key, {
          ...member,
          ...existing,
          name: existing.name || name,
          account: existing.account || member.account || '',
          level: existing.level || member.level || '',
          status: existing.status || member.status || ''
        });
      }
      return [...map.values()];
    },

    aiScoreExcludedOwnerKeys() {
      const members = Array.isArray(this.aiMembersSnapshot?.members) ? this.aiMembersSnapshot.members : [];
      const ownerValues = [
        this.defaultSkillInventoryOwnerName(),
        ...members
          .filter(member => member.role === 'owner' || member.isOwner === true)
          .flatMap(member => [member.name, member.realname, member.account])
      ];
      if (!ownerValues.some(value => samePerson(value, '张倩文') || samePerson(value, 'zhangqw'))) {
        ownerValues.push('张倩文', 'zhangqw');
      }
      return new Set(ownerValues.map(value => this.normalizeAiScorePersonKey(value)).filter(Boolean));
    },

    isAiScoreOwnerMember(member = {}) {
      const excluded = this.aiScoreExcludedOwnerKeys();
      const values = [member.name, member.realname, member.account];
      return values.some(value => excluded.has(this.normalizeAiScorePersonKey(value)));
    },

    isIndependentAiScoreMember(memberName = '', account = '') {
      return [memberName, account].some(value => samePerson(value, '余盛威') || samePerson(value, 'yushengwei') || samePerson(value, 'ysw'));
    },

    prepareAiMembersView() {
      this.aiMembersViewMounted = true;
      this.aiMembersBoardFrameReady = false;
      this.cancelAiMembersDeferredWork();
      if (Array.isArray(this.aiMemberScoreRowsSnapshot) && this.aiMemberScoreRowsSnapshot.length) {
        this.aiMemberScoreReady = true;
      } else {
        this.restoreAiMemberScoreSnapshot();
        this.aiMemberScoreReady = Array.isArray(this.aiMemberScoreRowsSnapshot) && this.aiMemberScoreRowsSnapshot.length;
      }
      if (this.workbenchStateRestoring) return;
      this.aiMembersBoardFrameReadyTimer = setTimeout(() => {
        if (this.activeView !== 'ai-members') return;
        this.aiMembersBoardFrameReady = true;
        this.aiMembersBoardFrameReadyTimer = 0;
      }, 80);
    },

    cancelAiMembersDeferredWork() {
      if (this.aiMembersBoardFrameReadyTimer) {
        clearTimeout(this.aiMembersBoardFrameReadyTimer);
        this.aiMembersBoardFrameReadyTimer = 0;
      }
    },

    currentAiMemberScoreSourceMembers() {
      const snapshotMembers = Array.isArray(this.aiMembersSnapshot?.members) ? this.aiMembersSnapshot.members : [];
      const fallbackMembers = DEFAULT_ART_DEPT_PEOPLE.map(person => ({
        name: person.realname,
        account: person.account,
        level: '',
        status: ''
      }));
      return this.dedupeAiScoreMembers([...snapshotMembers, ...fallbackMembers]);
    },

    computeAiMemberScoreRows() {
      const sourceMembers = this.currentAiMemberScoreSourceMembers();
      const cacheKey = this.aiMemberScoreRowsCacheKey(sourceMembers);
      if (this._aiMemberScoreRowsCache?.key === cacheKey) return this._aiMemberScoreRowsCache.rows;
      const summaryMap = new Map(this.skillInventoryMemberSummaries.map(summary => [this.normalizeAiScorePersonKey(summary.name || summary.account), summary]));
      const rows = sourceMembers
        .filter(member => !this.isAiScoreOwnerMember(member))
        .map(member => this.aiMemberScoreRow(member, summaryMap.get(this.normalizeAiScorePersonKey(member.name || member.realname || member.account)) || null))
        .sort((a, b) => b.score - a.score || b.monthUsageCount - a.monthUsageCount || a.name.localeCompare(b.name));
      this._aiMemberScoreRowsCache = { key: cacheKey, rows };
      return rows;
    },

    async refreshAiMemberScoreSnapshotManually() {
      if (!this.canRefreshAiMemberScore) {
        ElMessage.warning('当前账号没有刷新 AI 评分的权限');
        return;
      }
      if (this.aiMemberScoreRefreshing) return;
      this.ensureAiMemberScoreData();
      this.aiMemberScoreRefreshing = true;
      try {
        await this.refreshAiMemberScoreDependenciesForManualRefresh();
        await new Promise(resolve => setTimeout(resolve, 0));
        this.clearAiMemberScoreCache();
        const sourceMembers = this.currentAiMemberScoreSourceMembers();
        const cacheKey = this.aiMemberScoreRowsCacheKey(sourceMembers);
        const rows = this.computeAiMemberScoreRows();
        if (!rows.length) {
          ElMessage.warning('暂无可计算的 AI 评分数据，已保留上次分值。');
          return;
        }
        this.saveAiMemberScoreSnapshot(rows, cacheKey);
        this.aiMemberScoreReady = true;
        ElMessage.success('AI 评分已按最新调用、产物、执行和验证数据刷新。');
      } catch (error) {
        this.restoreAiMemberScoreSnapshot();
        ElMessage.error(this.readApiError(error) || 'AI 评分刷新失败，已保留上次分值。');
      } finally {
        this.aiMemberScoreRefreshing = false;
      }
    },

    async refreshAiMemberScoreDependenciesForManualRefresh() {
      const jobs = [
        ['库存缓存', () => this.loadSkillInventorySavedSnapshot({ force: true, silent: true })],
        ['版本覆盖', () => this.refreshSkillVersionOverrides()],
        ['调用次数', () => this.refreshUsageCounters()],
        ['验证记录', () => this.refreshSkillValidations({ force: true, silent: true })],
        ['研究同步', () => this.refreshArtProgressEvents({ silent: true })],
        ['执行记录', () => this.refreshRuns()],
        ['成员快照', () => this.refreshAiMembers({ silent: true })]
      ];
      const results = await Promise.allSettled(jobs.map(([, run]) => run()));
      const failed = results
        .map((result, index) => ({ result, label: jobs[index][0] }))
        .filter(item => item.result.status === 'rejected')
        .map(item => item.label);
      if (failed.length) {
        console.warn(`AI 评分依赖刷新失败，已保留上次分值：${failed.join('、')}`);
        throw new Error(`AI 评分依赖刷新失败：${failed.join('、')}`);
      }
    },

    aiMemberScoreRowsCacheKey(sourceMembers = []) {
      const latestOf = (rows = [], fields = ['updatedAt', 'createdAt']) => (Array.isArray(rows) ? rows : [])
        .reduce((latest, row) => {
          const value = fields.map(field => row?.[field]).find(Boolean) || '';
          return String(value || '').localeCompare(String(latest || '')) > 0 ? value : latest;
        }, '');
      const snapshot = this.aiMembersSnapshot || {};
      const scanEntries = Object.entries(this.scans || {});
      const scanSkillCount = scanEntries.reduce((total, [, scan]) => total + (Array.isArray(scan?.skills) ? scan.skills.length : 0), 0);
      const scanLatest = scanEntries.reduce((latest, [, scan]) => {
        const value = scan?.scannedAt || scan?.updatedAt || scan?.sourceUpdatedAt || '';
        return String(value || '').localeCompare(String(latest || '')) > 0 ? value : latest;
      }, '');
      return [
        'ai-score-v5-product-value-and-single-line',
        this.aiScoreMonthLabel,
        sourceMembers.map(member => [member.name || member.realname || '', member.account || '', member.level || '', member.status || ''].join(':')).join('|'),
        snapshot.source?.boardUpdatedAt || '',
        this.projects.length,
        scanEntries.length,
        scanSkillCount,
        scanLatest,
        this.artProgressEvents.length,
        latestOf(this.artProgressEvents, ['updatedAt', 'createdAt', 'reportedAt']),
        this.artProgressOperationLogRows.length,
        latestOf(this.artProgressOperationLogRows, ['updatedAt', 'createdAt']),
        this.taskArtBriefUsageLogs.length,
        latestOf(this.taskArtBriefUsageLogs, ['updatedAt', 'createdAt']),
        this.skillValidationRows.length,
        latestOf(this.skillValidationRows, ['updatedAt', 'submittedAt', 'createdAt', 'importedAt']),
        this.runs.length,
        latestOf(this.runs, ['updatedAt', 'finishedAt', 'startedAt', 'createdAt']),
        this.aiAssetSheetRows.length,
        latestOf(this.aiAssetSheetRows, ['updatedAt', 'submittedAt', 'createdAt']),
        this.usageCounters?.updatedAt || '',
        Object.keys(this.usageCounters?.buckets || {}).length,
        Object.keys(this.skillOwnerOverrides || {}).length,
        Object.keys(this.skillDisplayNameOverrides || {}).length,
        Object.keys(this.skillAliasOverrides || {}).length,
        Object.keys(this.skillInventoryKindOverrides || {}).length
      ].join('::');
    },

    clearAiMemberScoreCache() {
      this._aiMemberScoreRowsCache = null;
    },

    aiMemberScoreRow(member = {}, summary = null) {
      const name = this.canonicalArtDeptPerson(member.name || member.realname || member.account) || member.name || member.realname || member.account || '-';
      const account = member.account || '';
      const independentScoreMode = this.isIndependentAiScoreMember(name, account);
      const productItems = this.aiMemberScoreProductItems(member, summary);
      const productRows = this.aiMemberScoreProductRows(name, summary);
      const monthUsageLogs = this.aiMemberScoreEffectiveUsageLogs(name, productRows);
      const monthUsageCount = monthUsageLogs.length;
      const monthValidations = independentScoreMode ? [] : this.aiMemberScoreValidationRows(name, productRows);
      const monthRuns = this.aiMemberScoreRunRows(name, account);
      const productValue = this.aiMemberScoreProductValue(productRows, productItems, independentScoreMode);
      const blockedSources = independentScoreMode
        ? [
          ...monthRuns.map(run => run.status),
          ...monthUsageLogs.map(log => `${log.type || ''} ${log.content || ''} ${log.summary || ''}`)
        ]
        : [
        ...monthRuns.map(run => run.status),
        ...monthUsageLogs.map(log => `${log.type || ''} ${log.content || ''} ${log.summary || ''}`),
        ...monthValidations.map(row => `${row.status || ''} ${row.validationResult || ''} ${row.notes || ''}`)
        ];
      const blockedCount = blockedSources.filter(text => /failed|blocked|失败|阻塞|不可用|不通过|返工/i.test(String(text || ''))).length;

      const productScore = productValue.score;
      const usedProductCount = this.aiMemberScoreUniqueProductKeyCount(monthUsageLogs.map(log => log.productKey || log.target).filter(Boolean));
      const validationProductCount = new Set(monthValidations.map(row => row.productKey || row.artifactKey || row.id).filter(Boolean)).size;
      const completedRunSkillCount = this.aiMemberScoreCompletedRunSkillKeys(monthRuns).size;
      const usageResultCount = this.aiMemberScoreUsageResultCount(monthUsageLogs);
      const usagePeopleCount = this.aiMemberScoreUsagePeopleCount(productRows);
      const usageCoverageRate = this.aiMemberScoreUsageCoverageRate(usagePeopleCount);
      const usageRatioBonus = Math.min(independentScoreMode ? 4 : 6, Math.round(usageCoverageRate / 20));
      const repeatedUsageBonus = Math.min(independentScoreMode ? 6 : 10, Math.max(0, usageResultCount - usedProductCount) * (independentScoreMode ? 1.5 : 2));
      const completedRunCount = monthRuns.length;
      const repeatedRunBonus = Math.min(independentScoreMode ? 3 : 5, Math.max(0, completedRunCount - completedRunSkillCount) * (independentScoreMode ? 1 : 1.5));
      const usageScore = independentScoreMode
        ? Math.min(20, usedProductCount * 4 + usageResultCount * 3 + repeatedUsageBonus + usageRatioBonus)
        : Math.min(30, usedProductCount * 4 + usageResultCount * 2 + repeatedUsageBonus + usageRatioBonus + validationProductCount * 3);
      const runScore = independentScoreMode
        ? Math.min(15, completedRunCount * 5 + completedRunSkillCount * 3 + repeatedRunBonus)
        : Math.min(15, completedRunCount * 2.5 + completedRunSkillCount * 3 + repeatedRunBonus);
      const penalty = Math.min(12, blockedCount * 3);
      const score = Math.max(0, Math.min(100, Math.round(productScore + usageScore + runScore - penalty)));
      return {
        name,
        account,
        level: member.level || '',
        status: member.status || '',
        score,
        productScore,
        usageScore,
        runScore,
        penalty,
        productCount: productItems.length,
        productValueScore: productValue.raw,
        productValueLevel: productValue.level,
        monthUsageCount,
        monthUsageResultCount: usageResultCount,
        monthUsagePeopleCount: usagePeopleCount,
        monthUsageCoverageRate: usageCoverageRate,
        monthValidationCount: monthValidations.length,
        monthRunCount: monthRuns.length,
        monthRunSkillCount: completedRunSkillCount,
        blockedCount,
        topProducts: productItems.slice(0, 3),
        latestActivityAt: [
          ...monthUsageLogs.map(log => log.time),
          ...monthValidations.map(row => row.submittedAt || row.updatedAt || row.createdAt),
          ...monthRuns.map(run => run.finishedAt || run.completedAt || run.startedAt || run.createdAt)
        ].filter(Boolean).sort().pop() || '',
        reason: independentScoreMode
          ? '独立产物口径：产物价值、个人使用和执行活跃综合计算'
          : '常规口径：按有效产物价值、闭环使用、互验去重和执行活跃综合计算'
      };
    },

    aiMemberScoreProductValue(productRows = [], productItems = [], independentScoreMode = false) {
      const cap = independentScoreMode ? 60 : 55;
      const rows = Array.isArray(productRows) ? productRows.filter(row => row && row.hidden !== true) : [];
      const rowValueTotal = rows
        .map(row => this.aiScoreProductRowValue(row).value)
        .reduce((sum, value) => sum + value, 0);
      const unmatchedCount = Math.max(0, (Array.isArray(productItems) ? productItems.length : 0) - rows.length);
      const fallbackValue = unmatchedCount * (independentScoreMode ? 4 : 3);
      const raw = Math.round((rowValueTotal + fallbackValue) * 10) / 10;
      return {
        raw,
        score: Math.min(cap, Math.round(raw)),
        level: raw >= cap * 0.8 ? '高价值' : raw >= cap * 0.45 ? '可复用' : '基础沉淀'
      };
    },

    aiScoreProductRowValue(row = {}) {
      const usage = this.skillInventoryUsageStatsForList(row);
      const quality = Number(this.skillQualityScore(row) ?? 0);
      const usageCount = Number(usage.count || row.usageCount || 0);
      const peopleCount = Number(usage.peopleCount || row.usagePeopleCount || 0);
      const usageRate = Number(usage.rate || row.usageRate || 0);
      const versionMajor = Number(this.skillInventoryVersionMajor(row));
      const isSkill = this.isSkillInventorySkillProduct(row);
      const isStandard = this.isSkillInventoryStandardProduct(row);
      const sceneText = this.skillSceneText(row, '');
      const fullTeamIntent = /全员|部门|通用|公共|统一|规范|标准|流程|复用|多人|批量|自动|工作流/i.test([
        row.productDisplayName,
        row.productFileName,
        row.title,
        sceneText,
        row.skill?.description,
        row.skill?.summary
      ].join('\n'));
      const base = isSkill ? 3.5 : isStandard ? 3 : 2.5;
      const qualityBonus = quality >= 85 ? 2.5 : quality >= 70 ? 1.5 : quality >= 55 ? 0.8 : 0;
      const peopleBonus = peopleCount >= 6 ? 6 : peopleCount >= 3 ? 3.5 : peopleCount >= 1 ? 1.4 : 0;
      const usageBonus = usageCount >= 20 ? 4 : usageCount >= 10 ? 3 : usageCount >= 3 ? 1.8 : usageCount >= 1 ? 0.8 : 0;
      const rateBonus = usageRate >= 85 ? 2 : usageRate >= 45 ? 1 : 0;
      const versionBonus = versionMajor >= 3 ? 3 : versionMajor >= 2 ? 1.5 : 0;
      const scopeBonus = fullTeamIntent ? 2 : 0;
      const riskMultiplier = this.aiScoreProductValueMultiplier(row, { usageCount, peopleCount, usageRate, fullTeamIntent });
      return {
        value: Math.max(0, Math.min(16, (base + qualityBonus + peopleBonus + usageBonus + rateBonus + versionBonus + scopeBonus) * riskMultiplier)),
        usageCount,
        peopleCount,
        quality,
        usageRate,
        versionMajor,
        riskMultiplier
      };
    },

    aiScoreProductValueMultiplier(row = {}, stats = {}) {
      if (row.hidden === true) return 0;
      const text = [
        row.productDisplayName,
        row.productFileName,
        row.title,
        this.skillSceneText(row, ''),
        row.skill?.description,
        row.skill?.summary,
        row.statusLabel
      ].map(value => String(value || '')).join('\n');
      const isDeprecated = /作废|废弃|不用|不再使用|已替代|被替代|淘汰/i.test(text);
      if (isDeprecated) return 0;
      const isNarrow = /专项|单人|个人|临时|一次性|仅.*项目|只.*项目|针对.*单|针对.*任务|复用率低|针对性不强/i.test(text);
      const lowReuse = Number(stats.peopleCount || 0) <= 1 && Number(stats.usageCount || 0) <= 2 && !stats.fullTeamIntent;
      if (isNarrow && lowReuse) return 0.45;
      if (isNarrow) return 0.65;
      if (lowReuse) return 0.75;
      return 1;
    },

    aiMemberScoreProductItems(member = {}, summary = null) {
      const boardItems = Array.isArray(summary?.purposes)
        ? summary.purposes
        : this.visibleAiBoardMemberProductItems(member);
      const inventoryItems = this.aiMemberScoreInventoryProductItems(member.name || member.realname || member.account || '', summary);
      return this.dedupeMemberProductItems([...boardItems, ...inventoryItems]);
    },

    aiMemberScoreInventoryProductItems(memberName = '', summary = null) {
      const rows = Array.isArray(summary?.inventoryRows) ? summary.inventoryRows : this.aiMemberScoreProductRows(memberName, summary);
      return this.dedupeMemberProductItems(
        rows
          .filter(row => row.hidden !== true)
          .map(row => this.skillInventoryRowProductName(row))
          .filter(Boolean)
      );
    },

    aiMemberScoreProductRows(memberName = '', summary = null) {
      const rows = Array.isArray(summary?.inventoryRows) ? summary.inventoryRows.filter(row => row.hidden !== true) : [];
      const directRows = this.skillInventoryAssetRows
        .filter(row => row.hidden !== true)
        .filter(row => this.isFinishedSkillInventoryRow(row))
        .filter(row => this.skillInventoryRowBelongsToMember(row, memberName, summary?.purposes || [], []));
      const map = new Map();
      [...rows, ...directRows].forEach(row => {
        const key = this.aiMemberScoreStableProductKeyForRow(row);
        if (key && !map.has(key)) map.set(key, row);
      });
      return [...map.values()];
    },

    aiMemberScoreStableProductKey(value = '') {
      const text = String(value || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/[?#].*$/, '')
        .replace(/\.(md|markdown)$/i, '');
      if (!text) return '';
      const parts = text
        .split('/')
        .map(part => String(part || '').trim())
        .filter(Boolean);
      const rawCandidates = parts.length ? parts : [text];
      const lastPart = rawCandidates[rawCandidates.length - 1] || '';
      const candidates = [];
      if (/^(skill|readme|index)$/i.test(lastPart.replace(/\.(md|markdown)$/i, '')) && rawCandidates.length > 1) {
        candidates.push(rawCandidates[rawCandidates.length - 2]);
      }
      candidates.push(lastPart, ...rawCandidates.slice(0, -1).reverse(), text);
      for (const candidate of candidates) {
        const key = String(candidate || '')
          .replace(/\.(md|markdown)$/i, '')
          .toLowerCase()
          .replace(/[\\/_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '');
        if (key && !this.isGenericUsageNeedle(key)) return key;
      }
      return '';
    },

    aiMemberScoreStableProductKeyForRow(row = {}) {
      const candidates = [
        row.relativePath,
        row.path,
        row.skill?.git?.relativePath,
        row.skill?.path,
        row.productFileName,
        row.productDisplayName,
        row.title,
        row.id
      ];
      for (const candidate of candidates) {
        const key = this.aiMemberScoreStableProductKey(candidate);
        if (key && key.length >= 4 && !this.isGenericUsageNeedle(key)) return key;
      }
      return '';
    },

    aiMemberScoreUniqueProductKeyCount(values = []) {
      const keys = new Set();
      (Array.isArray(values) ? values : []).forEach(value => {
        const key = this.aiMemberScoreStableProductKey(value);
        if (key && key.length >= 4 && !this.isGenericUsageNeedle(key)) keys.add(key);
      });
      return keys.size;
    },

    aiMemberScoreUsageResultCount(logs = []) {
      return (Array.isArray(logs) ? logs : []).filter(log => this.isAiScoreClosedLoopUsageLog(log)).length;
    },

    aiMemberScoreUsagePeopleCount(productRows = []) {
      const people = new Set();
      (Array.isArray(productRows) ? productRows : []).forEach(row => {
        this.skillEffectiveUsagePeople(row).forEach(person => {
          const name = this.canonicalArtDeptPerson(person) || person;
          if (name) people.add(name);
        });
      });
      return people.size;
    },

    aiMemberScoreUsageCoverageRate(peopleCount = 0) {
      const total = this.skillUsageCoveragePeople().length || 1;
      return Math.max(0, Math.min(100, Math.round((Number(peopleCount || 0) / total) * 100)));
    },

    aiMemberScoreUsageLogs(memberName = '', productRows = []) {
      const personKey = this.normalizeAiScorePersonKey(memberName);
      const logs = [];
      for (const row of productRows) {
        for (const log of this.skillUsageLogs(row)) {
          if (this.normalizeAiScorePersonKey(log.person) === personKey) {
            logs.push({
              ...log,
              productKey: this.aiMemberScoreStableProductKeyForRow(row) || this.skillInventoryProductNameKey(row) || this.skillInventoryRowProductName(row) || log.target || row.id || ''
            });
          }
        }
      }
      const seen = new Set();
      return logs.filter(log => {
        const key = log.id || `${log.time}:${log.target}:${log.summary}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },

    aiMemberScoreEffectiveUsageLogs(memberName = '', productRows = []) {
      const logs = this.aiMemberScoreUsageLogs(memberName, productRows)
        .filter(log => this.isAiScoreMonthTime(log.time))
        .filter(log => this.isAiScoreClosedLoopUsageLog(log));
      const seen = new Set();
      return logs.filter(log => {
        const productKey = String(log.productKey || log.target || '').trim();
        const taskKey = String(log.task || log.code || this.aiScoreMonthLabel || '').trim();
        const dayKey = String(log.time || '').slice(0, 10);
        const key = `${productKey}::${taskKey || dayKey}::${String(log.summary || '').trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },

    isAiScoreClosedLoopUsageLog(log = {}) {
      const text = [
        log.type,
        log.summary,
        log.content,
        log.matchReason,
        log.raw?.summary,
        log.raw?.title,
        log.raw?.status,
        log.raw?.validationResult,
        log.raw?.metadata?.result,
        log.raw?.metadata?.output,
        log.raw?.metadata?.artifactPath,
        log.raw?.metadata?.artifactLocation
      ].map(value => String(value || '')).join('\n');
      const hasUseSignal = /调用|使用|复用|验证|执行|实验|测试|figma|mcp|生成|写入|导出/i.test(text);
      const hasResultSignal = /已完成|完成|通过|失败|可用|不可用|结论|反馈|回馈|结果|输出|生成|写入|导出|发现问题|建议|适用|不适用/i.test(text);
      return hasUseSignal && hasResultSignal;
    },

    aiMemberScoreHistoricalUsageCount(memberName = '', productRows = []) {
      const personKey = this.normalizeAiScorePersonKey(memberName);
      if (!personKey) return 0;
      let count = 0;
      for (const row of productRows) {
        const historical = this.usageCounterStatsForRow(row);
        Object.entries(historical.people || {}).forEach(([person, personCount]) => {
          if (this.normalizeAiScorePersonKey(person) === personKey) {
            count += Number(personCount || 0);
          }
        });
      }
      return count;
    },

    aiMemberScoreValidationRows(memberName = '', productRows = []) {
      const personKey = this.normalizeAiScorePersonKey(memberName);
      const productOwnerKeysByProductKey = new Map();
      productRows.forEach(row => {
        const productKey = this.skillInventoryProductNameKey(row) || this.skillInventoryRowProductName(row) || row.id || '';
        if (!productKey) return;
        const ownerKeys = [
            ...this.canonicalPersonList(row.owner),
            ...this.canonicalPersonList(row.uploader),
            ...this.canonicalPersonList(row.flowOwner),
            ...this.canonicalPersonList(row.skill?.owner),
            ...this.canonicalPersonList(row.skill?.uploaderName),
            this.uploaderFromSource(row.source)
          ]
          .map(person => this.normalizeAiScorePersonKey(person))
          .filter(Boolean);
        productOwnerKeysByProductKey.set(productKey, new Set(ownerKeys));
      });
      const productKeyByValidationKey = new Map();
      productRows.forEach(row => {
        const key = this.skillInventoryProductNameKey(row) || this.skillInventoryRowProductName(row) || row.id || '';
        this.validationRowFileKeys(row).forEach(validationKey => {
          if (validationKey && key) productKeyByValidationKey.set(validationKey, key);
        });
      });
      const seen = new Set();
      return (this.skillValidationRows || [])
        .filter(row => this.isAiScoreMonthTime(row.submittedAt || row.updatedAt || row.createdAt || row.importedAt))
        .filter(row => {
          const people = [
            row.validator,
            row.walkthroughOwner,
            row.owner,
            row.memberName,
            row.memberAccount,
            row.updatedBy
          ];
          return people.some(person => this.normalizeAiScorePersonKey(person) === personKey);
        })
        .map(row => {
          const matchedKey = this.validationNameCandidatesFromRecord(row)
            .map(value => this.normalizeValidationMatchText(value))
            .find(key => productKeyByValidationKey.has(key));
          const productKey = productKeyByValidationKey.get(matchedKey) || this.skillValidationArtifactCountKey(row) || matchedKey || row.id || '';
          return { ...row, productKey, artifactKey: productKey };
        })
        .filter(row => {
          const owners = [
            ...this.canonicalPersonList(row.owner),
            ...this.canonicalPersonList(row.walkthroughOwner),
            ...this.validationOwnerListFromMemberProducts(row)
          ].map(person => this.normalizeAiScorePersonKey(person)).filter(Boolean);
          const rowOwnerKeys = productOwnerKeysByProductKey.get(row.productKey) || new Set();
          const verifiesOwnProduct = owners.includes(personKey) || rowOwnerKeys.has(personKey);
          return !verifiesOwnProduct;
        })
        .filter(row => {
          const key = `${personKey}::${row.productKey || row.artifactKey || row.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    },

    aiMemberScoreRunRows(memberName = '', account = '') {
      const personKey = this.normalizeAiScorePersonKey(memberName);
      const accountKey = this.normalizeAiScorePersonKey(account);
      return (this.runs || [])
        .filter(run => this.isAiScoreCompletedRun(run))
        .filter(run => this.isAiScoreMonthTime(run.finishedAt || run.completedAt || run.startedAt || run.createdAt))
        .filter(run => {
          const people = [
            run.developer,
            run.createdBy,
            run.startedBy,
            run.ownerUserId
          ];
          return people.some(person => {
            const key = this.normalizeAiScorePersonKey(person);
            return key && (key === personKey || key === accountKey);
          });
        });
    },

    isAiScoreCompletedRun(run = {}) {
      if (run.exitCode !== null && run.exitCode !== undefined && Number(run.exitCode) !== 0) return false;
      const statusText = [
        run.status,
        run.platformStatus,
        run.resultStatus,
        run.workerStatus,
        run.resultSummary?.status
      ].map(value => String(value || '').toLowerCase()).join(' ');
      if (/cancel|canceled|cancelled|failed|blocked|error|deleted|draft|pending|queued|running|in_progress|wait|失败|阻塞|取消|排队|待领取|执行中/.test(statusText)) return false;
      const effectiveStatus = this.effectiveResultStatus(run);
      const hasCompletedStatus = ['passed', 'conditional_pass', 'completed', 'success', 'done'].includes(effectiveStatus)
        || /done|success|passed|completed|finished|approved|conditional|完成|通过|成功|有条件/.test(statusText);
      const hasCompletionTime = Boolean(run.finishedAt || run.completedAt);
      const hasResultEvidence = Boolean(run.resultSummary || run.changeSummary || run.resultPath || run.completedAt || (run.logPath && hasCompletedStatus));
      return hasCompletedStatus && (hasCompletionTime || hasResultEvidence);
    },

    aiMemberScoreCompletedRunSkillKeys(runs = []) {
      const keys = new Set();
      (Array.isArray(runs) ? runs : []).forEach(run => {
        this.aiMemberScoreRunSkillKeys(run).forEach(key => {
          if (key) keys.add(key);
        });
      });
      return keys;
    },

    aiMemberScoreRunSkillKeys(run = {}) {
      const directValues = [
        run.primarySkillPath,
        run.skillPath,
        ...(Array.isArray(run.selectedMaterialHints) ? run.selectedMaterialHints : []),
        ...(Array.isArray(run.materials) ? run.materials.flatMap(item => [item.path, item.name, item.title]) : []),
        ...(Array.isArray(run.referenceItems) ? run.referenceItems.flatMap(item => [item.path, item.name, item.title]) : [])
      ];
      const looseValues = [
        run.stage,
        run.showdocHints,
        ...this.runChainReferenceItems(run, { includeSelectedLog: false })
          .flatMap(item => [item.path, item.repoPath, item.filePath, item.skillPath, item.artifactPath, item.name, item.title])
      ].filter(value => this.looksLikeRunSkillOrMdMaterial(value));
      const key = [...directValues, ...looseValues]
        .map(value => this.aiMemberScoreStableProductKey(value))
        .find(value => value && value.length >= 4 && !this.isGenericUsageNeedle(value));
      return key ? [key] : [];
    },

    aiScoreClass(score = 0) {
      if (score >= 85) return 'is-good';
      if (score >= 70) return 'is-stable';
      if (score >= 55) return 'is-watch';
      return 'is-low';
    },

    aiScoreLevelLabel(score = 0) {
      if (score >= 85) return '优秀';
      if (score >= 70) return '稳定';
      if (score >= 55) return '待提升';
      return '需关注';
    },

    async refreshRuns() {
      this.loading.runs = true;
      try {
        this.runs = await this.api('/api/runs');
        this.saveWorkbenchDisplayCache('runs', this.runs);
        if (this.selectedRunId && !this.runs.some(run => run.id === this.selectedRunId)) {
          this.selectedRunId = this.runs[0]?.id || '';
        }
        if (!this.selectedRunId && this.runs[0]) this.selectedRunId = this.runs[0].id;
        if (this.selectedRunId && this.isRunInProgress(this.selectedRun)) {
          window.setTimeout(() => {
            if (this.selectedRunId) this.loadSelectedRunLog().catch(() => {});
          }, 0);
        }
      } finally {
        this.loading.runs = false;
      }
    },

    async refreshAgentWorkers() {
      if (!this.can('api.agentWorkers.read')) return;
      this.loading.agentWorkers = true;
      try {
        this.agentWorkers = await this.api('/api/agent-workers');
      } catch (error) {
        console.warn('本机 Worker 状态读取失败', error);
      } finally {
        this.loading.agentWorkers = false;
      }
    },

    resetAiExecutionArchiveFilters() {
      this.aiExecutionArchiveFilters = {
        keyword: '',
        userId: '',
        status: '',
        archiveBucket: '',
        sourceType: '',
        runId: '',
        from: '',
        to: ''
      };
    },

    async deleteAiExecutionArchiveRunsByCurrentFilters() {
      if (!this.can('api.aiArchive.delete')) {
        ElMessage.warning('当前账号没有删除 AI档案明细的权限');
        return;
      }
      const filters = this.aiExecutionArchiveFilters || {};
      if (!filters.from || !filters.to) {
        ElMessage.warning('请选择要删除的开始时间和结束时间');
        return;
      }
      const count = this.aiExecutionArchiveRunRows.filter(run => !this.isRunInProgress(run)).length;
      if (!count) {
        ElMessage.warning('当前筛选范围没有可删除的执行明细');
        return;
      }
      await ElMessageBox.confirm(
        `确认删除当前筛选范围内 ${count} 条 AI 执行明细？后端执行记录、执行工作区和产物目录会一起清理，但 AI产物清单的累计调用次数不会回退。`,
        '删除 AI档案明细',
        {
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          type: 'warning',
          confirmButtonClass: 'el-button--danger'
        }
      );
      const query = new URLSearchParams();
      const allowedFilterKeys = new Set(['keyword', 'userId', 'status', 'sourceType', 'runId', 'from', 'to']);
      for (const [key, value] of Object.entries(filters)) {
        if (!allowedFilterKeys.has(key)) continue;
        if (String(value || '').trim()) query.set(key, String(value).trim());
      }
      this.loading.runs = true;
      try {
        const result = await this.api(`/api/runs?${query.toString()}`, { method: 'DELETE' });
        const ids = new Set(result.deletedIds || []);
        this.runs = this.runs.filter(run => !ids.has(run.id));
        if (this.selectedRunId && ids.has(this.selectedRunId)) this.selectedRunId = this.runs[0]?.id || null;
        ElMessage.success(`已删除 ${result.deletedCount || ids.size || 0} 条 AI 执行明细`);
      } finally {
        this.loading.runs = false;
      }
    },

    async refreshCustomWorkflows() {
      try {
        this.customWorkflows = await this.api('/api/custom-workflows');
        if (!this.workflowDesigner.name && this.customWorkflows[0]) this.loadCustomWorkflowToDesigner(this.customWorkflows[0]);
      } catch {
        this.customWorkflows = [];
      }
    },

    async refreshTaskReviews() {
      try {
        this.taskReviews = await this.api('/api/task-reviews');
      } catch {
        console.warn('任务验收记录读取失败，已保留当前列表');
      }
    },

    async refreshTaskProcessingNotes() {
      if (!this.can('menu.tasks')) {
        this.taskProcessingNotes = {};
        return;
      }
      try {
        const notes = await this.api('/api/task-processing-notes');
        this.taskProcessingNotes = Object.fromEntries((Array.isArray(notes) ? notes : []).map(note => [note.taskId, note]));
        this.saveWorkbenchDisplayCache('taskProcessingNotes', this.taskProcessingNotes);
      } catch {
        console.warn('任务处理记录读取失败，已保留当前列表');
      }
    },

    async refreshTasks() {
      this.loading.tasks = true;
      try {
        const [tasksResult, bugsResult, taskReviewsResult] = await Promise.allSettled([
          this.api('/api/tasks'),
          this.api('/api/bugs'),
          this.api('/api/task-reviews')
        ]);
        const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value : null;
        const bugs = bugsResult.status === 'fulfilled' ? bugsResult.value : null;
        const taskReviews = taskReviewsResult.status === 'fulfilled' ? taskReviewsResult.value : null;
        if (Array.isArray(tasks) && tasks.length) this.businessTasks = tasks;
        else if (Array.isArray(tasks)) {
          console.warn('任务接口返回空列表，已保留当前任务中心列表');
        }
        if (Array.isArray(bugs)) this.bugs = bugs;
        if (Array.isArray(taskReviews)) this.taskReviews = taskReviews;
        if (Array.isArray(tasks) && tasks.length) this.saveWorkbenchDisplayCache('businessTasks', this.businessTasks);
        if (Array.isArray(bugs)) this.saveWorkbenchDisplayCache('bugs', this.bugs);
        if (Array.isArray(taskReviews)) this.saveWorkbenchDisplayCache('taskReviews', this.taskReviews);
        [tasksResult, bugsResult, taskReviewsResult].forEach((result, index) => {
          if (result.status !== 'rejected') return;
          const label = ['任务列表', 'Bug 列表', '验收记录'][index];
          console.warn(`${label}读取失败，已保留当前列表`, result.reason);
        });
      } catch (error) {
        this.restoreWorkbenchDisplayCacheKey('businessTasks');
        this.restoreWorkbenchDisplayCacheKey('bugs');
        this.restoreWorkbenchDisplayCacheKey('taskReviews');
        console.warn('任务中心数据读取失败，已保留当前列表', error);
      } finally {
        this.loading.tasks = false;
      }
    },

    startTaskBriefRealtimeSync() {
      this.stopTaskBriefRealtimeSync();
      this.taskBriefRealtimeTimer = setInterval(() => {
        this.refreshTaskBriefRealtime();
      }, 5000);
    },

    stopTaskBriefRealtimeSync() {
      if (this.taskBriefRealtimeTimer) clearInterval(this.taskBriefRealtimeTimer);
      this.taskBriefRealtimeTimer = null;
      this.taskBriefRealtimeRunning = false;
    },

    async refreshTaskBriefRealtime() {
      if (!this.currentUser || this.taskBriefRealtimeRunning || document.visibilityState === 'hidden') return;
      if (this.effectiveTaskCenterMode !== 'task' || !this.selectedBusinessTaskId) return;
      const now = Date.now();
      if (now - this.taskBriefRealtimeLastAt < 4500) return;
      this.taskBriefRealtimeRunning = true;
      this.taskBriefRealtimeLastAt = now;
      try {
        await this.refreshSelectedBusinessTaskBrief();
      } catch {
      } finally {
        this.taskBriefRealtimeRunning = false;
      }
    },

    async refreshBugs() {
      try {
        const bugs = await this.api('/api/bugs');
        if (Array.isArray(bugs)) {
          this.bugs = bugs;
          this.saveWorkbenchDisplayCache('bugs', this.bugs);
        }
      } catch (error) {
        this.restoreWorkbenchDisplayCacheKey('bugs');
        console.warn('Bug 列表读取失败，已保留当前列表', error);
      }
    },

    async refreshAiFlowRecords() {
      try {
        const projectId = this.archiveFilters.projectId || '';
        const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
        const rows = await this.api(`/api/ai-flow-records${query}`);
        if (Array.isArray(rows)) this.aiFlowRecords = rows;
      } catch (error) {
        console.warn('AI 全流程人工记录读取失败，已保留当前列表', error);
      }
    },

    async refreshUsers() {
      if (!this.can('api.users.manage')) {
        if (!this.can('api.agentWorkers.read')) {
          this.users = [];
          return;
        }
        this.loading.users = true;
        try {
          this.users = await this.api('/api/agent-worker-users');
        } catch (error) {
          this.users = [];
          console.warn('Worker 账号列表读取失败，已仅保留当前账号和心跳上报数据', error);
        } finally {
          this.loading.users = false;
        }
        return;
      }
      this.loading.users = true;
      try {
        this.users = await this.api('/api/users');
      } catch (error) {
        this.users = [];
        ElMessage.error(this.readApiError(error) || '账号列表读取失败');
      } finally {
        this.loading.users = false;
      }
    },

    async refreshRoles() {
      if (!this.can('api.roles.manage')) {
        this.roles = [];
        this.permissionCatalog = [];
        return;
      }
      this.loading.roles = true;
      try {
        const [roles, permissions] = await Promise.all([
          this.api('/api/roles'),
          this.api('/api/permissions')
        ]);
        this.roles = roles;
        this.permissionCatalog = permissions;
      } finally {
        this.loading.roles = false;
      }
    },

    async refreshOperationLogs() {
      if (!this.can('api.operationLogs.read')) {
        this.operationLogs = [];
        this.operationLogTotal = 0;
        return;
      }
      this.loading.operationLogs = true;
      try {
        const params = new URLSearchParams();
        Object.entries(this.operationLogFilters).forEach(([key, value]) => {
          if (value !== '' && value !== null && value !== undefined) params.set(key, value);
        });
        params.set('page', String(this.operationLogPage));
        params.set('pageSize', String(this.operationLogPageSize));
        const query = params.toString();
        const result = await this.api(`/api/operation-logs${query ? `?${query}` : ''}`);
        this.operationLogs = Array.isArray(result.items) ? result.items : [];
        this.operationLogTotal = Number(result.total || 0);
        this.operationLogPage = Number(result.page || this.operationLogPage);
        this.operationLogPageSize = Number(result.pageSize || this.operationLogPageSize);
        this.saveWorkbenchDisplayCache('operationLogs', this.operationLogs);
      } finally {
        this.loading.operationLogs = false;
      }
    },

    async refreshUsageCounters() {
      if (!this.canViewSkillUsageLogs && !this.can('menu.skillList')) {
        this.usageCounters = null;
        return null;
      }
      try {
        const result = await this.api('/api/usage-counters');
        this.usageCounters = result && typeof result === 'object' ? result : null;
        this.clearSkillUsageLogCache();
        this.saveWorkbenchDisplayCache('usageCounters', this.usageCounters);
        return this.usageCounters;
      } catch {
        this.restoreWorkbenchDisplayCacheKey('usageCounters');
        return this.usageCounters;
      }
    },

    resetOperationLogFilters() {
      this.operationLogFilters = {
        userId: '',
        module: '',
        result: '',
        keyword: '',
        from: '',
        to: ''
      };
      this.operationLogPage = 1;
      this.refreshOperationLogs();
    },

    applyOperationLogFilters(options = {}) {
      this.operationLogPage = 1;
      if (this._operationLogFilterTimer) {
        clearTimeout(this._operationLogFilterTimer);
        this._operationLogFilterTimer = null;
      }
      const delay = options.debounce ? 300 : 0;
      this._operationLogFilterTimer = setTimeout(() => {
        this._operationLogFilterTimer = null;
        if (this.activeView === 'operation-logs') this.refreshOperationLogs();
      }, delay);
    },

    operationLogActiveDeleteFilters() {
      const filters = {};
      Object.entries(this.operationLogFilters || {}).forEach(([key, value]) => {
        const text = String(value ?? '').trim();
        if (text) filters[key] = text;
      });
      return filters;
    },

    async deleteOperationLogsByCurrentFilters() {
      if (!this.can('api.operationLogs.delete')) {
        ElMessage.warning('当前角色不能删除操作日志。');
        return;
      }
      const filters = this.operationLogActiveDeleteFilters();
      const hasFilters = Object.keys(filters).length > 0;
      const rangeText = hasFilters ? '当前筛选范围内' : '全部';
      const confirmed = await ElMessageBox.confirm(
        `确认删除${rangeText}操作日志？删除后会从后台数据中彻底移除，不再留存；已累计的 AI 产物调用次数不受影响。`,
        '删除操作日志',
        {
          confirmButtonText: hasFilters ? '删除当前范围' : '删除全部日志',
          cancelButtonText: '取消',
          type: 'warning',
          confirmButtonClass: 'el-button--danger'
        }
      ).then(() => true).catch(() => false);
      if (!confirmed) return;
      this.loading.operationLogs = true;
      try {
        const result = await this.api('/api/operation-logs', {
          method: 'DELETE',
          body: JSON.stringify({ filters })
        });
        this.operationLogPage = 1;
        await this.refreshOperationLogs();
        ElMessage.success(`已删除 ${Number(result.deletedCount || 0)} 条操作日志`);
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '操作日志删除失败');
      } finally {
        this.loading.operationLogs = false;
      }
    },

    openOperationLogDetail(row) {
      this.operationLogDetail = {
        visible: true,
        row
      };
    },

    handleOperationLogPageChange(page) {
      this.operationLogPage = page;
      this.refreshOperationLogs();
    },

    handleOperationLogPageSizeChange(size) {
      this.setWorkbenchPageSize(size, 'operationLogPage');
    },

    displayClientIp(value = '') {
      const ip = String(value || '').trim();
      if (!ip) return '-';
      if (ip === '::1') return '127.0.0.1';
      if (ip.startsWith('::ffff:')) return ip.slice(7);
      return ip;
    },

    uploaderFromSource(source = '') {
      const match = String(source || '').match(/^Git:(.+)$/i);
      return match ? (this.canonicalArtDeptPerson(match[1].trim()) || match[1].trim()) : '';
    },

    skillStatusLabel(skill = {}) {
      if (skill.statusLabel) return skill.statusLabel;
      if (skill.status === 'verified') return '已验证';
      if (skill.status === 'failed') return '验证失败';
      if (skill.status === 'draft') return '1.0 待验证';
      return skill.version ? `${skill.version} 待维护` : '待验证';
    },

    skillInventoryKind(skill = {}) {
      const override = this.skillInventoryKindOverrideFor(skill);
      if (override) return override;
      if (['skill', 'document', 'directory'].includes(skill.inventoryKind)) return skill.inventoryKind;
      const relativePath = String(skill.git?.relativePath || skill.path || '').replace(/\\/g, '/');
      const fileName = relativePath.split('/').pop() || '';
      const inSkillDir = relativePath.startsWith('skills/') || relativePath.startsWith('入口图/');
      const isReference = /(^|\/)(references|Design|skins|规范类|\.claude)(\/|$)/i.test(relativePath);
      return fileName === 'SKILL.md' && inSkillDir && !isReference ? 'skill' : 'document';
    },

    skillInventoryKindOverrideKeys(input = {}) {
      const skill = input.skill || {};
      const projectId = String(input.projectId || skill.projectId || '').trim();
      const keys = [
        input.git?.relativePath,
        skill.git?.relativePath,
        skill.relativePath,
        input.relativePath,
        input.key,
        skill.path,
        input.path,
        input.overrideKey,
        input.uid,
        skill.id,
        input.id
      ].map(value => String(value || '').trim()).filter(Boolean);
      const scopedKeys = projectId ? keys.map(key => `kind:${projectId}:${key}`) : [];
      return [...scopedKeys, ...keys];
    },

    skillInventoryKindOverrideFor(input = {}) {
      const overrides = this.skillInventoryKindOverrides || {};
      for (const key of this.skillInventoryKindOverrideKeys(input)) {
        const kind = String(overrides[key] || '').trim();
        if (['skill', 'document', 'directory'].includes(kind)) return kind;
      }
      return '';
    },

    skillOwnerOverrideKeys(input = {}) {
      const skill = input.skill || {};
      const projectId = String(input.projectId || skill.projectId || '').trim();
      const keys = [
        input.git?.relativePath,
        skill.git?.relativePath,
        skill.relativePath,
        input.relativePath,
        input.key,
        skill.path,
        input.path,
        input.overrideKey,
        input.uid,
        skill.id,
        input.id
      ].map(value => String(value || '').trim()).filter(Boolean);
      const scopedKeys = projectId ? keys.map(key => `owner:${projectId}:${key}`) : [];
      return [...scopedKeys, ...keys];
    },

    skillOwnerOverrideFor(input = {}) {
      for (const key of this.skillOwnerOverrideKeys(input)) {
        const owner = this.skillOwnerOverrides?.[key];
        if (owner) return owner;
      }
      return '';
    },

    skillDisplayNameOverrideKeys(input = {}) {
      const skill = input.skill || {};
      const projectId = String(input.projectId || skill.projectId || '').trim();
      const keys = [
        input.git?.relativePath,
        skill.git?.relativePath,
        skill.relativePath,
        input.relativePath,
        input.key,
        skill.path,
        input.path,
        input.overrideKey,
        input.uid,
        skill.id,
        input.id
      ].map(value => String(value || '').trim()).filter(Boolean);
      const scopedKeys = projectId ? keys.map(key => `name:${projectId}:${key}`) : [];
      return [...scopedKeys, ...keys];
    },

    skillDisplayNameOverrideFor(input = {}) {
      const overrides = this.skillDisplayNameOverrides || {};
      for (const key of this.skillDisplayNameOverrideKeys(input)) {
        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
          return String(overrides[key] ?? '').trim();
        }
      }
      return null;
    },

    skillAliasOverrideKeys(input = {}) {
      const skill = input.skill || {};
      const projectId = String(input.projectId || skill.projectId || '').trim();
      const keys = [
        input.git?.relativePath,
        skill.git?.relativePath,
        skill.relativePath,
        input.relativePath,
        input.key,
        skill.path,
        input.path,
        input.overrideKey
      ].map(value => String(value || '').trim()).filter(Boolean);
      const scopedKeys = projectId ? keys.map(key => `alias:${projectId}:${key}`) : [];
      return projectId ? scopedKeys : keys.filter(key => !/^(SKILL|README)\.md$/i.test(this.fileNameFromPath(key) || key));
    },

    skillAliasOverrideFor(input = {}) {
      const overrides = this.skillAliasOverrides || {};
      for (const key of this.skillAliasOverrideKeys(input)) {
        if (Array.isArray(overrides[key])) return overrides[key];
      }
      return null;
    },

    skillAliasHistoryOverrideFor(input = {}) {
      const overrides = this.skillAliasHistoryOverrides || {};
      const values = [];
      for (const key of this.skillAliasOverrideKeys(input)) {
        if (Array.isArray(overrides[key])) values.push(...overrides[key]);
      }
      return this.normalizeSkillAliasList(values);
    },

    applySkillAliasOverridesToScans() {
      const scans = {};
      let changed = false;
      for (const [projectId, scan] of Object.entries(this.scans || {})) {
        const skills = Array.isArray(scan?.skills)
          ? scan.skills.map(skill => {
            const aliases = this.skillAliasOverrideFor({ ...skill, projectId });
            const aliasHistory = this.skillAliasHistoryOverrideFor({ ...skill, projectId });
            if (!Array.isArray(aliases) && !aliasHistory.length) return skill;
            const nextAliases = this.normalizeSkillAliasList(Array.isArray(aliases) ? aliases : skill.aliases || []);
            const nextAliasHistory = this.normalizeSkillAliasHistoryList([
              ...(Array.isArray(skill.aliasHistory) ? skill.aliasHistory : []),
              ...aliasHistory,
              ...nextAliases
            ]);
            const sameAliases = nextAliases.join('｜') === this.normalizeSkillAliasList(skill.aliases || []).join('｜');
            const sameHistory = nextAliasHistory.join('｜') === this.normalizeSkillAliasHistoryList(skill.aliasHistory || []).join('｜');
            if (sameAliases && sameHistory && skill.hasAliasOverride === nextAliases.length > 0) return skill;
            changed = true;
            return {
              ...skill,
              aliases: nextAliases,
              manualAliases: nextAliases,
              aliasHistory: nextAliasHistory,
              hasAliasOverride: nextAliases.length > 0
            };
          })
          : scan?.skills;
        scans[projectId] = { ...scan, skills };
      }
      if (!changed) return false;
      this.scans = scans;
      this.clearSkillUsageLogCache();
      this.syncOpenSkillPreviewAliasesFromOverrides();
      return true;
    },

    syncOpenSkillPreviewAliasesFromOverrides() {
      const skill = this.skillPreview?.skill;
      if (!this.skillPreview?.visible || !skill) return;
      const aliases = this.skillAliasOverrideFor(skill);
      const aliasHistory = this.skillAliasHistoryOverrideFor(skill);
      if (!Array.isArray(aliases)) return;
      const normalizedAliases = this.normalizeSkillAliasList(aliases);
      const normalizedAliasHistory = this.normalizeSkillAliasHistoryList([
        ...(Array.isArray(skill.aliasHistory) ? skill.aliasHistory : []),
        ...aliasHistory,
        ...normalizedAliases
      ]);
      const nextSkill = {
        ...skill,
        aliases: normalizedAliases,
        manualAliases: normalizedAliases,
        aliasHistory: normalizedAliasHistory,
        hasAliasOverride: normalizedAliases.length > 0
      };
      this.skillPreview = { ...this.skillPreview, skill: nextSkill };
      this.skillPreviewAliasesDraft = normalizedAliases.join('、');
    },

    gitHistoryOwnerNames(skill = {}) {
      const history = Array.isArray(skill.git?.history) ? skill.git.history : [];
      const orderedHistory = [...history]
        .sort((left, right) => String(left.committedAt || '').localeCompare(String(right.committedAt || '')));
      return orderedHistory.flatMap(item => [
        item.authorName,
        item.authorEmail
      ]);
    },

    mergedSkillInventoryOwner(input = {}, fallback = '') {
      const skill = input.skill || input;
      const manualOwner = this.skillOwnerOverrideFor(input) || this.skillOwnerOverrideFor(skill) || skill.ownerOverride || '';
      const values = [
        manualOwner,
        ...(manualOwner ? [] : [
          skill.owner,
          input.owner,
          skill.uploaderName,
          input.uploaderName,
          this.uploaderFromSource(skill.source),
          this.uploaderFromSource(input.source),
          fallback
        ]),
        ...this.gitHistoryOwnerNames(skill),
        skill.git?.authorName,
        skill.git?.committerName
      ];
      const owners = values
        .flatMap(value => this.personList(value))
        .filter(person => person && person !== '-' && person !== '待确认')
        .filter((person, index, array) => array.findIndex(item => samePerson(item, person)) === index);
      return owners.length ? owners.join('、') : '-';
    },

    buildSkillInventoryRow(projectRow = {}, skill = {}) {
      const source = skill.source || (String(skill.path || '').startsWith('/') ? '本地上传' : '本地项目');
      const inferredDirectoryOwner = skill.inventoryKind === 'directory' ? this.resolveDirectoryProductOwner(skill) : '';
      const fallbackOwner = inferredDirectoryOwner || (source === '本地项目' ? projectRow.name : '');
      const uploader = this.isMemberArtReporterRow(skill)
        ? this.defaultSkillInventoryOwnerName()
        : this.displayPersonList(this.mergedSkillInventoryOwner({ ...skill, source, projectId: projectRow.id }, fallbackOwner));
      const statusLabel = skill.statusLabel || this.skillStatusLabel(skill);
      const scenes = this.skillScenes(skill);
      const version = String(skill.version || '1.0').trim() || '1.0';
      const relativePath = skill.git?.relativePath || skill.relativePath || skill.path || '';
      const gitSkillProductName = (source.startsWith('Git:') || skill.git) && /(^|\/)SKILL\.md$/i.test(String(relativePath || '').replace(/\\/g, '/'))
        ? String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-2, -1)[0] || ''
        : '';
      const isDirectoryProduct = skill.directoryProduct === true || skill.inventoryKind === 'directory';
      const directoryFileName = isDirectoryProduct
        ? (skill.productFileName || skill.originalProductDisplayName || this.fileNameFromPath(skill.relativePath) || this.fileNameFromPath(skill.path) || skill.productDisplayName)
        : '';
      const displayNameOverride = this.skillDisplayNameOverrideFor({ ...skill, projectId: projectRow.id });
      const directoryDisplayName = isDirectoryProduct
        ? (displayNameOverride !== null ? (displayNameOverride || directoryFileName) : (skill.productDisplayName || skill.displayName || directoryFileName))
        : '';
      const productFileName = directoryFileName || gitSkillProductName || skill.productFileName || skill.displayName || this.fileNameFromPath(relativePath) || this.fileNameFromPath(skill.path) || skill.id;
      const productDisplayName = directoryDisplayName || gitSkillProductName || skill.productDisplayName || skill.displayName || skill.title || productFileName;
      const aliasOverride = this.skillAliasOverrideFor({ ...skill, projectId: projectRow.id });
      const manualAliases = this.normalizeSkillAliasList(
        Array.isArray(aliasOverride) ? aliasOverride : (Array.isArray(skill.aliases) ? skill.aliases : [])
      );
      const aliasHistory = this.normalizeSkillAliasHistoryList([
        ...(Array.isArray(skill.aliasHistory) ? skill.aliasHistory : []),
        ...this.skillAliasHistoryOverrideFor({ ...skill, projectId: projectRow.id }),
        ...manualAliases
      ]);
      const aliases = this.normalizeSkillAliasList([
        ...manualAliases,
        ...this.generateSkillAliases({ ...skill, relativePath })
      ]);
      const inventoryKind = this.skillInventoryKind({ ...skill, projectId: projectRow.id });
      const baseRow = {
        uid: `${projectRow.id}:${skill.id}:${skill.path || ''}`,
        id: skill.id,
        title: skill.title || skill.id,
        productFileName,
        productDisplayName,
        uploader,
        owner: uploader,
        source,
        sourceType: source.startsWith('Git:') ? 'success' : source.includes('Google') ? 'warning' : 'info',
        isGitSource: source.startsWith('Git:') || Boolean(skill.git),
        category: skill.category || this.skillCategory(skill),
        version,
        versionClass: this.skillVersionClass(version),
        statusLabel,
        statusType: /通过|已验证|可用/.test(statusLabel) ? 'success' : /失败|退回|不可用/.test(statusLabel) ? 'danger' : /待验证|待补/.test(statusLabel) ? 'warning' : 'info',
        scenes,
        projectId: projectRow.id,
        projectName: projectRow.name,
        projectSourceType: projectRow.sourceType || '',
        path: skill.path || '',
        relativePath,
        originalProductDisplayName: skill.originalProductDisplayName || directoryFileName || skill.productFileName || skill.productDisplayName || '',
        aliases,
        aliasHistory,
        hidden: skill.hidden === true,
        hiddenAt: skill.hiddenAt || '',
        hiddenBy: skill.hiddenBy || '',
        displayHidden: skill.displayHidden === true,
        displayHiddenAt: skill.displayHiddenAt || '',
        displayHiddenBy: skill.displayHiddenBy || '',
        displayRestoredAt: skill.displayRestoredAt || '',
        displayRestoredBy: skill.displayRestoredBy || '',
        skillInventoryKind: inventoryKind,
        uploadedAt: skill.uploadedAt || skill.git?.uploadedAt || '',
        skill: {
          ...skill,
          projectId: projectRow.id,
          aliases,
          manualAliases,
          aliasHistory,
          hasAliasOverride: manualAliases.length > 0,
          inventoryKind
        }
      };
      const metrics = this.skillInventoryRowMetrics(baseRow);
      return {
        ...baseRow,
        ...metrics
      };
    },

    skillInventoryRowMetrics(row = {}) {
      const key = this.skillInventoryRowMetricsKey(row);
      const cached = key ? this.skillInventoryMetricsCache?.[key] : null;
      if (cached) return cached;
      const usage = this.skillInventoryUsageStats(row);
      const metrics = {
        usageCount: usage.usageCount,
        usageRate: usage.rate,
        usagePeopleCount: usage.peopleCount,
        usageAverage: usage.average,
        validationCount: usage.validationCount,
        researchSyncCount: usage.researchSyncCount
      };
      if (key) this.skillInventoryMetricsCache[key] = metrics;
      return metrics;
    },

    skillInventoryRowMetricsKey(row = {}) {
      return [
        row.uid || row.id || row.productDisplayName || row.title || '',
        row.relativePath || row.path || '',
        row.productDisplayName || '',
        (Array.isArray(row.aliases) ? row.aliases : []).join('|'),
        (Array.isArray(row.skill?.aliases) ? row.skill.aliases : []).join('|'),
        (Array.isArray(row.aliasHistory) ? row.aliasHistory : []).join('|'),
        (Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : []).join('|'),
        row.version || row.skill?.version || '',
        row.hidden === true ? 'hidden' : 'visible',
        this.usageCounters?.updatedAt || '',
        this.artProgressEvents.length,
        this.artProgressOperationLogRows.length,
        this.runs.length,
        this.taskArtBriefUsageLogs.length
      ].join('::');
    },

    buildSkillInventoryValidationCandidateRow(projectRow = {}, skill = {}) {
      const source = this.projectSkillSourceLabel(projectRow, skill);
      const inferredDirectoryOwner = this.inferSkillOwnerFromDirectory(skill);
      const fallbackOwner = inferredDirectoryOwner || (source === '本地项目' ? projectRow.name : '');
      const uploader = this.isMemberArtReporterRow(skill)
        ? this.defaultSkillInventoryOwnerName()
        : this.displayPersonList(this.mergedSkillInventoryOwner({ ...skill, source }, fallbackOwner));
      const relativePath = skill.git?.relativePath || skill.relativePath || skill.path || '';
      const productFileName = this.fileNameFromPath(relativePath) || this.fileNameFromPath(skill.path) || skill.id;
      const productDisplayName = skill.title || productFileName;
      const aliases = this.normalizeSkillAliasList([
        ...(Array.isArray(skill.aliases) ? skill.aliases : []),
        ...this.generateSkillAliases({ ...skill, relativePath })
      ]);
      const aliasHistory = this.normalizeSkillAliasHistoryList([
        ...(Array.isArray(skill.aliasHistory) ? skill.aliasHistory : []),
        ...this.skillAliasHistoryOverrideFor({ ...skill, projectId: projectRow.id }),
        ...(Array.isArray(skill.aliases) ? skill.aliases : [])
      ]);
      return {
        uid: `${projectRow.id}:${skill.id}:${skill.path || ''}`,
        id: skill.id,
        title: skill.title || skill.id,
        productFileName,
        productDisplayName,
        uploader,
        owner: uploader,
        source,
        projectId: projectRow.id,
        projectName: projectRow.name,
        path: skill.path || '',
        relativePath,
        aliases,
        aliasHistory,
        hidden: skill.hidden === true,
        skillInventoryKind: this.skillInventoryKind(skill),
        scenes: this.skillScenes(skill),
        skill: { ...skill, projectId: projectRow.id, aliases, aliasHistory, manualAliases: this.normalizeSkillAliasList(skill.aliases || []), hasAliasOverride: Array.isArray(skill.aliases) && skill.aliases.length > 0 }
      };
    },

    dedupeSkillInventoryRows(rows = []) {
      const byKey = new Map();
      for (const row of rows) {
        const key = this.skillInventoryDedupeKey(row);
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, { ...row, duplicateSources: [] });
          continue;
        }
        const preferred = this.preferSkillInventoryRow(existing, row);
        const duplicate = preferred === existing ? row : existing;
        const nextDuplicates = [
          ...(preferred.duplicateSources || []),
          {
            projectId: duplicate.projectId,
            projectName: duplicate.projectName,
            source: duplicate.source,
            path: duplicate.relativePath || duplicate.path || '',
            uploadedAt: duplicate.uploadedAt || ''
          }
        ];
        byKey.set(key, { ...preferred, duplicateSources: nextDuplicates });
      }
      return [...byKey.values()];
    },

    skillInventoryDedupeKey(row = {}) {
      if (this.isTaskArtBriefAssetRow(row)) return 'zentao-art-brief-product';
      if (row.skillInventoryKind === 'directory' || row.skill?.inventoryKind === 'directory' || row.skill?.directoryProduct === true || row.skill?.fileProduct === true) {
        const fileName = row.productFileName || this.fileNameFromPath(row.relativePath) || this.fileNameFromPath(row.path) || row.productDisplayName || row.title;
        return this.normalizeValidationMatchText(fileName) || this.normalizeValidationMatchText(row.id || row.uid || '');
      }
      const names = [
        row.productDisplayName,
        row.productFileName,
        row.title,
        this.fileNameFromPath(row.relativePath),
        this.fileNameFromPath(row.path)
      ].map(value => this.normalizeValidationMatchText(value)).filter(Boolean);
      return names.find(value => value.length >= 4) || this.normalizeValidationMatchText(row.id || row.uid || '');
    },

    preferSkillInventoryRow(left = {}, right = {}) {
      const rank = row => {
        const sourceType = String(this.projectRows.find(project => project.id === row.projectId)?.sourceType || '').toLowerCase();
        if (row.isGitSource || sourceType === 'git') return 4;
        if (sourceType === 'research') return 3;
        if (sourceType === 'shared') return 2;
        return 1;
      };
      const leftRank = rank(left);
      const rightRank = rank(right);
      if (leftRank !== rightRank) return rightRank > leftRank ? right : left;
      const timeDiff = String(right.uploadedAt || '').localeCompare(String(left.uploadedAt || ''));
      return timeDiff > 0 ? right : left;
    },

    skillInventoryUsageStats(row = {}) {
      return this.skillInventoryUsageStatsForList(row);
    },

    skillInventoryUsageCountDisplay(row = {}) {
      if (row.hidden === true) return '-';
      return Number(row.usageCount || 0);
    },

    skillInventoryUsageStatsForList(row = {}) {
      const historical = this.usageCounterStatsForRow(row);
      const people = new Set();
      Object.keys(historical.people || {}).forEach(person => {
        if (person) people.add(person);
      });
      const hasHistorical = this.hasUsageCounterStats(historical);
      const currentLogs = this.skillUsageLogs(row);
      const currentUsageLogs = currentLogs.filter(item => this.skillUsageLogCountsAsCall(item));
      const supplementalLogs = this.skillUsageSupplementalLogs(row, currentUsageLogs, hasHistorical, historical);
      supplementalLogs.forEach(item => {
        if (item.person) people.add(item.person);
      });
      const usageCount = (hasHistorical ? Number(historical.usageCount || 0) : 0) + supplementalLogs.length;
      const count = usageCount + Number(hasHistorical ? historical.validationCount || 0 : 0) + Number(hasHistorical ? historical.researchSyncCount || 0 : 0);
      const coverage = this.skillUsageCoverageStats(row, currentUsageLogs, { historicalPeople: people });
      const rate = coverage.rate;
      const average = people.size ? Math.round((usageCount / people.size) * 10) / 10 : 0;
      return {
        count,
        usageCount,
        rate,
        peopleCount: people.size,
        average,
        validationCoverage: coverage,
        validationCount: 0,
        researchSyncCount: 0
      };
    },

    isExcludedSkillVersionUsagePerson(person = '') {
      const name = this.canonicalArtDeptPerson(person) || String(person || '').trim();
      const raw = String(person || '').trim().toLowerCase();
      if (samePerson(name, this.defaultSkillInventoryOwnerName()) || samePerson(name, '张倩文') || samePerson(raw, 'zhangqw') || samePerson(raw, 'admin')) return true;
      if (samePerson(name, '余盛威') || samePerson(name, '盛威') || samePerson(raw, 'ysw') || samePerson(raw, 'yushengwei')) return true;
      return /^(ysw|yushengwei|yu\s*sheng\s*wei)$/i.test(raw);
    },

    skillEffectiveUsagePeople(row = {}) {
      const people = new Set();
      const addPerson = person => {
        const name = this.canonicalArtDeptPerson(person) || String(person || '').trim();
        if (!name || name === '-' || this.isExcludedSkillVersionUsagePerson(name)) return;
        people.add(name);
      };
      this.skillUsageLogs(row).filter(item => this.skillUsageLogCountsAsCall(item)).forEach(item => addPerson(item.person));
      const historical = this.usageCounterStatsForRow(row);
      Object.keys(historical.people || {}).forEach(addPerson);
      return [...people];
    },

    skillSelfUsageCount(row = {}) {
      const ownerKeys = [
        ...this.personList(row.uploader),
        ...this.personList(row.owner),
        ...this.personList(row.flowOwner),
        ...this.personList(row.skill?.uploaderName),
        ...this.personList(row.skill?.owner),
        ...this.personList(row.skill?.git?.authorName),
        ...this.personList(row.skill?.git?.committerName),
        this.uploaderFromSource(row.source)
      ].map(person => this.normalizeAiScorePersonKey(this.canonicalArtDeptPerson(person) || person)).filter(Boolean);
      if (!ownerKeys.length) return 0;
      let count = 0;
      const addIfOwner = (person = '', value = 1) => {
        const key = this.normalizeAiScorePersonKey(this.canonicalArtDeptPerson(person) || person);
        if (key && ownerKeys.includes(key)) count += Number(value || 0);
      };
      this.skillUsageLogs(row).filter(item => this.skillUsageLogCountsAsCall(item)).forEach(item => addIfOwner(item.person, 1));
      const historical = this.usageCounterStatsForRow(row);
      Object.entries(historical.people || {}).forEach(([person, personCount]) => addIfOwner(person, personCount));
      return count;
    },

    skillInventoryVersionMajor(rowOrVersion = {}) {
      if (rowOrVersion && typeof rowOrVersion === 'object') {
        if (rowOrVersion.hidden === true) return '1';
        if (this.isOwnerYushengwei(rowOrVersion)) {
          const selfUsageCount = this.skillSelfUsageCount(rowOrVersion);
          if (selfUsageCount >= 20) return '3';
          if (selfUsageCount >= 3) return '2';
          return '1';
        }
        const peopleCount = this.skillEffectiveUsagePeople(rowOrVersion).length;
        if (peopleCount >= 6) return '3';
        if (peopleCount >= 3) return '2';
        return '1';
      }
      return this.skillVersionMajor(rowOrVersion);
    },

    skillInventoryUsageStatsForDetail(row = {}) {
      const usageLogs = this.skillUsageLogs(row);
      const callLogs = usageLogs.filter(item => this.skillUsageLogCountsAsCall(item));
      const people = new Set(callLogs.map(item => item.person).filter(Boolean));
      const historical = this.usageCounterStatsForRow(row);
      Object.keys(historical.people || {}).forEach(person => {
        if (person) people.add(person);
      });
      const validationCoverage = this.skillUsageCoverageStats(row, callLogs);
      const count = this.hasUsageCounterStats(historical) ? Number(historical.count || 0) : callLogs.length;
      const usageCount = this.hasUsageCounterStats(historical) ? Number(historical.usageCount || 0) : callLogs.length;
      const rate = validationCoverage.rate;
      const average = people.size ? Math.round((usageCount / people.size) * 10) / 10 : 0;
      return { count, usageCount, rate, peopleCount: people.size, average, validationCoverage, validationCount: 0, researchSyncCount: 0 };
    },

    hasUsageCounterStats(stats = {}) {
      return Number(stats.bucketCount || 0) > 0
        || Number(stats.count || 0) > 0
        || Object.keys(stats.people || {}).length > 0;
    },

    usageCounterStatsForRow(row = {}) {
      const buckets = this.usageCounters?.buckets || {};
      if (!buckets || typeof buckets !== 'object') return { count: 0, people: {}, usageCount: 0, validationCount: 0, researchSyncCount: 0, bucketCount: 0 };
      const keys = this.usageRowExplicitTargetKeys(row);
      if (this.isTaskArtBriefAssetRow(row)) keys.push('zentaoartbriefproduct');
      const fuzzyKeys = this.usageRowFuzzyTargetKeys(row);
      const connectedAt = this.skillInventoryRowConnectedAt(row);
      const seen = new Set();
      const seenEventKeys = new Set();
      const people = {};
      let count = 0;
      let usageCount = 0;
      let validationCount = 0;
      let researchSyncCount = 0;
      const applyBucket = (bucket, normalizedKey = '') => {
        if (!bucket || seen.has(normalizedKey)) return;
        if (!this.usageBucketMatchesRowTime(bucket, row, connectedAt)) return;
        seen.add(normalizedKey);
        const eventKeys = Array.isArray(bucket.eventKeys) ? bucket.eventKeys.filter(Boolean) : [];
        const newEventKeys = eventKeys.filter(eventKey => !seenEventKeys.has(eventKey));
        const eventRatio = eventKeys.length ? newEventKeys.length / eventKeys.length : 1;
        if (!eventRatio) return;
        eventKeys.forEach(eventKey => seenEventKeys.add(eventKey));
        const applyCount = value => Math.round(Number(value || 0) * eventRatio);
        const bucketValidationCount = applyCount(bucket.validationCount || 0);
        const bucketResearchSyncCount = applyCount(bucket.researchSyncCount || 0);
        const bucketUsageCount = Math.max(0, applyCount(bucket.count || bucket.usageCount || 0) - bucketValidationCount - bucketResearchSyncCount);
        count += bucketUsageCount + bucketValidationCount + bucketResearchSyncCount;
        usageCount += bucketUsageCount;
        validationCount += bucketValidationCount;
        researchSyncCount += bucketResearchSyncCount;
        const personRatioBase = Number(bucket.count || bucket.usageCount || 0);
        const personUsageRatio = personRatioBase > 0 ? Math.min(1, bucketUsageCount / Math.max(1, applyCount(personRatioBase))) : 0;
        Object.entries(bucket.people || {}).forEach(([person, personCount]) => {
          if (!person) return;
          const value = applyCount(Number(personCount || 0) * personUsageRatio);
          if (value <= 0) return;
          people[person] = Number(people[person] || 0) + value;
        });
      };
      keys.forEach(key => {
        const normalizedKey = this.normalizeUsageMatchText(key).replace(/\.(md|markdown)$/i, '');
        applyBucket(buckets[normalizedKey], normalizedKey);
      });
      if (fuzzyKeys.length) {
        Object.entries(buckets).forEach(([bucketKey, bucket]) => {
          if (!bucket || seen.has(bucketKey)) return;
          const compactBucket = this.usageBucketCompactText(bucketKey, bucket);
          if (!compactBucket) return;
          const matched = fuzzyKeys.some(key => compactBucket.includes(key));
          if (!matched) return;
          applyBucket(bucket, bucketKey);
        });
      }
      return { count, people, usageCount, validationCount, researchSyncCount, bucketCount: seen.size };
    },

    skillInventoryRowConnectedAt(row = {}) {
      const values = [
        ...(Array.isArray(row.skill?.git?.history) ? row.skill.git.history.map(item => item?.committedAt) : []),
        row.uploadedAt,
        row.skill?.uploadedAt,
        row.skill?.git?.uploadedAt,
        row.skill?.git?.committedAt,
        row.skill?.createdAt,
        row.skill?.updatedAt
      ];
      return values
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .sort()[0] || '';
    },

    usageBucketMatchesRowTime(bucket = {}, row = {}, connectedAt = '') {
      const start = String(connectedAt || this.skillInventoryRowConnectedAt(row) || '').trim();
      if (!start) return true;
      if (this.usageBucketHasStrongRowIdentity(bucket, row)) return true;
      const firstAt = String(bucket.firstAt || bucket.lastAt || bucket.updatedAt || '').trim();
      const lastAt = String(bucket.lastAt || bucket.updatedAt || bucket.firstAt || '').trim();
      if (lastAt && lastAt >= start) return true;
      if (!firstAt) return true;
      return firstAt >= start;
    },

    usageBucketHasStrongRowIdentity(bucket = {}, row = {}) {
      const compactBucket = this.usageBucketCompactText(bucket.key || '', bucket);
      if (!compactBucket) return false;
      const pathValues = [
        row.relativePath,
        row.path,
        row.skill?.git?.relativePath,
        row.skill?.path
      ];
      const pathMatched = pathValues
        .map(value => this.usageCompactMatchText(value))
        .filter(value => value && value.length >= 8 && !this.isGenericUsageNeedle(value) && !this.isWeakUsageFuzzyNeedle(value))
        .some(value => compactBucket.includes(value));
      if (pathMatched) return true;
      const identityValues = [
        row.productFileName,
        row.productDisplayName,
        row.displayName,
        row.commonName,
        row.title,
        row.skill?.productDisplayName,
        row.skill?.displayName,
        row.skill?.commonName,
        row.skill?.title,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : []),
        ...(Array.isArray(row.aliasHistory) ? row.aliasHistory : []),
        ...(Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : [])
      ];
      return identityValues
        .map(value => this.usageCompactMatchText(value))
        .filter(value => value && value.length >= 6 && !this.isGenericUsageNeedle(value) && !this.isWeakUsageFuzzyNeedle(value))
        .some(value => compactBucket.includes(value));
    },

    usageRecordMatchesRowTime(record = {}, row = {}, connectedAt = '') {
      const start = String(connectedAt || this.skillInventoryRowConnectedAt(row) || '').trim();
      if (!start) return true;
      const at = String(this.artProgressRecordDisplayTime(record) || record.createdAt || record.updatedAt || '').trim();
      if (!at) return true;
      return at >= start;
    },

    usageBucketCompactText(bucketKey = '', bucket = {}) {
      return [
        bucketKey,
        bucket.key,
        bucket.target,
        ...(Array.isArray(bucket.aliases) ? bucket.aliases : [])
      ]
        .map(value => this.usageCompactMatchText(value))
        .filter(Boolean)
        .join('\n');
    },

    usageRowFuzzyTargetKeys(row = {}) {
      const pathValues = [
        row.relativePath,
        row.path,
        row.skill?.git?.relativePath,
        row.skill?.relativePath,
        row.skill?.path
      ];
      const aliasValues = [
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : []),
        ...(Array.isArray(row.aliasHistory) ? row.aliasHistory : []),
        ...(Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : [])
      ];
      const values = [
        row.productFileName,
        row.productDisplayName,
        row.displayName,
        row.commonName,
        row.title,
        row.skill?.productDisplayName,
        row.skill?.displayName,
        row.skill?.commonName,
        row.skill?.title,
        row.skill?.originalTitle,
        ...pathValues,
        ...pathValues.flatMap(value => this.usageConcreteNamesFromPath(value)),
        ...aliasValues
      ];
      return values
        .map(value => this.usageCompactMatchText(value))
        .filter(value => value && value.length >= 6 && !this.isGenericUsageNeedle(value) && !this.isWeakUsageFuzzyNeedle(value))
        .filter((value, index, array) => array.indexOf(value) === index);
    },

    isWeakUsageFuzzyNeedle(value = '') {
      const text = this.usageCompactMatchText(value);
      if (!text) return true;
      return /^(ip|默认|default|生成|生图|同ip|ip生成|默认ip|使用默认|按默认ip生成|使用默认着装)$/i.test(text)
        || /^[0-9]+$/.test(text);
    },

    usageCounterEventKeySetForRow(row = {}) {
      const buckets = this.usageCounters?.buckets || {};
      if (!buckets || typeof buckets !== 'object') return new Set();
      const keys = this.usageRowExplicitTargetKeys(row);
      if (this.isTaskArtBriefAssetRow(row)) keys.push('zentaoartbriefproduct');
      const fuzzyKeys = this.usageRowFuzzyTargetKeys(row);
      const seen = new Set();
      const eventKeys = new Set();
      const applyBucket = (bucket, normalizedKey = '') => {
        if (!bucket || seen.has(normalizedKey)) return;
        seen.add(normalizedKey);
        (Array.isArray(bucket.eventKeys) ? bucket.eventKeys : []).forEach(eventKey => {
          if (eventKey) eventKeys.add(String(eventKey));
        });
      };
      keys.forEach(key => {
        const normalizedKey = this.normalizeUsageMatchText(key).replace(/\.(md|markdown)$/i, '');
        applyBucket(buckets[normalizedKey], normalizedKey);
      });
      if (fuzzyKeys.length) {
        Object.entries(buckets).forEach(([bucketKey, bucket]) => {
          if (!bucket || seen.has(bucketKey)) return;
          const compactBucket = this.usageBucketCompactText(bucketKey, bucket);
          if (!compactBucket) return;
          if (!fuzzyKeys.some(key => compactBucket.includes(key))) return;
          applyBucket(bucket, bucketKey);
        });
      }
      return eventKeys;
    },

    skillUsageSupplementalLogs(row = {}, logs = [], hasHistorical = false, historical = null) {
      if (!hasHistorical) return Array.isArray(logs) ? logs : [];
      const buckets = this.usageCounters?.buckets || {};
      const countedEventKeys = this.usageCounterEventKeySetForRow(row);
      const allowRunFallback = Number(historical?.usageCount || 0) <= 0;
      const rowKeys = this.usageRowExplicitTargetKeys(row);
      const missingAliasKeys = [
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : []),
        ...(Array.isArray(row.aliasHistory) ? row.aliasHistory : []),
        ...(Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : [])
      ]
        .map(value => this.usageCounterKeyForProduct(value))
        .filter(value => value && value.length >= 4 && !this.isGenericUsageNeedle(value) && !buckets[value]);
      const seen = new Set();
      return (Array.isArray(logs) ? logs : []).filter(item => {
        const rawId = String(item.raw?.id || item.id || '').replace(/^run-/, '').trim();
        const eventKey = String(item.raw?.eventKey || item.raw?.metadata?.eventKey || '').trim();
        if ((eventKey && countedEventKeys.has(eventKey)) || (rawId && countedEventKeys.has(rawId))) return false;
        const target = this.usageCounterKeyForProduct(item.target || item.raw?.skillName || item.raw?.title || item.summary || '');
        const reason = this.usageCounterKeyForProduct(item.matchReason || '');
        const isRunLog = String(item.id || '').startsWith('run-') || item.matchReason === '工作台执行记录';
        const matched = (isRunLog && allowRunFallback)
          || missingAliasKeys.some(alias => target.includes(alias) || reason.includes(`别名命中${alias}`) || reason.includes(alias));
        if (!matched) return false;
        const key = [item.id, item.time, item.person, item.target, item.summary].map(value => String(value || '').trim()).join('::');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },

    skillUsageLogCountsAsCall(log = {}) {
      const raw = log.raw && typeof log.raw === 'object' ? log.raw : {};
      const eventType = String(raw.eventType || '').trim();
      if (['research_finding', 'research_summary', 'research_artifact', 'reporter_installed', 'reporter_test'].includes(eventType)) return false;
      const action = String(raw.action || '').trim();
      if (['REPORT_ART_PROGRESS', 'AUTO_UPSERT_SKILL_VALIDATION', 'UPSERT_SKILL_VALIDATION', 'UPDATE_SKILL_VALIDATION', 'UPDATE_SKILL_ALIAS'].includes(action)) return false;
      if (['skill_called', 'tool_used', 'task_completed'].includes(eventType)) return true;
      if (['START_RUN', 'RETRY_RUN', 'CREATE_DIRECT_SKILL_RUN'].includes(action)) return true;
      const sourceType = String(raw.sourceType || raw.executionMode || '').trim();
      if (sourceType === 'direct-skill') return true;
      const text = [
        log.type,
        log.summary,
        log.matchReason,
        raw.summary,
        raw.title,
        raw.metadata?.operationName,
        raw.metadata?.skillName
      ].map(value => String(value || '')).join('\n');
      return /直接执行|启动执行|再次执行|调用|使用|执行/.test(text)
        && !/同步研究沉淀|自动回填验证|修改产物调用别名|研究沉淀/.test(text);
    },

    skillUsageCoveragePeople() {
      const people = this.artDeptDisplayPeople
        .map(person => this.canonicalArtDeptPerson(person) || person)
        .filter(person => person && !this.isExcludedSkillUsageCoveragePerson(person));
      return people.filter((person, index, array) => array.findIndex(item => samePerson(item, person)) === index);
    },

    taskArtBriefCoveragePeople() {
      const people = this.artDeptDisplayPeople
        .map(person => this.canonicalArtDeptPerson(person) || person)
        .filter(person => person && !this.isSpecialSingleUserCoveragePerson(person));
      return people.filter((person, index, array) => array.findIndex(item => samePerson(item, person)) === index);
    },

    memberArtReporterCoveragePeople() {
      const people = this.artDeptDisplayPeople
        .map(person => this.canonicalArtDeptPerson(person) || person)
        .filter(person => person && !samePerson(person, '张倩文') && !samePerson(person, 'zhangqw'));
      return people.filter((person, index, array) => array.findIndex(item => samePerson(item, person)) === index);
    },

    isExcludedSkillUsageCoveragePerson(person = '') {
      return samePerson(person, '张倩文')
        || samePerson(person, 'zhangqw')
        || samePerson(person, '余盛威')
        || samePerson(person, 'yushengwei')
        || samePerson(person, 'ysw');
    },

    isSpecialSingleUserCoveragePerson(person = '') {
      return samePerson(person, '余盛威')
        || samePerson(person, 'yushengwei')
        || samePerson(person, 'ysw');
    },

    isOwnerYushengwei(row = {}) {
      const people = [
        ...this.personList(row.uploader),
        ...this.personList(row.owner),
        ...this.personList(row.flowOwner),
        ...this.personList(row.skill?.uploaderName),
        ...this.personList(row.skill?.owner),
        ...this.personList(row.skill?.git?.authorName),
        ...this.personList(row.skill?.git?.committerName),
        this.uploaderFromSource(row.source)
      ].filter(Boolean);
      return people.some(person => samePerson(person, '余盛威') || samePerson(person, '盛威') || samePerson(person, 'yushengwei') || samePerson(person, 'ysw'));
    },

    skillUsageRateDisplay(row = {}) {
      if (row.hidden === true) return '-';
      if (this.isOwnerYushengwei(row)) return '-';
      return `${Number(row.usageRate || 0)}%`;
    },

    skillUsageCoverageStats(row = {}, logs = [], options = {}) {
      const targetCount = 7;
      if (this.isOwnerYushengwei(row)) {
        return {
          targetCount,
          validatedCount: 0,
          specialSingleUserCount: 0,
          rate: 0,
          excluded: true
        };
      }
      const effectivePeople = new Set();
      const historicalPeople = options.historicalPeople instanceof Set ? [...options.historicalPeople] : [];
      historicalPeople.forEach(personName => {
        const person = this.canonicalArtDeptPerson(personName) || String(personName || '').trim();
        if (!person || this.isExcludedSkillUsageCoveragePerson(person)) return;
        effectivePeople.add(normalizePersonName(person));
      });
      logs.forEach(record => {
        if (!this.isPositiveSkillUsageRecord(record)) return;
        const person = this.canonicalArtDeptPerson(record.person || record.raw?.validator || record.raw?.walkthroughOwner || record.raw?.memberName || record.raw?.memberAccount || '');
        if (!person || this.isExcludedSkillUsageCoveragePerson(person)) return;
        effectivePeople.add(normalizePersonName(person));
      });
      const effectiveCount = Math.min(effectivePeople.size, targetCount);
      return {
        targetCount,
        validatedCount: effectiveCount,
        specialSingleUserCount: 0,
        rate: targetCount ? Math.min(100, Math.round((effectiveCount / targetCount) * 100)) : 0
      };
    },

    skillValidationCoverageStats(logs = []) {
      const targetPeople = this.skillUsageCoveragePeople();
      const validated = new Set();
      logs.forEach(record => {
        if (record.type !== '验证回填') return;
        if (!this.isPositiveSkillUsageRecord(record)) return;
        const person = this.canonicalArtDeptPerson(record.person || record.raw?.validator || record.raw?.walkthroughOwner || '');
        if (!person || this.isExcludedSkillUsageCoveragePerson(person)) return;
        if (!targetPeople.some(target => samePerson(target, person))) return;
        validated.add(normalizePersonName(person));
      });
      const targetCount = targetPeople.length || 6;
      const validatedCount = Math.min(validated.size, targetCount);
      return {
        targetCount,
        validatedCount,
        rate: targetCount ? Math.min(100, Math.round((validatedCount / targetCount) * 100)) : 0
      };
    },

    aiAssetUsageStats(row = {}) {
      const usageRow = this.aiAssetAsSkillUsageRow(row);
      const historical = this.usageCounterStatsForRow(usageRow);
      return {
        count: Number(historical.count || 0),
        peopleCount: Object.keys(historical.people || {}).length
      };
    },

    aiAssetAsSkillUsageRow(row = {}) {
      return {
        ...row,
        uid: row.id || row.rowNumber || row.title,
        id: row.id || row.title,
        title: row.title || this.aiAssetDisplayFileName(row) || row.id,
        productDisplayName: this.aiAssetDisplayFileName(row) || row.title || row.id,
        productFileName: this.aiAssetDisplayFileName(row) || row.title || row.id,
        uploader: this.displayPersonList(row.owner),
        relativePath: row.finalPath || row.skillPath || row.fileLink || row.projectName || row.title || '',
        path: row.finalPath || row.skillPath || row.fileLink || row.projectName || row.title || '',
        aliases: this.normalizeSkillAliasList([
          row.title,
          this.aiAssetDisplayFileName(row),
          row.projectName,
          row.finalPath,
          row.skillPath,
          row.fileLink
        ]),
        skill: {
          id: row.id,
          title: row.title,
          path: row.finalPath || row.skillPath || row.fileLink || row.projectName || '',
          aliases: this.normalizeSkillAliasList([
            row.title,
            this.aiAssetDisplayFileName(row),
            row.projectName,
            row.finalPath,
            row.skillPath,
            row.fileLink
          ])
        }
      };
    },

    skillInventoryMemberProductRows() {
      const members = Array.isArray(this.aiMembersSnapshot?.members) ? this.aiMembersSnapshot.members : [];
      const projectRow = {
        id: 'ai-board-member-products',
        name: 'AI 看板累计产物',
        sourceType: 'member',
        framework: '成员产物'
      };
      return members.flatMap(member => {
        const memberName = member.name || member.account || '';
        if (!memberName) return [];
        return this.aiBoardMemberProductItems(member)
          .filter(product => this.isTaskArtBriefProductName(product))
          .map((product, index) => this.buildSkillInventoryRow(projectRow, {
            id: `member-product-${member.account || member.name}-${index}`,
            title: product,
            path: product,
            relativePath: product,
            source: '成员产物',
            uploaderName: memberName,
            inventoryKind: 'document',
            category: '任务摘要工具',
            description: '任务中心美术摘要产物',
            preview: `产物：${product}`,
            version: '1.0',
            status: 'ready',
            statusLabel: '已接入',
            aliases: this.taskArtBriefProductAliases(product)
          }));
      });
    },

    isTaskArtBriefProductName(value = '') {
      const text = String(value || '').trim();
      return /zentao[-_ ]?art[-_ ]?brief|禅道提取美术任务摘要|禅道美术摘要|禅道美术简报|美术任务摘要|美术摘要|美术简报/i.test(text);
    },

    taskArtBriefProductAliases(value = '') {
      return this.normalizeSkillAliasList([
        value,
        '禅道提取美术任务摘要',
        '美术任务摘要',
        '禅道美术摘要',
        '生成美术摘要',
        '重新生成美术摘要',
        '复用禅道美术摘要',
        'zentao-art-brief'
      ]);
    },

    isPositiveSkillUsageRecord(record = {}) {
      const text = `${record.content || ''} ${record.summary || ''} ${record.raw?.reuseAdvice || ''} ${record.raw?.validationResult || ''} ${record.raw?.status || ''}`;
      if (/失败|不可用|未完成|取消|不适用|不用|无法复用/.test(text)) return false;
      if (/可直接复用|已完成|通过|建议.*复用|部分可用|可用|复用|调用|使用|验证了|接入|执行/.test(text)) return true;
      return record.type !== '验证回填';
    },

    fileNameFromPath(pathValue = '') {
      const raw = String(pathValue || '').trim();
      if (!raw) return '';
      const withoutQuery = raw.split(/[?#]/)[0];
      let decoded = withoutQuery;
      try {
        decoded = decodeURIComponent(withoutQuery);
      } catch {
        decoded = withoutQuery;
      }
      return decoded.replace(/\\/g, '/').split('/').filter(Boolean).pop() || raw;
    },

    aiAssetDisplayFileName(row = {}) {
      return this.fileNameFromPath(row.skillPath)
        || this.fileNameFromPath(row.fileLink)
        || this.fileNameFromPath(row.finalPath)
        || String(row.title || row.projectName || row.id || '').trim();
    },

    normalizeSkillAliasList(value = []) {
      const raw = Array.isArray(value)
        ? value
        : String(value || '').split(/[,，、\n\r]+/);
      const blocked = /^(skill|skills|md|markdown|codex|mcp|figma|git|ai|工具|技能|文档|流程|规范|验证|平台|资源|图片)$/i;
      const seen = new Set();
      const output = [];
      for (const item of raw) {
        const text = String(item || '').trim();
        if (!text || text.length < 2 || text.length > 80 || blocked.test(text)) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(text);
      }
      return output.slice(0, 12);
    },

    normalizeSkillAliasHistoryList(value = []) {
      const raw = Array.isArray(value)
        ? value
        : String(value || '').split(/[,，、\n\r]+/);
      const blocked = /^(skill|skills|md|markdown|codex|mcp|figma|git|ai|工具|技能|文档|流程|规范|验证|平台|资源|图片)$/i;
      const seen = new Set();
      const output = [];
      for (const item of raw) {
        const text = String(item || '').trim();
        if (!text || text.length < 2 || text.length > 80 || blocked.test(text)) continue;
        const key = this.usageCounterKeyForProduct(text) || text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(text);
      }
      return output.slice(-80);
    },

    extractSkillAliasesFromContent(content = '') {
      const raw = String(content || '');
      if (!raw.trim()) return [];
      const aliases = [];
      const pushList = value => {
        String(value || '')
          .replace(/[；;]/g, '、')
          .split(/[、,，\n\r]+/)
          .map(item => item.trim().replace(/^[-*]\s*/, '').replace(/^["“”'‘’]+|["“”'‘’。；;]+$/g, ''))
          .filter(Boolean)
          .forEach(item => aliases.push(item));
      };
      const linePatterns = [
        /(?:触发(?:意图|场景|关键词|词)?|调用(?:别名|词|方式|语)?|唤起词|关键词|适用场景|使用场景)[：:]\s*(.+)$/i,
        /(?:用户|成员|使用者|组员)(?:通常|可以|会|可能)?(?:说|输入|提到|描述)[：:]\s*(.+)$/i,
        /(?:可以这样说|常用说法|示例(?:指令|话术|提问)?|Prompt)[：:]\s*(.+)$/i,
        /^Use when\s+(.+)$/i
      ];
      raw.split(/\r?\n/).forEach(line => {
        const text = line.trim();
        if (!text || text.length > 220) return;
        for (const pattern of linePatterns) {
          const match = text.match(pattern);
          if (match?.[1]) {
            pushList(match[1]);
            break;
          }
        }
      });
      const quoted = [...raw.matchAll(/[“"']([^“”"'\n]{2,60})[”"']/g)]
        .map(match => match[1])
        .filter(text => /使用|调用|检查|生成|修复|优化|同步|执行|验证|走查|处理|帮我|请/.test(text));
      pushList(quoted.join('、'));
      return this.normalizeSkillAliasList(aliases);
    },

    generateSkillAliases(skill = {}) {
      const titleAlias = this.cleanSkillAliasName(skill.title);
      const displayAlias = this.cleanSkillAliasName(skill.productDisplayName || skill.productFileName || skill.name);
      const values = [
        displayAlias,
        titleAlias,
        ...(Array.isArray(skill.triggers) ? skill.triggers : []),
        ...(Array.isArray(skill.previewAliases) ? skill.previewAliases : [])
      ];
      return this.normalizeSkillAliasList(values);
    },

    cleanSkillAliasName(value = '') {
      return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .pop()
        ?.replace(/\.(md|markdown)$/i, '')
        .replace(/^SKILL$/i, '')
        .replace(/[_.-]+$/g, '')
        .trim() || '';
    },

    isGenericSkillAliasName(value = '') {
      return /^(skill|skills|md|markdown|readme|agents|claude|memory|index|文档|说明)$/i.test(String(value || '').trim());
    },

    skillVersionClass(version = '') {
      if (version && typeof version === 'object') {
        if (version.hidden === true) return 'version-hidden';
        return `version-${this.skillInventoryVersionMajor(version)}`;
      }
      const normalized = String(version || '').trim();
      if (/^v?1(?:\.0)?$/i.test(normalized)) return 'version-1';
      if (/^v?2(?:\.0)?$/i.test(normalized)) return 'version-2';
      if (/^v?3(?:\.0)?$/i.test(normalized)) return 'version-3';
      return 'version-custom';
    },

    skillVersionMajor(version = '') {
      const normalized = String(version || '1.0').trim();
      const matched = normalized.match(/([123])(?:\.0)?/);
      return matched?.[1] || '1';
    },

    canEditSkillInventoryOwnerRow(row = {}) {
      if (!this.canOperateSkillInventoryOwner) return false;
      const sourceType = String(this.projectRows.find(project => project.id === row.projectId)?.sourceType || '').toLowerCase();
      return row.skill?.directoryProduct === true
        || row.skillInventoryKind === 'directory'
        || ['local', 'shared'].includes(sourceType);
    },

    skillVersionDisplayLabel(version = '') {
      const major = this.skillInventoryVersionMajor(version);
      if (major === '3') return '3.0';
      if (major === '2') return '2.0';
      return '1.0';
    },

    skillVersionShortLabel(version = '') {
      if (version && typeof version === 'object' && version.hidden === true) return '1.0';
      return `${this.skillInventoryVersionMajor(version)}.0`;
    },

    skillVersionDescription(version = '') {
      const major = this.skillInventoryVersionMajor(version);
      if (version && typeof version === 'object') {
        if (version.hidden === true) return '1.0：该产物已作废，暂不计入 AI 评分；恢复后按真实使用人数更新版本。';
        if (this.isOwnerYushengwei(version)) {
          const selfUsageCount = this.skillSelfUsageCount(version);
          if (major === '3') return `3.0：入口图单线产物按本人有效使用次数计算，已自行使用 ${selfUsageCount} 次，达到 20 次标准。`;
          if (major === '2') return `2.0：入口图单线产物按本人有效使用次数计算，已自行使用 ${selfUsageCount} 次，达到 3 次标准。`;
          return `1.0：入口图单线产物按本人有效使用次数计算，当前自行使用 ${selfUsageCount} 次。`;
        }
        const peopleCount = this.skillEffectiveUsagePeople(version).length;
        if (major === '3') return `3.0：已有 ${peopleCount} 位有效成员使用，达到 6 人使用标准。`;
        if (major === '2') return `2.0：已有 ${peopleCount} 位有效成员使用，达到 3 人使用标准。`;
        return `1.0：已有贡献或自己使用，当前 ${peopleCount} 位有效成员使用。`;
      }
      if (major === '3') return '3.0：达到 6 人使用标准。';
      if (major === '2') return '2.0：达到 3 人使用标准。';
      return '1.0：已有贡献或自己使用。';
    },

    skillQualityScore(row = {}) {
      const skill = row.skill || row;
      const explicit = [
        skill.auditScore,
        skill.score,
        row.auditScore,
        row.score
      ].map(value => Number(value)).find(value => Number.isFinite(value) && value >= 0);
      if (explicit !== undefined) return Math.max(0, Math.min(100, Math.round(explicit > 90 ? explicit : (explicit / 90) * 100)));

      const text = [
        skill.description,
        skill.summary,
        skill.content,
        skill.readme,
        skill.preview,
        skill.raw,
        row.description,
        row.summary,
        row.content,
        row.readme,
        row.preview,
        row.title,
        row.productDisplayName,
        row.productFileName,
        row.relativePath,
        row.path,
        ...(Array.isArray(skill.triggers) ? skill.triggers : []),
        ...(Array.isArray(skill.aliases) ? skill.aliases : []),
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.scenes) ? row.scenes : [])
      ].join('\n').toLowerCase();
      const has = pattern => pattern.test(text);
      const path = String(row.relativePath || row.path || skill.path || '').toLowerCase();
      const isSkill = this.isSkillInventorySkillProduct(row);
      const hasSkillFile = /(^|\/)skill\.md$/i.test(path) || isSkill;
      const sceneCount = Array.isArray(row.scenes) ? row.scenes.filter(Boolean).length : 0;
      const aliasCount = Array.isArray(row.aliases) ? row.aliases.filter(Boolean).length : 0;
      const triggerCount = Array.isArray(skill.triggers) ? skill.triggers.filter(Boolean).length : 0;
      const versionMajor = Number(this.skillVersionMajor(row.version || skill.version));
      const usageCount = Number(row.usageCount || 0);
      const peopleCount = Number(row.usagePeopleCount || 0);
      const score90 =
        (hasSkillFile || text.length > 20 ? 7 : 3) +
        (has(/交付|输出|产物|结果|成功|验收|report|deliver|output/) ? 8 : text.length > 80 ? 5 : 3) +
        (has(/步骤|流程|阶段|先|然后|最后|workflow|step|checklist/) ? 8 : 4) +
        ((path ? 3 : 0) + (has(/script|scripts|tool|mcp|figma|npm|node|python|命令|工具|路径/) ? 5 : 1)) +
        ((aliasCount || triggerCount || sceneCount) ? 7 : 3) +
        (has(/失败|异常|缺失|权限|报错|回退|fallback|error|blocked/) ? 8 : 3) +
        (has(/确认|暂停|等待|人工|负责人|审批|confirm|approval/) ? 7 : 3) +
        ((usageCount > 0 ? 3 : 0) + (peopleCount > 0 ? 2 : 0) + (has(/验证|测试|检查|截图|构建|自检|test|verify|screenshot/) ? 5 : 2)) +
        (has(/不要|不得|禁止|不能|不要做|风险|黑名单|delete|reset|destructive/) ? 8 : 3);
      const versionBonus = versionMajor >= 3 ? 4 : versionMajor >= 2 ? 2 : 0;
      return Math.max(0, Math.min(100, Math.round((Math.min(90, score90) / 90) * 100 + versionBonus)));
    },

    skillQualityScoreClass(score = 0) {
      const value = Number(score || 0);
      if (value >= 85) return 'is-good';
      if (value >= 70) return 'is-stable';
      if (value >= 55) return 'is-watch';
      return 'is-low';
    },

    skillQualityScoreText(row = {}) {
      const score = this.skillQualityScore(row);
      return `质量分 ${score}：按 skill-auditor 9 维口径估算，包含触发清晰度、目标产物、工作流、工具资源、可执行性、失败模式、人工卡口、验证机制和风险黑名单。`;
    },

    skillCategory(skill = {}) {
      const text = [skill.id, skill.title, skill.description, skill.triggers?.join(' ')].join(' ').toLowerCase();
      if (/figma|还原|设计稿|切图/.test(text)) return 'Figma / 设计还原';
      if (/bug|修复|复现|回归/.test(text)) return 'Bug 修复';
      if (/image|图片|webp|png|jpg|资源/.test(text)) return '资源处理';
      if (/i18n|多语言|文案/.test(text)) return '多语言';
      if (/api|showdoc|接口|联调/.test(text)) return '接口联调';
      if (/smoke|验证|冒烟|compat|兼容/.test(text)) return '验证质检';
      if (/report|交付|审查|review/.test(text)) return '交付审查';
      return '通用流程';
    },

    skillScenes(skill = {}) {
      if (skill.inventoryKind === 'directory') return ['共享盘浅层目录'];
      const rawTriggers = Array.isArray(skill.triggers) ? skill.triggers : [];
      const scenes = rawTriggers
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 4);
      if (scenes.length) return scenes;
      const description = String(skill.description || '').trim();
      if (description) return [description.slice(0, 42)];
      return [];
    },

    resolveDirectoryProductOwner(skill = {}) {
      const title = String(skill.title || skill.relativePath || skill.path || '').trim();
      if (!title) return this.defaultSkillInventoryOwnerName();
      if (this.isTaskArtBriefProductName(title)) return '李华玲';
      const relativePath = String(skill.relativePath || skill.path || '').replace(/\\/g, '/');
      const parts = relativePath.split('/').filter(Boolean);
      const depth = Number(skill.directoryDepth || 0);
      const titleCandidates = [
        depth > 1 ? parts[0] : '',
        title,
        relativePath,
        skill.parentDirectory
      ].filter(Boolean);
      const members = Array.isArray(this.aiMembersSnapshot?.members) ? this.aiMembersSnapshot.members : [];
      for (const candidate of titleCandidates) {
        const titleKey = this.normalizeValidationMatchText(candidate);
        if (!titleKey) continue;
        for (const member of members) {
          const products = this.aiBoardMemberProductItems(member);
          if (products.some(product => {
            const key = this.normalizeValidationMatchText(product);
            return titleKey && key && titleKey.length >= 3 && key.length >= 3 && (titleKey === key || titleKey.includes(key) || key.includes(titleKey));
          })) return member.name || member.account || '';
        }
      }
      return this.defaultSkillInventoryOwnerName();
    },

    skillInventoryRowBelongsToMember(row = {}, memberName = '', memberProducts = null, memberAiAssets = null) {
      const aliases = this.skillInventoryMemberAliases(memberName);
      const rowUploaders = this.personList(row.uploader);
      const directOwnerMatch = aliases.some(alias => rowUploaders.some(person => samePerson(person, alias)) || String(row.source || '').toLowerCase().includes(String(alias || '').toLowerCase()));
      if (directOwnerMatch) return true;
      const products = Array.isArray(memberProducts) ? memberProducts : this.finishedMemberProductItems(
        (Array.isArray(this.aiMembersSnapshot?.members) ? this.aiMembersSnapshot.members : []).find(member => aliases.some(alias => samePerson(member.name, alias) || samePerson(member.account, alias))) || {}
      );
      const aiAssets = Array.isArray(memberAiAssets) ? memberAiAssets : this.aiAssetSheetRows.filter(asset => this.aiAssetRowBelongsToAliases(asset, aliases) && this.isFinishedAiAssetRow(asset));
      const rowNames = this.normalizeValidationNameCandidates([
        row.productDisplayName,
        row.productFileName,
        row.title,
        row.relativePath,
        row.path
      ]);
      const productNames = this.normalizeValidationNameCandidates([
        ...products,
        ...aiAssets.flatMap(asset => [this.aiAssetDisplayFileName(asset), asset.title, asset.projectName, asset.finalPath, asset.skillPath, asset.fileLink])
      ]);
      return rowNames.some(rowName => {
        const rowKey = this.normalizeValidationMatchText(rowName);
        return productNames.some(productName => {
          const productKey = this.normalizeValidationMatchText(productName);
          return rowKey && productKey && rowKey.length >= 4 && productKey.length >= 4 && (rowKey.includes(productKey) || productKey.includes(rowKey));
        });
      });
    },

    skillInventoryRowDirectlyBelongsToMember(row = {}, memberName = '') {
      const aliases = this.skillInventoryMemberAliases(memberName)
        .map(alias => this.canonicalArtDeptPerson(alias) || String(alias || '').trim())
        .filter(Boolean);
      if (!aliases.length) return false;
      if (this.isTaskArtBriefAssetRow(row) && aliases.some(alias => samePerson(alias, '李华玲'))) return true;
      if (row.skillInventoryKind === 'directory' || row.skill?.inventoryKind === 'directory') {
        const owner = this.resolveDirectoryProductOwner(row.skill || row);
        if (aliases.some(alias => samePerson(owner, alias))) return true;
      }
      const rowPeople = [
        ...this.personList(row.uploader),
        ...this.personList(row.owner),
        ...this.personList(row.flowOwner),
        ...this.personList(row.skill?.uploaderName),
        ...this.personList(row.skill?.owner),
        ...this.personList(row.skill?.git?.authorName),
        ...this.personList(row.skill?.git?.committerName)
      ];
      if (aliases.some(alias => rowPeople.some(person => samePerson(person, alias)))) return true;
      const sourceUploader = this.uploaderFromSource(row.source);
      return aliases.some(alias => samePerson(sourceUploader, alias));
    },

    dedupeMemberProductItems(items = []) {
      const unique = [];
      for (const item of items) {
        const text = String(item || '').trim();
        const key = this.normalizeValidationMatchText(text);
        if (!text || !key) continue;
        if (unique.some(existing => {
          const existingKey = this.normalizeValidationMatchText(existing);
          return existingKey === key || (key.length >= 6 && existingKey.length >= 6 && (key.includes(existingKey) || existingKey.includes(key)));
        })) continue;
        unique.push(text);
      }
      return unique;
    },

    aiBoardMemberProductItems(member = {}) {
      return this.dedupeMemberProductItems(
        (Array.isArray(member.productItems) ? member.productItems : [])
          .map(item => String(item || '').trim())
          .filter(Boolean)
          .filter(item => !this.isFigmaUseConnectorText(item) && !this.isFigmaUseConnectorName(item))
          .filter(item => !/^适用场景/.test(item) && !/^为统一项目/.test(item) && !/^\s*Use when/i.test(item))
          .filter(item => !/^(暂无|待补充|暂无明确产物或\s*Skill)$/i.test(item))
          .filter(item => !/是否已执行|已进入\s*\/\s*准备进入\s*\/\s*暂未进入|正在研究|在实验修改阶段|暂未进入/.test(item))
      );
    },

    visibleAiBoardMemberProductItems(member = {}) {
      const products = this.aiBoardMemberProductItems(member);
      const hiddenRows = this.skillInventoryRows.filter(row => row.hidden === true);
      if (!hiddenRows.length) return products;
      return products.filter(product => !hiddenRows.some(row => this.skillInventoryProductNameMatchesRow(product, row)));
    },

    skillInventoryOwnerProductItems() {
      return this.dedupeMemberProductItems(
        this.skillInventoryAssetRows
          .filter(row => this.isMemberArtReporterRow(row))
          .map(row => row.productDisplayName || row.productFileName || row.title || row.relativePath || row.path)
          .filter(Boolean)
      );
    },

    skillInventoryDirectoryProductItemsForMember(member = {}) {
      const memberName = member.name || member.account || '';
      if (!memberName) return [];
      return this.skillInventoryRows
        .filter(row => row.hidden !== true)
        .filter(row => row.skillInventoryKind === 'directory' || row.skill?.inventoryKind === 'directory')
        .filter(row => this.isVisibleSkillInventoryProductRow(row) && this.isFinishedSkillInventoryRow(row))
        .filter(row => this.skillInventoryRowDirectlyBelongsToMember(row, memberName))
        .map(row => row.productDisplayName || row.productFileName || row.title || row.relativePath || row.path)
        .filter(Boolean);
    },

    skillInventoryProductNameMatchesRow(productName = '', row = {}) {
      const productKey = this.normalizeValidationMatchText(productName);
      if (!productKey) return false;
      const rowNames = this.normalizeValidationNameCandidates([
        row.productDisplayName,
        row.productFileName,
        row.title,
        row.relativePath,
        row.path,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : [])
      ]);
      return rowNames.some(rowName => {
        const rowKey = this.normalizeValidationMatchText(rowName);
        return rowKey && rowKey.length >= 3 && productKey.length >= 3 && (rowKey === productKey || rowKey.includes(productKey) || productKey.includes(rowKey));
      });
    },

    finishedMemberProductItems(member = {}) {
      return (Array.isArray(member.productItems) ? member.productItems : [])
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .filter(item => !this.isFigmaUseConnectorText(item) && !this.isFigmaUseConnectorName(item))
        .filter(item => !/^适用场景/.test(item) && !/^为统一项目/.test(item) && !/^\s*Use when/i.test(item))
        .filter(item => this.isFinishedProductText(item));
    },

    isFinishedProductText(value = '') {
      const text = String(value || '').trim();
      if (!text || text.length < 2) return false;
      if (/待验证|待确认|进行中|测试中|草稿|draft|todo|未完成|问题|错误|临时|过程|对话记录|操作记录/i.test(text)) return false;
      return /(\.md|SKILL\.md|skill|规范|看板|组件|模板|插件|工具|流程|规则|资源|资产|design|board|dashboard|命名|整理|拆解|提取|下载)/i.test(text);
    },

    isVisibleSkillInventoryProductRow(row = {}) {
      if (this.isMemberArtReporterRow(row)) return true;
      if (this.isFigmaUseConnectorArtifact(row) || this.isFigmaUseConnectorArtifact(row.skill || {})) return false;
      if (row.skillInventoryKind === 'directory' || row.skill?.inventoryKind === 'directory') return true;
      if (row.skillInventoryKind === 'skill' || row.skill?.inventoryKind === 'skill') return true;
      const relativePath = String(row.skill?.git?.relativePath || row.relativePath || row.path || '').replace(/\\/g, '/');
      const title = String(row.productDisplayName || row.productFileName || row.title || '').trim();
      const source = String(row.source || '').trim();
      const haystack = `${relativePath}\n${title}\n${row.skill?.description || ''}\n${row.skill?.preview || ''}`;
      if (!relativePath && !title) return false;
      if (/^member-art-reporter\//i.test(relativePath) && !this.isMemberArtReporterRow(row)) return false;
      if (/(^|\/)(README|CODEX_RULES|AGENTS|CLAUDE)\.md$/i.test(relativePath)) return false;
      if (/(^|\/)(install|setup|report|auto-sync|troubleshooting|classification)\.md$/i.test(relativePath)) return false;
      if (source.startsWith('Git:')) return true;
      return /(\.md|SKILL\.md|skill|规范|组件|模板|流程|规则|资源|资产|design|命名|整理|拆解|提取)/i.test(haystack);
    },

    isFinishedSkillInventoryRow(row = {}) {
      if (this.isMemberArtReporterRow(row)) return true;
      if (row.skillInventoryKind === 'directory' || row.skill?.inventoryKind === 'directory') return true;
      const text = `${row.statusLabel || ''} ${row.title || ''} ${row.productDisplayName || ''} ${row.relativePath || ''}`;
      if (/验证失败|不可用|草稿|draft|未完成|临时|过程/.test(text)) return false;
      return this.isFinishedProductText(row.productDisplayName || row.productFileName || row.title || row.relativePath || row.path);
    },

    isFinishedAiAssetRow(row = {}) {
      const text = `${row.progressStatus || ''} ${row.verifyStatus || ''} ${row.publicStatus || ''} ${row.title || ''} ${row.finalPath || ''} ${row.skillPath || ''} ${row.fileLink || ''}`;
      if (/不继续|不适用|不用|不可用|未完成|草稿|过程/.test(text)) return false;
      if (/已完成|已公用|公用|可用|可直接复用|部分可用|已验证|1\/1|md|skill|\.md|SKILL/i.test(text)) return true;
      return this.isFinishedProductText(this.aiAssetDisplayFileName(row));
    },

    skillInventoryMemberAliases(memberName = '') {
      const members = Array.isArray(this.aiMembersSnapshot?.members) ? this.aiMembersSnapshot.members : [];
      const member = members.find(item => samePerson(item.name, memberName) || samePerson(item.account, memberName));
      return [memberName, member?.name, member?.account].filter(Boolean);
    },

    aiAssetRowBelongsToAliases(row = {}, aliases = []) {
      const values = [
        ...this.personList(row.owner),
        row.owner,
        row.flowOwner,
        row.availablePeople,
        row.updatedBy
      ].map(value => String(value || '').toLowerCase());
      return aliases.some(alias => {
        const text = String(alias || '').toLowerCase();
        if (!text) return false;
        return values.some(value => value.includes(text) || samePerson(value, text));
      });
    },

    aiAssetRowBelongsToMember(row = {}, memberName = '') {
      return this.aiAssetRowBelongsToAliases(row, this.skillInventoryMemberAliases(memberName));
    },

    applySkillInventoryMemberFilter(memberName = '') {
      this.skillInventoryMemberFilter = memberName || '';
      this.skillInventoryPreferMine = !memberName;
      this.aiAssetPage = 1;
      const keepAiAssetPage = this.skillInventoryTab === 'assets';
      this.skillInventoryTab = keepAiAssetPage ? 'assets' : 'list';
      this.skillInventoryPage = 1;
      this.pushRoute(keepAiAssetPage ? '/skills/assets' : '/skills/list');
    },

    skillValidationSourceLabel(record = {}) {
      if (Number(record.rowNumber || 0) > 0) return `#${record.rowNumber}`;
      const text = [record.originalSource, record.source, record.notes, record.sourceRef, record.updatedBy].join(' ');
      if (/Codex|自动|上报|art-progress|research/i.test(text)) return '自动';
      return '人工';
    },

    formatValidationSubmittedDate(value = '') {
      const text = String(value || '').trim();
      if (!text) return '-';
      const direct = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
      if (direct) return `${direct[1]}-${direct[2].padStart(2, '0')}-${direct[3].padStart(2, '0')}`;
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      return text.replace(/\./g, '-').slice(0, 10);
    },

    normalizeValidationMatchText(value = '') {
      return String(value || '')
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[\\/_.\-:：()[\]（）【】「」《》<>#?&=+，,。；;、\s]+/g, '')
        .replace(/^(研究|补充)+/g, '')
        .replace(/(?:文档|沉淀|方案|md|markdown|skill)$/g, '');
    },

    isGenericValidationMatchName(value = '') {
      const text = this.normalizeValidationMatchText(value);
      if (!text) return true;
      return /^(figma|mcp|codex|markdown|md|skill|skills|git|ai|design|工具|技能|文档|流程|规范|验证|平台|资源|图片|素材|截图|入口|入口图|界面|命名|说明|readme|agents|agent|memory|执行|试用|结构|名称|目录|路径|标准位置|完整说明|是否已执行)$/i.test(text);
    },

    validationMatchTokens(value = '') {
      const text = String(value || '').toLowerCase();
      const raw = text.split(/[\s\\/_.\-:：()[\]【】「」《》<>#?&=+，,。；;、]+/).filter(Boolean);
      const tokens = raw
        .map(part => part.replace(/^(研究|补充)+|(?:文档|沉淀|方案)$/g, ''))
        .filter(part => part.length >= 2 && !/^(md|markdown|ai|skill|figma|project|http|https|资源|规范|命名|文档)$/.test(part));
      const chinese = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
      return [...new Set([...tokens, ...chinese.filter(part => !/^(研究|资源|规范|命名|文档|沉淀|方案|流程|标准)$/.test(part))])];
    },

    validationRecordNameParts(values = []) {
      const output = [];
      for (const value of values) {
        const text = String(value || '').replace(/\\/g, '/');
        if (!text) continue;
        output.push(text);
        text
          .split(/\s+\/\s+|[，,；;\n]/)
          .map(part => part.trim())
          .filter(Boolean)
          .forEach(part => output.push(part));
        const pathMatches = text.match(/(?:[^\s`"'<>，。；;、]+\/)?[\u4e00-\u9fa5A-Za-z0-9_.-]+(?:\.(?:md|markdown)|\/SKILL\.md)/gi) || [];
        pathMatches.forEach(match => {
          output.push(match);
          this.validationConcreteNamesFromPath(match).forEach(part => output.push(part));
        });
      }
      return output;
    },

    validationConcreteNamesFromPath(value = '') {
      const parts = String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(part => part.trim())
        .filter(Boolean);
      const names = [];
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        const cleaned = part.replace(/\.(md|markdown)$/i, '').trim();
        if (cleaned && !this.isGenericValidationMatchName(cleaned)) names.push(cleaned);
        if (/^(skill|md|markdown)$/i.test(cleaned) && index > 0) {
          const parent = parts[index - 1].replace(/\.(md|markdown)$/i, '').trim();
          if (parent && !this.isGenericValidationMatchName(parent)) names.push(parent);
        }
      }
      return names.filter((name, index, array) => array.findIndex(item => this.normalizeValidationMatchText(item) === this.normalizeValidationMatchText(name)) === index);
    },

    validationTriggerCandidatesFromAsset(asset = {}) {
      const values = [
        asset.description,
        asset.preview,
        asset.templateNote,
        asset.dailyNote,
        asset.workflowScene,
        asset.skill?.description,
        asset.skill?.preview,
        asset.skill?.templateNote,
        ...(Array.isArray(asset.triggers) ? asset.triggers : []),
        ...(Array.isArray(asset.skill?.triggers) ? asset.skill.triggers : []),
        ...(Array.isArray(asset.scenes) ? asset.scenes : [])
      ];
      const matches = [];
      for (const value of values) {
        const text = String(value || '');
        if (!text) continue;
        const quoted = text.match(/[「《【“"]([^」》】”"]{2,40})[」》】”"]/g) || [];
        quoted.forEach(item => matches.push(item.replace(/^[「《【“"]|[」》】”"]$/g, '')));
        const triggerMatches = text.match(/(?:触发词|调用词|适用场景|用途|用于|用来)[:：]\s*([^\n。；;]+)/g) || [];
        triggerMatches.forEach(item => {
          String(item).split(/[:：]/).slice(1).join('：')
            .split(/[、,，；;\s]+/)
            .map(part => part.trim())
            .filter(Boolean)
            .forEach(part => matches.push(part));
        });
      }
      return matches;
    },

    validationStrongNameCandidatesFromRecord(record = {}) {
      return this.normalizeValidationNameCandidates([
        record.artifactName,
        record.researchName,
        record.scope,
        this.fileNameFromPath(record.artifactLocation),
        this.fileNameFromPath(record.sourceRef),
        ...this.validationRecordNameParts([
          record.researchName,
          record.artifactLocation,
          record.scope
        ])
      ]);
    },

    validationPrimaryNameCandidatesFromRecord(record = {}) {
      return this.normalizeValidationNameCandidates([
        record.artifactName,
        record.researchName,
        record.scope
      ]);
    },

    validationPathNameCandidatesFromRecord(record = {}) {
      return this.normalizeValidationNameCandidates([
        this.fileNameFromPath(record.artifactLocation),
        this.fileNameFromPath(record.sourceRef),
        ...this.validationRecordNameParts([
          record.artifactLocation,
          record.sourceRef
        ])
      ]);
    },

    validationNameCandidatesFromRecord(record = {}) {
      return this.normalizeValidationNameCandidates([
        ...this.validationStrongNameCandidatesFromRecord(record),
        ...this.validationRecordNameParts([
          record.notes
        ])
      ]);
    },

    validationNameCandidatesFromAsset(asset = {}) {
      const rawProjectName = String(asset.projectName || '').trim();
      const projectNameIsPath = /[\\/]/.test(rawProjectName);
      return this.normalizeValidationNameCandidates([
        asset.title,
        asset.productDisplayName,
        asset.productFileName,
        ...(Array.isArray(asset.aliases) ? asset.aliases : []),
        ...(Array.isArray(asset.skill?.aliases) ? asset.skill.aliases : []),
        projectNameIsPath ? '' : rawProjectName,
        this.fileNameFromPath(asset.projectName),
        this.fileNameFromPath(asset.finalPath),
        this.fileNameFromPath(asset.skillPath),
        this.fileNameFromPath(asset.fileLink),
        ...this.validationConcreteNamesFromPath(asset.projectName),
        ...this.validationConcreteNamesFromPath(asset.finalPath),
        ...this.validationConcreteNamesFromPath(asset.skillPath),
        ...this.validationConcreteNamesFromPath(asset.fileLink),
        ...this.validationTriggerCandidatesFromAsset(asset)
      ]);
    },

    normalizeValidationNameCandidates(values = []) {
      const blocked = /^(project|ai测试|ai|figma|mcp|codex|skill|skills|md|markdown|readme|agents|agents\.md|agent|memory|文档|规范|命名|资源|流程|标准|方案|沉淀|截图|入口|入口图|界面|执行|试用)$/i;
      const seen = new Set();
      const output = [];
      for (const value of values) {
        const text = String(value || '').trim();
        if (!text) continue;
        const cleaned = text
          .replace(/^#+\s*/g, '')
          .replace(/\.(md|markdown)$/i, '')
          .replace(/^(研究|补充)+/g, '')
          .replace(/(?:文档|沉淀|方案)$/g, '')
          .trim();
        if (!cleaned || cleaned.length < 2 || blocked.test(cleaned) || this.isGenericValidationMatchName(cleaned)) continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(cleaned);
      }
      return output;
    },

    validationAssetMatchScore(record = {}, asset = {}) {
      const sourceNames = this.validationNameCandidatesFromRecord(record);
      const assetNames = this.validationNameCandidatesFromAsset(asset);
      const sourceText = sourceNames.join(' ');
      const assetText = assetNames.join(' ');
      const sourceCompact = this.normalizeValidationMatchText(sourceText);
      const assetCompact = this.normalizeValidationMatchText(assetText);
      if (!sourceCompact || !assetCompact) return 0;
      if (sourceCompact === assetCompact) return this.isGenericValidationMatchName(sourceCompact) ? 0 : 1;
      if (sourceCompact.length >= 4 && !this.isGenericValidationMatchName(sourceCompact) && assetCompact.includes(sourceCompact)) return 0.96;
      if (assetCompact.length >= 4 && !this.isGenericValidationMatchName(assetCompact) && sourceCompact.includes(assetCompact)) return 0.92;
      const phraseHit = sourceNames.some(source => {
        const sourceValue = this.normalizeValidationMatchText(source);
        return assetNames.some(assetName => {
          const assetValue = this.normalizeValidationMatchText(assetName);
          return sourceValue
            && assetValue
            && sourceValue.length >= 4
            && assetValue.length >= 4
            && !this.isGenericValidationMatchName(sourceValue)
            && !this.isGenericValidationMatchName(assetValue)
            && (sourceValue.includes(assetValue) || assetValue.includes(sourceValue));
        });
      });
      if (phraseHit) return 0.9;
      const sourceTokens = this.validationMatchTokens(sourceText);
      const assetTokens = this.validationMatchTokens(assetText);
      if (!sourceTokens.length || !assetTokens.length) return 0;
      const matched = sourceTokens.filter(token => assetTokens.some(other => other.includes(token) || token.includes(other)));
      if (matched.length < 2) return 0;
      const coverage = matched.length / Math.max(1, sourceTokens.length);
      const reverseCoverage = matched.length / Math.max(1, assetTokens.length);
      return Math.max(coverage, (coverage + reverseCoverage) / 2);
    },

    validationExactNamePriority(record = {}, asset = {}) {
      const sourceNames = this.validationNameCandidatesFromRecord(record)
        .map(value => this.normalizeValidationMatchText(value))
        .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value));
      const assetNames = this.validationNameCandidatesFromAsset(asset)
        .map(value => this.normalizeValidationMatchText(value))
        .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value));
      if (!sourceNames.length || !assetNames.length) return 0;
      if (sourceNames.some(source => assetNames.some(assetName => source === assetName))) return 3;
      if (sourceNames.some(source => assetNames.some(assetName => source.length >= 6 && assetName.length >= 6 && (source.includes(assetName) || assetName.includes(source))))) return 2;
      return 0;
    },

    activeAiAssetRowsForValidation(rows = null) {
      const sourceRows = Array.isArray(rows) ? rows : this.aiAssetSheetRows;
      return sourceRows.filter(row => row && row.deleted !== true);
    },

    aiAssetRowsForValidation(record = {}) {
      const cacheKey = this.validationMatchCacheKey('ai', record);
      const cached = this.validationMatchCacheGet(cacheKey);
      if (cached) return cached;
      if (this.isFigmaUseConnectorRecord(record)) return [];
      if (this.isMemberArtReporterValidationRecord(record)) return [];
      const owner = this.isAutoSkillValidationRecord(record) ? '' : (record.owner || record.walkthroughOwner || '');
      const rows = this.activeAiAssetRowsForValidation(this.aiAssetSheetRows)
        .map(row => ({ row, score: this.validationAssetMatchScore(record, row) }))
        .filter(item => item.score >= 0.8)
        .filter(item => {
          if (!owner || owner === '待确认') return true;
          const ownerName = this.canonicalArtDeptPerson(owner);
          const rowOwners = this.personList(item.row.owner);
          const rowFlowOwner = this.canonicalArtDeptPerson(item.row.flowOwner);
          const validator = this.canonicalArtDeptPerson(record.validator);
          return rowOwners.some(rowOwner => samePerson(rowOwner, ownerName) || samePerson(validator, rowOwner))
            || samePerson(rowFlowOwner, ownerName);
        })
        .sort((a, b) => this.validationExactNamePriority(record, b.row) - this.validationExactNamePriority(record, a.row) || b.score - a.score)
        .map(item => item.row);
      this.validationMatchCacheSet(cacheKey, rows);
      return rows;
    },

    skillRowsForValidation(record = {}) {
      const cacheKey = this.validationMatchCacheKey('skill', record);
      const cached = this.validationMatchCacheGet(cacheKey);
      if (cached) return cached;
      if (this.isFigmaUseConnectorRecord(record)) return [];
      if (this.isMemberArtReporterValidationRecord(record)) {
        const rows = this.memberArtReporterRowsForValidation();
        this.validationMatchCacheSet(cacheKey, rows);
        return rows;
      }
      const owner = this.isAutoSkillValidationRecord(record) ? '' : (record.owner || record.walkthroughOwner || '');
      const inventoryMatches = this.skillInventoryValidationCandidateRows
        .map(row => ({ row, score: this.validationAssetMatchScore(record, {
          title: row.title,
          projectName: row.projectName,
          finalPath: row.relativePath || row.path,
          skillPath: row.relativePath || row.path,
          fileLink: row.path,
          dailyNote: Array.isArray(row.scenes) ? row.scenes.join(' ') : String(row.scenes || '')
        }) }))
        .filter(item => item.score >= 0.8)
        .filter(item => !owner
          || owner === '待确认'
          || item.score >= 0.95
          || this.skillInventoryRowBelongsToMember(item.row, owner)
          || samePerson(this.canonicalArtDeptPerson(record.validator), this.canonicalArtDeptPerson(item.row.uploader)))
        .sort((a, b) => this.validationExactNamePriority(record, b.row) - this.validationExactNamePriority(record, a.row) || b.score - a.score)
        .map(item => item.row);
      const rows = inventoryMatches.length ? inventoryMatches : this.memberProductRowsForValidation(record);
      this.validationMatchCacheSet(cacheKey, rows);
      return rows;
    },

    validationMatchCacheKey(scope = '', record = {}) {
      const recordKey = [
        record.id,
        record.updatedAt,
        record.createdAt,
        record.submittedAt,
        record.artifactName,
        record.researchName,
        record.artifactLocation,
        record.sourceRef,
        record.owner,
        record.validator
      ].map(value => String(value || '').trim()).join('|');
      return [
        scope,
        recordKey,
        this.aiAssetSheetRows.length,
        this.skillInventoryValidationCandidateRows.length
      ].join('::');
    },

    validationMatchCacheGet(key = '') {
      if (!this._validationMatchCache || !key) return null;
      const value = this._validationMatchCache.get(key);
      return Array.isArray(value) ? value : null;
    },

    validationMatchCacheSet(key = '', rows = []) {
      if (!key) return;
      if (!this._validationMatchCache) this._validationMatchCache = new Map();
      if (this._validationMatchCache.size > 500) this._validationMatchCache.clear();
      this._validationMatchCache.set(key, Array.isArray(rows) ? rows : []);
    },

    clearValidationMatchCache() {
      if (this._validationMatchCache) this._validationMatchCache.clear();
    },

    isMemberArtReporterValidationRecord(record = {}) {
      const text = [
        record.researchName,
        record.artifactName,
        record.artifactLocation,
        record.scope
      ].map(value => String(value || '')).join('\n').replace(/\\/g, '/');
      return /(^|[^a-z0-9])(?:member-art-reporter|art-progress-reporter)(?=$|[^a-z0-9])/i.test(text);
    },

    memberArtReporterRowsForValidation() {
      return this.skillInventoryRows.filter(row => this.isMemberArtReporterRow(row));
    },

    memberProductRowsForValidation(record = {}) {
      const owner = this.canonicalArtDeptPerson(record.owner || record.walkthroughOwner || '');
      const autoRecord = this.isAutoSkillValidationRecord(record);
      const members = Array.isArray(this.skillInventoryMemberSummaries) ? this.skillInventoryMemberSummaries : [];
      return members
        .flatMap(member => (member.purposes || []).map((title, index) => {
          const row = {
            id: `member-product-${member.name}-${index}-${title}`,
            title,
            uploader: member.name,
            owner: member.name,
            source: '成员产物',
            projectName: '成员产物',
            relativePath: title,
            path: title,
            productDisplayName: title
          };
          return {
            row,
            ownerPriority: !autoRecord && owner && owner !== '待确认' && (samePerson(member.name, owner) || samePerson(member.account, owner)) ? 1 : 0
          };
        }))
        .map(item => ({ ...item, score: this.validationAssetMatchScore(record, item.row) }))
        .filter(item => item.score >= 0.8)
        .sort((a, b) => b.score - a.score || b.ownerPriority - a.ownerPriority)
        .map(item => item.row);
    },

    validationMemberProductCardEntries() {
      const members = Array.isArray(this.aiMembersSnapshot?.members) ? this.aiMembersSnapshot.members : [];
      return members.flatMap(member => {
        const owner = this.canonicalArtDeptPerson(member.name) || String(member.name || '').trim();
        if (!owner) return [];
        return this.aiBoardMemberProductItems(member)
          .map(productName => String(productName || '').trim())
          .filter(Boolean)
          .map(productName => {
            const aliases = this.normalizeValidationNameCandidates([
              productName,
              this.fileNameFromPath(productName),
              ...this.validationConcreteNamesFromPath(productName)
            ]);
            const keys = aliases
              .map(value => this.normalizeValidationMatchText(value))
              .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value))
              .filter((value, index, array) => array.indexOf(value) === index);
            return {
              owner,
              productName,
              aliases,
              keys
            };
          })
          .filter(entry => entry.keys.length);
      });
    },

    validationInventoryAliasesForMemberProduct(productName = '') {
      return this.skillInventoryRows
        .filter(row => row.hidden !== true)
        .filter(row => this.validationMemberProductMatchesInventoryRow(productName, row))
        .flatMap(row => [
          row.productDisplayName,
          row.productFileName,
          row.title,
          this.fileNameFromPath(row.relativePath || row.path || row.skill?.git?.relativePath),
          ...this.validationConcreteNamesFromPath(row.relativePath || row.path || row.skill?.git?.relativePath),
          ...(Array.isArray(row.aliases) ? row.aliases : []),
          ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : []),
          ...(Array.isArray(row.aliasHistory) ? row.aliasHistory : []),
          ...(Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : [])
        ]);
    },

    validationWeakMemberProductKey(value = '') {
      const key = this.normalizeValidationMatchText(value);
      return /^(命名规范|设计规范|交互规范|平台规范|资源规范|切图规范)$/.test(key);
    },

    validationMemberProductMatchesInventoryRow(productName = '', row = {}) {
      const productKeys = this.normalizeValidationNameCandidates([
        productName,
        this.fileNameFromPath(productName),
        ...this.validationConcreteNamesFromPath(productName)
      ])
        .map(value => this.normalizeValidationMatchText(value))
        .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value))
        .filter((value, index, array) => array.indexOf(value) === index);
      if (!productKeys.length) return false;
      const rowKeys = this.normalizeValidationNameCandidates([
        row.productDisplayName,
        row.productFileName,
        row.title,
        row.relativePath,
        row.path,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : []),
        ...(Array.isArray(row.aliasHistory) ? row.aliasHistory : []),
        ...(Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : [])
      ])
        .map(value => this.normalizeValidationMatchText(value))
        .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value))
        .filter((value, index, array) => array.indexOf(value) === index);
      if (!rowKeys.length) return false;
      if (productKeys.some(productKey => rowKeys.some(rowKey => productKey === rowKey))) return true;
      return productKeys.some(productKey => (
        !this.validationWeakMemberProductKey(productKey)
        && rowKeys.some(rowKey => (
          productKey.length >= 4
          && rowKey.length >= 4
          && !this.validationWeakMemberProductKey(rowKey)
          && (productKey.includes(rowKey) || rowKey.includes(productKey))
        ))
      ));
    },

    validationMemberProductOwnerEntries() {
      return this.validationMemberProductCardEntries()
        .map(entry => {
          const aliases = this.normalizeValidationNameCandidates([
            entry.productName,
            ...(entry.aliases || []),
            ...this.validationInventoryAliasesForMemberProduct(entry.productName)
          ]);
          const keys = aliases
            .map(value => this.normalizeValidationMatchText(value))
            .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value))
            .filter((value, index, array) => array.indexOf(value) === index);
          return { ...entry, aliases, keys };
        })
        .filter(entry => entry.keys.length);
    },

    validationOwnerListFromMemberProducts(record = {}) {
      const matches = this.validationBestProductOwnerEntryMatches(record);
      if (!matches.length) return [];
      const topScore = matches[0].score;
      return matches
        .filter(entry => entry.score === topScore)
        .map(entry => entry.owner)
        .filter((owner, index, array) => array.findIndex(item => samePerson(item, owner)) === index);
    },

    validationProductOwnerMatches(sourceKeys = [], entries = []) {
      const matches = this.validationProductOwnerEntryMatches(sourceKeys, entries);
      if (!matches.length) return [];
      const topScore = matches[0].score;
      return matches
        .filter(entry => entry.score === topScore)
        .map(entry => entry.owner)
        .filter((owner, index, array) => array.findIndex(item => samePerson(item, owner)) === index);
    },

    validationNormalizedMatchKeys(values = []) {
      return this.normalizeValidationNameCandidates(values)
        .map(value => this.normalizeValidationMatchText(value))
        .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value))
        .filter((value, index, array) => array.indexOf(value) === index);
    },

    validationRecordMatchKeyGroups(record = {}) {
      const primary = this.validationNormalizedMatchKeys(this.validationPrimaryNameCandidatesFromRecord(record));
      const pathKeys = this.validationNormalizedMatchKeys(this.validationPathNameCandidatesFromRecord(record))
        .filter(key => !primary.includes(key));
      const fallback = this.validationNormalizedMatchKeys(this.validationNameCandidatesFromRecord(record))
        .filter(key => !primary.includes(key) && !pathKeys.includes(key));
      return [
        { weight: 300, keys: primary },
        { weight: 200, keys: pathKeys },
        { weight: 100, keys: fallback }
      ].filter(group => group.keys.length);
    },

    validationBestProductOwnerEntryMatches(record = {}) {
      const entries = this.validationMemberProductOwnerEntries();
      if (!entries.length) return [];
      const groups = this.validationRecordMatchKeyGroups(record);
      const matches = [];
      for (const group of groups) {
        const groupMatches = this.validationProductOwnerEntryMatches(group.keys, entries)
          .map(entry => ({ ...entry, score: entry.score + group.weight }));
        matches.push(...groupMatches);
      }
      if (!matches.length) return [];
      const byOwnerProduct = new Map();
      for (const match of matches) {
        const key = `${match.owner}::${match.productName}`;
        const previous = byOwnerProduct.get(key);
        if (!previous || match.score > previous.score) byOwnerProduct.set(key, match);
      }
      return [...byOwnerProduct.values()].sort((left, right) => right.score - left.score);
    },

    validationProductOwnerEntryMatches(sourceKeys = [], entries = []) {
      return entries
        .map(entry => {
          const exact = sourceKeys.some(source => entry.keys.some(key => source === key));
          const sharedFeature = sourceKeys.some(source => entry.keys.some(key => this.validationSharedSpecificFeatureMatch(source, key)));
          const phrase = sourceKeys.some(source => entry.keys.some(key => (
            source.length >= 8
            && key.length >= 8
            && !this.isGenericValidationMatchName(source)
            && !this.isGenericValidationMatchName(key)
            && (source.includes(key) || key.includes(source))
          )));
          return {
            ...entry,
            score: exact ? 3 : sharedFeature ? 2.5 : phrase ? 2 : 0
          };
        })
        .filter(entry => entry.score > 0)
        .sort((left, right) => right.score - left.score);
    },

    validationSharedSpecificFeatureMatch(left = '', right = '') {
      if (!left || !right || left === right) return false;
      if (this.validationWeakMemberProductKey(left) || this.validationWeakMemberProductKey(right)) return false;
      const features = ['svg图标', '平台交互', '图层', '资源拆解', '资源输出', '禅道美术', '美术摘要', '弹窗缩放', '组件系统'];
      return features.some(feature => left.includes(feature) && right.includes(feature));
    },

    validationDesignSuiteKey(record = {}) {
      const text = [
        record.artifactName,
        record.researchName,
        record.scope,
        record.artifactLocation,
        record.projectName,
        record.finalPath,
        record.skillPath,
        record.fileLink
      ].map(value => String(value || '')).join('\n');
      if (!/design/i.test(text)) return '';
      const match = text.match(/\bmain\s*[-_ ]?\s*(\d{1,3})\b/i);
      return match ? `main${match[1]}` : '';
    },

    validationDesignSuiteAiAssetRow(record = {}, aiRows = null) {
      const suiteKey = this.validationDesignSuiteKey(record);
      if (!suiteKey) return null;
      const preferredRows = Array.isArray(aiRows) ? aiRows : [];
      const allRows = this.activeAiAssetRowsForValidation(this.aiAssetSheetRows);
      const sourceRows = [
        ...this.activeAiAssetRowsForValidation(preferredRows),
        ...allRows.filter(row => !preferredRows.some(item => item?.id && row?.id && item.id === row.id))
      ];
      const suiteMatches = sourceRows
        .filter(row => row && row.deleted !== true)
        .filter(row => {
          const rowText = [
            row.title,
            row.projectName,
            row.finalPath,
            row.skillPath,
            row.fileLink
          ].map(value => String(value || '')).join('\n');
          return /design/i.test(rowText) && this.normalizeValidationMatchText(rowText).includes(suiteKey);
        })
        .map(row => ({ row, score: this.validationAssetMatchScore(record, row) }))
        .filter(item => item.score >= 0.8 || this.normalizeValidationMatchText(item.row.title).includes(suiteKey))
        .sort((a, b) => b.score - a.score);
      return suiteMatches[0]?.row || null;
    },

    validationMappedSuiteOwnerName(record = {}, aiRows = null) {
      const suiteAsset = this.validationDesignSuiteAiAssetRow(record, aiRows);
      if (!suiteAsset) return '';
      return this.displayPersonList(suiteAsset.owner);
    },

    validationInventoryAssetFromRow(row = {}) {
      return {
        title: row.title,
        projectName: row.projectName,
        finalPath: row.relativePath || row.path || row.skill?.git?.relativePath || '',
        skillPath: row.relativePath || row.path || row.skill?.git?.relativePath || '',
        fileLink: row.path,
        dailyNote: Array.isArray(row.scenes) ? row.scenes.join(' ') : String(row.scenes || '')
      };
    },

    validationExplicitFileKeysFromRecord(record = {}) {
      const values = [
        record.artifactName,
        record.researchName,
        record.scope,
        record.artifactLocation,
        record.sourceRef,
        record.notes
      ];
      const output = [];
      for (const value of values) {
        const text = String(value || '').replace(/\\/g, '/');
        if (!text) continue;
        const matches = text.match(/(?:[^\s`"'<>，。；;、]+\/)?[\u4e00-\u9fa5A-Za-z0-9_.-]+(?:\.(?:md|markdown)|\/SKILL\.md)/gi) || [];
        for (const match of matches) {
          const concreteNames = this.validationConcreteNamesFromPath(match);
          for (const name of concreteNames.length ? concreteNames : [this.fileNameFromPath(match)]) {
            const key = this.normalizeValidationMatchText(name);
            if (!key || key.length < 4 || this.isGenericValidationMatchName(key)) continue;
            if (!output.includes(key)) output.push(key);
          }
        }
      }
      return output;
    },

    validationRowFileKeys(row = {}) {
      return [
        row.productFileName,
        row.productDisplayName,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : []),
        ...(Array.isArray(row.aliasHistory) ? row.aliasHistory : []),
        ...(Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : []),
        this.fileNameFromPath(row.relativePath),
        this.fileNameFromPath(row.path),
        this.fileNameFromPath(row.skill?.git?.relativePath),
        this.fileNameFromPath(row.skill?.relativePath),
        this.fileNameFromPath(row.skill?.path),
        ...this.validationConcreteNamesFromPath(row.relativePath),
        ...this.validationConcreteNamesFromPath(row.path),
        ...this.validationConcreteNamesFromPath(row.skill?.git?.relativePath),
        ...this.validationConcreteNamesFromPath(row.skill?.relativePath),
        ...this.validationConcreteNamesFromPath(row.skill?.path)
      ]
        .map(value => this.normalizeValidationMatchText(value))
        .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value))
        .filter((value, index, array) => array.indexOf(value) === index);
    },

    validationRowMatchesExplicitFile(record = {}, row = {}) {
      const recordKeys = this.validationExplicitFileKeysFromRecord(record);
      if (!recordKeys.length) return true;
      const rowKeys = this.validationRowFileKeys(row);
      return recordKeys.some(recordKey => rowKeys.some(rowKey => recordKey === rowKey));
    },

    validationExactMemberRowsForOwner(record = {}, memberRows = []) {
      const rows = (Array.isArray(memberRows) ? memberRows : [])
        .filter(row => row && row.hidden !== true)
        .filter(row => this.validationRowMatchesExplicitFile(record, row));
      const sourceRows = rows.length
        ? rows
        : (Array.isArray(memberRows) ? memberRows : []).filter(row => row && row.hidden !== true);
      return sourceRows
        .map(row => ({
          row,
          exact: this.validationExactNamePriority(record, this.validationInventoryAssetFromRow(row)),
          score: this.validationAssetMatchScore(record, this.validationInventoryAssetFromRow(row))
        }))
        .filter(item => item.exact >= 2 || item.score >= 0.95)
        .sort((a, b) => b.exact - a.exact || b.score - a.score)
        .map(item => item.row);
    },

    validationStrongAiAssetRowsForOwner(record = {}, aiRows = []) {
      const sourceNames = this.validationNameCandidatesFromRecord(record)
        .map(value => this.normalizeValidationMatchText(value))
        .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value));
      if (!sourceNames.length) return [];
      return this.activeAiAssetRowsForValidation(aiRows)
        .map(row => {
          const targetNames = this.normalizeValidationNameCandidates([
            row.title,
            this.aiAssetDisplayFileName(row),
            this.fileNameFromPath(row.skillPath),
            this.fileNameFromPath(row.fileLink),
            this.fileNameFromPath(row.finalPath)
          ])
            .map(value => this.normalizeValidationMatchText(value))
            .filter(value => value && value.length >= 4 && !this.isGenericValidationMatchName(value));
          const exact = sourceNames.some(source => targetNames.some(target => source === target));
          const phrase = sourceNames.some(source => targetNames.some(target => (
            source.length >= 6
            && target.length >= 6
            && (source.includes(target) || target.includes(source))
          )));
          return {
            row,
            exact,
            phrase,
            score: this.validationAssetMatchScore(record, row)
          };
        })
        .filter(item => item.exact || (item.phrase && item.score >= 0.9))
        .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score)
        .map(item => item.row);
    },

    validationOwnerListFromValues(values = []) {
      return values
        .flatMap(value => this.canonicalPersonList(value))
        .filter(person => person && person !== '-' && person !== '待确认' && this.isArtDeptPerson(person))
        .filter((person, index, array) => array.findIndex(item => samePerson(item, person)) === index);
    },

    validationOwnerListFromMemberRows(memberRows = []) {
      const values = (Array.isArray(memberRows) ? memberRows : []).flatMap(row => [
        this.mergedSkillInventoryOwner(row, ''),
        row.skill?.ownerOverride,
        row.owner,
        row.uploader,
        row.flowOwner,
        row.skill?.owner,
        row.skill?.uploaderName,
        this.uploaderFromSource(row.source),
        this.uploaderFromSource(row.skill?.source),
        ...(Array.isArray(row.skill?.git?.history) ? row.skill.git.history.map(item => item.authorName || item.authorEmail) : []),
        row.skill?.git?.authorName,
        row.skill?.git?.committerName
      ]);
      return this.validationOwnerListFromValues(values);
    },

    validationOwnerListFromAiRows(aiRows = []) {
      return this.validationOwnerListFromValues(
        this.activeAiAssetRowsForValidation(aiRows).flatMap(row => [row.owner, row.flowOwner])
      );
    },

    validationOwnerListFromMatches(record = {}, memberRows = [], aiRows = []) {
      const exactAiOwners = this.validationOwnerListFromAiRows(this.validationStrongAiAssetRowsForOwner(record, aiRows));
      if (exactAiOwners.length) return exactAiOwners;
      const exactMemberOwners = this.validationOwnerListFromMemberRows(this.validationExactMemberRowsForOwner(record, memberRows));
      if (exactMemberOwners.length) return exactMemberOwners;
      return [];
    },

    validationMappedOwnerName(record = {}, memberMatches = null, aiMatches = null) {
      const knownMembers = Array.isArray(this.skillInventoryMemberSummaries) ? this.skillInventoryMemberSummaries : [];
      const memberRows = Array.isArray(memberMatches) ? memberMatches : this.skillRowsForValidation(record);
      const aiRows = Array.isArray(aiMatches) ? aiMatches : this.aiAssetRowsForValidation(record);
      const memberProductOwners = this.validationOwnerListFromMemberProducts(record);
      if (memberProductOwners.length) return memberProductOwners.join('、');
      const suiteOwner = this.validationMappedSuiteOwnerName(record, aiRows);
      if (suiteOwner) return suiteOwner;
      const matchedOwners = this.validationOwnerListFromMatches(record, memberRows, aiRows);
      if (matchedOwners.length) return matchedOwners.join('、');
      const recordOwner = this.displayPersonList(record.owner || '');
      if (!this.isAutoSkillValidationRecord(record) && recordOwner && recordOwner !== '-' && recordOwner !== '待确认') return recordOwner;
      const resolvePerson = value => {
        for (const person of this.canonicalPersonList(value)) {
          const member = knownMembers.find(item => samePerson(item.name, person) || samePerson(item.account, person));
          if (member?.name) return member.name;
          const canonical = this.canonicalArtDeptPerson(person);
          if (canonical && this.isArtDeptPerson(canonical)) return canonical;
        }
        return '';
      };
      const candidateGroups = [
        memberRows.flatMap(row => [
          row.uploader,
          row.owner,
          row.flowOwner,
          row.skill?.uploaderName,
          row.skill?.owner,
          row.skill?.git?.authorName,
          row.skill?.git?.committerName,
          this.uploaderFromSource(row.source),
          this.uploaderFromSource(row.skill?.source)
        ]),
        this.validationStrongAiAssetRowsForOwner(record, aiRows).flatMap(row => [row.owner, row.flowOwner]),
        [record.owner, record.walkthroughOwner]
      ];
      for (const group of candidateGroups) {
        for (const value of group) {
          const person = resolvePerson(value);
          if (person) return person;
        }
      }
      return '';
    },

    validationDisplayValidatorName(record = {}) {
      const direct = this.canonicalArtDeptPerson(record.validator || '');
      if (direct && direct !== '-' && direct !== '待确认') return direct;
      const sourceRef = String(record.sourceRef || '').trim();
      if (sourceRef) {
        const event = (this.artProgressEvents || []).find(item => String(item.id || '') === sourceRef);
        const eventPerson = this.canonicalArtDeptPerson(event?.memberName || event?.memberAccount || '');
        if (eventPerson && eventPerson !== '-' && eventPerson !== '待确认') return eventPerson;
      }
      const reporter = this.canonicalArtDeptPerson(record.memberName || record.memberAccount || record.reporterName || record.reporterAccount || record.submittedBy || '');
      if (reporter && reporter !== '-' && reporter !== '待确认') return reporter;
      const fallback = this.canonicalArtDeptPerson(record.walkthroughOwner || '');
      return fallback && fallback !== '-' && fallback !== '待确认' ? fallback : '';
    },

    validationDisplayOwnerName(record = {}, memberMatches = null, aiMatches = null) {
      const manualOwner = this.displayPersonList(record.owner || '');
      const memberProductOwners = this.validationOwnerListFromMemberProducts(record);
      if (memberProductOwners.length) return this.displayPersonList(memberProductOwners.join('、'));
      if (record.manualOwnerOverride === true && manualOwner && manualOwner !== '-' && manualOwner !== '待确认') {
        return manualOwner;
      }
      const mappedOwner = this.validationMappedOwnerName(record, memberMatches, aiMatches);
      if (mappedOwner) return this.displayPersonList(mappedOwner);
      if (manualOwner && manualOwner !== '-' && manualOwner !== '待确认') return manualOwner;
      return '';
    },

    validationDisplayArtifactName(record = {}) {
      const memberRows = Array.isArray(record.matchedMemberSkills) ? record.matchedMemberSkills : this.skillRowsForValidation(record);
      const aiRows = Array.isArray(record.matchedAiAssets) ? record.matchedAiAssets : this.aiAssetRowsForValidation(record);
      const productMatch = this.validationBestProductOwnerEntryMatches(record)[0];
      const suiteMatch = this.validationDesignSuiteAiAssetRow(record, aiRows);
      const firstMember = memberRows.find(row => row && row.hidden !== true);
      const firstAsset = suiteMatch || aiRows.find(row => row && row.deleted !== true);
      const values = [
        productMatch?.productName,
        firstMember?.productDisplayName,
        firstMember?.productFileName,
        firstMember?.title,
        this.fileNameFromPath(firstMember?.relativePath || firstMember?.path || firstMember?.skill?.git?.relativePath),
        this.aiAssetDisplayFileName(firstAsset),
        firstAsset?.title,
        record.artifactName,
        record.scope,
        record.researchName
      ];
      return values
        .map(value => String(value || '').trim().replace(/^#+\s*/g, '').replace(/^Skill[：:\s]+/i, ''))
        .find(value => value && !this.isGenericValidationMatchName(value)) || '';
    },

    shouldShowValidationArtifactCount(record = {}) {
      const count = Number(record.validationArtifactCount || 0);
      if (count <= 1) return false;
      return this.validationRecordValidatorMatchesSingleOwner(record);
    },

    validationRecordValidatorMatchesSingleOwner(record = {}) {
      const validator = this.validationDisplayValidatorName(record);
      if (!validator) return false;
      const mappedOwners = this.validationOwnerListFromMemberProducts(record);
      if (!mappedOwners.length) return false;
      const owners = this.personList(mappedOwners.join('、'))
        .filter(owner => owner && owner !== '-' && owner !== '待确认');
      return owners.length === 1 && samePerson(validator, owners[0]);
    },

    validationMappedMemberTarget(record = {}, memberMatches = [], aiMatches = []) {
      const productOwners = this.validationOwnerListFromMemberProducts(record);
      if (productOwners.length) return productOwners[0];
      const suiteOwner = this.validationMappedSuiteOwnerName(record, aiMatches);
      if (suiteOwner) return this.personList(suiteOwner)[0] || suiteOwner;
      const mappedOwner = this.validationDisplayOwnerName(record, memberMatches, aiMatches);
      const mappedOwnerPerson = this.personList(mappedOwner)[0];
      if (mappedOwnerPerson) return mappedOwnerPerson;
      const knownMembers = this.skillInventoryMemberSummaries || [];
      const candidates = [
        ...this.validationExactMemberRowsForOwner(record, memberMatches).flatMap(row => [row.uploader, row.owner, row.flowOwner, row.skill?.uploaderName, row.skill?.owner, row.skill?.git?.authorName]),
        ...this.validationStrongAiAssetRowsForOwner(record, aiMatches).flatMap(row => [row.owner, row.flowOwner]),
        record.owner,
        record.walkthroughOwner
      ];
      for (const value of candidates) {
        for (const person of this.canonicalPersonList(value)) {
          const member = knownMembers.find(item => samePerson(item.name, person) || samePerson(item.account, person));
          if (member?.name) return member.name;
        }
      }
      return '';
    },

    validationMappedProductKeyword(record = {}, match = {}) {
      return [
        match.productDisplayName,
        match.productFileName,
        match.title,
        this.aiAssetDisplayFileName(match),
        this.fileNameFromPath(match.relativePath || match.path || match.finalPath || match.skillPath || match.fileLink),
        record.artifactName,
        record.researchName,
        record.scope
      ].map(value => String(value || '').trim()).find(Boolean) || '';
    },

    openSkillInventoryMemberTarget(memberName = '', keyword = '') {
      this.skillInventoryTab = 'assets';
      this.skillInventoryMemberFilter = memberName || '';
      this.skillInventoryPreferMine = false;
      this.skillInventoryKeyword = keyword || '';
      this.skillInventoryPage = 1;
      this.aiAssetPage = 1;
      if (this.skillInventoryKeyword && !this.filteredSkillInventoryRows.length) this.skillInventoryKeyword = '';
      this.pushRoute('/skills/assets');
    },

    openSkillInventoryFromValidation(record = {}) {
      const aiMatches = Array.isArray(record.matchedAiAssets) ? record.matchedAiAssets : this.aiAssetRowsForValidation(record);
      const memberMatches = Array.isArray(record.matchedMemberSkills) ? record.matchedMemberSkills : this.skillRowsForValidation(record);
      const memberTarget = this.validationMappedMemberTarget(record, memberMatches, aiMatches);
      if (memberTarget) {
        const suiteMatch = this.validationDesignSuiteAiAssetRow(record, aiMatches);
        const firstMatch = suiteMatch || memberMatches[0] || aiMatches[0] || {};
        this.openSkillInventoryMemberTarget(memberTarget, this.validationMappedProductKeyword(record, firstMatch));
        return;
      }
      if (aiMatches.length) {
        this.skillInventoryTab = 'events';
        this.aiAssetKeyword = this.validationMappedProductKeyword(record, aiMatches[0]) || record.artifactName || record.researchName || record.scope || '';
        this.aiAssetStatusFilter = '';
        this.aiAssetPage = 1;
        this.pushRoute('/skills/events');
        return;
      }
      if (memberMatches.length) {
        const first = memberMatches[0];
        this.openSkillInventoryMemberTarget(first.uploader || record.owner || record.walkthroughOwner || '', this.validationMappedProductKeyword(record, first));
        return;
      }
      this.skillInventoryTab = 'events';
      this.aiAssetKeyword = record.artifactName || record.researchName || record.scope || '';
      this.aiAssetStatusFilter = '';
      this.aiAssetPage = 1;
      this.pushRoute('/skills/events');
    },

    toggleSkillInventoryHiddenView() {
      this.skillInventoryShowHidden = !this.skillInventoryShowHidden;
      this.skillInventoryPage = 1;
    },

    async scanProject(id) {
      if (!this.canRefreshSkillInventoryScan) {
        ElMessage.warning('当前角色没有刷新库存扫描的权限');
        return;
      }
      this.loading.scan = true;
      this.scanOutput = '扫描中...';
      try {
        const scan = await this.api(`/api/projects/${encodeURIComponent(id)}/scan?refresh=1`);
        const nextScan = this.mergeProjectScanResult(id, scan);
        this.scans = { ...this.scans, [id]: nextScan };
        this.clearValidationMatchCache();
        this.clearSkillUsageLogCache();
        this.saveWorkbenchDisplayCache('scans', this.scans);
        if (id === this.selectedProjectId) {
          const rows = Array.isArray(nextScan.tasks) ? nextScan.tasks : [];
          this.detailProjectTasks = rows;
          this.detailPagedProjectTasks = rows.slice(0, this.taskPageSize);
        }
        this.scanOutput = JSON.stringify({
          configs: nextScan.configs,
          skills: (nextScan.skills || []).map(skill => ({ id: skill.id, title: skill.title, triggers: skill.triggers })),
          tasks: (nextScan.tasks || []).slice(0, 20),
          detected: nextScan.detected,
          preserved: nextScan.preserved === true,
          error: nextScan.error || ''
        }, null, 2);
        if (['task-result', 'manual-review'].includes(this.activeView) && id === this.selectedProjectId && !this.selectedTask) {
          this.syncRoute();
        }
      } catch (error) {
        const previous = this.scans[id];
        if (previous) {
          const preserved = {
            ...previous,
            preserved: true,
            lastError: this.readApiError(error) || error.message || '扫描失败',
            lastFailedAt: new Date().toISOString()
          };
          this.scans = { ...this.scans, [id]: preserved };
          this.clearSkillUsageLogCache();
          this.saveWorkbenchDisplayCache('scans', this.scans);
          this.scanOutput = preserved.lastError;
        } else {
          this.scanOutput = error.message;
          ElMessage.error('项目扫描失败');
        }
      } finally {
        this.loading.scan = false;
      }
    },

    async scanSingleSkillSource(project = {}) {
      if (!project?.id) return null;
      if (!this.canRefreshSkillInventoryScan) {
        ElMessage.warning('当前角色没有库存扫描权限');
        return null;
      }
      const previous = this.scans[project.id];
      this.loading.scan = true;
      this.scanOutput = `正在扫描来源「${project.name || project.id}」...`;
      try {
        const scan = await this.apiWithTimeout(`/api/projects/${encodeURIComponent(project.id)}/scan?refresh=1`, {}, {}, 45000);
        const nextScan = this.mergeProjectScanResult(project.id, scan);
        this.scans = { ...this.scans, [project.id]: nextScan };
        this.clearValidationMatchCache();
        this.clearSkillUsageLogCache();
        this.saveWorkbenchDisplayCache('scans', this.scans);
        this.skillInventoryScanCacheLoaded = true;
        this.scanOutput = `已扫描来源「${project.name || project.id}」：${nextScan.skills?.length || 0} 个产物。`;
        return nextScan;
      } catch (error) {
        if (previous) {
          this.scans = {
            ...this.scans,
            [project.id]: {
              ...previous,
              preserved: true,
              lastError: this.readApiError(error) || error.message || '扫描失败',
              lastFailedAt: new Date().toISOString()
            }
          };
          this.saveWorkbenchDisplayCache('scans', this.scans);
        }
        this.scanOutput = previous ? '扫描失败，已保留该来源上次库存。' : (this.readApiError(error) || '扫描失败');
        ElMessage.warning(this.scanOutput);
        return null;
      } finally {
        this.loading.scan = false;
      }
    },

    async loadProjectScanCacheForInventory() {
      if (this.loading.skillInventoryCache) return;
      this.loading.skillInventoryCache = true;
      this.scanOutput = '正在读取库存缓存...';
      try {
        if (!this.projects.length) {
          this.projects = await this.apiWithTimeout('/api/projects', {}, {}, 15000);
          this.saveWorkbenchDisplayCache('projects', this.projects);
          if (!this.selectedProjectId && this.projects[0]) this.selectedProjectId = this.projects[0].id;
        }
        const result = await this.apiWithTimeout('/api/project-scan-cache', {}, {}, 15000);
        const scans = result?.scans && typeof result.scans === 'object' ? result.scans : {};
        this.skillInventoryScanCacheLoaded = true;
        if (Object.keys(scans).length) {
          const scanMap = {};
          const knownProjectIds = new Set(this.projects.map(project => project.id));
          for (const [projectId, scan] of Object.entries(scans)) {
            if (!scan || typeof scan !== 'object') continue;
            scanMap[projectId] = this.mergeProjectScanResult(projectId, scan);
            if (!knownProjectIds.has(projectId)) {
              this.projects.push(this.projectFromCachedScan(projectId, scan));
              knownProjectIds.add(projectId);
            }
          }
          this.scans = { ...this.scans, ...scanMap };
          this.clearValidationMatchCache();
          this.clearSkillUsageLogCache();
          this.saveWorkbenchDisplayCache('projects', this.projects);
          this.saveWorkbenchDisplayCache('scans', this.scans);
          const selectedScan = this.scans[this.selectedProjectId];
          this.scanOutput = selectedScan
            ? `已读取库存缓存：${selectedScan.skills?.length || 0} 个产物，${selectedScan.tasks?.length || 0} 个历史任务。`
            : '已读取库存缓存。';
          return;
        }
        if (!this.skillInventoryRows.length) this.scanOutput = '暂无库存缓存，请点击刷新库存后读取。';
      } catch (error) {
        this.skillInventoryScanCacheLoaded = true;
        const hasCachedRows = this.skillInventoryRows.length > 0;
        this.scanOutput = hasCachedRows
          ? '库存缓存读取失败，已保留当前清单。'
          : '库存缓存读取失败，请点击刷新库存后重新读取。';
      } finally {
        this.loading.skillInventoryCache = false;
      }
    },

    async ensureRunProjectScanCache(projectId = '') {
      const id = String(projectId || this.runForm.projectId || this.selectedProjectId || '').trim();
      if (!id || this.scans[id]) return;
      if (!this.projects.length) {
        this.projects = await this.apiWithTimeout('/api/projects', {}, {}, 15000);
        this.saveWorkbenchDisplayCache('projects', this.projects);
        if (!this.selectedProjectId && this.projects[0]) this.selectedProjectId = this.projects[0].id;
      }
      const result = await this.apiWithTimeout('/api/project-scan-cache', {}, {}, 15000);
      const scans = result?.scans && typeof result.scans === 'object' ? result.scans : {};
      if (!scans[id]) return;
      this.scans = { ...this.scans, [id]: this.mergeProjectScanResult(id, scans[id]) };
      this.clearValidationMatchCache();
      this.clearSkillUsageLogCache();
      this.saveWorkbenchDisplayCache('scans', this.scans);
    },

    async loadSkillInventorySavedSnapshot(options = {}) {
      const force = options.force === true;
      const silent = options.silent === true;
      if (this.loading.skillInventoryCache) return;
      if (this.skillInventoryRows.length) {
        this.skillInventoryScanCacheLoaded = true;
        if (!force) return;
      }
      this.loading.skillInventoryCache = true;
      if (!silent) this.scanOutput = '正在读取上次库存数据...';
      try {
        if (!this.projects.length) {
          this.projects = await this.apiWithTimeout('/api/projects', {}, {}, 15000);
          this.saveWorkbenchDisplayCache('projects', this.projects);
          if (!this.selectedProjectId && this.projects[0]) this.selectedProjectId = this.projects[0].id;
        }
        const result = await this.apiWithTimeout('/api/project-scan-cache', {}, {}, 15000);
        const scans = result?.scans && typeof result.scans === 'object' ? result.scans : {};
        const scanMap = {};
        const knownProjectIds = new Set(this.projects.map(project => project.id));
        for (const [projectId, scan] of Object.entries(scans)) {
          if (!scan || typeof scan !== 'object') continue;
          scanMap[projectId] = this.mergeProjectScanResult(projectId, scan);
          if (!knownProjectIds.has(projectId)) {
            this.projects.push(this.projectFromCachedScan(projectId, scan));
            knownProjectIds.add(projectId);
          }
        }
        this.scans = { ...this.scans, ...scanMap };
        this.clearValidationMatchCache();
        this.clearSkillUsageLogCache();
        this.saveWorkbenchDisplayCache('projects', this.projects);
        this.saveWorkbenchDisplayCache('scans', this.scans);
        this.skillInventoryScanCacheLoaded = true;
        if (!silent) this.scanOutput = Object.keys(scanMap).length
          ? '已读取上次库存数据。'
          : '暂无上次库存数据，请由有权限账号点击刷新库存。';
      } catch (error) {
        this.skillInventoryScanCacheLoaded = true;
        this.restoreWorkbenchDisplayCacheKey('projects');
        this.restoreWorkbenchDisplayCacheKey('scans');
        if (!silent) this.scanOutput = this.skillInventoryRows.length
          ? '库存数据读取失败，已保留当前清单。'
          : '库存数据读取失败，请稍后重试或由有权限账号刷新库存。';
      } finally {
        this.loading.skillInventoryCache = false;
      }
    },

    projectFromCachedScan(projectId = '', scan = {}) {
      return {
        id: projectId,
        name: scan.projectName || scan.name || projectId,
        rootPath: scan.rootPath || '',
        framework: scan.framework || scan.detected?.framework || '未知',
        sourceType: scan.sourceType || 'git',
        createdAt: scan.scannedAt || scan.cachedAt || ''
      };
    },

    async scanAllProjects() {
      if (!this.canRefreshSkillInventoryScan) {
        ElMessage.warning('当前角色没有刷新库存扫描的权限');
        return;
      }
      if (this.loading.scan) return;
      if (!this.projects.length) {
        this.projects = await this.apiWithTimeout('/api/projects', {}, {}, 15000);
        this.saveWorkbenchDisplayCache('projects', this.projects);
        if (!this.selectedProjectId && this.projects[0]) this.selectedProjectId = this.projects[0].id;
      }
      if (!this.projects.length) {
        this.scanOutput = '暂无扫描源，请先接入 Git、本地目录或共享盘路径。';
        ElMessage.warning(this.scanOutput);
        return;
      }
      await this.loadSkillInventorySavedSnapshot({ force: true, silent: true });
      this.loading.scan = true;
      this.scanOutput = '正在同步美术资料库 Git 仓库并索引库存...';
      try {
        const previousInventoryRows = this.skillInventoryRows.map(row => ({ ...row, skill: { ...(row.skill || {}) } }));
        const previousRowCount = previousInventoryRows.length;
        const artGitProject = this.projects.find(project => {
          const rootPath = String(project.rootPath || '');
          const remoteUrl = String(project.git?.remoteUrl || '');
          return rootPath.endsWith('/data/art-git') || /art-project\/Art\.git/i.test(remoteUrl);
        });
        const scanProjects = artGitProject ? [artGitProject] : this.projects;
        const entries = await Promise.all(scanProjects.map(async project => {
          try {
            const scan = await this.apiWithTimeout(`/api/projects/${encodeURIComponent(project.id)}/scan?refresh=1`, {}, {}, 45000);
            return [project.id, this.mergeProjectScanResult(project.id, scan)];
          } catch (error) {
            const previous = this.scans[project.id];
            if (previous) {
              return [project.id, {
                ...previous,
                preserved: true,
                lastError: this.readApiError(error) || error.message || '扫描失败',
                lastFailedAt: new Date().toISOString()
              }];
            }
            return null;
          }
        }));
        const scanMap = Object.fromEntries(entries.filter(Boolean));
        if (!Object.keys(scanMap).length) {
          this.scanOutput = previousRowCount
            ? '刷新库存失败，已保留上次扫描内容。'
            : '刷新库存失败，暂无可展示的上次扫描内容。';
          ElMessage.warning(this.scanOutput);
          return;
        }
        this.scans = { ...this.scans, ...scanMap };
        this.clearValidationMatchCache();
        this.clearSkillUsageLogCache();
        this.saveWorkbenchDisplayCache('scans', this.scans);
        this.skillInventoryScanCacheLoaded = true;
        if (artGitProject && this.selectedProjectId !== artGitProject.id) {
          this.selectedProjectId = artGitProject.id;
        }
        const activeProjectId = artGitProject?.id || this.selectedProjectId;
        const rows = Array.isArray(scanMap[activeProjectId]?.tasks) ? scanMap[activeProjectId].tasks : [];
        this.detailProjectTasks = rows;
        this.detailPagedProjectTasks = rows.slice(0, this.taskPageSize);
        const selectedScan = this.scans[activeProjectId];
        const scanChangeSummary = this.skillInventoryScanChangeSummary(previousInventoryRows, scanMap);
        const preservedScans = Object.values(scanMap).filter(scan => scan?.preserved === true || scan?.lastError);
        this.scanOutput = selectedScan
          ? JSON.stringify({
            configs: selectedScan.configs,
            skills: (selectedScan.skills || []).map(skill => ({ id: skill.id, title: skill.title, triggers: skill.triggers })),
            tasks: (selectedScan.tasks || []).slice(0, 20),
            detected: selectedScan.detected,
            error: selectedScan.error
          }, null, 2)
          : '已完成美术资料库库存同步。';
        if (preservedScans.length) {
          const reason = preservedScans.map(scan => scan.lastError || scan.error).filter(Boolean)[0] || '本次刷新未读取到新库存';
          ElMessage.warning(`刷新库存失败，已保留上次扫描内容：${reason}`);
          return;
        }
        const nextRows = this.skillInventoryRows.length;
        const changeText = [
          scanChangeSummary.added ? `新增 ${scanChangeSummary.added}` : '',
          scanChangeSummary.changed ? `变更 ${scanChangeSummary.changed}` : '',
          scanChangeSummary.removed ? `删除 ${scanChangeSummary.removed}` : ''
        ].filter(Boolean).join('，');
        ElMessage.success(changeText ? `库存扫描已更新：${changeText}` : (nextRows === previousRowCount ? '库存扫描已完成，未发现内容变化' : '库存扫描已更新'));
      } catch (error) {
        this.scanOutput = this.skillInventoryRows.length
          ? '刷新库存超时或失败，已保留上次扫描内容。'
          : (this.readApiError(error) || '刷新库存失败，请稍后重试。');
        ElMessage.warning(this.scanOutput);
      } finally {
        this.loading.scan = false;
      }
    },

    skillInventoryScanChangeSummary(previousRows = [], nextScanMap = {}) {
      const scannedProjectIds = new Set(Object.keys(nextScanMap || {}));
      const previousByKey = new Map();
      for (const row of Array.isArray(previousRows) ? previousRows : []) {
        if (scannedProjectIds.size && !scannedProjectIds.has(String(row.projectId || ''))) continue;
        const key = this.skillInventoryChangeKey(row);
        if (key) previousByKey.set(key, this.skillInventoryChangeFingerprint(row));
      }
      const nextByKey = new Map();
      for (const [projectId, scan] of Object.entries(nextScanMap || {})) {
        const projectRow = this.projectRows.find(project => project.id === projectId) || this.projectFromCachedScan(projectId, scan);
        const skills = Array.isArray(scan?.skills) ? scan.skills : [];
        for (const skill of skills) {
          const row = this.buildSkillInventoryRow(projectRow, skill);
          const key = this.skillInventoryChangeKey(row);
          if (key) nextByKey.set(key, this.skillInventoryChangeFingerprint(row));
        }
      }
      let added = 0;
      let changed = 0;
      let removed = 0;
      for (const [key, fingerprint] of nextByKey.entries()) {
        if (!previousByKey.has(key)) {
          added += 1;
          continue;
        }
        if (previousByKey.get(key) !== fingerprint) changed += 1;
      }
      for (const key of previousByKey.keys()) {
        if (!nextByKey.has(key)) removed += 1;
      }
      return { added, changed, removed };
    },

    skillInventoryChangeKey(row = {}) {
      return [
        row.projectId || '',
        row.skill?.git?.relativePath || row.relativePath || row.path || '',
        row.id || row.uid || row.productDisplayName || row.title || ''
      ].join('::');
    },

    skillInventoryChangeFingerprint(row = {}) {
      const skill = row.skill || row;
      return [
        skill.git?.commit || '',
        skill.git?.uploadedAt || '',
        skill.commitSubject || '',
        skill.uploadedAt || row.uploadedAt || '',
        skill.version || row.version || '',
        skill.hidden === true || row.hidden === true ? 'hidden' : 'visible',
        skill.title || row.title || '',
        skill.description || row.description || '',
        String(skill.preview || row.preview || '').slice(0, 2400)
      ].join('\n');
    },

    mergeProjectScanResult(projectId = '', scan = {}) {
      const previous = this.scans[projectId] || null;
      if (!previous) return scan;
      const nextSkills = Array.isArray(scan.skills) ? scan.skills : [];
      const nextTasks = Array.isArray(scan.tasks) ? scan.tasks : [];
      const keepPreviousSkills = previous.skills?.length && !nextSkills.length && scan.error;
      const keepPreviousTasks = previous.tasks?.length && !nextTasks.length && scan.error;
      return {
        ...previous,
        ...scan,
        skills: keepPreviousSkills ? previous.skills : nextSkills,
        tasks: keepPreviousTasks ? previous.tasks : nextTasks,
        preserved: Boolean(keepPreviousSkills || keepPreviousTasks || scan.preserved),
        lastError: scan.error || scan.lastError || ''
      };
    },

    scanOf(id) {
      return this.scans[id] || null;
    },

    projectDetailTasks() {
      const rowTasks = this.projectRows.find(item => item.id === this.selectedProjectId)?.scan?.tasks;
      if (Array.isArray(rowTasks)) return rowTasks;
      const scanTasks = this.scans[this.selectedProjectId]?.tasks;
      return Array.isArray(scanTasks) ? scanTasks : [];
    },

    pagedProjectDetailTasks() {
      const rows = this.projectDetailTasks();
      const size = Math.max(Number(this.taskPageSize) || 50, 1);
      const page = Math.max(Number(this.taskPage) || 1, 1);
      return rows.slice((page - 1) * size, page * size);
    },

    syncDetailProjectTasks(tasks) {
      const rows = Array.isArray(tasks) ? tasks : (this.scans[this.selectedProjectId]?.tasks || []);
      this.detailProjectTasks = Array.isArray(rows) ? rows : [];
      const size = Math.max(Number(this.taskPageSize) || 50, 1);
      const maxPage = Math.max(1, Math.ceil(this.detailProjectTasks.length / size));
      const page = Math.min(Math.max(Number(this.taskPage) || 1, 1), maxPage);
      this.detailPagedProjectTasks = this.detailProjectTasks.slice((page - 1) * size, page * size);
    },

    getSelectedProject() {
      return this.projects.find(project => project.id === this.selectedProjectId) || null;
    },

    getSelectedScan() {
      return this.scans[this.selectedProjectId] || null;
    },

    getProjectTasksForDetail() {
      const tasks = this.getSelectedScan()?.tasks;
      return Array.isArray(tasks) ? tasks : [];
    },

    getPagedProjectTasksForDetail() {
      const tasks = this.getProjectTasksForDetail();
      const rows = paginate(tasks, this.taskPage, this.taskPageSize);
      return rows.length || !tasks.length ? rows : paginate(tasks, 1, this.taskPageSize);
    },

    getProjectDescription() {
      const project = this.getSelectedProject();
      const scan = this.getSelectedScan();
      if (!project) return '';
      const taskCount = this.getProjectTasksForDetail().length;
      const skillCount = scan?.skills?.length || 0;
      const framework = project.framework || scan?.framework || '未知';
      return `${project.name} 是一个 ${framework} 项目，当前已索引 ${taskCount} 个任务、${skillCount} 个技能路由。这里用于沉淀项目配置、任务执行记录、审计报告和交付证据。`;
    },

    getSelectedProjectStats() {
      const row = this.projectRows.find(item => item.id === this.selectedProjectId);
      if (!row) return [];
      return [
        { label: '技能路由数', value: row.skillCount },
        { label: '任务数', value: row.taskCount },
        { label: '报告数', value: row.reportCount },
        { label: '证据数', value: row.evidenceCount },
        { label: '平均闭环度', value: `${row.completion}%` },
        { label: '接入状态', value: row.health }
      ];
    },

    getVisibleSkills() {
      return (this.getSelectedScan()?.skills || []).slice(0, 18);
    },

    getScanSummary() {
      if (this.loading.scan) return '正在扫描项目配置、技能和历史任务。';
      const scan = this.getSelectedScan();
      if (!scan) return '选择项目后自动扫描配置、技能和历史任务。';
      const configOk = scan.configs?.agentConfig?.exists && scan.configs?.skillConfig?.exists;
      const skillCount = scan.skills?.length || 0;
      const taskCount = scan.tasks?.length || 0;
      if (scan.error) return `扫描失败：${scan.error}`;
      if (configOk && skillCount && taskCount) return `已识别 ${skillCount} 个技能、${taskCount} 个历史任务，项目可进入平台调度。`;
      if (configOk && skillCount) return `已识别 ${skillCount} 个技能，暂无历史任务产物。`;
      return '项目协议还不完整，请补齐 AGENTS 或技能配置后再调度。';
    },

    getReadiness() {
      const scan = this.getSelectedScan();
      if (!scan) {
        return [
          { label: 'AGENTS 入口', value: '待扫描', status: '等待', type: 'info' },
          { label: '技能配置', value: '待扫描', status: '等待', type: 'info' },
          { label: '包管理', value: '待扫描', status: '等待', type: 'info' }
        ];
      }
      return [
        {
          label: 'AGENTS 入口',
          value: scan.configs?.agentConfig?.exists ? '已发现' : '缺失',
          status: scan.configs?.agentConfig?.exists ? '正常' : '需补齐',
          type: scan.configs?.agentConfig?.exists ? 'success' : 'danger'
        },
        {
          label: '技能配置',
          value: scan.configs?.skillConfig?.exists ? '已接入' : '缺失',
          status: scan.configs?.skillConfig?.exists ? '正常' : '需补齐',
          type: scan.configs?.skillConfig?.exists ? 'success' : 'warning'
        },
        {
          label: '包管理',
          value: scan.detected?.packageManager || '未知',
          status: scan.detected?.packageManager && scan.detected.packageManager !== 'unknown' ? '正常' : '待识别',
          type: scan.detected?.packageManager && scan.detected.packageManager !== 'unknown' ? 'success' : 'info'
        }
      ];
    },

    selectSkill(skill) {
      this.selectedSkillId = skill.id;
      this.openSkillPreview(skill);
    },
    async openSkillInventoryDetail(row = {}) {
      const project = this.projects.find(item => item.id === row.projectId);
      if (project) this.selectedProjectId = project.id;
      await this.openSkillPreview(row.skill || row);
    },

    openDirectSkillRunDialog(row = this.skillPreview.skill || {}) {
      if (!this.can('run.directSkill.create')) {
        ElMessage.warning('当前账号没有创建直接执行的权限');
        return;
      }
      const projectId = row.projectId || this.selectedProjectId || this.projects[0]?.id || '';
      if (projectId && !this.scans[projectId]) this.ensureRunProjectScanCache(projectId).catch(() => {});
      if (this.can('api.users.manage') && !this.users.length && !this.loading.users) this.refreshUsers().catch(() => {});
      const currentUserId = this.currentUser?.id || '';
      this.directSkillRunDialog = {
        visible: true,
        row: { ...row, projectId },
        figmaLinks: '',
        figmaWriteMode: 'target-node',
        assignedToUserId: currentUserId,
        requirement: '',
        submitting: false
      };
    },

    async createDirectSkillRun() {
      const dialog = this.directSkillRunDialog;
      const row = dialog.row || {};
      const projectId = row.projectId || this.selectedProjectId || this.projects[0]?.id || '';
      const skillPath = this.directSkillPath(row);
      const figmaLinks = String(dialog.figmaLinks || '').trim();
      if (!projectId) {
        ElMessage.warning('请先选择项目');
        return;
      }
      if (!skillPath) {
        ElMessage.warning('当前产物缺少可执行的 Skill 或 md 路径');
        return;
      }
      if (!figmaLinks) {
        ElMessage.warning('请填写 Figma 链接');
        return;
      }
      const assignee = this.directSkillAssigneeOptions.find(user => user.id === dialog.assignedToUserId) || this.currentUser || {};
      const productName = row.productDisplayName || row.productFileName || row.title || this.fileNameFromPath(skillPath) || 'AI 产物';
      const primarySkillContent = this.skillContentCache[row.id] || row.preview || row.skill?.preview || this.skillPreviewText || '';
      dialog.submitting = true;
      try {
        const run = await this.api('/api/runs', {
          method: 'POST',
          body: JSON.stringify({
            projectId,
            title: `直接执行 ${productName}`,
            productName,
            sourceTitle: row.title || row.productDisplayName || row.productFileName || '',
            primarySkillPath: skillPath,
            primarySkillContent,
            stage: skillPath,
            selectedMaterialHints: [skillPath],
            figmaLinks,
            figmaWriteMode: dialog.figmaWriteMode || 'target-node',
            assignedToUserId: assignee.id || this.currentUser?.id || '',
            assignedToName: assignee.displayName || assignee.username || this.defaultRunDeveloperName,
            developer: assignee.displayName || assignee.username || this.defaultRunDeveloperName,
            requirement: dialog.requirement,
            sourceType: 'direct-skill',
            executionMode: 'direct-skill'
          })
        });
        this.runs = [run, ...this.runs.filter(item => item.id !== run.id)];
        this.selectedRunId = run.id;
        this.directSkillRunDialog.visible = false;
        this.skillPreview.visible = false;
        this.activeView = 'runs';
        this.pushRoute('/runs');
        await this.refreshRuns();
        ElMessage.success('直接执行已创建，等待对应组员本机 Worker 领取');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '直接执行创建失败');
      } finally {
        dialog.submitting = false;
      }
    },

    directSkillPath(row = {}) {
      return row.skill?.git?.relativePath
        || row.relativePath
        || row.skill?.relativePath
        || row.path
        || row.skill?.path
        || row.finalPath
        || row.skillPath
        || '';
    },

    normalizeUsageMatchText(value = '') {
      return String(value || '').replace(/\\/g, '/').toLowerCase();
    },

    usageCompactMatchText(value = '') {
      return this.normalizeUsageMatchText(value)
        .replace(/\.(md|markdown)/g, '')
        .replace(/[\\/_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '');
    },

    isGenericUsageNeedle(value = '') {
      const text = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\.(md|markdown)$/i, '')
        .replace(/[\\/_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '');
      if (!text) return true;
      return /^(figma|mcp|codex|markdown|md|skill|skills|git|ai|data|artgit|artgitskills|工具|技能|文档|流程|规范|验证|平台|资源|图片|素材|截图|入口|入口图|悬浮入口|界面|命名|说明|readme|agents|memory)$/i.test(text);
    },

    isGenericUsageFileTarget(value = '') {
      const text = String(value || '')
        .trim()
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .pop()
        ?.replace(/\.(md|markdown)$/i, '')
        .toLowerCase()
        .replace(/[_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '') || '';
      if (!text) return true;
      return /^(agents|agent|readme|memory|codexrules|codexrule|安装说明|安装包|同步器|上报器|试用|执行|文件本体)$/i.test(text)
        || this.isGenericUsageNeedle(text);
    },

    usageConcreteNamesFromPath(value = '') {
      const parts = String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(part => part.trim())
        .filter(Boolean);
      const names = [];
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index].replace(/^[#\[]+|[\]]+$/g, '').trim();
        const cleaned = part.replace(/\.(md|markdown)$/i, '').trim();
        if (cleaned && !this.isGenericUsageFileTarget(cleaned)) names.push(cleaned);
        if (/^(skill|md|markdown)$/i.test(cleaned) && index > 0) {
          const parent = parts[index - 1].replace(/\.(md|markdown)$/i, '').trim();
          if (parent && !this.isGenericUsageFileTarget(parent)) names.push(parent);
        }
      }
      return names
        .map(name => name.replace(/^[#\[]+|[\]]+$/g, '').trim())
        .filter(Boolean)
        .filter((name, index, array) => array.findIndex(item => this.normalizeUsageMatchText(item) === this.normalizeUsageMatchText(name)) === index);
    },

    usageExplicitTargetsFromText(value = '') {
      const text = String(value || '').replace(/\\/g, '/');
      if (!text) return [];
      const matches = text.match(/(?:[^\s`"'<>，。；;、]+\/)?[\u4e00-\u9fa5A-Za-z0-9_.-]+(?:\.(?:md|markdown)|\/SKILL\.md)/gi) || [];
      return matches
        .flatMap(match => [
          match,
          this.fileNameFromPath(match),
          ...this.usageConcreteNamesFromPath(match)
        ])
        .map(value => String(value || '').trim())
        .filter(value => value && value.length >= 3 && !this.isGenericUsageFileTarget(value))
        .filter((value, index, array) => array.findIndex(item => this.normalizeUsageMatchText(item) === this.normalizeUsageMatchText(value)) === index);
    },

    usageExplicitTargetsFromRecord(item = {}, source = 'art-progress') {
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      const values = source === 'validation'
        ? [
            item.artifactName,
            item.researchName,
            item.artifactLocation,
            item.sourceRef,
            item.workflowScene,
            item.notes
          ]
        : [
            item.skillId,
            item.skillName,
            item.repoPath,
            item.title,
            metadata.path,
            metadata.filePath,
            metadata.finalPath,
            metadata.skillPath,
            metadata.artifactPath,
            metadata.artifactLocation,
            ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : []),
            ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : []),
            ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts.flatMap(artifact => [artifact.id, artifact.name, artifact.path]) : []),
            ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts.flatMap(artifact => [artifact.id, artifact.name, artifact.path]) : [])
          ];
      return values
        .flatMap(value => {
          const text = String(value || '').trim();
          if (!text) return [];
          const explicit = this.usageExplicitTargetsFromText(text);
          if (explicit.length) return explicit;
          const compactValue = text.length <= 180 && !/[\n\r]/.test(text);
          if (!compactValue) return [];
          return text.includes('/') || text.includes('\\')
            ? [this.fileNameFromPath(text), ...this.usageConcreteNamesFromPath(text)]
            : [text];
        })
        .map(value => String(value || '').trim())
        .filter(value => value && value.length >= 3 && !this.isGenericUsageFileTarget(value))
        .filter((value, index, array) => array.findIndex(item => this.normalizeUsageMatchText(item) === this.normalizeUsageMatchText(value)) === index);
    },

    usageRowExplicitTargetKeys(row = {}) {
      return [
        row.productFileName,
        row.productDisplayName,
        row.displayName,
        row.commonName,
        row.title,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : []),
        ...(Array.isArray(row.aliasHistory) ? row.aliasHistory : []),
        ...(Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : []),
        row.skill?.productDisplayName,
        row.skill?.displayName,
        row.skill?.commonName,
        this.fileNameFromPath(row.relativePath),
        this.fileNameFromPath(row.path),
        this.fileNameFromPath(row.skill?.git?.relativePath),
        ...this.usageConcreteNamesFromPath(row.relativePath),
        ...this.usageConcreteNamesFromPath(row.path),
        ...this.usageConcreteNamesFromPath(row.skill?.git?.relativePath),
        ...this.usageConcreteNamesFromPath(row.skill?.path)
      ]
        .map(value => this.usageCounterKeyForProduct(value))
        .filter(value => value && value.length >= 4 && !this.isGenericUsageNeedle(value))
        .filter((value, index, array) => array.indexOf(value) === index);
    },

    usageCounterKeyForProduct(value = '') {
      const text = String(value || '')
        .trim()
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .pop()
        ?.replace(/\.(md|markdown)$/i, '')
        .toLowerCase()
        .replace(/[_.\-:：()[\]【】「」《》<>#?&=+，,。；;、\s]+/g, '') || '';
      return text;
    },

    usageRecordTargetsInventoryRow(item = {}, row = {}, source = 'art-progress') {
      const targets = this.usageExplicitTargetsFromRecord(item, source)
        .map(value => this.usageCounterKeyForProduct(value))
        .filter(value => value && value.length >= 4 && !this.isGenericUsageNeedle(value));
      if (!targets.length) return true;
      const rowKeys = this.usageRowExplicitTargetKeys(row);
      if (!rowKeys.length) return true;
      const aliasKeys = [
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : []),
        ...(Array.isArray(row.aliasHistory) ? row.aliasHistory : []),
        ...(Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : [])
      ]
        .map(value => this.usageCounterKeyForProduct(value))
        .filter(value => value && value.length >= 4 && !this.isGenericUsageNeedle(value));
      const context = source === 'validation' ? this.usageContextTextFromValidation(item) : this.usageContextTextFromArtProgress(item);
      const compactContext = this.usageCompactMatchText(context);
      if (aliasKeys.some(alias => compactContext.includes(alias))) return true;
      return targets.some(target => rowKeys.some(rowKey => target === rowKey));
    },

    isFigmaUseConnectorText(value = '') {
      const text = String(value || '').replace(/\\/g, '/').toLowerCase();
      if (!text) return false;
      return /(^|[^a-z0-9])(?:use[-_ ]?figma|figma[-_ ]?use|mcp__figma__use_figma|figma[-_ ]?mcp|mcp[-_ ]?figma|codex[-_ ]?reporter|art[-_ ]?progress[-_ ]?reporter|member[-_ ]?art[-_ ]?reporter|install(?:er)?|安装包|上报器|同步器)(?=$|[^a-z0-9])/i.test(text)
        || /连接工作类型|安装测试|接入完成|研究沉淀同步安装|工作台上报/.test(text);
    },

    isMemberArtReporterText(value = '') {
      const text = String(value || '').replace(/\\/g, '/').toLowerCase();
      if (!text) return false;
      return /(^|[^a-z0-9])(?:member-art-reporter|art-progress-reporter)(?=$|[^a-z0-9])/i.test(text)
        || text.includes('美术工作台研究沉淀同步')
        || text.includes('美术 ai 研究沉淀')
        || text.includes('美术ai研究沉淀');
    },

    isFigmaUseConnectorName(value = '') {
      const rawName = String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .pop()
        ?.replace(/\.(md|markdown)$/i, '') || '';
      if (!/^(use[-_ ]?figma|figma[-_ ]?use|mcp__figma__use_figma|mcp[-_ ]?figma[-_ ]?use|figma[-_ ]?mcp|mcp[-_ ]?figma|codex[-_ ]?reporter|art[-_ ]?progress[-_ ]?reporter|member[-_ ]?art[-_ ]?reporter|install(?:er)?|安装包|上报器|同步器)$/i.test(rawName.trim())) return false;
      const text = rawName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
      return text === 'usefigma'
        || text === 'figmause'
        || text === 'mcpfigmause'
        || text === 'mcpfigmausefigma'
        || text === 'figmamcp'
        || text === 'mcpfigma'
        || text === 'codexreporter'
        || text === 'artprogressreporter'
        || text === 'memberartreporter'
        || text === 'installer';
    },

    isFigmaUseConnectorArtifact(skill = {}) {
      const directValues = [
        skill.id,
        skill.title,
        skill.productDisplayName,
        skill.productFileName
      ];
      if (directValues.some(value => this.isFigmaUseConnectorName(value))) return true;
      const pathValues = [
        skill.path,
        skill.relativePath,
        skill.git?.relativePath,
        skill.productGroupPath
      ];
      return pathValues.some(value => String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).some(part => this.isFigmaUseConnectorName(part)));
    },

    isFigmaUseConnectorRecord(record = {}) {
      const targetValues = [
        record.skillId,
        record.skillName,
        record.artifactName,
        record.researchName,
        record.scope,
        record.sourceRef,
        record.artifactLocation,
        record.evidenceLink,
        record.workflowScene,
        record.title,
        record.repoPath,
        record.metadata?.path,
        record.metadata?.filePath,
        record.metadata?.skillPath,
        record.metadata?.artifactPath
      ];
      return targetValues.some(value => this.isFigmaUseConnectorName(value) || this.isFigmaUseConnectorText(value));
    },

    skillInventoryNeedles(row = {}) {
      const pathValues = [row.relativePath, row.path, row.skill?.git?.relativePath, row.skill?.path, row.skill?.productGroupPath]
        .map(value => String(value || '').replace(/\\/g, '/').trim())
        .filter(Boolean);
      const fileValues = [row.productFileName, row.productDisplayName, ...pathValues.map(value => this.fileNameFromPath(value))]
        .map(value => String(value || '').trim())
        .filter(value => value && value.length >= 4 && !this.isGenericUsageNeedle(value));
      const nameValues = [row.id, row.title]
        .map(value => String(value || '').trim())
        .filter(value => value && value.length >= 6 && !this.isGenericUsageNeedle(value));
      const aliasValues = [
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : []),
        ...(Array.isArray(row.aliasHistory) ? row.aliasHistory : []),
        ...(Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : [])
      ]
        .map(value => String(value || '').trim())
        .filter(value => value && value.length >= 4 && !this.isGenericUsageNeedle(value));
      return {
        paths: [...new Set(pathValues.map(value => value.toLowerCase()))],
        files: [...new Set(fileValues.map(value => value.toLowerCase()))],
        names: [...new Set(nameValues.map(value => value.toLowerCase()))],
        aliases: [...new Set(aliasValues.map(value => value.toLowerCase()))]
      };
    },

    strictUsageTextFromArtProgress(item = {}) {
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      return this.normalizeUsageMatchText([
        item.skillId,
        item.skillName,
        item.repoPath,
        item.title,
        item.stage,
        metadata.path,
        metadata.filePath,
        metadata.finalPath,
        metadata.skillPath,
        metadata.artifactPath,
        metadata.artifactLocation,
        ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : []),
        ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : []),
        ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts.flatMap(artifact => [artifact.id, artifact.name, artifact.path, artifact.type]) : []),
        ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts.flatMap(artifact => [artifact.id, artifact.name, artifact.path, artifact.type]) : []),
        metadata.source,
        metadata.sessionId
      ].map(value => String(value || '')).join('\n'));
    },

    isNonAssetUsageRecord(item = {}, source = 'art-progress') {
      if (source === 'validation') {
        if (this.isDistributedConfigValidationRecord(item)) return true;
        const targets = this.usageExplicitTargetsFromRecord(item, source);
        if (targets.length && targets.every(target => this.isGenericUsageFileTarget(target))) return true;
        return false;
      }
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      const text = [
        item.eventType,
        item.skillId,
        item.skillName,
        item.title,
        item.stage,
        item.summary,
        item.repoPath,
        metadata.source,
        metadata.path,
        metadata.filePath,
        metadata.skillPath,
        metadata.artifactPath,
        ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : [])
      ].map(value => String(value || '')).join('\n');
      const explicitTargets = this.usageExplicitTargetsFromRecord(item, source);
      const onlyGenericTargets = explicitTargets.length > 0 && explicitTargets.every(target => this.isGenericUsageFileTarget(target));
      const isInstallOrConfig = /安装|解压|上报器|同步器|member-art-reporter|art-progress-reporter|CODEX_RULES|AGENTS\.md instructions|研究沉淀同步规则|前置配置|配置通用指南|api[_-]?key|powershell|cmd/i.test(text);
      return onlyGenericTargets && isInstallOrConfig;
    },

    usageContextTextFromArtProgress(item = {}) {
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      return this.normalizeUsageMatchText([
        item.eventType,
        item.skillId,
        item.skillName,
        item.repoPath,
        item.title,
        item.stage,
        item.summary,
        metadata.path,
        metadata.filePath,
        metadata.finalPath,
        metadata.skillPath,
        metadata.artifactPath,
        metadata.artifactLocation,
        ...(Array.isArray(metadata.artifactPaths) ? metadata.artifactPaths : []),
        ...(Array.isArray(metadata.artifactNames) ? metadata.artifactNames : []),
        ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts.flatMap(artifact => [artifact.id, artifact.name, artifact.path, artifact.type]) : []),
        ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts.flatMap(artifact => [artifact.id, artifact.name, artifact.path, artifact.type]) : []),
        metadata.source,
        metadata.sessionId
      ].map(value => String(value || '')).join('\n'));
    },

    strictUsageTextFromValidation(item = {}) {
      return this.normalizeUsageMatchText([
        item.artifactName,
        item.researchName,
        item.artifactLocation,
        item.sourceRef,
        item.evidenceLink,
        item.workflowScene
      ].map(value => String(value || '')).join('\n'));
    },

    usageContextTextFromValidation(item = {}) {
      return this.normalizeUsageMatchText([
        item.artifactName,
        item.researchName,
        item.artifactLocation,
        item.sourceRef,
        item.evidenceLink,
        item.workflowScene,
        item.validationResult,
        item.reuseAdvice,
        item.notes,
        item.issues,
        item.suggestion,
        item.status
      ].map(value => String(value || '')).join('\n'));
    },

    hasClosedLoopUsageEvidence(context = '', source = 'art-progress') {
      if (source === 'validation') {
        return /验证|回填|结论|通过|可用|复用|失败|不可用|问题|建议|结果/.test(context);
      }
      const hasOperation = /使用工具|涉及工具|tool\/skill|skill|插件|调用|使用|复用|验证|接入|执行|实验|测试|操作|figma mcp|mcp|codex/i.test(context);
      const hasFeedback = /输出结果|验证结果|验证结论|回馈|反馈|结论|发现问题|问题：|适用场景|不适用场景|下一步|已完成|完成|通过|失败|可用|不可用|可复用|复用质量|准确|生成|创建|导出|写入|已将|结果：/i.test(context);
      return hasOperation && hasFeedback;
    },

    isCodexBackfillRecord(item = {}) {
      return item.metadata?.source === 'codex-session-backfill'
        || item.metadata?.source === 'codex-session-summary'
        || /Codex 使用记录补传|Codex 研究整理/.test(`${item.stage || ''} ${item.summary || ''}`);
    },

    isExplicitBackfillAssetUse(item = {}, matchText = '', match = {}) {
      if (!this.isCodexBackfillRecord(item)) return true;
      if (!this.usageRecordTargetsInventoryRow(item, {
        productDisplayName: match.file || match.name || match.alias || '',
        productFileName: match.file || '',
        title: match.name || match.alias || '',
        relativePath: match.path || ''
      }, 'art-progress')) return false;
      const summary = String(item.summary || '');
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      const structuredArtifacts = [
        ...(Array.isArray(metadata.calledArtifacts) ? metadata.calledArtifacts : []),
        ...(Array.isArray(metadata.matchedArtifacts) ? metadata.matchedArtifacts : [])
      ];
      if (structuredArtifacts.some(artifact => {
        const text = this.normalizeUsageMatchText([artifact.id, artifact.name, artifact.path].filter(Boolean).join('\n'));
        const directNeedles = [match.path, match.file, match.name, match.alias]
          .filter(value => value && !this.isGenericUsageNeedle(value));
        return Boolean(text && directNeedles.some(needle => matchText.includes(text) || text.includes(needle)));
      })) return true;
      const hasExplicitFileMention = /Files mentioned by the user|# Files mentioned/i.test(summary) && /##\s*[^\n]+\.(md|markdown|json|ya?ml|txt|zip|fig|figma|js|ts|vue|py|ps1|bat)/i.test(summary);
      const hasSpecificHit = Boolean(match.path || match.file) && !/^(memory\.md|agents\.md|skill\.md)$/i.test(match.file || '');
      const hasOutcomeAfterMention = /输出结果|验证结果|验证结论|回馈|反馈|结论|发现问题|适用场景|不适用场景|下一步|已完成|通过|失败|可用|不可用|生成|创建|导出|写入|结果/.test(summary);
      return hasExplicitFileMention && hasSpecificHit && hasOutcomeAfterMention && matchText.includes(match.file || match.path || '');
    },

    skillInventoryRecordMatch(row = {}, item = {}, source = 'art-progress') {
      if (!this.isMemberArtReporterRow(row) && (this.isFigmaUseConnectorArtifact(row) || this.isFigmaUseConnectorRecord(item))) return { matched: false };
      if (this.isNonAssetUsageRecord(item, source)) return { matched: false };
      if (source === 'validation' && item.forceDisplayInValidation === true) {
        if (!this.usageRecordTargetsInventoryRow(item, row, source)) return { matched: false };
        const targetKey = this.skillValidationArtifactCountKey(item);
        const rowKey = this.skillValidationArtifactCountKey({
          matchedMemberSkills: [row],
          artifactName: row.productDisplayName || row.title,
          artifactLocation: row.relativePath || row.path
        });
        if (targetKey && rowKey && targetKey === rowKey) return { matched: true, reason: '验证明细回填' };
      }
      if (source === 'validation' && !this.validationRecordTargetsInventoryRow(item, row)) return { matched: false };
      if (!this.usageRecordTargetsInventoryRow(item, row, source)) return { matched: false };
      const needles = this.skillInventoryNeedles(row);
      const text = source === 'validation' ? this.strictUsageTextFromValidation(item) : this.strictUsageTextFromArtProgress(item);
      const context = source === 'validation' ? this.usageContextTextFromValidation(item) : this.usageContextTextFromArtProgress(item);
      if (!text.trim() && !context.trim()) return { matched: false };
      if (!this.hasClosedLoopUsageEvidence(context, source)) return { matched: false };
      const matchText = text;
      const path = needles.paths.find(needle => needle.length >= 8 && !this.isGenericUsageNeedle(needle) && matchText.includes(needle));
      const file = needles.files.find(needle => needle.length >= 4 && !this.isGenericUsageNeedle(needle) && matchText.includes(needle));
      const name = needles.names.find(needle => needle.length >= 6 && !this.isGenericUsageNeedle(needle) && matchText.includes(needle));
      const compactContext = this.usageCompactMatchText(context);
      const alias = needles.aliases.find(needle => {
        const compactNeedle = this.usageCounterKeyForProduct(needle);
        return needle.length >= 4
          && !this.isGenericUsageNeedle(needle)
          && (matchText.includes(needle) || context.includes(needle) || (compactNeedle && compactContext.includes(compactNeedle)));
      });
      const match = { path, file, name, alias };
      if (!path && !file && !name && !alias) return { matched: false };
      if (source !== 'validation' && !this.isExplicitBackfillAssetUse(item, matchText, match)) return { matched: false };
      if (path) return { matched: true, reason: `路径命中：${path}` };
      if (file) return { matched: true, reason: `文件名命中：${file}` };
      if (alias) return { matched: true, reason: `别名命中：${alias}` };
      return { matched: true, reason: `产物名命中：${name}` };
    },

    skillInventoryRecordMatches(row = {}, item = {}, source = 'art-progress') {
      return this.skillInventoryRecordMatch(row, item, source).matched;
    },

    skillUsageLogTarget(row = {}, item = {}, source = 'art-progress', assetName = '') {
      const explicit = this.usageExplicitTargetsFromRecord(item, source)
        .find(target => target && !this.isGenericUsageFileTarget(target));
      const candidate = source === 'validation'
        ? (explicit || item.artifactName || item.researchName)
        : (explicit || item.skillName || item.title);
      const cleaned = String(candidate || '').trim();
      if (!cleaned || this.isGenericUsageFileTarget(cleaned) || /AGENTS\.md instructions/i.test(cleaned)) {
        return assetName || row.productDisplayName || row.productFileName || row.title || '产物';
      }
      return cleaned.replace(/^Skill[：:]\s*/i, '');
    },

    dedupeSkillUsageLogRows(logs = []) {
      const seen = new Set();
      const output = [];
      for (const item of logs) {
        const personKey = normalizePersonName(item.person || item.raw?.memberName || item.raw?.validator || '');
        const timeKey = this.formatDateSecond(item.time || item.raw?.createdAt || item.raw?.submittedAt || '') || String(item.time || '');
        const targetKey = this.normalizeUsageMatchText(item.target || item.raw?.artifactName || item.raw?.skillName || '');
        const sourceRef = String(item.raw?.sourceRef || item.raw?.metadata?.sessionFile || item.raw?.metadata?.sessionId || '').trim();
        const sourceKey = sourceRef ? this.normalizeUsageMatchText(sourceRef).slice(-160) : '';
        const contentKey = this.normalizeUsageMatchText(item.content || item.summary || '').replace(/\s+/g, '').slice(0, 600);
        const key = [item.type || '', personKey, timeKey || sourceKey, targetKey, contentKey || sourceKey].join('::');
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(item);
      }
      return output;
    },

    validationRecordTargetsInventoryRow(record = {}, row = {}) {
      const candidateAsset = {
        title: row.title || row.productDisplayName || row.productFileName || row.id || '',
        projectName: row.projectName || '',
        finalPath: row.finalPath || row.relativePath || row.path || row.skill?.git?.relativePath || '',
        skillPath: row.skillPath || row.relativePath || row.path || row.skill?.git?.relativePath || '',
        fileLink: row.fileLink || row.path || ''
      };
      if (this.validationAssetMatchScore(record, candidateAsset) < 0.8) return false;
      if (this.isAutoSkillValidationRecord(record)) return true;
      const mappedOwners = this.validationOwnerListFromMemberProducts(record);
      const owners = mappedOwners.length
        ? mappedOwners
        : this.canonicalPersonList(record.owner || record.walkthroughOwner || '');
      if (!owners.length || owners.includes('待确认')) return true;
      const validator = this.canonicalArtDeptPerson(record.validator || '');
      const rowPeople = [
        ...this.canonicalPersonList(row.owner),
        ...this.canonicalPersonList(row.uploader),
        ...this.canonicalPersonList(row.flowOwner),
        ...this.canonicalPersonList(row.skill?.uploaderName),
        ...this.canonicalPersonList(row.skill?.owner),
        ...this.canonicalPersonList(row.skill?.git?.authorName),
        this.uploaderFromSource(row.source)
      ].filter(Boolean);
      if (!rowPeople.length) return true;
      return rowPeople.some(person => owners.some(owner => samePerson(person, owner)) || samePerson(person, validator));
    },

    isTaskArtBriefUsageLog(log = {}) {
      const result = String(log.result || log.status || '').trim().toLowerCase();
      const text = `${log.actionName || ''} ${log.description || ''} ${log.error || ''} ${log.message || ''}`;
      if (/^(fail|failed|error|cancelled|canceled)$/i.test(result) || /失败|取消|错误|异常|未生成/.test(text)) return false;
      const action = String(log.action || '').trim();
      if (['GENERATE_ZENTAO_ART_BRIEF', 'REUSE_ZENTAO_ART_BRIEF', 'REGENERATE_ZENTAO_ART_BRIEF'].includes(action)) return true;
      return /禅道美术摘要|美术摘要/.test(text);
    },

    isTaskArtBriefAssetRow(row = {}) {
      const text = this.normalizeUsageMatchText([
        row.id,
        row.title,
        row.productDisplayName,
        row.productFileName,
        row.finalPath,
        row.projectName,
        row.description,
        row.skillPath,
        row.fileLink,
        row.relativePath,
        row.path,
        row.skill?.id,
        row.skill?.title,
        row.skill?.path,
        row.skill?.git?.relativePath,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : []),
        ...(Array.isArray(row.aliasHistory) ? row.aliasHistory : []),
        ...(Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : [])
      ].map(value => String(value || '')).join('\n'));
      return this.isTaskArtBriefProductName(text);
    },

    taskArtBriefUsageEntriesForRow(row = {}, assetName = '') {
      if (!this.isTaskArtBriefAssetRow(row)) return [];
      const seen = new Set();
      return (this.taskArtBriefUsageLogs || [])
        .filter(log => this.isTaskArtBriefUsageLog(log))
        .filter(log => {
          const key = log.id || `${log.action || ''}:${log.createdAt || ''}:${log.targetId || ''}`;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(log => {
          const person = this.canonicalArtDeptPerson(log.displayName || log.username) || log.displayName || log.username || '-';
          const taskNo = log.metadata?.taskNo || '';
          const taskName = log.targetName || '';
          const type = log.actionName || '生成美术摘要';
          const target = row.productDisplayName || row.productFileName || row.title || assetName || '生成美术摘要';
          return {
            id: `task-art-brief-${log.id || `${log.action || ''}-${log.createdAt || ''}`}`,
            type,
            person,
            time: log.createdAt || '',
            target,
            task: taskNo ? `禅道任务 ${taskNo}` : (taskName || '任务中心'),
            summary: `${person} ${type}`,
            content: log.description || `${person} ${type}${taskName ? `：${taskName}` : ''}`,
            code: taskNo || log.targetId || log.id || '',
            matchReason: '任务中心美术摘要按钮调用',
            raw: log
          };
        });
    },

    skillRunUsageEntriesForRow(row = {}, assetName = '') {
      const connectedAt = this.skillInventoryRowConnectedAt(row);
      return (this.runs || [])
        .filter(run => this.isRunUsageLikeSkillInventoryRow(run))
        .filter(run => this.usageRunMatchesRowTime(run, row, connectedAt))
        .filter(run => this.runRecordTargetsInventoryRow(run, row))
        .map(run => {
          const person = this.canonicalArtDeptPerson(run.assignedToName || run.developer || run.createdBy || run.ownerUserId) || run.assignedToName || run.developer || '-';
          const target = this.skillUsageLogTargetFromRun(row, run, assetName);
          return {
            id: `run-${run.id || `${target}-${run.createdAt || run.startedAt || ''}`}`,
            type: run.sourceType === 'direct-skill' || run.executionMode === 'direct-skill' ? '直接执行' : '工作台执行',
            person,
            time: run.startedAt || run.createdAt || run.updatedAt || '',
            target,
            task: run.taskNo || run.zentaoId || run.taskId || '工作台执行',
            summary: `${person} 执行了 ${target}`,
            content: run.resultSummary?.summary || run.requirement || run.title || '-',
            code: run.id || '',
            matchReason: '工作台执行记录',
            raw: run
          };
        });
    },

    isRunUsageLikeSkillInventoryRow(run = {}) {
      if (!run || typeof run !== 'object') return false;
      const values = [
        run.primarySkillPath,
        run.skillPath,
        run.stage,
        run.sourceTitle,
        run.productName,
        ...(Array.isArray(run.selectedMaterialHints) ? run.selectedMaterialHints : []),
        ...(Array.isArray(run.materials) ? run.materials.flatMap(item => [item?.path, item?.name, item?.title]) : []),
        ...(Array.isArray(run.referenceItems) ? run.referenceItems.flatMap(item => [item?.path, item?.name, item?.title]) : [])
      ].map(value => String(value || '').trim()).filter(Boolean);
      if (!values.length) return false;
      if (run.sourceType === 'direct-skill' || run.executionMode === 'direct-skill') return true;
      if (String(run.workflow || '') === 'art-single-skill' || String(run.executionMode || '') === 'single-skill') return true;
      return values.some(value => /\.(md|markdown)$/i.test(value.replace(/[#?].*$/, '')) || /(^|\/)SKILL\.md$/i.test(value.replace(/\\/g, '/')));
    },

    usageRunMatchesRowTime(run = {}, row = {}, connectedAt = '') {
      const start = String(connectedAt || this.skillInventoryRowConnectedAt(row) || '').trim();
      if (!start) return true;
      if (this.runRecordHasStrongRowIdentity(run, row)) return true;
      const at = String(run.startedAt || run.createdAt || run.updatedAt || '').trim();
      if (!at) return true;
      return at >= start;
    },

    runRecordHasStrongRowIdentity(run = {}, row = {}) {
      const runText = this.usageCompactMatchText(this.runUsageTargetText(run));
      if (!runText) return false;
      return this.usageRowFuzzyTargetKeys(row)
        .filter(value => value && value.length >= 6 && !this.isWeakUsageFuzzyNeedle(value))
        .some(value => runText.includes(value) || value.includes(runText));
    },

    runRecordTargetsInventoryRow(run = {}, row = {}) {
      const targetText = this.runUsageTargetText(run);
      const targets = this.usageExplicitTargetsFromText(targetText)
        .map(value => this.usageCounterKeyForProduct(value))
        .filter(value => value && value.length >= 4 && !this.isGenericUsageNeedle(value));
      const rowKeys = this.usageRowExplicitTargetKeys(row);
      const compactTarget = this.usageCompactMatchText(targetText);
      if (!targets.length && !compactTarget) return false;
      if (!rowKeys.length) return true;
      if (targets.some(target => rowKeys.some(rowKey => target === rowKey))) return true;
      return rowKeys
        .filter(rowKey => rowKey.length >= 6 && !this.isWeakUsageFuzzyNeedle(rowKey))
        .some(rowKey => compactTarget.includes(rowKey));
    },

    runUsageTargetText(run = {}) {
      return [
        run.primarySkillPath,
        run.skillPath,
        run.stage,
        run.sourceTitle,
        run.productName,
        run.title,
        ...(Array.isArray(run.selectedMaterialHints) ? run.selectedMaterialHints : []),
        ...(Array.isArray(run.materials) ? run.materials.flatMap(item => [item?.path, item?.name, item?.title]) : []),
        ...(Array.isArray(run.referenceItems) ? run.referenceItems.flatMap(item => [item?.path, item?.name, item?.title]) : [])
      ].map(value => String(value || '')).filter(Boolean).join('\n');
    },

    skillUsageLogTargetFromRun(row = {}, run = {}, assetName = '') {
      const explicit = this.usageExplicitTargetsFromText(this.runUsageTargetText(run))
        .find(target => target && !this.isGenericUsageFileTarget(target));
      const cleaned = String(explicit || run.productName || run.sourceTitle || '').trim();
      if (!cleaned || this.isGenericUsageFileTarget(cleaned)) {
        return assetName || row.productDisplayName || row.productFileName || row.title || '产物';
      }
      return cleaned.replace(/^Skill[：:]\s*/i, '');
    },

    isMemberArtReporterRow(row = {}) {
      const text = this.normalizeUsageMatchText([
        row.id,
        row.title,
        row.productDisplayName,
        row.productFileName,
        row.relativePath,
        row.path,
        row.skill?.id,
        row.skill?.title,
        row.skill?.path,
        row.skill?.git?.relativePath,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : [])
      ].map(value => String(value || '')).join('\n'));
      return /(^|[^a-z0-9])(?:member-art-reporter|art-progress-reporter)(?=$|[^a-z0-9])/i.test(text)
        || text.includes('美术工作台研究沉淀同步');
    },

    isMemberArtReporterRecord(item = {}) {
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      const text = this.normalizeUsageMatchText([
        item.eventType,
        item.skillId,
        item.skillName,
        item.stage,
        item.summary,
        item.title,
        item.repoPath,
        metadata.source,
        metadata.skillId,
        metadata.skillName,
        metadata.reporter,
        metadata.reporterSkill,
        metadata.sessionId
      ].map(value => String(value || '')).join('\n'));
      return item.skillId === 'art-progress-reporter'
        || item.skillName === '美术工作台研究沉淀同步'
        || /(^|[^a-z0-9])(?:member-art-reporter|art-progress-reporter)(?=$|[^a-z0-9])/i.test(text)
        || text.includes('美术工作台研究沉淀同步');
    },

    memberArtReporterUsageLogs(row = {}) {
      const assetName = row.productDisplayName || row.productFileName || row.title || row.id || '研究沉淀同步';
      const eventRows = [
        ...(this.artProgressEvents || []),
        ...(this.artProgressOperationLogRows || []).map(log => log.after || log.metadata?.after || {}).filter(Boolean)
      ];
      const seen = new Set();
      return eventRows
        .filter(item => this.isMemberArtReporterRecord(item))
        .filter(item => {
          const key = item.id || `${item.memberAccount || item.memberName || ''}:${item.eventType || ''}:${item.createdAt || ''}:${item.summary || ''}`;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(item => {
          const person = this.canonicalArtDeptPerson(item.memberName || item.memberAccount) || item.memberName || '-';
          const eventLabel = this.artProgressEventTypeLabel(item.eventType) || '研究同步';
          return {
            id: item.id,
            type: eventLabel,
            person,
            time: this.artProgressRecordDisplayTime(item),
            target: item.skillName || assetName,
            task: item.zentaoTaskId || item.taskNo || '未关联工单',
            summary: `${person} ${eventLabel}：${item.skillName || assetName}`,
            content: item.summary || item.title || '-',
            code: item.id || '',
            matchReason: '同步器上报记录',
            raw: item
          };
        })
        .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
    },

    skillUsageLogs(row = {}) {
      const cacheKey = this.skillUsageLogCacheKey(row);
      const cached = this.skillUsageLogCacheGet(cacheKey);
      if (cached) return cached;
      if (this.isMemberArtReporterRow(row)) return this.memberArtReporterUsageLogs(row);
      const assetName = row.productDisplayName || row.productFileName || row.title || row.id || '产物';
      const taskArtBriefLogs = this.taskArtBriefUsageEntriesForRow(row, assetName);
      const runLogs = this.skillRunUsageEntriesForRow(row, assetName);
      const connectedAt = this.skillInventoryRowConnectedAt(row);
      const eventRows = [
        ...(this.artProgressEvents || []),
        ...(this.artProgressOperationLogRows || []).map(log => log.after || log.metadata?.after || {}).filter(Boolean)
      ];
      const events = eventRows
        .filter(item => this.usageRecordMatchesRowTime(item, row, connectedAt))
        .map(item => ({ item, match: this.skillInventoryRecordMatch(row, item, 'art-progress') }))
        .filter(entry => entry.match.matched)
        .map(({ item, match }) => {
          const person = this.canonicalArtDeptPerson(item.memberName || item.memberAccount) || item.memberName || '-';
          const action = /验证|validation|review/i.test(`${item.eventType || ''} ${item.summary || ''}`) ? '验证' : '使用';
          const target = this.skillUsageLogTarget(row, item, 'art-progress', assetName);
          return {
            id: item.id,
            type: this.artProgressEventTypeLabel(item.eventType) || '研究同步',
            person,
            time: this.artProgressRecordDisplayTime(item),
            target,
            task: item.zentaoTaskId || item.taskNo || '未关联工单',
            summary: `${person} ${action}了 ${target}`,
            content: item.summary || item.title || '-',
            code: item.id || '',
            matchReason: match.reason || '',
            raw: item
          };
        });
      const rows = this.dedupeSkillUsageLogRows([...taskArtBriefLogs, ...runLogs, ...events])
        .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
      this.skillUsageLogCacheSet(cacheKey, rows);
      return rows;
    },

    skillUsageLogCacheKey(row = {}) {
      return [
        row.uid || row.id || row.productDisplayName || row.title,
        row.relativePath || row.path || '',
        this.skillInventoryRowConnectedAt(row),
        (Array.isArray(row.aliases) ? row.aliases : []).join('|'),
        (Array.isArray(row.skill?.aliases) ? row.skill.aliases : []).join('|'),
        (Array.isArray(row.aliasHistory) ? row.aliasHistory : []).join('|'),
        (Array.isArray(row.skill?.aliasHistory) ? row.skill.aliasHistory : []).join('|'),
        this.artProgressEvents.length,
        this.artProgressOperationLogRows.length,
        this.runs.length,
        this.taskArtBriefUsageLogs.length
      ].join('::');
    },

    skillUsageLogCacheGet(key = '') {
      if (!this._skillUsageLogCache || !key) return null;
      const value = this._skillUsageLogCache.get(key);
      return Array.isArray(value) ? value : null;
    },

    skillUsageLogCacheSet(key = '', rows = []) {
      if (!key) return;
      if (!this._skillUsageLogCache) this._skillUsageLogCache = new Map();
      if (this._skillUsageLogCache.size > 200) this._skillUsageLogCache.clear();
      this._skillUsageLogCache.set(key, Array.isArray(rows) ? rows : []);
    },

    clearSkillUsageLogCache() {
      if (this._skillUsageLogCache) this._skillUsageLogCache.clear();
      this.skillInventoryMetricsCache = {};
      this.clearAiMemberScoreCache();
    },

    artProgressRecordDisplayTime(record = {}) {
      return record.createdAt
        || record.reportedAt
        || record.updatedAt
        || this.extractPreciseTimeFromText(record.summary || record.description || record.notes || '')
        || '';
    },

    validationRecordDisplayTime(record = {}) {
      const submittedAt = String(record.submittedAt || '').trim();
      if (Number(record.rowNumber || 0) > 0 && submittedAt) return submittedAt;
      if (submittedAt && !this.isDateOnlyValue(submittedAt)) return submittedAt;
      return this.extractPreciseTimeFromText([
        record.notes,
        record.summary,
        record.description,
        record.validationResult,
        record.createdAt,
        record.updatedAt,
        record.importedAt,
        submittedAt
      ].join('\n'));
    },

    isDateOnlyValue(value = '') {
      return isDateOnlyDisplayValue(value);
    },

    extractPreciseTimeFromText(value = '') {
      const text = String(value || '');
      const precisePattern = /\d{4}[./-]\d{1,2}[./-]\d{1,2}[ T]\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?/;
      const labeled = text.match(new RegExp(`(?:提交|提交时间|开始时间|结束时间|记录时间|操作时间|时间)[：:]\\s*(${precisePattern.source})`));
      if (labeled?.[1]) return labeled[1];
      const any = text.match(precisePattern);
      return any?.[0] || '';
    },

    openSkillUsageDetail(row = {}) {
      if (!this.canViewSkillInventoryDetail) {
        ElMessage.warning('当前角色没有查看产物明细的权限');
        return;
      }
      this.skillUsageDialog = this.buildSkillUsageDialogState(row, { visible: true });
      this.refreshTaskArtBriefUsageLogs().then(() => {
        if (this.skillUsageDialog.visible && this.skillUsageDialog.row) {
          this.skillUsageDialog = this.buildSkillUsageDialogState(this.skillUsageDialog.row, this.skillUsageDialog);
        }
      }).catch(() => {});
    },

    buildSkillUsageDialogState(row = {}, previous = {}) {
      const logs = this.skillUsageLogs(row);
      const callLogs = logs.filter(item => this.skillUsageLogCountsAsCall(item));
      const people = new Set(callLogs.map(item => item.person).filter(Boolean));
      const historical = this.usageCounterStatsForRow(row);
      Object.keys(historical.people || {}).forEach(person => {
        if (person) people.add(person);
      });
      const effectivePeople = this.skillEffectiveUsagePeople(row);
      const validationCoverage = this.skillUsageCoverageStats(row, callLogs);
      const hasHistorical = this.hasUsageCounterStats(historical);
      const supplementalLogs = this.skillUsageSupplementalLogs(row, callLogs, hasHistorical, historical);
      const totalCount = (hasHistorical ? Number(historical.usageCount || 0) : 0) + supplementalLogs.length;
      const memberStatsMap = new Map();
      if (!hasHistorical || supplementalLogs.length) {
        for (const item of hasHistorical ? supplementalLogs : logs) {
          const person = this.canonicalArtDeptPerson(item.person) || item.person || '';
          if (!person || person === '-') continue;
          const existing = memberStatsMap.get(person) || {
            name: person,
            count: 0,
            latestTime: '',
            types: new Set()
          };
          existing.count += 1;
          if (item.type) existing.types.add(item.type);
          if (!existing.latestTime || String(item.time || '').localeCompare(String(existing.latestTime || '')) > 0) {
            existing.latestTime = item.time || existing.latestTime;
          }
          memberStatsMap.set(person, existing);
        }
      }
      Object.entries(historical.people || {}).forEach(([personName, count]) => {
        const person = this.canonicalArtDeptPerson(personName) || personName;
        if (!person) return;
        const existing = memberStatsMap.get(person) || {
          name: person,
          count: 0,
          latestTime: '',
          types: new Set()
        };
        existing.count += Number(count || 0);
        memberStatsMap.set(person, existing);
      });
      const memberStats = [...memberStatsMap.values()]
        .map(item => ({
          ...item,
          types: [...item.types].filter(Boolean).join('、') || '使用记录'
        }))
        .sort((a, b) => b.count - a.count || String(b.latestTime || '').localeCompare(String(a.latestTime || '')));
      const versionEntries = (Array.isArray(row.skill?.git?.history) ? row.skill.git.history : []).map(item => ({
        title: item.subject || row.skill?.commitSubject || '未填写提交说明',
        author: this.canonicalArtDeptPerson(item.authorName || item.authorEmail) || item.authorName || '-',
        email: item.authorEmail || '',
        time: item.committedAt || '',
        commit: item.shortCommit || String(item.commit || '').slice(0, 8),
        fullCommit: item.commit || '',
        summary: item.subject || '未填写提交说明'
      })).sort((left, right) => String(right.time || '').localeCompare(String(left.time || '')));
      const pageSize = previous.pageSize || 10;
      const maxPage = Math.max(1, Math.ceil(logs.length / pageSize));
      const hidden = row.hidden === true;
      return {
        visible: previous.visible !== false,
        row,
        start: previous.start || '',
        end: previous.end || '',
        page: Math.min(previous.page || 1, maxPage),
        pageSize,
        logs,
        memberStats,
        effectivePeopleCount: effectivePeople.length,
        versionEntries,
        metrics: [
          { label: '调用次数', value: hidden ? '-' : (totalCount || 0) },
          { label: '计入等级人数', value: effectivePeople.length },
          { label: '人均次数', value: people.size ? Math.round((totalCount / people.size) * 10) / 10 : 0 },
          { label: '有效占比', value: hidden || validationCoverage.excluded ? '-' : `${validationCoverage.rate}%` }
        ]
      };
    },

    refreshSkillUsageDialogForSkill(skill = {}) {
      if (!this.skillUsageDialog.visible || !this.skillUsageDialog.row) return;
      const targetPath = String(skill.git?.relativePath || skill.relativePath || skill.path || '');
      const targetId = String(skill.id || '');
      const row = this.skillInventoryRows.find(item => {
        const rowPath = String(item.skill?.git?.relativePath || item.relativePath || item.path || '');
        return (targetPath && rowPath === targetPath) || (!targetPath && targetId && item.id === targetId);
      });
      if (!row) return;
      this.skillUsageDialog = this.buildSkillUsageDialogState(row, this.skillUsageDialog);
    },

    resetSkillUsageFilter() {
      this.skillUsageDialog = { ...this.skillUsageDialog, start: '', end: '', page: 1 };
    },

    openSkillUsageLogDetail(item = {}) {
      const row = this.skillUsageDialog.row || {};
      const source = item.raw || {};
      const title = item.summary || `${item.person || '-'} 的使用记录`;
      this.artProgressDetailDialog = {
        ...emptyArtProgressDetailDialog(),
        visible: true,
        title: '使用明细内容预览',
        headTitle: title,
        path: item.code || row.relativePath || row.path || 'AI 产物使用明细',
        description: item.content || '暂无具体说明。',
        tags: [item.type, item.task].filter(Boolean),
        meta: [
          { label: '人员', value: item.person || '-' },
          { label: '时间', value: this.formatDateSecond(item.time) || '-' },
          { label: '产物', value: item.target || row.productDisplayName || row.title || '-' },
          { label: '来源', value: item.code || '-' }
        ],
        triggers: [row.relativePath || row.path, item.task].filter(Boolean),
        rows: [{
          id: item.id,
          eventType: source.eventType || item.type || 'usage',
          displaySkillName: item.target || row.productDisplayName || row.title || '使用明细',
          displayMemberName: item.person || '-',
          createdAt: item.time || '',
          displaySummary: item.content || '-',
          displayStage: source.stage || item.task || '',
          displayProjectName: source.projectName || row.projectName || '',
          zentaoTaskId: source.zentaoTaskId || source.taskNo || ''
        }],
        outline: []
      };
    },

    openSkillVersionHistory(row = {}) {
      const history = Array.isArray(row.skill?.git?.history) ? row.skill.git.history : [];
      this.skillHistoryDialog = {
        visible: true,
        row,
        entries: history.map(item => ({
          title: item.subject || row.skill?.commitSubject || '未填写提交说明',
          author: this.canonicalArtDeptPerson(item.authorName || item.authorEmail) || item.authorName || '-',
          email: item.authorEmail || '',
          time: item.committedAt || '',
          commit: item.shortCommit || String(item.commit || '').slice(0, 8),
          fullCommit: item.commit || '',
          summary: item.subject || '未填写提交说明'
        }))
      };
    },

    openSkillOwnerDialog(row = {}) {
      if (!this.canEditSkillInventoryOwnerRow(row)) {
        ElMessage.warning('只有本地路径或共享盘扫描产物可以手动调整贡献人。');
        return;
      }
      this.skillOwnerDialog = {
        visible: true,
        row,
        owner: this.personList(row.uploader).length
          ? this.personList(row.uploader)
          : (this.canonicalArtDeptPerson(row.uploader) || row.uploader ? [this.canonicalArtDeptPerson(row.uploader) || row.uploader] : [])
      };
    },

    async saveSkillOwnerOverride() {
      const row = this.skillOwnerDialog.row || {};
      if (!this.canEditSkillInventoryOwnerRow(row)) {
        ElMessage.warning('只有本地路径或共享盘扫描产物可以手动调整贡献人。');
        return;
      }
      const owner = Array.isArray(this.skillOwnerDialog.owner)
        ? this.displayPersonList(this.skillOwnerDialog.owner.join('、'))
        : this.displayPersonList(this.skillOwnerDialog.owner);
      if (!row.id && !row.path && !row.relativePath) return;
      if (!owner || owner === '-') {
        ElMessage.warning('请填写贡献人');
        return;
      }
      this.loading.skillVersion = true;
      try {
        const result = await this.api('/api/skill-version', {
          method: 'PATCH',
          body: JSON.stringify({
            id: row.id,
            projectId: row.projectId,
            title: row.title,
            path: row.path,
            relativePath: row.skill?.git?.relativePath || row.relativePath || row.path || '',
            owner
          })
        });
        this.patchSkillOwnerInScans({
          ...row,
          id: result.id || row.id,
          path: result.relativePath || row.path,
          relativePath: result.relativePath || row.relativePath,
          overrideKey: result.key || ''
        }, result.owner || owner);
        this.saveWorkbenchDisplayCache('scans', this.scans);
        this.skillOwnerDialog = { visible: false, row: null, owner: [] };
        ElMessage.success('产物贡献人已更新');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '产物贡献人保存失败');
      } finally {
        this.loading.skillVersion = false;
      }
    },

    async deleteSkillInventoryRow(row = {}) {
      if (!this.canOperateSkillInventoryManage) {
        ElMessage.warning('当前角色只能查看产物版本，不能作废。');
        return;
      }
      const title = row.productDisplayName || row.title || row.id || '该产物';
      const confirmed = await ElMessageBox.confirm(`确认作废「${title}」？作废后不计入 AI 评分，不会删除源文件或共享盘内容。`, '作废产物', {
        confirmButtonText: '作废',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }).then(() => true).catch(() => false);
      if (!confirmed) return;
      await this.saveSkillInventoryVisibility(row, true);
    },

    async restoreSkillInventoryRow(row = {}) {
      if (!this.canOperateSkillInventoryManage) {
        ElMessage.warning('当前角色只能查看产物版本，不能恢复。');
        return;
      }
      await this.saveSkillInventoryVisibility(row, false);
    },

    async saveSkillInventoryVisibility(row = {}, hidden = true) {
      this.loading.skillVersion = true;
      try {
        const result = await this.api('/api/skill-inventory/visibility', {
          method: 'PATCH',
          body: JSON.stringify({
            id: row.id,
            title: row.title || row.productDisplayName,
            path: row.path,
            relativePath: row.skill?.git?.relativePath || row.relativePath || row.path || row.id || '',
            hidden
          })
        });
        this.patchSkillVisibilityInScans(row, result.hidden === true, result);
        this.saveWorkbenchDisplayCache('scans', this.scans);
        ElMessage.success(hidden ? '产物已作废，已从 AI 评分中排除' : '产物已恢复');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || (hidden ? '产物作废失败' : '产物恢复失败'));
      } finally {
        this.loading.skillVersion = false;
      }
    },

    openSkillSourceDisplayDialog() {
      if (!this.canManageSkillSourceDisplay) {
        ElMessage.warning('当前角色没有管理扫描来源展示的权限');
        return;
      }
      this.skillSourceDisplayDialog = {
        visible: true,
        keyword: ''
      };
      this.resetSkillSourceDisplayDrafts();
    },

    async toggleSkillSourceDisplay(row = {}, visible = true) {
      if (!this.canManageSkillSourceDisplay) {
        ElMessage.warning('当前角色没有管理扫描来源展示的权限');
        return;
      }
      const sourceType = String(this.projectRows.find(project => project.id === row.projectId)?.sourceType || row.projectSourceType || '').toLowerCase();
      if (!['local', 'shared'].includes(sourceType)) {
        ElMessage.warning('只有本地路径或共享盘扫描产物可以调整展示状态。');
        return;
      }
      this.loading.skillVersion = true;
      try {
        const result = await this.api('/api/skill-inventory/display-visibility', {
          method: 'PATCH',
          body: JSON.stringify({
            id: row.id,
            projectId: row.projectId,
            sourceType,
            title: row.title || row.productDisplayName,
            path: row.path,
            relativePath: row.skill?.git?.relativePath || row.relativePath || row.path || row.id || '',
            displayHidden: visible !== true
          })
        });
        this.patchSkillDisplayVisibilityInScans(row, result.displayHidden === true, result);
        this.saveWorkbenchDisplayCache('scans', this.scans);
        ElMessage.success(result.displayHidden ? '产物已从清单隐藏' : '产物已恢复展示');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '产物展示状态保存失败');
      } finally {
        this.loading.skillVersion = false;
      }
    },

    async toggleAllSkillSourceDisplay(visible = true) {
      if (!this.canManageSkillSourceDisplay) {
        ElMessage.warning('当前角色没有管理扫描来源展示的权限');
        return;
      }
      const rows = this.skillSourceDisplayRows.filter(row => (row.displayHidden !== true) !== (visible === true));
      if (!rows.length) {
        ElMessage.info(visible ? '当前列表已全部展示' : '当前列表已全部取消展示');
        return;
      }
      this.loading.skillVersion = true;
      let saved = 0;
      try {
        for (const row of rows) {
          const sourceType = String(this.projectRows.find(project => project.id === row.projectId)?.sourceType || row.projectSourceType || '').toLowerCase();
          if (!['local', 'shared'].includes(sourceType)) continue;
          const result = await this.api('/api/skill-inventory/display-visibility', {
            method: 'PATCH',
            body: JSON.stringify({
              id: row.id,
              projectId: row.projectId,
              sourceType,
              title: row.title || row.productDisplayName,
              path: row.path,
              relativePath: row.skill?.git?.relativePath || row.relativePath || row.path || row.id || '',
              displayHidden: visible !== true
            })
          });
          this.patchSkillDisplayVisibilityInScans(row, result.displayHidden === true, result);
          saved += 1;
        }
        this.saveWorkbenchDisplayCache('scans', this.scans);
        ElMessage.success(visible ? `已展示 ${saved} 个产物` : `已取消展示 ${saved} 个产物`);
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '批量展示状态保存失败');
      } finally {
        this.loading.skillVersion = false;
      }
    },

    skillSourceDisplayOriginalName(row = {}) {
      return row.originalProductDisplayName
        || row.productFileName
        || this.fileNameFromPath(row.relativePath)
        || this.fileNameFromPath(row.path)
        || row.title
        || row.id
        || '-';
    },

    isPathScanFolderProductRow(row = {}) {
      const sourceType = String(this.projectRows.find(project => project.id === row.projectId)?.sourceType || row.projectSourceType || '').toLowerCase();
      return ['local', 'shared'].includes(sourceType)
        && (row.skill?.directoryProduct === true || row.skillInventoryKind === 'directory' || row.skill?.inventoryKind === 'directory');
    },

    skillSourceDisplayDraftKey(row = {}) {
      return [
        row.projectId || '',
        row.skill?.git?.relativePath || row.relativePath || row.path || '',
        row.id || row.uid || ''
      ].map(value => String(value || '').trim()).join('::');
    },

    resetSkillSourceDisplayDrafts() {
      const drafts = {};
      for (const row of this.skillSourceDisplayRows || []) {
        const key = this.skillSourceDisplayDraftKey(row);
        if (!key) continue;
        drafts[key] = {
          name: row.productDisplayName || row.productFileName || row.title || '',
          aliases: this.skillSourceDisplayAliasText(row)
        };
      }
      this.skillSourceDisplayDrafts = drafts;
    },

    skillSourceDisplayNameDraft(row = {}) {
      const key = this.skillSourceDisplayDraftKey(row);
      const draft = key ? this.skillSourceDisplayDrafts?.[key]?.name : '';
      return draft !== undefined ? draft : (row.productDisplayName || row.productFileName || row.title || '');
    },

    updateSkillSourceDisplayNameDraft(row = {}, value = '') {
      const key = this.skillSourceDisplayDraftKey(row);
      if (!key) return;
      this.skillSourceDisplayDrafts = {
        ...(this.skillSourceDisplayDrafts || {}),
        [key]: {
          ...(this.skillSourceDisplayDrafts?.[key] || {}),
          name: String(value ?? '')
        }
      };
    },

    skillSourceDisplayAliasDraft(row = {}) {
      const key = this.skillSourceDisplayDraftKey(row);
      const draft = key ? this.skillSourceDisplayDrafts?.[key]?.aliases : '';
      return draft !== undefined ? draft : this.skillSourceDisplayAliasText(row);
    },

    updateSkillSourceDisplayAliasDraft(row = {}, value = '') {
      const key = this.skillSourceDisplayDraftKey(row);
      if (!key) return;
      this.skillSourceDisplayDrafts = {
        ...(this.skillSourceDisplayDrafts || {}),
        [key]: {
          ...(this.skillSourceDisplayDrafts?.[key] || {}),
          aliases: String(value ?? '')
        }
      };
    },

    async saveSkillSourceDisplayName(row = {}, nameValue = '') {
      if (!this.canManageSkillSourceDisplay) {
        ElMessage.warning('当前角色没有管理扫描来源展示的权限');
        return;
      }
      const sourceType = String(this.projectRows.find(project => project.id === row.projectId)?.sourceType || row.projectSourceType || '').toLowerCase();
      if (!['local', 'shared'].includes(sourceType)) {
        ElMessage.warning('只有本地路径或共享盘扫描产物可以修改常用名称。');
        return;
      }
      const displayName = String(nameValue || '').trim();
      const currentName = String(row.productDisplayName || '').trim();
      if (displayName === currentName) return;
      this.updateSkillSourceDisplayNameDraft(row, displayName);
      this.loading.skillVersion = true;
      try {
        const result = await this.api('/api/skill-version', {
          method: 'PATCH',
          body: JSON.stringify({
            id: row.id,
            projectId: row.projectId,
            sourceType,
            title: row.title || row.productDisplayName,
            path: row.path,
            relativePath: row.skill?.git?.relativePath || row.relativePath || row.path || '',
            displayName
          })
        });
        this.patchSkillDisplayNameInScans({
          ...row,
          id: result.id || row.id,
          path: result.relativePath || row.path,
          relativePath: result.relativePath || row.relativePath,
          overrideKey: result.key || ''
        }, result.displayName ?? result.commonName ?? displayName);
        this.updateSkillSourceDisplayNameDraft(row, result.displayName ?? result.commonName ?? displayName);
        this.saveWorkbenchDisplayCache('scans', this.scans);
        ElMessage.success(displayName ? '产物名称已保存' : '产物名称已恢复为文件夹名称');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '产物名称保存失败');
      } finally {
        this.loading.skillVersion = false;
      }
    },

    skillSourceDisplayAliasText(row = {}) {
      return this.normalizeSkillAliasList([
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : [])
      ]).join('、');
    },

    skillSourceDisplayTypeValue(row = {}) {
      const kind = String(row.skillInventoryKind || row.skill?.inventoryKind || '').trim();
      if (['skill', 'document', 'directory'].includes(kind)) return kind;
      return 'directory';
    },

    skillSourceDisplayTypeLabel(kind = '') {
      if (kind === 'skill') return 'Skill';
      if (kind === 'document') return '规范';
      return '文件夹产物';
    },

    async saveSkillSourceDisplayAliases(row = {}, aliasValue = '') {
      if (!this.can('skill.alias.manage')) {
        ElMessage.warning('当前角色不能编辑调用别名。');
        return;
      }
      const sourceType = String(this.projectRows.find(project => project.id === row.projectId)?.sourceType || row.projectSourceType || '').toLowerCase();
      if (!['local', 'shared'].includes(sourceType)) {
        ElMessage.warning('只有本地路径或共享盘扫描产物可以修改调用别名。');
        return;
      }
      const aliases = this.normalizeSkillAliasList(aliasValue);
      const currentAliases = this.normalizeSkillAliasList([
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.skill?.aliases) ? row.skill.aliases : [])
      ]);
      if (aliases.join('｜') === currentAliases.join('｜')) return;
      this.updateSkillSourceDisplayAliasDraft(row, aliases.join('、'));
      this.loading.skillVersion = true;
      try {
        const result = await this.api('/api/skill-version', {
          method: 'PATCH',
          body: JSON.stringify({
            id: row.id,
            projectId: row.projectId,
            sourceType,
            title: row.title || row.productDisplayName,
            path: row.path,
            relativePath: row.skill?.git?.relativePath || row.relativePath || row.path || '',
            aliases
          })
        });
        const savedAliases = Array.isArray(result.aliases) ? result.aliases : aliases;
        this.updateSkillSourceDisplayAliasDraft(row, this.normalizeSkillAliasList(savedAliases).join('、'));
        this.patchSkillVersionInScans({
          ...row,
          id: result.id || row.id,
          path: result.relativePath || row.path,
          relativePath: result.relativePath || row.relativePath,
          overrideKey: result.key || ''
        }, row.version || row.skill?.version || '', savedAliases);
        this.saveWorkbenchDisplayCache('scans', this.scans);
        ElMessage.success(savedAliases.length ? '调用别名已保存' : '调用别名已清空');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '调用别名保存失败');
      } finally {
        this.loading.skillVersion = false;
      }
    },

    async saveSkillSourceDisplayType(row = {}, typeValue = '') {
      if (!this.canManageSkillSourceDisplay) {
        ElMessage.warning('当前角色没有管理扫描来源展示的权限');
        return;
      }
      const sourceType = String(this.projectRows.find(project => project.id === row.projectId)?.sourceType || row.projectSourceType || '').toLowerCase();
      if (!['local', 'shared'].includes(sourceType)) {
        ElMessage.warning('只有本地路径或共享盘扫描产物可以修改产物类型。');
        return;
      }
      const inventoryKind = ['skill', 'document', 'directory'].includes(String(typeValue || '').trim()) ? String(typeValue || '').trim() : '';
      if (!inventoryKind) {
        ElMessage.warning('请选择产物类型');
        return;
      }
      const currentKind = this.skillSourceDisplayTypeValue(row);
      if (inventoryKind === currentKind) return;
      this.loading.skillVersion = true;
      try {
        const result = await this.api('/api/skill-version', {
          method: 'PATCH',
          body: JSON.stringify({
            id: row.id,
            projectId: row.projectId,
            sourceType,
            title: row.title || row.productDisplayName,
            path: row.path,
            relativePath: row.skill?.git?.relativePath || row.relativePath || row.path || '',
            inventoryKind
          })
        });
        const savedKind = ['skill', 'document', 'directory'].includes(result.inventoryKind) ? result.inventoryKind : inventoryKind;
        this.patchSkillInventoryKindInScans({
          ...row,
          id: result.id || row.id,
          path: result.relativePath || row.path,
          relativePath: result.relativePath || row.relativePath,
          overrideKey: result.key || ''
        }, savedKind);
        this.saveWorkbenchDisplayCache('scans', this.scans);
        ElMessage.success(`产物类型已保存为${this.skillSourceDisplayTypeLabel(savedKind)}`);
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '产物类型保存失败');
      } finally {
        this.loading.skillVersion = false;
      }
    },

    async saveSkillSourceDisplayOwner(row = {}, ownerValue = '') {
      if (!this.canEditSkillInventoryOwnerRow(row)) {
        ElMessage.warning('只有本地路径或共享盘扫描产物可以调整贡献人。');
        return;
      }
      const owner = Array.isArray(ownerValue)
        ? this.displayPersonList(ownerValue.join('、'))
        : this.displayPersonList(ownerValue);
      if (!owner || owner === '-') {
        ElMessage.warning('请选择贡献人');
        return;
      }
      this.loading.skillVersion = true;
      try {
        const result = await this.api('/api/skill-version', {
          method: 'PATCH',
          body: JSON.stringify({
            id: row.id,
            projectId: row.projectId,
            title: row.title || row.productDisplayName,
            path: row.path,
            relativePath: row.skill?.git?.relativePath || row.relativePath || row.path || '',
            owner
          })
        });
        this.patchSkillOwnerInScans({
          ...row,
          id: result.id || row.id,
          path: result.relativePath || row.path,
          relativePath: result.relativePath || row.relativePath,
          overrideKey: result.key || ''
        }, result.owner || owner);
        this.saveWorkbenchDisplayCache('scans', this.scans);
        ElMessage.success('贡献人已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '贡献人保存失败');
      } finally {
        this.loading.skillVersion = false;
      }
    },

    openManualSkillCreate() {
      if (!this.canCreateSkillInventoryAsset) {
        ElMessage.warning('当前角色只能查看产物版本，不能手动创建。');
        return;
      }
      this.aiAssetDialog = {
        visible: true,
        readonly: false,
        mode: 'manualSkill',
        form: emptyAiAssetForm({
          owner: this.currentAccountPrimaryPersonName ? [this.currentAccountPrimaryPersonName] : [],
          progressStatus: '待验证',
          publicStatus: '否',
          source: 'manual',
          verifyStatus: '1.0'
        })
      };
    },


    async openSkillPreview(skill) {
      this.skillPreview = { visible: true, skill, html: '' };
      const savedAliases = this.normalizeSkillAliasList(skill?.manualAliases || []);
      const baseAliases = savedAliases.length ? savedAliases : this.generateSkillAliases(skill || {});
      this.skillPreviewAliasesDraft = baseAliases.join('、');
      const content = await this.loadSkillContent(skill);
      const contentAliases = this.extractSkillAliasesFromContent(content);
      const nextSkill = {
        ...skill,
        previewAliases: contentAliases
      };
      const nextAliases = savedAliases.length ? savedAliases : this.generateSkillAliases(nextSkill || {});
      this.skillPreviewAliasesDraft = nextAliases.join('、');
      this.skillPreview = {
        visible: true,
        skill: nextSkill,
        html: this.renderMarkdown(content || '技能内容读取失败。', this.resolveSkillAbsPath(skill), { preserveMetadata: true })
      };
    },

    async saveSkillPreviewVersion() {
      const skill = this.skillPreview.skill;
      const version = String(this.skillPreviewVersionDraft || '').trim();
      const aliasDraft = this.normalizeSkillAliasList(this.skillPreviewAliasesDraft);
      if (!skill) return;
      if (!this.can('skill.version.manage')) {
        ElMessage.warning('当前角色只能查看产物版本，不能编辑。');
        return;
      }
      if (!version) {
        ElMessage.warning('请填写版本');
        return;
      }
      this.loading.skillVersion = true;
      try {
        const result = await this.api('/api/skill-version', {
          method: 'PATCH',
          body: JSON.stringify({
            id: skill.id,
            projectId: skill.projectId || this.selectedProjectId || this.selectedProject?.id || '',
            title: skill.title,
            path: skill.path,
            relativePath: skill.git?.relativePath || skill.relativePath || skill.path || '',
            version,
            aliases: aliasDraft
          })
        });
        const savedAliases = Array.isArray(result.aliases) ? result.aliases : aliasDraft;
        const savedAliasHistory = this.normalizeSkillAliasHistoryList([
          ...(Array.isArray(result.aliasHistory) ? result.aliasHistory : []),
          ...(Array.isArray(skill.aliasHistory) ? skill.aliasHistory : []),
          ...savedAliases
        ]);
        const nextSkill = { ...skill, version: result.version, aliases: savedAliases, manualAliases: savedAliases, aliasHistory: savedAliasHistory, hasAliasOverride: savedAliases.length > 0 };
        this.skillPreview = { ...this.skillPreview, skill: nextSkill };
        this.skillPreviewAliasesDraft = this.normalizeSkillAliasList(savedAliases).join('、');
        this.patchSkillVersionInScans(nextSkill, result.version, savedAliases);
        this.selectedSkillId = nextSkill.id || this.selectedSkillId;
        this.refreshSkillUsageDialogForSkill(nextSkill);
        ElMessage.success('版本已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '版本保存失败');
      } finally {
        this.loading.skillVersion = false;
      }
    },

    async saveSkillPreviewAlias() {
      const skill = this.skillPreview.skill;
      const aliasDraft = this.normalizeSkillAliasList(this.skillPreviewAliasesDraft);
      if (!skill) return;
      if (!this.can('skill.alias.manage')) {
        ElMessage.warning('当前角色不能编辑调用别名。');
        return;
      }
      this.loading.skillVersion = true;
      try {
        const result = await this.api('/api/skill-alias', {
          method: 'PATCH',
          body: JSON.stringify({
            id: skill.id,
            projectId: skill.projectId || this.selectedProjectId || this.selectedProject?.id || '',
            title: skill.title,
            path: skill.path,
            relativePath: skill.git?.relativePath || skill.relativePath || skill.path || '',
            aliases: aliasDraft
          })
        });
        const savedAliases = Array.isArray(result.aliases) ? result.aliases : aliasDraft;
        const savedAliasHistory = this.normalizeSkillAliasHistoryList([
          ...(Array.isArray(result.aliasHistory) ? result.aliasHistory : []),
          ...(Array.isArray(skill.aliasHistory) ? skill.aliasHistory : []),
          ...savedAliases
        ]);
        const nextSkill = { ...skill, aliases: savedAliases, manualAliases: savedAliases, aliasHistory: savedAliasHistory, hasAliasOverride: savedAliases.length > 0 };
        this.skillPreview = { ...this.skillPreview, skill: nextSkill };
        this.skillPreviewAliasesDraft = this.normalizeSkillAliasList(savedAliases).join('、');
        this.patchSkillVersionInScans(nextSkill, nextSkill.version || skill.version || '', savedAliases);
        this.selectedSkillId = nextSkill.id || this.selectedSkillId;
        this.refreshSkillUsageDialogForSkill(nextSkill);
        ElMessage.success('调用别名已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '别名保存失败');
      } finally {
        this.loading.skillVersion = false;
      }
    },

    patchSkillVersionInScans(skill = {}, version = '', aliases = []) {
      const targetProjectId = String(skill.projectId || '').trim();
      const targetPath = String(skill.git?.relativePath || skill.relativePath || skill.path || '');
      const targetId = String(skill.id || '');
      const normalizedAliases = this.normalizeSkillAliasList(aliases);
      const normalizedAliasHistory = this.normalizeSkillAliasHistoryList([
        ...(Array.isArray(skill.aliasHistory) ? skill.aliasHistory : []),
        ...(Array.isArray(skill.skill?.aliasHistory) ? skill.skill.aliasHistory : []),
        ...(Array.isArray(skill.aliases) ? skill.aliases : []),
        ...(Array.isArray(skill.skill?.aliases) ? skill.skill.aliases : []),
        ...normalizedAliases
      ]);
      const aliasOverrideKeys = this.skillAliasOverrideKeys(skill);
      if (normalizedAliases.length || aliasOverrideKeys.length) {
        const nextAliasOverrides = { ...(this.skillAliasOverrides || {}) };
        const nextAliasHistoryOverrides = { ...(this.skillAliasHistoryOverrides || {}) };
        for (const key of aliasOverrideKeys) nextAliasOverrides[key] = normalizedAliases;
        for (const key of aliasOverrideKeys) nextAliasHistoryOverrides[key] = normalizedAliasHistory;
        this.skillAliasOverrides = nextAliasOverrides;
        this.skillAliasHistoryOverrides = nextAliasHistoryOverrides;
      }
      const scans = {};
      for (const [projectId, scan] of Object.entries(this.scans || {})) {
        scans[projectId] = {
          ...scan,
          skills: Array.isArray(scan.skills)
            ? scan.skills.map(item => {
              const itemPath = String(item.git?.relativePath || item.relativePath || item.path || '');
              const projectMatches = !targetProjectId || String(projectId) === targetProjectId;
              if (projectMatches && ((targetPath && itemPath === targetPath) || (!targetPath && targetId && item.id === targetId))) {
                return {
                  ...item,
                  version,
                  aliases: normalizedAliases,
                  manualAliases: normalizedAliases,
                  aliasHistory: normalizedAliasHistory,
                  hasAliasOverride: normalizedAliases.length > 0
                };
              }
              return item;
            })
            : scan.skills
        };
      }
      this.scans = scans;
      this.clearSkillUsageLogCache();
    },

    patchSkillOwnerInScans(row = {}, owner = '') {
      const normalizedOwner = this.displayPersonList(owner);
      if (!normalizedOwner || normalizedOwner === '-') return;
      const targetKeys = this.skillOwnerOverrideKeys(row);
      const nextOverrides = { ...(this.skillOwnerOverrides || {}) };
      for (const key of targetKeys) nextOverrides[key] = normalizedOwner;
      this.skillOwnerOverrides = nextOverrides;
      const targetProjectId = String(row.projectId || '');
      const targetPath = String(row.skill?.git?.relativePath || row.relativePath || row.path || '');
      const targetId = String(row.id || '');
      const scans = {};
      for (const [projectId, scan] of Object.entries(this.scans || {})) {
        scans[projectId] = {
          ...scan,
          skills: Array.isArray(scan.skills)
            ? scan.skills.map(item => {
              const itemPath = String(item.git?.relativePath || item.relativePath || item.path || '');
              const projectMatches = !targetProjectId || String(projectId) === targetProjectId;
              if (projectMatches && ((targetPath && itemPath === targetPath) || (!targetPath && targetId && item.id === targetId))) {
                return {
                  ...item,
                  ownerOverride: normalizedOwner
                };
              }
              return item;
            })
            : scan.skills
        };
      }
      this.scans = scans;
      this.clearSkillUsageLogCache();
      if (this.skillUsageDialog.visible && this.skillUsageDialog.row) {
        const dialogRow = this.skillUsageDialog.row;
        const dialogPath = String(dialogRow.skill?.git?.relativePath || dialogRow.relativePath || dialogRow.path || '');
        if ((targetPath && dialogPath === targetPath) || (!targetPath && targetId && dialogRow.id === targetId)) {
          this.skillUsageDialog = this.buildSkillUsageDialogState({
            ...dialogRow,
            uploader: normalizedOwner,
            skill: {
              ...(dialogRow.skill || {}),
              ownerOverride: normalizedOwner
            }
          }, this.skillUsageDialog);
        }
      }
    },

    patchSkillDisplayNameInScans(row = {}, displayName = '') {
      const originalName = this.skillSourceDisplayOriginalName(row);
      const normalizedName = String(displayName || '').trim();
      const nextDisplayName = normalizedName || originalName;
      if (!nextDisplayName) return;
      const targetKeys = this.skillDisplayNameOverrideKeys(row).filter(key => String(key || '').startsWith('name:'));
      const nextOverrides = { ...(this.skillDisplayNameOverrides || {}) };
      for (const key of targetKeys) nextOverrides[key] = normalizedName;
      this.skillDisplayNameOverrides = nextOverrides;
      const targetProjectId = String(row.projectId || '');
      const targetPath = String(row.skill?.git?.relativePath || row.relativePath || row.path || '');
      const targetId = String(row.id || '');
      let updatedDialogRow = null;
      const scans = {};
      for (const [projectId, scan] of Object.entries(this.scans || {})) {
        scans[projectId] = {
          ...scan,
          skills: Array.isArray(scan.skills)
            ? scan.skills.map(item => {
              const itemPath = String(item.git?.relativePath || item.relativePath || item.path || '');
              const projectMatches = !targetProjectId || String(projectId) === targetProjectId;
              if (projectMatches && ((targetPath && itemPath === targetPath) || (!targetPath && targetId && item.id === targetId))) {
                const itemOriginalName = item.originalProductDisplayName
                  || item.productFileName
                  || this.fileNameFromPath(item.relativePath)
                  || this.fileNameFromPath(item.path)
                  || item.productDisplayName
                  || item.title
                  || '';
                const nextItemName = normalizedName || itemOriginalName || nextDisplayName;
                const nextItem = {
                  ...item,
                  productDisplayName: nextItemName,
                  displayName: nextItemName,
                  commonName: normalizedName,
                  commonNameOverride: true,
                  originalProductDisplayName: itemOriginalName
                };
                const projectRow = this.projectRows.find(project => project.id === projectId) || this.projectFromCachedScan(projectId, scan);
                updatedDialogRow = this.buildSkillInventoryRow(projectRow, nextItem);
                return nextItem;
              }
              return item;
            })
            : scan.skills
        };
      }
      this.scans = scans;
      this.clearValidationMatchCache();
      this.clearSkillUsageLogCache();
      if (this.skillUsageDialog.visible && this.skillUsageDialog.row && updatedDialogRow) {
        const dialogRow = this.skillUsageDialog.row;
        const dialogPath = String(dialogRow.skill?.git?.relativePath || dialogRow.relativePath || dialogRow.path || '');
        if ((targetPath && dialogPath === targetPath) || (!targetPath && targetId && dialogRow.id === targetId)) {
          this.skillUsageDialog = this.buildSkillUsageDialogState(updatedDialogRow, this.skillUsageDialog);
        }
      }
    },

    patchSkillVisibilityInScans(row = {}, hidden = true, result = {}) {
      const targetPath = String(row.skill?.git?.relativePath || row.relativePath || row.path || '');
      const targetId = String(row.id || '');
      let updatedDialogRow = null;
      const scans = {};
      for (const [projectId, scan] of Object.entries(this.scans || {})) {
        scans[projectId] = {
          ...scan,
          skills: Array.isArray(scan.skills)
            ? scan.skills.map(item => {
              const itemPath = String(item.git?.relativePath || item.relativePath || item.path || '');
              if ((targetPath && itemPath === targetPath) || (!targetPath && targetId && item.id === targetId)) {
                const nextItem = {
                  ...item,
                  hidden,
                  hiddenAt: hidden ? (result.hiddenAt || item.hiddenAt || '') : '',
                  hiddenBy: hidden ? (result.hiddenBy || item.hiddenBy || '') : '',
                  restoredAt: result.restoredAt || item.restoredAt || '',
                  restoredBy: result.restoredBy || item.restoredBy || ''
                };
                const projectRow = this.projectRows.find(project => project.id === projectId) || this.projectFromCachedScan(projectId, scan);
                updatedDialogRow = this.buildSkillInventoryRow(projectRow, nextItem);
                return nextItem;
              }
              return item;
            })
            : scan.skills
        };
      }
      this.scans = scans;
      this.clearSkillUsageLogCache();
      if (this.skillUsageDialog.visible && this.skillUsageDialog.row && updatedDialogRow) {
        const dialogRow = this.skillUsageDialog.row;
        const dialogPath = String(dialogRow.skill?.git?.relativePath || dialogRow.relativePath || dialogRow.path || '');
        if ((targetPath && dialogPath === targetPath) || (!targetPath && targetId && dialogRow.id === targetId)) {
          this.skillUsageDialog = this.buildSkillUsageDialogState(updatedDialogRow, this.skillUsageDialog);
        }
      }
    },
    patchSkillDisplayVisibilityInScans(row = {}, displayHidden = true, result = {}) {
      const targetProjectId = String(row.projectId || '');
      const targetPath = String(row.skill?.git?.relativePath || row.relativePath || row.path || '');
      const targetId = String(row.id || '');
      const scans = {};
      for (const [projectId, scan] of Object.entries(this.scans || {})) {
        scans[projectId] = {
          ...scan,
          skills: Array.isArray(scan.skills)
            ? scan.skills.map(item => {
              const itemPath = String(item.git?.relativePath || item.relativePath || item.path || '');
              const projectMatches = !targetProjectId || String(projectId) === targetProjectId;
              if (projectMatches && ((targetPath && itemPath === targetPath) || (!targetPath && targetId && item.id === targetId))) {
                return {
                  ...item,
                  displayHidden,
                  displayHiddenAt: displayHidden ? (result.displayHiddenAt || item.displayHiddenAt || '') : '',
                  displayHiddenBy: displayHidden ? (result.displayHiddenBy || item.displayHiddenBy || '') : '',
                  displayRestoredAt: result.displayRestoredAt || item.displayRestoredAt || '',
                  displayRestoredBy: result.displayRestoredBy || item.displayRestoredBy || ''
                };
              }
              return item;
            })
            : scan.skills
        };
      }
      this.scans = scans;
      this.clearValidationMatchCache();
      this.clearSkillUsageLogCache();
    },

    patchSkillInventoryKindInScans(row = {}, inventoryKind = '') {
      const normalizedKind = ['skill', 'document', 'directory'].includes(String(inventoryKind || '').trim()) ? String(inventoryKind || '').trim() : '';
      if (!normalizedKind) return;
      const targetKeys = this.skillInventoryKindOverrideKeys(row).filter(key => String(key || '').startsWith('kind:'));
      const nextOverrides = { ...(this.skillInventoryKindOverrides || {}) };
      for (const key of targetKeys) nextOverrides[key] = normalizedKind;
      this.skillInventoryKindOverrides = nextOverrides;
      const targetProjectId = String(row.projectId || '');
      const targetPath = String(row.skill?.git?.relativePath || row.relativePath || row.path || '');
      const targetId = String(row.id || '');
      let updatedDialogRow = null;
      const scans = {};
      for (const [projectId, scan] of Object.entries(this.scans || {})) {
        scans[projectId] = {
          ...scan,
          skills: Array.isArray(scan.skills)
            ? scan.skills.map(item => {
              const itemPath = String(item.git?.relativePath || item.relativePath || item.path || '');
              const projectMatches = !targetProjectId || String(projectId) === targetProjectId;
              if (projectMatches && ((targetPath && itemPath === targetPath) || (!targetPath && targetId && item.id === targetId))) {
                const nextItem = {
                  ...item,
                  inventoryKind: normalizedKind,
                  category: normalizedKind === 'skill' ? 'Skill' : normalizedKind === 'document' ? '规范' : '文件夹产物'
                };
                const projectRow = this.projectRows.find(project => project.id === projectId) || this.projectFromCachedScan(projectId, scan);
                updatedDialogRow = this.buildSkillInventoryRow(projectRow, nextItem);
                return nextItem;
              }
              return item;
            })
            : scan.skills
        };
      }
      this.scans = scans;
      this.clearValidationMatchCache();
      this.clearSkillUsageLogCache();
      if (this.skillUsageDialog.visible && this.skillUsageDialog.row && updatedDialogRow) {
        const dialogRow = this.skillUsageDialog.row;
        const dialogPath = String(dialogRow.skill?.git?.relativePath || dialogRow.relativePath || dialogRow.path || '');
        if ((targetPath && dialogPath === targetPath) || (!targetPath && targetId && dialogRow.id === targetId)) {
          this.skillUsageDialog = this.buildSkillUsageDialogState(updatedDialogRow, this.skillUsageDialog);
        }
      }
    },

    async loadSkillContent(skill) {
      if (!skill?.path) return '';
      if (skill.inventoryKind === 'directory') return skill.preview || `产物目录：${skill.title || skill.relativePath || skill.path}`;
      if ((skill.directoryProduct || skill.skillPath) && skill.preview) return skill.preview;
      const relativePath = String(skill.git?.relativePath || skill.relativePath || skill.path || '').replaceAll('\\', '/').replace(/^\/+/, '');
      try {
        const projectId = this.selectedProjectId || this.selectedProject?.id || this.selectedScan?.projectId || '';
        const response = projectId && relativePath
          ? await fetch(`/api/projects/${encodeURIComponent(projectId)}/file-preview?file=${encodeURIComponent(relativePath)}`)
          : await fetch(this.artifactUrl(this.resolveSkillAbsPath(skill)));
        if (!response.ok) throw new Error(`文件读取失败：${response.status}`);
        const text = await response.text();
        this.skillContentCache = { ...this.skillContentCache, [skill.id]: text };
        return text;
      } catch {
        const fallback = skill.preview || '技能内容读取失败。';
        this.skillContentCache = { ...this.skillContentCache, [skill.id]: fallback };
        return fallback;
      }
    },

    resolveSkillAbsPath(skill) {
      const root = this.selectedProject?.rootPath || this.selectedScan?.rootPath || '';
      if (String(skill?.path || '').startsWith('/')) return skill.path;
      return root && skill?.path ? `${root}/${skill.path}` : skill?.path || '';
    },

    async selectProject(project) {
      this.selectedProjectId = project.id;
      if (!this.scans[project.id]) await this.loadProjectScanCacheForInventory();
    },

    switchView(view) {
      if (['skill-assets', 'skill-inventory'].includes(view)) {
        this.skillInventoryTab = 'assets';
        this.activeView = 'skill-inventory';
        this.ensureSkillInventoryTabData('assets');
        this.pushRoute('/skills/assets');
        this.recordWorkbenchViewLog(view, '/skills/assets');
        return;
      }
      const routes = {
        workspace: '/tasks',
        'project-list': '/tasks',
        'skii-repository': '/skills/assets',
        'skill-list': '/skills/assets',
        'skill-assets': '/skills/assets',
        'skill-inventory': '/skills/assets',
        'ai-members': '/ai-members',
        tasks: '/tasks',
        'codex-config': '/codex-config',
        'user-access': '/user-access',
        'role-management': '/role-management',
        'operation-logs': '/operation-logs',
        'agent-workers': '/agent-workers',
        'ai-archive': '/ai-archive',
        runs: '/runs'
      };
      if (view === 'ai-members') this.prepareAiMembersView();
      this.pushRoute(routes[view] || '/tasks');
      this.recordWorkbenchViewLog(view, routes[view] || '/tasks');
    },

    recordWorkbenchViewLog(view = '', route = '') {
      if (!this.currentUser || !view || view === 'operation-logs') return;
      const now = Date.now();
      const key = `${view}:${route}`;
      if (this._lastWorkbenchViewLogKey === key && now - Number(this._lastWorkbenchViewLogAt || 0) < 3000) return;
      this._lastWorkbenchViewLogKey = key;
      this._lastWorkbenchViewLogAt = now;
      const viewName = {
        tasks: '任务中心',
        'skill-assets': 'AI 产物清单',
        'skill-inventory': 'AI 产物清单',
        'skii-repository': 'AI 产物清单',
        'ai-members': 'AI部门看板',
        'codex-config': 'Codex 配置',
        runs: '美术执行台',
        'agent-workers': '本机执行状态',
        'ai-archive': 'AI档案',
        'user-access': '用户管理',
        'role-management': '角色管理'
      }[view] || view;
      this.api('/api/operation-logs/view', {
        method: 'POST',
        body: JSON.stringify({
          view,
          viewName,
          path: route
        })
      }).catch(() => {});
    },

    goProjectList() {
      this.pushRoute('/skills/assets');
    },

    goProjectDetail() {
      if (!this.selectedProjectId) return;
      this.pushRoute(`/projects/${encodeURIComponent(this.selectedProjectId)}`);
    },

    goAiArchive() {
      this.switchView('ai-archive');
    },

    goTaskResult() {
      if (!this.selectedProjectId || !this.selectedTask) return;
      this.pushRoute(`/projects/${encodeURIComponent(this.selectedProjectId)}/tasks/${encodeURIComponent(this.selectedTask.path)}/result`);
    },

    async openProjectDetail(project) {
      await this.selectProject(project);
      this.selectedTask = null;
      this.selectedReport = null;
      this.selectedReportHtml = '';
      this.selectedImage = null;
      this.taskPage = 1;
      this.pushRoute(`/projects/${encodeURIComponent(project.id)}`);
    },

    async createProject() {
      const isEditing = Boolean(this.projectForm.id);
      if (isEditing && !this.canEditSkillInventorySource) {
        ElMessage.warning('当前角色没有编辑扫描来源的权限');
        return;
      }
      if (!isEditing && !this.canConnectSkillInventorySource) {
        ElMessage.warning('当前角色没有接入扫描来源的权限');
        return;
      }
      const sourceType = this.projectForm.sourceType || 'local';
      const gitUrl = String(this.projectForm.git?.remoteUrl || '').trim();
      const rootPath = String(this.projectForm.rootPath || '').trim();
      if (!this.projectForm.name) {
        ElMessage.warning('请填写资料库名称');
        return;
      }
      if (sourceType === 'git' && !gitUrl) {
        ElMessage.warning('请填写 Git 仓库地址');
        return;
      }
      if (sourceType !== 'git' && !rootPath) {
        ElMessage.warning('请填写本地或共享盘路径');
        return;
      }
      const beforeProject = isEditing
        ? (this.projects.find(item => item.id === this.projectForm.id) || null)
        : null;
      const beforeScan = beforeProject?.id ? this.scans[beforeProject.id] : null;
      const shouldScanAfterSave = ['local', 'shared'].includes(String(sourceType || '').toLowerCase())
        && (!isEditing
          || String(beforeProject?.sourceType || '').toLowerCase() !== String(sourceType || '').toLowerCase()
          || String(beforeProject?.rootPath || '').trim() !== rootPath
          || !Array.isArray(beforeScan?.skills)
          || !beforeScan.skills.length);
      const payload = projectPayload(this.projectForm);
      this.loading.scan = shouldScanAfterSave || !isEditing;
      try {
        const project = await this.api('/api/projects', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        await this.refreshProjects();
        let scanResult = null;
        if (shouldScanAfterSave || !isEditing) {
          scanResult = await this.scanSingleSkillSource(project);
          if (!scanResult && shouldScanAfterSave) return;
        } else {
          await this.loadProjectScanCacheForInventory({ force: true, silent: true });
        }
        this.projectDrawer = false;
        this.projectForm = emptyProjectForm();
        this.selectedProjectId = project.id || this.selectedProjectId;
        if (scanResult) ElMessage.success(isEditing ? '扫描源已保存并完成扫描' : '扫描源已接入并完成扫描');
        else if (isEditing) ElMessage.success('扫描源已保存，库存保持上次扫描结果');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || (isEditing ? '扫描源保存失败' : '扫描源接入失败'));
      } finally {
        this.loading.scan = false;
      }
    },

    openProjectCreateDrawer() {
      this.projectForm = emptyProjectForm();
      this.projectDrawer = true;
    },

    openAssetScanConnect() {
      if (!this.canConnectSkillInventorySource) {
        ElMessage.warning('当前角色不能接入扫描源。');
        return;
      }
      this.projectForm = {
        ...emptyProjectForm(),
        name: 'AI 产物扫描源',
        sourceType: 'git',
        agentConfigPath: '',
        skillConfigPath: '',
        taskDir: '',
        git: emptyGitForm()
      };
      this.projectDrawer = true;
    },

    handleProjectSourceTypeChange(value = '') {
      if (value === 'git') {
        this.projectForm.rootPath = '';
      } else {
        this.projectForm.git = {
          ...emptyGitForm(),
          ...(this.projectForm.git || {}),
          remoteUrl: ''
        };
      }
    },

    openProjectEditDrawer(project) {
      if (!this.canEditSkillInventorySource) {
        ElMessage.warning('当前角色没有编辑扫描来源的权限');
        return;
      }
      this.projectForm = {
        ...emptyProjectForm(),
        ...project,
        git: {
          ...emptyGitForm(),
          ...(project?.git || {})
        },
        forbiddenCommands: Array.isArray(project?.forbiddenCommands) ? [...project.forbiddenCommands] : []
      };
      this.projectDrawer = true;
    },

    async deleteProject(project) {
      if (!this.canDeleteSkillInventorySource) {
        ElMessage.warning('当前角色没有删除扫描来源的权限');
        return;
      }
      if (!project?.id) return;
      const runningRuns = this.runs.filter(run => run.projectId === project.id && this.isRunInProgress(run));
      if (runningRuns.length) {
        ElMessage.warning('项目下有执行中的任务，结束后再删除项目');
        return;
      }
      await ElMessageBox.confirm(
        `确认删除项目「${project.name || project.id}」的接入记录？\n本操作只删除平台内的项目记录、同步任务、Bug、执行记录和平台产物，不会删除本地项目目录：${project.rootPath || '-'}`,
        '删除项目',
        {
          confirmButtonText: '删除项目',
          cancelButtonText: '取消',
          type: 'warning',
          confirmButtonClass: 'el-button--danger'
        }
      );
      const deletedSelectedProject = project.id === this.selectedProjectId;
      const result = await this.api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      const nextProjects = this.projects.filter(item => item.id !== project.id);
      this.projects = nextProjects;
      const { [project.id]: _removedScan, ...nextScans } = this.scans;
      this.scans = nextScans;
      this.businessTasks = this.businessTasks.filter(task => task.projectId !== project.id);
      this.bugs = this.bugs.filter(bug => bug.projectId !== project.id);
      this.taskReviews = this.taskReviews.filter(review => review.projectId !== project.id);
      this.runs = this.runs.filter(run => run.projectId !== project.id);
      this.customWorkflows = this.customWorkflows.filter(workflow => workflow.projectId !== project.id);
      if (this.selectedRun && this.selectedRun.projectId === project.id) this.selectedRunId = this.runs[0]?.id || null;
      if (this.taskFilters.projectId === project.id) this.updateTaskFilter('projectId', '');
      if (this.archiveFilters.projectId === project.id) this.archiveFilters.projectId = '';
      if (this.runForm.projectId === project.id) this.runForm.projectId = nextProjects[0]?.id || '';
      if (this.taskSyncForm.projectId === project.id) this.taskSyncForm.projectId = nextProjects[0]?.id || '';
      if (this.workflowDesigner.projectId === project.id) this.workflowDesigner.projectId = '';
      if (deletedSelectedProject) {
        this.selectedProjectId = nextProjects[0]?.id || '';
        this.selectedTask = null;
        this.selectedReport = null;
        this.selectedReportHtml = '';
        this.selectedImage = null;
        this.detailProjectTasks = [];
        this.detailPagedProjectTasks = [];
        this.pushRoute('/projects');
      }
      const removed = result.removed || {};
      ElMessage.success(`项目已删除：清理任务 ${removed.tasks || 0}、Bug ${removed.bugs || 0}、执行记录 ${removed.runs || 0}`);
    },

    openUserCreateDrawer() {
      this.userForm = emptyUserForm();
      this.userDrawer = true;
    },

    openUserEditDrawer(user) {
      this.userForm = {
        ...emptyUserForm(),
        id: user.id,
        username: user.username,
        displayName: user.displayName || '',
        password: '',
        role: user.role || 'viewer',
        allProjects: user.projectIds?.includes('*'),
        projectIds: user.projectIds?.includes('*') ? [] : [...(user.projectIds || [])],
        disabled: user.disabled === true
      };
      this.userDrawer = true;
    },

    openPasswordResetDrawer(user) {
      this.passwordForm = {
        id: user.id,
        username: user.username,
        password: ''
      };
      this.passwordDrawer = true;
    },

    openPasswordRecordDrawer(user) {
      this.passwordRecordForm = {
        id: user.id,
        username: user.username,
        password: user.passwordDisplay || ''
      };
      this.passwordRecordDrawer = true;
    },

    userPayloadFromForm() {
      return {
        username: this.userForm.username,
        displayName: this.userForm.displayName,
        role: this.userForm.role,
        projectIds: this.userForm.allProjects ? ['*'] : this.userForm.projectIds,
        disabled: this.userForm.disabled
      };
    },

    async saveUser() {
      if (!this.userForm.username || !this.userForm.role) {
        ElMessage.warning('请填写用户名并选择角色');
        return;
      }
      if (!this.userForm.allProjects && !this.userForm.projectIds.length) {
        ElMessage.warning('请至少分配一个项目，或选择全部项目');
        return;
      }
      if (!this.userForm.id && String(this.userForm.password || '').length < 8) {
        ElMessage.warning('初始密码至少 8 位');
        return;
      }
      if (this.userForm.id && this.userForm.password && String(this.userForm.password).length < 8) {
        ElMessage.warning('新密码至少 8 位');
        return;
      }
      this.loading.users = true;
      try {
        const payload = this.userPayloadFromForm();
        if (this.userForm.id) {
          await this.api(`/api/users/${encodeURIComponent(this.userForm.id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          });
          if (this.userForm.password) {
            await this.api(`/api/users/${encodeURIComponent(this.userForm.id)}/password`, {
              method: 'POST',
              body: JSON.stringify({ password: this.userForm.password })
            });
          }
        } else {
          await this.api('/api/users', {
            method: 'POST',
            body: JSON.stringify({ ...payload, password: this.userForm.password })
          });
        }
        await this.refreshUsers();
        this.userDrawer = false;
        ElMessage.success('账户管理已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '账户保存失败');
      } finally {
        this.loading.users = false;
      }
    },

    async toggleUserDisabled(user) {
      const disabled = !user.disabled;
      await this.api(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled })
      });
      await this.refreshUsers();
      ElMessage.success(disabled ? '账号已禁用' : '账号已启用');
    },

    async deleteUser(user) {
      if (!user?.id) return;
      if (user.id === this.currentUser?.id) {
        ElMessage.warning('不能删除当前登录账号');
        return;
      }
      await ElMessageBox.confirm(
        `删除后账号「${user.displayName || user.username}」将无法登录，历史操作记录会保留。确定删除吗？`,
        '删除账号',
        {
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          type: 'warning',
          confirmButtonClass: 'el-button--danger'
        }
      );
      this.loading.users = true;
      try {
        await this.api(`/api/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
        await this.refreshUsers();
        ElMessage.success('账号已删除');
      } finally {
        this.loading.users = false;
      }
    },

    async resetUserPassword() {
      if (!this.passwordForm.id || String(this.passwordForm.password || '').length < 8) {
        ElMessage.warning('新密码至少 8 位');
        return;
      }
      this.loading.users = true;
      try {
        await this.api(`/api/users/${encodeURIComponent(this.passwordForm.id)}/password`, {
          method: 'POST',
          body: JSON.stringify({ password: this.passwordForm.password })
        });
        await this.refreshUsers();
        this.passwordDrawer = false;
        this.passwordForm = { id: '', username: '', password: '' };
        ElMessage.success('密码已重置');
      } finally {
        this.loading.users = false;
      }
    },

    async recordUserVisiblePassword() {
      if (!this.passwordRecordForm.id || !String(this.passwordRecordForm.password || '').trim()) {
        ElMessage.warning('请填写需要展示的密码');
        return;
      }
      this.loading.users = true;
      try {
        await this.api(`/api/users/${encodeURIComponent(this.passwordRecordForm.id)}/visible-password`, {
          method: 'POST',
          body: JSON.stringify({ password: this.passwordRecordForm.password, source: '手动登记' })
        });
        await this.refreshUsers();
        this.passwordRecordDrawer = false;
        this.passwordRecordForm = { id: '', username: '', password: '' };
        ElMessage.success('展示密码已登记');
      } finally {
        this.loading.users = false;
      }
    },

    async changeOwnPassword() {
      if (String(this.forcePasswordForm.currentPassword || '').length < 1) {
        ElMessage.warning('请先输入当前密码');
        return;
      }
      if (String(this.forcePasswordForm.password || '').length < 8) {
        ElMessage.warning('新密码至少 8 位');
        return;
      }
      if (this.forcePasswordForm.password !== this.forcePasswordForm.confirmPassword) {
        ElMessage.warning('两次输入的新密码不一致');
        return;
      }
      this.loginLoading = true;
      try {
        await this.api('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: this.forcePasswordForm.currentPassword,
            password: this.forcePasswordForm.password
          })
        });
        this.forcePasswordDialog = false;
        this.forcePasswordForm = { currentPassword: '', password: '', confirmPassword: '' };
        this.currentUser = null;
        this.projects = [];
        this.loginError = '';
        this.loginForm.password = '';
        this.pushRoute('/login');
        ElMessage.success('密码修改成功，请重新登录');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '修改密码失败');
      } finally {
        this.loginLoading = false;
      }
    },

    openRoleCreateDrawer() {
      this.roleForm = emptyRoleForm();
      this.setRoleLevel(this.roleForm.level);
      this.roleDrawer = true;
    },

    openRoleEditDrawer(role) {
      this.roleForm = {
        ...emptyRoleForm(),
        ...role,
        permissions: [...(role.permissions || [])],
        persisted: true
      };
      this.roleDrawer = true;
    },

    permissionsForRoleLevel(level) {
      const value = Number(level || 1);
      if (value >= 4 && this.permissionCatalog.length) return this.permissionCatalog.map(item => item.id);
      if (value >= 4) return [...roleLevelPermissionPresets[4]];
      if (value >= 3) return [...roleLevelPermissionPresets[3]];
      if (value >= 2) return [...roleLevelPermissionPresets[2]];
      return [...roleLevelPermissionPresets[1]];
    },

    setRoleLevel(level) {
      this.roleForm.level = Number(level || 1);
      if (!this.roleForm.persisted) {
        this.roleForm.permissions = this.permissionsForRoleLevel(this.roleForm.level);
      }
    },

    async saveRole() {
      if (!this.roleForm.name) {
        ElMessage.warning('请填写角色名称');
        return;
      }
      this.loading.roles = true;
      try {
        const payload = {
          id: this.roleForm.persisted ? this.roleForm.id : '',
          name: this.roleForm.name,
          description: this.roleForm.description,
          level: Number(this.roleForm.level || 1),
          permissions: Array.isArray(this.roleForm.permissions) ? this.roleForm.permissions : [],
          disabled: this.roleForm.disabled
        };
        if (this.roleForm.persisted) {
          await this.api(`/api/roles/${encodeURIComponent(this.roleForm.id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          });
        } else {
          await this.api('/api/roles', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        }
        await this.refreshRoles();
        this.roleDrawer = false;
        ElMessage.success('角色已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '角色保存失败');
      } finally {
        this.loading.roles = false;
      }
    },

    async deleteRole(role) {
      await ElMessageBox.confirm(`确认删除角色「${role.name}」？已有账号使用的角色不能删除。`, '删除角色', {
        confirmButtonText: '删除角色',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      });
      await this.api(`/api/roles/${encodeURIComponent(role.id)}`, { method: 'DELETE' });
      await this.refreshRoles();
      ElMessage.success('角色已删除');
    },

    openTaskSyncDrawer() {
      this.taskSyncForm = {
        projectId: this.taskFilters.projectId || this.selectedProjectId || this.projects[0]?.id || '',
        products: this.taskSyncForm.products || DEFAULT_ZENTAO_BUG_PRODUCTS
      };
      this.taskSyncDrawer = true;
    },

    async syncZentaoTasks() {
      const projectId = this.taskSyncForm.projectId || this.taskFilters.projectId || this.selectedProjectId || this.projects[0]?.id || '';
      if (!projectId) {
        ElMessage.warning('当前没有可同步的项目');
        return;
      }
      const syncKind = this.effectiveTaskCenterMode === 'bug' ? 'bug' : 'task';
      this.taskSyncForm = {
        projectId,
        products: this.taskSyncForm.products || DEFAULT_ZENTAO_BUG_PRODUCTS
      };
      this.loading.syncTasks = true;
      this.manualZentaoSyncPending = true;
      ElMessage.info(`已提交同步${syncKind === 'bug' ? ' Bug' : '任务'}，后台正在刷新`);
      try {
        const result = await this.api('/api/tasks/sync-zentao', {
          method: 'POST',
          body: JSON.stringify({
            projectId,
            products: this.taskSyncForm.products,
            syncKind,
            wait: false,
            interactive: true,
            syncProfile: 'quick',
            quick: true,
            detailRefreshScope: 'tracked',
            limit: 100,
            maxPages: 3,
            executionMaxPages: 5,
            executionScanLimit: 24,
            detailConcurrency: 6,
            bugLimit: 100,
            bugMaxPages: 10,
            bugRefreshTracked: true,
            bugCurrentOnly: syncKind !== 'bug',
            bugTrackedConcurrency: 4
          })
        });
        this.taskSyncDrawer = false;
        if (result.zentaoAutoSync) {
          this.appConfig = { ...this.appConfig, zentaoAutoSync: result.zentaoAutoSync };
        }
        this.startZentaoAutoSyncPolling();
        this.pollZentaoSync(syncKind);
        if (result.message && !/已开始|同步.*开始|后台正在刷新/.test(result.message)) {
          ElMessage.info(result.message);
        }
      } catch (error) {
        this.manualZentaoSyncPending = false;
        ElMessage.error(this.readApiError(error) || '禅道同步失败');
      } finally {
        if (!this.manualZentaoSyncPending) this.loading.syncTasks = false;
      }
    },

    async autoSyncAiArchiveBugs(options = {}) {
      if (!this.can('task.sync')) return;
      const projectId = this.archiveFilters.projectId || this.selectedProjectId || this.projects[0]?.id || '';
      if (!projectId || this.loading.aiArchiveBugSync) return;
      const cooldownMs = 5 * 60 * 1000;
      const lastAt = Number(this.aiArchiveBugSyncLastAt[projectId] || 0);
      if (!options.force && lastAt && Date.now() - lastAt < cooldownMs) return;
      this.loading.aiArchiveBugSync = true;
      try {
        const result = await this.api('/api/bugs/sync-zentao', {
          method: 'POST',
          body: JSON.stringify({
            projectId,
            products: this.taskSyncForm.products || DEFAULT_ZENTAO_BUG_PRODUCTS,
            limit: 100,
            maxPages: 10
          })
        });
        this.aiArchiveBugSyncLastAt = { ...this.aiArchiveBugSyncLastAt, [projectId]: Date.now() };
        await this.refreshBugs();
        if ((result.created || 0) || (result.updated || 0) || (result.removed || 0)) {
          ElMessage.success(`任务 Bug 记录已自动同步：新增 ${result.created || 0}，更新 ${result.updated || 0}`);
        }
      } catch (error) {
        this.aiArchiveBugSyncLastAt = { ...this.aiArchiveBugSyncLastAt, [projectId]: Date.now() };
        ElMessage.warning(this.readApiError(error) || '任务 Bug 记录自动同步失败，请稍后手动同步');
      } finally {
        this.loading.aiArchiveBugSync = false;
      }
    },

    async autoSyncAiArchiveTasks(options = {}) {
      if (!this.can('task.sync')) return;
      const projectId = this.archiveFilters.projectId || this.selectedProjectId || this.projects[0]?.id || '';
      if (!projectId || this.loading.aiArchiveTaskSync || this.zentaoSyncRunning) return;
      const cooldownMs = 5 * 60 * 1000;
      const lastAt = Number(this.aiArchiveTaskSyncLastAt[projectId] || 0);
      if (!options.force && lastAt && Date.now() - lastAt < cooldownMs) return;
      this.loading.aiArchiveTaskSync = true;
      try {
        const result = await this.api('/api/tasks/sync-zentao', {
          method: 'POST',
          body: JSON.stringify({
            projectId,
            wait: true,
            limit: 100,
            maxPages: 10
          })
        });
        this.aiArchiveTaskSyncLastAt = { ...this.aiArchiveTaskSyncLastAt, [projectId]: Date.now() };
        await Promise.all([this.refreshTasks(), this.refreshAiFlowRecords(), this.refreshConfig()]);
        if ((result.created || 0) || (result.updated || 0) || result.detailRefresh?.refreshed) {
          ElMessage.success(`任务记录已自动同步：新增 ${result.created || 0}，更新 ${result.updated || 0}`);
        }
      } catch (error) {
        this.aiArchiveTaskSyncLastAt = { ...this.aiArchiveTaskSyncLastAt, [projectId]: Date.now() };
        ElMessage.warning(this.readApiError(error) || '任务记录自动同步失败，请稍后手动同步');
      } finally {
        this.loading.aiArchiveTaskSync = false;
      }
    },

    pollZentaoSync(syncKind = 'task') {
      if (this.zentaoSyncTimer) clearTimeout(this.zentaoSyncTimer);
      this.zentaoSyncTimer = setTimeout(async () => {
        try {
          await this.refreshConfig();
          const sync = this.appConfig.zentaoAutoSync || {};
          const stillRunning = syncKind === 'bug'
            ? Boolean(sync.bugs?.running)
            : syncKind === 'task'
              ? Boolean(sync.tasks?.running)
              : Boolean(sync.running || sync.tasks?.running || sync.bugs?.running);
          if (stillRunning) {
            this.pollZentaoSync(syncKind);
            return;
          }
          this.manualZentaoSyncPending = false;
          this.stopZentaoAutoSyncPolling();
          if (syncKind === 'bug') {
            await Promise.all([this.refreshBugs(), this.refreshConfig()]);
          } else if (syncKind === 'task') {
            await Promise.all([this.refreshTasks(), this.refreshConfig()]);
          } else {
            await Promise.all([this.refreshTasks(), this.refreshBugs(), this.refreshConfig()]);
          }
          const finalSync = this.appConfig.zentaoAutoSync || sync;
          const errorText = this.zentaoSyncLastError;
          if (errorText) {
            ElMessage.warning(`同步已结束，部分数据保留上次结果：${this.zentaoSyncFailureText(errorText)}`);
            return;
          }
          const tasks = finalSync.tasks?.lastSummary || finalSync.lastSummary || {};
          const bugs = finalSync.bugs?.lastSummary || finalSync.lastSummary?.bugs || {};
          if (syncKind === 'bug') {
            ElMessage.success(`同步 Bug 完成：新增 ${bugs.created || 0}，更新 ${bugs.updated || 0}`);
          } else if (syncKind === 'task') {
            const discovered = tasks.classicUserTaskDiscovery?.discovered || 0;
            ElMessage.success(`同步任务完成：新增 ${tasks.created || 0}，更新 ${tasks.updated || 0}${discovered ? `，人员页发现 ${discovered} 个当前任务` : ''}`);
          } else {
            ElMessage.success(`同步完成：任务新增 ${tasks.created || 0}，更新 ${tasks.updated || 0}；Bug 新增 ${bugs.created || 0}，更新 ${bugs.updated || 0}`);
          }
        } catch (error) {
          this.manualZentaoSyncPending = false;
          ElMessage.warning(this.readApiError(error) || '同步状态刷新失败，请稍后查看任务列表。');
        } finally {
          this.loading.syncTasks = false;
        }
      }, 1000);
    },

    zentaoSyncFailureText(message = '') {
      const text = String(message || '').trim();
      if (/ENOTFOUND|getaddrinfo|fetch failed/i.test(text)) return '当前网络无法连接禅道，已保留现有任务列表。';
      if (/timeout|ETIMEDOUT|timed out/i.test(text)) return '禅道响应超时，已保留现有任务列表。';
      if (/未获取到可同步的执行/i.test(text)) return '没有获取到符合美术部筛选条件的执行，已保留现有任务列表。';
      return text || '禅道同步失败，已保留现有任务列表。';
    },

    bumpTaskCenterRevision() {
      this.taskCenterRevision += 1;
    },

    updateTaskFilter(key, value) {
      if (!Object.prototype.hasOwnProperty.call(this.taskFilters, key)) return;
      this.taskFilters = {
        ...this.taskFilters,
        [key]: value || ''
      };
      this.businessTaskPage = 1;
      this.bumpTaskCenterRevision();
    },

    taskCenterFilterState() {
      return {
        filters: { ...this.taskFilters },
        person: { ...this.personStatFilter },
        mode: this.taskCenterMode
      };
    },

    taskCenterModeForView(_revision = 0) {
      const { filters, mode } = this.taskCenterFilterState();
      return this.taskMetricMode(filters.metric) || mode;
    },

    isTaskPersonStatFilterActive() {
      return Boolean(this.personStatFilter?.person);
    },

    hasActiveTaskFiltersForView(_revision = 0) {
      const { filters, person } = this.taskCenterFilterState();
      return Boolean(
        filters.projectId
        || filters.zentaoStatus
        || filters.platformStatus
        || filters.metric
        || filters.keyword
        || person.person
        || person.type
      );
    },

    activeTaskFilterTextForView(_revision = 0) {
      const { filters, person } = this.taskCenterFilterState();
      const parts = [];
      const project = this.projects.find(item => item.id === filters.projectId);
      if (project) parts.push(`项目：${project.name}`);
      if (filters.metric) parts.push(`指标：${this.taskMetricLabel(filters.metric)}`);
      if (filters.zentaoStatus) parts.push(`禅道状态：${this.zentaoStatusLabel(filters.zentaoStatus)}`);
      if (filters.platformStatus) parts.push(`交付状态：${this.businessTaskStatusLabel(filters.platformStatus)}`);
      if (person.person) parts.push(`${this.isPlatformAdmin ? '负责人' : '人员'}：${person.person}`);
      if (person.type === 'dueToday') parts.push('人员统计：今日截止');
      if (person.type === 'risk') parts.push('人员统计：卡点');
      if (person.type === 'task') parts.push('人员统计：任务');
      if (person.type === 'bug') parts.push('人员统计：Bug');
      if (filters.keyword) parts.push(`关键词：${filters.keyword}`);
      return parts.join(' / ') || '全部';
    },

    filteredBusinessTaskRowsForView(_revision = 0) {
      const { filters, person } = this.taskCenterFilterState();
      if (!this.hasActiveTaskFiltersForView(_revision)) return this.taskCenterCurrentArtMemberTaskRows;
      const keyword = String(filters.keyword || '').trim().toLowerCase();
      const today = localDateKey(new Date());
      const includeNonCurrent = filters.metric === 'nonCurrentTasks' || Boolean(keyword);
      const sourceRows = includeNonCurrent
        ? this.taskCenterArtMemberTaskRows
        : this.taskCenterCurrentArtMemberTaskRows;
      return sourceRows.filter(task => {
        const projectMatched = !filters.projectId || task.projectId === filters.projectId;
        const zentaoStatusMatched = !filters.zentaoStatus || task.zentaoStatus === filters.zentaoStatus;
        const platformStatusMatched = !filters.platformStatus || task.platformStatus === filters.platformStatus;
        const taskModeMetricMatched = !filters.metric || this.taskMetricMode(filters.metric) === 'task';
        const metricMatched = this.taskMetricMatchedForView(task, filters.metric);
        const personMatched = this.taskBelongsToPerson(task, person.person);
        const dueMatched = person.type !== 'dueToday' || task.deadline === today;
        const riskMatched = person.type !== 'risk' || this.isArtTaskRisk(task);
        const haystack = `${task.taskNo || ''}\n${task.title || ''}\n${task.displayTitle || ''}\n${task.developer || ''}\n${(task.zentao?.risks || []).join(' ')}`.toLowerCase();
        return taskModeMetricMatched && projectMatched && zentaoStatusMatched && platformStatusMatched && metricMatched && personMatched && dueMatched && riskMatched && (!keyword || haystack.includes(keyword));
      });
    },

    filteredBugRowsForView(_revision = 0) {
      const { filters, person } = this.taskCenterFilterState();
      if (!this.hasActiveTaskFiltersForView(_revision)) return this.taskCenterBugRows;
      const keyword = String(filters.keyword || '').trim().toLowerCase();
      return this.taskCenterBugRows.filter(bug => {
        const projectMatched = !filters.projectId || bug.projectId === filters.projectId;
        const statusMatched = !filters.zentaoStatus || bug.status === filters.zentaoStatus;
        const bugModeMetricMatched = !filters.metric || this.taskMetricMode(filters.metric) === 'bug';
        const metricMatched = this.bugMetricMatchedForView(bug, filters.metric);
        const personMatched = this.bugBelongsToPerson(bug, person.person);
        const riskFilterMatched = person.type !== 'risk';
        const haystack = `${bug.bugNo || ''}\n${bug.title || ''}\n${bug.displayTitle || ''}\n${bug.developer || ''}\n${bug.assignedTo || ''}`.toLowerCase();
        return bugModeMetricMatched && projectMatched && statusMatched && metricMatched && personMatched && riskFilterMatched && (!keyword || haystack.includes(keyword));
      });
    },

    taskCenterRowsForView(revision = 0) {
      const mode = this.taskCenterModeForView(revision);
      if (mode === 'bug') return this.filteredBugRowsForView(revision);
      return this.filteredBusinessTaskRowsForView(revision);
    },

    pagedBusinessTaskRowsForView(revision = 0) {
      return paginate(this.filteredBusinessTaskRowsForView(revision), this.businessTaskPage, this.businessTaskPageSize);
    },

    pagedBugRowsForView(revision = 0) {
      return paginate(this.filteredBugRowsForView(revision), this.businessTaskPage, this.businessTaskPageSize);
    },

    taskCenterTotalForView(revision = 0) {
      return this.taskCenterRowsForView(revision).length;
    },

    taskMetricMatchedForView(task, metric = '') {
      if (!metric) return true;
      if (this.taskMetricMode(metric) !== 'task') return false;
      const today = localDateKey(new Date());
      if (metric === 'allTasks') return true;
      if (metric === 'todayDue') return task.deadline === today;
      if (metric === 'soonDue') return ['soon', 'overdue'].includes(this.deadlineState(task.deadline || task.zentao?.deadline));
      if (metric === 'currentTasks') return task.isCurrent !== false;
      if (metric === 'nonCurrentTasks') return task.isCurrent === false;
      if (metric === 'urgentTask') return this.isUrgentTask(task);
      if (metric === 'insertTask') return this.isInsertTask(task);
      if (metric === 'riskTask') return this.isArtTaskRisk(task);
      if (metric === 'executed') return task.runCount > 0;
      if (metric === 'unexecuted') return task.runCount === 0;
      if (this.isLowEffortArtAcceptanceTask(task)) return false;
      if (metric === 'levelXS') return task.workloadEstimate?.level === 'XS';
      if (metric === 'levelS') return task.workloadEstimate?.level === 'S';
      if (metric === 'levelM') return task.workloadEstimate?.level === 'M';
      if (metric === 'levelL') return task.workloadEstimate?.level === 'L';
      if (metric === 'quality') return task.quality.executed || task.quality.reviewed;
      if (metric === 'taskRelatedBug') return task.quality.bugCount > 0;
      if (metric === 'passed') return statusBucket(task.platformStatus) === 'passed';
      if (metric === 'blocked') return ['blocked', 'failed'].includes(statusBucket(task.platformStatus));
      return false;
    },

    bugMetricMatchedForView(bug, metric = '') {
      if (!metric) return true;
      if (this.taskMetricMode(metric) !== 'bug') return false;
      if (metric === 'webBug') return true;
      if (metric === 'activeBug') return /active|激活|opened|delay/i.test(bug.status || '');
      if (metric === 'pendingCloseBug') return /pending_close|resolved/i.test(bug.status || '') && !bug.zentao?.closedBy && !bug.zentao?.closedDate;
      if (metric === 'onlineBug') return /线上\s*bug|线上/i.test(bug.title || bug.displayTitle || '');
      if (metric === 'internalBug') return !/线上\s*bug|线上/i.test(bug.title || bug.displayTitle || '');
      if (metric === 'urgentBug') return Number(bug.pri || 0) <= 2 || Number(bug.severity || 0) <= 2;
      if (metric === 'bugRelatedTask') return Boolean(bug.zentao?.task);
      return false;
    },

    applyPersonStatFilter(person, type) {
      if (!person) return;
      this.preservePersonFilterOnModeSwitch = true;
      this.taskFilters = {
        ...this.taskFilters,
        keyword: '',
        zentaoStatus: '',
        platformStatus: '',
        metric: ''
      };
      this.personStatFilter = { person, type };
      this.taskCenterMode = type === 'bug' ? 'bug' : 'task';
      this.businessTaskPage = 1;
      this.bumpTaskCenterRevision();
      this.$nextTick(() => {
        this.preservePersonFilterOnModeSwitch = false;
      });
    },

    clearPersonStatFilter() {
      this.personStatFilter = { person: '', type: '' };
      this.businessTaskPage = 1;
      this.bumpTaskCenterRevision();
    },

    isPersonStatActive(person, type) {
      return this.personStatFilter.person === person && this.personStatFilter.type === type;
    },

    switchTaskCenterMode(mode) {
      this.taskCenterMode = ['task', 'bug'].includes(mode) ? mode : 'task';
      this.taskFilters = {
        ...this.taskFilters,
        metric: '',
        zentaoStatus: '',
        platformStatus: '',
        keyword: ''
      };
      this.personStatFilter = { person: '', type: '' };
      this.businessTaskPage = 1;
      this.bumpTaskCenterRevision();
    },

    applyTaskMetricFilter(metric) {
      if (!metric) return;
      const sameMetric = this.taskFilters.metric === metric;
      const nextMode = this.taskMetricMode(metric) || this.taskCenterMode;
      this.preserveMetricOnModeSwitch = true;
      this.personStatFilter = { person: '', type: '' };
      this.taskCenterMode = nextMode;
      this.taskFilters = {
        ...this.taskFilters,
        keyword: '',
        zentaoStatus: '',
        platformStatus: '',
        metric: sameMetric ? '' : metric
      };
      this.businessTaskPage = 1;
      this.bumpTaskCenterRevision();
      this.$nextTick(() => {
        this.preserveMetricOnModeSwitch = false;
      });
    },

    isTaskMetricActive(metric) {
      return this.taskFilters.metric === metric;
    },

    isBugMetric(metric) {
      return this.taskMetricMode(metric) === 'bug';
    },

    taskMetricMode(metric) {
      if (['webBug', 'activeBug', 'pendingCloseBug', 'onlineBug', 'internalBug', 'urgentBug', 'bugRelatedTask'].includes(metric)) return 'bug';
      if ([
        'allTasks',
        'todayDue',
        'soonDue',
        'currentTasks',
        'nonCurrentTasks',
        'urgentTask',
        'insertTask',
        'riskTask',
        'executed',
        'unexecuted',
        'levelXS',
        'levelS',
        'levelM',
        'levelL',
        'quality',
        'taskRelatedBug',
        'passed',
        'blocked'
      ].includes(metric)) return 'task';
      return '';
    },

    taskMetricLabel(metric) {
      const metrics = [
        ...this.taskCenterMetrics,
        { label: '有执行记录', filter: 'executed' },
        { label: '未执行', filter: 'unexecuted' }
      ];
      return metrics.find(item => item.filter === metric)?.label || metric;
    },

    clearTaskFilters() {
      this.taskFilters = {
        projectId: '',
        zentaoStatus: '',
        platformStatus: '',
        metric: '',
        keyword: ''
      };
      this.personStatFilter = { person: '', type: '' };
      this.businessTaskPage = 1;
      this.bumpTaskCenterRevision();
    },

    metricValueClass(metric) {
      if (['todayDue', 'soonDue', 'webBug', 'activeBug', 'pendingCloseBug', 'onlineBug', 'urgentBug', 'taskRelatedBug', 'bugRelatedTask', 'blocked', 'levelL'].includes(metric)) return 'is-danger';
      if (['quality', 'urgentTask', 'insertTask', 'riskTask', 'levelM'].includes(metric)) return 'is-warning';
      if (['nonCurrentTasks', 'unexecuted', 'internalBug', 'levelXS'].includes(metric)) return 'is-muted';
      if (['executed'].includes(metric)) return 'is-info';
      return 'is-success';
    },

    applyTaskBugFilter(task) {
      if (!task?.taskNo || !task.quality?.bugCount) return;
      this.taskCenterMode = 'bug';
      this.taskFilters = {
        ...this.taskFilters,
        keyword: task.taskNo,
        zentaoStatus: '',
        platformStatus: '',
        metric: ''
      };
      this.personStatFilter = { person: '', type: '' };
      this.businessTaskPage = 1;
      this.bumpTaskCenterRevision();
    },

    selectBusinessTask(task) {
      this.selectedBusinessTaskId = task.id;
      this.taskProcessingSheetOpen = true;
      this.seedTaskReviewForm(task);
      this.refreshSelectedBusinessTaskBrief();
    },

    toggleTaskProcessingSheet() {
      this.taskProcessingSheetOpen = !this.taskProcessingSheetOpen;
    },

    getTaskAssigneeAccount(person = {}) {
      const name = person.name || person.realname || person.account || '';
      const member = [...DEFAULT_ART_DEPT_PEOPLE, ...this.artDepartmentUsers]
        .find(item => samePerson(item.realname, name) || samePerson(item.name, name) || samePerson(item.account, name));
      return member?.account || '';
    },

    getTaskAssigneeName(account = '') {
      const member = [...DEFAULT_ART_DEPT_PEOPLE, ...this.artDepartmentUsers]
        .find(item => String(item.account || '') === String(account || ''));
      return member?.realname || member?.name || account;
    },

    startTaskAssignDrag(task, event) {
      const taskKey = this.taskOperationKey(task);
      if (!this.canAssignTaskByDrag || !taskKey) return;
      this.draggingTaskId = taskKey;
      this.draggingTask = task;
      if (event?.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', taskKey);
      }
    },

    clearTaskAssignDrag() {
      this.draggingTaskId = '';
      this.draggingTask = null;
    },

    async handleTaskDropToPerson(person = {}) {
      const task = this.draggingTask;
      this.clearTaskAssignDrag();
      const taskKey = this.taskOperationKey(task);
      if (!taskKey || !this.canAssignTaskByDrag) return;
      const account = this.getTaskAssigneeAccount(person);
      try {
        this.loading.taskAssign = true;
        const updated = await this.api(`/api/tasks/${encodeURIComponent(taskKey)}/assign-zentao`, {
          method: 'POST',
          body: JSON.stringify({
            assignedTo: account,
            assignedName: person.name || this.getTaskAssigneeName(account),
            taskId: task.id || '',
            taskNo: task.taskNo || task.zentao?.id || ''
          })
        });
        this.applyUpdatedBusinessTask(updated);
        ElMessage.success(`已指派给 ${person.name || this.getTaskAssigneeName(account)}，并写入禅道。`);
        this.refreshTasks().catch(() => {});
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '任务指派失败');
      } finally {
        this.loading.taskAssign = false;
      }
    },

    applyUpdatedBusinessTask(updated = {}) {
      if (!updated?.id) return;
      const updatedTaskNo = String(updated.taskNo || updated.zentao?.id || '').trim();
      const index = this.businessTasks.findIndex(item => item.id === updated.id
        || (updatedTaskNo
          && String(item.projectId || '') === String(updated.projectId || '')
          && String(item.taskNo || item.zentao?.id || '').trim() === updatedTaskNo));
      if (index >= 0) this.businessTasks.splice(index, 1, { ...this.businessTasks[index], ...updated });
      else this.businessTasks.unshift(updated);
      this.bumpTaskCenterRevision();
    },

    removeDeletedTaskFromLocalState(task = {}) {
      const deletedId = String(task.id || task.taskId || '').trim();
      const deletedTaskNo = String(task.taskNo || task.zentaoId || task.zentao?.id || '').trim();
      const beforeCount = this.businessTasks.length;
      this.businessTasks = this.businessTasks.filter(item => {
        if (deletedId && item.id === deletedId) return false;
        const itemTaskNo = String(item.taskNo || item.zentaoId || item.zentao?.id || '').trim();
        return !(deletedTaskNo && itemTaskNo === deletedTaskNo && (!task.projectId || item.projectId === task.projectId));
      });
      this.taskReviews = this.taskReviews.filter(review => {
        if (deletedId && review.taskId === deletedId) return false;
        return !(deletedTaskNo && review.taskNo === deletedTaskNo && (!task.projectId || review.projectId === task.projectId));
      });
      if (deletedId) {
        const nextNotes = { ...this.taskProcessingNotes };
        const nextBriefs = { ...this.taskArtBriefs };
        delete nextNotes[deletedId];
        delete nextBriefs[deletedId];
        this.taskProcessingNotes = nextNotes;
        this.taskArtBriefs = nextBriefs;
        localStorage.setItem('art-task-processing-notes', JSON.stringify(this.taskProcessingNotes));
        localStorage.setItem('art-task-briefs', JSON.stringify(this.taskArtBriefs));
        if (this.selectedBusinessTaskId === deletedId) {
          this.selectedBusinessTaskId = '';
          this.taskProcessingSheetOpen = false;
        }
      }
      if (beforeCount !== this.businessTasks.length) {
        this.saveWorkbenchDisplayCache('businessTasks', this.businessTasks);
        this.bumpTaskCenterRevision();
      }
    },

    canDeletePlatformTask(task = {}) {
      return this.can('task.platform.delete')
        && task?.source === 'platform'
        && !isBugLikeTask(task);
    },

    async deletePlatformTask(task = {}) {
      if (!this.canDeletePlatformTask(task)) return;
      const title = this.taskDisplayTitle(task) || task.title || task.id || '平台创建任务';
      try {
        await ElMessageBox.confirm(
          `确认删除「${title}」？删除后会从平台任务中心数据中销毁，并清理该单的备注、验收和美术摘要；不会删除禅道任务，也不会删除已产生的执行档案。`,
          '删除平台创建任务',
          {
            type: 'warning',
            confirmButtonText: '确认删除',
            cancelButtonText: '取消'
          }
        );
      } catch {
        return;
      }
      try {
        const result = await this.api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
        this.removeDeletedTaskFromLocalState(result?.task || task);
        ElMessage.success('平台创建任务已删除');
        this.refreshTasks().catch(() => {});
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '平台创建任务删除失败');
      }
    },

    shouldShowTaskSplitButton(task = {}) {
      if (!this.isPlatformAdmin || !this.can('task.sync')) return false;
      if (this.isSgProjectTask(task)) return false;
      if (!this.isArtOwnerPerson(task.developer || task.zentao?.assignedToName || task.zentao?.assignedToRealName || task.assignedTo)) return false;
      return !this.hasTaskRunRecords(task);
    },

    taskOperationKey(task = {}) {
      const candidates = [task.taskNo, task.zentao?.id, task.zentaoId, task.id];
      return String(candidates.find(value => String(value || '').trim()) || '').trim();
    },

    isSgProjectTask(task = {}) {
      const text = [
        task.projectName,
        task.title,
        task.displayTitle,
        task.summary,
        task.requirement,
        task.zentao?.storyTitle,
        task.zentao?.parentName,
        task.zentao?.executionName
      ].map(value => String(value || '')).join('\n');
      return /(?:^|[^A-Za-z0-9])SG(?:[^A-Za-z0-9]|$)|SG版本需求|SG项目|SG翡翠绿|翡翠绿/i.test(text);
    },

    async openTaskSplitDialog(task = {}) {
      if (!this.shouldShowTaskSplitButton(task)) return;
      try {
        this.loading.taskSplit = true;
        const taskKey = this.taskOperationKey(task);
        const plan = await this.api(`/api/tasks/${encodeURIComponent(taskKey)}/split-plan`, { method: 'POST' });
        this.taskSplitDialog = {
          visible: true,
          task,
          assignees: Array.isArray(plan.assignees) ? plan.assignees : [],
          plan: {
            ...plan,
            children: (Array.isArray(plan.children) ? plan.children : []).map((row, index) => ({
              id: row.id || `child-${index + 1}`,
              enabled: row.enabled !== false,
              name: row.name || '',
              assignedTo: row.assignedTo || '',
              deadline: row.deadline || plan.deadline || '',
              estimate: Number(row.estimate || 0),
              executionId: row.executionId || plan.executionId || '',
              parent: row.parent || plan.parent || plan.taskId || ''
            }))
          }
        };
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '生成拆单方案失败');
      } finally {
        this.loading.taskSplit = false;
      }
    },

    addTaskSplitChild() {
      const plan = this.taskSplitDialog.plan;
      const next = (plan.children || []).length + 1;
      plan.children.push({
        id: `manual-${Date.now()}-${next}`,
        enabled: true,
        name: `【制作单】${plan.title || '子单'}-${next}`,
        assignedTo: plan.mainAssignee || this.taskSplitDialog.assignees[0]?.account || '',
        deadline: plan.deadline || '',
        estimate: 0,
        executionId: plan.executionId || '',
        parent: plan.parent || plan.taskId || ''
      });
    },

    removeTaskSplitChild(index) {
      this.taskSplitDialog.plan.children.splice(index, 1);
    },

    async submitTaskSplitPlan() {
      const task = this.taskSplitDialog.task;
      const taskKey = this.taskOperationKey(task);
      if (!taskKey) return;
      const enabledChildren = (this.taskSplitDialog.plan.children || []).filter(row => row.enabled !== false);
      if (!this.taskSplitDialog.plan.mainAssignee && !enabledChildren.length) {
        ElMessage.warning('请至少选择主单负责人或保留一条子单。');
        return;
      }
      try {
        await ElMessageBox.confirm('确认后会直接写入禅道，包含主单指派和启用的子单。是否继续？', '确认拆单', {
          type: 'warning',
          confirmButtonText: '确认写入',
          cancelButtonText: '取消'
        });
      } catch {
        return;
      }
      try {
        this.loading.taskSplit = true;
        const result = await this.api(`/api/tasks/${encodeURIComponent(taskKey)}/split-apply`, {
          method: 'POST',
          body: JSON.stringify({ plan: this.taskSplitDialog.plan })
        });
        this.taskSplitDialog.visible = false;
        const failed = Array.isArray(result?.results) ? result.results.filter(item => item.ok === false) : [];
        if (failed.length) {
          ElMessage.warning(`拆单已处理，成功 ${result.successCount || 0} 条，失败 ${failed.length} 条；失败项请查看操作日志。`);
        } else {
          ElMessage.success('拆单已写入禅道。');
        }
        await this.refreshTasks();
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '拆单写入失败');
      } finally {
        this.loading.taskSplit = false;
      }
    },

    handleVisibilityRefresh() {
      return;
    },

    refreshVisibleTaskBriefs() {
      return;
    },

    async refreshSelectedBusinessTaskBrief() {
      const task = this.selectedBusinessTask;
      if (!task?.id) return;
      try {
        const fresh = await this.api(`/api/tasks/${encodeURIComponent(task.id)}`);
        const index = this.businessTasks.findIndex(item => item.id === task.id);
        if (index >= 0) this.businessTasks.splice(index, 1, { ...this.businessTasks[index], ...fresh });
        if (fresh.artBrief) this.rememberTaskArtBrief(fresh, fresh.artBrief);
      } catch {}
    },

    loadTaskProcessingNotes() {
      try {
        const saved = JSON.parse(localStorage.getItem('art-task-processing-notes') || '{}') || {};
        return Object.fromEntries(Object.entries(saved).map(([taskId, value]) => [
          taskId,
          typeof value === 'object' && value !== null ? value : { taskId, note: String(value || '') }
        ]));
      } catch {
        return {};
      }
    },

    taskProcessingNote(task = this.selectedBusinessTask) {
      if (!task?.id) return '';
      return this.taskProcessingNotes[task.id]?.note || '';
    },

    updateTaskProcessingNote(task, value) {
      if (!task?.id) return;
      const existing = this.taskProcessingNotes[task.id] || {};
      this.taskProcessingNotes = {
        ...this.taskProcessingNotes,
        [task.id]: {
          ...existing,
          taskId: task.id,
          projectId: task.projectId,
          taskNo: task.taskNo || task.zentao?.id || '',
          title: task.displayTitle || task.title || task.taskNo || task.id,
          note: String(value || '')
        }
      };
    },

    async saveTaskProcessingNote(task = this.selectedBusinessTask) {
      if (!this.can('task.note.manage')) {
        ElMessage.warning('当前角色没有保存任务备注的权限');
        return;
      }
      if (!task?.id) return;
      try {
        this.loading.taskNotes = true;
        const result = await this.api('/api/task-processing-notes', {
          method: 'POST',
          body: JSON.stringify({
            taskId: task.id,
            note: this.taskProcessingNote(task)
          })
        });
        this.taskProcessingNotes = {
          ...this.taskProcessingNotes,
          [result.taskId || task.id]: result
        };
        ElMessage.success(this.isPlatformAdmin ? '处理备注已保存并同步给团队' : '处理备注已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '处理备注保存失败');
      } finally {
        this.loading.taskNotes = false;
      }
    },

    taskProcessingNoteMeta(task = this.selectedBusinessTask) {
      if (!task?.id) return '';
      const record = this.taskProcessingNotes[task.id];
      if (!record?.updatedAt) return '';
      return `${record.updatedByName || '成员'} 更新于 ${this.formatDateTime(record.updatedAt)}`;
    },

    async auditUserAction(action, payload = {}) {
      if (!this.currentUser || !action) return;
      await this.api('/api/audit/action', {
        method: 'POST',
        body: JSON.stringify({ action, ...payload })
      }).catch(() => {});
    },

    taskProcessingStatus(task = this.selectedBusinessTask) {
      if (!task) return '未选择';
      if (task.latestRun?.status) return this.runStatusLabel(task.latestRun.status);
      if (task.platformStatus) return this.businessTaskStatusLabel(task.platformStatus);
      if (task.zentaoStatus || task.zentao?.originalStatus) return this.zentaoStatusLabel(task.zentaoStatus || task.zentao?.originalStatus);
      return '尚未进入工作流';
    },

    taskProcessingSummary(task = this.selectedBusinessTask) {
      if (!task) return '未选择任务。';
      const generated = this.taskArtBriefForTask(task);
      if (generated) return generated.summaryText || '美术摘要已生成。';
      const summary = task.summary || task.requirement || task.description || task.zentao?.storyTitle || '';
      return String(summary || '').trim() || '未生成摘要。可以先记录沟通信息，再复制给 Codex 做需求拆解。';
    },

    loadTaskArtBriefs() {
      try {
        return JSON.parse(localStorage.getItem('art-task-briefs') || '{}') || {};
      } catch {
        return {};
      }
    },

    taskArtBriefForTask(task = this.selectedBusinessTask) {
      if (!task?.id) return null;
      const groupKey = task.artBriefGroup?.groupKey || task.artBrief?.groupKey || '';
      return [
        task.artBrief,
        this.taskArtBriefs[task.id],
        groupKey ? Object.values(this.taskArtBriefs || {}).find(record => record?.groupKey === groupKey) : null
      ].find(record => this.artBriefRecordMatchesTask(task, record)) || null;
    },

    artBriefRecordMatchesTask(task, record) {
      if (!task?.id || !record) return false;
      const taskGroup = task.artBriefGroup?.groupKey || task.artBrief?.groupKey || '';
      if (record.groupKey && taskGroup && record.groupKey === taskGroup) return true;
      if (record.taskNo && task.taskNo && String(record.taskNo) === String(task.taskNo)) return true;
      return false;
    },

    isTaskArtBriefLoading(task = this.selectedBusinessTask) {
      const key = this.artBriefLoadingKey(task);
      return Boolean(key && this.taskArtBriefLoading[key]);
    },

    async generateArtBriefForTask(task = this.selectedBusinessTask, options = {}) {
      if (!this.can('task.artBrief.generate')) {
        ElMessage.warning('当前角色没有生成美术摘要的权限');
        return null;
      }
      if (!task?.id) return;
      if (!task.taskNo) {
        ElMessage.warning('这条任务没有禅道任务号，不能生成美术摘要');
        return;
      }
      const loadingKey = this.artBriefLoadingKey(task);
      this.taskArtBriefLoading = {
        ...this.taskArtBriefLoading,
        [loadingKey]: true
      };
      try {
        const result = await this.api(`/api/tasks/${encodeURIComponent(task.id)}/art-brief`, {
          method: 'POST',
          body: JSON.stringify({ force: options.force === true })
        });
        const record = {
          ...result,
          taskId: task.id,
          taskNo: task.taskNo,
          title: task.title || task.displayTitle || ''
        };
        this.rememberTaskArtBrief(task, record);
        localStorage.setItem('art-task-briefs', JSON.stringify(this.taskArtBriefs));
        this.refreshTasks().catch(() => {});
        if (!options.silent) {
          ElMessage.success(options.force ? '美术摘要已重新生成' : (result.reused ? '已复用同主单美术摘要' : '美术摘要已生成'));
        }
        return record;
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '美术摘要生成失败');
        return null;
      } finally {
        this.taskArtBriefLoading = {
          ...this.taskArtBriefLoading,
          [loadingKey]: false
        };
      }
    },

    artBriefLoadingKey(task = this.selectedBusinessTask) {
      return task?.artBriefGroup?.groupKey || task?.artBrief?.groupKey || task?.id || '';
    },

    rememberTaskArtBrief(task, record) {
      const next = { ...this.taskArtBriefs };
      const groupKey = record?.groupKey || task?.artBriefGroup?.groupKey || '';
      if (task?.id && this.artBriefRecordMatchesTask(task, record)) next[task.id] = record;
      if (groupKey) {
        this.businessTasks
          .filter(item => (item.artBriefGroup?.groupKey || item.artBrief?.groupKey || '') === groupKey)
          .forEach(item => {
            if (!this.artBriefRecordMatchesTask(item, record)) return;
            next[item.id] = {
              ...record,
              taskId: item.id,
              taskNo: item.taskNo,
              title: item.title || item.displayTitle || record.title || ''
            };
            item.artBrief = next[item.id];
          });
      }
      if (task?.id && next[task.id]) task.artBrief = next[task.id];
      this.taskArtBriefs = next;
    },

    async openTaskArtBrief(task = this.selectedBusinessTask) {
      let record = this.taskArtBriefForTask(task);
      if (!record?.reportUrl) {
        ElMessage.warning('请先生成美术摘要');
        return;
      }
      if (!(await this.isArtifactUrlAvailable(record.reportUrl))) {
        ElMessage.warning('原美术摘要文件已失效，正在重新生成');
        record = await this.generateArtBriefForTask(task, { silent: true });
        if (!record?.reportUrl) return;
      }
      window.open(record.reportUrl, '_blank', 'noopener,noreferrer');
    },

    async isArtifactUrlAvailable(url = '') {
      if (!url) return false;
      try {
        const response = await fetch(url, { method: 'HEAD' });
        if (response.status === 401) return false;
        return response.ok;
      } catch {
        return false;
      }
    },

    codexPromptForTask(task = this.selectedBusinessTask) {
      if (!task) return '';
      const risks = this.taskPriorityFlags(task).map(flag => flag.label).join('、') || '暂无明显风险';
      const note = this.taskProcessingNote(task) || '暂无处理备注';
      return [
        this.isPlatformAdmin ? '你现在协助美术部门负责人处理一条美术任务。' : '你现在协助处理一条美术任务。',
        `任务：${this.taskDisplayTitle(task)}`,
        `禅道编号：${task.taskNo || '-'}`,
        `${this.isPlatformAdmin ? '负责人' : '处理人'}：${task.developer || '未填写'}`,
        `项目：${task.projectName || task.projectId || '-'}`,
        `截止时间：${task.deadline || task.zentao?.deadline || '-'}`,
        `当前状态：${this.businessTaskStatusLabel(task.platformStatus)} / ${this.zentaoStatusLabel(task.zentaoStatus || task.zentao?.originalStatus)}`,
        `风险标签：${risks}`,
        `美术摘要：${this.taskProcessingSummary(task)}`,
        `处理备注：${note}`,
        '请先只做分析：拆解需求范围、素材/界面确认点、风险、建议执行步骤，不要直接改文件。'
      ].join('\n');
    },

    copyCodexPromptForTask(task = this.selectedBusinessTask) {
      if (!this.can('task.codexPrompt.copy')) {
        ElMessage.warning('当前角色没有复制 Codex 指令的权限');
        return;
      }
      return this.copyText(this.codexPromptForTask(task), '给 Codex 的指令');
    },

    selectAiArchiveTask(task) {
      this.selectedAiArchiveTaskId = task.id;
      if (task.archiveRowType !== 'manual-only') {
        this.selectedBusinessTaskId = task.id;
        this.seedTaskReviewForm(task);
      }
    },

    exportAiArchiveCsv() {
      const rows = this.filteredAiArchiveRows.map(task => ({
        taskNo: task.taskNo || '',
        title: task.title || '',
        project: task.projectName || task.projectId || '',
        developer: task.developer || '',
        agentModel: task.manualFlowRecord?.agentModel || '',
        flowCompletion: task.manualFlowRecord ? `${task.manualFlowRecord.flowCompletion || 0}%` : '',
        flowStatus: this.aiFlowRecordStatusLabel(task.manualFlowRecord?.status),
        totalDuration: task.manualFlowRecord?.totalDuration || '',
        summaryIssues: task.manualFlowRecord?.summaryIssues || '',
        zentaoStatus: this.zentaoStatusLabel(task.zentaoStatus || task.zentao?.originalStatus),
        platformStatus: this.businessTaskStatusLabel(task.platformStatus),
        runCount: task.runCount,
        aiScore: task.quality.executed ? task.quality.aiScore : '',
        stageCompletion: task.quality.stageCompletion,
        bugCount: task.quality.bugCount,
        criticalBugCount: task.quality.criticalBugCount,
        latestRunAt: this.formatDateTime(task.latestRunAt),
        deadline: task.deadline || '',
        lastSyncedAt: this.formatDateTime(task.lastSyncedAt || task.updatedAt)
      }));
      this.downloadTextFile(`ai-archive-${localDateKey(new Date())}.csv`, toCsv(rows));
      ElMessage.success(`已导出 ${rows.length} 条开发库记录`);
    },

    exportTaskArchive(task) {
      const relatedRuns = this.runsForTask(task);
      const payload = {
        exportedAt: new Date().toISOString(),
        task: {
          id: task.id,
          taskNo: task.taskNo,
          title: task.title,
          projectId: task.projectId,
          projectName: task.projectName,
          developer: task.developer,
          source: task.source,
          zentaoStatus: task.zentaoStatus || task.zentao?.originalStatus || '',
          platformStatus: task.platformStatus,
          deadline: task.deadline,
          zentaoCreatedAt: task.zentaoCreatedAt,
          lastSyncedAt: task.lastSyncedAt,
          zentao: task.zentao || {}
        },
        quality: this.archiveQualityPayload(task.quality),
        manualFlowRecord: task.manualFlowRecord || this.aiFlowRecordForTask(task) || null,
        reviews: this.reviewsForTask(task),
        bugs: this.bugsForTask(task),
        runs: relatedRuns.map(run => ({
          id: run.id,
          title: run.title,
          attemptNo: this.runAttemptNumber(run),
          workflow: run.workflow,
          workflowLevel: run.workflowLevel,
          status: run.status,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          updatedAt: run.updatedAt,
          resultSummary: run.resultSummary || null,
          changeSummary: run.changeSummary || null,
          stages: run.stages || [],
          logPath: run.logPath || '',
          artifactRoot: run.artifactRoot || ''
        }))
      };
      this.downloadTextFile(`task-archive-${task.taskNo || task.id}.json`, `${JSON.stringify(payload, null, 2)}\n`, 'application/json');
      ElMessage.success('任务开发库记录已导出');
    },

    archiveQualityPayload(quality = {}) {
      const { reworkCount, ...rest } = quality;
      return rest;
    },

    downloadTextFile(filename, content, type = 'text/csv;charset=utf-8') {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    },

    openTaskRunHistory(task) {
      if (task.archiveRowType === 'manual-only') {
        ElMessage.info('这条开发库记录目前只有人工流程记录，还没有平台执行记录。');
        return;
      }
      this.selectBusinessTask(task);
      this.selectedAiArchiveTaskId = task.id;
      this.activeView = 'tasks';
      this.pushRoute('/tasks');
      this.$nextTick(() => {
        document.querySelector('.task-processing-sheet')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    },

    scrollAiArchiveSection(section) {
      this.$nextTick(() => {
        document.querySelector(`[data-ai-archive-section="${section}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    },

    openArchiveTaskBugs(task) {
      if (!task?.taskNo) return;
      this.taskCenterMode = 'bug';
      this.taskFilters = {
        ...this.taskFilters,
        keyword: task.taskNo,
        projectId: task.projectId || '',
        zentaoStatus: '',
        platformStatus: '',
        metric: ''
      };
      this.personStatFilter = { person: '', type: '' };
      this.businessTaskPage = 1;
      this.activeView = 'tasks';
      this.bumpTaskCenterRevision();
      this.pushRoute('/tasks');
    },

    aiFlowRecordForTask(task = {}) {
      const taskNo = String(task.taskNo || task.zentaoId || '').trim();
      return this.aiFlowRecords.find(record => record.status !== 'deleted' && record.projectId === task.projectId && taskNo && record.taskNo === taskNo)
        || this.aiFlowRecords.find(record => record.status !== 'deleted' && record.projectId === task.projectId && record.taskId && record.taskId === task.id)
        || null;
    },

    aiFlowManualOnlyArchiveRow(record = {}) {
      const project = this.projects.find(item => item.id === record.projectId);
      const zentaoTask = this.businessTasks.find(task => task.projectId === record.projectId && record.taskNo && task.taskNo === record.taskNo);
      return {
        id: `manual-flow-${record.id}`,
        archiveRowType: 'manual-only',
        manualFlowRecord: record,
        projectId: record.projectId,
        projectName: project?.name || record.projectId || '-',
        taskNo: record.taskNo,
        title: record.taskTitle || record.taskNameAndNo,
        displayTitle: record.taskNameAndNo || record.taskTitle || record.taskNo || '人工流程记录',
        developer: this.aiFlowRecordDeveloper(record) || this.zentaoTaskOwner(record) || zentaoTask?.developer || '',
        source: record.source,
        runCount: 0,
        latestRunAt: record.updatedAt || record.importedAt || record.createdAt,
        platformStatus: 'manual_record',
        zentaoStatus: record.zentaoStatus || record.zentao?.originalStatus || '',
        zentao: record.zentao || {},
        quality: {
          executed: false,
          reviewed: false,
          aiScore: 0,
          stageCompletion: 0,
          bugCount: 0,
          criticalBugCount: 0
        }
      };
    },

    aiFlowRecordDeveloper(record = {}) {
      const name = String(record.developer || '').trim();
      if (!name) return '';
      return this.artDeptPeopleAliasMap.get(normalizePersonName(name)) || name;
    },

    zentaoTaskOwner(target = {}) {
      const taskNo = String(target.taskNo || target.zentaoId || target.zentao?.id || '').trim();
      const projectId = target.projectId || this.selectedProjectId || '';
      const task = this.businessTasks.find(item => item.projectId === projectId && taskNo && item.taskNo === taskNo)
        || this.businessTasks.find(item => taskNo && item.taskNo === taskNo);
      return task?.developer || task?.zentao?.assignedToName || task?.zentao?.assignedToRealName || '';
    },

    openAiFlowRecordDialog(target = null) {
      const record = target?.manualFlowRecord || target || null;
      const task = target?.archiveRowType ? target : null;
      this.aiFlowRecordDialog.form = emptyAiFlowRecordForm({
        ...(record || {}),
        projectId: record?.projectId || task?.projectId || this.archiveFilters.projectId || this.selectedProjectId || this.projects[0]?.id || '',
        taskId: record?.taskId || (task?.archiveRowType !== 'manual-only' ? task?.id : '') || '',
        taskNo: record?.taskNo || task?.taskNo || '',
        taskNameAndNo: record?.taskNameAndNo || task?.displayTitle || task?.title || '',
        taskTitle: record?.taskTitle || task?.title || '',
        developer: record?.developer || task?.developer || ''
      });
      this.aiFlowRecordDialog.visible = true;
    },

    async saveAiFlowRecord() {
      const form = this.aiFlowRecordDialog.form;
      if (!form.projectId) {
        ElMessage.warning('请选择所属项目');
        return;
      }
      if (!String(form.taskNameAndNo || form.taskTitle || form.taskNo || '').trim()) {
        ElMessage.warning('请填写任务名称和单号');
        return;
      }
      const payload = {
        ...form,
        taskNo: form.taskNo || extractTaskNo(form.taskNameAndNo),
        source: form.source || 'manual'
      };
      this.loading.aiFlowRecords = true;
      try {
        const endpoint = payload.id ? `/api/ai-flow-records/${encodeURIComponent(payload.id)}` : '/api/ai-flow-records';
        const saved = await this.api(endpoint, {
          method: payload.id ? 'PUT' : 'POST',
          body: JSON.stringify(payload)
        });
        this.aiFlowRecords = [saved, ...this.aiFlowRecords.filter(item => item.id !== saved.id)];
        this.aiFlowRecordDialog.visible = false;
        ElMessage.success('人工全流程记录已保存');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '人工全流程记录保存失败');
      } finally {
        this.loading.aiFlowRecords = false;
      }
    },

    async deleteAiFlowRecord(record = null) {
      const target = record?.manualFlowRecord || record;
      if (!target?.id) return;
      await ElMessageBox.confirm(`确认删除「${target.taskTitle || target.taskNameAndNo || target.taskNo}」的人工全流程记录？`, '删除人工记录', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      });
      this.loading.aiFlowRecords = true;
      try {
        const deleted = await this.api(`/api/ai-flow-records/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
        this.aiFlowRecords = this.aiFlowRecords.map(item => item.id === deleted.id ? deleted : item).filter(item => item.status !== 'deleted');
        ElMessage.success('人工全流程记录已删除');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '人工全流程记录删除失败');
      } finally {
        this.loading.aiFlowRecords = false;
      }
    },

    async importAiFlowSheet() {
      const projectId = this.archiveFilters.projectId || this.selectedProjectId || this.projects[0]?.id || '';
      if (!projectId) {
        ElMessage.warning('请先选择项目');
        return;
      }
      this.loading.aiFlowImport = true;
      try {
        const result = await this.api('/api/ai-flow-records/import-sheet', {
          method: 'POST',
          body: JSON.stringify({ projectId, ...DEFAULT_AI_FLOW_SHEET })
        });
        await this.refreshAiFlowRecords();
        ElMessage.success(`已导入 ${result.total || 0} 条人工流程记录`);
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '表格历史数据导入失败');
      } finally {
        this.loading.aiFlowImport = false;
      }
    },

    aiFlowRecordStatusLabel(status = '') {
      if (status === 'confirmed') return '已确认';
      if (status === 'deleted') return '已删除';
      if (status === 'draft') return '草稿';
      return status ? status : '待补充';
    },

    selectBug(bug) {
      this.selectedBugId = bug?.id || '';
    },

    seedTaskReviewForm(task = this.selectedBusinessTask) {
      const latest = task?.quality?.latestReview;
      this.taskReviewForm = latest
        ? {
          decision: latest.decision || 'approved',
          score: latest.score ?? 80,
          requirementScore: latest.requirementScore ?? 80,
          qualityScore: latest.qualityScore ?? 80,
          uiScore: latest.uiScore ?? 80,
          validationScore: latest.validationScore ?? 80,
          bugCount: latest.bugCount ?? task?.quality?.bugCount ?? 0,
          criticalBugCount: latest.criticalBugCount ?? task?.quality?.criticalBugCount ?? 0,
          needsRework: Boolean(latest.needsRework),
          comment: ''
        }
        : {
          ...emptyTaskReviewForm(),
          bugCount: task?.quality?.bugCount || 0,
          criticalBugCount: task?.quality?.criticalBugCount || 0
        };
    },

    async submitTaskReview(task) {
      if (!task?.id) return;
      if (!this.hasTaskRunRecords(task)) {
        ElMessage.warning('任务尚未执行，不能提交人工验收');
        return;
      }
      const latestRunId = task.latestRun?.id || '';
      if (!latestRunId) {
        ElMessage.warning('没有找到关联的执行记录，不能提交人工验收');
        return;
      }
      const hasMeaningfulInput = Boolean(String(this.taskReviewForm.comment || '').trim())
        || this.taskReviewForm.decision !== 'approved'
        || Number(this.taskReviewForm.score) !== 80
        || Number(this.taskReviewForm.requirementScore) !== 80
        || Number(this.taskReviewForm.qualityScore) !== 80
        || Number(this.taskReviewForm.uiScore) !== 80
        || Number(this.taskReviewForm.validationScore) !== 80
        || Number(this.taskReviewForm.bugCount) > 0
        || Number(this.taskReviewForm.criticalBugCount) > 0
        || this.taskReviewForm.needsRework;
      if (!hasMeaningfulInput) {
        ElMessage.warning('请先填写评分、结论变化或验收说明，再提交人工验收');
        return;
      }
      const payload = {
        ...this.taskReviewForm,
        projectId: task.projectId,
        taskId: task.id,
        taskNo: task.taskNo || '',
        runId: latestRunId
      };
      await this.api('/api/task-reviews', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await this.refreshTaskReviews();
      this.seedTaskReviewForm(this.selectedBusinessTask);
      ElMessage.success('人工验收已记录');
    },

    loadTaskReviewRecord(review) {
      this.taskReviewForm = {
        decision: review.decision || 'approved',
        score: review.score ?? 80,
        requirementScore: review.requirementScore ?? 80,
        qualityScore: review.qualityScore ?? 80,
        uiScore: review.uiScore ?? 80,
        validationScore: review.validationScore ?? 80,
        bugCount: review.bugCount ?? 0,
        criticalBugCount: review.criticalBugCount ?? 0,
        needsRework: Boolean(review.needsRework),
        comment: review.comment || ''
      };
    },

    taskReviewDecisionLabel(decision) {
      return {
        approved: '人工通过',
        conditional: '有条件通过',
        rejected: '驳回'
      }[decision] || '待验收';
    },

    taskReviewDecisionTagType(decision) {
      return {
        approved: 'success',
        conditional: 'warning',
        rejected: 'danger'
      }[decision] || 'info';
    },

    newRunForm(overrides = {}) {
      return {
        ...emptyRunForm(),
        projectId: this.selectedProjectId || this.projects[0]?.id || '',
        developer: this.defaultRunDeveloperName,
        ...overrides
      };
    },

    async openRunCreateDrawer(overrides = {}) {
      const form = this.newRunForm(overrides);
      this.runForm = form;
      if (form.projectId && !this.scans[form.projectId]) {
        await this.ensureRunProjectScanCache(form.projectId);
      }
      this.runDrawer = true;
    },

    createRunFromTask(task) {
      const workloadLevel = this.isLowEffortArtAcceptanceTask(task)
        ? 'XS'
        : task.workloadEstimate?.level || inferTaskWorkloadLevel(task, this.projects.find(item => item.id === task.projectId))?.level || 'M';
      this.openRunCreateDrawer({
        taskId: task.id,
        projectId: task.projectId,
        sourceMode: 'zentao-task',
        executionMode: 'level-process',
        workflow: workflowForLevel(workloadLevel),
        workflowLevel: workloadLevel,
        title: this.taskDisplayTitle(task),
        zentaoId: task.taskNo || '',
        developer: task.developer || this.defaultRunDeveloperName,
        requirement: executionInstructionForTask(task),
        sourceType: 'task-center',
        createTaskForRun: true
      });
    },

    createRunFromSkillInventoryRow(row = {}) {
      const projectId = row.projectId || this.selectedProjectId || this.projects[0]?.id || '';
      const skillPath = row.skill?.git?.relativePath || row.relativePath || row.skill?.relativePath || row.path || row.skill?.path || row.id || '';
      const productName = row.productDisplayName || row.productFileName || row.title || this.fileNameFromPath(skillPath) || row.id || 'AI 产物';
      const ownerText = this.displayChinesePersonList(row.uploader || row.owner || '');
      const owner = ownerText && ownerText !== '-' ? ownerText : this.defaultRunDeveloperName;
      const scene = this.skillSceneText(row, '');
      const sourceLines = [
        skillPath ? `产物路径：${skillPath}` : '',
        row.source ? `来源：${row.source}` : '',
        owner ? `贡献人：${owner}` : '',
        scene ? `适用场景：${scene}` : ''
      ].filter(Boolean);
      this.openRunCreateDrawer({
        projectId,
        sourceMode: 'standalone',
        executionMode: 'single-skill',
        workflow: 'art-single-skill',
        workflowLevel: 'XS',
        stage: skillPath,
        title: `执行 ${productName}`,
        productName,
        sourceTitle: row.title || row.productDisplayName || row.productFileName || productName,
        primarySkillPath: skillPath,
        primarySkillContent: this.skillContentCache[row.id] || row.preview || row.skill?.preview || '',
        developer: owner,
        targetPage: skillPath || productName,
        showdocHints: skillPath,
        selectedMaterialHints: skillPath ? [skillPath] : [],
        requirement: [
          `请基于 AI 产物清单中的「${productName}」发起单个规范 / Skill 执行。`,
          ...sourceLines,
          '执行时优先读取该 md / SKILL.md 或产物路径，按当前对话补充要求处理，并在产物明细中保留执行依据和结果。'
        ].join('\n'),
        sourceType: 'standalone'
      });
      this.activeView = 'runs';
      this.pushRoute('/runs');
    },

    createRunFromBug(bug) {
      const workloadLevel = bug.workloadEstimate?.level || inferBugWorkloadLevel(bug, this.projects.find(item => item.id === bug.projectId))?.level || 'S';
      this.openRunCreateDrawer({
        projectId: bug.projectId,
        executionMode: 'bug-fix',
        workflow: 'bug-fix',
        workflowLevel: workloadLevel,
        stage: 'bug-fix',
        title: this.bugDisplayTitle(bug),
        zentaoId: bug.bugNo || '',
        developer: bug.developer || bug.assignedTo || this.defaultRunDeveloperName,
        targetPage: bug.targetPage || '',
        figmaLinks: bug.figmaLinks || '',
        showdocHints: bug.showdocHints || '',
        requirement: [
          `修复 Bug：${this.bugDisplayTitle(bug)}`,
          bug.status ? `当前状态：${this.bugStatusLabel(bug.status)}` : '',
          bug.severity ? `严重级别：S${bug.severity}` : '',
          bug.pri ? `优先级：P${bug.pri}` : '',
          bug.deadline ? `截止时间：${bug.deadline}` : '',
          '请按 Bug 修复流程执行：复现/定位、最小修复、针对性验证、回归说明。'
        ].filter(Boolean).join('\n'),
        sourceType: 'bug'
      });
    },

    resetWorkflowDesigner() {
      this.workflowDesigner = emptyWorkflowDesigner(this.selectedProjectId || '');
    },

    loadCustomWorkflowToDesigner(workflow = {}) {
      this.workflowDesigner = {
        id: workflow.id || '',
        name: workflow.name || '',
        description: workflow.description || '',
        projectId: workflow.projectId || '',
        skillKeyword: '',
        stages: (workflow.stages || []).map(stage => designerStage(stage))
      };
    },

    addBlankWorkflowStage() {
      this.workflowDesigner.stages.push(designerStage({
        name: `自定义阶段 ${this.workflowDesigner.stages.length + 1}`,
        required: true,
        skippable: false
      }));
    },

    addSkillAsWorkflowStage(skill) {
      this.workflowDesigner.stages.push(designerStage({
        name: skill.title || skill.value,
        skillId: skill.value,
        artifactDir: skill.value,
        required: true,
        skippable: false,
        doneCriteria: '输出阶段报告和必要证据'
      }));
    },

    removeWorkflowStage(index) {
      this.workflowDesigner.stages.splice(index, 1);
    },

    moveWorkflowStage(index, offset) {
      const target = index + offset;
      if (target < 0 || target >= this.workflowDesigner.stages.length) return;
      const [stage] = this.workflowDesigner.stages.splice(index, 1);
      this.workflowDesigner.stages.splice(target, 0, stage);
    },

    copyWorkflowStage(index) {
      const stage = this.workflowDesigner.stages[index];
      if (!stage) return;
      this.workflowDesigner.stages.splice(index + 1, 0, designerStage({
        ...stage,
        id: '',
        name: `${stage.name || '自定义阶段'} 副本`
      }));
    },

    applyWorkflowLevelTemplate(level) {
      this.workflowDesigner = {
        ...this.workflowDesigner,
        id: '',
        name: `${level.level} ${level.name}自定义模板`,
        description: level.summary || '',
        stages: (level.stages || []).map(name => designerStage({
          name,
          skillId: skillIdForStageName(name),
          artifactDir: skillIdForStageName(name),
          required: true,
          skippable: false,
          doneCriteria: '输出阶段报告和必要证据'
        }))
      };
    },

    applyWorkflowPreset(preset) {
      this.workflowDesigner = {
        ...emptyWorkflowDesigner(this.selectedProjectId || ''),
        name: preset.name,
        description: preset.description,
        stages: (preset.stages || []).map(stage => designerStage({
          ...stage,
          required: true,
          skippable: false,
          artifactDir: stage.skillId
        }))
      };
    },

    copyCustomWorkflow(workflow) {
      this.workflowDesigner = {
        id: '',
        name: `${workflow.name} 副本`,
        description: workflow.description || '',
        projectId: workflow.projectId || '',
        skillKeyword: '',
        stages: (workflow.stages || []).map(stage => designerStage(stage))
      };
      ElMessage.success('已复制为新模板，保存后生效');
    },

    customWorkflowSummary(workflow) {
      const scope = workflow.projectId ? this.projectName(workflow.projectId) : '通用模板';
      const stageNames = (workflow.stages || []).slice(0, 3).map(stage => stage.name).join(' / ');
      const more = (workflow.stages || []).length > 3 ? '...' : '';
      return `${scope} · ${workflow.stages?.length || 0} 阶段${stageNames ? ` · ${stageNames}${more}` : ''}`;
    },

    workflowStageMode(stage = {}) {
      return normalizedWorkflowStageFlags(stage).skippable ? 'skippable' : 'required';
    },

    setWorkflowStageMode(stage, mode) {
      if (!stage) return;
      const isSkippable = mode === 'skippable';
      stage.required = !isSkippable;
      stage.skippable = isSkippable;
    },

    startWorkflowStageDrag(index) {
      this.workflowStageDragIndex = index;
    },

    dropWorkflowStage(index) {
      const from = this.workflowStageDragIndex;
      this.workflowStageDragIndex = null;
      if (from === null || from === index || from < 0) return;
      const [stage] = this.workflowDesigner.stages.splice(from, 1);
      this.workflowDesigner.stages.splice(index, 0, stage);
    },

    async saveCustomWorkflow() {
      if (!this.workflowDesigner.name.trim()) {
        ElMessage.warning('请填写模板名称');
        return;
      }
      if (!this.workflowDesigner.stages.length) {
        ElMessage.warning('请至少添加一个阶段');
        return;
      }
      const payload = {
        id: this.workflowDesigner.id,
        name: this.workflowDesigner.name,
        description: this.workflowDesigner.description,
        projectId: this.workflowDesigner.projectId,
        stages: this.workflowDesigner.stages.map((stage, index) => {
          const flags = normalizedWorkflowStageFlags(stage);
          return {
            id: stage.id || stage.skillId || `custom-stage-${index + 1}`,
            name: stage.name,
            skillId: stage.skillId,
            artifactDir: stage.artifactDir || stage.skillId || stage.id,
            required: flags.required,
            skippable: flags.skippable,
            doneCriteria: stage.doneCriteria,
            description: stage.description
          };
        })
      };
      const workflow = await this.api('/api/custom-workflows', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await this.refreshCustomWorkflows();
      this.loadCustomWorkflowToDesigner(workflow);
      ElMessage.success('自定义工作流已保存');
    },

    createRunFromCustomWorkflow(workflow) {
      if (!workflow?.id && !this.workflowDesigner.name) {
        ElMessage.warning('请先保存模板');
        return;
      }
      const saved = workflow.id ? workflow : this.customWorkflows.find(item => item.name === workflow.name);
      if (!saved?.id) {
        ElMessage.warning('请先保存模板后再发起执行');
        return;
      }
      this.openRunCreateDrawer({
        projectId: saved.projectId || this.selectedProjectId || '',
        sourceMode: 'standalone',
        executionMode: 'custom-workflow',
        workflow: 'custom-workflow',
        workflowLevel: 'CUSTOM',
        customWorkflowId: saved.id,
        title: saved.name,
        requirement: saved.description || '请按自定义工作流模板执行，并在每个阶段记录产物与结论。',
        sourceType: 'standalone'
      });
    },

    async openDirectoryPicker() {
      this.directoryPicker.visible = true;
      await this.loadDirectories(this.projectForm.rootPath || undefined);
    },

    async openProjectPath() {
      const targetPath = String(this.projectForm.rootPath || '').trim();
      if (!targetPath) {
        this.openDirectoryPicker();
        return;
      }
      try {
        await this.api('/api/fs/open-directory', {
          method: 'POST',
          body: JSON.stringify({ path: targetPath })
        });
      } catch (error) {
        ElMessage.error(error.message || '打开目录失败');
      }
    },

    async pickProjectDirectory() {
      const picker = globalThis.showDirectoryPicker;
      if (typeof picker === 'function') {
        try {
          const handle = await picker({ mode: 'read' });
          const pickedPath = await this.resolveNativeDirectoryPath(handle);
          if (pickedPath) {
            this.projectForm.rootPath = pickedPath;
            if (!this.projectForm.name) {
              this.projectForm.name = pickedPath.split('/').filter(Boolean).pop() || '';
            }
            return;
          }
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }
      await this.openDirectoryPicker();
    },

    async resolveNativeDirectoryPath(handle) {
      if (!handle) return '';
      try {
        if (typeof handle.resolve === 'function') {
          const segments = await handle.resolve(handle);
          if (Array.isArray(segments) && segments.length) return `/${segments.join('/')}`;
        }
      } catch (error) {
        // Ignore and try the adapter-specific path fields below.
      }

      const candidatePath = [
        handle.path,
        handle?.nativePath,
        handle?._path
      ].find(value => typeof value === 'string' && value.trim());

      if (candidatePath) return candidatePath;

      ElMessage.warning('当前环境未暴露所选目录的本地路径，已切换到内置目录选择器。');
      return '';
    },

    async loadDirectories(targetPath) {
      this.directoryPicker.loading = true;
      try {
        const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
        const result = await this.api(`/api/fs/directories${query}`);
        this.directoryPicker.currentPath = result.path;
        this.directoryPicker.parentPath = result.parent;
        this.directoryPicker.directories = result.directories || [];
      } catch (error) {
        ElMessage.error('目录读取失败');
      } finally {
        this.directoryPicker.loading = false;
      }
    },

    useCurrentDirectory() {
      this.projectForm.rootPath = this.directoryPicker.currentPath;
      if (!this.projectForm.name) {
        this.projectForm.name = this.directoryPicker.currentPath.split('/').filter(Boolean).pop() || '';
      }
      this.directoryPicker.visible = false;
    },

    async createRun() {
      if (!this.runForm.projectId || !this.runForm.title) {
        ElMessage.warning('请选择项目并填写任务标题');
        return;
      }
      if (this.runForm.sourceMode === 'figma-link' && !String(this.runForm.figmaLinks || '').trim()) {
        ElMessage.warning('请填写 Figma 界面链接');
        return;
      }
      if (this.runForm.sourceMode === 'completed-task' && !String(this.runForm.zentaoId || '').trim()) {
        ElMessage.warning('请填写已完成任务 ID 或禅道 ID');
        return;
      }
      if (this.isSingleSkillRun && !this.runForm.stage) {
        ElMessage.warning('请选择规范 / Skill / 执行类型');
        return;
      }
      if (this.isCustomWorkflowRun && !this.runForm.customWorkflowId) {
        ElMessage.warning('请选择自定义工作流模板');
        return;
      }
      const payload = {
        ...this.runForm,
        sourceType: this.runForm.taskId
          ? 'task-center'
          : this.isBugFixRun
            ? 'bug'
            : 'standalone',
        createTaskForRun: Boolean(this.runForm.taskId),
        workflow: this.isBugFixRun
          ? 'bug-fix'
          : this.isSingleSkillRun
            ? 'art-single-skill'
            : this.isCustomWorkflowRun
              ? 'custom-workflow'
              : workflowForLevel(this.runForm.workflowLevel)
      };
      const run = await this.api('/api/runs', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      this.selectedRunId = run.id;
      this.runDrawer = false;
      this.activeView = 'runs';
      this.pushRoute('/runs');
      const linkedTaskRun = Boolean(payload.taskId);
      this.runForm = this.newRunForm({ projectId: this.selectedProjectId || '' });
      await this.refreshRuns();
      ElMessage.success(linkedTaskRun ? '任务执行已创建' : '独立执行已创建');
    },

    async submitRunChatInstruction() {
      const sourceRun = this.selectedRun;
      const instruction = String(this.runChatInput || '').trim();
      if (!sourceRun || !instruction) return;
      if (this.isRunInProgress(sourceRun)) {
        ElMessage.warning('当前执行仍在运行中，完成或中断后再继续沟通。');
        return;
      }
      this.runChatSubmitting = true;
      try {
        const model = String(this.runChatForm.model || this.codexConfigForm.model || '').trim();
        const reasoningEffort = String(this.runChatForm.reasoningEffort || '').trim();
        const requestStandard = String(this.runChatForm.requestStandard || '').trim();
        const run = await this.api(`/api/runs/${encodeURIComponent(sourceRun.id)}/retry`, {
          method: 'POST',
          body: JSON.stringify({
            title: `${sourceRun.title || '美术执行'} · 追加沟通`,
            requirement: [
              sourceRun.requirement || '',
              '',
              '## 工作台追加沟通',
              instruction,
              requestStandard ? `\n## 请求标准\n${requestStandard}` : '',
              '',
              '请基于上一轮执行的产物、资料.md、Figma 线索、规范 md / Skill 线索继续处理；不要重复无关步骤，结果继续写入本次新的 artifactRoot。'
            ].filter(Boolean).join('\n'),
            figmaLinks: sourceRun.figmaLinks || '',
            showdocHints: sourceRun.showdocHints || '',
            targetPage: sourceRun.targetPage || '',
            stage: sourceRun.stage || '',
            codexRequest: {
              model,
              reasoningEffort,
              requestStandard,
              source: 'web-chat'
            }
          })
        });
        this.runs = [run, ...this.runs.filter(item => item.id !== run.id)];
        this.selectedRunId = run.id;
        this.runChatInput = '';
        this.runChatPanelOpen = false;
        await this.startRun(run.id);
        this.runLogCollapse = [];
        this.runLogDrawerVisible = false;
        ElMessage.success('已创建新的 Codex 执行');
      } catch (error) {
        ElMessage.error(this.readApiError(error) || '发送执行要求失败');
      } finally {
        this.runChatSubmitting = false;
      }
    },

    resetRunChatForm() {
      const existing = this.runChatForm || {};
      this.runChatForm = {
        model: existing.model || this.codexConfigForm.model || 'gpt-5.5',
        reasoningEffort: existing.reasoningEffort || 'xhigh',
        requestStandard: existing.requestStandard || '沿用当前任务上下文，只处理本次补充要求；输出交付结论、变更点、验证方式和下一步。'
      };
    },

    openRun(run) {
      this.selectedRunId = run.id;
      this.pushRoute('/runs');
    },

    selectRunFromList(run) {
      const id = typeof run === 'string' ? run : run?.id;
      if (!id) return;
      this.runCodexFloatingRunId = id;
      this.selectedRunId = id;
    },

    isTaskCenterLinkedRun(run = null) {
      if (!run) return false;
      return Boolean(run.taskId)
        || ['task', 'task-center', 'task-linked'].includes(String(run.sourceType || ''));
    },

    runsForTask(task) {
      if (!task?.id) return [];
      return this.runs
        .filter(run => this.isTaskCenterLinkedRun(run))
        .filter(run => run.taskId === task.id || (task.taskNo && run.zentaoId === task.taskNo))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    runAttemptNumber(run = {}) {
      if (Number(run.attemptNo) > 0) return Number(run.attemptNo);
      const related = this.runs
        .filter(item => {
          if (this.isTaskCenterLinkedRun(run)) {
            return item.taskId === run.taskId || (run.zentaoId && item.zentaoId === run.zentaoId);
          }
          return !this.isTaskCenterLinkedRun(item) && item.title === run.title;
        })
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const index = related.findIndex(item => item.id === run.id);
      return index >= 0 ? index + 1 : 1;
    },

    runGroupTitle(run = {}) {
      const task = this.businessTaskForRun(run);
      return task?.displayTitle || task?.title || run.title || '未命名任务';
    },

    runGroupSubtitle(run = {}) {
      const attempt = this.runAttemptNumber(run);
      return `第 ${attempt} 次执行 · ${this.workflowRunLabel(run)} · ${this.formatDateTime(this.runDisplayTime(run))}`;
    },

    runTaskUrl(run) {
      if (!run) return '';
      if (!this.isTaskCenterLinkedRun(run)) return '';
      const task = this.businessTasks.find(item => item.id === run.taskId || (item.taskNo && item.taskNo === run.zentaoId));
      return this.zentaoTaskUrl(task || { zentaoId: run.zentaoId, taskNo: run.zentaoId, title: run.title });
    },

    hasTaskRunRecords(task) {
      return (task?.runCount || this.runsForTask(task || {}).length) > 0;
    },

    taskRunButtonLabel(task) {
      return this.hasTaskRunRecords(task) ? '再次执行' : '发起执行';
    },

    hasRunExecuted(run = null) {
      if (!run) return false;
      if (run.logPath || run.promptPath || run.pid || run.exitCode !== null && run.exitCode !== undefined) return true;
      if (run.resultSummary || run.changeSummary?.collectedAt) return true;
      return /running|conditional|passed|completed|done|failed|blocked|cancelled|canceled/i.test(String(run.status || ''));
    },

    canResumeRun(run = null) {
      if (!run || this.isDirectSkillRun(run) || this.isRunInProgress(run)) return false;
      return /cancelled|canceled|blocked|failed/i.test(String(run.status || ''));
    },

    isRunInProgress(run = null) {
      return /running|in_progress/i.test(String(run?.status || ''));
    },

    isDirectSkillRun(run = null) {
      return run?.sourceType === 'direct-skill' || run?.executionMode === 'direct-skill';
    },

    isSingleSkillWorkflowRun(run = null) {
      if (!run || this.isDirectSkillRun(run)) return false;
      const workflow = normalizeWorkflowId(run.workflow || '');
      return workflow === 'art-single-skill';
    },

    hasRunSelectedSkillOrMdMaterial(run = null) {
      if (!run) return false;
      if (this.isDirectSkillRun(run) || this.isSingleSkillWorkflowRun(run)) return true;
      if (String(run.executionMode || '').trim() === 'single-skill') return true;
      const selectedMaterials = Array.isArray(run.selectedMaterialHints)
        ? run.selectedMaterialHints.filter(value => String(value || '').trim())
        : [];
      if (selectedMaterials.length) return true;
      if (this.runReferenceCount(run) > 0) return true;
      return [
        run.primarySkillPath,
        run.skillPath,
        run.showdocHints,
        run.stage
      ].some(value => this.looksLikeRunSkillOrMdMaterial(value));
    },

    looksLikeRunSkillOrMdMaterial(value = '') {
      const text = String(value || '').trim();
      if (!text) return false;
      if (/(^|[\\/])SKILL\.md(?:$|[?#])/i.test(text)) return true;
      if (/\.(md|markdown)(?:$|[?#])/i.test(text)) return true;
      if (/[\\/](skills?|\.codex|\.claude|规范|资料库|references)[\\/]/i.test(text)) return true;
      if (this.isGenericUsageFileTarget(text)) return false;
      if (/(same-ip-image|ui-finalize|gpt-image|imagegen|figma-use|界面收尾|同\s*IP|固定人设|规范|Skill)/i.test(text)) return true;
      return false;
    },

    isSkillOrMdFocusedRun(run = null) {
      return Boolean(this.isDirectSkillRun(run) || this.isSingleSkillWorkflowRun(run));
    },

    shouldShowRunWorkflowPanels(run = null) {
      return Boolean(run && !this.hasRunSelectedSkillOrMdMaterial(run));
    },

    shouldShowRunSkillActionsPanel(run = null) {
      return Boolean(run && !this.hasRunSelectedSkillOrMdMaterial(run));
    },

    shouldShowRunTopChainPanel(run = null) {
      return false;
    },

    shouldShowRunChainPanel(run = null) {
      return Boolean(run && !this.hasRunSelectedSkillOrMdMaterial(run));
    },

    shouldShowRunCodexChatPanel(run = null) {
      return Boolean(
        run
        && this.activeView === 'runs'
        && run.id
        && this.selectedRunId === run.id
        && !this.isRunInProgress(run)
        && !this.isDirectSkillRun(run)
        && this.can('run.codex.execute')
      );
    },

    runFlowHelperTitle(run = null) {
      if (!run) return '选择执行记录 → 查看右侧进度和结果';
      if (this.isDirectSkillRun(run)) return '选择直接执行记录 → 看 Worker 状态 → 看执行结果 → 进入 AI档案';
      if (this.isSingleSkillWorkflowRun(run)) return '选择单技能记录 → 看执行步骤 → 看结果明细';
      return '选择执行记录 → 启动 / 查看进度 → 看任务链路 → 到产物列表看明细';
    },

    runFlowHelperDescription(run = null) {
      if (!run) return '左侧选择一条执行记录后，右侧会按执行类型展示对应内容。';
      if (this.isDirectSkillRun(run)) {
        return '引用 Skill/md 的直接执行只展示执行对象、执行人本机状态、阶段进度和档案入口，不展示普通任务的关键动作、任务链路和继续对话。';
      }
      if (this.isSingleSkillWorkflowRun(run)) {
        return '单 md/Skill 执行默认展示当前任务的执行步骤明细、交付判定和轻量结果，不直接展开 Codex 对话。';
      }
      return '右侧统一展示执行步骤、结果明细、执行对象和环境；关键动作、任务链路作为补充模块继续保留。';
    },

    runDetailTitle(run = null) {
      if (!run) return 'AI 执行过程';
      if (this.isSingleSkillWorkflowRun(run)) return '单技能执行过程';
      return this.isDirectSkillRun(run) ? '直接执行结果' : 'AI 执行过程';
    },

    runDetailDescription(run = null) {
      if (!run) return '请先从左侧选择一条执行记录。';
      if (this.isDirectSkillRun(run)) {
        return '这是引用 Skill/md 的本机直接执行，只展示 Worker 状态、执行进度、结果和 AI档案入口。';
      }
      if (this.isSingleSkillWorkflowRun(run)) {
        return '查看当前任务的执行步骤明细。';
      }
      return '查看当前任务的执行步骤明细、结果明细和补充链路。产物明细请到产物列表查看。';
    },

    directSkillWorkerForRun(run = null) {
      if (!run) return null;
      const claimedDevice = String(run.claimedByDeviceId || '').trim();
      const assignee = String(run.assignedToUserId || run.ownerUserId || '').trim();
      return this.agentWorkers.find(worker => claimedDevice && worker.deviceId === claimedDevice)
        || this.agentWorkers.find(worker => assignee && worker.userId === assignee)
        || null;
    },

    directSkillWorkerForUser(user = null) {
      const userId = String(user?.id || '').trim();
      if (!userId) return null;
      return this.agentWorkerDisplayRows.find(worker => worker.userId === userId) || null;
    },

    directSkillWorkerDisplayName(worker = null) {
      if (!worker) return '未启动 Worker';
      return worker.deviceAlias || worker.deviceName || worker.deviceId || '未命名设备';
    },

    directSkillRunDeviceDisplayName(run = null) {
      const worker = this.directSkillWorkerForRun(run);
      if (worker) return this.directSkillWorkerDisplayName(worker);
      return run?.claimedByDeviceId || '未领取';
    },

    canEditDirectSkillWorkerAlias(worker = null) {
      const workerUserId = String(worker?.userId || '').trim();
      const currentUserId = String(this.currentUser?.id || '').trim();
      return Boolean(worker?.id && workerUserId && currentUserId && workerUserId === currentUserId && this.can('api.agentWorkers.alias'));
    },

    async renameDirectSkillWorker(worker = null) {
      if (!this.canEditDirectSkillWorkerAlias(worker)) {
        ElMessage.warning('只能修改自己已绑定设备的花名');
        return;
      }
      const { value } = await ElMessageBox.prompt('请输入这台设备在工作台里展示的花名。留空会恢复为真实设备名。', '修改设备花名', {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputValue: worker.deviceAlias || '',
        inputPlaceholder: worker.deviceName || worker.deviceId || '设备花名',
        inputPattern: /^.{0,24}$/,
        inputErrorMessage: '花名最多 24 个字符'
      }).catch(() => ({ value: null }));
      if (value === null) return;
      const alias = String(value || '').trim();
      this.loading.agentWorkers = true;
      try {
        this.agentWorkers = this.agentWorkers.map(item => item.id === worker.id ? { ...item, deviceAlias: alias } : item);
        const updated = await this.api(`/api/agent-workers/${encodeURIComponent(worker.id)}/alias`, {
          method: 'PATCH',
          body: JSON.stringify({ alias })
        });
        this.agentWorkers = this.agentWorkers.map(item => item.id === updated.id ? updated : item);
        await this.refreshAgentWorkers();
        ElMessage.success('设备花名已保存');
      } finally {
        this.loading.agentWorkers = false;
      }
    },

    directSkillUserCanExecute(user = null) {
      if (!user || user.disabled === true) return false;
      if (user.role === 'admin') return true;
      const permissions = new Set(user.permissions || []);
      return [
        'api.agentWorkers.heartbeat',
        'api.agentRuns.claim',
        'api.agentRuns.log',
        'api.agentRuns.status'
      ].every(permission => permissions.has(permission));
    },

    directSkillPendingRunsForUser(user = null) {
      const userId = String(user?.id || '').trim();
      if (!userId) return [];
      return this.directSkillPendingRuns.filter(run => String(run.assignedToUserId || run.ownerUserId || '') === userId);
    },

    directSkillActiveRunsForUser(user = null) {
      const userId = String(user?.id || '').trim();
      if (!userId) return [];
      return this.directSkillActiveRuns.filter(run => String(run.assignedToUserId || run.ownerUserId || '') === userId);
    },

    directSkillCompletedRunsForUser(user = null) {
      const userId = String(user?.id || '').trim();
      if (!userId) return [];
      return this.directSkillCompletedRuns.filter(run => String(run.assignedToUserId || run.ownerUserId || '') === userId);
    },

    directSkillMemberReadyLabel(row = {}) {
      if (row.ready) return '可自动领取';
      if (!row.worker) return '未启动 Worker';
      if (!row.online) return 'Worker 离线';
      if (!row.codexReady) return 'Codex 未就绪';
      if (!row.figmaMcpReady) return 'Figma MCP 未就绪';
      return '待检查';
    },

    directSkillMemberReadyTagType(row = {}) {
      if (row.ready) return 'success';
      if (!row.worker || !row.online) return 'info';
      return 'warning';
    },

    directSkillWorkerOnline(worker = null) {
      if (!worker?.lastHeartbeatAt) return false;
      const last = Date.parse(worker.lastHeartbeatAt);
      return Boolean(last && Date.now() - last < 600000);
    },

    directSkillWorkerStatusText(run = null) {
      const worker = this.directSkillWorkerForRun(run);
      if (!worker) return '未发现执行人本机 Worker';
      const online = this.directSkillWorkerOnline(worker);
      const figma = worker.figmaMcpReady ? 'Figma MCP 已就绪' : 'Figma MCP 未就绪';
      const codex = worker.codexReady ? 'Codex 已就绪' : 'Codex 未就绪';
      return `${this.directSkillWorkerDisplayName(worker)} · ${online ? '在线' : '离线'} · ${codex} · ${figma}`;
    },

    isDirectSkillClaimedRun(run = null) {
      return Boolean(this.isDirectSkillRun(run) && (run?.claimedAt || run?.startedAt || run?.claimedByDeviceId));
    },

    isDirectSkillFailedRun(run = null) {
      return Boolean(this.isDirectSkillRun(run) && /failed|error/i.test(String(run?.status || run?.workerStatus || '')));
    },

    directSkillRunOperatorName(run = null) {
      const userId = String(run?.createdBy || '').trim();
      const user = this.users.find(item => String(item.id || '') === userId);
      return user?.displayName || user?.username || run?.createdByName || userId || '-';
    },

    directSkillRunContentName(run = null) {
      const explicitCandidates = [
        run?.productName,
        run?.productDisplayName,
        run?.sourceTitle,
        this.cleanDirectSkillRunTitle(run?.title)
      ];
      const explicit = explicitCandidates
        .map(value => this.cleanDirectSkillDisplayText(value))
        .find(value => value && !this.looksLikeFilePath(value));
      if (explicit) return explicit;
      const pathName = [
        run?.primarySkillPath,
        run?.stage,
        run?.targetPage,
        run?.selectedMaterialHints?.[0]
      ]
        .map(value => this.meaningfulNameFromPath(value))
        .find(Boolean);
      return pathName || this.cleanDirectSkillDisplayText(run?.title) || 'AI 产物';
    },

    directSkillRunContentKind(run = null) {
      const candidates = [
        run?.productName,
        run?.sourceTitle,
        run?.primarySkillPath,
        run?.stage,
        run?.targetPage,
        run?.title
      ].map(value => String(value || '').trim()).filter(Boolean);
      if (candidates.some(value => /(^|[\\/])SKILL\.md$/i.test(value) || /SKILL\.md(?:$|[?#])/i.test(value))) return 'Skill';
      if (candidates.some(value => /\.md(?:$|[?#])/i.test(value))) return 'md';
      if (this.isDirectSkillRun(run)) return '直接执行';
      if (run?.sourceType === 'bug') return 'Bug 执行';
      if (run?.taskId || run?.sourceType === 'task' || run?.sourceType === 'task-center' || run?.sourceType === 'task-linked') return '任务执行';
      if (run?.sourceType === 'standalone' || run?.sourceType === 'skill-inventory') return '独立执行';
      return this.workflowRunLabel(run) || '执行';
    },

    focusedRunContentName(run = null) {
      const source = [
        run?.primarySkillPath,
        run?.stage,
        run?.targetPage,
        run?.selectedMaterialHints?.[0],
        String(run?.showdocHints || '').split(/\r?\n/).find(Boolean),
        run?.productName,
        run?.productDisplayName,
        run?.sourceTitle,
        this.directSkillRunContentName(run)
      ]
        .map(value => this.focusedRunReadableContentName(value))
        .find(value => value && !this.looksLikeNonContentTitle(value));
      return source || this.directSkillRunContentName(run);
    },

    focusedRunReadableContentName(value = '') {
      const text = this.cleanDirectSkillDisplayText(value);
      if (!text) return '';
      if (this.looksLikeFilePath(text) || /[\\/]/.test(text)) return this.meaningfulNameFromPath(text) || text;
      return text;
    },

    focusedRunExecutionModeText(run = null) {
      const name = this.focusedRunContentName(run);
      const prefix = this.isSkillOrMdFocusedRun(run) ? '单技能' : this.workflowRunLabel(run);
      return `${prefix}-${name || '未命名'}`;
    },

    cleanDirectSkillRunTitle(title = '') {
      return String(title || '')
        .trim()
        .replace(/^(直接执行|执行|单技能执行|单技能)\s*[:：·-]?\s*/i, '')
        .trim();
    },

    cleanDirectSkillDisplayText(value = '') {
      return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^(直接执行|执行|单技能执行|单技能)\s*[:：·-]?\s*/i, '')
        .trim();
    },

    looksLikeFilePath(value = '') {
      return /(^\/|^[A-Za-z]:\\|\\|\/Users\/|\/Volumes\/|\.md$|\.txt$|\.json$)/i.test(String(value || '').trim());
    },

    looksLikeNonContentTitle(value = '') {
      const text = String(value || '').trim();
      if (!text) return true;
      if (this.looksLikeFilePath(text)) return false;
      return /^(pc|web|h5|ios|android|测试|弹窗|执行|直接执行)$/i.test(text);
    },

    meaningfulNameFromPath(pathValue = '') {
      const raw = String(pathValue || '').trim();
      if (!raw) return '';
      const withoutQuery = raw.split(/[?#]/)[0];
      let decoded = withoutQuery;
      try {
        decoded = decodeURIComponent(withoutQuery);
      } catch {
        decoded = withoutQuery;
      }
      const parts = decoded.replace(/\\/g, '/').split('/').filter(Boolean);
      if (!parts.length) return '';
      const fileName = parts[parts.length - 1] || '';
      if (/^(SKILL|README|index)\.md$/i.test(fileName) && parts.length > 1) {
        return parts[parts.length - 2] || '';
      }
      return fileName.replace(/\.(md|txt|json)$/i, '') || fileName;
    },

    directSkillRunUpdatedText(run = null) {
      return this.formatDateTime(run?.updatedAt || run?.finishedAt || run?.startedAt || run?.claimedAt || run?.createdAt) || '-';
    },

    directSkillWorkerLastSeenText(worker = null) {
      if (!worker?.lastHeartbeatAt) return '暂无心跳';
      return this.formatDateTime(worker.lastHeartbeatAt);
    },

    directSkillWorkerApiBase() {
      const origin = window.location.origin || '';
      const hostname = window.location.hostname || '';
      if (/^(localhost|127\.0\.0\.1|::1)$/i.test(hostname)) return 'http://工作台服务器IP:4288';
      return origin || 'http://工作台服务器IP:4288';
    },

    directSkillWorkerStartCommand(user = this.currentUser || {}, os = 'dual') {
      const username = String(user.username || '').trim();
      const password = String(user.passwordDisplay || '').trim();
      const apiBase = this.directSkillWorkerApiBase();
      const safePassword = password || '在这里填写该组员平台密码';
      const windowsRoot = '$env:USERPROFILE\\ArtDirectWorker';
      if (os === 'dual') {
        return [
          '# Windows PowerShell（组员 Windows 电脑使用下面这段）',
          this.directSkillWorkerStartCommand(user, 'windows'),
          '',
          '# macOS 终端（组员 macOS 电脑使用下面这段）',
          this.directSkillWorkerStartCommand(user, 'mac')
        ].join('\n');
      }
      if (os === 'windows') {
        return [
          '# 请在组员本人常用 Windows 账号的 PowerShell 里运行；不要用其他人的 Administrator 账号代跑。',
          '$ErrorActionPreference = "Stop"',
          '$ProgressPreference = "SilentlyContinue"',
          `$root = "${windowsRoot}"`,
          'New-Item -ItemType Directory -Force -Path "$root\\scripts" | Out-Null',
          `Invoke-WebRequest -UseBasicParsing -Uri ${this.powershellQuote(`${apiBase}/worker/art-direct-worker.mjs`)} -OutFile "$root\\scripts\\art-direct-worker.mjs" -ErrorAction Stop`,
          'if (-not (Test-Path "$root\\scripts\\art-direct-worker.mjs")) { throw "Worker 下载失败，请确认工作台地址可访问" }',
          '$node = Get-Command node -ErrorAction SilentlyContinue; if (-not $node) { throw "缺少 Node.js 20 或以上版本" }',
          '$nodeVersion = & $node.Source -p "process.versions.node"; if ([int]($nodeVersion.Split(".")[0]) -lt 20) { throw "Node.js 版本过低：$nodeVersion" }',
          '$codex = Get-Command codex -ErrorAction SilentlyContinue; if (-not $codex) { throw "缺少 Codex CLI，请先确认本机 PowerShell 可运行 codex --help" }; $env:CODEX_CLI_PATH = $codex.Source',
          '$env:ART_PLATFORM_API = ' + this.powershellQuote(apiBase),
          '$env:ART_PLATFORM_USERNAME = ' + this.powershellQuote(username || '组员账号'),
          '$env:ART_PLATFORM_PASSWORD = ' + this.powershellQuote(safePassword),
          '$env:ART_WORKER_HOME = $root',
          '$env:ART_WORKER_POLL_INTERVAL_MS = ' + this.powershellQuote('300000'),
          '$env:ART_WORKER_HEARTBEAT_INTERVAL_MS = ' + this.powershellQuote('300000'),
          '$env:ART_WORKER_LOCAL_CHECK_INTERVAL_MS = ' + this.powershellQuote('300000'),
          '& $node.Source "$root\\scripts\\art-direct-worker.mjs"'
        ].join('\n');
      }
      return [
        'WORKER_HOME="$HOME/ArtDirectWorker"',
        'mkdir -p "$WORKER_HOME/scripts"',
        `curl -fsSL ${this.shellQuote(`${apiBase}/worker/art-direct-worker.mjs`)} -o "$WORKER_HOME/scripts/art-direct-worker.mjs"`,
        `ART_PLATFORM_API=${this.shellQuote(apiBase)} \\`,
        `ART_PLATFORM_USERNAME=${this.shellQuote(username || '组员账号')} \\`,
        `ART_PLATFORM_PASSWORD=${this.shellQuote(safePassword)} \\`,
        'ART_WORKER_HOME="$WORKER_HOME" \\',
        'ART_WORKER_POLL_INTERVAL_MS=300000 \\',
        'ART_WORKER_HEARTBEAT_INTERVAL_MS=300000 \\',
        'node "$WORKER_HOME/scripts/art-direct-worker.mjs"'
      ].join('\n');
    },

    directSkillWorkerInstallCommand(user = this.currentUser || {}, os = 'dual') {
      const username = String(user.username || '').trim();
      const password = String(user.passwordDisplay || '').trim();
      const apiBase = this.directSkillWorkerApiBase();
      const safePassword = password || '在这里填写该组员平台密码';
      const windowsRoot = '$env:USERPROFILE\\ArtDirectWorker';
      if (os === 'dual') {
        return [
          '# Windows PowerShell（组员 Windows 电脑使用下面这段）',
          this.directSkillWorkerInstallCommand(user, 'windows'),
          '',
          '# macOS 终端（组员 macOS 电脑使用下面这段）',
          this.directSkillWorkerInstallCommand(user, 'mac')
        ].join('\n');
      }
      if (os === 'windows') {
        return [
          '# 请在组员本人常用 Windows 账号的 PowerShell 里运行；不要用其他人的 Administrator 账号代跑。',
          '$ErrorActionPreference = "Stop"',
          '$ProgressPreference = "SilentlyContinue"',
          `$root = "${windowsRoot}"`,
          'New-Item -ItemType Directory -Force -Path "$root\\scripts" | Out-Null',
          `Invoke-WebRequest -UseBasicParsing -Uri ${this.powershellQuote(`${apiBase}/worker/art-direct-worker.mjs`)} -OutFile "$root\\scripts\\art-direct-worker.mjs" -ErrorAction Stop`,
          `Invoke-WebRequest -UseBasicParsing -Uri ${this.powershellQuote(`${apiBase}/worker/install_art_direct_worker_windows.ps1`)} -OutFile "$root\\scripts\\install_art_direct_worker_windows.ps1" -ErrorAction Stop`,
          'if (-not (Test-Path "$root\\scripts\\art-direct-worker.mjs")) { throw "Worker 下载失败，请确认工作台地址可访问" }',
          'if (-not (Test-Path "$root\\scripts\\install_art_direct_worker_windows.ps1")) { throw "开机自启安装脚本下载失败，请确认工作台地址可访问" }',
          '$installScript = Get-Content -Raw -Path "$root\\scripts\\install_art_direct_worker_windows.ps1"; Set-Content -Path "$root\\scripts\\install_art_direct_worker_windows.ps1" -Value $installScript -Encoding UTF8',
          '$env:ART_PLATFORM_API = ' + this.powershellQuote(apiBase),
          '$env:ART_PLATFORM_USERNAME = ' + this.powershellQuote(username || '组员账号'),
          '$env:ART_PLATFORM_PASSWORD = ' + this.powershellQuote(safePassword),
          '$env:ART_WORKER_HOME = $root',
          '$env:ART_WORKER_POLL_INTERVAL_MS = ' + this.powershellQuote('300000'),
          '$env:ART_WORKER_HEARTBEAT_INTERVAL_MS = ' + this.powershellQuote('300000'),
          '$env:ART_WORKER_LOCAL_CHECK_INTERVAL_MS = ' + this.powershellQuote('300000'),
          'powershell -NoProfile -ExecutionPolicy Bypass -File "$root\\scripts\\install_art_direct_worker_windows.ps1"'
        ].join('\n');
      }
      return [
        'WORKER_HOME="$HOME/ArtDirectWorker"',
        'mkdir -p "$WORKER_HOME/scripts"',
        `curl -fsSL ${this.shellQuote(`${apiBase}/worker/art-direct-worker.mjs`)} -o "$WORKER_HOME/scripts/art-direct-worker.mjs"`,
        `curl -fsSL ${this.shellQuote(`${apiBase}/worker/install_art_direct_worker_launch_agent.sh`)} -o "$WORKER_HOME/scripts/install_art_direct_worker_launch_agent.sh"`,
        `ART_PLATFORM_API=${this.shellQuote(apiBase)} \\`,
        `ART_PLATFORM_USERNAME=${this.shellQuote(username || '组员账号')} \\`,
        `ART_PLATFORM_PASSWORD=${this.shellQuote(safePassword)} \\`,
        'ART_WORKER_HOME="$WORKER_HOME" \\',
        'ART_WORKER_POLL_INTERVAL_MS=300000 \\',
        'ART_WORKER_HEARTBEAT_INTERVAL_MS=300000 \\',
        'bash "$WORKER_HOME/scripts/install_art_direct_worker_launch_agent.sh"'
      ].join('\n');
    },

    canCopyDirectSkillWorkerCommand(user = this.currentUser || {}) {
      if (this.can('run.directSkill.workerCommand')) return true;
      const targetId = String(user?.id || '').trim();
      const currentId = String(this.currentUser?.id || '').trim();
      return Boolean(targetId && currentId && targetId === currentId && this.can('api.agentWorkers.heartbeat'));
    },

    copyDirectSkillWorkerCommand(user, install = false, os = 'dual') {
      if (!this.canCopyDirectSkillWorkerCommand(user)) {
        ElMessage.warning('当前账号没有复制 Worker 启动命令的权限');
        return Promise.resolve(false);
      }
      const platform = os === 'windows' ? 'Windows' : os === 'mac' ? 'macOS' : '双平台';
      const command = install ? this.directSkillWorkerInstallCommand(user, os) : this.directSkillWorkerStartCommand(user, os);
      return this.copyText(command, `${platform} Worker ${install ? '开机自启安装命令' : '手动启动命令'}`);
    },

    shellQuote(value = '') {
      return `'${String(value).replace(/'/g, `'\\''`)}'`;
    },

    powershellQuote(value = '') {
      return `'${String(value).replace(/'/g, "''")}'`;
    },

    businessTasksForProject(projectId) {
      return this.businessTasks.filter(task => !projectId || task.projectId === projectId);
    },

    taskDisplayTitle(task) {
      return [task.taskNo, this.cleanTaskCenterDisplayTitle(task.title)].filter(Boolean).join(' ');
    },

    cleanTaskCenterDisplayTitle(title = '') {
      return String(title || '')
        .replace(/【\s*制作单\s*】/g, '')
        .replace(/\[\s*制作单\s*\]/gi, '')
        .replace(/制作单/g, '')
        .replace(/跨弧/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s·:：\-—_]+|[\s·:：\-—_]+$/g, '')
        .trim();
    },

    taskRequirementPreviewHtml(task = {}) {
      const raw = this.taskRequirementPreviewSource(task);
      if (!raw) return '';
      return sanitizeTaskRequirementHtml(raw, this.zentaoTaskUrl(task) || this.appConfig.zentaoBaseUrl || '');
    },

    taskRequirementPreviewSource(task = {}) {
      const candidates = [
        task.requirement,
        task.description,
        task.zentao?.desc,
        task.zentao?.description,
        task.zentao?.requirement,
        task.summary
      ];
      return String(candidates.find(value => {
        const text = String(value || '').replace(/<br\s*\/?>/gi, '').trim();
        return text && text !== '-';
      }) || '').trim();
    },

    isUrgentTask(task = {}) {
      if (this.isLowEffortArtAcceptanceTask(task)) return false;
      const haystack = `${task.title || ''}\n${task.displayTitle || ''}\n${task.requirement || ''}`;
      return /急单|紧急|高优|加急/.test(haystack);
    },

    isInsertTask(task = {}) {
      if (this.isLowEffortArtAcceptanceTask(task)) return false;
      const priority = Number(task.pri || task.priority || task.zentao?.pri || 0);
      const haystack = `${task.title || ''}\n${task.displayTitle || ''}\n${task.requirement || ''}\n${task.description || ''}`;
      return priority === 1 || /插单|临时需求|临时任务|临时加单/.test(haystack);
    },

    taskPriorityFlags(task = {}) {
      if (this.isLowEffortArtAcceptanceTask(task)) return [];
      const flags = [];
      if (this.isInsertTask(task)) flags.push({ type: 'insert', label: '插单' });
      if (this.isUrgentTask(task)) flags.push({ type: 'urgent', label: '急单' });
      const risks = Array.isArray(task.zentao?.risks) ? task.zentao.risks : [];
      risks.slice(0, 3).forEach((risk, index) => {
        const label = String(risk || '').trim();
        if (/未开始|暂停/.test(label)) return;
        if (label && !flags.some(flag => flag.label === label)) {
          const type = /临期|逾期/.test(label)
            ? `deadline-risk-${index}`
            : `risk-${index}`;
          flags.push({ type, label });
        }
      });
      return flags;
    },

    isArtTaskRisk(task = {}) {
      if (this.isLowEffortArtAcceptanceTask(task)) return false;
      const risks = Array.isArray(task.zentao?.risks) ? task.zentao.risks : [];
      if (risks.length) return true;
      if (/pause|wait/i.test(task.zentaoStatus || task.zentao?.originalStatus || '')) return true;
      if (this.deadlineState(task.deadline || task.zentao?.deadline) === 'overdue') return true;
      return ['blocked', 'failed', 'rework'].includes(statusBucket(task.platformStatus));
    },

    isPressureExcludedArtTask(task = {}) {
      return this.isLowEffortArtAcceptanceTask(task);
    },

    isLowEffortArtAcceptanceTask(task = {}) {
      return isLowEffortArtAcceptanceTask(task);
    },

    taskAcceptanceAssessmentForPerson(_name, tasks = [], bugCount = 0) {
      const today = localDateKey(new Date());
      const pressureTasks = tasks.filter(task => !this.isPressureExcludedArtTask(task));
      const excludedPressureTaskCount = tasks.length - pressureTasks.length;
      const dueTodayCount = pressureTasks.filter(task => task.deadline === today).length;
      const riskCount = pressureTasks.filter(task => this.isArtTaskRisk(task)).length;
      const workloadScore = Math.round(pressureTasks.reduce((sum, task) => sum + workloadEstimateWeight(task.workloadEstimate?.level), 0) * 10) / 10;
      const pressureScore = Math.round((workloadScore + dueTodayCount * 1.6 + riskCount * 1.8 + bugCount * 1.2) * 10) / 10;
      const status = pressureScore >= 7 || riskCount >= 3 || dueTodayCount >= 3
        ? '已饱和'
        : pressureScore >= 4 || riskCount >= 1 || dueTodayCount >= 1
          ? '谨慎承接'
          : '可承接';
      const ownerPendingSplitCount = tasks.filter(task => !this.hasTaskRunRecords(task)).length;
      const acceptanceAction = status === '可承接'
        ? '推荐承接'
        : status === '谨慎承接'
          ? '确认卡点后承接'
          : '暂不加单';
      return {
        workloadScore,
        pressureScore,
        ownerPendingSplitCount,
        isOwnerPerson: this.isArtOwnerPerson(_name),
        acceptanceStatus: status,
        acceptanceStatusType: status === '可承接' ? 'success' : status === '谨慎承接' ? 'warning' : 'danger',
        acceptanceSuggestion: `${acceptanceAction} / ${status}`,
        ownerTaskSuggestion: status === '可承接'
          ? '可分配或拆单'
          : status === '谨慎承接'
            ? '先拆单再分配'
            : '暂缓分配',
        ownerReminder: ownerPendingSplitCount
          ? `未拆单提醒：${ownerPendingSplitCount} 个任务还没有执行记录`
          : '未拆单提醒：暂无待拆单任务',
        acceptanceBasis: [
          `任务负载 ${workloadScore} + 今日截止 ${dueTodayCount}×1.6 + 卡点 ${riskCount}×1.8 + Bug ${bugCount}×1.2 = 压力 ${pressureScore}`,
          excludedPressureTaskCount ? `已排除验收/走查/设计同步 ${excludedPressureTaskCount} 单` : ''
        ].filter(Boolean).join('；'),
        acceptanceRule: this.isPlatformAdmin
          ? '压力≥7、卡点≥3或今日截止≥3为已饱和；压力≥4或存在卡点/今日截止为谨慎承接；其余为可承接。'
          : '用于查看当前任务负载、卡点和承接状态。'
      };
    },

    isArtOwnerPerson(name = '') {
      return samePerson(name, '张倩文') || samePerson(name, 'zhangqw') || samePerson(name, 'zhangqianwen');
    },

    workloadLevelTagType(level = '') {
      if (level === 'XS') return 'info';
      if (level === 'L') return 'danger';
      if (level === 'M') return 'warning';
      if (level === 'S') return 'success';
      return 'info';
    },

    workloadEstimateText(estimate = {}) {
      if (!estimate?.level) return '暂无估级依据';
      const reasons = estimate.reasons?.length ? estimate.reasons.join('；') : '依据任务标题和当前平台资料初步估算';
      const risks = estimate.risks?.length ? estimate.risks.join('、') : '暂无明显风险标签';
      return `AI 估级：${estimate.level} · 置信度 ${estimate.confidence}%\n判断依据：${reasons}\n风险标签：${risks}\n人工工期：${estimate.humanDuration || '-'}\nAI 执行时长：${estimate.aiDuration || '-'}（不包含人工审核）\n建议流程：${estimate.workflowName || '-'}`;
    },

    workloadEstimateHtml(estimate = {}) {
      if (!estimate?.level) return '<div class="workload-tooltip">暂无估级依据</div>';
      return `<div class="workload-tooltip">
        <strong>AI 估级：${escapeHtml(estimate.level)} · 置信度 ${escapeHtml(estimate.confidence)}%</strong>
        <span>判断依据：${escapeHtml(estimate.reasons?.length ? estimate.reasons.join('；') : '依据任务标题和当前平台资料初步估算')}</span>
        <span>风险标签：${escapeHtml(estimate.risks?.length ? estimate.risks.join('、') : '暂无明显风险标签')}</span>
        <span>人工工期：${escapeHtml(estimate.humanDuration || '-')}</span>
        <span>AI 执行时长：${escapeHtml(estimate.aiDuration || '-')}（不包含人工审核）</span>
        <span>建议流程：${escapeHtml(estimate.workflowName || '-')}</span>
      </div>`;
    },

    workflowRunLabel(run) {
      if (this.isDirectSkillRun(run)) {
        return `${this.directSkillRunContentKind(run)} · ${this.directSkillRunContentName(run)}`;
      }
      const workflow = normalizeWorkflowId(run.workflow);
      if (workflow === 'bug-fix') return 'Bug 修复';
      if (workflow === 'art-single-skill') return `单技能 · ${run.stage || '指定阶段'}`;
      if (workflow === 'custom-workflow') return `自定义 · ${run.customWorkflowName || this.customWorkflows.find(item => item.id === run.customWorkflowId)?.name || '工作流'}`;
      const level = run.workflowLevel || levelForWorkflow(workflow);
      const plan = (this.appConfig.workflowLevels || DEFAULT_WORKFLOW_LEVELS).find(item => item.level === level);
      return plan ? `${level} · ${plan.name}` : run.workflow;
    },

    projectName(projectId) {
      return this.projects.find(project => project.id === projectId)?.name || projectId || '通用';
    },

    customWorkflowOptionLabel(workflow) {
      return `${workflow.name} · ${workflow.projectId ? this.projectName(workflow.projectId) : '通用模板，执行时校验目标项目技能'} · ${workflow.stages?.length || 0} 阶段`;
    },

    resultStatusLabel(status) {
      return {
        passed: '通过',
        completed: '已完成',
        success: '成功',
        done: '已完成',
        conditional_pass: '有条件通过',
        failed: '失败',
        blocked: '阻塞',
        skipped: '跳过',
        unknown: '待判定'
      }[status] || status || '待判定';
    },

    effectiveResultStatus(run = {}) {
      const summaryStatus = run.resultSummary?.status;
      const normalizedSummaryStatus = String(summaryStatus || '').toLowerCase();
      if (summaryStatus === 'blocked' && /conditional/i.test(run.status || '') && /无硬阻塞|无阻塞|无$/.test(run.resultSummary?.blockerReason || '')) {
        return 'conditional_pass';
      }
      if (/completed|done|success|passed/.test(normalizedSummaryStatus)) return 'passed';
      if (/failed|error/.test(normalizedSummaryStatus)) return 'failed';
      if (/blocked/.test(normalizedSummaryStatus)) return 'blocked';
      if (/conditional/.test(normalizedSummaryStatus)) return 'conditional_pass';
      if (summaryStatus && !/unknown/.test(summaryStatus)) return summaryStatus;
      if (/conditional/i.test(run.status || '')) return 'conditional_pass';
      if (/done|success|passed|completed/i.test(run.status || '')) return 'passed';
      if (/failed|error/i.test(run.status || '')) return 'failed';
      if (/blocked/i.test(run.status || '')) return 'blocked';
      return summaryStatus || 'unknown';
    },

    resultStatusTitle(summary = {}, run = {}) {
      const status = this.effectiveResultStatus({ ...run, resultSummary: summary });
      const label = this.resultStatusLabel(status);
      if (status === 'passed') return '可进入验收';
      if (status === 'conditional_pass') return '已完成，需人工确认';
      if (status === 'blocked') return '不可交付，先处理阻塞';
      if (status === 'failed') return '执行失败，需重新处理';
      if (status === 'skipped') return '有阶段跳过，确认范围';
      return `当前结论：${label}`;
    },

    resultStatusDescription(summary = {}, run = {}) {
      const status = this.effectiveResultStatus({ ...run, resultSummary: summary });
      if (status === 'passed') return '未识别到阻塞项，当前执行结果可以继续进入验收。';
      if (status === 'conditional_pass') return '本次执行已产出变更和报告，但仍有接口字段、运行态截图或人工复核项需要确认。';
      if (status === 'blocked') return '识别到阻塞项，继续执行前需要先解决对应问题。';
      if (status === 'failed') return '执行过程中出现失败，需要查看日志或变更内容定位原因。';
      if (status === 'skipped') return '部分阶段未执行，建议确认是否符合本次任务范围。';
      return '平台暂未解析出明确结论，请结合日志和文件变更判断。';
    },

    aiExecutionArchiveStatusBucket(run = {}) {
      const status = this.effectiveResultStatus(run);
      const raw = `${run.status || ''} ${run.workerStatus || ''} ${run.resultSummary?.status || ''}`.toLowerCase();
      if (/rework|返工/.test(raw)) return 'rework';
      if (['failed', 'blocked'].includes(status) || /failed|error|blocked|失败|阻塞/.test(raw)) return 'rework';
      if (['conditional_pass', 'skipped'].includes(status) || run.resultSummary?.needsHumanReview === true) return 'review';
      if (['passed', 'completed', 'success'].includes(status) || /done|success|passed|completed|finished/.test(raw)) return 'closed';
      if (/claimed|running|in_progress|pending|queued/.test(raw)) return 'open';
      return 'open';
    },

    aiExecutionArchiveRunMatchesBucket(run = {}, bucket = '') {
      const value = String(bucket || '').trim();
      if (!value) return true;
      return this.aiExecutionArchiveStatusBucket(run) === value;
    },

    filteredAiExecutionArchiveRuns(options = {}) {
      const filters = this.aiExecutionArchiveFilters || {};
      const keyword = String(filters.keyword || '').trim().toLowerCase();
      const userId = String(filters.userId || '').trim();
      const status = String(filters.status || '').trim();
      const archiveBucket = options.ignoreBucket ? '' : String(filters.archiveBucket || '').trim();
      const sourceType = String(filters.sourceType || '').trim();
      const runId = String(filters.runId || '').trim();
      const from = filters.from ? Date.parse(filters.from) : 0;
      const to = filters.to ? Date.parse(filters.to) : 0;
      return (this.runs || [])
        .filter(run => !runId || String(run.id || '') === runId)
        .filter(run => !sourceType || run.sourceType === sourceType || run.executionMode === sourceType)
        .filter(run => !status || String(run.status || '') === status)
        .filter(run => this.aiExecutionArchiveRunMatchesBucket(run, archiveBucket))
        .filter(run => {
          if (!userId) return true;
          return [run.createdBy, run.ownerUserId, run.assignedToUserId, run.assignedToUserId, run.startedBy]
            .map(value => String(value || ''))
            .includes(userId);
        })
        .filter(run => {
          const time = Date.parse(run.createdAt || run.updatedAt || run.finishedAt || run.startedAt || '');
          if (from && (!time || time < from)) return false;
          if (to && (!time || time > to)) return false;
          return true;
        })
        .filter(run => {
          if (!keyword) return true;
          return [
            run.title,
            this.directSkillRunContentName(run),
            this.directSkillRunContentKind(run),
            run.primarySkillPath,
            run.stage,
            run.assignedToName,
            run.developer,
            run.figmaLinks,
            run.requirement,
            run.status
          ].map(value => String(value || '').toLowerCase()).join(' ').includes(keyword);
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    },

    isAiExecutionArchiveMetricActive(metric = {}) {
      const bucket = String(metric.bucket || '').trim();
      return String(this.aiExecutionArchiveFilters?.archiveBucket || '').trim() === bucket;
    },

    applyAiExecutionArchiveBucket(metric = {}) {
      const bucket = String(metric.bucket || '').trim();
      this.aiExecutionArchiveFilters = {
        ...this.aiExecutionArchiveFilters,
        archiveBucket: bucket,
        runId: '',
        status: ''
      };
      this.aiExecutionArchivePage = 1;
    },

    isAiExecutionArchiveClosedRun(run = {}) {
      return this.aiExecutionArchiveStatusBucket(run) === 'closed';
    },

    isAiExecutionArchiveReworkRun(run = {}) {
      return this.aiExecutionArchiveStatusBucket(run) === 'rework';
    },

    isAiExecutionArchiveReviewRun(run = {}) {
      return this.aiExecutionArchiveStatusBucket(run) === 'review';
    },

    aiExecutionArchiveDetailMetrics(run = null) {
      if (!run) return {
        summaryCards: [],
        dataRows: [],
        stageRows: [],
        validationRows: [],
        changeRows: [],
        artifactRows: [],
        targetRows: [],
        environmentRows: [],
        issueRows: []
      };
      const summary = run.resultSummary || {};
      const stages = this.displayRunStages(run);
      const stageRows = stages.map((stage, index) => ({
        key: `${index}-${stage.name || 'stage'}`,
        name: this.meaningfulNameFromPath(stage.name) || stage.name || `阶段 ${index + 1}`,
        status: this.aiExecutionArchiveStageStatus(stage.status || '', run),
        label: this.stageStepLabel(this.aiExecutionArchiveStageStatus(stage.status || '', run)),
        type: this.stageStatusTagType(this.aiExecutionArchiveStageStatus(stage.status || '', run))
      }));
      const stageCounts = stageRows.reduce((acc, stage) => {
        const value = `${stage.status || ''} ${stage.label || ''}`.toLowerCase();
        if (/failed|error|blocked|失败|阻塞/.test(value)) acc.failed += 1;
        else if (/skipped|skip|跳过/.test(value)) acc.skipped += 1;
        else if (/conditional|有条件/.test(value)) acc.review += 1;
        else if (/done|success|passed|completed|通过|完成/.test(value)) acc.success += 1;
        else acc.pending += 1;
        return acc;
      }, { success: 0, failed: 0, review: 0, skipped: 0, pending: 0 });
      const validationRows = (Array.isArray(summary.validationCommands) ? summary.validationCommands : [])
        .map(value => String(value || '').trim())
        .filter(value => value && !this.isPlaceholderResultText(value))
        .map((value, index) => ({ key: `validation-${index}`, value }));
      const artifactRows = (Array.isArray(summary.artifacts) ? summary.artifacts : [])
        .map(value => String(value || '').trim())
        .filter(value => value && !this.isPlaceholderResultText(value))
        .map((value, index) => ({ key: `artifact-${index}`, value: this.readableArchiveValue(value) }));
      const changeRows = this.aiExecutionArchiveChangeRows(run);
      const dataRows = this.aiExecutionArchiveDataRows(run, { stageRows, validationRows, artifactRows, changeRows });
      const resultStatus = this.effectiveResultStatus(run);
      const hasRunSuccess = this.isAiExecutionArchiveClosedRun(run) || this.isAiExecutionArchiveReviewRun(run);
      const hasRunFailure = this.isAiExecutionArchiveReworkRun(run);
      const successCount = Math.max(stageCounts.success + stageCounts.review + stageCounts.skipped, hasRunSuccess ? 1 : 0);
      const failedCount = Math.max(stageCounts.failed, hasRunFailure ? 1 : 0);
      const scanPointCount = stageRows.length
        + validationRows.length
        + artifactRows.length
        + changeRows.length
        + (run.primarySkillPath || run.stage || run.selectedMaterialHints?.length ? 1 : 0)
        + (run.figmaLinks ? 1 : 0)
        + (summary.blockerReason && !this.isPlaceholderResultText(summary.blockerReason) ? 1 : 0)
        + (summary.finalText && !this.isPlaceholderResultText(summary.finalText) ? 1 : 0);
      const summaryCards = [
        { label: '成功数量', value: successCount, hint: resultStatus === 'unknown' ? '按阶段和状态推导' : this.resultStatusLabel(resultStatus), tone: failedCount ? 'warning' : 'success' },
        { label: '失败数量', value: failedCount, hint: failedCount ? '含失败或阻塞阶段' : '未记录失败', tone: failedCount ? 'danger' : 'success' },
        { label: '扫描点', value: scanPointCount, hint: '阶段 / 验证 / 变更 / 证据', tone: scanPointCount ? 'primary' : 'muted' },
        { label: '数据类', value: dataRows.length, hint: dataRows.map(item => item.label).slice(0, 3).join(' / ') || '暂无结构化数据', tone: dataRows.length ? 'primary' : 'muted' }
      ];
      const targetRows = [
        { label: '使用内容', value: this.directSkillRunContentName(run) },
        { label: '内容类型', value: this.directSkillRunContentKind(run) },
        { label: 'Figma 目标', value: run.figmaLinks ? '已记录目标链接' : '未记录链接', href: run.figmaLinks || '' },
        { label: '写入方式', value: this.directSkillWriteModeLabel(run.figmaWriteMode) }
      ];
      const environmentRows = [
        { label: '操作人', value: this.directSkillRunOperatorName(run) },
        { label: '执行人', value: run.assignedToName || run.developer || '-' },
        { label: '执行设备', value: this.directSkillRunDeviceDisplayName(run) },
        { label: '当前状态', value: this.directSkillRunStatusLabel(run) || this.runStatusLabel(run.status) },
        { label: '创建时间', value: this.formatDateTime(run.createdAt) || '-' },
        { label: '更新时间', value: this.directSkillRunUpdatedText(run) }
      ];
      const issueRows = [
        this.aiExecutionArchiveIssueRow('阻塞原因', summary.blockerReason),
        this.aiExecutionArchiveIssueRow('退出码', run.exitCode === null || run.exitCode === undefined ? '' : `Codex 退出码 ${run.exitCode}`),
        this.aiExecutionArchiveIssueRow('人工确认', summary.needsHumanReview ? '需要人工确认' : '')
      ].filter(Boolean);
      if (!issueRows.length) {
        issueRows.push({ label: '当前问题', value: '未记录阻塞或失败原因。', tone: 'muted' });
      }
      const readableDataRows = dataRows.filter(item => item.readable !== false);
      if (!readableDataRows.length && !stageRows.length && !validationRows.length && !changeRows.length && !artifactRows.length) {
        readableDataRows.push({ label: '记录状态', value: '这条执行目前只有基础状态，没有更细的结构化结果。' });
      }
      return {
        summaryCards,
        dataRows: readableDataRows,
        stageRows,
        validationRows,
        changeRows,
        artifactRows,
        targetRows,
        environmentRows,
        issueRows,
        resultTitle: this.aiExecutionArchiveResultTitle(run),
        resultText: this.aiExecutionArchiveResultText(run),
        nextAction: this.aiExecutionArchiveNextActionText(run)
      };
    },

    aiExecutionArchiveResultTitle(run = {}) {
      const status = this.effectiveResultStatus(run);
      if (this.isAiExecutionArchiveReworkRun(run)) return '需要返工或重新处理';
      if (status === 'passed') return '已完成，等待验收确认';
      if (status === 'conditional_pass') return '已产出结果，需要人工确认';
      if (/pending|queued/i.test(String(run.status || ''))) return '等待执行人本机 Worker 领取';
      if (/claimed|running|in_progress/i.test(String(run.status || ''))) return '执行人本机正在处理';
      return this.resultStatusTitle(run.resultSummary || {}, run);
    },

    aiExecutionArchiveResultText(run = {}) {
      const summary = run.resultSummary || {};
      if (this.isAiExecutionArchiveReworkRun(run)) {
        const reason = String(summary.blockerReason || '').trim();
        return reason && !this.isPlaceholderResultText(reason)
          ? this.humanizeRunResultText(reason)
          : '本次执行失败或阻塞，需要查看问题信息后重新执行。';
      }
      if (summary.summary && !this.isPlaceholderResultText(summary.summary)) {
        return this.humanizeRunResultText(summary.summary);
      }
      if (this.isAiExecutionArchiveReviewRun(run)) return '本次执行已有结果，但仍需要负责人或验收人做人工确认。';
      if (this.isAiExecutionArchiveClosedRun(run)) return '本次执行已完成，未记录阻塞原因。';
      return this.resultStatusDescription(summary, run);
    },

    aiExecutionArchiveNextActionText(run = {}) {
      if (this.isAiExecutionArchiveReworkRun(run)) return '建议：先处理阻塞原因，再重新发起直接执行。';
      if (this.isAiExecutionArchiveReviewRun(run)) return '建议：打开 Figma 和执行结果，完成人工验收确认。';
      if (this.isAiExecutionArchiveClosedRun(run)) return '建议：进入业务任务验收，确认是否闭环。';
      if (/pending|queued/i.test(String(run.status || ''))) return '建议：确认执行人电脑 Worker、Codex 和 Figma MCP 是否就绪。';
      if (/claimed|running|in_progress/i.test(String(run.status || ''))) return '建议：等待本机 Worker 回传结果。';
      return this.resultNextActionText(run);
    },

    aiExecutionArchiveIssueRow(label = '', value = '') {
      const text = String(value || '').trim();
      if (!text || this.isPlaceholderResultText(text)) return null;
      return {
        label,
        value: this.humanizeRunResultText(text),
        tone: /失败|阻塞|exit|退出码|error|failed|blocked/i.test(text) ? 'danger' : 'warning'
      };
    },

    directSkillRunOverviewMetrics(run = null) {
      const detail = this.aiExecutionArchiveDetailMetrics(run);
      if (!run) return detail;
      const summary = run.resultSummary || {};
      const actualStages = (Array.isArray(run.stages) ? run.stages : []).filter(stage => stage?.name);
      const actualStageCounts = actualStages.reduce((acc, stage) => {
        const value = String(stage.status || '').toLowerCase();
        if (/failed|error|blocked|失败|阻塞/.test(value)) acc.failed += 1;
        else if (/conditional|有条件/.test(value)) acc.review += 1;
        else if (/done|success|passed|completed|通过|完成/.test(value)) acc.success += 1;
        return acc;
      }, { success: 0, failed: 0, review: 0 });
      const resultStatus = this.effectiveResultStatus(run);
      const rawStatus = String(run.status || '').toLowerCase();
      const isFinished = /done|success|passed|completed|finished|failed|error|blocked/.test(rawStatus);
      const finalSuccess = isFinished && ['passed', 'conditional_pass', 'completed', 'success'].includes(resultStatus) ? 1 : 0;
      const finalFailure = isFinished && ['failed', 'blocked'].includes(resultStatus) ? 1 : 0;
      const successCount = Math.max(actualStageCounts.success + actualStageCounts.review, finalSuccess);
      const failedCount = Math.max(actualStageCounts.failed, finalFailure);
      const scanPointCount = actualStages.length
        + detail.validationRows.length
        + detail.artifactRows.length
        + detail.changeRows.length
        + (run.primarySkillPath || run.stage || run.selectedMaterialHints?.length ? 1 : 0)
        + (run.figmaLinks ? 1 : 0)
        + (summary.blockerReason && !this.isPlaceholderResultText(summary.blockerReason) ? 1 : 0)
        + (summary.finalText && !this.isPlaceholderResultText(summary.finalText) ? 1 : 0);
      let issueRows = detail.issueRows;
      if (/pending|queued|created/i.test(rawStatus)) {
        issueRows = [{ label: '当前等待', value: '等待执行人本机 Worker 自动领取。', tone: 'muted' }];
      } else if (/claimed|running|in_progress/i.test(rawStatus)) {
        issueRows = [{ label: '当前处理', value: '执行人本机 Worker 正在处理，等待结果回传。', tone: 'muted' }];
      }
      return {
        ...detail,
        summaryCards: [
          { label: '成功数量', value: successCount, hint: successCount ? this.resultStatusLabel(resultStatus) : '尚未记录成功', tone: failedCount ? 'warning' : successCount ? 'success' : 'muted' },
          { label: '失败数量', value: failedCount, hint: failedCount ? '含失败或阻塞' : '未记录失败', tone: failedCount ? 'danger' : 'success' },
          { label: '扫描点', value: scanPointCount, hint: '对象 / Figma / 阶段 / 证据', tone: scanPointCount ? 'primary' : 'muted' },
          { label: '数据类', value: detail.dataRows.length, hint: detail.dataRows.map(item => item.label).slice(0, 3).join(' / ') || '暂无结构化数据', tone: detail.dataRows.length ? 'primary' : 'muted' }
        ],
        issueRows
      };
    },

    focusedRunOverviewMetrics(run = null) {
      if (!run) return {
        summaryCards: [],
        targetRows: [],
        environmentRows: [],
        issueRows: [],
        nextAction: '',
        resultTitle: '',
        resultText: ''
      };
      const detail = this.isDirectSkillRun(run)
        ? this.directSkillRunOverviewMetrics(run)
        : this.aiExecutionArchiveDetailMetrics(run);
      const summary = run.resultSummary || {};
      const status = this.effectiveResultStatus(run);
      const isPending = /pending|created|queued/i.test(String(run.status || ''));
      const isRunning = this.isRunInProgress(run);
      const issueRows = [];
      const blocker = String(summary.blockerReason || run.blocker?.reason || '').trim();
      if (blocker && !this.isPlaceholderResultText(blocker)) {
        issueRows.push({
          label: status === 'failed' || status === 'blocked' ? '阻塞原因' : '风险提示',
          value: this.humanizeRunResultText(blocker),
          tone: status === 'failed' || status === 'blocked' ? 'danger' : 'warning'
        });
      } else if (isPending) {
        issueRows.push({ label: '当前等待', value: this.isDirectSkillRun(run) ? '等待执行人本机 Worker 自动领取。' : '等待负责人点击启动执行。', tone: 'muted' });
      } else if (isRunning) {
        issueRows.push({ label: '当前处理', value: 'Codex 正在按当前步骤执行，等待结果回传。', tone: 'muted' });
      } else {
        issueRows.push({ label: '当前问题', value: '未记录阻塞或失败原因。', tone: 'muted' });
      }
      return {
        ...detail,
        issueRows,
        resultTitle: this.resultStatusTitle(summary, run),
        resultText: this.resultSummaryText(summary, run),
        nextAction: this.resultNextActionText(run)
      };
    },

    directSkillWriteModeLabel(mode = '') {
      return {
        'target-node': '写入指定节点',
        append: '追加到目标区域',
        replace: '替换目标内容'
      }[mode] || mode || '写入指定节点';
    },

    aiExecutionArchiveChangeRows(run = {}) {
      const summary = run.resultSummary || {};
      const rows = [];
      const push = (value, status = '') => {
        const text = String(value?.path || value || '').trim();
        if (!text || this.isPlaceholderResultText(text)) return;
        rows.push({
          key: `${status || 'change'}-${rows.length}-${text}`,
          path: this.readableArchiveValue(text),
          status: status || value?.status || value?.changeType || '',
          label: this.gitChangeStatusLabel(status || value?.status || value?.changeType || '')
        });
      };
      (run.changeSummary?.after || []).forEach(item => push(item, item?.status || item?.changeType || ''));
      (summary.changedFiles || []).forEach(item => push(item, item?.status || item?.changeType || ''));
      return rows.slice(0, 80);
    },

    aiExecutionArchiveStageStatus(status = '', run = {}) {
      const value = String(status || '').toLowerCase();
      if (value && !/pending|created|queued|wait/.test(value)) return status;
      if (!this.hasRunExecuted(run) || this.isRunInProgress(run)) return status || 'pending';
      const resultStatus = this.effectiveResultStatus(run);
      if (resultStatus === 'passed') return 'completed';
      if (resultStatus === 'conditional_pass') return 'conditional';
      if (resultStatus === 'failed') return 'failed';
      if (resultStatus === 'blocked') return 'blocked';
      if (resultStatus === 'skipped') return 'skipped';
      return status || 'pending';
    },

    aiExecutionArchiveDataRows(run = {}, groups = {}) {
      const summary = run.resultSummary || {};
      const rows = [];
      if (groups.stageRows?.length) rows.push({ label: '阶段数据', value: `${groups.stageRows.length} 个阶段` });
      if (groups.validationRows?.length) rows.push({ label: '验证数据', value: `${groups.validationRows.length} 条命令` });
      if (groups.changeRows?.length) rows.push({ label: '变更数据', value: `${groups.changeRows.length} 个点` });
      if (groups.artifactRows?.length) rows.push({ label: '产物证据', value: `${groups.artifactRows.length} 个` });
      if (run.primarySkillPath || run.stage || run.selectedMaterialHints?.length) {
        rows.push({ label: 'Skill/md 数据', value: this.directSkillRunContentName(run) });
      }
      if (run.figmaLinks) rows.push({ label: 'Figma 数据', value: '已记录目标链接' });
      if (summary.blockerReason && !this.isPlaceholderResultText(summary.blockerReason)) {
        rows.push({ label: '阻塞数据', value: this.humanizeRunResultText(summary.blockerReason) });
      }
      if (summary.finalText && !this.isPlaceholderResultText(summary.finalText)) {
        rows.push({ label: '模型回传', value: this.compactArchiveText(summary.finalText) });
      }
      return rows.filter(row => String(row.value || '').trim());
    },

    compactArchiveText(value = '') {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      return text.length > 160 ? `${text.slice(0, 160)}...` : text;
    },

    readableArchiveValue(value = '') {
      const text = String(value || '').trim();
      if (!text) return '-';
      return this.meaningfulNameFromPath(text) || text;
    },

    resultSummaryText(summary = {}, run = {}) {
      const logReason = this.directSkillRunLogFailureReason(run);
      if (logReason) return this.humanizeRunResultText(logReason);
      const text = String(summary.summary || '').trim();
      if (text && !this.isPlaceholderResultText(text)) return this.humanizeRunResultText(text);
      const reason = String(summary.blockerReason || '').trim();
      if (reason && !this.isPlaceholderResultText(reason)) return this.humanizeRunResultText(reason);
      return this.resultStatusDescription(summary, run);
    },

    resultReasonText(summary = {}, run = {}) {
      const reason = String(summary.blockerReason || '').trim();
      if (reason && !this.isPlaceholderResultText(reason)) return this.humanizeRunResultText(reason);
      return this.resultStatusDescription(summary, run);
    },

    isPlaceholderResultText(text = '') {
      const value = String(text || '').trim();
      if (!value) return true;
      return /^证据$|^结果$|^结论$/i.test(value)
        || /^无硬阻塞。?$|^无阻塞。?$|^无。?$/.test(value)
        || /^-\s*当前状态[：:]?\s*$/.test(value)
        || /仅当.+时填写/.test(value)
        || /passed\s*\/\s*conditional_pass\s*\/\s*failed\s*\/\s*blocked\s*\/\s*skipped/i.test(value)
        || /^报告\/截图\/日志产物路径$/.test(value)
        || /^运行过的验证命令$/.test(value);
    },

    resultDecisionFacts(run = {}) {
      const summary = run.resultSummary || {};
      const status = this.effectiveResultStatus(run);
      const stages = this.displayRunStages(run);
      const stageCounts = stages.reduce((acc, stage, index) => {
        const stageStatus = index >= 0 && run === this.selectedRun ? this.displayStageStatus(stage, index) : stage.status;
        const value = String(stageStatus || '').toLowerCase();
        if (/conditional|有条件/.test(value)) acc.conditional += 1;
        else if (/skipped|skip|跳过/.test(value)) acc.skipped += 1;
        else if (/failed|error|blocked|阻塞|失败/.test(value)) acc.failed += 1;
        else if (/done|success|passed|completed|通过|完成/.test(value)) acc.passed += 1;
        else acc.pending += 1;
        return acc;
      }, { passed: 0, conditional: 0, skipped: 0, failed: 0, pending: 0 });
      const closedCount = stageCounts.passed + stageCounts.conditional + stageCounts.skipped + stageCounts.failed;
      const artifactCount = (summary.artifacts || []).filter(item => !this.isPlaceholderResultText(item)).length;
      const validationCount = (summary.validationCommands || []).filter(item => !this.isPlaceholderResultText(item)).length;
      const changeCount = run.changeSummary?.after?.length || summary.changedFiles?.filter(item => !this.isPlaceholderResultText(item)).length || 0;
      const hasStructuredEvidence = artifactCount || validationCount;
      const hasExecutionEvidence = closedCount > 0 || changeCount > 0;
      const needsHumanReview = Boolean(summary.needsHumanReview) || ['conditional_pass', 'failed', 'blocked', 'skipped'].includes(status);
      const facts = [
        {
          label: '阶段闭环',
          value: stages.length
            ? `${closedCount}/${stages.length} 已闭环${stageCounts.failed ? `，${stageCounts.failed} 个失败` : stageCounts.skipped ? `，${stageCounts.skipped} 个跳过` : ''}`
            : '未记录阶段',
          status: stageCounts.failed ? 'danger' : stageCounts.skipped || stageCounts.pending ? 'warning' : 'success'
        },
        {
          label: '产物证据',
          value: hasStructuredEvidence ? `${artifactCount} 个产物，${validationCount} 条验证` : hasExecutionEvidence ? '未记录产物路径' : '未记录产物',
          status: hasStructuredEvidence ? 'success' : hasExecutionEvidence ? 'muted' : 'warning'
        },
        {
          label: '文件变更',
          value: changeCount ? `${changeCount} 项当前变更` : '未记录变更',
          status: changeCount ? 'success' : 'muted'
        },
        {
          label: '人工确认',
          value: needsHumanReview ? '需要' : '不需要',
          status: needsHumanReview ? 'warning' : 'success'
        }
      ];
      return facts;
    },

    resultNextActionText(run = {}) {
      const summary = run.resultSummary || {};
      const status = this.effectiveResultStatus(run);
      const nextStep = String(summary.nextStep || '').trim();
      if (nextStep && !this.isPlaceholderResultText(nextStep)) return this.humanizeRunResultText(nextStep);
      const logReason = this.directSkillRunLogFailureReason(run);
      if (logReason) return `下一步：${this.humanizeRunResultText(logReason)}`;
      const blockerReason = String(summary.blockerReason || '').trim();
      if (['blocked', 'failed'].includes(status) && blockerReason && !this.isPlaceholderResultText(blockerReason)) {
        return this.humanizeRunResultText(blockerReason);
      }
      if (status === 'passed') return '下一步：回到任务中心查看关联任务，并按业务任务做验收确认。';
      if (status === 'conditional_pass') return '下一步：优先确认风险项和运行证据，确认后再视为交付完成。';
      if (status === 'skipped') return '下一步：确认跳过阶段是否符合本次任务范围。';
      if (status === 'blocked') return '下一步：先解决阻塞项，再重新发起执行。';
      if (status === 'failed') return '下一步：查看日志和变更清单，修复后重新执行。';
      return '下一步：结合执行日志和文件变更确认本次结果。';
    },

    humanizeRunResultText(text, fallback = '未解析到明确说明。') {
      const value = String(text || '').trim();
      if (!value) return fallback;
      return value
        .replace(/若超出当前兼容列表，?/g, '如果该路径字段还没有配置到兼容列表，')
        .replace(/当前兼容列表/g, '已配置的兼容字段列表')
        .replace(/界面无法优先使用该字段/g, '页面会继续使用旧字段，新的自定义路径不会生效')
        .replace(/CUSTOM_PATH_KEYS/g, '自定义路径字段列表（CUSTOM_PATH_KEYS）');
    },

    directSkillRunLogFailureReason(run = null) {
      if (!this.isDirectSkillFailedRun(run) || run?.id !== this.selectedRunId) return '';
      const lines = String(this.logText || '')
        .replace(/\u001b\[[0-9;]*m/g, '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
      const matched = lines.find(line => /not inside a trusted directory|skip-git-repo-check|figma|mcp|oauth|permission|denied|error|failed|失败|阻塞|不可用/i.test(line));
      if (!matched || /日志读取失败|暂无日志/.test(matched)) return '';
      return matched.slice(0, 300);
    },

    businessTaskForRun(run) {
      if (!run) return null;
      if (!this.isTaskCenterLinkedRun(run)) return null;
      return (this.businessTasks || []).find(task => task.id === run.taskId || (task.taskNo && task.taskNo === run.zentaoId)) || null;
    },

    openRunArchive(run = this.selectedRun) {
      if (!run) return;
      this.aiExecutionArchiveFilters = {
        ...this.aiExecutionArchiveFilters,
        keyword: '',
        userId: '',
        status: '',
        archiveBucket: '',
        sourceType: '',
        runId: run.id || '',
        from: '',
        to: ''
      };
      this.runLogCollapse = [];
      this.logText = '原始执行日志默认收起，展开后读取尾部摘要。';
      this.pushRoute('/ai-archive');
      this.$nextTick(() => {
        document.querySelector('.ai-archive-table')?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    },

    openAiExecutionArchiveDetail(run = null) {
      if (!run) return;
      this.aiExecutionArchiveDetail = {
        visible: true,
        run: { ...run }
      };
    },

    closeAiExecutionArchiveDetail() {
      this.aiExecutionArchiveDetail = {
        visible: false,
        run: null
      };
    },

    openRunBusinessTaskReview(run = this.selectedRun) {
      const task = this.businessTaskForRun(run);
      if (!task) {
        ElMessage.warning('没有找到关联的业务任务，已回到美术执行台。');
        this.openRunArchive(run);
        return;
      }
      this.selectedBusinessTaskId = task.id;
      this.selectedAiArchiveTaskId = task.id;
      this.seedTaskReviewForm(task);
      this.activeView = 'tasks';
      this.pushRoute('/tasks');
      this.$nextTick(() => {
        document.querySelector('.task-review-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    },

    runStatusLabel(status = '') {
      const value = String(status || '').toLowerCase();
      if (/conditional/.test(value)) return '有条件通过';
      if (/claimed/.test(value)) return '已领取';
      if (/running|in_progress/.test(value)) return '执行中';
      if (/pending|created|queued/.test(value)) return '待启动';
      if (/done|success|passed|completed/.test(value)) return '已完成';
      if (/failed|error/.test(value)) return '执行失败';
      if (/blocked/.test(value)) return '已阻塞';
      if (/cancelled|canceled/.test(value)) return '已取消';
      return status || '待判定';
    },

    directSkillRunStatusLabel(run = null) {
      if (!run) return '待判定';
      const value = String(run.status || '').toLowerCase();
      if (/pending|created|queued/.test(value)) return '待领取';
      if (/claimed/.test(value)) return '已领取';
      if (/running|in_progress/.test(value)) return '本机执行中';
      if (/failed|error/.test(value)) return '本机执行失败';
      if (/blocked/.test(value)) return '本机阻塞';
      if (/completed|done|success|passed/.test(value)) return '本机已完成';
      return this.runStatusLabel(run.status);
    },

    gitStatusLabel(status = '') {
      const value = String(status || '').trim();
      return {
        '??': '新增未跟踪',
        M: '已修改',
        A: '新增',
        D: '删除',
        R: '重命名',
        C: '复制',
        U: '冲突',
        AM: '新增后修改',
        MM: '已修改',
        AD: '新增后删除',
        RM: '重命名后修改',
        ERR: '读取失败'
      }[value] || value || '变更';
    },

    stageStepLabel(status = '') {
      const value = String(status || '').toLowerCase();
      if (/conditional|有条件/.test(value)) return '有条件通过';
      if (/failed|error|阻塞|❌/.test(value)) return '执行失败';
      if (/running|in_progress/.test(value)) return '执行中';
      if (/done|success|passed|completed|通过|✅/.test(value)) return '已完成';
      if (/skipped|skip|跳过/.test(value)) return '已跳过';
      if (/pending|created|queued|wait/.test(value)) return '未执行';
      return status || '未执行';
    },

    stageStepClass(status = '') {
      const value = String(status || '').toLowerCase();
      if (/conditional|有条件|⚠️/.test(value)) return 'is-conditional-stage';
      if (/skipped|skip|跳过|⏭️/.test(value)) return 'is-skipped-stage';
      if (/failed|error|阻塞|❌/.test(value)) return 'is-failed-stage';
      if (/running|in_progress/.test(value)) return 'is-running-stage';
      if (/done|success|passed|completed|通过|✅/.test(value)) return 'is-passed-stage';
      return 'is-pending-stage';
    },

    stageDurationMs(stage = {}, run = null, index = -1) {
      const start = Date.parse(stage.startedAt || '');
      const end = this.stageReachedAt(stage, run, index);
      if (!start || !end || end < start) return 0;
      return end - start;
    },

    stageDurationText(stage = {}, run = null, index = -1) {
      const value = String(stage.status || '').toLowerCase();
      const stages = run?.stages || [];
      const stageIndex = index >= 0 ? index : stages.findIndex(item => item === stage || (item.no && item.no === stage.no) || (item.name && item.name === stage.name));
      if (this.isRunInProgress(run) && this.currentRunStageIndex(run) === stageIndex) {
        const startedAt = Date.parse(run?.startedAt || run?.createdAt || '');
        return startedAt ? `累计 ${this.formatLiveDuration(this.nowTick - startedAt)}` : '计时中';
      }
      if (/pending|created|queued|wait/.test(value)) return '累计 -';
      const duration = this.stageCumulativeDurationMs(stage, run, index);
      if (!duration) return '耗时 -';
      return `累计 ${this.formatLiveDuration(duration)}`;
    },

    stageCumulativeDurationMs(stage = {}, run = null, index = -1) {
      const runStart = Date.parse(run?.startedAt || run?.createdAt || '');
      if (!runStart) return 0;
      const stages = run?.stages || [];
      const stageIndex = index >= 0 ? index : stages.findIndex(item => item === stage || (item.no && item.no === stage.no) || (item.name && item.name === stage.name));
      const end = this.stageReachedAt(stage, run, stageIndex);
      let reachedAt = end;
      if (stageIndex > 0) {
        for (let i = 0; i < stageIndex; i += 1) {
          const previousEnd = this.stageReachedAt(stages[i], run, i);
          if (previousEnd && previousEnd > reachedAt) reachedAt = previousEnd;
        }
      }
      if (!reachedAt || reachedAt < runStart) return 0;
      return reachedAt - runStart;
    },

    stageReachedAt(stage = {}, run = null, index = -1) {
      const stages = run?.stages || [];
      const runStart = Date.parse(run?.startedAt || run?.createdAt || '');
      const runEnd = Date.parse(run?.finishedAt || run?.completedAt || run?.updatedAt || '');
      const stageStart = Date.parse(stage.startedAt || '');
      const lowerBound = stageStart || runStart || 0;
      const nextStart = this.nextStageStartAt(stages, index, lowerBound);
      const clampToNextStart = value => (nextStart && value > nextStart ? nextStart : value);
      const directEnd = Date.parse(stage.finishedAt || '');
      if (directEnd) {
        if (runEnd && index === stages.length - 1 && runEnd > directEnd) return runEnd;
        return clampToNextStart(directEnd);
      }
      if (/running|in_progress/i.test(stage.status || '') && this.isRunInProgress(run)) return this.nowTick;
      if (Number(stage.durationMs) > 0) {
        const durationStart = stageStart || runStart;
        if (durationStart) return clampToNextStart(durationStart + Number(stage.durationMs));
      }
      if (nextStart) return nextStart;
      if (runEnd && index === stages.length - 1) return runEnd;
      return 0;
    },

    nextStageStartAt(stages = [], index = -1, lowerBound = 0) {
      if (!Array.isArray(stages) || index < 0) return 0;
      for (let i = index + 1; i < stages.length; i += 1) {
        const nextStart = Date.parse(stages[i]?.startedAt || '');
        if (nextStart && (!lowerBound || nextStart > lowerBound)) return nextStart;
      }
      return 0;
    },

    directSkillRunDisplayStages(run = null) {
      if (!run) return [];
      const status = String(run.status || '').toLowerCase();
      const isPending = /pending|created|queued/.test(status) || !status;
      const isClaimed = Boolean(run.claimedAt || run.claimedByDeviceId || /claimed|running|in_progress|done|success|passed|completed|failed|error|blocked/.test(status));
      const isRunning = /claimed|running|in_progress/.test(status);
      const isFailed = /failed|error/.test(status);
      const isBlocked = /blocked/.test(status);
      const isDone = /done|success|passed|completed|finished/.test(status);
      const finalStatus = isFailed ? 'failed' : isBlocked ? 'blocked' : isDone ? 'completed' : 'pending';
      const claimStatus = isPending ? 'pending' : isClaimed ? 'completed' : 'pending';
      const executeStatus = isFailed ? 'failed' : isBlocked ? 'blocked' : isDone ? 'completed' : isRunning ? 'running' : 'pending';
      return [
        {
          no: 1,
          name: '已创建',
          status: run.createdAt ? 'completed' : 'pending',
          startedAt: run.createdAt || '',
          finishedAt: run.createdAt || ''
        },
        {
          no: 2,
          name: 'Worker 领取',
          status: claimStatus,
          startedAt: run.claimedAt || '',
          finishedAt: run.claimedAt || run.startedAt || ''
        },
        {
          no: 3,
          name: '本机执行',
          status: executeStatus,
          startedAt: run.startedAt || run.claimedAt || '',
          finishedAt: isDone || isFailed || isBlocked ? run.finishedAt || run.updatedAt || '' : ''
        },
        {
          no: 4,
          name: '结果回传',
          status: finalStatus,
          startedAt: run.finishedAt || run.updatedAt || '',
          finishedAt: run.finishedAt || run.updatedAt || ''
        }
      ];
    },

    focusedRunStepFlow(run = null) {
      if (!run) return [];
      const displayStages = this.selectedRun?.id === run.id ? this.selectedRunDisplayStages : this.displayRunStages(run);
      const isDirect = this.isDirectSkillRun(run);
      const actualStages = displayStages.length ? displayStages : isDirect ? this.directSkillRunDisplayStages(run) : [];
      const statusText = String(run.status || '').toLowerCase();
      const isPending = /pending|created|queued/.test(statusText) || !statusText;
      const isRunning = this.isRunInProgress(run) || /claimed/.test(statusText);
      const isFailed = /failed|error|blocked/.test(`${statusText} ${run.workerStatus || ''}`);
      const isDone = /done|success|passed|completed|finished|conditional/.test(statusText) || Boolean(run.resultSummary);
      const targetName = this.focusedRunContentName(run);
      const kind = this.directSkillRunContentKind(run);
      const firstStage = actualStages[0] || {};
      const lastStageIndex = actualStages.length ? actualStages.length - 1 : -1;
      const currentStageIndex = actualStages.findIndex(stage => /running|in_progress/i.test(stage.displayStatus || stage.status || ''));
      const firstPendingStageIndex = actualStages.findIndex(stage => /pending|created|queued|wait/i.test(stage.displayStatus || stage.status || ''));
      const codexFallbackIndex = currentStageIndex >= 0
        ? currentStageIndex
        : firstPendingStageIndex >= 0
          ? firstPendingStageIndex
          : lastStageIndex;
      const preflightStageIndex = isDirect && actualStages[1] ? 1 : !isDirect && actualStages.length > 1 ? 0 : -1;
      const preflightStage = preflightStageIndex >= 0 ? actualStages[preflightStageIndex] : null;
      const codexStageIndex = isDirect && actualStages[2] ? 2 : Math.max(0, codexFallbackIndex);
      const codexStage = actualStages[codexStageIndex] || firstStage;
      const resultStageIndex = isDirect && actualStages[3] ? 3 : lastStageIndex >= 0 ? lastStageIndex : -1;
      const resultStage = resultStageIndex >= 0 ? actualStages[resultStageIndex] : null;
      const currentStageName = run.currentStage || actualStages.find(stage => /running|in_progress/i.test(stage.displayStatus || stage.status || ''))?.name || firstStage.name || '';
      const stageStatus = (index, fallback = 'pending') => {
        const stage = actualStages[index] || {};
        return stage.displayStatus || stage.status || fallback;
      };
      const normalize = status => {
        const value = String(status || '').toLowerCase();
        if (/failed|error|blocked|阻塞|失败/.test(value)) return 'failed';
        if (/conditional|有条件|skipped|skip|跳过/.test(value)) return 'conditional';
        if (/running|in_progress|claimed/.test(value)) return 'running';
        if (/done|success|passed|completed|finished|通过|完成/.test(value)) return 'completed';
        return 'pending';
      };
      const codexStatus = isFailed ? 'failed' : isDone ? 'completed' : isRunning ? 'running' : 'pending';
      const resultStatus = isFailed ? 'failed' : isDone ? 'completed' : 'pending';
      const preflightStatus = isDirect
        ? normalize(stageStatus(preflightStageIndex, isPending ? 'pending' : 'completed'))
        : actualStages.length
          ? normalize(stageStatus(preflightStageIndex, isPending && !run.startedAt ? 'pending' : 'completed'))
          : isPending && !run.startedAt && !run.claimedAt ? 'pending' : 'completed';
      const contextDurationMs = this.focusedRunStepDurationMs(run, {
        startedAt: run.createdAt || '',
        finishedAt: run.startedAt || run.claimedAt || run.createdAt || ''
      });
      const preflightDurationMs = preflightStageIndex >= 0 ? this.focusedRunStepDurationMs(run, preflightStage, preflightStageIndex) : 0;
      const resultDurationMs = resultStageIndex >= 0 ? this.focusedRunStepDurationMs(run, resultStage, resultStageIndex) : this.focusedRunStepDurationMs(run, {
        startedAt: run.finishedAt || '',
        finishedAt: run.updatedAt || run.finishedAt || ''
      });
      const steps = [
        {
          key: 'target',
          title: '选择执行内容',
          summary: `${kind} · ${targetName || this.runGroupTitle(run)}`,
          status: run.createdAt ? 'completed' : 'pending',
          time: run.createdAt,
          durationMs: 0
        },
        {
          key: 'context',
          title: '读取任务上下文',
          summary: run.figmaLinks ? '已记录 Figma 目标和补充要求' : this.isSkillOrMdFocusedRun(run) ? '读取当前任务要求和 Skill/md 内容' : '读取任务要求、阶段和执行参数',
          status: isPending && !run.startedAt && !run.claimedAt ? 'pending' : 'completed',
          time: run.startedAt || run.claimedAt || run.createdAt,
          durationMs: contextDurationMs
        },
        {
          key: 'preflight',
          title: '执行自检',
          summary: isDirect ? '检查执行人本机 Codex 与 Figma MCP' : '检查项目、路径和执行参数',
          status: preflightStatus,
          time: preflightStage?.startedAt || run.startedAt || run.claimedAt || '',
          durationMs: preflightDurationMs
        },
        {
          key: 'codex',
          title: 'Codex 执行',
          summary: currentStageName || (this.isSkillOrMdFocusedRun(run) ? '按当前 md/Skill 执行' : '按当前任务步骤执行'),
          status: normalize(stageStatus(codexStageIndex, codexStatus)),
          time: run.startedAt || run.claimedAt || '',
          durationMs: this.focusedRunStepDurationMs(run, codexStage, codexStageIndex)
        },
        {
          key: 'result',
          title: '结果回传',
          summary: this.resultStatusLabel(this.effectiveResultStatus(run)),
          status: normalize(resultStageIndex >= 0 ? stageStatus(resultStageIndex, resultStatus) : isFailed ? 'failed' : isDone ? 'completed' : isRunning ? 'pending' : resultStatus),
          time: run.finishedAt || run.updatedAt || '',
          durationMs: resultDurationMs
        },
        {
          key: 'archive',
          title: '归档验收',
          summary: isDone || isFailed ? '可进入 AI档案查看明细' : '等待执行完成后归档',
          status: isFailed ? 'failed' : isDone ? 'completed' : 'pending',
          time: run.finishedAt || '',
          durationMs: 0
        }
      ];
      return steps.map((step, index) => {
        const current = this.focusedRunStepIsCurrent(steps, index, run);
        const status = current ? 'running' : step.status;
        return {
          ...step,
          no: index + 1,
          status,
          label: this.stageStepLabel(status),
          className: this.focusedRunStepClass(status, current),
          durationClockText: this.formatClockDuration(step.durationMs),
          timeText: step.time ? this.formatDateTime(step.time) : ''
        };
      });
    },

    focusedRunStepDurationMs(run = null, stage = {}, index = -1) {
      if (!run || !stage) return 0;
      const explicit = Number(stage.durationMs || 0);
      if (explicit > 0) return explicit;
      const start = Date.parse(stage.startedAt || '');
      const finish = Date.parse(stage.finishedAt || '');
      if (start && finish && finish >= start) return finish - start;
      const isRunningStage = /running|in_progress|claimed/i.test(String(stage.displayStatus || stage.status || ''));
      if ((this.isRunInProgress(run) || /claimed/i.test(String(run?.status || ''))) && isRunningStage) {
        return start ? Math.max(0, this.nowTick - start) : this.runDurationMs(run);
      }
      const value = this.stageDurationMs(stage, run, index);
      return value > 0 ? value : 0;
    },

    focusedRunStepIsCurrent(steps = [], index = -1, run = null) {
      if (!run || !this.isRunInProgress(run) && !/claimed/i.test(String(run?.status || ''))) return false;
      const active = steps.findIndex(step => /running|in_progress|claimed/i.test(String(step.status || '')));
      if (active >= 0) return index === active;
      const firstPending = steps.findIndex(step => /pending|created|queued|wait/i.test(String(step.status || '')));
      return index === (firstPending >= 0 ? firstPending : steps.length - 1);
    },

    focusedRunStepClass(status = '', current = false) {
      if (current) return 'is-current';
      const value = String(status || '').toLowerCase();
      if (/failed|error|blocked/.test(value)) return 'is-failed';
      if (/conditional|skipped/.test(value)) return 'is-warning';
      if (/done|success|passed|completed|finished/.test(value)) return 'is-done';
      return 'is-pending';
    },

    displayRunStages(run = null) {
      const stages = (run?.stages || []).map(stage => ({ ...stage }));
      if (!stages.length && this.isDirectSkillRun(run)) return this.directSkillRunDisplayStages(run);
      if (!stages.length) return [];
      const events = this.isRunInProgress(run) && run?.id === this.selectedRunId
        ? this.stageEventsFromLog(this.logText)
        : [];
      for (const event of events) {
        const index = this.findStageIndexByName(stages, event.name);
        if (index < 0) continue;
        stages[index].status = event.type === 'start' ? 'running' : event.status;
        if (event.type === 'start') stages[index].startedAt = stages[index].startedAt || run?.startedAt || run?.createdAt;
        if (event.type === 'done') {
          stages[index].finishedAt = stages[index].finishedAt || new Date(this.nowTick).toISOString();
          for (let i = 0; i < index; i += 1) {
            if (/pending|created|queued|wait/i.test(String(stages[i].status || ''))) stages[i].status = 'skipped';
          }
        }
      }
      return stages;
    },

    runChainTask(run = this.selectedRun) {
      if (!run) return null;
      if (!this.isTaskCenterLinkedRun(run)) return null;
      const taskNo = String(run.zentaoId || run.taskNo || '').trim();
      return this.businessTaskRows.find(task => task.id === run.taskId)
        || this.businessTasks.find(task => task.id === run.taskId)
        || this.businessTaskRows.find(task => taskNo && String(task.taskNo || task.zentao?.id || '').trim() === taskNo)
        || this.businessTasks.find(task => taskNo && String(task.taskNo || task.zentao?.id || '').trim() === taskNo)
        || null;
    },

    runChainTaskNo(run = this.selectedRun) {
      const task = this.runChainTask(run);
      return String(run?.zentaoId || run?.taskNo || task?.taskNo || task?.zentao?.id || '').trim();
    },

    runChainEvents(run = this.selectedRun) {
      if (!run) return [];
      if (this.activeView !== 'runs') return [];
      const taskNo = this.runChainTaskNo(run);
      const task = this.runChainTask(run);
      return (this.artProgressEvents || [])
        .filter(event => {
          const eventTaskNo = String(event.zentaoTaskId || event.taskNo || event.zentaoId || '').trim();
          return event.runId === run.id
            || (run.id && event.metadata?.runId === run.id)
            || (taskNo && eventTaskNo === taskNo)
            || (task?.id && event.taskId === task.id);
        })
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    },

    runChainAiFlowRecord(run = this.selectedRun) {
      const task = this.runChainTask(run);
      const taskNo = this.runChainTaskNo(run);
      return (this.aiFlowRecords || []).find(record => record.status !== 'deleted' && record.projectId === run?.projectId && taskNo && String(record.taskNo || '').trim() === taskNo)
        || (this.aiFlowRecords || []).find(record => record.status !== 'deleted' && task?.id && record.taskId === task.id)
        || null;
    },

    runChainReviews(run = this.selectedRun) {
      const task = this.runChainTask(run);
      const taskNo = this.runChainTaskNo(run);
      return (this.taskReviews || [])
        .filter(review => review.runId === run?.id || (task?.id && review.taskId === task.id) || (taskNo && review.taskNo === taskNo))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    },

    runChainSkillActions(run = this.selectedRun) {
      const events = this.runChainEvents(run);
      const actionMap = new Map();
      for (const event of events) {
        const rawName = event.skillName || event.skillId || event.stage || event.title || '';
        const key = this.normalizeRunActionSkillKey(rawName);
        if (!key) continue;
        const item = actionMap.get(key) || {
          key,
          name: this.displayRunActionSkillName(key, rawName),
          count: 0,
          status: 'pending',
          people: new Set(),
          lastAt: '',
          summaries: [],
          records: []
        };
        item.count += 1;
        if (event.memberName || event.memberAccount) item.people.add(this.canonicalArtDeptPerson(event.memberName || event.memberAccount) || event.memberName || event.memberAccount);
        item.lastAt = String(event.createdAt || '').localeCompare(String(item.lastAt || '')) > 0 ? event.createdAt : item.lastAt;
        const status = this.runActionStatusFromEvent(event);
        item.status = this.mergeRunActionStatus(item.status, status);
        const summary = String(event.summary || event.title || event.stage || '').trim();
        if (summary && !item.summaries.includes(summary)) item.summaries.push(summary);
        item.records.push(event);
        actionMap.set(key, item);
      }
      return [...actionMap.values()].map(item => ({
        ...item,
        people: [...item.people],
        summary: item.summaries[0] || this.defaultRunActionSummary(item.key),
        type: this.runActionTypeLabel(item.key)
      })).sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')) || b.count - a.count);
    },

    highlightedRunSkillActions(run = this.selectedRun) {
      const existing = this.runChainSkillActions(run);
      const byKey = new Map(existing.map(item => [item.key, item]));
      return ['sameipimage', 'uifinalize'].map(key => byKey.get(key) || {
        key,
        name: this.displayRunActionSkillName(key),
        type: this.runActionTypeLabel(key),
        count: 0,
        status: 'pending',
        people: [],
        lastAt: '',
        summary: this.defaultRunActionSummary(key),
        records: []
      });
    },

    otherRunSkillActions(run = this.selectedRun) {
      return this.runChainSkillActions(run).filter(item => !['sameipimage', 'uifinalize'].includes(item.key)).slice(0, 8);
    },

    runSkillActionTotal(run = this.selectedRun) {
      return this.runChainSkillActions(run).reduce((sum, item) => sum + item.count, 0);
    },

    runOtherSkillActionSummary(run = this.selectedRun) {
      const rows = this.otherRunSkillActions(run);
      return {
        rows,
        count: rows.length,
        total: rows.reduce((sum, item) => sum + item.count, 0)
      };
    },

    runReferenceCount(run = this.selectedRun) {
      return this.runChainReferenceItems(run, { includeSelectedLog: false }).length;
    },

    normalizeRunActionSkillKey(value = '') {
      const normalized = this.normalizeUsageMatchText(value).replace(/\.(md|markdown)$/i, '');
      if (!normalized) return '';
      if (/sameipimage|同ip|固定人设|人物一致|角色一致|换动作|多场景角色/.test(normalized)) return 'sameipimage';
      if (/uifinalize|ui收尾|界面收尾|交付前检查|figma界面收尾|ui规范复核|交付检查/.test(normalized)) return 'uifinalize';
      if (this.isGenericUsageNeedle(normalized)) return '';
      return normalized;
    },

    displayRunActionSkillName(key = '', fallback = '') {
      if (key === 'sameipimage') return 'same-ip-image';
      if (key === 'uifinalize') return 'ui-finalize';
      return String(fallback || key || 'Skill').trim();
    },

    runActionTypeLabel(key = '') {
      if (key === 'sameipimage') return '同 IP 生图';
      if (key === 'uifinalize') return 'UI 收尾检查';
      return 'Skill / 工具调用';
    },

    defaultRunActionSummary(key = '') {
      if (key === 'sameipimage') return '用于角色一致性、固定人设、多场景生成或换动作。';
      if (key === 'uifinalize') return '用于 Figma 界面收尾和交付前检查。';
      return '其它 skill 或工具动作。';
    },

    runActionStatusFromEvent(event = {}) {
      const text = `${event.status || ''} ${event.eventType || ''} ${event.summary || ''}`;
      if (/blocked|阻塞|卡点/.test(text)) return 'blocked';
      if (/failed|fail|error|失败|不可用|不通过/.test(text)) return 'failed';
      if (/completed|done|success|通过|完成|可复用|可交付/.test(text)) return 'completed';
      if (/running|progress|started|执行中|进行中/.test(text)) return 'running';
      return 'recorded';
    },

    mergeRunActionStatus(current = 'pending', next = 'pending') {
      const rank = { failed: 6, blocked: 5, running: 4, completed: 3, recorded: 2, pending: 1 };
      return (rank[next] || 0) > (rank[current] || 0) ? next : current;
    },

    runActionStatusLabel(status = '') {
      return {
        completed: '已完成',
        recorded: '已记录',
        running: '执行中',
        blocked: '有阻塞',
        failed: '未通过',
        pending: '未记录'
      }[status] || '未记录';
    },

    runActionTagType(status = '') {
      if (status === 'completed' || status === 'recorded') return 'success';
      if (status === 'running') return 'warning';
      if (status === 'blocked' || status === 'failed') return 'danger';
      return 'info';
    },

    runChainReferenceItems(run = this.selectedRun) {
      const items = [];
      const push = (value, source = '引用') => {
        const text = String(value || '').trim();
        if (!text) return;
        const matches = text.match(/(?:[^\s`"'<>，。；;、]+\/)?[\u4e00-\u9fa5A-Za-z0-9_.-]+(?:\.(?:md|markdown)|\/SKILL\.md)/gi) || [];
        for (const match of matches) {
          const path = String(match || '').trim();
          if (!path || this.isGenericUsageFileTarget(path)) continue;
          const key = this.normalizeUsageMatchText(path);
          if (items.some(item => item.key === key)) continue;
          items.push({ key, label: this.fileNameFromPath(path) || path, path, source });
        }
      };
      [
        run?.requirement,
        run?.figmaLinks,
        run?.showdocHints,
        run?.materialPath,
        ...(this.runChainEvents(run).flatMap(event => [event.repoPath, event.summary, event.metadata?.path, event.metadata?.filePath, event.metadata?.skillPath, event.metadata?.artifactPath]) || [])
      ].forEach(value => push(value, '执行链路'));
      return items.slice(0, 10);
    },

    runChainTimeline(run = this.selectedRun) {
      if (!run) return [];
      const task = this.runChainTask(run);
      const aiFlow = this.runChainAiFlowRecord(run);
      const reviews = this.runChainReviews(run);
      const events = this.runChainEvents(run);
      const skillActions = this.runChainSkillActions(run);
      const references = this.runChainReferenceItems(run);
      const steps = [
        {
          key: 'requirement',
          title: '1. 任务需求',
          status: task || run.requirement ? 'completed' : 'pending',
          time: task?.createdAt || run.createdAt || '',
          summary: task?.displayTitle || task?.title || run.title || '执行记录已创建',
          meta: [this.runChainTaskNo(run) ? `禅道 ${this.runChainTaskNo(run)}` : '', run.projectName || this.projectName(run.projectId)].filter(Boolean)
        },
        {
          key: 'manual-context',
          title: '2. 人工补充',
          status: aiFlow ? 'completed' : 'pending',
          time: aiFlow?.updatedAt || aiFlow?.createdAt || '',
          summary: aiFlow ? '已有人工全流程记录' : '暂无人工补充记录',
          meta: aiFlow ? [aiFlow.flowCompletion ? `完成度 ${aiFlow.flowCompletion}%` : '', aiFlow.agentModel ? '已记录模型' : ''].filter(Boolean) : []
        },
        {
          key: 'ai-run',
          title: '3. AI 自动执行',
          status: this.isRunInProgress(run) ? 'running' : this.hasRunExecuted(run) ? 'completed' : 'pending',
          time: run.startedAt || run.createdAt || '',
          summary: this.workflowRunLabel(run),
          meta: [`阶段 ${this.displayRunStages(run).length || 0}`]
        },
        {
          key: 'skill-actions',
          title: '4. Skill / 工具动作',
          status: skillActions.length ? 'completed' : 'pending',
          time: skillActions[0]?.lastAt || '',
          summary: skillActions.length ? `${skillActions.length} 类动作，合计 ${skillActions.reduce((sum, item) => sum + item.count, 0)} 次` : '暂无 skill / 工具动作',
          meta: skillActions.map(item => item.type).slice(0, 5)
        },
        {
          key: 'references',
          title: '5. md / 文件引用',
          status: references.length ? 'completed' : 'pending',
          time: '',
          summary: references.length ? `${references.length} 个引用` : '暂无 md 或 SKILL.md 引用',
          meta: references.length ? ['明细在产物列表查看'] : []
        },
        {
          key: 'review',
          title: '6. 验证与验收',
          status: reviews.length ? 'completed' : this.selectedRun?.resultSummary ? 'recorded' : 'pending',
          time: reviews[0]?.createdAt || run.finishedAt || run.updatedAt || '',
          summary: reviews[0] ? this.taskReviewDecisionLabel(reviews[0].decision) : this.resultStatusLabel(this.effectiveResultStatus(run)),
          meta: reviews[0] ? [`评分 ${reviews[0].score ?? '-'}`, reviews[0].needsRework ? '需返工' : '无返工标记'] : []
        }
      ];
      return steps;
    },

    runChainStepClass(status = '') {
      if (status === 'completed' || status === 'recorded') return 'is-completed';
      if (status === 'running') return 'is-running';
      if (status === 'failed' || status === 'blocked') return 'is-problem';
      return 'is-pending';
    },

    isCurrentRunStage(stage, index) {
      const run = this.selectedRun;
      if (!run || !/running|in_progress/i.test(run.status || '')) return false;
      const currentIndex = this.currentRunStageIndex(run);
      return currentIndex >= 0 ? index === currentIndex : index === Math.max(this.activeRunStage - 1, 0);
    },

    isCurrentRunStageFromDisplayStages(stages = [], index = -1, run = null) {
      if (!run || !/running|in_progress/i.test(run.status || '')) return false;
      const currentIndex = this.currentRunStageIndex(run);
      if (currentIndex >= 0) return index === currentIndex;
      const active = stages.findIndex(stage => /running|in_progress/i.test(stage.status || ''));
      return active >= 0 ? index === active : false;
    },

    displayStageStatus(stage, index) {
      const displayStage = this.displayRunStages(this.selectedRun)[index] || stage;
      return this.isCurrentRunStage(stage, index) ? 'running' : displayStage?.status || '';
    },

    displayStageStatusFromDisplayStages(stages = [], stage = {}, index = -1, run = null) {
      const displayStage = stages[index] || stage;
      return this.isCurrentRunStageFromDisplayStages(stages, index, run) ? 'running' : displayStage?.status || '';
    },

    currentRunStageIndex(run = null) {
      const stages = run?.stages || [];
      if (!stages.length) return -1;
      const current = this.normalizeStageName(run?.currentStage || '');
      if (current) {
        const matched = stages.findIndex(stage => {
          const name = this.normalizeStageName(stage.name || '');
          return name === current || name.includes(current) || current.includes(name);
        });
        if (matched >= 0) return matched;
      }
      const running = stages.findIndex(stage => /running|in_progress/i.test(stage.status || ''));
      if (running >= 0) return running;
      const firstPending = stages.findIndex(stage => /pending|created|queued|wait/i.test(stage.status || ''));
      return firstPending;
    },

    normalizeStageName(value = '') {
      return String(value || '').replace(/\s+/g, '').replace(/[\\/]/g, '').replace(/api/ig, '').toLowerCase();
    },

    findStageIndexByName(stages = [], name = '') {
      const target = this.normalizeStageName(name);
      if (!target) return -1;
      return stages.findIndex(stage => {
        const source = this.normalizeStageName(stage.name || '');
        return source === target || source.includes(target) || target.includes(source);
      });
    },

    stageEventsFromLog(text = '') {
      const events = [];
      for (const line of String(text || '').split(/\r?\n/)) {
        const start = line.match(/AGENT_WORKFLOW_STAGE_START:\s*(.+)\s*$/);
        if (start) {
          events.push({ type: 'start', name: start[1].trim(), status: 'running' });
          continue;
        }
        const done = line.match(/AGENT_WORKFLOW_STAGE_DONE:\s*([^|]+)\|\s*([a-z_]+)\s*$/i);
        if (done) events.push({ type: 'done', name: done[1].trim(), status: done[2].trim() });
      }
      return events;
    },

    currentRunStageText(run = null) {
      if (!run) return '等待启动';
      if (this.isDirectSkillRun(run) && String(run.status || '').toLowerCase() === 'pending') return '等待执行人本机 Worker 领取';
      if (this.isDirectSkillRun(run) && String(run.status || '').toLowerCase() === 'claimed') return '执行人本机已领取';
      if (this.isDirectSkillFailedRun(run)) return '本机 Worker 已自动领取后执行失败';
      if (!this.isRunInProgress(run)) {
        const statusText = String(run.status || '').toLowerCase();
        if (/cancelled|canceled/.test(statusText)) return '已中断，可继续执行';
        if (/blocked/.test(statusText)) return '已阻塞，可继续执行';
        if (/failed|error/.test(statusText)) return '执行失败，可继续执行';
        if (this.hasRunExecuted(run)) return '执行完成';
        return '等待启动';
      }
      if (run.currentStage) return run.currentStage;
      return run.stages?.find(stage => /running/i.test(stage.status || ''))?.name
        || '等待阶段回传';
    },

    runStatusClass(status = '') {
      const value = String(status || '').toLowerCase();
      if (/conditional/.test(value)) return 'is-conditional';
      if (/failed|error/.test(value)) return 'is-failed';
      if (/blocked|cancelled|canceled/.test(value)) return 'is-blocked';
      if (/running|in_progress|claimed/.test(value)) return 'is-running';
      if (/done|success|passed|completed/.test(value)) return 'is-success';
      return 'is-pending';
    },

    forbiddenCommandText(project) {
      const commands = [
        ...(project?.forbiddenCommands || []),
        'pnpm lint:ts',
        'vue-tsc --noEmit',
        'pnpm tsc --noEmit',
        'nuxi typecheck',
        'pnpm build:local'
      ];
      return [...new Set(commands)].join('、');
    },

    bugDisplayTitle(bug) {
      return [bug.bugNo, bug.title].filter(Boolean).join(' ');
    },

    businessTaskStages(task) {
      const latestRun = task?.latestRun || this.runsForTask(task || {})[0] || null;
      const runStages = (latestRun?.stages || []).filter(stage => stage?.name);
      if (runStages.length) {
        return runStages.map((stage, index) => ({
          name: stage.name || `阶段 ${index + 1}`,
          status: this.displayStageStatusFromRun(stage.status, latestRun),
          source: 'run'
        }));
      }
      return normalizeTaskStageChecks(task.stageChecks);
    },

    displayStageStatusFromRun(stageStatus = '', run = {}) {
      if (run?.workflow === 'custom-workflow') return stageStatus || 'pending';
      if (/pending|created|queued|wait/i.test(stageStatus || '') && this.hasRunExecuted(run) && !this.isRunInProgress(run)) {
        const result = this.effectiveResultStatus(run);
        if (result === 'failed' || result === 'blocked') return 'skipped';
        if (result === 'conditional_pass') return 'conditional_pass';
        if (result === 'passed') return 'passed';
      }
      return stageStatus || 'pending';
    },

    platformStatusForTask(latestRun, reviews = []) {
      if (!latestRun) return 'pending';
      const latestReview = Array.isArray(reviews) ? reviews[0] : null;
      if (latestReview) {
        if (latestReview.needsRework || latestReview.decision === 'rejected') return 'rework';
        if (latestReview.decision === 'approved') return 'accepted';
        if (latestReview.decision === 'conditional') return 'conditional_accepted';
      }
      const status = latestRun.status || '';
      if (/running/.test(status)) return 'in_progress';
      if (/pending/.test(status)) return 'pending';
      if (/conditional/.test(status)) return 'conditional';
      if (/passed|success|done/.test(status)) return 'passed';
      if (/failed/.test(status)) return 'failed';
      if (/cancelled|canceled|blocked/.test(status)) return 'blocked';
      return 'pending';
    },

    taskQualityMetrics(task, relatedRuns = [], platformStatus = '') {
      const relatedBugs = this.bugsForTask(task);
      const reviews = this.reviewsForTask(task);
      const latestReview = reviews[0] || null;
      const stageCompletion = this.taskStageCompletion(task, relatedRuns);
      const stageQualityScore = this.taskStageQualityScore(task, relatedRuns);
      const latestRun = relatedRuns[0] || null;
      const executed = relatedRuns.length > 0;
      const manualReworkCount = reviews.filter(review => review.needsRework || review.decision === 'rejected').length;
      const reworkCount = Math.max(0, relatedRuns.length - 1) + manualReworkCount;
      const bugCount = Math.max(relatedBugs.length, latestReview?.bugCount || 0);
      const criticalBugCount = Math.max(
        relatedBugs.filter(bug => this.isCriticalBug(bug)).length,
        latestReview?.criticalBugCount || 0
      );
      const durationMs = latestRun ? this.runDurationMs(latestRun) : 0;
      const evidenceScore = latestRun?.resultSummary || latestRun?.changeSummary ? 10 : executed ? 5 : 0;
      const statusScore = this.qualityStatusScore(platformStatus, latestRun);
      const manualScore = latestReview ? Number(latestReview.score || 0) : null;
      const bugPenalty = bugCount * 5 + criticalBugCount * 10;
      const reworkPenalty = reworkCount * 8;
      const autoScore = executed
        ? clampPercent(Math.round(stageQualityScore * 0.35 + statusScore * 0.35 + evidenceScore + 20 - bugPenalty - reworkPenalty))
        : 0;
      const aiScore = latestReview
        ? clampPercent(Math.round(manualScore * 0.65 + autoScore * 0.35 - bugPenalty * 0.4 - reworkPenalty * 0.3))
        : autoScore;

      return {
        executed,
        reviewed: Boolean(latestReview),
        aiScore,
        autoScore,
        manualScore,
        latestReview,
        reviewCount: reviews.length,
        stageCompletion,
        stageQualityScore,
        bugCount,
        criticalBugCount,
        reworkCount,
        firstPass: executed && relatedRuns.length === 1 && statusBucket(platformStatus) === 'passed' && !bugCount && !manualReworkCount,
        durationMs,
        durationText: durationMs ? this.formatDuration(durationMs) : '-',
        relatedBugs
      };
    },

    reviewsForTask(task) {
      return this.taskReviews
        .filter(review => review.taskId === task.id || (task.taskNo && review.taskNo === task.taskNo))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    bugsForTask(task) {
      const taskNo = String(task?.taskNo || task?.zentao?.id || '').trim();
      if (!taskNo) return [];
      return this.bugs.filter(bug => String(bug.zentao?.task || bug.taskNo || '').trim() === taskNo);
    },

    taskStageCompletion(task, relatedRuns = []) {
      const stages = relatedRuns.flatMap(run => run.stages || []);
      if (stages.length) {
        const done = stages.filter(stage => this.isStageClosed(stage.status)).length;
        return clampPercent((done / stages.length) * 100);
      }
      const checks = normalizeTaskStageChecks(task.stageChecks);
      const done = checks.filter(stage => this.isStageClosed(stage.status)).length;
      return checks.length ? clampPercent((done / checks.length) * 100) : 0;
    },

    taskStageQualityScore(task, relatedRuns = []) {
      const stages = relatedRuns.flatMap(run => run.stages || []);
      const source = stages.length ? stages : normalizeTaskStageChecks(task.stageChecks);
      if (!source.length) return 0;
      const total = source.reduce((sum, stage) => sum + this.stageQualityPoint(stage.status), 0);
      return clampPercent(total / source.length);
    },

    stageQualityPoint(status = '') {
      const value = String(status || '');
      if (/done|success|passed|completed|通过|完成|✅/.test(value)) return 100;
      if (/conditional|有条件|⚠️/.test(value)) return 70;
      if (/skipped|跳过|⏭️/.test(value)) return 35;
      if (/failed|blocked|error|失败|阻塞|❌/.test(value)) return 0;
      return 0;
    },

    isStageClosed(status = '') {
      return /done|success|passed|completed|conditional|skipped|通过|完成|有条件|跳过|✅|⚠️|⏭️/.test(String(status || ''));
    },

    isCriticalBug(bug) {
      return Number(bug.pri || 0) <= 2 || Number(bug.severity || 0) <= 2 || /线上/i.test(bug.title || '');
    },

    qualityStatusScore(platformStatus, latestRun) {
      const bucket = statusBucket(platformStatus);
      if (bucket === 'passed') return 100;
      if (bucket === 'conditional') return 70;
      if (bucket === 'rework') return 30;
      if (bucket === 'blocked') return 35;
      if (/running/.test(latestRun?.status || '')) return 50;
      return latestRun ? 45 : 0;
    },

    runDurationMs(run) {
      const start = Date.parse(run.startedAt || run.createdAt || '');
      const end = this.isRunInProgress(run) ? this.nowTick : Date.parse(run.finishedAt || run.completedAt || run.updatedAt || '');
      if (!start || !end || end < start) return 0;
      return end - start;
    },

    formatDuration(ms) {
      const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      if (!totalSeconds) return '刚刚开始';
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      if (minutes < 1) return `${seconds}秒`;
      if (minutes < 60) return `${minutes}分钟`;
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
    },

    formatLiveDuration(ms) {
      const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      if (!totalSeconds) return '0秒';
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours) return `${hours}小时${minutes}分${seconds}秒`;
      if (minutes) return `${minutes}分${seconds}秒`;
      return `${seconds}秒`;
    },

    formatClockDuration(ms) {
      const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
    },

    liveRunDurationText(run) {
      if (!run) return '-';
      const duration = this.runDurationMs(run);
      return duration ? this.formatLiveDuration(duration) : '-';
    },

    liveRunClockDurationText(run) {
      return run ? this.formatClockDuration(this.runDurationMs(run)) : '00:00:00';
    },

    runDisplayTime(run = {}) {
      return run.startedAt || run.finishedAt || run.completedAt || run.updatedAt || run.createdAt;
    },

    qualityScoreClass(score) {
      if (score >= 85) return 'good';
      if (score >= 60) return 'warn';
      return 'bad';
    },

    businessTaskStatusLabel(status) {
      return {
        pending: '待执行',
        in_progress: '进行中',
        conditional: '待验收',
        conditional_accepted: '有条件验收',
        accepted: '已验收',
        rework: '驳回',
        passed: '已通过',
        manual_record: '人工记录',
        blocked: '阻塞',
        failed: '失败'
      }[status] || status || '待判定';
    },

    businessTaskStatusClass(status = '') {
      const value = String(status || '').toLowerCase();
      if (/blocked|failed|rework|阻塞|失败|驳回/.test(value)) return 'status-danger';
      if (/in_progress|running|doing|进行/.test(value)) return 'status-active';
      if (/pause|paused|暂停/.test(value)) return 'status-pending';
      if (/conditional|accepted|review|验收/.test(value)) return 'status-review';
      if (/passed|done|success|完成|通过/.test(value)) return 'status-done';
      if (/pending|wait|todo|待执行|未开始/.test(value)) return 'status-pending';
      return 'status-muted';
    },

    zentaoStatusClass(status = '') {
      const value = String(status || '').toLowerCase();
      if (/pause|paused|暂停/.test(value)) return 'status-pending';
      if (/doing|running|进行/.test(value)) return 'status-active';
      if (/testing|验收|测试/.test(value)) return 'status-review';
      if (/done|closed|完成|关闭/.test(value)) return 'status-done';
      if (/cancel|取消/.test(value)) return 'status-muted';
      if (/wait|pending|未开始/.test(value)) return 'status-pending';
      return 'status-muted';
    },

    businessTaskStatusHint(task = {}) {
      if (!['conditional', 'conditional_accepted', 'rework'].includes(task.platformStatus)) return '';
      if (task.platformStatus === 'conditional_accepted') return task.quality?.latestReview?.comment || '人工已做有条件验收，仍需关注备注中的风险或后续事项。';
      if (task.platformStatus === 'rework') return task.quality?.latestReview?.comment || '人工验收未通过，需要再次执行或人工处理。';
      const summary = task.latestRun?.resultSummary || {};
      return summary.nextStep || summary.blockerReason || summary.summary || 'AI 已完成交付，但仍需要人工验收或确认剩余风险。';
    },

    zentaoStatusLabel(status) {
      return {
        wait: '未开始',
        doing: '进行中',
        pause: '已暂停',
        done: '已完成',
        closed: '已关闭',
        cancel: '已取消',
        cancelled: '已取消',
        testing: '测试中'
      }[status] || status || '-';
    },

    zentaoStatusTagType(status = '') {
      if (/doing/.test(status)) return 'primary';
      if (/wait|pause/.test(status)) return 'warning';
      if (/testing/.test(status)) return 'success';
      if (/cancel|closed/.test(status)) return 'info';
      if (/done/.test(status)) return 'success';
      return 'info';
    },

    bugStatusLabel(status = '') {
      return {
        active: '激活',
        pending_close: '待关闭',
        resolved: '待关闭',
        delay: '延期',
        closed: '已关闭'
      }[status] || status || '-';
    },

    bugStatusTagType(status = '') {
      if (/active|opened|delay/i.test(status)) return 'warning';
      if (/pending_close|resolved|fixed|done/i.test(status)) return 'danger';
      if (/closed/i.test(status)) return 'info';
      return 'info';
    },

    bugSeverityTagType(value = '') {
      const level = Number(value || 0);
      if (level && level <= 2) return 'danger';
      if (level === 3) return 'warning';
      return 'info';
    },

    bugPriorityTagType(value = '') {
      const level = Number(value || 0);
      if (level && level <= 2) return 'danger';
      if (level === 3) return 'warning';
      return 'info';
    },

    deadlineState(deadline = '') {
      if (!deadline) return 'none';
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const due = new Date(`${deadline}T00:00:00`);
      if (Number.isNaN(due.getTime())) return 'none';
      const diffDays = Math.round((due - today) / 86400000);
      if (diffDays < 0) return 'overdue';
      if (diffDays <= 2) return 'soon';
      return 'normal';
    },

    stageStatusTagType(status = '') {
      const value = String(status || '').toLowerCase();
      if (/条件|conditional/.test(value)) return 'warning';
      if (/完成|通过|done|success|passed|completed/.test(value)) return 'success';
      if (/问题|阻塞|失败|failed|error|blocked/.test(value)) return 'danger';
      if (/跳过|skipped|skip/.test(value)) return 'info';
      if (/已进入|进行|running|in_progress/.test(value)) return 'primary';
      return 'info';
    },

    businessStageStatusClass(status = '') {
      const value = String(status || '').toLowerCase();
      if (/条件|conditional/.test(value)) return 'is-conditional';
      if (/完成|通过|done|success|passed|completed/.test(value)) return 'is-success';
      if (/问题|阻塞|失败|failed|error|blocked/.test(value)) return 'is-danger';
      if (/跳过|skipped|skip/.test(value)) return 'is-skipped';
      if (/已进入|进行|running|in_progress/.test(value)) return 'is-running';
      return 'is-pending';
    },

    startSelectedRun() {
      if (!this.selectedRun) return;
      if (this.isRunInProgress(this.selectedRun)) {
        ElMessage.info('当前任务正在执行中');
        return;
      }
      const mode = this.canResumeRun(this.selectedRun) ? 'resume' : this.hasRunExecuted(this.selectedRun) ? 'restart' : 'start';
      return this.confirmStartRun(mode);
    },

    restartSelectedRun() {
      if (!this.selectedRun) return;
      if (this.isRunInProgress(this.selectedRun)) {
        ElMessage.info('当前任务正在执行中');
        return;
      }
      return this.confirmStartRun('restart');
    },

    async confirmStartRun(mode = 'start') {
      if (!this.selectedRun) return;
      if (this.isRunInProgress(this.selectedRun)) {
        this.startConfirm.visible = false;
        ElMessage.info('当前任务正在执行中');
        return;
      }
      if (this.startConfirm.submitting) return;
      this.startConfirm.submitting = true;
      const sourceRun = this.selectedRun;
      try {
        this.startConfirm.visible = false;
        const runId = sourceRun.id;
        this.patchRun(runId, {
          status: 'running',
          resultSummary: null,
          changeSummary: null,
          exitCode: null,
          blocker: null,
          cancelledBy: ''
        });
        this.logText = mode === 'resume' ? '继续执行已启动，保留旧产物并等待新日志输出...' : '执行已启动，等待日志输出...';
        this.runLogCollapse = [];
        this.runLogDrawerVisible = false;
        await this.api(`/api/runs/${encodeURIComponent(runId)}/start`, {
          method: 'POST',
          body: JSON.stringify({ mode })
        });
        this.connectEvents(runId);
        await this.refreshRuns();
      } finally {
        this.startConfirm.submitting = false;
      }
    },

    async cancelSelectedRun() {
      if (!this.selectedRun) return;
      await this.api(`/api/runs/${encodeURIComponent(this.selectedRun.id)}/cancel`, { method: 'POST' });
      await this.refreshRuns();
      ElMessage.info('已发送中断请求');
    },

    async openSelectedRunLogDrawer() {
      if (!this.selectedRun?.id) {
        ElMessage.warning('请先选择一条执行记录');
        return;
      }
      this.runLogDrawerVisible = true;
      if (!this.logText || /默认收起|选择一个任务后查看执行日志/.test(this.logText)) {
        await this.loadSelectedRunLog().catch(() => {});
      }
    },

    async deleteSelectedRun() {
      const run = this.selectedRun;
      if (!run) return;
      if (this.isRunInProgress(run)) {
        ElMessage.warning('任务正在执行，不能删除记录');
        return;
      }
      await ElMessageBox.confirm(
        `确认删除「${this.runGroupTitle(run)}」第 ${this.runAttemptNumber(run)} 次执行记录？平台侧产物目录会一起清理。`,
        '删除执行记录',
        {
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          type: 'warning',
          confirmButtonClass: 'el-button--danger'
        }
      );
      await this.api(`/api/runs/${encodeURIComponent(run.id)}`, { method: 'DELETE' });
      this.runs = this.runs.filter(item => item.id !== run.id);
      this.selectedRunId = this.runs[0]?.id || null;
      if (!this.selectedRunId) {
        this.logText = '选择一个任务后查看执行日志。';
        this.selectedArtifact = null;
        this.artifactPreview = {};
      }
      ElMessage.success('执行记录已删除');
    },

    gitChangeStatusLabel(status = '') {
      const value = String(status || '').trim();
      if (value === '??' || value.includes('A')) return '新增';
      if (value.includes('D')) return '删除';
      if (value.includes('R')) return '重命名';
      if (value.includes('M')) return '修改';
      return value || '变更';
    },

    gitChangeCategoryFromStatus(status = '') {
      const value = String(status || '').trim();
      if (value === '??' || value.includes('A')) return 'added';
      if (value.includes('D')) return 'removed';
      return 'changed';
    },

    runChangeItemLabel(item = {}) {
      if (item.changeCategory === 'added') return '新增';
      if (item.changeCategory === 'removed') return '删除';
      if (item.changeCategory === 'changed') return '修改';
      return this.gitChangeStatusLabel(item.status);
    },

    runChangeItemTagType(item = {}) {
      if (item.changeCategory === 'added') return 'success';
      if (item.changeCategory === 'removed') return 'danger';
      if (item.changeCategory === 'changed') return 'primary';
      return this.gitChangeStatusType(item.status);
    },

    gitChangeStatusType(status = '') {
      const value = String(status || '').trim();
      if (value === '??' || value.includes('A')) return 'success';
      if (value.includes('D')) return 'danger';
      if (value.includes('R')) return 'warning';
      if (value.includes('M')) return 'primary';
      return 'info';
    },

    connectEvents(runId) {
      if (this.eventSource) this.eventSource.close();
      this.logText = '';
      const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
      this.eventSource = source;
      source.onmessage = event => {
        const payload = JSON.parse(event.data);
        if (payload.text) {
          this.logText = trimRunLogBuffer(this.logText + payload.text);
          this.logPulse += 1;
        }
        if (payload.message) {
          this.logText = trimRunLogBuffer(`${this.logText}\n[${payload.type}] ${payload.message}\n`);
          this.logPulse += 1;
        }
        if (payload.status) this.patchRun(runId, { status: payload.status, exitCode: payload.exitCode });
        if (payload.type === 'stage') this.patchRun(runId, { stages: payload.stages, currentStage: payload.currentStage });
        if (payload.changeSummary) this.patchRun(runId, { changeSummary: payload.changeSummary });
        if (payload.resultSummary) this.patchRun(runId, { resultSummary: payload.resultSummary });
        if (payload.type === 'done') {
          source.close();
          this.runLogCollapse = [];
          this.refreshRuns();
        }
      };
    },

    patchRun(runId, patch) {
      this.runs = this.runs.map(run => run.id === runId ? { ...run, ...patch } : run);
    },

    async loadSelectedRunLog() {
      const run = this.selectedRun;
      if (!run?.id) {
        this.logText = '选择一个任务后查看执行日志。';
        return;
      }
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/log?tailBytes=${RUN_LOG_FETCH_TAIL_BYTES}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        this.logText = trimRunLogBuffer(text || (run.status === 'running' ? '执行中，暂无日志输出。' : '暂无日志。'));
      } catch {
        this.logText = run.status === 'running' ? '执行中，日志暂未可读。' : '日志读取失败。';
      }
    },

    async openRunFileDiff(item) {
      if (!this.selectedRun || !item?.path) return;
      try {
        const query = `?file=${encodeURIComponent(item.path)}`;
        const result = await this.api(`/api/runs/${encodeURIComponent(this.selectedRun.id)}/diff${query}`);
        if (result.mode === 'directory') {
          const files = String(result.content || '')
            .split(/\r?\n/)
            .map(path => path.trim())
            .filter(Boolean);
          this.expandDirectoryChangeItem(item, files);
          ElMessage.info('已展开目录内文件');
          return;
        }
        const rows = result.mode === 'diff'
          ? this.buildSideBySideDiffRows(result.oldContent || '', result.newContent || '', result.changeType || '')
          : [];
        const diffIndexes = [...new Set(rows.filter(row => row.type !== 'same').map(row => row.diffIndex))];
        this.runDiffPreview = {
          visible: true,
          file: result.file || item.path,
          status: result.status || item.status || '',
          changeType: result.changeType || '',
          mode: result.mode || 'diff',
          content: result.content || '',
          oldImageUrl: result.mode === 'image' && result.oldAvailable ? this.runFilePreviewUrl(result.file || item.path, 'head') : '',
          newImageUrl: result.mode === 'image' && result.newAvailable ? this.runFilePreviewUrl(result.file || item.path, 'current') : '',
          oldContent: result.oldContent || '',
          newContent: result.newContent || '',
          rows,
          diffIndexes,
          currentDiffIndex: 0
        };
      } catch (error) {
        ElMessage.error(error.message || '文件对比打开失败');
      }
    },

    runFilePreviewUrl(file, version = 'current') {
      if (!this.selectedRun?.id || !file) return '';
      const query = new URLSearchParams({ file, version });
      return `/api/runs/${encodeURIComponent(this.selectedRun.id)}/file-preview?${query.toString()}`;
    },

    expandDirectoryChangeItem(item, files = []) {
      if (!this.selectedRun || !item?.path || !files.length) return;
      const expandedItems = files.map(file => ({
        ...item,
        path: file,
        parentPath: item.path,
        changeCategory: item.changeCategory || this.gitChangeCategoryFromStatus(item.status)
      }));
      const expandList = list => (list || []).flatMap(entry => entry.path === item.path ? expandedItems : [entry]);
      const nextSummary = {
        ...this.selectedRun.changeSummary,
        after: expandList(this.selectedRun.changeSummary?.after),
        added: expandList(this.selectedRun.changeSummary?.added),
        changed: expandList(this.selectedRun.changeSummary?.changed),
        removed: expandList(this.selectedRun.changeSummary?.removed)
      };
      this.patchRun(this.selectedRun.id, { changeSummary: nextSummary });
    },

    jumpRunDiff(direction) {
      const total = this.runDiffPreview.diffIndexes?.length || 0;
      if (!total) return;
      const offset = direction === 'prev' ? -1 : 1;
      const nextIndex = this.runDiffPreview.currentDiffIndex + offset;
      if (nextIndex < 0 || nextIndex >= total) return;
      this.runDiffPreview.currentDiffIndex = nextIndex;
    },

    highlightDiffCode(value = '') {
      const source = String(value ?? '');
      if (!source) return '';
      const tokenPattern = /(\/\/.*$|\/\*[\s\S]*?\*\/|(['"`])(?:\\.|(?!\2).)*\2|\b(?:import|export|from|type|interface|const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|extends|implements|async|await|try|catch|finally|throw|as|any|string|number|boolean|void|unknown|Record|Router)\b|\b(?:true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/gm;
      const parts = [];
      let cursor = 0;
      for (const match of source.matchAll(tokenPattern)) {
        const index = match.index ?? 0;
        if (index > cursor) parts.push(escapeHtml(source.slice(cursor, index)));
        const token = match[0];
        parts.push(`<span class="${diffTokenClass(token)}">${escapeHtml(token)}</span>`);
        cursor = index + token.length;
      }
      if (cursor < source.length) parts.push(escapeHtml(source.slice(cursor)));
      return parts.join('');
    },

    buildSideBySideDiffRows(oldContent = '', newContent = '', changeType = '') {
      const oldLines = String(oldContent || '').split(/\r?\n/);
      const newLines = String(newContent || '').split(/\r?\n/);
      if (oldLines.at(-1) === '') oldLines.pop();
      if (newLines.at(-1) === '') newLines.pop();
      if (changeType === 'deleted') {
        const rows = oldLines.map((oldText, index) => ({
          type: 'removed',
          oldLine: index + 1,
          newLine: '',
          oldText,
          newText: '',
          diffIndex: 0
        }));
        rows.push({
          type: 'removed',
          oldLine: '',
          newLine: '',
          oldText: '',
          newText: '',
          note: '文件已删除，右侧没有新内容。',
          diffIndex: 0
        });
        return rows.map((row, index) => ({ ...row, no: index + 1 }));
      }
      const matrix = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));
      for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
        for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
          matrix[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
            ? matrix[oldIndex + 1][newIndex + 1] + 1
            : Math.max(matrix[oldIndex + 1][newIndex], matrix[oldIndex][newIndex + 1]);
        }
      }

      const rows = [];
      let diffIndex = -1;
      let previousType = 'same';
      let oldIndex = 0;
      let newIndex = 0;
      let oldLine = 1;
      let newLine = 1;
      while (oldIndex < oldLines.length || newIndex < newLines.length) {
        const oldText = oldLines[oldIndex];
        const newText = newLines[newIndex];
        let row;
        if (oldIndex < oldLines.length && newIndex < newLines.length && oldText === newText) {
          row = { type: 'same', oldLine, newLine, oldText, newText };
          oldIndex += 1;
          newIndex += 1;
          oldLine += 1;
          newLine += 1;
        } else if (oldIndex < oldLines.length && newIndex < newLines.length && matrix[oldIndex + 1][newIndex] === matrix[oldIndex][newIndex + 1]) {
          row = { type: 'changed', oldLine, newLine, oldText, newText };
          oldIndex += 1;
          newIndex += 1;
          oldLine += 1;
          newLine += 1;
        } else if (newIndex < newLines.length && (oldIndex >= oldLines.length || matrix[oldIndex][newIndex + 1] >= matrix[oldIndex + 1][newIndex])) {
          row = { type: 'added', oldLine: '', newLine, oldText: '', newText };
          newIndex += 1;
          newLine += 1;
        } else {
          row = { type: 'removed', oldLine, newLine: '', oldText, newText: '' };
          oldIndex += 1;
          oldLine += 1;
        }
        if (row.type !== 'same' && previousType === 'same') diffIndex += 1;
        if (row.type !== 'same') row.diffIndex = diffIndex;
        previousType = row.type;
        rows.push(row);
      }
      return rows.map((row, index) => ({ ...row, no: index + 1 }));
    },

    prepareTaskResult(task) {
      this.selectedTask = task;
      this.selectedStageNo = task.audit?.stages?.[0]?.no || null;
      this.selectedReviewKey = '';
      this.selectedReport = null;
      this.selectedReportHtml = '';
      this.selectedImage = this.visibleAuditImages[0] || null;
      this.auditTab = 'overview';
      const firstReport = [...(task.audit?.reports || [])].sort(compareReportsByStage)[0];
      if (firstReport) this.openAuditReport(firstReport, false);
    },

    openTaskAudit(task, artifact = null) {
      this.prepareTaskResult(task);
      if (artifact) {
        if (this.artifactTypeFromPath(artifact.path || artifact.relativePath || artifact.name) === 'image') {
          this.openAuditImage(artifact);
        } else {
          this.openAuditReport(artifact);
        }
      }
      this.pushRoute(`/projects/${encodeURIComponent(this.selectedProjectId)}/tasks/${encodeURIComponent(task.path)}/result`);
    },

    openArchiveTaskResult(task) {
      const artifactTask = this.findArtifactTaskForArchiveTask(task);
      if (!artifactTask) {
        ElMessage.warning('当前任务还没有扫描到产物');
        return;
      }
      this.selectedProjectId = artifactTask.projectId;
      this.openTaskAudit(artifactTask);
    },

    findArtifactTaskForArchiveTask(task) {
      if (!task) return null;
      const relatedRuns = this.runsForTask(task);
      const runRoots = relatedRuns
        .map(run => this.normalizeArtifactPath(run.artifactRoot || run.materialPath || ''))
        .filter(Boolean);
      return this.taskRows.find(row => {
        if (row.projectId !== task.projectId) return false;
        if (task.taskNo && row.zentaoId === task.taskNo) return true;
        const latestRoot = this.normalizeArtifactPath(row.latestRunRoot || row.artifactRoot || '');
        return latestRoot && runRoots.some(root => latestRoot.includes(root) || root.includes(latestRoot));
      }) || null;
    },

    openManualReview(item) {
      if (!this.selectedTask || !this.selectedStage) return;
      this.selectedReviewKey = item.key;
      this.manualReviewForm = { decision: 'approved', comment: '', score: 80 };
      const query = new URLSearchParams({
        stage: String(this.selectedStage.no),
        review: item.key
      });
      this.pushRoute(`/projects/${encodeURIComponent(this.selectedProjectId)}/tasks/${encodeURIComponent(this.selectedTask.path)}/review?${query.toString()}`);
    },

    openStageSummaryReview(check = {}) {
      if (check.action !== 'review') return;
      const reviewItem = this.selectedStageReview.find(item => item.key === check.reviewKey)
        || this.selectedStageReview.find(item => item.status !== 'ready')
        || this.selectedReviewItem;
      if (reviewItem) this.openManualReview(reviewItem);
    },

    async submitManualReview() {
      if (!this.selectedTask || !this.selectedReviewItem) return;
      if (!String(this.manualReviewForm.comment || '').trim()) {
        ElMessage.warning('请填写复核说明，说明为什么通过、驳回或接受风险');
        return;
      }
      const decisionMap = {
        approved: 'approved',
        rejected: 'rejected',
        accepted_risk: 'conditional'
      };
      const record = {
        id: `${Date.now()}`,
        projectId: this.selectedProjectId,
        taskId: this.selectedTask.id,
        taskNo: this.selectedTask.zentaoId || this.selectedTask.taskNo || '',
        runId: this.selectedTaskLatestRun?.id || '',
        taskPath: this.selectedTask.path,
        stageNo: this.selectedStage?.no || '',
        stageName: this.selectedStage?.name || '',
        reviewKey: this.selectedReviewItem.key,
        reviewLabel: this.selectedReviewItem.label,
        decision: this.manualReviewForm.decision,
        score: Number(this.manualReviewForm.score || 80),
        comment: this.manualReviewForm.comment,
        createdAt: new Date().toISOString()
      };
      this.manualReviewRecords = [record, ...this.manualReviewRecords];
      if (record.runId) {
        await this.api('/api/task-reviews', {
          method: 'POST',
          body: JSON.stringify({
            projectId: record.projectId,
            taskId: record.taskId,
            taskNo: record.taskNo,
            runId: record.runId,
            decision: decisionMap[record.decision] || 'approved',
            score: record.score,
            requirementScore: record.score,
            qualityScore: record.score,
            uiScore: record.score,
            validationScore: record.score,
            bugCount: 0,
            criticalBugCount: 0,
            needsRework: record.decision === 'rejected',
            comment: `[${record.stageName} / ${record.reviewLabel}] ${record.comment}`,
            reviewer: '阶段人工复核'
          })
        });
        await this.refreshTaskReviews();
        await this.loadTasks();
      }
      ElMessage.success(record.decision === 'rejected' ? '复核已提交，任务已标记返工' : '复核已提交，任务验收状态已更新');
    },

    manualReviewRecordFor(item) {
      return this.taskManualReviewRecords.find(record => record.reviewKey === item.key);
    },

    openManualReviewRecord(record) {
      const stage = this.auditStages.find(item => String(item.no) === String(record.stageNo));
      if (stage) this.selectedStageNo = stage.no;
      this.selectedReviewKey = record.reviewKey;
      this.manualReviewForm = {
        decision: record.decision,
        comment: record.comment || '',
        score: record.score || 80
      };
      this.pushRoute(`/projects/${encodeURIComponent(this.selectedProjectId)}/tasks/${encodeURIComponent(record.taskPath)}/review?${new URLSearchParams({
        stage: String(record.stageNo || ''),
        review: record.reviewKey
      }).toString()}`);
    },

    manualReviewDecisionLabel(decision) {
      return {
        approved: '人工已通过',
        rejected: '驳回补充',
        accepted_risk: '风险接受'
      }[decision] || '待复核';
    },

    manualReviewDecisionTagType(decision) {
      return {
        approved: 'success',
        rejected: 'danger',
        accepted_risk: 'warning'
      }[decision] || 'info';
    },

    async openTaskFromRow(task) {
      if (task.projectId && task.projectId !== this.selectedProjectId) {
        const project = this.projects.find(item => item.id === task.projectId);
        if (project) await this.selectProject(project);
      }
      this.openTaskAudit(task);
    },

    async openAuditReport(report, switchTab = true) {
      const resolvedReport = {
        ...report,
        path: this.resolveTaskArtifactPath(report.path || report.relativePath || report.name || ''),
        relativePath: report.relativePath || this.normalizeArtifactPath(report.path || '')
      };
      this.selectedReport = resolvedReport;
      if (switchTab) this.auditTab = 'reports';
      const requestId = this.reportRequestId + 1;
      this.reportRequestId = requestId;
      this.selectedReportHtml = '<div class="empty-block">正在读取报告...</div>';
      try {
        const response = await fetch(this.artifactUrl(resolvedReport.path));
        if (!response.ok) {
          const message = await response.text();
          throw new Error(`读取接口失败 ${response.status}：${message.slice(0, 120)}`);
        }
        const markdown = await response.text();
        let html = '';
        try {
          html = this.renderMarkdown(markdown, resolvedReport.path);
        } catch (error) {
          throw new Error(`内容渲染失败：${error.message || error}`);
        }
        if (this.reportRequestId === requestId && this.selectedReport?.path === resolvedReport.path) {
          this.selectedReportHtml = html;
        }
      } catch (error) {
        if (this.reportRequestId === requestId && this.selectedReport?.path === resolvedReport.path) {
          this.selectedReportHtml = `<div class="empty-block">报告打开失败：${escapeHtml(error.message || error)}<br>${escapeHtml(resolvedReport.relativePath || resolvedReport.name || '未知报告')}</div>`;
        }
      }
    },

    openAuditImage(image) {
      this.selectedImage = image;
      this.auditTab = 'images';
      const record = this.imageReviewRecords[image.path];
      this.imageReviewForm = record
        ? { decision: record.decision, comment: record.comment }
        : { decision: 'passed', comment: '' };
    },

    handleReportContentClick(event) {
      const target = event.target.closest('[data-artifact-path]');
      if (!target) return;
      const path = target.dataset.artifactPath;
      if (path) this.openArtifactByPath(path);
    },

    openArtifactByPath(path) {
      const artifact = this.findArtifactByPath(path) || this.createArtifactFromPath(path);
      if (artifact.type === 'image') {
        this.openImageEvidenceByPath(path, artifact);
        return;
      }
      if (artifact.type === 'report') {
        this.openAuditReport(artifact);
        return;
      }
      this.openRawArtifact(artifact);
    },

    openImageEvidenceByPath(path, fallbackArtifact = null) {
      const image = this.findImageEvidenceByPath(path) || fallbackArtifact;
      if (!image) return;
      this.selectedArtifact = null;
      this.artifactPreview = {};
      this.openAuditImage(image);
    },

    findImageEvidenceByPath(path) {
      const normalized = this.normalizeArtifactPath(path);
      return (this.auditImages || []).find(image => {
        const candidates = [image.path, image.relativePath, image.name].filter(Boolean).map(item => this.normalizeArtifactPath(item));
        return candidates.includes(normalized) || candidates.some(item => item.endsWith(`/${normalized}`) || normalized.endsWith(`/${item}`));
      });
    },

    findArtifactByPath(path) {
      const normalized = this.normalizeArtifactPath(path);
      const all = [
        ...(this.auditReports || []),
        ...(this.auditImages || [])
      ];
      return all.find(artifact => {
        const candidates = [artifact.path, artifact.relativePath, artifact.name].filter(Boolean).map(item => this.normalizeArtifactPath(item));
        return candidates.includes(normalized) || candidates.some(item => item.endsWith(`/${normalized}`) || normalized.endsWith(`/${item}`));
      });
    },

    createArtifactFromPath(path) {
      const absPath = this.resolveTaskArtifactPath(path);
      return {
        path: absPath,
        relativePath: path,
        name: path.split('/').pop() || path,
        type: this.artifactTypeFromPath(path)
      };
    },

    resolveTaskArtifactPath(path) {
      const safePath = this.platformArtifactRequestPath(path);
      if (/^https?:\/\//.test(safePath)) return safePath;
      if (safePath.startsWith('workspace/')) return safePath;
      if (safePath.startsWith('platform-artifacts/')) {
        return safePath.replace(/^platform-artifacts\//, 'workspace/artifacts/');
      }
      const artifactRoot = this.platformArtifactRequestPath(this.selectedTask?.latestRunRoot || this.selectedTask?.artifactRoot || '');
      if (artifactRoot) {
        const base = artifactRoot.replace(/\/+$/, '');
        const child = safePath.replace(/^\/+/, '');
        return `${base}/${child}`.replaceAll('/./', '/');
      }
      const taskPath = this.selectedTask?.path || '';
      if (safePath.startsWith('.task/')) {
        const suffix = safePath.replace(/^\.task\/?/, '');
        return `workspace/artifacts/${suffix}`.replaceAll('/./', '/');
      }
      if (taskPath) return `${taskPath}/${safePath}`.replaceAll('/./', '/');
      return safePath;
    },

    platformArtifactRequestPath(path = '') {
      const input = String(path || '').trim().replaceAll('\\', '/');
      if (!input) return '';
      if (/^https?:\/\//.test(input)) return input;
      const normalized = input
        .replace(/^.*?\/workspace\/artifacts\//, 'workspace/artifacts/')
        .replace(/^.*?\/workspace\/([0-9a-f-]{36}\/.+)$/i, 'workspace/$1')
        .replace(/^.*?\.task\//, '.task/')
        .replace(/^\.\//, '');
      return normalized
        .replace(/^platform-artifacts\//, 'workspace/artifacts/')
        .replace(/\/{2,}/g, '/');
    },

    normalizeArtifactPath(path = '') {
      return String(path)
        .replace(/^.*?\.task\//, '.task/')
        .replace(/^.*?workspace\/artifacts\//, 'platform-artifacts/')
        .replace(/^\.\//, '');
    },

    artifactTypeFromPath(path = '') {
      if (/\.(png|jpg|jpeg|webp)$/i.test(path)) return 'image';
      if (/\.(md|markdown)$/i.test(path)) return 'report';
      if (/\.(json|csv)$/i.test(path)) return 'data';
      if (/\.(ts|vue|js|cjs|mjs)$/i.test(path)) return 'code';
      return 'text';
    },

    zentaoTaskUrl(task) {
      const rawUrl = task?.zentao?.taskUrl || task?.zentaoUrl || task?.taskUrl || '';
      if (rawUrl) return rawUrl;
      const id = this.zentaoTaskId(task);
      if (!id) return '';
      const base = this.appConfig.zentaoBaseUrl || 'https://cd.baa360.cc:20088/index.php';
      const url = new URL(base.endsWith('/index.php') ? base : `${base.replace(/\/$/, '')}/index.php`);
      url.searchParams.set('m', 'task');
      url.searchParams.set('f', 'view');
      url.searchParams.set('taskID', id);
      return url.toString();
    },

    zentaoBugUrl(bug) {
      const rawUrl = bug?.zentao?.url || bug?.zentao?.bugUrl || bug?.bugUrl || bug?.zentaoUrl || '';
      if (rawUrl) return rawUrl;
      const id = bug?.bugNo || bug?.zentao?.id || '';
      if (!id) return '';
      const base = this.appConfig.zentaoBaseUrl || 'https://cd.baa360.cc:20088/index.php';
      const url = new URL(base.endsWith('/index.php') ? base : `${base.replace(/\/$/, '')}/index.php`);
      url.searchParams.set('m', 'bug');
      url.searchParams.set('f', 'view');
      url.searchParams.set('bugID', id);
      return url.toString();
    },

    bugAssigneeName(bug) {
      return bug?.developer || bug?.assignedToName || bug?.zentao?.assignedToName || bug?.assignedTo || bug?.zentao?.assignedTo || '未分配';
    },

    zentaoTaskId(task) {
      if (!task) return '';
      const candidates = [task.zentaoId, task.taskNo, task.id, task.name, task.title, task.path];
      for (const value of candidates) {
        const matched = String(value || '').match(/\b\d{4,8}\b/);
        if (matched) return matched[0];
      }
      return '';
    },

    artifactTypeLabel(path = '') {
      return {
        image: '图片',
        report: '报告',
        data: '数据',
        code: '代码',
        text: '文本'
      }[this.artifactTypeFromPath(path)] || '文件';
    },

    artifactNameFromPath(path = '') {
      return String(path).split('/').filter(Boolean).pop() || path || '-';
    },

    artifactDirFromPath(path = '') {
      const parts = String(path).split('/').filter(Boolean);
      parts.pop();
      return parts.length ? parts.join('/') : '根目录';
    },

    async openRawArtifact(artifact) {
      this.selectedArtifact = artifact;
      const response = await fetch(this.artifactUrl(artifact.path));
      const text = await response.text();
      this.artifactPreview = this.markdownPreviewForArtifact(artifact, text);
    },

    markdownPreviewForArtifact(artifact, text) {
      if (this.artifactTypeFromPath(artifact.path || artifact.relativePath || artifact.name) === 'report') {
        return { type: 'markdown', html: this.renderMarkdown(text, this.resolveTaskArtifactPath(artifact.path || artifact.relativePath || '')) };
      }
      return { type: 'text', text };
    },

    imageEvidenceGroupKey(image = {}) {
      const haystack = `${image.evidenceType || ''}\n${image.name || ''}\n${image.relativePath || ''}\n${image.reviewFocus || ''}\n${image.meaning || ''}`;
      if (/comparison|diff|对比|差异/i.test(haystack)) return 'comparison';
      if (/error|failed|异常|问题|白屏|遮挡|溢出/i.test(haystack)) return 'issue';
      if (/compat|H5|375|812|theme|兼容|主题/i.test(haystack)) return 'compat';
      if (/关键|重点|目标|交互|页面/i.test(haystack)) return 'key';
      return 'raw';
    },

    imageEvidenceGroupLabel(image) {
      return {
        comparison: '对比图',
        issue: '异常截图',
        compat: '兼容截图',
        key: '关键截图',
        raw: '原始截图'
      }[this.imageEvidenceGroupKey(image)] || '图片证据';
    },

    imageEvidencePriority(image) {
      return {
        comparison: 0,
        issue: 1,
        compat: 2,
        key: 3,
        raw: 4
      }[this.imageEvidenceGroupKey(image)] ?? 5;
    },

    imageEvidenceStatus(image) {
      const record = this.imageReviewRecords[image.path];
      if (record?.decision === 'passed') return '已通过';
      if (record?.decision === 'failed') return '有问题';
      if (record?.decision === 'ignored') return '不适用';
      return this.imageEvidenceGroupKey(image) === 'issue' ? '待确认' : '待复核';
    },

    imageEvidenceTagType(image) {
      const status = this.imageEvidenceStatus(image);
      if (status === '已通过') return 'success';
      if (status === '有问题') return 'danger';
      if (status === '不适用') return 'info';
      return 'warning';
    },

    imageDecisionLabel(decision) {
      return {
        passed: '已通过',
        failed: '有问题',
        ignored: '不适用'
      }[decision] || '待复核';
    },

    imageDecisionTagType(decision) {
      return {
        passed: 'success',
        failed: 'danger',
        ignored: 'info'
      }[decision] || 'warning';
    },

    openImageReviewRecord(record) {
      const image = this.auditImages.find(item => item.path === record.imagePath);
      if (image) this.openAuditImage(image);
    },

    submitImageReview() {
      if (!this.can('review.image.submit')) {
        ElMessage.warning('当前角色没有保存图片复核的权限');
        return;
      }
      if (!this.selectedImage) return;
      this.imageReviewRecords = {
        ...this.imageReviewRecords,
        [this.selectedImage.path]: {
          imagePath: this.selectedImage.path,
          imageTitle: this.selectedImage.title || this.selectedImage.name,
          decision: this.imageReviewForm.decision,
          comment: this.imageReviewForm.comment,
          createdAt: new Date().toISOString()
        }
      };
      ElMessage.success('图片结论已保存');
    },

    artifactUrl(path) {
      return `/api/artifact?path=${encodeURIComponent(this.platformArtifactRequestPath(path))}`;
    },

    artifactDisplayTitle(artifact = {}) {
      const rawName = String(artifact.name || artifact.relativePath || artifact.path || '').split('/').pop() || '报告文件';
      const baseName = rawName.replace(/\.(md|markdown|png|jpg|jpeg|webp)$/i, '');
      const stage = this.artifactStageLabel(artifact);
      const round = reportRound(artifact);
      const roundLabel = round || baseName.match(/^report-round-(\d+)$/i)?.[1] || '';
      const normalized = baseName
        .replace(/^report-round-(\d+)$/i, '第 $1 轮报告')
        .replace(/^harness-summary$/i, '还原度汇总')
        .replace(/^stage2-report$/i, '设计交接报告')
        .replace(/^阶段执行报告$/i, '阶段执行报告')
        .replace(/^需求清单$/i, '需求清单')
        .replace(/^资料$/i, '任务资料');
      if (/^第 \d+ 轮报告$/.test(normalized)) {
        return stage && stage !== '报告' ? `${stage} · 第 ${roundLabel} 轮报告` : `未分类报告 · ${normalized}`;
      }
      if (normalized !== baseName) return normalized;
      if (/dev-report/i.test(artifact.relativePath || '')) return '质检报告';
      if (/dev-smoke/i.test(artifact.relativePath || '')) return '运行验证报告';
      if (/figma-fidelity/i.test(artifact.relativePath || '')) return '还原度报告';
      return baseName || artifact.stage || '报告文件';
    },

    artifactStageLabel(artifact = {}) {
      const stage = String(artifact.stage || '').trim();
      if (stage) return stage;
      const path = String(artifact.relativePath || artifact.path || '');
      if (/阶段执行报告/i.test(path)) return '阶段执行报告';
      if (/需求清单|资料/.test(path)) return '任务资料';
      if (/(^|\/)figma\//i.test(path)) return 'Figma 资料';
      const meta = reportStageMeta(artifact);
      if (meta?.key && meta.key !== 'other') return meta.title.replace(/^\d+\s*/, '');
      if (/showdoc-model|showdoc-generator/i.test(path)) return '接口模型';
      if (/api-compose/i.test(path)) return '接口联调';
      if (/figma-to-code/i.test(path)) return '页面实现';
      if (/i18n/i.test(path)) return '多语言';
      if (/delivery-report/i.test(path)) return '交付报告';
      if (/dev-report/i.test(path)) return '质检报告';
      if (/code-review/i.test(path)) return '代码审查';
      if (/compat-check/i.test(path)) return '兼容检查';
      if (/dev-smoke/i.test(path)) return '运行验证';
      if (/figma-fidelity/i.test(path)) return '还原度';
      return '报告';
    },

    compactArtifactPath(artifact = {}) {
      const path = String(artifact.relativePath || artifact.path || '');
      const taskPath = path.replace(/^.*?\.task\//, '.task/');
      const parts = taskPath.split('/').filter(Boolean);
      const taskRootIndex = parts.findIndex(part => /^【?\d+/.test(part) || part.includes('开发单') || part.includes('rankTest'));
      const innerParts = taskRootIndex >= 0 ? parts.slice(taskRootIndex + 1) : parts.slice(-2);
      if (!innerParts.length) return parts.slice(-2).join('/');
      if (innerParts.length <= 2) return innerParts.join('/');
      return `.../${innerParts.slice(-2).join('/')}`;
    },

    stageOutputForRunStage(stage = {}) {
      const key = this.stageArtifactKey(stage);
      if (!key) return '';
      const matched = this.auditReports.find(report => {
        const path = String(report.relativePath || report.path || '');
        return path.includes(`/${key}/`) || path.includes(`\\${key}\\`);
      });
      return matched?.relativePath || matched?.path || key;
    },

    stageArtifactKey(stage = {}) {
      const name = String(stage?.name || '');
      if (/需求解析|资料整理|资料/.test(name)) return '';
      if (/ShowDoc|接口模型/.test(name)) return 'showdoc-model';
      if (/接口|联调/.test(name)) return 'api-compose';
      if (/页面|实现/.test(name)) return 'figma-to-code';
      if (/多语言|i18n/i.test(name)) return 'i18n';
      if (/轻量|运行|冒烟/.test(name)) return 'dev-smoke';
      if (/主题|多端|兼容/.test(name)) return 'compat-check';
      if (/Figma|还原/.test(name)) return 'figma-fidelity';
      if (/代码审查|审查/.test(name)) return 'code-review';
      if (/质检|功能质检/.test(name)) return 'dev-report';
      if (/自动修复|修复/.test(name)) return 'auto-fix';
      if (/交付/.test(name)) return 'delivery-report';
      return '';
    },

    artifactsForStage(artifacts, stage) {
      const name = String(stage?.name || '');
      const output = String(stage?.output || '');
      const key = this.stageArtifactKey(stage);
      return (artifacts || []).filter(artifact => {
        const haystack = `${artifact.stage || ''}\n${artifact.relativePath || ''}\n${artifact.name || ''}`;
        return (key && haystack.includes(`/${key}/`)) || stageMatchesArtifact(name, output, haystack);
      });
    },

    summarizeStageAudit(stage, reports, images, review, issues, audit) {
      if (!stage) return { title: '未选择阶段', description: '请选择左侧阶段查看审计摘要。', checks: [] };
      const missing = [];
      if (!reports.length) missing.push('阶段报告');
      if (this.stageNeedsImageEvidence(stage) && !images.length) missing.push('图片证据');
      const pendingReviews = review.filter(item => item.status !== 'ready');
      const severeIssues = issues.filter(issue => /P0|P1/.test(issue.priority));
      const isBlocked = /阻塞|❌|blocked|failed/i.test(stage.status || '') || severeIssues.length > 0;
      const isConditional = /有条件|⚠️|conditional/i.test(stage.status || '') || missing.length > 0 || pendingReviews.length > 0;
      const title = isBlocked
        ? '当前阶段存在阻塞或高优风险'
        : isConditional
          ? '当前阶段可继续，但需要人工复核'
          : '当前阶段证据链完整';
      const description = [
        `${stage.name} 已关联 ${reports.length} 份报告、${images.length} 张图片证据、${review.length} 项复核点。`,
        pendingReviews.length ? `仍有 ${pendingReviews.length} 项复核未完成。` : '人工复核材料已具备。',
        missing.length ? `缺口：${missing.join('、')}。` : '',
        audit.hasRuntimeEvidence ? '全任务已识别运行态证据。' : '全任务运行态证据仍待确认。'
      ].filter(Boolean).join(' ');
      return {
        title,
        description,
        checks: [
          { label: reports.length ? '报告已关联' : '缺报告', status: reports.length ? 'ok' : 'warn' },
          {
            label: images.length ? '截图已关联' : this.stageNeedsImageEvidence(stage) ? '截图待补' : '无需截图',
            status: images.length || !this.stageNeedsImageEvidence(stage) ? 'ok' : 'warn'
          },
          {
            label: pendingReviews.length ? `需人工复核 ${pendingReviews.length}` : '复核材料齐全',
            status: pendingReviews.length ? 'warn action' : 'ok',
            action: pendingReviews.length ? 'review' : '',
            reviewKey: pendingReviews[0]?.key || ''
          },
          { label: severeIssues.length ? `高危风险 ${severeIssues.length}` : '无高优风险', status: severeIssues.length ? 'critical' : 'ok' }
        ]
      };
    },

    reviewForStage(review, stage, audit) {
      const name = String(stage?.name || '');
      if (/需求|资料|ShowDoc|接口/.test(name)) return review.filter(item => ['requirement', 'integration'].includes(item.key));
      if (/运行|主题|兼容|Figma|还原|页面|实现/.test(name)) return review.filter(item => ['runtime', 'requirement'].includes(item.key));
      if (/质检|代码审查|修复/.test(name)) return review.filter(item => ['requirement', 'runtime', 'integration'].includes(item.key));
      if (/交付/.test(name)) return review.filter(item => ['delivery', 'requirement', 'runtime'].includes(item.key));
      return review.length ? review : audit.manualReview || [];
    },

    stageNeedsImageEvidence(stage) {
      return /运行|主题|兼容|Figma|还原|页面|实现|交付|质检/.test(String(stage?.name || ''));
    },

    renderMarkdown(markdown, artifactPath, options = {}) {
      const sourceDir = artifactPath.split('/').slice(0, -1).join('/');
      let content = options.preserveMetadata ? String(markdown || '').replace(/^\uFEFF/, '') : stripMarkdownMetadata(markdown);
      const preservedMetadata = options.preserveMetadata ? content.match(/^(---\s*\r?\n[\s\S]*?\r?\n---)\s*(?:\r?\n|$)/) : null;
      const blocks = preservedMetadata ? [renderMarkdownMetadata(preservedMetadata[1])] : [];
      if (preservedMetadata) content = content.slice(preservedMetadata[0].length);
      const lines = content.split(/\r?\n/);
      let listState = null;
      const closeList = () => {
        if (listState) {
          blocks.push(`</${listState}>`);
          listState = null;
        }
      };
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^```/.test(line.trim())) {
          closeList();
          const codeLines = [];
          index += 1;
          while (index < lines.length && !/^```/.test(lines[index].trim())) {
            codeLines.push(lines[index]);
            index += 1;
          }
          blocks.push(`<pre class="md-code-block"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
          continue;
        }
        if (/^\|.+\|$/.test(line.trim())) {
          closeList();
          const tableLines = [];
          while (index < lines.length && /^\|.+\|$/.test(lines[index].trim())) {
            tableLines.push(lines[index]);
            index += 1;
          }
          index -= 1;
          blocks.push(renderMarkdownTable(tableLines, sourceDir));
          continue;
        }
        if (!line.trim()) {
          closeList();
          blocks.push('');
        }
        else if (/^\s*---+\s*$/.test(line)) {
          closeList();
          blocks.push('<hr>');
        }
        else if (/^#{1,4}\s+/.test(line)) {
          closeList();
          const level = Math.min(4, line.match(/^#+/)?.[0].length || 2);
          blocks.push(`<h${level}>${inlineMarkdown(line.replace(/^#{1,4}\s+/, ''), sourceDir)}</h${level}>`);
        } else if (/^\s*>\s+/.test(line)) {
          closeList();
          blocks.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s+/, ''), sourceDir)}</blockquote>`);
        } else if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
          const ordered = /^\s*\d+\.\s+/.test(line);
          const tag = ordered ? 'ol' : 'ul';
          if (listState !== tag) {
            closeList();
            blocks.push(`<${tag}>`);
            listState = tag;
          }
          blocks.push(`<li>${inlineMarkdown(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''), sourceDir)}</li>`);
        } else {
          closeList();
          blocks.push(`<p>${inlineMarkdown(line, sourceDir)}</p>`);
        }
      }
      closeList();
      return blocks.join('\n') || '<div class="empty-block">报告为空。</div>';
    },

    statusTagType(status = '') {
      if (/blocked|failed|rework|❌|阻塞/.test(status)) return 'danger';
      if (/conditional|待验收|有条件|⚠️|P2/.test(status)) return 'warning';
      if (/accepted|passed|healthy|✅|通过|验收|提测/.test(status)) return 'success';
      if (/running|scanning|in_progress/.test(status)) return 'primary';
      return 'info';
    },

    runTagType(status = '') {
      if (/running/.test(status)) return 'primary';
      if (/done|success|passed/.test(status)) return 'success';
      if (/conditional|有条件/.test(status)) return 'warning';
      if (/blocked|failed|cancelled|阻塞/.test(status)) return 'danger';
      return 'info';
    },

    resultSummaryClass(status = '') {
      const value = String(status || '').toLowerCase();
      if (/blocked|failed|cancelled|阻塞/.test(value)) return 'is-danger';
      if (/conditional|有条件/.test(value)) return 'is-warning';
      if (/done|success|passed/.test(value)) return 'is-success';
      return 'is-info';
    },

    stepStatus(status = '') {
      if (/failed|error|blocked|阻塞|❌/.test(status)) return 'error';
      if (/running/.test(status)) return 'process';
      if (/done|success|passed|通过|✅/.test(status)) return 'success';
      return 'wait';
    },

    statusLabel,
    compactStatus,
    formatBytes,
    formatDateOnly,
    formatDateTime,
    formatDateSecond,

    formatJson(value) {
      if (value === null || value === undefined || value === '') return '';
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    },

    async api(url, options = {}, meta = {}) {
      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      if (response.status === 401 && !meta.allowUnauthorized) {
        this.currentUser = null;
        throw new Error(await response.text());
      }
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },

    async apiWithTimeout(url, options = {}, meta = {}, timeoutMs = 30000) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await this.api(url, { ...options, signal: controller.signal }, meta);
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('请求超时');
        throw error;
      } finally {
        window.clearTimeout(timer);
      }
    },

    readApiError(error) {
      return this.readApiErrorPayload(error).error;
    },

    readApiErrorPayload(error) {
      const message = String(error?.message || '');
      try {
        const parsed = JSON.parse(message);
        return {
          error: parsed.error || message,
          code: parsed.code || '',
          details: parsed.details || null
        };
      } catch {
        return { error: message, code: '', details: null };
      }
    }
  }
}

const REPORT_STAGE_ORDER = [
  {
    key: 'materials',
    title: '01 任务资料',
    keywords: ['阶段执行报告', '需求清单', '资料.md', '需求解析', '资料整理']
  },
  {
    key: 'api-model',
    title: '02 接口模型',
    keywords: ['showdoc-model', 'showdoc-generator', 'showdoc', '接口模型']
  },
  {
    key: 'api-compose',
    title: '03 接口联调',
    keywords: ['api-compose', '接口联调']
  },
  {
    key: 'implementation',
    title: '04 页面实现',
    keywords: ['figma-to-code', '页面实现']
  },
  {
    key: 'i18n',
    title: '05 多语言',
    keywords: ['i18n', 'polyglot', '多语言']
  },
  {
    key: 'runtime',
    title: '06 运行验证',
    keywords: ['dev-smoke', '运行验证']
  },
  {
    key: 'compat',
    title: '07 兼容验证',
    keywords: ['compat-check', '兼容验证', '多主题']
  },
  {
    key: 'fidelity',
    title: '08 还原度验证',
    keywords: ['figma-fidelity', 'harness-summary', '还原度']
  },
  {
    key: 'code-review',
    title: '09 代码审查',
    keywords: ['code-review', '代码审查']
  },
  {
    key: 'quality',
    title: '10 功能质检',
    keywords: ['dev-report', '功能质检', '质检报告']
  },
  {
    key: 'fix',
    title: '11 自动修复',
    keywords: ['auto-fix', 'fix-report', 'round-2', 'round-3', '自动修复']
  },
  {
    key: 'delivery',
    title: '12 交付报告',
    keywords: ['delivery-report', '交付报告', '最终交付']
  },
  {
    key: 'other',
    title: '13 其他报告',
    keywords: []
  }
];

const ARTIFACT_DIR_ORDER = [
  '资料.md',
  '阶段执行报告.md',
  '需求清单.md',
  'showdoc-model',
  'showdoc-generator',
  'api-compose',
  'figma-to-code',
  'i18n',
  'dev-smoke',
  'compat-check',
  'figma-fidelity',
  'code-review',
  'dev-report',
  'auto-fix',
  'delivery-report'
];

function reportStageMeta(report = {}) {
  const haystack = `${report.stage || ''}\n${report.relativePath || ''}\n${report.path || ''}\n${report.name || ''}`.toLowerCase();
  return REPORT_STAGE_ORDER.find(stage => stage.key !== 'other' && stage.keywords.some(keyword => haystack.includes(String(keyword).toLowerCase())))
    || REPORT_STAGE_ORDER[REPORT_STAGE_ORDER.length - 1];
}

function reportRound(report = {}) {
  const haystack = `${report.relativePath || ''}/${report.name || ''}`;
  const matched = haystack.match(/(?:round-|第\s*)(\d+)/i);
  return matched ? Number(matched[1]) : 0;
}

function compareReportsByStage(a = {}, b = {}) {
  const orderDiff = artifactWorkflowOrder(a) - artifactWorkflowOrder(b);
  if (orderDiff) return orderDiff;
  const roundDiff = reportRound(a) - reportRound(b);
  if (roundDiff) return roundDiff;
  return String(a.relativePath || a.path || a.name || '').localeCompare(String(b.relativePath || b.path || b.name || ''), 'zh-Hans-CN');
}

function compareArtifactsByWorkflowOrder(a = {}, b = {}) {
  const orderDiff = artifactWorkflowOrder(a) - artifactWorkflowOrder(b);
  if (orderDiff) return orderDiff;
  const roundDiff = reportRound(a) - reportRound(b);
  if (roundDiff) return roundDiff;
  return String(a.relativePath || a.path || a.name || '').localeCompare(String(b.relativePath || b.path || b.name || ''), 'zh-Hans-CN');
}

function artifactWorkflowOrder(artifact = {}) {
  const pathText = `${artifact.relativePath || ''}/${artifact.path || ''}/${artifact.name || ''}`;
  const normalized = pathText.replaceAll('\\', '/').toLowerCase();
  const fileName = String(artifact.name || normalized.split('/').pop() || '').toLowerCase();
  const directIndex = ARTIFACT_DIR_ORDER.findIndex(item => fileName === item.toLowerCase());
  if (directIndex >= 0) return directIndex;
  const dirIndex = ARTIFACT_DIR_ORDER.findIndex(item => normalized.includes(`/${item.toLowerCase()}/`) || normalized.includes(`/${item.toLowerCase()}`));
  if (dirIndex >= 0) return dirIndex;
  const stage = reportStageMeta(artifact);
  const stageIndex = REPORT_STAGE_ORDER.findIndex(item => item.key === stage.key);
  return stageIndex >= 0 ? ARTIFACT_DIR_ORDER.length + stageIndex : 999;
}

function stageMatchesArtifact(name, output, haystack) {
  const checks = [
    ['需求解析', ['需求清单', '阶段执行报告']],
    ['资料整理', ['资料', '需求清单', '阶段执行报告']],
    ['ShowDoc', ['showdoc', '接口模型']],
    ['页面实现', ['figma-to-code', 'api-compose', '页面实现', '接口联调']],
    ['多语言', ['i18n', 'polyglot', '多语言']],
    ['轻量运行验证', ['dev-smoke', '运行验证']],
    ['多主题', ['compat-check', '兼容验证']],
    ['Figma', ['figma-fidelity', '还原度']],
    ['代码审查', ['code-review', '代码审查']],
    ['功能质检', ['dev-report', '质检报告']],
    ['自动修复', ['fix', 'round-2', 'round-3', '自动修复']],
    ['最终交付', ['delivery-report', '交付报告']]
  ];
  const direct = output && haystack.includes(output.replace(/^.*?\.task\//, '.task/'));
  if (direct) return true;
  const matched = checks.find(([stageName]) => name.includes(stageName));
  if (!matched) return false;
  return matched[1].some(keyword => haystack.toLowerCase().includes(keyword.toLowerCase()));
}

function paginate(items, page, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(Number(pageSize) || 50, 1);
  const maxPage = Math.max(1, Math.ceil(list.length / size));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), maxPage);
  const start = (safePage - 1) * size;
  return list.slice(start, start + size);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const AI_TASK_STAGES = [
  '需求文档输出',
  '数据模型智能构建',
  'Figma To Page',
  'API取调编排',
  '自动质检代码',
  '开发质检报告',
  '达标/合格率评估',
  '自动修复',
  '交付总结'
];

const ART_PERSON_ALIASES = new Map([
  ['admin', '张倩文'],
  ['zhangqw', '张倩文'],
  ['zhangqianwen', '张倩文'],
  ['fengshuqi', '冯淑琪'],
  ['fsq', '冯淑琪'],
  ['yushengwei', '余盛威'],
  ['ysw', '余盛威'],
  ['yejunbo', '叶君博'],
  ['yjb', '叶君博'],
  ['huangjianrong', '黄剑荣'],
  ['hjr', '黄剑荣'],
  ['lilh', '李华玲'],
  ['lihl', '李华玲'],
  ['lhl', '李华玲'],
  ['lihaling', '李华玲'],
  ['zhangzb', '张宗斌'],
  ['zzb', '张宗斌'],
  ['alan', '兰韩界'],
  ['lanhj', '兰韩界'],
  ['lhj', '兰韩界']
]);

const DEFAULT_ART_DEPT_PEOPLE = [
  { account: 'zhangqw', realname: '张倩文' },
  { account: 'fengshuqi', realname: '冯淑琪' },
  { account: 'yushengwei', realname: '余盛威' },
  { account: 'yejunbo', realname: '叶君博' },
  { account: 'huangjianrong', realname: '黄剑荣' },
  { account: 'lilh', realname: '李华玲' },
  { account: 'zhangzb', realname: '张宗斌' },
  { account: 'lanhj', realname: '兰韩界' }
];

const SKILL_VALIDATION_PERSON_ALIASES = new Map([
  ['倩文', '张倩文'],
  ['淑琪', '冯淑琪'],
  ['盛威', '余盛威'],
  ['君博', '叶君博'],
  ['剑荣', '黄剑荣'],
  ['华玲', '李华玲'],
  ['宗斌', '张宗斌'],
  ['韩界', '兰韩界']
]);

function canonicalSkillValidationPerson(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const normalized = normalizePersonName(text);
  if (ART_PERSON_ALIASES.has(normalized)) return ART_PERSON_ALIASES.get(normalized);
  for (const [alias, name] of SKILL_VALIDATION_PERSON_ALIASES.entries()) {
    if (text === alias || text.includes(alias)) return name;
  }
  return '';
}

function emptyRunForm() {
  return {
    sourceMode: 'standalone',
    taskId: '',
    projectId: '',
    executionMode: 'level-process',
    workflow: 'art-standard-process',
    workflowLevel: 'M',
    customWorkflowId: '',
    title: '',
    stage: '',
    zentaoId: '',
    developer: '',
    targetPage: '',
    figmaLinks: '',
    showdocHints: '',
    selectedMaterialHints: [],
    requirement: '',
    sourceType: 'standalone'
  };
}

function emptyWorkflowDesigner(projectId = '') {
  return {
    id: '',
    name: '',
    description: '',
    projectId,
    skillKeyword: '',
    stages: []
  };
}

function designerStage(stage = {}) {
  const flags = normalizedWorkflowStageFlags(stage);
  return {
    localId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    id: stage.id || stage.skillId || '',
    name: stage.name || stage.skillId || '',
    skillId: stage.skillId || '',
    artifactDir: stage.artifactDir || stage.skillId || stage.id || '',
    required: flags.required,
    skippable: flags.skippable,
    doneCriteria: stage.doneCriteria || '',
    description: stage.description || ''
  };
}

function normalizedWorkflowStageFlags(stage = {}) {
  if (stage.skippable === true && stage.required !== true) {
    return { required: false, skippable: true };
  }
  return { required: true, skippable: false };
}

function skillIdForStageName(name = '') {
  const text = String(name || '');
  if (/ShowDoc|模型|接口模型/.test(text)) return 'showdoc-generator';
  if (/接口|联调/.test(text)) return 'api-compose';
  if (/页面|实现|Figma To Page/.test(text)) return 'figma-to-code';
  if (/多语言|i18n/i.test(text)) return 'i18n-generator';
  if (/运行|冒烟|验证/.test(text)) return 'dev-smoke';
  if (/兼容|主题|多端/.test(text)) return 'compat-check';
  if (/还原|Figma/.test(text)) return 'figma-fidelity-report';
  if (/代码审查|审查/.test(text)) return 'code-review';
  if (/质检|质量/.test(text)) return 'dev-report';
  if (/自动修复|修复/.test(text)) return 'auto-fix';
  if (/交付|总结|摘要/.test(text)) return 'delivery-report';
  if (/需求|资料|规则/.test(text)) return 'parse-task';
  return '';
}

function repositorySourceTypeLabel(value = '') {
  return {
    local: '本地目录',
    git: 'Git 仓库',
    shared: '共享盘',
    research: 'AI 研究'
  }[value] || '本地目录';
}

function inferRepositorySourceType(project = {}, scan = {}) {
  const text = [
    project.sourceType,
    project.framework,
    project.rootPath,
    project.git?.remoteUrl,
    scan?.framework
  ].map(value => String(value || '')).join('\n');
  if (/AI 研究|研究|art-git|skill|技能|规范|沉淀/i.test(text)) return 'research';
  if (project.git?.remoteUrl || /\.git\b|gitlab|github|gitee/i.test(text)) return 'git';
  if (/共享|share|smb|nas|public/i.test(text)) return 'shared';
  return 'local';
}

function executionInstructionForTask(task = {}) {
  const background = task.requirement || task.summary || '';
      const lines = [
    '任务背景：',
    task.taskNo ? `关联需求 #${task.taskNo}：${task.title || '未命名任务'}` : (task.title || ''),
    background,
    '',
    '本次执行重点：',
    '请按当前选择的美术执行方式和执行范围处理，围绕上述任务完成 Figma 读取、规范匹配、必要的界面生成/走查/归档和交付说明。',
    '如涉及规范 md 或 Skill，请优先读取并记录调用依据；如涉及 Figma 写入，必须记录写入位置、节点或阻塞原因。',
    '如发现需求缺口或阻塞，请明确写出原因、影响范围和下一步最小处理方案。'
  ];
  return lines.filter((line, index, array) => {
    if (line) return true;
    return array[index - 1] && array[index + 1];
  }).join('\n');
}

function emptyUserForm() {
  return {
    id: '',
    username: '',
    displayName: '',
    password: '12345678',
    role: 'developer',
    allProjects: true,
    projectIds: [],
    disabled: false
  };
}

function emptyArtProjectSheetRowForm() {
  return {
    id: '',
    rowNumber: 0,
    file: '',
    devLink: '',
    viewLink: '',
    pcPreviewLink: '',
    wapPreviewLink: '',
    owner: '',
    figmaName: '',
    remark: '',
    extra: {},
    source: 'manual'
  };
}

function emptyArtProjectSheetFieldForm() {
  return {
    key: '',
    label: '',
    type: 'text',
    source: 'custom',
    order: 999,
    locked: false
  };
}


function emptyAiAssetForm(input = {}) {
  return {
    id: input.id || '',
    rowNumber: Number(input.rowNumber || 0),
    title: input.title || '',
    suites: input.suites || '',
    owner: input.owner || '',
    progressStatus: input.progressStatus || '',
    dailyNote: input.dailyNote || '',
    plannedDoneAt: input.plannedDoneAt || '',
    finalPath: input.finalPath || '',
    projectName: input.projectName || '',
    verifyStatus: input.verifyStatus || '',
    availablePeople: input.availablePeople || '',
    publicStatus: input.publicStatus || '',
    crossCount: input.crossCount || '',
    accuracy: input.accuracy || '',
    description: input.description || '',
    unpublishedReason: input.unpublishedReason || '',
    skillPath: input.skillPath || '',
    flowOwner: input.flowOwner || '',
    fileLink: input.fileLink || '',
    templateNote: input.templateNote || '',
    source: input.source || ''
  };
}

function emptySkillValidationForm(input = {}) {
  return {
    id: input.id || '',
    rowNumber: Number(input.rowNumber || 0),
    submittedAt: input.submittedAt || '',
    validator: input.validator || input.walkthroughOwner || '',
    sourceRef: input.sourceRef || '',
    owner: input.owner || '',
    ownerList: Array.isArray(input.ownerList) ? input.ownerList : String(input.owner || '').split(/[、,，;；|/\\\s]+/).map(item => item.trim()).filter(Boolean),
    researchName: input.researchName || '',
    artifactType: input.artifactType || 'md',
    artifactName: input.artifactName || input.scope || '',
    artifactLocation: input.artifactLocation || '',
    workflowScene: input.workflowScene || '',
    validationTask: input.validationTask || '',
    selfCreated: input.selfCreated || '否',
    inputMaterial: input.inputMaterial || '',
    evidenceLink: input.evidenceLink || '',
    validationResult: input.validationResult || input.status || '',
    manualChange: input.manualChange || '',
    timeEstimate: input.timeEstimate || '',
    issues: input.issues || '',
    suggestion: input.suggestion || '',
    reuseAdvice: input.reuseAdvice || '',
    notes: input.notes || '',
    source: input.source || '工作台人工回填',
    sourceUrl: input.sourceUrl || '',
    importedAt: input.importedAt || '',
    createdAt: input.createdAt || ''
  };
}

function normalizeArtProgressTextRecord(value = '') {
  const text = String(value || '').trim();
  const map = {
    'art-progress-reporter': '美术工作台研究沉淀同步',
    'install-test': '安装测试',
    'install-completed': '安装完成',
    'install-complete': '安装完成',
    'research-sync-install': '研究沉淀同步安装',
    'Art progress reporter install': '研究沉淀同步安装',
    'Research sync install test succeeded.': '研究沉淀同步测试成功。',
    'Art progress reporter test succeeded.': '研究沉淀同步测试成功。',
    'AI research': 'AI 研究',
    'Sync one AI research or tool usage note to art workbench.': '同步一次 AI 研究或工具使用经验到美术工作台。'
  };
  if (map[text]) return map[text];
  const installMatch = text.match(/^(.+?) completed research sync installation\.$/);
  if (installMatch) return `${installMatch[1]} 已完成研究沉淀同步安装。`;
  const reporterInstallMatch = text.match(/^(.+?) completed art progress reporter installation\.$/);
  if (reporterInstallMatch) return `${reporterInstallMatch[1]} 已完成研究沉淀同步安装。`;
  return text;
}

function normalizeArtMemberNameRecord(value = '') {
  const text = String(value || '').trim();
  const aliases = {
    yejunbo: '叶君博',
    huangjianrong: '黄剑荣',
    fengshuqi: '冯淑琪',
    yushengwei: '余盛威',
    lilh: '李华玲',
    zhangzb: '张宗斌',
    lanhj: '兰韩界'
  };
  const lower = text.toLowerCase();
  for (const [key, name] of Object.entries(aliases)) {
    if (lower === key || lower.includes(key) || text.includes(name)) return name;
  }
  const chinese = text.match(/[\u4e00-\u9fa5]{2,4}/);
  return chinese ? chinese[0] : text;
}

function decorateArtProgressEventRecord(event = {}) {
  return {
    ...event,
    logSource: event.logSource || 'art-progress-event',
    displayMemberName: normalizeArtMemberNameRecord(event.memberName || event.memberAccount || '-'),
    displaySkillName: normalizeArtProgressTextRecord(event.skillName || event.skillId || event.stage || '-'),
    displayStage: normalizeArtProgressTextRecord(event.stage || ''),
    displaySummary: normalizeArtProgressTextRecord(event.summary || event.title || '-'),
    displayProjectName: normalizeArtProgressTextRecord(event.projectName || '')
  };
}


function isResearchArtProgressOperationLogRecord(log = {}) {
  const event = log.after || log.metadata?.after || {};
  const haystack = [event.eventType, event.title, event.stage, event.summary, event.skillId, event.skillName, log.description, log.action].map(value => String(value || '')).join('\n');
  if (['reporter_installed', 'reporter_test'].includes(event.eventType)) return false;
  return !/安装测试|安装完成|install-test|install-completed|install-complete|research-sync-install|Art progress reporter install|Research sync install test succeeded|Art progress reporter test succeeded|已完成研究沉淀同步安装|completed research sync installation|completed art progress reporter installation/i.test(haystack);
}

function decorateArtProgressOperationLogRecord(log = {}) {
  const event = log.after || log.metadata?.after || {};
  return {
    id: log.id || event.id || `${log.createdAt}-${log.action}`,
    eventId: event.id || '',
    logSource: 'operation-log',
    createdAt: log.createdAt || event.createdAt || '',
    eventType: event.eventType || log.action || '',
    status: event.status || (log.result === 'fail' ? 'failed' : 'completed'),
    displayMemberName: normalizeArtMemberNameRecord(event.memberName || log.displayName || log.username || '-'),
    displaySkillName: normalizeArtProgressTextRecord(event.skillName || event.skillId || log.actionName || log.action || '-'),
    displayStage: normalizeArtProgressTextRecord(event.stage || log.action || ''),
    displaySummary: normalizeArtProgressTextRecord(event.summary || log.description || '-'),
    displayProjectName: normalizeArtProgressTextRecord(event.projectName || log.targetName || '')
  };
}

function artProgressEventHaystack(event = {}) {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  return [
    event.eventType,
    event.title,
    event.stage,
    event.summary,
    event.skillId,
    event.skillName,
    event.repoPath,
    event.projectName,
    event.zentaoTaskId,
    event.taskNo,
    metadata.path,
    metadata.filePath,
    metadata.finalPath,
    metadata.skillPath,
    metadata.artifactPath,
    metadata.artifactLocation,
    metadata.validationResult,
    metadata.validationStatus,
    metadata.source,
    metadata.sessionId
  ].map(value => String(value || '')).join('\n');
}

function isCodexOperationArtProgressEventRecord(event = {}) {
  if (['reporter_installed', 'reporter_test'].includes(event.eventType)) return false;
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  if (metadata.artProgressListVisible === true || metadata.researchListVisible === true) return false;
  const text = artProgressEventHaystack(event);
  return /Codex 使用记录补传|记录日期：|会话：|codex session|sessionId|操作记录|对话记录/i.test(text);
}

function isResearchArtProgressEventRecord(event = {}) {
  if (['reporter_installed', 'reporter_test'].includes(event.eventType)) return false;
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  if (metadata.artProgressListVisible === true || metadata.researchListVisible === true) return true;
  const text = artProgressEventHaystack(event);
  if (isCodexOperationArtProgressEventRecord(event)) return false;
  if (isFigmaUseConnectorRecordText(text)) return false;
  if (/\.md\b|markdown|SKILL\.md|skillPath|技能沉淀|验证|验证回填|可验证|产物目录|产物路径|finalPath|artifact|deliverable/i.test(text)) return true;
  if (['research_artifact', 'research_finding', 'research_summary'].includes(event.eventType)) return true;
  return false;
}

function isFigmaUseConnectorRecordText(text = '') {
  const value = String(text || '').replace(/\\/g, '/').toLowerCase();
  if (!value) return false;
  return /(^|[^a-z0-9])(?:use[-_ ]?figma|figma[-_ ]?use|mcp__figma__use_figma|figma[-_ ]?mcp|mcp[-_ ]?figma)(?=$|[^a-z0-9])/i.test(value);
}

function emptyArtProgressDetailDialog() {
  return {
    visible: false,
    title: '',
    headTitle: '',
    path: '',
    description: '',
    tags: [],
    meta: [],
    triggers: [],
    rows: [],
    outline: []
  };
}

function emptyArtProgressEventForm(input = {}) {
  return {
    id: input.id || '',
    eventType: input.eventType || 'research_progress',
    title: input.title || '',
    memberAccount: input.memberAccount || '',
    memberName: input.memberName || '',
    skillId: input.skillId || '',
    skillName: input.skillName || '',
    stage: input.stage || '',
    status: input.status || '',
    summary: input.summary || '',
    repoPath: input.repoPath || '',
    projectName: input.projectName || '',
    zentaoTaskId: input.zentaoTaskId || input.taskNo || '',
    taskNo: input.taskNo || input.zentaoTaskId || '',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    createdAt: input.createdAt || ''
  };
}

function emptyRoleForm() {
  return {
    id: '',
    name: '',
    description: '',
    level: 1,
    permissions: [],
    disabled: false,
    system: false,
    persisted: false
  };
}

function emptyCodexConfigForm(input = {}) {
  return {
    model: input.model || 'gpt-5.5',
    baseUrl: input.baseUrl || '',
    apiKey: '',
    hasApiKey: input.hasApiKey === true,
    clearApiKey: false
  };
}

function emptyTaskReviewForm() {
  return {
    decision: 'approved',
    score: 80,
    requirementScore: 80,
    qualityScore: 80,
    uiScore: 80,
    validationScore: 80,
    bugCount: 0,
    criticalBugCount: 0,
    needsRework: false,
    comment: ''
  };
}

function emptyAiFlowRecordForm(input = {}) {
  return {
    id: input.id || '',
    projectId: input.projectId || '',
    taskId: input.taskId || '',
    taskNo: input.taskNo || extractTaskNo(input.taskNameAndNo || input.taskTitle || ''),
    taskNameAndNo: input.taskNameAndNo || '',
    taskTitle: input.taskTitle || '',
    developer: input.developer || '',
    agentModel: input.agentModel || '',
    requirementDoc: input.requirementDoc || '',
    dataModelBuild: input.dataModelBuild || '',
    figmaToPage: input.figmaToPage || '',
    apiOrchestration: input.apiOrchestration || '',
    autoCodeQuality: input.autoCodeQuality || '',
    devQualityReport: input.devQualityReport || '',
    qualificationAssessment: input.qualificationAssessment || '',
    autoFix: input.autoFix || '',
    flowCompletion: Number(input.flowCompletion || 0),
    totalDuration: input.totalDuration || '',
    summaryIssues: input.summaryIssues || '',
    status: input.status || 'draft',
    source: input.source || 'manual',
    sheetSourceUrl: input.sheetSourceUrl || '',
    sheetRowNumber: input.sheetRowNumber || 0,
    importedAt: input.importedAt || ''
  };
}

function extractTaskNo(value = '') {
  const matched = String(value || '').match(/\b\d{4,8}\b/);
  return matched ? matched[0] : '';
}

function emptyProjectForm() {
  return {
    id: '',
    name: '',
    sourceType: 'local',
    rootPath: '',
    framework: 'unknown',
    agentConfigPath: 'AGENTS.md',
    skillConfigPath: '.agent-hub/config.md',
    taskDir: '.task',
    git: emptyGitForm()
  };
}

function emptyGitForm() {
  return {
    remoteUrl: '',
    defaultBaseBranch: ''
  };
}

function emptySvnForm() {
  return {
    remoteUrl: '',
    branchPrefix: '',
    trunkName: '',
    rootPath: '',
    defaultTargetPath: ''
  };
}

function projectPayload(form = {}) {
  const sourceType = form.sourceType || 'local';
  const gitForm = {
    ...emptyGitForm(),
    ...(form.git || {})
  };
  return {
    id: form.id || '',
    name: form.name || '',
    sourceType,
    rootPath: sourceType === 'git' ? '' : (form.rootPath || ''),
    framework: form.framework || 'unknown',
    agentConfigPath: form.agentConfigPath || 'AGENTS.md',
    skillConfigPath: form.skillConfigPath || '.agent-hub/config.md',
    taskDir: form.taskDir || '.task',
    git: sourceType === 'git' ? gitForm : emptyGitForm()
  };
}

const DEFAULT_WORKFLOW_LEVELS = [
  {
    level: 'XS',
    name: '快速走查',
    workflow: 'art-micro-process',
    summary: '适合单个 Figma 节点、文案、颜色、间距、图标和轻量规范核对。',
    stages: ['读取任务与 Figma 线索', '匹配规范 / Skill', '轻量走查或生成', '简版交付摘要']
  },
  {
    level: 'S',
    name: '轻量执行',
    workflow: 'art-light-process',
    summary: '适合小范围 Figma 页面整理、规范套用、Skill 验证和局部产物归档。',
    stages: ['读取任务与 Figma 线索', '生成美术执行清单', '匹配规范 / Skill', '执行设计处理', '轻量验收', '简版交付摘要']
  },
  {
    level: 'M',
    name: '标准执行',
    workflow: 'art-standard-process',
    summary: '适合普通页面生成、设计规范套用、界面走查验收和 AI 产物归档。',
    stages: ['任务与验收点解析', 'Figma / 规范资料整理', '自动匹配规范 / Skill', '执行设计生成或走查', '产物位置与截图证据', '规范一致性检查', '问题与风险整理', '美术交付报告']
  },
  {
    level: 'L',
    name: '完整执行',
    workflow: 'art-full-process',
    summary: '适合新界面、多状态、多规范、多成员产物联动和需要落到指定 Figma 位置的完整执行。',
    stages: ['任务与验收点解析', 'Figma / 规范 / Skill 资料整理', '自动匹配可用规范与资产', '生成执行清单与放置计划', '执行 Figma 生成或界面整理', '规范一致性检查', '多状态 / 多尺寸走查', '截图与节点证据整理', 'Skill / md 调用记录', '问题与风险清单', '负责人复核建议', '最终交付报告']
  }
];

function isLowEffortArtAcceptanceTask(task = {}) {
  const titleText = [
    task.title,
    task.displayTitle,
    task.name,
    task.taskName,
    task.taskNameAndNo,
    task.zentao?.name,
    task.zentao?.title,
    task.zentao?.taskName,
    task.zentao?.storyTitle,
    task.zentao?.parentName
  ].filter(Boolean).join('\n');
  if (/(?:美术)?验收单|美术验收|验收走查|走查单|设计同步单|设计同步/.test(titleText)) return true;

  const bodyText = [
    task.summary,
    task.requirement,
    task.description,
    task.type,
    task.taskType,
    task.zentao?.type,
    task.zentao?.taskType
  ].filter(Boolean).join('\n');
  return /(?:任务类型|单据类型|流程类型|工单类型|类型)[：:\s]*(?:美术)?(?:验收|验收单|走查|走查单|设计同步|设计同步单)/.test(bodyText);
}

function workflowForLevel(level) {
  if (level === 'XS') return 'art-micro-process';
  if (level === 'S') return 'art-light-process';
  if (level === 'L') return 'art-full-process';
  return 'art-standard-process';
}

function levelForWorkflow(workflow) {
  const normalized = normalizeWorkflowId(workflow);
  if (normalized === 'art-micro-process') return 'XS';
  if (normalized === 'art-light-process') return 'S';
  if (normalized === 'art-full-process') return 'L';
  if (normalized === 'art-standard-process') return 'M';
  return '';
}

function normalizeWorkflowId(workflow = '') {
  return workflow;
}

function inferTaskWorkloadLevel(task = {}, project = {}) {
  const text = [
    task.title,
    task.displayTitle,
    task.requirement,
    task.description,
    task.summary,
    task.targetPage,
    task.figmaLinks,
    task.showdocHints,
    project.name,
    project.framework
  ].filter(Boolean).join('\n');
  const lower = text.toLowerCase();
  const reasons = [];
  const risks = [];
  let score = 1;

  const add = (points, reason, risk = '') => {
    score += points;
    if (reason && !reasons.includes(reason)) reasons.push(reason);
    if (risk && !risks.includes(risk)) risks.push(risk);
  };

  if (/web5|多主题|theme_\d|多版|多端|兼容|适配/i.test(text)) add(2, '涉及 Web5 多主题/多端适配', '多主题');
  if (/接口|api|showdoc|联调|后台配置|配置控制|保存顺序|firebase|sdk/i.test(text)) add(2, '涉及接口、后台配置或三方能力', '涉接口');
  if (/登录|绑定|密码|验证码|手机号|邮箱|人脸|cpf|账户|account/i.test(text)) add(3, '涉及登录、账号绑定或验证链路', '账号安全');
  if (/支付|充值|提现|钱包|余额|资金/i.test(text)) add(3, '涉及资金或钱包链路', '资金链路');
  if (/新页面|新增页面|新模块|完整流程|全流程|详情页|子页面/i.test(text)) add(2, '涉及新页面、新模块或完整页面链路', '页面链路');
  if (/figma|设计稿|还原|视觉|样式统一|皮肤|自定义入口|悬浮入口|弹窗/i.test(text)) add(1, '涉及 UI 样式、入口或设计还原', '设计还原');
  if (/文案|翻译|多语言|颜色|间距|字号|图标|展示隐藏|显示隐藏/i.test(text)) add(1, '偏展示、文案或样式调整');
  if (/优化|调整|修改|支持|自定义/i.test(text)) add(1, '属于已有能力优化或扩展');

  const figmaCount = countClues(task.figmaLinks || text, /figma\.com/ig);
  const showdocCount = countClues(task.showdocHints || text, /showdoc|page_id|item_id|cat_id/ig);
  if (figmaCount > 1) add(1, `包含 ${figmaCount} 条设计稿线索`, '多设计稿');
  if (showdocCount > 1) add(1, `包含 ${showdocCount} 条接口线索`, '多接口');

  const isTinyChange = score <= 3
    && /文案|翻译|多语言|颜色|间距|字号|图标|展示隐藏|显示隐藏|展示|隐藏/i.test(text)
    && !/接口|api|showdoc|联调|登录|绑定|验证码|人脸|支付|充值|提现|钱包|新页面|新增页面|新模块|完整流程|全流程|sdk|firebase/i.test(text);

  let level = isTinyChange ? 'XS' : 'S';
  if (score >= 7) level = 'L';
  else if (score >= 4) level = 'M';

  const confidence = Math.min(92, Math.max(58, 56 + reasons.length * 7 + (task.requirement ? 10 : 0) + (task.taskNo ? 4 : 0)));
  return {
    level,
    confidence,
    score,
    reasons: reasons.length ? reasons.slice(0, 4) : ['平台当前只有标题/基础字段，先按小范围任务估算'],
    risks: risks.slice(0, 4),
    humanDuration: humanDurationForWorkloadLevel(level),
    aiDuration: aiDurationForWorkloadLevel(level),
    workflowName: workflowNameForWorkloadLevel(level)
  };
}

function isBugLikeTask(task = {}) {
  const text = [
    task.title,
    task.displayTitle,
    task.name,
    task.summary,
    task.requirement,
    task.sourceType,
    task.zentao?.sourceType
  ].filter(Boolean).join('\n');
  return /【\s*(?:内部|线上)?\s*bug\s*】|内部\s*bug|线上\s*bug|sourceType\s*[:：]?\s*bug/i.test(text);
}

function inferBugWorkloadLevel(bug = {}, project = {}) {
  const text = [
    bug.title,
    bug.displayTitle,
    bug.requirement,
    bug.description,
    bug.steps,
    bug.result,
    bug.expect,
    bug.targetPage,
    project.name
  ].filter(Boolean).join('\n');
  const reasons = [];
  const risks = [];
  let score = 1;
  const severity = Number(bug.severity || 0);
  const pri = Number(bug.pri || 0);

  const add = (points, reason, risk = '') => {
    score += points;
    if (reason && !reasons.includes(reason)) reasons.push(reason);
    if (risk && !risks.includes(risk)) risks.push(risk);
  };

  if (severity && severity <= 2) add(2, `严重级别 S${severity}`, '高严重级别');
  if (pri && pri <= 2) add(1, `优先级 P${pri}`, '高优先级');
  if (/线上|生产|用户反馈|客诉/i.test(text)) add(2, '线上 Bug 或用户反馈问题', '线上问题');
  if (/登录|支付|充值|提现|钱包|验证码|绑定|人脸|账户/i.test(text)) add(2, '涉及核心业务或账号资金链路', '核心链路');
  if (/web5|多主题|theme_\d|兼容|适配/i.test(text)) add(1, '涉及多主题/兼容验证', '多主题');
  if (/崩溃|白屏|无法进入|打不开|阻塞/i.test(text)) add(2, '问题表现阻塞用户继续操作', '阻塞问题');
  if (/样式|颜色|间距|文案|展示/i.test(text)) add(1, '偏展示类修复');

  const isTinyFix = score <= 2
    && /样式|颜色|间距|文案|展示|图标/i.test(text)
    && !/线上|生产|登录|支付|充值|提现|钱包|验证码|绑定|人脸|崩溃|白屏|无法进入|打不开|阻塞/i.test(text);

  let level = isTinyFix ? 'XS' : 'S';
  if (score >= 6) level = 'L';
  else if (score >= 4) level = 'M';

  const confidence = Math.min(90, Math.max(56, 54 + reasons.length * 8 + (severity ? 6 : 0) + (pri ? 4 : 0)));
  return {
    level,
    confidence,
    score,
    reasons: reasons.length ? reasons.slice(0, 4) : ['平台当前只有 Bug 标题/基础字段，先按小范围修复估算'],
    risks: risks.slice(0, 4),
    humanDuration: humanDurationForWorkloadLevel(level, true),
    aiDuration: aiDurationForWorkloadLevel(level, true),
    workflowName: workflowNameForWorkloadLevel(level, true)
  };
}

function countClues(text = '', pattern) {
  return String(text || '').match(pattern)?.length || 0;
}

function humanDurationForWorkloadLevel(level, isBug = false) {
  if (level === 'XS') return isBug ? '0.25-0.5 天' : '0.25 天';
  if (level === 'L') return isBug ? '2-4 天' : '3 天以上';
  if (level === 'M') return isBug ? '1-2 天' : '1-2 天';
  return isBug ? '0.5-1 天' : '0.5 天';
}

function aiDurationForWorkloadLevel(level, isBug = false) {
  if (level === 'XS') return isBug ? '5-20 分钟' : '5-15 分钟';
  if (level === 'L') return isBug ? '1-3 小时' : '1.5-4 小时';
  if (level === 'M') return isBug ? '20-60 分钟' : '30-90 分钟';
  return isBug ? '10-40 分钟' : '10-30 分钟';
}

function workflowNameForWorkloadLevel(level, isBug = false) {
  if (isBug) {
    if (level === 'XS') return '微型修复';
    if (level === 'S') return '轻量修复';
    if (level === 'L') return '完整修复流程';
    return '标准修复流程';
  }
  if (level === 'XS') return '微型流程';
  if (level === 'S') return '轻量流程';
  if (level === 'L') return '完整流程';
  return '标准流程';
}

function skillDisplayText(skill) {
  const map = {
    'api-compose': '接口联调：接入页面、Store 与业务逻辑',
    'bug-audit-report': 'Bug 审计：扫描提交并输出风险报告',
    'code-review': '代码审查：检查改动风险与可维护性',
    'compat-check': '兼容验证：检查多主题、多端与响应式',
    'delivery-report': '交付报告：汇总提测结论与剩余风险',
    'dev-report': '质检报告：核对需求覆盖和验收结论',
    'dev-smoke': '冒烟验证：运行页面并检查关键交互',
    'dialog-generator': '弹窗开发：生成业务弹窗与适配实现',
    'figma-fidelity-report': '还原度验收：对比 Figma 与页面截图',
    'figma-to-code': '页面实现：按设计稿落地组件和样式',
    'git-branch': '分支管理：按任务创建或切换开发分支',
    'i18n-generator': '多语言：追加并生成语言包 Key',
    'parse-task': '需求解析：整理资料并生成需求清单',
    'showdoc-generator': '接口生成：根据 ShowDoc 生成 API 与类型',
    'stage-report': '阶段报告：维护阶段总览和执行明细',
    'xnconvert-webp': '图片转换：批量转 WebP 并更新引用'
  };
  return map[skill?.id] || skill?.title || skill?.id || '项目技能';
}

function diffTokenClass(token = '') {
  if (/^\/\//.test(token) || /^\/\*/.test(token)) return 'diff-token-comment';
  if (/^['"`]/.test(token)) return 'diff-token-string';
  if (/^\d/.test(token)) return 'diff-token-number';
  if (/^(true|false|null|undefined)$/.test(token)) return 'diff-token-literal';
  if (/^(string|number|boolean|void|unknown|any|Record|Router)$/.test(token)) return 'diff-token-type';
  return 'diff-token-keyword';
}

function normalizeLogMarkdown(value = '') {
  const source = String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
  const cleanedLines = [];
  let omittedHeavy = 0;
  let omittedFiltered = 0;
  for (const line of source.split(/\r?\n/)) {
    const result = normalizeRunLogLine(line);
    if (result.keep) {
      cleanedLines.push(result.text);
    } else if (result.reason === 'heavy') {
      omittedHeavy += 1;
    } else {
      omittedFiltered += 1;
    }
  }
  let visibleLines = cleanedLines;
  const extraLines = Math.max(0, visibleLines.length - RUN_LOG_RENDER_MAX_LINES);
  if (extraLines > 0) visibleLines = visibleLines.slice(-RUN_LOG_RENDER_MAX_LINES);
  let text = visibleLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > RUN_LOG_RENDER_MAX_CHARS) {
    text = `已省略前半段执行日志，仅展示最近 ${Math.round(RUN_LOG_RENDER_MAX_CHARS / 1024)} KB 摘要。\n\n${text.slice(-RUN_LOG_RENDER_MAX_CHARS)}`;
  }
  const notices = [];
  if (extraLines > 0) notices.push(`已省略较早的 ${extraLines} 行执行日志。`);
  if (omittedHeavy > 0) notices.push(`已省略 ${omittedHeavy} 行 Figma 截图、base64 或大段工具 JSON。`);
  if (notices.length) text = `${notices.join(' ')}\n\n${text}`.trim();
  return text || '暂无关键执行日志。原始日志仍保存在 run.log，可在需要排查时查看。';
}

function normalizeRunLogLine(line = '') {
  const text = String(line || '');
  const trimmed = text.trim();
  if (!trimmed) return { keep: true, text: '' };
  if (isLargeToolPayload(trimmed)) return { keep: true, text: summarizeLargeToolPayload(trimmed) };
  if (isHeavyRunLogLine(trimmed)) return { keep: false, reason: 'heavy' };
  if (trimmed.startsWith('{') && trimmed.includes('"type"')) {
    const summary = summarizeCodexJsonLine(trimmed);
    if (summary) return { keep: true, text: summary };
    return { keep: false, reason: 'filtered' };
  }
  if (shouldKeepRunLogLine(text)) {
    return { keep: true, text: limitRunLogLine(text) };
  }
  return { keep: false, reason: 'filtered' };
}

function summarizeCodexJsonLine(line = '') {
  try {
    const event = JSON.parse(line);
    return summarizeCodexEvent(event);
  } catch {
    return null;
  }
}

function summarizeCodexEvent(event = {}) {
  const type = String(event.type || '');
  const item = event.item || {};
  if (type === 'turn.completed') {
    const total = event.usage?.input_tokens || event.usage?.output_tokens
      ? `，输入 ${event.usage.input_tokens || 0} / 输出 ${event.usage.output_tokens || 0}`
      : '';
    return `- Codex 执行结束${total}`;
  }
  if (!type.startsWith('item.')) return '';
  if (item.type === 'agent_message' && item.text) return limitRunLogLine(String(item.text || ''));
  if (item.type === 'command_execution') {
    const command = String(item.command || '').trim();
    const status = item.status ? `状态：${item.status}` : '';
    const exitCode = item.exit_code !== null && item.exit_code !== undefined ? `退出码：${item.exit_code}` : '';
    const output = limitRunLogLine(String(item.aggregated_output || '').trim(), 1200);
    return [
      command ? `- 命令：\`${command}\`` : '- 命令执行',
      [status, exitCode].filter(Boolean).join('，'),
      output ? `输出：${output}` : ''
    ].filter(Boolean).join('\n');
  }
  if (item.type === 'mcp_tool_call') {
    const server = item.server || 'mcp';
    const tool = item.tool || 'tool';
    const status = item.status || (event.error ? 'failed' : 'completed');
    const hasImage = /screenshot|image|base64/i.test(`${tool}\n${JSON.stringify(item.result || '').slice(0, 400)}`);
    const detail = hasImage ? '截图/图片内容已省略' : '大段工具参数或返回已摘要';
    const error = event.error ? `，错误：${limitRunLogLine(JSON.stringify(event.error), 600)}` : '';
    return `- 工具调用：${server}.${tool} ${status}，${detail}${error}`;
  }
  if (item.type === 'todo_list' && Array.isArray(item.items)) {
    const done = item.items.filter(row => row.completed).length;
    return `- 执行清单：${done}/${item.items.length} 已完成`;
  }
  return '';
}

function isLargeToolPayload(text = '') {
  if (text.length <= RUN_LOG_LINE_MAX_CHARS) return false;
  return text.includes('"type":"mcp_tool_call"') || text.includes('"type":"tool_call"') || text.includes('"mcp_tool_call"');
}

function summarizeLargeToolPayload(text = '') {
  const server = extractJsonStringField(text, 'server') || 'mcp';
  const tool = extractJsonStringField(text, 'tool') || 'tool';
  const status = extractJsonStringField(text, 'status') || 'completed';
  const isImagePayload = /get_screenshot|screenshot|image\/png|base64|data:image/i.test(text);
  const detail = isImagePayload ? '截图/图片内容已省略，原始日志仍保存在 run.log' : '大段工具参数或返回已省略，原始日志仍保存在 run.log';
  return `- 工具调用：${server}.${tool} ${status}，${detail}`;
}

function extractJsonStringField(text = '', field = '') {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`);
  return text.match(pattern)?.[1] || '';
}

function isHeavyRunLogLine(text = '') {
  if (text.length <= RUN_LOG_LINE_MAX_CHARS) return false;
  if (/base64|mimeType|image\/png|data:image|structured_content|get_screenshot|screenshot/i.test(text)) return true;
  const compact = text.replace(/\s/g, '');
  if (compact.length > RUN_LOG_LINE_MAX_CHARS && /^[A-Za-z0-9+/=]+$/.test(compact.slice(0, Math.min(compact.length, 8000)))) return true;
  return text.length > RUN_LOG_RENDER_MAX_CHARS;
}

function limitRunLogLine(text = '', max = RUN_LOG_LINE_MAX_CHARS) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...已截断超长日志行，原始内容仍保存在 run.log。`;
}

function trimRunLogBuffer(value = '') {
  const text = String(value || '');
  if (text.length <= RUN_LOG_BUFFER_MAX_CHARS) return text;
  const tail = text.slice(-RUN_LOG_BUFFER_MAX_CHARS);
  const firstBreak = tail.search(/\r?\n/);
  const safeTail = firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail;
  return `...已省略较早的实时日志，原始内容仍保存在 run.log。\n${safeTail}`;
}

function shouldKeepRunLogLine(line = '') {
  const text = String(line || '');
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^\[(status|change-summary)\]/i.test(trimmed)) return false;
  if (/^(OpenAI Codex|workdir:|model:|provider:|approval:|sandbox:|reasoning effort:|reasoning summaries:|session id:|user$)/i.test(trimmed)) return false;
  if (/^(tokens used|thinking|cached|--------|={3,})/i.test(trimmed)) return false;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return false;
  if (/^\[stdout\]|\[stderr\]|\[error\]|\[done\]/i.test(trimmed)) return true;
  if (/^(#{1,6}\s*)?(任务开始|开始执行|执行任务|阶段|当前阶段|步骤|命令|运行命令|验证命令|结果|执行结果|最终状态|状态|报错|错误|失败|阻塞|runner error|Codex exited|修改或生成的关键文件|运行过的验证命令|报告\/截图\/日志产物路径|影响范围|下一步|阻塞原因)/i.test(trimmed)) return true;
  if (/^(#{1,6}\s*)?(需求解析|资料整理|接口|设计确认|页面实现|联调|多语言|运行验证|兼容检查|代码审查|质检报告|交付报告|冒烟验证|自动修复)/i.test(trimmed)) return true;
  if (/^\s*[-*]\s+/.test(text) && /(命令|文件|路径|状态|结果|失败|错误|阻塞|报告|截图|日志|pnpm|npm|yarn|git|node|codex)/i.test(trimmed)) return true;
  if (/(```|^\s*(pnpm|npm|yarn|git|node|npx|codex)\b|error|failed|exception|traceback|warning|passed|conditional_pass|blocked|skipped)/i.test(trimmed)) return true;
  return false;
}

function normalizeTaskStageChecks(stageChecks = []) {
  if (!Array.isArray(stageChecks) || !stageChecks.length) return [];
  const map = new Map((Array.isArray(stageChecks) ? stageChecks : []).map(stage => [stage.name, stage.status || '']));
  return AI_TASK_STAGES.map(name => ({ name, status: map.get(name) || '' }));
}

function toCsv(rows = []) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escapeCell = value => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(','),
    ...rows.map(row => headers.map(key => escapeCell(row[key])).join(','))
  ].join('\n');
}

function clampPercent(value) {
  const number = Number(value || 0);
  if (Number.isNaN(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function stripMarkdownMetadata(markdown = '') {
  let content = String(markdown || '').replace(/^\uFEFF/, '');
  content = content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '');
  const lines = content.split(/\r?\n/);
  const cleaned = [];
  let skippingFoldedMeta = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (skippingFoldedMeta) {
      if (!trimmed || /^[A-Za-z0-9_-]+:\s*/.test(trimmed) || /^#{1,6}\s+/.test(trimmed)) {
        skippingFoldedMeta = false;
      } else if (/^\s+/.test(line)) {
        continue;
      } else {
        skippingFoldedMeta = false;
      }
    }
    if (trimmed === '>-' || trimmed === '>-|' || trimmed === '|-' || trimmed === '|') {
      skippingFoldedMeta = true;
      continue;
    }
    if (/^(name|description|version|author|tags|triggers):\s*(.*)$/i.test(trimmed)) {
      const value = trimmed.replace(/^[^:]+:\s*/, '');
      if (!value || value === '>-' || value === '|' || value === '|-') {
        skippingFoldedMeta = true;
      }
      continue;
    }
    cleaned.push(line);
  }
  return cleaned.join('\n').trimStart();
}

function renderMarkdownMetadata(metadata = '') {
  const lines = String(metadata || '')
    .replace(/^---\s*/, '')
    .replace(/\s*---$/, '')
    .split(/\r?\n/);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const label = match[1];
    let value = match[2] || '';
    if (value === '>-' || value === '|' || value === '|-') {
      const folded = [];
      index += 1;
      while (index < lines.length && (/^\s+/.test(lines[index]) || !/^[A-Za-z0-9_-]+:\s*/.test(lines[index]))) {
        folded.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      value = folded.join('\n');
    }
    rows.push({ label, value });
  }
  if (!rows.length) return '';
  return [
    '<section class="md-metadata-panel">',
    ...rows.map(row => `<div class="md-metadata-row"><span>${escapeHtml(row.label)}</span><p>${escapeHtml(row.value || '-')}</p></div>`),
    '</section>'
  ].join('');
}

function renderMarkdownTable(tableLines, sourceDir) {
  const rows = tableLines
    .filter(line => !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|$/.test(line.trim()))
    .map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim()));
  if (!rows.length) return '';
  if (isStageSummaryTable(rows)) return renderStageSummaryTable(rows.slice(1), sourceDir);
  const [head, ...body] = rows;
  return [
    '<table>',
    `<thead><tr>${head.map(cell => `<th>${inlineMarkdown(cell, sourceDir)}</th>`).join('')}</tr></thead>`,
    `<tbody>${body.map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell, sourceDir)}</td>`).join('')}</tr>`).join('')}</tbody>`,
    '</table>'
  ].join('');
}

function isStageSummaryTable(rows) {
  const header = (rows[0] || []).join('|');
  return header.includes('阶段') && header.includes('状态') && header.includes('报告/证据');
}

function renderStageSummaryTable(rows, sourceDir) {
  const body = rows.map(row => {
    const [stage = '', status = '', evidence = ''] = normalizeStageSummaryRow(row);
    return [
      '<tr>',
      `<td class="stage-summary-name">${inlineMarkdown(stage, sourceDir)}</td>`,
      `<td class="stage-summary-status">${renderStatusPill(status)}</td>`,
      `<td class="stage-summary-evidence">${renderEvidenceList(evidence, sourceDir)}</td>`,
      '</tr>'
    ].join('');
  }).join('');
  return [
    '<table class="stage-summary-table">',
    '<thead><tr><th>阶段</th><th>状态</th><th>报告与证据</th></tr></thead>',
    `<tbody>${body}</tbody>`,
    '</table>'
  ].join('');
}

function normalizeStageSummaryRow(row) {
  if (row.length <= 3) return row;
  return [[row[0], row[1]].filter(Boolean).join(' '), row[2], row.slice(3).join('|')];
}

function renderStatusPill(value = '') {
  const text = escapeHtml(value.replace(/[✅⚠️⏭️❌]/g, '').trim() || value);
  const type = /阻塞|失败|❌/.test(value)
    ? 'danger'
    : /条件|风险|⚠️/.test(value)
      ? 'warning'
      : /未触发|跳过|⏭️/.test(value)
        ? 'muted'
        : 'success';
  return `<span class="report-status ${type}">${text}</span>`;
}

function renderEvidenceList(value = '', sourceDir) {
  const parts = value.split(/；|;/).map(item => item.trim()).filter(Boolean);
  if (!parts.length) return '<span class="muted">无</span>';
  return `<div class="report-evidence-list">${parts.map(item => renderEvidenceItem(item, sourceDir)).join('')}</div>`;
}

function renderEvidenceItem(value = '', sourceDir) {
  const raw = value.trim();
  const codeMatch = raw.match(/^`([^`]+)`$/);
  if (!codeMatch) return `<span class="report-evidence-item note">${inlineMarkdown(raw, sourceDir)}</span>`;
  const filePath = codeMatch[1];
  const parts = filePath.split('/').filter(Boolean);
  const fileName = parts.pop() || filePath;
  const dir = parts.length ? `${parts.join('/')}/` : '';
  const type = evidenceItemType(fileName);
  const resolved = resolveArtifactPath(filePath, sourceDir);
  return [
    `<button type="button" class="report-evidence-item file ${type}" data-artifact-path="${escapeHtml(resolved)}">`,
    dir ? `<small>${escapeHtml(dir)}</small>` : '',
    `<strong>${escapeHtml(fileName)}</strong>`,
    '</button>'
  ].join('');
}

function evidenceItemType(fileName = '') {
  if (/\.(png|jpg|jpeg|webp)$/i.test(fileName)) return 'image';
  if (/\.(json|csv)$/i.test(fileName)) return 'data';
  if (/\.(ts|vue|js|cjs|mjs)$/i.test(fileName)) return 'code-file';
  if (/^pnpm|^npm|^yarn/i.test(fileName)) return 'command';
  return 'doc';
}

function inlineMarkdown(value, sourceDir) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const resolved = resolveArtifactPath(src, sourceDir);
      return `<button type="button" class="inlineEvidence" data-artifact-path="${escapeHtml(resolved)}"><img src="/api/artifact?path=${encodeURIComponent(resolved)}" alt="${escapeHtml(alt)}" /><span>${escapeHtml(src)}</span></button>`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => renderMarkdownLink(label, href, sourceDir))
    .replace(/`([^`]+)`/g, (_, code) => renderInlineCode(code, sourceDir))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)(?=$|[\s).,，。；;])/g, (_, prefix, url) => `${prefix}${renderExternalLink(url, url)}`);
}

function renderMarkdownLink(label = '', href = '', sourceDir = '') {
  const cleanHref = decodeHtmlEntities(href).trim();
  if (/^https?:\/\//i.test(cleanHref)) return renderExternalLink(cleanHref, label);
  const resolved = resolveArtifactPath(cleanHref, sourceDir);
  return `<button type="button" class="mdLink file-link" data-artifact-path="${escapeHtml(resolved)}">${label}</button>`;
}

function renderExternalLink(href = '', label = '') {
  const cleanHref = decodeHtmlEntities(href).trim();
  const cleanLabel = decodeHtmlEntities(label).trim() || cleanHref;
  return `<a class="mdLink external-link" href="${escapeHtml(cleanHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanLabel)}</a>`;
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function renderInlineCode(value = '', sourceDir = '') {
  const text = String(value).trim();
  const isPath = /[/.]/.test(text) && !/\s/.test(text);
  const isCommand = /^(pnpm|npm|yarn|node|vite)\b/i.test(text);
  if (!isPath && !isCommand) return `<span class="md-inline-code text">${text}</span>`;
  const parts = text.split('/').filter(Boolean);
  const name = parts.pop() || text;
  const dir = parts.length ? `${parts.join('/')}/` : '';
  const type = evidenceItemType(name);
  const resolved = resolveArtifactPath(text, sourceDir);
  return [
    `<button type="button" class="md-inline-code file ${type}" data-artifact-path="${escapeHtml(resolved)}">`,
    dir ? `<small>${dir}</small>` : '',
    `<strong>${name}</strong>`,
    '</button>'
  ].join('');
}

function resolveArtifactPath(src, sourceDir) {
  if (/^\/Users\//.test(src)) return src;
  if (/^https?:\/\//.test(src)) return src;
  return `${sourceDir}/${src}`.replaceAll('/./', '/');
}

function statusBucket(status = '') {
  if (/rework/.test(status)) return 'rework';
  if (/blocked|failed|❌|阻塞|失败/.test(status)) return 'blocked';
  if (/conditional|有条件|⚠️|P2|警告/.test(status)) return 'conditional';
  if (/accepted|passed|healthy|✅|通过|验收|提测|success|done/.test(status)) return 'passed';
  return 'unknown';
}

function normalizePersonName(value = '') {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function samePerson(left = '', right = '') {
  return normalizePersonName(left) === normalizePersonName(right);
}

function formatSheetDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

function workloadEstimateWeight(level = '') {
  return {
    XS: 0.5,
    S: 1,
    M: 2,
    L: 4
  }[String(level || '').toUpperCase()] || 1.5;
}

function statusLabel(status) {
  return {
    conditional: '有条件通过',
    blocked: '阻塞',
    passed: '通过',
    failed: '失败',
    unknown: '待判定'
  }[status] || status || '待判定';
}

function compactStatus(status = '') {
  if (/有条件|conditional|⚠️/.test(status)) return '有条件通过';
  if (/阻塞|blocked|failed|❌/.test(status)) return '阻塞';
  if (/跳过|⏭️/.test(status)) return '跳过';
  if (/通过|passed|✅/.test(status)) return '通过';
  return status;
}

function formatBytes(value) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function cleanDateInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /^0{4}[./-]0{1,2}[./-]0{1,2}/.test(raw)) return '';
  return raw;
}

function isDateOnlyDisplayValue(value = '') {
  const raw = cleanDateInput(value);
  return /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(raw);
}

function parseDisplayDate(value) {
  const raw = cleanDateInput(value);
  if (!raw) return { raw: '', date: null, hasTime: false, dateOnly: false };
  if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{1,2}/.test(raw)) {
    const date = new Date(raw);
    return {
      raw,
      date: Number.isNaN(date.getTime()) ? null : date,
      hasTime: true,
      dateOnly: false
    };
  }
  const match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    const hasTime = match[4] !== undefined && match[5] !== undefined;
    const normalized = hasTime
      ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T${String(match[4]).padStart(2, '0')}:${String(match[5]).padStart(2, '0')}:${String(match[6] || '0').padStart(2, '0')}`
      : `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    const date = hasTime ? new Date(normalized) : new Date(`${normalized}T00:00:00`);
    return {
      raw,
      date: Number.isNaN(date.getTime()) ? null : date,
      hasTime,
      dateOnly: !hasTime
    };
  }
  const date = new Date(raw);
  const hasTime = /T\d{1,2}:\d{1,2}| \d{1,2}:\d{1,2}/.test(raw);
  return {
    raw,
    date: Number.isNaN(date.getTime()) ? null : date,
    hasTime,
    dateOnly: !hasTime && /^\d{4}-\d{2}-\d{2}/.test(raw)
  };
}

function formatDateParts(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return { year, month, day, hour, minute, second };
}

function formatDateTime(value) {
  const parsed = parseDisplayDate(value);
  if (!parsed.raw) return '-';
  if (!parsed.date) return parsed.raw || '-';
  const parts = formatDateParts(parsed.date);
  if (!parts) return parsed.raw || '-';
  if (parsed.dateOnly || !parsed.hasTime) return `${parts.year}-${parts.month}-${parts.day}`;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatDateSecond(value) {
  return formatDateTime(value);
}

function formatDateOnly(value) {
  const parsed = parseDisplayDate(value);
  if (!parsed.raw) return '-';
  if (!parsed.date) return parsed.raw || '-';
  return localDateKey(parsed.date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function sanitizeTaskRequirementHtml(value = '', baseUrl = '') {
  const decoded = decodeHtmlEntities(String(value || '').trim());
  if (!decoded || /^<br\s*\/?>$/i.test(decoded)) return '';
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(decoded);
  const html = looksLikeHtml ? decoded : escapeHtml(decoded).replace(/\r?\n/g, '<br>');
  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return html.replace(/<script[\s\S]*?<\/script>/gi, '');
  }
  const parser = new window.DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const allowedTags = new Set([
    'A', 'B', 'BR', 'CODE', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4', 'HR', 'I',
    'IMG', 'LI', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG', 'TABLE', 'TBODY',
    'TD', 'TH', 'THEAD', 'TR', 'U', 'UL'
  ]);
  const allowedAttrs = new Set(['alt', 'colspan', 'href', 'rowspan', 'src', 'target', 'title']);
  const root = doc.body.firstElementChild;
  const sanitizeNode = node => {
    if (node.nodeType === Node.COMMENT_NODE) {
      node.remove();
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || !allowedAttrs.has(name)) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (['href', 'src'].includes(name)) {
        const safeUrl = safeTaskRequirementUrl(attr.value, baseUrl);
        if (!safeUrl) node.removeAttribute(attr.name);
        else node.setAttribute(attr.name, safeUrl);
      }
    }
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('alt', node.getAttribute('alt') || '任务描述图片');
    }
    Array.from(node.childNodes).forEach(sanitizeNode);
  };
  Array.from(root?.childNodes || []).forEach(sanitizeNode);
  return root?.innerHTML?.trim() || '';
}

function safeTaskRequirementUrl(value = '', baseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw || /^(?:javascript|data):/i.test(raw)) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  try {
    const fallback = 'https://cd.baa360.cc:20088/index.php';
    const base = String(baseUrl || fallback).replace(/\/$/, '');
    const url = new URL(raw, base.endsWith('/index.php') ? base : `${base}/`);
    return url.toString();
  } catch {
    return '';
  }
}
</script>
