<template>
<section v-show="app.activeView === 'user-access'" class="view-grid user-access-view">
  <ElCard shadow="never" class="panel-card page-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>账户管理</h3>
          <p>管理平台账号、角色、项目访问范围和已记录的临时密码。</p>
        </div>
        <ElButton v-if="app.can('user.manage')" type="primary" @click="app.openUserCreateDrawer">新增账号</ElButton>
      </div>
    </template>

    <div class="password-display-panel">
      <div>
        <strong>密码展示区</strong>
        <span>展示平台创建、重置、本人修改或管理员登记后记录过的密码；历史哈希密码无法反解，需重置后才会显示。</span>
      </div>
      <ElTag type="warning" effect="plain">仅管理员可见</ElTag>
    </div>

    <ElTable class="fill-table" :data="app.users" row-key="id" empty-text="暂无账号">
      <ElTableColumn label="账号" min-width="190">
        <template #default="{ row }">
          <div class="user-cell">
            <strong>{{ row.displayName || row.username }}</strong>
            <span>{{ row.username }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="角色" width="130">
        <template #default="{ row }">
          <ElTag :type="roleTagType(row.role)">{{ app.roleLabel(row.role, row.roleName) }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="项目权限" min-width="260">
        <template #default="{ row }">
          <div class="project-scope-cell">
            <ElTag v-if="row.projectIds?.includes('*')" size="small" effect="plain">全部项目</ElTag>
            <template v-else>
              <ElTag v-for="projectId in row.projectIds || []" :key="projectId" size="small" effect="plain">{{ projectName(projectId) }}</ElTag>
              <span v-if="!row.projectIds?.length" class="muted-text">未分配项目</span>
            </template>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="110">
        <template #default="{ row }"><ElTag :type="row.disabled ? 'danger' : 'success'">{{ row.disabled ? '已禁用' : '启用' }}</ElTag></template>
      </ElTableColumn>
      <ElTableColumn label="密码状态" width="140">
        <template #default="{ row }">
          <ElTag :type="row.mustChangePassword ? 'warning' : 'success'">{{ row.mustChangePassword ? '首次需改密' : '正常' }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="密码展示" min-width="190">
        <template #default="{ row }">
          <div class="password-display-cell">
            <code>{{ row.passwordDisplay || '未记录' }}</code>
            <span v-if="row.passwordRecordedAt">{{ row.passwordSource || '已记录' }} · {{ app.formatDateTime(row.passwordRecordedAt) }}</span>
            <span v-else>历史密码不可反解，重置后显示</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="最近登录" width="180">
        <template #default="{ row }">{{ app.formatDateTime(row.lastLoginAt) }}</template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="430" fixed="right">
        <template #default="{ row }">
          <div class="table-action-row user-table-actions">
            <ElButton v-if="app.can('user.manage')" plain size="small" @click="app.openUserEditDrawer(row)">编辑权限</ElButton>
            <ElButton v-if="app.can('user.manage')" plain size="small" @click="app.openPasswordResetDrawer(row)">重置密码</ElButton>
            <ElButton v-if="app.can('user.manage')" plain size="small" @click="app.openPasswordRecordDrawer(row)">登记密码</ElButton>
            <ElButton v-if="app.can('user.manage')" :type="row.disabled ? 'success' : 'danger'" plain size="small" @click="app.toggleUserDisabled(row)">{{ row.disabled ? '启用' : '禁用' }}</ElButton>
            <ElButton
              v-if="app.can('user.manage')"
              type="danger"
              plain
              size="small"
              :disabled="row.id === app.currentUser?.id"
              :title="row.id === app.currentUser?.id ? '不能删除当前登录账号' : '删除账号'"
              @click="app.deleteUser(row)"
            >
              删除
            </ElButton>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>
  </ElCard>

  <ElDialog v-model="app.userDrawer" width="560px" :title="app.userForm.id ? '编辑账户' : '新增账户'" class="app-dialog" align-center>
    <ElForm :model="app.userForm" label-position="top" @submit.prevent>
      <ElRow :gutter="12">
        <ElCol :span="12"><ElFormItem label="登录账号" class="is-required-field"><ElInput v-model="app.userForm.username" placeholder="zhangsan" /></ElFormItem></ElCol>
        <ElCol :span="12"><ElFormItem label="显示名"><ElInput v-model="app.userForm.displayName" placeholder="张三" /></ElFormItem></ElCol>
      </ElRow>
      <ElFormItem :label="app.userForm.id ? '新密码' : '初始密码'" :class="{ 'is-required-field': !app.userForm.id }">
        <ElInput v-model="app.userForm.password" type="password" show-password :placeholder="app.userForm.id ? '不填写则不修改密码' : '至少 8 位'" />
      </ElFormItem>
      <ElFormItem label="角色" class="is-required-field">
        <ElSelect v-model="app.userForm.role">
          <ElOption v-for="role in app.enabledRoles" :key="role.id" :label="role.name || role.id" :value="role.id">
            <div class="role-option-row">
              <strong>{{ role.name || role.id }}</strong>
              <span>L{{ role.level }} · {{ role.description || role.id }}</span>
            </div>
          </ElOption>
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="项目权限" class="is-required-field">
        <ElSwitch v-model="app.userForm.allProjects" active-text="全部项目" inactive-text="指定项目" />
        <ElSelect v-if="!app.userForm.allProjects" v-model="app.userForm.projectIds" multiple filterable placeholder="选择可访问项目" class="project-scope-select">
          <ElOption v-for="project in app.projects" :key="project.id" :label="project.name" :value="project.id" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem v-if="app.userForm.id" label="启用状态">
        <ElSwitch
          :model-value="!app.userForm.disabled"
          @update:model-value="value => app.userForm.disabled = !value"
        />
      </ElFormItem>
      <ElButton type="primary" class="full-button" :loading="app.loading.users" @click="app.saveUser">保存账号</ElButton>
    </ElForm>
  </ElDialog>

  <ElDialog v-model="app.passwordDrawer" width="440px" title="重置密码" class="app-dialog" align-center>
    <ElForm :model="app.passwordForm" label-position="top" @submit.prevent>
      <ElFormItem label="账号"><ElInput :model-value="app.passwordForm.username" disabled /></ElFormItem>
      <ElFormItem label="新密码" class="is-required-field"><ElInput v-model="app.passwordForm.password" type="password" show-password placeholder="至少 8 位" /></ElFormItem>
      <ElButton type="primary" class="full-button" :loading="app.loading.users" @click="app.resetUserPassword">确认重置</ElButton>
    </ElForm>
  </ElDialog>

  <ElDialog v-model="app.passwordRecordDrawer" width="440px" title="登记密码展示" class="app-dialog" align-center>
    <ElForm :model="app.passwordRecordForm" label-position="top" @submit.prevent>
      <ElFormItem label="账号"><ElInput :model-value="app.passwordRecordForm.username" disabled /></ElFormItem>
      <ElFormItem label="展示密码" class="is-required-field"><ElInput v-model="app.passwordRecordForm.password" show-password placeholder="填入你已确认的当前密码" /></ElFormItem>
      <div class="field-hint">只登记展示用密码，不会修改账号真实登录密码。</div>
      <ElButton type="primary" class="full-button" :loading="app.loading.users" @click="app.recordUserVisiblePassword">保存展示密码</ElButton>
    </ElForm>
  </ElDialog>
</section>
</template>

<script>
export default {
  name: 'UserAccessView',
  props: {
    app: {
      type: Object,
      required: true
    }
  },
  methods: {
    roleTagType(role) {
      return {
        admin: 'danger',
        developer: 'primary',
        reviewer: 'warning',
        viewer: 'info'
      }[role] || 'info';
    },
    projectName(projectId) {
      return this.app.projects.find(project => project.id === projectId)?.name || projectId;
    }
  }
};
</script>

<style lang="scss">
.user-access-view {
  min-height: calc(100vh - 126px);

  .user-cell {
    display: grid;
    gap: 2px;

    strong {
      color: var(--heading);
      font-weight: 850;
    }

    span {
      color: var(--muted);
      font-size: 12px;
    }
  }

  .project-scope-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .password-display-panel {
    align-items: center;
    background: color-mix(in srgb, var(--warn) 8%, var(--card));
    border: 1px solid color-mix(in srgb, var(--warn) 22%, var(--line));
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    padding: 10px 12px;

    div {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    strong {
      color: var(--heading);
      font-size: 13px;
      font-weight: 860;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
    }
  }

  .password-display-cell {
    display: grid;
    gap: 3px;
    min-width: 0;

    code {
      color: var(--heading);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      font-weight: 760;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .user-table-actions {
    min-width: 398px;
  }

  .project-scope-select {
    width: 100%;
    margin-top: 12px;
  }

  .role-option-row {
    display: grid;
    gap: 2px;

    strong {
      color: var(--heading);
      font-size: 13px;
    }

    span {
      color: var(--muted);
      font-size: 12px;
    }
  }

  .muted-text {
    color: var(--muted);
    font-size: 13px;
  }
}
</style>
