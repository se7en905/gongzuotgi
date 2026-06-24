<template>
<section v-show="app.activeView === 'role-management'" class="view-grid role-management-view">
  <ElCard shadow="never" class="panel-card page-card">
    <template #header>
      <div class="panel-head">
        <div>
          <h3>角色管理</h3>
          <p>系统内置角色是平台默认角色，可编辑权限但不能删除；新增角色会显示为自定义，账号页会直接读取这里的角色。</p>
        </div>
        <ElButton v-if="app.can('role.manage')" type="primary" @click="app.openRoleCreateDrawer">新增角色</ElButton>
      </div>
    </template>

    <ElTable class="fill-table" :data="app.roles" row-key="id" empty-text="暂无角色">
      <ElTableColumn label="角色" min-width="190">
        <template #default="{ row }">
          <div class="role-cell">
            <strong>{{ row.name }}</strong>
            <span>{{ row.id }}</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="等级" width="100">
        <template #default="{ row }"><ElTag :type="levelTagType(row.level)">L{{ row.level }}</ElTag></template>
      </ElTableColumn>
      <ElTableColumn label="权限点" min-width="360">
        <template #default="{ row }">
          <div class="permission-list">
            <ElTag v-for="permission in visiblePermissions(row.permissions)" :key="permission" size="small" effect="plain">{{ permissionName(permission) }}</ElTag>
            <span v-if="!visiblePermissions(row.permissions).length" class="muted-text">只读基础权限</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="类型" width="110">
        <template #default="{ row }">
          <ElTag :type="row.system ? 'info' : 'success'" :title="row.system ? '平台默认角色：可编辑权限，不能删除。' : '你手动新增的角色：可编辑、可停用、未被账号使用时可删除。'">{{ row.system ? '系统内置' : '自定义' }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="100">
        <template #default="{ row }"><ElTag :type="row.disabled ? 'danger' : 'success'">{{ row.disabled ? '停用' : '启用' }}</ElTag></template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <div class="table-action-row">
            <ElButton v-if="app.can('role.manage')" plain size="small" @click="app.openRoleEditDrawer(row)">编辑</ElButton>
            <ElButton
              v-if="app.can('role.manage')"
              type="danger"
              plain
              size="small"
              :disabled="row.system"
              :title="row.system ? '系统内置角色不能删除' : '删除角色'"
              @click="app.deleteRole(row)"
            >
              删除
            </ElButton>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>
  </ElCard>

  <ElDialog v-model="app.roleDrawer" width="640px" :title="app.roleForm.id && app.roleForm.persisted ? '编辑角色' : '新增角色'" class="app-dialog" align-center>
    <ElForm :model="app.roleForm" label-position="top" @submit.prevent>
      <ElFormItem label="角色名称" class="is-required-field"><ElInput v-model="app.roleForm.name" placeholder="运营" /></ElFormItem>
      <ElFormItem label="角色等级" class="is-required-field">
        <ElSegmented :model-value="app.roleForm.level" :options="roleLevelOptions" @update:model-value="app.setRoleLevel" />
        <div class="field-hint">{{ app.roleForm.persisted ? '修改等级不会覆盖当前权限配置；等级只是权限预设和排序，不代表只能有四个角色。' : '选择等级后会自动匹配常用权限，下面可以按实际岗位调整；可以新增任意数量的自定义角色。' }}</div>
      </ElFormItem>
      <ElFormItem label="权限配置">
        <ElCheckboxGroup v-model="app.roleForm.permissions" class="permission-section-list">
          <section class="permission-block permission-highlight-block">
            <div class="permission-block-head">
              <div>
                <strong>细分查看 / 脱敏权限</strong>
                <span>这里单独控制模糊、可下载、可看正文、可看明细这类细权限。后面要给验证人开放，直接在这里勾选。</span>
              </div>
              <div class="permission-block-actions">
                <span>{{ selectedCount(fineGrainedViewPermissions) }} / {{ fineGrainedViewPermissions.length }}</span>
                <ElButton text size="small" @click="setPermissionGroup(fineGrainedViewPermissions, true)">全选</ElButton>
                <ElButton text size="small" @click="setPermissionGroup(fineGrainedViewPermissions, false)">清空</ElButton>
              </div>
            </div>
            <div class="permission-check-grid">
              <ElCheckbox v-for="permission in fineGrainedViewPermissions" :key="permission.id" :label="permission.id" :title="permission.description">
                <strong>{{ permission.name }}</strong>
                <span>{{ fineGrainedPermissionDescription(permission) }}</span>
              </ElCheckbox>
            </div>
          </section>

          <section class="permission-block">
            <div class="permission-block-head">
              <div>
                <strong>菜单权限</strong>
                <span>控制这个角色能看到哪些页面入口</span>
              </div>
              <div class="permission-block-actions">
                <span>{{ selectedCount(menuPermissions) }} / {{ menuPermissions.length }}</span>
                <ElButton text size="small" @click="setPermissionGroup(menuPermissions, true)">全选</ElButton>
                <ElButton text size="small" @click="setPermissionGroup(menuPermissions, false)">清空</ElButton>
              </div>
            </div>
            <div v-for="group in menuPermissionGroups" :key="group.name" class="permission-subgroup">
              <div class="permission-subgroup-title">
                <strong>{{ group.name }}</strong>
                <span>{{ selectedCount(group.items) }} / {{ group.items.length }}</span>
              </div>
              <div class="permission-check-grid">
                <ElCheckbox v-for="permission in group.items" :key="permission.id" :label="permission.id">
                  <strong>{{ permission.name }}</strong>
                  <span>{{ permission.description }}</span>
                </ElCheckbox>
              </div>
            </div>
          </section>

          <section class="permission-block">
            <div class="permission-block-head">
              <div>
                <strong>操作权限</strong>
                <span>控制这个角色能使用哪些新增、编辑、删除、启动等操作</span>
              </div>
              <div class="permission-block-actions">
                <span>{{ selectedCount(buttonPermissions) }} / {{ buttonPermissions.length }}</span>
                <ElButton text size="small" @click="setPermissionGroup(buttonPermissions, true)">全选</ElButton>
                <ElButton text size="small" @click="setPermissionGroup(buttonPermissions, false)">清空</ElButton>
              </div>
            </div>
            <div v-for="group in buttonPermissionGroups" :key="group.name" class="permission-subgroup">
              <div class="permission-subgroup-title">
                <strong>{{ group.name }}</strong>
                <span>{{ selectedCount(group.items) }} / {{ group.items.length }}</span>
              </div>
              <div class="permission-check-grid">
                <ElCheckbox v-for="permission in group.items" :key="permission.id" :label="permission.id">
                  <strong>{{ permission.name }}</strong>
                  <span>{{ permission.description }}</span>
                </ElCheckbox>
              </div>
            </div>
          </section>

          <section class="permission-block api-permission-block">
            <div class="permission-block-head">
              <div>
                <strong>接口权限</strong>
                <span>控制这个角色提交操作时，后端是否允许通过</span>
              </div>
              <div class="permission-block-actions">
                <span>{{ selectedCount(apiPermissions) }} / {{ apiPermissions.length }}</span>
                <ElButton text size="small" @click="setPermissionGroup(apiPermissions, true)">全选</ElButton>
                <ElButton text size="small" @click="setPermissionGroup(apiPermissions, false)">清空</ElButton>
              </div>
            </div>
            <div class="permission-check-grid">
              <ElCheckbox v-for="permission in apiPermissions" :key="permission.id" :label="permission.id">
                <strong>{{ permission.name }}</strong>
                <span>{{ permission.description }}</span>
              </ElCheckbox>
            </div>
          </section>
        </ElCheckboxGroup>
      </ElFormItem>
      <ElFormItem label="说明"><ElInput v-model="app.roleForm.description" type="textarea" :rows="3" placeholder="说明这个角色适合什么人使用" /></ElFormItem>
      <ElFormItem v-if="!app.roleForm.system" label="启用状态">
        <ElSwitch
          :model-value="!app.roleForm.disabled"
          @update:model-value="value => app.roleForm.disabled = !value"
        />
      </ElFormItem>
      <ElButton type="primary" class="full-button" :loading="app.loading.roles" @click="app.saveRole">保存角色</ElButton>
    </ElForm>
  </ElDialog>
</section>
</template>

<script>
export default {
  name: 'RoleManagementView',
  props: {
    app: {
      type: Object,
      required: true
    }
  },
  computed: {
    roleLevelOptions() {
      return [
        { label: 'L4 管理员', value: 4 },
        { label: 'L3 美术执行人', value: 3 },
        { label: 'L2 美术验证人', value: 2 },
        { label: 'L1 只读', value: 1 }
      ];
    },
    menuPermissions() {
      return this.permissionsByType('menu');
    },
    buttonPermissions() {
      return this.permissionsByType('button');
    },
    fineGrainedViewPermissions() {
      return this.permissionsByIds([
        'skill.preview.view',
        'aiMembers.board.view',
        'workflow.manage.view',
        'run.log.view',
        'run.artifact.download',
        'archive.detail.view',
        'archive.link.view'
      ]);
    },
    apiPermissions() {
      return this.permissionsByType('api');
    },
    menuPermissionGroups() {
      return this.groupPermissions(this.menuPermissions);
    },
    buttonPermissionGroups() {
      const highlightedIds = this.fineGrainedPermissionIds();
      return this.groupPermissions(this.buttonPermissions.filter(item => !highlightedIds.has(item.id)));
    }
  },
  methods: {
    fineGrainedPermissionIds() {
      return new Set([
        'skill.preview.view',
        'aiMembers.board.view',
        'workflow.manage.view',
        'run.log.view',
        'run.artifact.download',
        'archive.detail.view',
        'archive.link.view'
      ]);
    },
    hiddenPermissionIds() {
      return new Set([
        'menu.aiMembers.owner',
        'menu.aiMembers.member'
      ]);
    },
    levelTagType(level) {
      return Number(level) >= 4 ? 'danger' : Number(level) === 3 ? 'primary' : Number(level) === 2 ? 'warning' : 'info';
    },
    permissionName(id) {
      const fallbackNames = {
        'projects.manage': '项目管理',
        'runs.execute': '执行任务',
        'run.codex.execute': '启动 Codex 执行',
        'run.directSkill.create': '创建直接执行',
        'run.directSkill.workerCommand': '复制 Worker 命令',
        'runs.delete': '删除执行记录',
        'reviews.submit': '人工复核',
        'users.manage': '账号管理',
        'roles.manage': '角色管理',
        'workflow.manage': '工作流模板',
        'archive.record.manage': 'AI 全流程人工记录',
        'menu.agentWorkers': '本机执行状态',
        'menu.aiArchive': 'AI档案',
        'menu.maintenance': '维护中心',
        'aiMembers.score.view': '查看 AI 评分',
        'aiMembers.score.refresh': '刷新 AI 评分',
        'api.agentRuns.create': '直接执行创建 API',
        'api.agentWorkers.read': 'Worker 状态读取 API',
        'api.agentWorkers.heartbeat': 'Worker 心跳 API',
        'api.agentWorkers.alias': 'Worker 设备花名 API',
        'api.agentRuns.claim': '直接执行领取 API',
        'api.agentRuns.log': '直接执行日志 API',
        'api.agentRuns.status': '直接执行状态 API',
        'api.aiArchive.delete': 'AI档案范围删除 API',
        'api.workflow.manage': '流程模板管理 API',
        'api.aiMembers.read': 'AI部门看板读取 API',
        'api.aiMembers.score.read': 'AI评分依赖读取 API',
        'api.aiMembers.score.write': 'AI评分快照保存 API',
        'api.aiMembers.refresh': 'AI部门看板刷新 API',
        'api.maintenance.manage': '维护中心 API'
      };
      return this.app.permissionCatalog.find(item => item.id === id)?.name || fallbackNames[id] || '未知权限';
    },
    permissionsByType(type) {
      const hiddenIds = this.hiddenPermissionIds();
      return this.app.permissionCatalog.filter(item => item.type === type && !hiddenIds.has(item.id));
    },
    permissionsByIds(ids = []) {
      const targetIds = new Set(Array.isArray(ids) ? ids : []);
      return this.permissionsByType('button').filter(item => targetIds.has(item.id));
    },
    fineGrainedPermissionDescription(permission = {}) {
      const id = String(permission.id || '');
      const shortMap = {
        'skill.preview.view': '关闭后只能看列表，不能打开正文。',
        'aiMembers.board.view': '关闭后底部 AI 看板会模糊锁定。',
        'workflow.manage.view': '控制模板管理弹窗是否可见。',
        'run.log.view': '控制原始执行日志抽屉是否可见。',
        'run.artifact.download': '关闭后仅保留缩略图，不可打开下载。',
        'archive.detail.view': '控制 AI 档案明细抽屉是否可见。',
        'archive.link.view': '控制 AI 档案外链是否显示并可打开。'
      };
      return shortMap[id] || permission.description || '';
    },
    groupPermissions(items = []) {
      const groups = new Map();
      for (const permission of items) {
        const group = permission.group || '其他';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(permission);
      }
      return Array.from(groups, ([name, groupItems]) => ({ name, items: groupItems }));
    },
    selectedCount(items = []) {
      const selected = new Set(this.app.roleForm.permissions || []);
      return items.filter(item => selected.has(item.id)).length;
    },
    visiblePermissions(items = []) {
      const hiddenIds = this.hiddenPermissionIds();
      return (Array.isArray(items) ? items : []).filter(id => !hiddenIds.has(id));
    },
    setPermissionGroup(items = [], checked) {
      const selected = new Set(this.app.roleForm.permissions || []);
      for (const item of items) {
        if (checked) selected.add(item.id);
        else selected.delete(item.id);
      }
      this.app.roleForm.permissions = Array.from(selected);
    }
  }
};
</script>

<style lang="scss">
.role-management-view {
  min-height: calc(100vh - 126px);

  .role-cell {
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

  .permission-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .permission-section-list {
    display: grid;
    gap: 16px;
    width: 100%;
  }

  .permission-block {
    display: grid;
    gap: 12px;
    width: 100%;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(248, 250, 252, 0.52);
  }

  .permission-block-head,
  .permission-subgroup-title {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 12px;

    strong {
      color: var(--heading);
      font-size: 14px;
      font-weight: 850;
    }

    span {
      color: var(--muted);
      font-size: 12px;
    }
  }

  .permission-block-head > div:first-child {
    display: grid;
    gap: 8px;
    min-width: 0;

    span {
      line-height: 1.45;
    }
  }

  .permission-block-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 1px;
    white-space: nowrap;

    > span {
      min-width: 44px;
      text-align: right;
      font-weight: 760;
    }
  }

  .permission-subgroup {
    display: grid;
    gap: 8px;
  }

  .permission-subgroup-title {
    padding-top: 2px;

    strong {
      font-size: 13px;
    }

    span {
      justify-self: end;
      font-weight: 760;
    }
  }

  .permission-check-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    width: 100%;

    .el-checkbox {
      align-items: flex-start;
      height: auto;
      margin-right: 0;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--soft-card);
    }

    .el-checkbox__label {
      display: grid;
      gap: 3px;
      line-height: 1.4;
      white-space: normal;
    }

    strong {
      color: var(--heading);
      font-size: 13px;
    }

    span {
      color: var(--muted);
      font-size: 12px;
    }
  }

  .api-permission-block {
    border-style: dashed;
  }

  .muted-text {
    color: var(--muted);
    font-size: 13px;
  }
}
</style>
