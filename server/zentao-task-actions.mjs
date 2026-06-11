import { getZentaoApi } from './zentao-adapter.mjs';

export const artAssigneeOptions = [
  { account: 'lilh', realname: '李华玲' },
  { account: 'yejunbo', realname: '叶君博' },
  { account: 'zhangzb', realname: '张宗斌' },
  { account: 'lanhj', realname: '兰韩界' },
  { account: 'huangjianrong', realname: '黄剑荣' },
  { account: 'fengshuqi', realname: '冯淑琪' },
  { account: 'yushengwei', realname: '余盛威' }
];

export async function assignZentaoTask(task = {}, assignee = {}, options = {}) {
  const taskId = zentaoTaskId(task);
  const assignedTo = String(assignee.account || assignee.assignedTo || '').trim();
  if (!taskId) throw new Error('缺少禅道任务 ID，无法指派');
  if (!assignedTo) throw new Error('缺少成员禅道账号，无法指派');

  const api = await getZentaoApi();
  const detail = unwrapTask(await api.request({ method: 'GET', path: `/api.php/v1/tasks/${taskId}` }));
  const attempts = [];
  try {
    await classicAssignTask(api, detail, task, {
      assignedTo,
      comment: explicitZentaoComment(options)
    });
    attempts.push('assignTo');
  } catch (error) {
    attempts.push(`assignTo失败：${error.message || error}`);
    throw new Error(`禅道指派提交失败（${attempts.join('；')}）。为避免取消父任务或需求关联，已停止提交编辑任务表单。`);
  }

  const fresh = await waitForAssignedTask(api, taskId, assignedTo, assignee);
  if (taskAssigneeMatches(fresh, assignedTo, assignee)) return fresh;
  const currentAssignee = describeTaskAssignee(fresh);
  throw new Error(`禅道指派验证失败，当前负责人仍为 ${currentAssignee || '空'}（已尝试：${attempts.join('；')}）`);
}

export async function buildZentaoSplitPlan(task = {}) {
  const taskId = zentaoTaskId(task);
  if (!taskId) throw new Error('缺少禅道任务 ID，无法拆单');
  const api = await getZentaoApi();
  const detail = unwrapTask(await api.request({ method: 'GET', path: `/api.php/v1/tasks/${taskId}` }));
  const title = String(firstValue(detail.name, detail.title, task.title, task.displayTitle)).replace(/\s+/g, ' ').trim();
  const baseName = getBaseName(title);
  const text = `${title}\n${detail.desc || ''}\n${task.requirement || ''}\n${task.zentao?.storyTitle || ''}`;
  const deadline = validDate(detail.deadline || task.deadline || task.zentao?.deadline);
  const executionId = executionIdOf(detail, task);
  const main = recommendedMainAssignee(text);
  const children = [];

  if (/入口图标|入口图|入口icon|新增子游戏|新增小游戏|新增游戏/i.test(text)) {
    children.push(childRow(`【制作单】${baseName || title}`, 'yushengwei', deadline, executionId, taskId, 0));
  } else if (/走查/i.test(text) || /【\s*(?:美术)?验收单\s*】|美术验收/i.test(text)) {
    [
      ['【验收单】', '-白', 'lanhj'],
      ['【验收单】', '-2皮肤', 'fengshuqi'],
      ['【验收单】', '-12', 'zhangzb'],
      ['【验收单】', '-10', 'lilh'],
      ['【验收单】', '-2主套', 'huangjianrong']
    ].forEach(([prefix, suffix, account], index) => {
      children.push(childRow(`${prefix}${baseName || title}${suffix}`, account, deadline, executionId, taskId, index));
    });
  } else if (/web5?|web/i.test(text)) {
    children.push(childRow(`【制作单】${baseName || title}-2`, /皮肤/i.test(text) ? 'fengshuqi' : 'huangjianrong', deadline, executionId, taskId, 0));
    if (/cocos|(?:^|[^A-Za-z])cos\s*端|cos\s*15/i.test(text)) {
      children.push(childRow(`【制作单】${baseName || title}-cocos`, /15/.test(text) ? 'zhangzb' : 'lilh', deadline, executionId, taskId, 1));
    }
    if (/cocos\s*15|cos\s*15/i.test(text)) {
      children.push(childRow(`【制作单】${baseName || title}-15`, 'yejunbo', deadline, executionId, taskId, 2));
    }
  } else {
    children.push(childRow(`【制作单】${baseName || title}`, main.account, deadline, executionId, taskId, 0));
  }

  return {
    taskId,
    title,
    deadline,
    executionId,
    parent: taskId,
    mainAssignee: main.account,
    assignees: artAssigneeOptions,
    children
  };
}

export async function applyZentaoSplitPlan(task = {}, plan = {}, options = {}) {
  const taskId = zentaoTaskId(task);
  if (!taskId) throw new Error('缺少禅道任务 ID，无法拆单');
  const api = await getZentaoApi();
  const detail = unwrapTask(await api.request({ method: 'GET', path: `/api.php/v1/tasks/${taskId}` }));
  const results = [];
  const mainAssignee = String(plan.mainAssignee || '').trim();
  if (mainAssignee) {
    try {
      const fresh = await assignZentaoTask({ ...task, ...detail, taskNo: taskId, zentao: { ...(task.zentao || {}), id: taskId } }, { account: mainAssignee }, {
        comment: explicitZentaoComment(options),
        allowZentaoComment: options.allowZentaoComment === true
      });
      results.push({ type: 'main', ok: true, taskId, assignedTo: describeTaskAssignee(fresh) || mainAssignee });
    } catch (error) {
      results.push({ type: 'main', ok: false, taskId, assignedTo: mainAssignee, error: error.message || String(error) });
    }
  }

  const children = Array.isArray(plan.children) ? plan.children : [];
  for (const row of children) {
    if (row.enabled === false) continue;
    const name = String(row.name || '').trim();
    const assignedTo = String(row.assignedTo || '').trim();
    if (!name || !assignedTo) continue;
    try {
      const created = await createChildTaskClassic(api, detail, task, {
        ...row,
        name,
        assignedTo,
        parent: row.parent || taskId,
        executionId: row.executionId || plan.executionId || executionIdOf(detail, task)
      });
      results.push({
        type: 'child',
        ok: true,
        taskId: String(created.id || ''),
        name: created.name || name,
        assignedTo: created.assignedTo || assignedTo,
        parent: created.parent || '',
        story: created.story || '',
        execution: created.execution || ''
      });
    } catch (error) {
      results.push({ type: 'child', ok: false, taskId: '', name, assignedTo, error: error.message || String(error) });
    }
  }
  const failed = results.filter(item => item.ok === false);
  return { taskId, results, ok: failed.length === 0, failedCount: failed.length, successCount: results.length - failed.length };
}

async function classicAssignTask(api, detail = {}, task = {}, updates = {}) {
  const taskId = zentaoTaskId(task) || zentaoTaskId(detail);
  const executionId = String(executionIdOf(detail, task) || '').trim();
  if (!taskId) throw new Error('缺少禅道任务 ID，无法指派');
  if (!executionId) throw new Error('所属版本为空，无法提交禅道指派');

  const path = `index.php?m=task&f=assignTo&executionID=${encodeURIComponent(executionId)}&taskID=${encodeURIComponent(taskId)}&onlybody=yes`;
  const html = await classicGet(api, path, `index.php?m=task&f=view&taskID=${taskId}&onlybody=yes`);
  const body = taskAssignBodyFromForm(html, detail, task, updates);
  await classicPost(api, path, body, path);
}

async function waitForAssignedTask(api, taskId, assignedTo, assignee = {}) {
  let fresh = {};
  for (let index = 0; index < 3; index += 1) {
    fresh = unwrapTask(await api.request({ method: 'GET', path: `/api.php/v1/tasks/${taskId}` }));
    if (taskAssigneeMatches(fresh, assignedTo, assignee)) return fresh;
    await new Promise(resolve => setTimeout(resolve, 260 + index * 220));
  }
  return fresh;
}

function taskAssigneeMatches(task = {}, assignedTo = '', assignee = {}) {
  const expectedAccount = String(assignedTo || assignee.account || '').trim().toLowerCase();
  const expectedName = String(assignee.realname || assignee.name || '').trim().toLowerCase();
  const candidates = taskAssigneeCandidates(task).map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
  if (expectedAccount && candidates.includes(expectedAccount)) return true;
  if (expectedName && candidates.includes(expectedName)) return true;
  return false;
}

function describeTaskAssignee(task = {}) {
  return taskAssigneeCandidates(task).find(Boolean) || '';
}

function taskAssigneeCandidates(task = {}) {
  const brother = task?.brother && typeof task.brother === 'object'
    ? task.brother[String(zentaoTaskId(task))]
    : null;
  const nestedTask = task?.task && typeof task.task === 'object' ? task.task : null;
  return [
    task.assignedTo,
    task.assignedToName,
    task.assignedToRealName,
    task.assignedTo?.account,
    task.assignedTo?.realname,
    task.assignedTo?.name,
    nestedTask?.assignedTo,
    nestedTask?.assignedToName,
    nestedTask?.assignedToRealName,
    nestedTask?.assignedTo?.account,
    nestedTask?.assignedTo?.realname,
    nestedTask?.assignedTo?.name,
    brother?.assignedTo,
    brother?.assignedToName,
    brother?.assignedToRealName,
    brother?.assignedTo?.account,
    brother?.assignedTo?.realname,
    brother?.assignedTo?.name
  ].flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => accountName(value) || personName(value))
    .filter(Boolean);
}

function taskAssignBodyFromForm(html = '', detail = {}, task = {}, updates = {}) {
  const formHtml = formHtmlWithFields(html, ['assignedTo', 'left']) || firstFormHtml(html);
  const body = formBodyFromHtml(formHtml || html);
  const uid = String(html.match(/\bvar\s+kuid\s*=\s*['"]([^'"]+)['"]/)?.[1] || '').trim();
  const assignedTo = String(updates.assignedTo || accountName(detail.assignedTo) || '').trim();

  if (uid) setFormValue(body, 'uid', uid);
  setFormValue(body, 'assignedTo', assignedTo);
  if (hasExplicitText(updates.comment)) setFormValue(body, 'comment', updates.comment);
  else body.delete('comment');
  ensureFormValue(body, 'env', detail.env || task.zentao?.env || '');
  ensureFormValue(body, 'estStarted', validDate(detail.estStarted || task.zentao?.estStarted || ''));
  setFormValue(body, 'deadline', validDate(detail.deadline || task.deadline || task.zentao?.deadline || body.get('deadline')));
  setFormValue(body, 'estimate', classicRequiredHour(firstValue(detail.estimate, task.estimate, task.zentao?.estimate, body.get('estimate'), 0)));
  setFormValue(body, 'left', classicRequiredHour(firstValue(detail.left, task.zentao?.left, body.get('left'), 0)));
  ensureFormValue(body, 'relatedModules', detail.relatedModules || task.zentao?.relatedModules || '');
  setFormValue(body, 'status', detail.status || task.zentaoStatus || task.zentao?.originalStatus || body.get('status') || 'wait');
  return body;
}

async function classicGet(api, pathname, refererPath) {
  const cookies = await getClassicCookies(api);
  const baseUrl = String(api.baseUrl || '').replace(/\/$/, '');
  const res = await fetch(`${baseUrl}/${pathname.replace(/^\/+/, '')}`, {
    headers: {
      Cookie: cookies,
      Referer: `${baseUrl}/${String(refererPath || pathname).replace(/^\/+/, '')}`
    },
    redirect: 'manual'
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`禅道 HTTP ${res.status}`);
  if (/用户登录|user-login|m=user&f=login/i.test(text) && !/name=['"]assignedTo['"]/i.test(text)) {
    classicCookieJar = null;
    throw new Error('禅道经典页面登录失效，无法打开指派表单');
  }
  return text;
}

async function classicPost(api, pathname, body, refererPath) {
  const cookies = await getClassicCookies(api);
  const baseUrl = String(api.baseUrl || '').replace(/\/$/, '');
  const res = await fetch(`${baseUrl}/${pathname.replace(/^\/+/, '')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies,
      Referer: `${baseUrl}/${refererPath.replace(/^\/+/, '')}`
    },
    body: body.toString(),
    redirect: 'manual'
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`禅道 HTTP ${res.status}`);
  if (/alert\('([^']+)'\)/.test(text) && !/保存成功|parent\.location|self\.location/.test(text)) {
    throw new Error(text.match(/alert\('([^']+)'\)/)?.[1] || '禅道返回错误弹窗');
  }
  return text;
}

async function createChildTaskClassic(api, detail = {}, task = {}, row = {}) {
  const executionId = String(row.executionId || executionIdOf(detail, task));
  if (!executionId) throw new Error(`子单「${row.name || ''}」缺少所属版本，无法创建`);
  const parentId = String(row.parent || zentaoTaskId(task));
  const storyId = String(idValue(firstValue(detail.story, detail.storyID, task.zentao?.story, 0)) || '0');
  const moduleId = String(idValue(firstValue(detail.module, task.zentao?.module, 0)) || '0');
  const estimate = String(row.estimate ?? 0);
  if (zentaoTaskId(task) && !parentId) throw new Error(`子单「${row.name || ''}」缺少父任务，已停止创建以避免取消关联`);
  if (idValue(firstValue(detail.story, detail.storyID, task.zentao?.story)) && (!storyId || storyId === '0')) {
    throw new Error(`子单「${row.name || ''}」缺少关联需求，已停止创建以避免取消关联`);
  }
  const createPath = `index.php?m=task&f=create&executionID=${executionId}&storyID=${storyId}&moduleID=${moduleId}&taskID=${parentId}`;
  const createOnlyBodyPath = `${createPath}&onlybody=yes`;
  const html = await classicGet(api, createOnlyBodyPath, createOnlyBodyPath);
  const body = taskCreateBodyFromForm(html, detail, task, {
    ...row,
    name: stripAutoTaskTypePrefix(row.name),
    assignedTo: row.assignedTo,
    executionId,
    storyId,
    moduleId,
    parentId,
    estimate
  });
  const beforeIds = await listExecutionTaskIds(api, executionId);
  await classicPost(
    api,
    createPath,
    body,
    createOnlyBodyPath
  );
  let created = await findCreatedChildTask(api, {
    executionId,
    beforeIds,
    name: row.name,
    assignedTo: row.assignedTo,
    parentId,
    storyId,
    parentTaskId: zentaoTaskId(task) || zentaoTaskId(detail)
  });
  if (!created?.id) {
    throw new Error(`子单「${row.name || ''}」提交后未在禅道执行 ${executionId} 中查到新任务，已停止标记成功`);
  }
  const expectedParent = String(parentId || '');
  if (expectedParent && !taskParentId(created)) {
    created = await linkCreatedChildToParentClassic(api, created, expectedParent, row);
  }
  const actualParent = taskParentId(created);
  const allowedParents = new Set([
    expectedParent,
    taskParentId(detail),
    taskParentId(task),
    String(task.zentao?.parent || '')
  ].filter(Boolean));
  if (expectedParent && !actualParent) {
    throw new Error(`子单「${row.name || ''}」已创建为 ${created.id}，但父任务为空，不是原任务 ${expectedParent}`);
  }
  if (allowedParents.size && actualParent && !allowedParents.has(actualParent)) {
    throw new Error(`子单「${row.name || ''}」已创建为 ${created.id}，但父任务为 ${actualParent}，不是 ${[...allowedParents].join(' 或 ')}`);
  }
  return {
    id: String(created.id || ''),
    name: created.name || row.name,
    assignedTo: accountName(created.assignedTo) || row.assignedTo,
    parent: actualParent,
    story: String(created.story || ''),
    execution: String(created.execution || executionId)
  };
}

async function linkCreatedChildToParentClassic(api, created = {}, parentId = '', row = {}) {
  const childId = String(created.id || created.taskID || '').trim();
  const targetParent = String(parentId || '').trim();
  if (!childId || !targetParent) return created;
  const editPath = `index.php?m=task&f=edit&taskID=${encodeURIComponent(childId)}`;
  const editOnlyBodyPath = `${editPath}&onlybody=yes`;
  const html = await classicGet(api, editOnlyBodyPath, `index.php?m=task&f=view&taskID=${encodeURIComponent(childId)}&onlybody=yes`);
  const formHtml = formHtmlWithFields(html, ['execution', 'module', 'story', 'name'])
    || formHtmlWithFields(html, ['name'])
    || firstFormHtml(html);
  if (!formHtml) {
    throw new Error(`子单「${row.name || created.name || childId}」父任务为空，且未读取到禅道编辑表单，无法补挂父任务 ${targetParent}`);
  }
  const body = formBodyFromHtml(formHtml);
  setChildTaskParentFormValue(body, formHtml, targetParent);
  stripChildTaskRemarkFields(body);
  await classicPost(api, editPath, body, editOnlyBodyPath);
  const fresh = unwrapTask(await api.request({ method: 'GET', path: `/api.php/v1/tasks/${encodeURIComponent(childId)}` }));
  if (!taskParentId(fresh)) {
    throw new Error(`子单「${row.name || created.name || childId}」已创建为 ${childId}，但补挂父任务后仍为空，不是原任务 ${targetParent}`);
  }
  return fresh;
}

function taskCreateBodyFromForm(html = '', detail = {}, task = {}, row = {}) {
  const formHtml = formHtmlWithFields(html, ['execution', 'module', 'story', 'assignedTo[]', 'name'])
    || formHtmlWithFields(html, ['execution', 'module', 'story', 'assignedTo[]'])
    || firstFormHtml(html);
  if (!formHtml) throw new Error(`子单「${row.name || ''}」未读取到禅道创建表单，已停止创建以避免取消关联`);
  const body = formBodyFromHtml(formHtml || html);
  const storyId = String(row.storyId || idValue(firstValue(detail.story, detail.storyID, task.zentao?.story, 0)) || '0');
  const parentId = String(row.parentId || zentaoTaskId(task) || '0');
  const moduleId = String(row.moduleId || idValue(firstValue(detail.module, task.zentao?.module, 0)) || '0');
  const executionId = String(row.executionId || executionIdOf(detail, task));
  requireFormFields(body, ['execution', 'module', 'story'], `子单「${row.name || ''}」`);

  setFormValue(body, 'execution', executionId);
  setFormValue(body, 'module', moduleId);
  setFormValue(body, 'story', storyId);
  setChildTaskParentFormValue(body, formHtml, parentId);
  setFormValue(body, 'name', row.name || '未命名子任务');
  stripChildTaskTagFields(body);
  stripChildTaskRemarkFields(body);
  setFormValue(body, 'estimate', String(row.estimate ?? body.get('estimate') ?? 0));
  setFormValue(body, 'deadline', validDate(row.deadline || detail.deadline || task.deadline || task.zentao?.deadline));
  setFormValue(body, 'desc', row.desc || inheritedChildTaskDesc(detail, task) || body.get('desc') || '');
  keepExistingFormValueOnly(body, 'status');
  keepExistingFormValueOnly(body, 'type');
  keepExistingFormValueOnly(body, 'category');
  keepExistingFormValueOnly(body, 'source');
  keepExistingFormValueOnly(body, 'ordertype');
  keepExistingFormValueOnly(body, 'after');
  body.delete('assignedTo');
  body.delete('assignedTo[]');
  body.append('assignedTo[]', row.assignedTo);
  return body;
}

function stripChildTaskTagFields(body) {
  [
    'pri',
    'color',
    'keywords',
    'tags',
    'labels',
    'label',
    'tag',
    'mailto',
    'mailto[]'
  ].forEach(name => body.delete(name));
}

function stripChildTaskRemarkFields(body) {
  [
    'comment',
    'comment[]',
    'remark',
    'remarks',
    'remark[]',
    'history',
    'historyComment'
  ].forEach(name => body.delete(name));
}

function setChildTaskParentFormValue(body, formHtml = '', parentId = '') {
  const value = String(parentId || '').trim();
  if (!value) return;
  const parentFields = ['parent', 'parentID', 'parentTask', 'parentTaskID'];
  const existingField = parentFields.find(name => body.has(name) || htmlFormHasField(formHtml, name));
  setFormValue(body, existingField || 'parent', value);
}

function htmlFormHasField(html = '', name = '') {
  const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`\\bname\\s*=\\s*(['"])${escaped}\\1`, 'i').test(String(html || ''));
}

function taskParentId(task = {}) {
  return String(
    idValue(firstValue(
      task.parent,
      task.parentID,
      task.parentTask,
      task.parentTaskID,
      task.parent_task?.id,
      task.parentTask?.id
    )) || ''
  ).trim();
}

function keepExistingFormValueOnly(body, name) {
  if (!body.has(name)) return;
  const values = body.getAll(name).filter(value => String(value ?? '').trim() !== '');
  body.delete(name);
  values.forEach(value => body.append(name, value));
}

async function listExecutionTaskIds(api, executionId) {
  const ids = new Set();
  try {
    const payload = await api.request({
      method: 'GET',
      path: `/api.php/v1/executions/${encodeURIComponent(executionId)}/tasks`
    });
    for (const task of extractZentaoTasks(payload)) {
      const id = String(task.id || task.taskID || '').trim();
      if (id) ids.add(id);
    }
  } catch {
    // 创建前快照只用于识别新任务，失败时仍允许提交，提交后再按名称查回。
  }
  return ids;
}

async function findCreatedChildTask(api, options = {}) {
  const executionId = String(options.executionId || '').trim();
  const parentTaskId = String(options.parentTaskId || '').trim();
  const beforeIds = options.beforeIds instanceof Set ? options.beforeIds : new Set();
  const expectedName = normalizeTaskName(options.name);
  const expectedAssignee = String(options.assignedTo || '').trim().toLowerCase();
  const expectedStory = String(options.storyId || '').trim();
  const candidates = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tasks = [
      ...(parentTaskId ? await listRelatedTasksFromTask(api, parentTaskId).catch(() => []) : []),
      ...await listExecutionTasks(api, executionId).catch(() => [])
    ];
    for (const task of tasks) {
      const id = String(task.id || task.taskID || '').trim();
      if (!id || beforeIds.has(id)) continue;
      const name = normalizeTaskName(task.name || task.title || '');
      if (expectedName && name !== expectedName) continue;
      const assignee = accountName(task.assignedTo).toLowerCase();
      const story = String(task.story || task.storyID || '').trim();
      const score = [
        expectedAssignee && assignee === expectedAssignee,
        expectedStory && story === expectedStory
      ].filter(Boolean).length;
      candidates.push({ task, score });
    }
    if (candidates.length) break;
    await new Promise(resolve => setTimeout(resolve, 300 + attempt * 250));
  }
  candidates.sort((a, b) => b.score - a.score);
  const created = candidates[0]?.task || null;
  if (!created) return null;
  const id = String(created.id || created.taskID || '').trim();
  try {
    const payload = await api.request({ method: 'GET', path: `/api.php/v1/tasks/${encodeURIComponent(id)}` });
    return unwrapTask(payload);
  } catch {
    return created;
  }
}

async function listRelatedTasksFromTask(api, taskId) {
  const payload = await api.request({ method: 'GET', path: `/api.php/v1/tasks/${encodeURIComponent(taskId)}` });
  return extractRelatedTasks(unwrapTask(payload));
}

async function listExecutionTasks(api, executionId) {
  const payload = await api.request({
    method: 'GET',
    path: `/api.php/v1/executions/${encodeURIComponent(executionId)}/tasks`
  });
  return extractZentaoTasks(payload);
}

function extractZentaoTasks(payload = {}) {
  const result = payload?.result || payload?.data || payload;
  const tasks = Array.isArray(result?.tasks)
    ? result.tasks
    : Array.isArray(result)
      ? result
      : [];
  return tasks.flatMap(task => {
    const children = Array.isArray(task.children) ? task.children : [];
    const brothers = Array.isArray(task.brother)
      ? task.brother
      : task.brother && typeof task.brother === 'object'
        ? Object.values(task.brother)
        : [];
    return [task, ...children, ...brothers];
  });
}

function extractRelatedTasks(task = {}) {
  if (!task || typeof task !== 'object') return [];
  const children = Array.isArray(task.children) ? task.children : [];
  const brothers = Array.isArray(task.brother)
    ? task.brother
    : task.brother && typeof task.brother === 'object'
      ? Object.values(task.brother)
      : [];
  return [task, ...children, ...brothers];
}

function normalizeTaskName(value = '') {
  return htmlDecode(stripAutoTaskTypePrefix(value))
    .replace(/\s+/g, '')
    .trim();
}

function requireFormFields(body, names = [], label = '禅道表单') {
  const missing = names.filter(name => !body.has(name));
  if (missing.length) {
    throw new Error(`${label} 缺少禅道原始字段 ${missing.join(', ')}，已停止提交以避免取消关联`);
  }
}

function inheritedChildTaskDesc(detail = {}, task = {}) {
  return firstValue(
    detail.desc,
    detail.description,
    detail.requirement,
    task.desc,
    task.description,
    task.requirement,
    task.zentao?.desc,
    task.zentao?.description,
    task.zentao?.requirement
  );
}

function explicitZentaoComment(options = {}) {
  if (options.allowZentaoComment !== true) return '';
  return String(options.comment || '').trim();
}

function hasExplicitText(value) {
  return String(value || '').trim().length > 0;
}

let classicCookieJar = null;
async function getClassicCookies(api) {
  if (classicCookieJar) return formatCookies(classicCookieJar);
  const baseUrl = String(api.baseUrl || '').replace(/\/$/, '');
  classicCookieJar = {};
  let res = await fetch(`${baseUrl}/index.php?m=user&f=login`, { redirect: 'manual' });
  Object.assign(classicCookieJar, parseSetCookie(getSetCookieHeaders(res.headers)));
  const body = new URLSearchParams({
    account: api.account,
    password: api.password,
    keepLogin: 'on'
  });
  res = await fetch(`${baseUrl}/index.php?m=user&f=login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: formatCookies(classicCookieJar),
      Referer: `${baseUrl}/index.php?m=user&f=login`
    },
    body: body.toString(),
    redirect: 'manual'
  });
  Object.assign(classicCookieJar, parseSetCookie(getSetCookieHeaders(res.headers)));
  return formatCookies(classicCookieJar);
}

function getSetCookieHeaders(headers) {
  if (!headers) return [];
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const combined = headers.get?.('set-cookie');
  if (combined) list.push(combined);
  return list;
}

function parseSetCookie(setCookie = '') {
  const jar = {};
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const header of headers) {
    for (const part of String(header || '').split(/,(?=[^;,]+=)/)) {
      const match = part.match(/^\s*([^=;\s]+)=([^;]*)/);
      if (match) jar[match[1]] = match[2];
    }
  }
  return jar;
}

function firstFormHtml(html = '') {
  return String(html || '').match(/<form\b[^>]*>([\s\S]*?)<\/form>/i)?.[1] || '';
}

function formHtmlWithFields(html = '', requiredFields = []) {
  const forms = [...String(html || '').matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)]
    .map(match => match[1] || '');
  return forms.find(formHtml => {
    const body = formBodyFromHtml(formHtml);
    return requiredFields.every(field => body.has(field));
  }) || '';
}

function formBodyFromHtml(html = '') {
  const body = new URLSearchParams();
  parseInputFields(html, body);
  parseTextareaFields(html, body);
  parseSelectFields(html, body);
  return body;
}

function parseInputFields(html = '', body) {
  for (const match of String(html || '').matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const name = htmlAttr(tag, 'name');
    if (!name || hasHtmlAttr(tag, 'disabled')) continue;
    const type = String(htmlAttr(tag, 'type') || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'file', 'image'].includes(type)) continue;
    if (['checkbox', 'radio'].includes(type) && !hasHtmlAttr(tag, 'checked')) continue;
    body.append(name, htmlDecode(htmlAttr(tag, 'value')));
  }
}

function parseTextareaFields(html = '', body) {
  for (const match of String(html || '').matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const tag = match[0];
    const name = htmlAttr(tag, 'name');
    if (!name || hasHtmlAttr(tag, 'disabled')) continue;
    body.append(name, htmlDecode(match[2] || ''));
  }
}

function parseSelectFields(html = '', body) {
  for (const match of String(html || '').matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const tag = match[0];
    const name = htmlAttr(tag, 'name');
    if (!name || hasHtmlAttr(tag, 'disabled')) continue;
    const multiple = hasHtmlAttr(tag, 'multiple');
    const options = [...String(match[2] || '').matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(option => {
      const optionTag = option[0];
      const attrValue = htmlAttr(optionTag, 'value');
      return {
        selected: hasHtmlAttr(optionTag, 'selected'),
        value: htmlDecode(attrValue !== '' ? attrValue : stripHtml(option[2] || ''))
      };
    });
    const selected = options.filter(option => option.selected);
    if (multiple) {
      selected.forEach(option => body.append(name, option.value));
    } else {
      const option = selected[0] || options[0];
      if (option) body.append(name, option.value);
    }
  }
}

function setFormValue(body, name, value) {
  body.delete(name);
  body.append(name, String(value ?? ''));
}

function ensureFormValue(body, name, value) {
  if (!body.has(name)) body.append(name, String(value ?? ''));
}

function htmlAttr(tag = '', name = '') {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(tag || '').match(pattern);
  return htmlDecode(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function hasHtmlAttr(tag = '', name = '') {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}(?:\\s*=|\\s|>|$)`, 'i');
  return pattern.test(String(tag || ''));
}

function htmlDecode(value = '') {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function classicHour(value) {
  const text = String(value ?? '').trim();
  if (!text) return '0';
  return text;
}

function classicRequiredHour(value) {
  const text = String(value ?? '').trim();
  if (!text || Number(text) <= 0) return '1';
  return text;
}

function stripHtml(value = '') {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCookies(jar) {
  return Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; ');
}

function unwrapTask(payload) {
  return payload?.task || payload?.result?.task || payload?.result || payload?.data?.task || payload?.data || payload || {};
}

function zentaoTaskId(task = {}) {
  const id = task.taskNo || task.zentaoId || task.zentao?.id || task.id || '';
  return String(id).match(/\b\d{3,8}\b/)?.[0] || '';
}

function idValue(value) {
  if (value && typeof value === 'object') return String(value.id || value.value || value.key || '').trim();
  return String(value ?? '').trim();
}

function accountName(value) {
  if (!value) return '';
  if (typeof value === 'object') return String(value.account || value.realname || value.id || '').trim();
  return String(value || '').trim();
}

function personName(value) {
  if (!value) return '';
  if (typeof value === 'object') return String(value.realname || value.name || value.account || '').trim();
  return String(value || '').trim();
}

function executionIdOf(detail = {}, task = {}) {
  return firstValue(
    detail.execution?.id,
    detail.executionID,
    detail.executionId,
    detail.execution,
    detail.project?.id,
    detail.projectID,
    task.zentao?.execution,
    task.executionId,
    task.executionID
  );
}

function childRow(name, assignedTo, deadline, executionId, parent, index) {
  return {
    id: `child-${index + 1}`,
    enabled: true,
    name,
    assignedTo,
    deadline,
    estimate: 0,
    executionId,
    parent
  };
}

function getBaseName(title) {
  return String(title || '')
    .replace(/^【.*?】\s*/, '')
    .replace(/\s*[-—_]*\s*美术$/, '')
    .trim();
}

function recommendedMainAssignee(text = '') {
  if (/官网|落地页|官网素材/i.test(text)) return findAssignee('yushengwei');
  if (/白套?|白版|-白\b/i.test(text)) return findAssignee('lanhj');
  if (/web5?[-_ ]?12|12套/i.test(text)) return findAssignee('zhangzb');
  if (/web5?[-_ ]?10|10套/i.test(text)) return findAssignee('lilh');
  if (/web5?[-_ ]?2.*皮肤|2皮肤/i.test(text)) return findAssignee('fengshuqi');
  if (/web5?[-_ ]?2\b|2主套/i.test(text)) return findAssignee('huangjianrong');
  return findAssignee('lilh');
}

function findAssignee(account) {
  return artAssigneeOptions.find(item => item.account === account) || artAssigneeOptions[0];
}

function firstValue(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text && !/^0{4}-0{2}-0{2}/.test(text)) return text;
  }
  return '';
}

function stripAutoTaskTypePrefix(value) {
  return String(value || '').replace(/^(?:【\s*(制作单|验收单|美术单)\s*】\s*)+/, '').trim();
}

function normalizeClassicDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('0000-00-00')) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const pad = number => String(number).padStart(2, '0');
      return [
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
      ].join(' ');
    }
  }
  return raw.replace('T', ' ').replace(/Z$/, '').slice(0, 19);
}

function validDate(value) {
  const text = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !text.startsWith('0000') ? text : '';
}
