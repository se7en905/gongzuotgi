import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listRolesRaw, listSessionsRaw, listUsersRaw, paths, writeRolesRaw, writeSessionsRaw, writeUsersRaw } from './store.mjs';

const scrypt = promisify(scryptCallback);
const sessionCookieName = 'awp_session';
const sessionMaxAgeMs = Number(process.env.AWP_SESSION_MAX_AGE_MS || 12 * 60 * 60 * 1000);
const sessionIdleMaxAgeMs = Number(process.env.AWP_SESSION_IDLE_MAX_AGE_MS || 2 * 60 * 60 * 1000);
const roleRank = {
  viewer: 1,
  reviewer: 2,
  developer: 3,
  admin: 4
};
const defaultRoleAliases = {
  admin: ['admin'],
  developer: ['developer'],
  reviewer: ['reviewer'],
  viewer: ['viewer']
};
const permissionCatalog = [
  { id: 'menu.tasks', name: '任务中心', type: 'menu', group: '一级菜单', description: '访问美术任务中心。' },
  { id: 'menu.skillList', name: 'AI 产物清单', type: 'menu', group: '一级菜单', description: '查看 AI 产物清单、产物数量统计和产物列表。' },
  { id: 'menu.aiMembers', name: 'AI 部门看板', type: 'menu', group: '一级菜单', description: '访问 AI 部门看板和当月 AI 评分。' },
  { id: 'menu.codexConfig', name: 'Codex 配置', type: 'menu', group: '一级菜单', description: '访问 Codex 配置页。' },
  { id: 'menu.runs', name: '美术执行台', type: 'menu', group: '一级菜单', description: '访问美术执行台。' },
  { id: 'menu.agentWorkers', name: '本机执行状态', type: 'menu', group: '一级菜单', description: '查看组员 Worker 心跳、自检和执行明细。' },
  { id: 'menu.aiArchive', name: 'AI档案', type: 'menu', group: '一级菜单', description: '查看完整 AI 执行明细档案。' },
  { id: 'menu.users', name: '账户管理', type: 'menu', group: '用户管理', description: '访问账户管理页。' },
  { id: 'menu.roles', name: '角色管理', type: 'menu', group: '用户管理', description: '访问角色管理页。' },
  { id: 'menu.operationLogs', name: '操作日志', type: 'menu', group: '用户管理', description: '访问平台操作审计日志。' },
  { id: 'menu.maintenance', name: '维护中心', type: 'menu', group: '系统维护', description: '管理员查看本机数据体量并执行范围清理。' },
  { id: 'task.sync', name: '同步任务/Bug', type: 'button', group: '任务中心', description: '同步禅道任务或 Bug。' },
  { id: 'task.note.manage', name: '保存任务备注', type: 'button', group: '任务中心', description: '保存任务中心处理备注。' },
  { id: 'task.artBrief.generate', name: '生成美术摘要', type: 'button', group: '任务中心', description: '生成或重新生成任务美术摘要。' },
  { id: 'task.codexPrompt.copy', name: '复制 Codex 指令', type: 'button', group: '任务中心', description: '复制任务给 Codex 使用的分析或执行指令。' },
  { id: 'task.personPressure.view', name: '查看人员分配判断', type: 'button', group: '任务中心', description: '查看人员卡片底部的分配判断、负责人提醒和压力分。' },
  { id: 'task.platform.delete', name: '删除平台创建任务', type: 'button', group: '任务中心', description: '删除平台创建的任务中心单据，不允许删除禅道同步任务。' },
  { id: 'run.create', name: '创建执行', type: 'button', group: '执行管理', description: '创建执行任务。' },
  { id: 'run.codex.execute', name: '启动 Codex 执行', type: 'button', group: '执行管理', description: '启动、中断或重试会消耗服务器侧 Codex Key 的执行。' },
  { id: 'run.directSkill.create', name: '创建直接执行', type: 'button', group: '执行管理', description: '从 Skill 或 md 预览创建直接执行到 Figma 的任务。' },
  { id: 'run.directSkill.workerCommand', name: '复制 Worker 命令', type: 'button', group: '执行管理', description: '复制组员本机 Worker 手动启动或开机自启命令。' },
  { id: 'workflow.manage', name: '管理流程模板', type: 'button', group: '执行管理', description: '新增、编辑、删除自定义流程模板。' },
  { id: 'run.start', name: '启动执行', type: 'button', group: '执行管理', description: '启动或重试执行。' },
  { id: 'run.cancel', name: '中断执行', type: 'button', group: '执行管理', description: '中断运行中的执行。' },
  { id: 'run.delete', name: '删除执行记录', type: 'button', group: '执行管理', description: '删除运行记录和平台产物。' },
  { id: 'review.submit', name: '提交复核', type: 'button', group: '人工复核', description: '提交人工验收、阶段复核或图片复核。' },
  { id: 'review.image.submit', name: '保存图片复核', type: 'button', group: '人工复核', description: '保存图片人工复核结论。' },
  { id: 'skill.scan.refresh', name: '刷新库存扫描', type: 'button', group: 'AI 产物清单', description: '点击刷新库存，重新扫描已接入的 Git、本地或共享盘来源。' },
  { id: 'skill.source.connect', name: '接入扫描来源', type: 'button', group: 'AI 产物清单', description: '接入 Git 仓库、本地路径或共享盘路径。' },
  { id: 'skill.source.edit', name: '编辑扫描来源', type: 'button', group: 'AI 产物清单', description: '编辑已接入扫描来源的名称、地址和配置。' },
  { id: 'skill.source.delete', name: '删除扫描来源', type: 'button', group: 'AI 产物清单', description: '删除工作台中的扫描来源记录，不删除源文件。' },
  { id: 'skill.asset.create', name: '手动创建产物', type: 'button', group: 'AI 产物清单', description: '手动创建技能或规范类产物记录。' },
  { id: 'skill.asset.void', name: '作废 / 恢复产物', type: 'button', group: 'AI 产物清单', description: '作废或恢复产物，影响 AI 评分是否计入。' },
  { id: 'skill.assetOwner.manage', name: '修改产物贡献人', type: 'button', group: 'AI 产物清单', description: '修改 AI 产物清单和产物列表里的贡献人字段。' },
  { id: 'skill.version.manage', name: '维护产物版本', type: 'button', group: 'AI 产物清单', description: '编辑产物预览里的版本号。' },
  { id: 'skill.alias.manage', name: '维护产物调用别名', type: 'button', group: 'AI 产物清单', description: '编辑产物预览里的调用别名，不允许修改版本。' },
  { id: 'skill.usageLogs.view', name: '查看产物使用明细', type: 'button', group: 'AI 产物清单', description: '查看产物调用次数、成员调用统计和版本迭代记录。' },
  { id: 'skill.preview.view', name: '查看产物内容预览', type: 'button', group: 'AI 产物清单', description: '控制 AI 产物清单右侧正文预览；关闭后只能看列表，不能打开内容正文。' },
  { id: 'aiMembers.board.view', name: '查看 AI 看板正文', type: 'button', group: 'AI部门看板', description: '控制 AI 部门看板底部完整 HTML 看板；关闭后底部看板模糊并显示锁定提示。' },
  { id: 'aiMembers.score.view', name: '查看 AI 评分', type: 'button', group: 'AI部门看板', description: '查看 AI 部门看板里的当月 AI 评分。' },
  { id: 'aiMembers.score.refresh', name: '刷新 AI 评分', type: 'button', group: 'AI部门看板', description: '手动刷新 AI 评分相关轻量依赖并重新计算评分快照。' },
  { id: 'workflow.manage.view', name: '查看模板管理', type: 'button', group: '执行管理', description: '控制是否能打开美术执行台里的模板管理弹窗并查看模板列表。' },
  { id: 'run.log.view', name: '查看原始执行日志', type: 'button', group: '执行管理', description: '控制是否能打开美术执行台里的原始执行日志抽屉并查看日志正文。' },
  { id: 'run.artifact.download', name: '下载执行附件与产物', type: 'button', group: '执行管理', description: '控制执行台和 AI档案里的附件/产物是否可打开下载；关闭后右侧仅保留纯展示缩略图。' },
  { id: 'archive.detail.view', name: '查看 AI 档案明细', type: 'button', group: 'AI档案', description: '控制是否能打开 AI 档案右侧执行明细抽屉。' },
  { id: 'archive.link.view', name: '查看 AI 档案链接', type: 'button', group: 'AI档案', description: '控制 AI 档案里的 Figma 等外部链接是否显示并可打开。' },
  { id: 'codex.config.manage', name: '管理 Codex 配置', type: 'button', group: 'AI 管理', description: '保存 Codex 模型、Provider 和 API Key。' },
  { id: 'user.manage', name: '管理账号', type: 'button', group: '用户管理', description: '新增、编辑、禁用账号和重置密码。' },
  { id: 'role.manage', name: '管理角色', type: 'button', group: '用户管理', description: '新增、编辑、删除角色。' },
  { id: 'api.skillSources.manage', name: '扫描来源保存 API', type: 'api', group: '后端接口', description: '新增或编辑 AI 产物扫描来源。' },
  { id: 'api.skillSources.delete', name: '扫描来源删除 API', type: 'api', group: '后端接口', description: '删除 AI 产物扫描来源记录。' },
  { id: 'api.skillScan.run', name: '库存扫描 API', type: 'api', group: '后端接口', description: '执行 AI 产物库存扫描并写入扫描缓存。' },
  { id: 'api.taskNotes.manage', name: '任务备注 API', type: 'api', group: '后端接口', description: '保存任务中心处理备注。' },
  { id: 'api.taskArtBrief.generate', name: '美术摘要 API', type: 'api', group: '后端接口', description: '生成或重新生成任务美术摘要。' },
  { id: 'api.tasks.deletePlatform', name: '平台创建任务删除 API', type: 'api', group: '后端接口', description: '硬删除平台创建任务和任务中心附属数据。' },
  { id: 'api.runs.execute', name: '执行任务 API', type: 'api', group: '后端接口', description: '创建、启动、中断执行。' },
  { id: 'api.agentRuns.create', name: '直接执行创建 API', type: 'api', group: '后端接口', description: '创建由组员本机 Worker 领取的直接执行任务。' },
  { id: 'api.agentWorkers.read', name: 'Worker 状态读取 API', type: 'api', group: '后端接口', description: '读取本机 Worker 心跳、自检和在线状态。' },
  { id: 'api.agentWorkers.heartbeat', name: 'Worker 心跳 API', type: 'api', group: '后端接口', description: '允许组员本机 Worker 回传在线和自检状态。' },
  { id: 'api.agentWorkers.alias', name: 'Worker 设备花名 API', type: 'api', group: '后端接口', description: '允许本人修改自己绑定设备在工作台里的展示花名。' },
  { id: 'api.agentRuns.claim', name: '直接执行领取 API', type: 'api', group: '后端接口', description: '允许组员本机 Worker 领取分配给自己的直接执行任务。' },
  { id: 'api.agentRuns.log', name: '直接执行日志 API', type: 'api', group: '后端接口', description: '允许组员本机 Worker 回传 Codex 执行日志。' },
  { id: 'api.agentRuns.status', name: '直接执行状态 API', type: 'api', group: '后端接口', description: '允许组员本机 Worker 回传执行状态、阻塞原因和结果。' },
  { id: 'api.runs.delete', name: '删除执行 API', type: 'api', group: '后端接口', description: '删除执行记录。' },
  { id: 'api.aiArchive.delete', name: 'AI档案范围删除 API', type: 'api', group: '后端接口', description: '按时间范围删除 AI 执行明细和后端执行数据。' },
  { id: 'archive.record.manage', name: 'AI 全流程人工记录 API', type: 'api', group: '后端接口', description: '新增、编辑、删除、导入 AI 全流程人工记录。' },
  { id: 'api.reviews.submit', name: '复核提交 API', type: 'api', group: '后端接口', description: '提交人工复核。' },
  { id: 'api.skillVersion.manage', name: '产物版本 API', type: 'api', group: '后端接口', description: '保存技能清单/产物版本号。' },
  { id: 'api.skillAlias.manage', name: '产物调用别名 API', type: 'api', group: '后端接口', description: '保存产物调用别名，不允许修改版本。' },
  { id: 'api.skillAsset.create', name: '手动产物保存 API', type: 'api', group: '后端接口', description: '保存手动创建的技能或规范产物。' },
  { id: 'api.skillAsset.void', name: '产物作废 API', type: 'api', group: '后端接口', description: '作废或恢复 AI 产物清单产物。' },
  { id: 'api.aiMembers.read', name: 'AI部门看板读取 API', type: 'api', group: '后端接口', description: '读取 AI 部门成员快照和看板 HTML 缓存。' },
  { id: 'api.aiMembers.score.read', name: 'AI评分依赖读取 API', type: 'api', group: '后端接口', description: '读取 AI 评分所需轻量缓存或快照。' },
  { id: 'api.aiMembers.score.write', name: 'AI评分快照保存 API', type: 'api', group: '后端接口', description: '保存负责人手动刷新后的 AI 评分快照。' },
  { id: 'api.aiMembers.refresh', name: 'AI部门看板刷新 API', type: 'api', group: '后端接口', description: '刷新 AI 部门成员快照或研究同步，不触发库存扫描。' },
  { id: 'api.codex.config.read', name: 'Codex 配置读取 API', type: 'api', group: '后端接口', description: '读取 Codex 脱敏配置。' },
  { id: 'api.codex.config.manage', name: 'Codex 配置保存 API', type: 'api', group: '后端接口', description: '保存 Codex 配置。' },
  { id: 'api.users.manage', name: '账号管理 API', type: 'api', group: '后端接口', description: '账号管理接口。' },
  { id: 'api.roles.manage', name: '角色管理 API', type: 'api', group: '后端接口', description: '角色管理接口。' },
  { id: 'api.taskCenter.config.manage', name: '任务中心字段配置 API', type: 'api', group: '后端接口', description: '保存任务中心组员可见字段。' },
  { id: 'api.operationLogs.read', name: '操作日志读取 API', type: 'api', group: '后端接口', description: '查询平台操作审计日志。' },
  { id: 'api.operationLogs.delete', name: '操作日志删除 API', type: 'api', group: '后端接口', description: '删除平台操作日志记录。' },
  { id: 'api.maintenance.manage', name: '维护中心 API', type: 'api', group: '后端接口', description: '管理员预览和执行维护中心清理。' },
  { id: 'api.workflow.manage', name: '流程模板管理 API', type: 'api', group: '后端接口', description: '新增、编辑、删除自定义流程模板。' }
];
const allPermissionIds = permissionCatalog.map(item => item.id);
const levelPermissions = {
  4: allPermissionIds,
  3: [
    'menu.tasks', 'menu.skillList', 'menu.aiMembers', 'menu.codexConfig', 'menu.runs', 'menu.agentWorkers', 'menu.aiArchive',
    'task.sync', 'task.note.manage', 'task.artBrief.generate', 'task.codexPrompt.copy',
    'run.create', 'run.codex.execute', 'run.directSkill.create', 'run.directSkill.workerCommand', 'workflow.manage.view', 'run.log.view', 'run.artifact.download', 'run.start', 'run.cancel', 'review.submit', 'review.image.submit',
    'skill.scan.refresh', 'skill.source.connect', 'skill.source.edit', 'skill.asset.create', 'skill.assetOwner.manage', 'skill.version.manage', 'skill.alias.manage', 'skill.usageLogs.view', 'skill.preview.view',
    'aiMembers.board.view', 'aiMembers.score.view',
    'archive.detail.view', 'archive.link.view',
    'api.taskNotes.manage', 'api.taskArtBrief.generate', 'api.runs.execute', 'api.agentRuns.create', 'api.agentWorkers.read', 'api.agentWorkers.heartbeat', 'api.agentWorkers.alias', 'api.agentRuns.claim', 'api.agentRuns.log', 'api.agentRuns.status', 'api.reviews.submit', 'api.codex.config.read', 'api.skillSources.manage', 'api.skillScan.run', 'api.skillVersion.manage', 'api.skillAlias.manage', 'api.skillAsset.create', 'api.aiMembers.read', 'api.aiMembers.score.read'
  ],
  2: [
    'menu.tasks', 'menu.skillList', 'menu.aiMembers', 'menu.runs', 'menu.aiArchive',
    'task.codexPrompt.copy', 'review.submit', 'review.image.submit', 'skill.alias.manage', 'skill.usageLogs.view', 'aiMembers.score.view', 'api.reviews.submit', 'api.skillAlias.manage', 'api.aiMembers.read', 'api.aiMembers.score.read'
  ],
  1: ['menu.tasks', 'menu.skillList', 'menu.aiMembers', 'skill.usageLogs.view', 'aiMembers.score.view', 'api.aiMembers.read', 'api.aiMembers.score.read']
};
const defaultRoles = [
  {
    id: 'admin',
    builtinKey: 'admin',
    name: '美术负责人',
    description: '管理美术部门任务、用户、角色和所有执行记录。',
    level: 4,
    permissions: levelPermissions[4],
    system: true,
    disabled: false
  },
  {
    id: 'developer',
    builtinKey: 'developer',
    name: '美术执行人',
    description: '创建并启动执行，管理任务同步和美术流程。',
    level: 3,
    permissions: levelPermissions[3],
    system: true,
    disabled: false
  },
  {
    id: 'reviewer',
    builtinKey: 'reviewer',
    name: '美术验证人',
    description: '查看任务并提交人工复核或 Skill 验证结论。',
    level: 2,
    permissions: levelPermissions[2],
    system: true,
    disabled: false
  },
  {
    id: 'viewer',
    builtinKey: 'viewer',
    name: '组员只读',
    description: '只读查看任务、执行记录和部门资产。',
    level: 1,
    permissions: levelPermissions[1],
    system: true,
    disabled: false
  }
];
export const authConfig = {
  sessionCookieName,
  sessionMaxAgeMs,
  sessionIdleMaxAgeMs
};

export async function ensureDefaultAdmin() {
  await ensureDefaultRoles();
  const users = await listUsersRaw();
  if (users.length) return null;
  const adminRole = await findBuiltinRole('admin');
  const username = process.env.AWP_ADMIN_USERNAME || 'admin';
  const password = process.env.AWP_ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    username,
    displayName: '美术负责人',
    role: adminRole?.id || 'admin',
    projectIds: ['*'],
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: ''
  };
  await writeUsersRaw([user]);
  return { username, password };
}

export async function ensureDefaultRoles() {
  const roles = await listRolesRaw();
  const byBuiltinKey = new Map(roles.map(role => [resolveRoleBuiltinKey(role), role]).filter(([key]) => key));
  let changed = false;
  for (const role of defaultRoles) {
    const builtinKey = resolveRoleBuiltinKey(role);
    const existing = builtinKey ? byBuiltinKey.get(builtinKey) : null;
    if (!existing) {
      roles.push(normalizeRoleRecord(role, true));
      changed = true;
    } else {
      if (existing.system !== true) {
        existing.system = true;
        existing.updatedAt = new Date().toISOString();
        changed = true;
      }
      if (builtinKey && existing.builtinKey !== builtinKey) {
        existing.builtinKey = builtinKey;
        existing.updatedAt = new Date().toISOString();
        changed = true;
      }
      // Respect role-management edits for builtin roles. We only normalize stored
      // permissions here, and no longer force-merge legacy additions on every read.
      const normalizedPermissions = normalizePermissions(existing.permissions || []);
      if (JSON.stringify(normalizedPermissions) !== JSON.stringify(existing.permissions || [])) {
        existing.permissions = normalizedPermissions;
        existing.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
  }
  if (changed) await writeRolesRaw(sortRoles(roles));
  return roles;
}

export async function authenticateRequest(req, options = {}) {
  const token = parseCookies(req.headers.cookie || '')[sessionCookieName];
  if (!token) return null;
  const sessions = await listSessionsRaw();
  const sessionIndex = sessions.findIndex(item => item.token === token);
  const session = sessions[sessionIndex];
  if (!session) return null;
  const now = Date.now();
  const expiresAt = Date.parse(session.expiresAt || '');
  const lastSeenAt = Date.parse(session.lastSeenAt || session.createdAt || '');
  if (expiresAt <= now || (lastSeenAt && now - lastSeenAt > sessionIdleMaxAgeMs)) {
    await writeSessionsRaw(sessions.filter(item => item.token !== token));
    if (options.includeExpired) return { expired: true, session };
    return null;
  }
  const users = await listUsersRaw();
  const user = users.find(item => item.id === session.userId && item.disabled !== true);
  if (!user) return null;
  sessions[sessionIndex] = {
    ...session,
    lastSeenAt: new Date(now).toISOString()
  };
  await writeSessionsRaw(sessions);
  return hydrateUserPermissions(publicUser(user));
}

export async function loginUser(username, password) {
  const account = String(username || '').trim();
  if (!account || !password) return null;
  const users = await listUsersRaw();
  const user = users.find(item => item.disabled !== true && item.username === account);
  if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
  const now = new Date();
  const token = randomBytes(32).toString('base64url');
  const sessions = await listSessionsRaw();
  sessions.push({
    id: randomUUID(),
    token,
    userId: user.id,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionMaxAgeMs).toISOString()
  });
  await writeSessionsRaw(sessions.filter(item => Date.parse(item.expiresAt || '') > now.getTime()));
  user.lastLoginAt = now.toISOString();
  user.updatedAt = now.toISOString();
  await writeUsersRaw(users);
  return { user: await hydrateUserPermissions(publicUser(user)), token };
}

export async function logoutUser(req) {
  const token = parseCookies(req.headers.cookie || '')[sessionCookieName];
  if (!token) return;
  const sessions = await listSessionsRaw();
  await writeSessionsRaw(sessions.filter(item => item.token !== token));
}

export async function listPublicUsers() {
  const users = await listUsersRaw();
  const roles = await listRoles();
  const passwordRecords = await listPasswordRecords();
  return users.map(user => publicUser(user, roles, passwordRecords)).sort((a, b) => String(a.username).localeCompare(String(b.username)));
}

export async function listAgentWorkerUsers() {
  const users = await listUsersRaw();
  const roles = await listRoles();
  return users
    .map(user => publicUser(user, roles, {}))
    .filter(user => user.disabled !== true)
    .map(user => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      role: user.role,
      roleBuiltinKey: user.roleBuiltinKey || '',
      roleName: user.roleName || '',
      permissions: user.permissions || [],
      projectIds: user.projectIds || []
    }))
    .sort((a, b) => String(a.displayName || a.username || '').localeCompare(String(b.displayName || b.username || ''), 'zh-Hans-CN'));
}

export async function listRoles() {
  await ensureDefaultRoles();
  const roles = await listRolesRaw();
  return sortRoles(roles.map(publicRole));
}

export function listPermissionCatalog() {
  return permissionCatalog;
}

export async function upsertRole(input = {}) {
  await ensureDefaultRoles();
  const roles = await listRolesRaw();
  const existingId = String(input.existingId || '').trim();
  const existingBuiltinKey = String(input.builtinKey || '').trim().toLowerCase();
  const role = normalizeRoleRecord({
    ...input,
    id: input.id || uniqueRoleId(input.name, roles)
  });
  const previousIndex = existingId ? roles.findIndex(item => item.id === existingId) : -1;
  const index = previousIndex >= 0 ? previousIndex : roles.findIndex(item => item.id === role.id);
  if (index >= 0) {
    const previous = roles[index];
    if (role.id !== previous.id && roles.some((item, itemIndex) => itemIndex !== index && item.id === role.id)) {
      throw statusError(409, '角色英文标识已存在，请换一个。');
    }
    roles[index] = {
      ...previous,
      ...role,
      builtinKey: previous.builtinKey || role.builtinKey || '',
      system: input.system === undefined ? previous.system === true : input.system === true,
      createdAt: previous.createdAt || role.createdAt,
      updatedAt: new Date().toISOString()
    };
    if (role.id !== previous.id) {
      const users = await listUsersRaw();
      let changed = false;
      for (const user of users) {
        if (String(user.role || '') !== previous.id) continue;
        user.role = role.id;
        user.updatedAt = new Date().toISOString();
        changed = true;
      }
      if (changed) await writeUsersRaw(users);
    }
  } else {
    if (roles.some(item => item.id === role.id)) throw statusError(409, '角色英文标识已存在，请换一个。');
    const nextRole = {
      ...role,
      builtinKey: existingBuiltinKey || role.builtinKey || ''
    };
    roles.push(nextRole);
  }
  await writeRolesRaw(sortRoles(roles));
  const savedRole = index >= 0 ? roles[index] : roles.find(item => item.id === role.id) || role;
  return publicRole(savedRole);
}

export async function deleteRole(id, options = {}) {
  await ensureDefaultRoles();
  const roleId = String(id || '').trim();
  const roles = await listRolesRaw();
  const role = roles.find(item => item.id === roleId);
  if (!role) throw statusError(404, '角色不存在。');
  const users = await listUsersRaw();
  const linkedUsers = users.filter(user => String(user.role || '') === roleId);
  const replacementRoleId = String(options.replacementRoleId || '').trim();
  if (linkedUsers.length) {
    if (!replacementRoleId) {
      const error = statusError(409, '该角色已有账号使用，请先选择替换角色。');
      error.details = {
        code: 'ROLE_IN_USE',
        linkedUserCount: linkedUsers.length,
        linkedUsers: linkedUsers.map(user => ({
          id: user.id,
          username: user.username || '',
          displayName: user.displayName || user.username || ''
        }))
      };
      throw error;
    }
    const replacement = roles.find(item => item.id === replacementRoleId);
    if (!replacement || replacement.disabled === true || replacement.id === roleId) {
      throw statusError(400, '请选择一个有效的替换角色。');
    }
    for (const user of linkedUsers) {
      user.role = replacement.id;
      user.updatedAt = new Date().toISOString();
    }
    await writeUsersRaw(users);
  }
  await writeRolesRaw(roles.filter(item => item.id !== roleId));
  return publicRole(role);
}

export async function createUser(input = {}) {
  const username = String(input.username || '').trim();
  const password = String(input.password || '12345678');
  if (!/^[a-zA-Z0-9._-]{2,40}$/.test(username)) throw statusError(400, '用户名只能包含字母、数字、点、下划线和短横线，长度 2-40。');
  if (password.length < 8) throw statusError(400, '密码至少 8 位。');
  const role = await normalizeExistingRole(input.role);
  const users = await listUsersRaw();
  if (users.some(item => item.username === username)) throw statusError(409, '用户名已存在。');
  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    username,
    displayName: String(input.displayName || username).trim(),
    role,
    projectIds: normalizeProjectIds(input.projectIds),
    passwordHash: await hashPassword(password),
    mustChangePassword: input.mustChangePassword === false ? false : true,
    disabled: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: ''
  };
  users.push(user);
  await writeUsersRaw(users);
  await recordPasswordDisplay(user, password, '创建账号');
  return publicUser(user, [], await listPasswordRecords());
}

export async function updateUser(id, input = {}) {
  const users = await listUsersRaw();
  const index = users.findIndex(item => item.id === id);
  if (index === -1) throw statusError(404, '用户不存在。');
  const user = users[index];
  const nextUsername = input.username === undefined ? user.username : String(input.username || '').trim();
  if (!/^[a-zA-Z0-9._-]{2,40}$/.test(nextUsername)) throw statusError(400, '用户名只能包含字母、数字、点、下划线和短横线，长度 2-40。');
  if (users.some(item => item.id !== id && item.username === nextUsername)) throw statusError(409, '用户名已存在。');
  const nextRole = input.role === undefined ? user.role : await normalizeExistingRole(input.role);
  const nextProjectIds = input.projectIds === undefined ? user.projectIds : normalizeProjectIds(input.projectIds);
  const nextDisabled = input.disabled === undefined ? user.disabled === true : Boolean(input.disabled);
  const adminUsers = await listBuiltinUsers(users, 'admin');
  if (await isBuiltinRoleId(user.role, 'admin') && (!(await isBuiltinRoleId(nextRole, 'admin')) || nextDisabled) && adminUsers.length <= 1) {
    throw statusError(400, '至少保留一个启用状态的管理员账号。');
  }
  users[index] = {
    ...user,
    username: nextUsername,
    displayName: input.displayName === undefined ? user.displayName : String(input.displayName || nextUsername).trim(),
    role: nextRole,
    projectIds: nextProjectIds,
    mustChangePassword: input.mustChangePassword === undefined ? user.mustChangePassword === true : Boolean(input.mustChangePassword),
    disabled: nextDisabled,
    updatedAt: new Date().toISOString()
  };
  await writeUsersRaw(users);
  if (nextDisabled) await revokeUserSessions(id);
  return publicUser(users[index], [], await listPasswordRecords());
}

export async function deleteUser(id, currentUserId = '') {
  const users = await listUsersRaw();
  const index = users.findIndex(item => item.id === id);
  if (index === -1) throw statusError(404, '用户不存在。');
  const user = users[index];
  if (user.id === currentUserId) throw statusError(400, '不能删除当前登录账号。');
  const adminUsers = await listBuiltinUsers(users, 'admin');
  if (await isBuiltinRoleId(user.role, 'admin') && adminUsers.length <= 1) {
    throw statusError(400, '至少保留一个启用状态的管理员账号。');
  }
  users.splice(index, 1);
  await writeUsersRaw(users);
  await revokeUserSessions(id);
  return publicUser(user, [], await listPasswordRecords());
}

export async function resetUserPassword(id, password = '') {
  if (String(password).length < 8) throw statusError(400, '密码至少 8 位。');
  const users = await listUsersRaw();
  const index = users.findIndex(item => item.id === id);
  if (index === -1) throw statusError(404, '用户不存在。');
  users[index] = {
    ...users[index],
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    updatedAt: new Date().toISOString()
  };
  await writeUsersRaw(users);
  await recordPasswordDisplay(users[index], password, '重置密码');
  await revokeUserSessions(id);
  return publicUser(users[index], [], await listPasswordRecords());
}

export async function recordUserVisiblePassword(id, password = '', source = '手动登记') {
  if (String(password).length < 1) throw statusError(400, '请填写需要展示的密码。');
  const users = await listUsersRaw();
  const user = users.find(item => item.id === id);
  if (!user) throw statusError(404, '用户不存在。');
  await recordPasswordDisplay(user, password, source);
  return publicUser(user, [], await listPasswordRecords());
}

export async function changeOwnPassword(id, currentPassword = '', nextPassword = '') {
  if (String(nextPassword).length < 8) throw statusError(400, '密码至少 8 位。');
  const users = await listUsersRaw();
  const index = users.findIndex(item => item.id === id);
  if (index === -1) throw statusError(404, '用户不存在。');
  const user = users[index];
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw statusError(400, '当前密码不正确。');
  }
  users[index] = {
    ...user,
    passwordHash: await hashPassword(nextPassword),
    mustChangePassword: false,
    updatedAt: new Date().toISOString()
  };
  await writeUsersRaw(users);
  await recordPasswordDisplay(users[index], nextPassword, '本人修改');
  await revokeUserSessions(id);
  return publicUser(users[index], [], await listPasswordRecords());
}

async function revokeUserSessions(userId) {
  const sessions = await listSessionsRaw();
  await writeSessionsRaw(sessions.filter(item => item.userId !== userId));
}

export function requireAuth(user) {
  if (!user) throw statusError(401, '未登录或登录已过期。');
  return user;
}

export function requireRole(user, role) {
  requireAuth(user);
  if (roleLevel(user.role) < roleLevel(role)) {
    throw statusError(403, '当前账号没有权限执行该操作。');
  }
  return user;
}

export function requirePermission(user, permission) {
  requireAuth(user);
  if (!hasPermission(user, permission)) {
    throw statusError(403, '当前账号没有权限执行该操作。');
  }
  return user;
}

export function requireAnyPermission(user, permissions = []) {
  requireAuth(user);
  if (!permissions.some(permission => hasPermission(user, permission))) {
    throw statusError(403, '当前账号没有权限执行该操作。');
  }
  return user;
}

export function requireProjectAccess(user, projectId, role = 'viewer', permission = '') {
  if (permission) requirePermission(user, permission);
  else requireRole(user, role);
  if (!canAccessProject(user, projectId)) {
    throw statusError(403, '当前账号没有该项目权限。');
  }
  return user;
}

export function hasPermission(user, permission) {
  if (!permission) return true;
  if (!user) return false;
  if (isAdminUser(user)) return true;
  return new Set(user.permissions || []).has(permission);
}

export function canAccessProject(user, projectId) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  const ids = Array.isArray(user.projectIds) ? user.projectIds : [];
  return ids.includes('*') || ids.includes(projectId);
}

export function isAdminUser(user = {}) {
  const builtinKey = normalizeBuiltinKey(user?.roleBuiltinKey);
  if (builtinKey) return builtinKey === 'admin';
  return isAdminRole(user?.role);
}

export function isBuiltinRole(user = {}, builtinKey = '') {
  if (!user) return false;
  const expected = normalizeBuiltinKey(builtinKey);
  if (!expected) return false;
  const current = normalizeBuiltinKey(user?.roleBuiltinKey);
  if (current) return current === expected;
  return String(user?.role || '').trim().toLowerCase() === expected;
}

export function publicUser(user = {}, roles = [], passwordRecords = {}) {
  const role = roles.find(item => item.id === user.role);
  const passwordRecord = passwordRecords[user.id] || passwordRecords[user.username] || null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: String(user.role || '').trim() || 'viewer',
    roleName: role?.name || '',
    roleBuiltinKey: role?.builtinKey || resolveRoleBuiltinKey(role) || '',
    permissions: normalizePermissions(role?.permissions || user.permissions || []),
    projectIds: normalizeProjectIds(user.projectIds),
    mustChangePassword: user.mustChangePassword === true,
    disabled: user.disabled === true,
    createdAt: user.createdAt || '',
    updatedAt: user.updatedAt || '',
    lastLoginAt: user.lastLoginAt || '',
    passwordDisplay: passwordRecord?.password || '',
    passwordRecordedAt: passwordRecord?.updatedAt || '',
    passwordSource: passwordRecord?.source || ''
  };
}

async function listPasswordRecords() {
  try {
    const raw = await readFile(passwordDisplayPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function recordPasswordDisplay(user = {}, password = '', source = '') {
  const value = String(password || '').trim();
  if (!user.id || !value) return;
  const records = await listPasswordRecords();
  const record = {
    userId: user.id,
    username: user.username || '',
    displayName: user.displayName || user.username || '',
    password: value,
    source,
    updatedAt: new Date().toISOString()
  };
  records[user.id] = record;
  if (user.username) records[user.username] = record;
  await writeFile(passwordDisplayPath(), `${JSON.stringify(records, null, 2)}\n`);
}

function passwordDisplayPath() {
  return path.join(paths.dataDir, 'user-password-display.json');
}

export function buildSessionCookie(token) {
  const maxAge = Math.floor(sessionMaxAgeMs / 1000);
  return `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function normalizeRole(role = '') {
  return String(role || 'viewer').trim() || 'viewer';
}

async function normalizeExistingRole(role = '') {
  await ensureDefaultRoles();
  const roleId = String(role || '').trim() || 'viewer';
  const roles = await listRolesRaw();
  const matched = roles.find(item => item.id === roleId && item.disabled !== true);
  if (!matched) throw statusError(400, '请选择有效角色。');
  return matched.id;
}

function roleLevel(role = '') {
  const normalized = String(role || '').trim().toLowerCase();
  if (roleRank[normalized]) return roleRank[normalized];
  return 1;
}

function normalizeRoleRecord(input = {}, systemDefault = false) {
  const now = new Date().toISOString();
  const id = String(input.id || input.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) throw statusError(400, '角色标识不能为空。');
  const builtinKey = normalizeBuiltinKey(input.builtinKey || (systemDefault ? id : ''));
  const level = Math.max(1, Math.min(4, Number(input.level || roleRank[builtinKey] || roleRank[id] || 1)));
  return {
    id,
    builtinKey,
    name: String(input.name || id).trim(),
    description: String(input.description || '').trim(),
    level,
    permissions: normalizePermissions(input.permissions),
    system: systemDefault || input.system === true,
    disabled: input.disabled === true,
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

function uniqueRoleId(name = '', roles = []) {
  const base = slugifyRole(name) || `role-${Date.now()}`;
  const used = new Set(roles.map(role => role.id));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function slugifyRole(value = '') {
  const raw = String(value || '').trim();
  const ascii = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii) return ascii;
  const encoded = [...raw].map(char => char.codePointAt(0).toString(36)).join('-');
  return encoded ? `role-${encoded}` : '';
}

function normalizePermissions(value = []) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(permissionCatalog.map(item => item.id));
  return [...new Set(value.flatMap(item => expandLegacyPermission(item)).map(item => String(item || '').trim()).filter(item => allowed.has(item)))];
}

function publicRole(role = {}) {
  return {
    id: role.id,
    builtinKey: resolveRoleBuiltinKey(role),
    name: role.name || role.id,
    description: role.description || '',
    level: Number(role.level || roleRank[resolveRoleBuiltinKey(role)] || roleRank[role.id] || 1),
    permissions: normalizePermissions(role.permissions),
    system: role.system === true,
    disabled: role.disabled === true,
    createdAt: role.createdAt || '',
    updatedAt: role.updatedAt || ''
  };
}

async function hydrateUserPermissions(user) {
  const roles = await listRoles();
  const role = roles.find(item => item.id === user.role);
  return {
    ...user,
    roleName: role?.name || user.roleName || '',
    permissions: normalizePermissions(role?.permissions || user.permissions || [])
  };
}

function isAdminRole(roleId = '') {
  const value = String(roleId || '').trim().toLowerCase();
  return defaultRoleAliases.admin.includes(value);
}

function normalizeBuiltinKey(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(defaultRoleAliases, normalized) ? normalized : '';
}

function resolveRoleBuiltinKey(role = {}) {
  const builtinKey = normalizeBuiltinKey(role?.builtinKey);
  if (builtinKey) return builtinKey;
  if (role?.system === true) {
    const id = String(role?.id || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(defaultRoleAliases, id)) return id;
  }
  return '';
}

async function findBuiltinRole(builtinKey = '') {
  await ensureDefaultRoles();
  const normalizedKey = normalizeBuiltinKey(builtinKey);
  if (!normalizedKey) return null;
  const roles = await listRolesRaw();
  return roles.find(role => resolveRoleBuiltinKey(role) === normalizedKey) || null;
}

async function isBuiltinRoleId(roleId = '', builtinKey = '') {
  const role = await findRoleById(roleId);
  return resolveRoleBuiltinKey(role) === normalizeBuiltinKey(builtinKey);
}

async function findRoleById(roleId = '') {
  await ensureDefaultRoles();
  const normalizedId = String(roleId || '').trim();
  if (!normalizedId) return null;
  const roles = await listRolesRaw();
  return roles.find(role => role.id === normalizedId) || null;
}

async function listBuiltinUsers(users = [], builtinKey = '') {
  const normalizedKey = normalizeBuiltinKey(builtinKey);
  if (!normalizedKey) return [];
  const roles = await listRolesRaw();
  const ids = new Set(roles.filter(role => resolveRoleBuiltinKey(role) === normalizedKey).map(role => role.id));
  return users.filter(user => user.disabled !== true && ids.has(String(user.role || '').trim()));
}

function expandLegacyPermission(permission = '') {
  const value = String(permission || '').trim();
  const legacy = {
    'projects.manage': ['skill.source.connect', 'skill.source.edit', 'skill.source.delete', 'api.skillSources.manage', 'api.skillSources.delete'],
    'runs.execute': ['run.create', 'run.start', 'run.cancel', 'task.sync', 'api.runs.execute'],
    'agentRuns.manage': ['menu.agentWorkers', 'menu.aiArchive', 'run.directSkill.create', 'run.directSkill.workerCommand', 'api.agentRuns.create', 'api.agentWorkers.read', 'api.agentWorkers.heartbeat', 'api.agentWorkers.alias', 'api.agentRuns.claim', 'api.agentRuns.log', 'api.agentRuns.status'],
    'aiArchive.manage': ['menu.aiArchive', 'api.aiArchive.delete'],
    'runs.delete': ['run.delete', 'api.runs.delete'],
    'reviews.submit': ['review.submit', 'api.reviews.submit'],
    'users.manage': ['menu.users', 'user.manage', 'api.users.manage'],
    'roles.manage': ['menu.roles', 'role.manage', 'api.roles.manage'],
    'operationLogs.read': ['menu.operationLogs', 'api.operationLogs.read'],
    'menu.projects': ['menu.skillList'],
    'menu.repository': ['menu.skillList', 'skill.source.connect', 'skill.source.edit'],
    'menu.skillManagement': ['menu.skillList'],
    'menu.skillMembers': ['menu.skillList'],
    'menu.aiMembers': ['menu.aiMembers', 'aiMembers.score.view', 'api.aiMembers.read', 'api.aiMembers.score.read'],
    'menu.aiMembers.owner': ['menu.aiMembers', 'aiMembers.score.view', 'api.aiMembers.read', 'api.aiMembers.score.read'],
    'menu.aiMembers.member': ['menu.aiMembers', 'aiMembers.score.view', 'api.aiMembers.read', 'api.aiMembers.score.read'],
    'project.create': ['skill.source.connect', 'api.skillSources.manage'],
    'project.edit': ['skill.source.edit', 'api.skillSources.manage'],
    'project.delete': ['skill.source.delete', 'api.skillSources.delete'],
    'artProjectSheet.manage': ['skill.source.connect', 'skill.source.edit', 'api.skillSources.manage'],
    'api.projects.manage': ['api.skillSources.manage'],
    'api.artProjectSheet.manage': ['api.skillSources.manage'],
    'api.aiAssets.manage': ['api.skillAsset.create', 'api.skillAsset.void'],
    'api.skillValidations.manage': ['api.skillAsset.create', 'api.skillAsset.void'],
    'api.artProgress.manage': ['api.skillAsset.create', 'api.skillAsset.void'],
    'skill.asset.manage': ['skill.asset.create', 'skill.asset.void', 'skill.source.connect', 'skill.scan.refresh', 'api.skillAsset.create', 'api.skillAsset.void', 'api.skillSources.manage', 'api.skillScan.run'],
    'skill.validationColumns.manage': ['api.taskCenter.config.manage'],
    'skill.validationOwner.manage': ['skill.assetOwner.manage'],
    'artProgress.operationLogs.view': ['api.skillAsset.create'],
    'artProgress.accessLogs.view': ['api.skillAsset.create'],
    'artProgress.logs.manage': ['api.skillAsset.create', 'api.skillAsset.void'],
    'artProgress.logs.delete': ['api.skillAsset.void']
  };
  return legacy[value] || [value];
}

function sortRoles(roles = []) {
  return [...roles].sort((a, b) => Number(b.level || 0) - Number(a.level || 0) || String(a.id).localeCompare(String(b.id)));
}

function normalizeProjectIds(value = []) {
  if (value === '*') return ['*'];
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || '').trim()).filter(Boolean);
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(String(password), salt, 64);
  return `scrypt:${salt}:${derived.toString('base64url')}`;
}

async function verifyPassword(password, stored = '') {
  const [scheme, salt, hash] = String(stored).split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(String(password), salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header || '').split(';').map(part => {
    const index = part.indexOf('=');
    if (index === -1) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
