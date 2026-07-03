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

const WEB_SKIN_SPLIT_MAIN_COMMENT = '此单为10-12-白依据';
const WORKLOAD_ASSIGN_HOURS = {
  XS: '2',
  S: '4',
  M: '8',
  L: '14'
};

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

  const fresh = await waitForAssignedTask(api, taskId, assignedTo, assignee, { detail, task });
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
  const siblingTasks = relatedTaskList(detail);
  const artTemplate = findArtProductionTemplate(detail, task, siblingTasks);
  const cocosTemplate = findCocosProductionTemplate(detail, task, siblingTasks);
  const deadline = validDate(artTemplate?.deadline || detail.deadline || task.deadline || task.zentao?.deadline);
  const executionId = executionIdOf(artTemplate || detail, task);
  const parentTaskId = taskParentId(artTemplate || detail) || taskParentId(detail) || nonZeroIdValue(task.zentao?.parent) || taskId;
  const main = recommendedMainAssignee(text);
  let mainComment = '';
  const children = [];

  if (/入口图标|入口图|入口icon|新增子游戏|新增小游戏|新增游戏/i.test(text)) {
    children.push(childRow(withTaskSuffix(`【制作单】${baseName || title}`, '-2'), 'yushengwei', deadline, executionId, parentTaskId, 0, artTemplate, task, detail));
  } else if (/走查/i.test(text) || /【\s*(?:美术)?验收单\s*】|美术验收/i.test(text)) {
    [
      ['【验收单】', '-白', 'lanhj'],
      ['【验收单】', '-2皮肤', 'fengshuqi'],
      ['【验收单】', '-12', 'zhangzb'],
      ['【验收单】', '-10', 'lilh'],
      ['【验收单】', '-2主套', 'huangjianrong']
    ].forEach(([prefix, suffix, account], index) => {
      children.push(childRow(`${prefix}${baseName || title}${suffix}`, account, deadline, executionId, parentTaskId, index, artTemplate, task, detail));
    });
  } else if (/web5?|web/i.test(text)) {
    children.push(childRow(`【制作单】${baseName || title}-2`, 'huangjianrong', deadline, executionId, parentTaskId, 0, artTemplate, task, detail));
    if (cocosTemplate) {
      const cocosDeadline = validDate(cocosTemplate?.deadline || deadline);
      const cocosExecutionId = executionIdOf(cocosTemplate || artTemplate || detail, task);
      children.push(childRow(`【制作单】${baseName || title}-15`, 'zhangzb', cocosDeadline, cocosExecutionId, parentTaskId, 1, cocosTemplate || artTemplate, task, detail));
    }
    mainComment = splitMainCommentForTask(text);
  } else {
    children.push(childRow(withTaskSuffix(`【制作单】${baseName || title}`, '-2'), main.account, deadline, executionId, parentTaskId, 0, artTemplate, task, detail));
  }

  return {
    taskId,
    title,
    deadline,
    executionId,
    parent: parentTaskId,
    mainAssignee: main.account,
    mainComment,
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

  const childFailed = results.some(item => item.type === 'child' && item.ok === false);
  if (mainAssignee && !childFailed) {
    try {
      const recomputedMainComment = splitMainCommentForTask(`${detail.name || detail.title || ''}\n${detail.desc || detail.description || ''}\n${task.requirement || ''}\n${task.zentao?.storyTitle || ''}`);
      const requestedMainComment = String(plan.mainComment || '').trim();
      const mainComment = recomputedMainComment || (requestedMainComment === WEB_SKIN_SPLIT_MAIN_COMMENT ? requestedMainComment : '');
      const fresh = await assignZentaoTask({ ...task, ...detail, taskNo: taskId, zentao: { ...(task.zentao || {}), id: taskId } }, { account: mainAssignee }, {
        comment: mainComment || explicitZentaoComment(options),
        allowZentaoComment: Boolean(mainComment) || options.allowZentaoComment === true
      });
      results.unshift({ type: 'main', ok: true, taskId, assignedTo: describeTaskAssignee(fresh) || mainAssignee });
    } catch (error) {
      results.unshift({ type: 'main', ok: false, taskId, assignedTo: mainAssignee, error: error.message || String(error) });
    }
  } else if (mainAssignee && childFailed) {
    results.unshift({
      type: 'main',
      ok: false,
      taskId,
      assignedTo: mainAssignee,
      skipped: true,
      error: '子单创建失败，已跳过主单指派，避免出现主单已转派但子单未创建的部分成功状态'
    });
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
  const html = await classicGet(api, path, `index.php?m=task&f=view&taskID=${taskId}&onlybody=yes`, {
    requireFields: ['assignedTo', 'left'],
    label: '指派表单'
  });
  const body = taskAssignBodyFromForm(html, detail, task, updates);
  await classicPost(api, path, body, path);
}

async function waitForAssignedTask(api, taskId, assignedTo, assignee = {}, context = {}) {
  let fresh = {};
  for (let index = 0; index < 3; index += 1) {
    fresh = unwrapTask(await api.request({ method: 'GET', path: `/api.php/v1/tasks/${taskId}` }));
    if (taskAssigneeMatches(fresh, assignedTo, assignee)) return fresh;
    await new Promise(resolve => setTimeout(resolve, 260 + index * 220));
  }
  const classicFresh = await readAssignedTaskFromClassicForm(api, taskId, context, assignee).catch(() => null);
  if (classicFresh && taskAssigneeMatches(classicFresh, assignedTo, assignee)) return { ...fresh, ...classicFresh };
  return fresh;
}

async function readAssignedTaskFromClassicForm(api, taskId, context = {}, assignee = {}) {
  const executionId = String(executionIdOf(context.detail || {}, context.task || {}) || '').trim();
  if (!executionId) return null;
  const path = `index.php?m=task&f=assignTo&executionID=${encodeURIComponent(executionId)}&taskID=${encodeURIComponent(taskId)}&onlybody=yes`;
  const html = await classicGet(api, path, `index.php?m=task&f=view&taskID=${encodeURIComponent(taskId)}&onlybody=yes`, {
    label: '指派结果回读表单'
  });
  const selected = selectedChoiceFromForm(html, ['assignedTo[]', 'assignedTo', 'owner', 'assignedToList[]']);
  if (!selected?.value) return null;
  return {
    id: String(taskId || ''),
    assignedTo: { account: selected.value, realname: selected.label || assignee.realname || selected.value },
    assignedToName: selected.label || assignee.realname || selected.value,
    assignedToRealName: selected.label || assignee.realname || selected.value
  };
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
  const fallbackHour = taskWorkloadAssignHour(task, detail);

  if (uid) setFormValue(body, 'uid', uid);
  setFormValue(body, 'assignedTo', assignedTo);
  if (hasExplicitText(updates.comment)) setFormValue(body, 'comment', updates.comment);
  else body.delete('comment');
  ensureFormValue(body, 'env', detail.env || task.zentao?.env || '');
  ensureFormValue(body, 'estStarted', validDate(detail.estStarted || task.zentao?.estStarted || ''));
  setFormValue(body, 'deadline', validDate(detail.deadline || task.deadline || task.zentao?.deadline || body.get('deadline')));
  const workHours = assignTaskWorkHours(detail, task, body, fallbackHour);
  setFormValue(body, 'estimate', workHours.estimate);
  setFormValue(body, 'left', workHours.left);
  ensureFormValue(body, 'relatedModules', detail.relatedModules || task.zentao?.relatedModules || '');
  setFormValue(body, 'status', detail.status || task.zentaoStatus || task.zentao?.originalStatus || body.get('status') || 'wait');
  return body;
}

async function classicGet(api, pathname, refererPath, options = {}) {
  const baseUrl = String(api.baseUrl || '').replace(/\/$/, '');
  let lastText = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cookies = await getZentaoClassicCookies(api, { force: attempt > 0 });
    const res = await fetch(`${baseUrl}/${pathname.replace(/^\/+/, '')}`, {
      headers: {
        Cookie: cookies,
        Referer: `${baseUrl}/${String(refererPath || pathname).replace(/^\/+/, '')}`
      },
      redirect: 'manual'
    });
    const text = await res.text();
    lastText = text;
    if (!res.ok) throw new Error(`禅道 HTTP ${res.status}`);
    if (isClassicLoginPage(text, options.requireFields)) {
      classicCookieJar = null;
      continue;
    }
    assertClassicFormReady(text, options);
    return text;
  }
  const label = options.label || '禅道经典页面';
  throw new Error(`${label}登录失效，重登后仍无法打开${classicLoginHint(lastText)}`);
}

async function classicPost(api, pathname, body, refererPath) {
  const baseUrl = String(api.baseUrl || '').replace(/\/$/, '');
  let lastText = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cookies = await getZentaoClassicCookies(api, { force: attempt > 0 });
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
    lastText = text;
    if (!res.ok) throw new Error(`禅道 HTTP ${res.status}`);
    if (isClassicLoginPage(text)) {
      classicCookieJar = null;
      continue;
    }
    if (/alert\('([^']+)'\)/.test(text) && !/保存成功|parent\.location|self\.location/.test(text)) {
      throw new Error(text.match(/alert\('([^']+)'\)/)?.[1] || '禅道返回错误弹窗');
    }
    return text;
  }
  throw new Error(`禅道经典页面提交登录失效，重登后仍无法提交${classicLoginHint(lastText)}`);
}

async function createChildTaskClassic(api, detail = {}, task = {}, row = {}) {
  const templateDetail = await loadChildTaskTemplate(api, row, detail);
  const sourceDetail = templateDetail || detail;
  const executionId = String(row.executionId || executionIdOf(sourceDetail, task));
  if (!executionId) throw new Error(`子单「${row.name || ''}」缺少所属版本，无法创建`);
  const parentId = String(row.parent || zentaoTaskId(task));
  const storyId = String(idValue(firstValue(sourceDetail.story, sourceDetail.storyID, task.zentao?.story, 0)) || '0');
  const moduleId = String(idValue(firstValue(sourceDetail.module, task.zentao?.module, 0)) || '0');
  const estimate = String(row.estimate ?? firstValue(sourceDetail.estimate, sourceDetail.left, 0));
  if (zentaoTaskId(task) && !parentId) throw new Error(`子单「${row.name || ''}」缺少父任务，已停止创建以避免取消关联`);
  if (nonZeroIdValue(firstValue(sourceDetail.story, sourceDetail.storyID, task.zentao?.story)) && (!storyId || storyId === '0')) {
    throw new Error(`子单「${row.name || ''}」缺少关联需求，已停止创建以避免取消关联`);
  }
  const createPath = `index.php?m=task&f=create&executionID=${executionId}&storyID=${storyId}&moduleID=${moduleId}&taskID=${parentId}`;
  const createOnlyBodyPath = `${createPath}&onlybody=yes`;
  const html = await classicGet(api, createOnlyBodyPath, createOnlyBodyPath, {
    requireFields: ['execution', 'module', 'story', 'name'],
    label: '子单创建表单'
  });
  const body = taskCreateBodyFromForm(html, sourceDetail, task, {
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
  if (isDeletedZentaoTask(created)) {
    throw new Error(`子单「${row.name || ''}」已创建为 ${created.id}，但禅道返回已删除状态，已停止标记成功`);
  }
  if (expectedParent && taskParentId(created) !== expectedParent) {
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
  const html = await classicGet(api, editOnlyBodyPath, `index.php?m=task&f=view&taskID=${encodeURIComponent(childId)}&onlybody=yes`, {
    requireFields: ['name'],
    label: '子单编辑表单'
  });
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
  const actualParent = taskParentId(fresh);
  if (actualParent !== targetParent) {
    throw new Error(`子单「${row.name || created.name || childId}」已创建为 ${childId}，但补挂父任务后为 ${actualParent || '空'}，不是原任务 ${targetParent}`);
  }
  return fresh;
}

async function loadChildTaskTemplate(api, row = {}, fallback = {}) {
  const templateTaskId = String(row.templateTaskId || '').trim();
  if (!templateTaskId || templateTaskId === String(zentaoTaskId(fallback) || '')) return fallback;
  try {
    return unwrapTask(await api.request({ method: 'GET', path: `/api.php/v1/tasks/${encodeURIComponent(templateTaskId)}` }));
  } catch {
    return fallback;
  }
}

function taskCreateBodyFromForm(html = '', detail = {}, task = {}, row = {}) {
  const formHtml = formHtmlWithFields(html, ['execution', 'module', 'story', 'name'])
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
  setFormValue(body, 'deadline', validDate(row.deadline || detail.deadline || task.deadline || task.zentao?.deadline || body.get('deadline')));
  setFormValue(body, 'desc', row.desc || inheritedChildTaskDesc(detail, task) || body.get('desc') || '');
  keepTemplateOrExistingFormValue(body, 'status', detail.status);
  keepTemplateOrExistingFormValue(body, 'type', detail.type);
  keepTemplateOrExistingFormValue(body, 'category', detail.category);
  keepTemplateOrExistingFormValue(body, 'source', detail.source);
  keepTemplateOrExistingFormValue(body, 'ordertype', detail.ordertype);
  keepTemplateOrExistingFormValue(body, 'after', '');
  keepTemplateOrExistingFormValue(body, 'env', detail.env);
  keepTemplateOrExistingFormValue(body, 'estStarted', validDate(detail.estStarted));
  keepTemplateOrExistingFormValue(body, 'left', firstValue(detail.left, row.estimate, body.get('left')));
  keepTemplateOrExistingFormValue(body, 'consumed', detail.consumed);
  setChildTaskAssigneeFormValue(body, formHtml, row.assignedTo);
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

function setChildTaskAssigneeFormValue(body, formHtml = '', assignedTo = '') {
  const value = String(assignedTo || '').trim();
  if (!value) return;
  const assigneeFields = ['assignedTo[]', 'assignedTo', 'owner', 'assignedToList[]'];
  const existingField = assigneeFields.find(name => body.has(name) || htmlFormHasField(formHtml, name));
  for (const name of assigneeFields) body.delete(name);
  body.append(existingField || 'assignedTo[]', value);
}

function htmlFormHasField(html = '', name = '') {
  const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`\\bname\\s*=\\s*(['"])${escaped}\\1`, 'i').test(String(html || ''));
}

function taskParentId(task = {}) {
  return nonZeroIdValue(firstValue(
    task.parent,
    task.parentID,
    task.parentTask,
    task.parentTaskID,
    task.parent_task?.id,
    task.parentTask?.id
  ));
}

function isDeletedZentaoTask(task = {}) {
  const value = task.deleted;
  return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
}

function keepExistingFormValueOnly(body, name) {
  if (!body.has(name)) return;
  const values = body.getAll(name).filter(value => String(value ?? '').trim() !== '');
  body.delete(name);
  values.forEach(value => body.append(name, value));
}

function keepTemplateOrExistingFormValue(body, name, templateValue) {
  const value = String(templateValue ?? '').trim();
  if (value && !value.startsWith('0000-00-00')) {
    setFormValue(body, name, value);
    return;
  }
  keepExistingFormValueOnly(body, name);
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

function assertClassicFormReady(html = '', options = {}) {
  const fields = Array.isArray(options.requireFields) ? options.requireFields : [];
  if (!fields.length) return;
  const formHtml = formHtmlWithFields(html, fields);
  if (formHtml) return;
  const label = options.label || '禅道表单';
  throw new Error(`${label}缺少必要字段 ${fields.join(', ')}，已停止提交以避免误写禅道`);
}

function isClassicLoginPage(html = '', expectedFields = []) {
  const text = String(html || '');
  const hasExpectedField = Array.isArray(expectedFields) && expectedFields.some(field => htmlFormHasField(text, field));
  if (hasExpectedField) return false;
  if (/name\s*=\s*['"]account['"]/i.test(text) && /name\s*=\s*['"]password['"]/i.test(text)) return true;
  return /用户登录|user-login|m=user&f=login|loginPanel|login-form/i.test(text);
}

function classicLoginHint(html = '') {
  const text = stripHtml(String(html || '')).replace(/\s+/g, ' ').trim();
  const brief = text.slice(0, 80);
  return brief ? `（返回内容：${brief}）` : '';
}

let classicCookieJar = null;
let classicLoginMode = 0;
export async function getZentaoClassicCookies(api, options = {}) {
  if (options.force) classicCookieJar = null;
  if (classicCookieJar) return formatCookies(classicCookieJar);
  const baseUrl = String(api.baseUrl || '').replace(/\/$/, '');
  const loginPaths = classicLoginPaths();
  let lastError = '';
  for (let index = 0; index < loginPaths.length; index += 1) {
    const loginPath = loginPaths[(classicLoginMode + index) % loginPaths.length];
    try {
      const jar = await loginClassicWithPath(api, baseUrl, loginPath);
      classicCookieJar = jar;
      classicLoginMode = (classicLoginMode + index) % loginPaths.length;
      return formatCookies(classicCookieJar);
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  classicCookieJar = null;
  throw new Error(lastError || '禅道经典页面登录失败：未建立有效经典页会话');
}

function classicLoginPaths() {
  return [
    'user-login.html',
    'index.php?m=user&f=login'
  ];
}

async function loginClassicWithPath(api, baseUrl, loginPath) {
  const jar = {};
  const loginUrl = `${baseUrl}/${loginPath}`;
  let res = await fetch(loginUrl, { redirect: 'manual' });
  Object.assign(jar, parseSetCookie(getSetCookieHeaders(res.headers)));
  const pageText = await res.text().catch(() => '');
  const body = new URLSearchParams({
    account: api.account || '',
    password: api.password || '',
    keepLogin: 'on'
  });
  for (const token of classicLoginHiddenFields(pageText)) {
    if (!body.has(token.name)) body.append(token.name, token.value);
  }
  res = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: formatCookies(jar),
      Referer: loginUrl
    },
    body: body.toString(),
    redirect: 'manual'
  });
  Object.assign(jar, parseSetCookie(getSetCookieHeaders(res.headers)));
  if (!res.ok) {
    throw new Error(`禅道经典页面登录失败：${loginPath} HTTP ${res.status}`);
  }
  if (!hasClassicSessionCookie(jar) && !(await verifyClassicLogin(api, jar))) {
    throw new Error(`禅道经典页面登录失败：${loginPath} 未建立有效经典页会话`);
  }
  return jar;
}

function classicLoginHiddenFields(html = '') {
  const body = new URLSearchParams();
  parseInputFields(String(html || '').replace(/<input\b/gi, '<input type="hidden" '), body);
  return [...body.entries()]
    .filter(([name]) => !['account', 'password', 'keepLogin'].includes(name))
    .map(([name, value]) => ({ name, value }));
}

function hasClassicSessionCookie(jar = {}) {
  return Object.keys(jar).some(key => /^(?:za|zentaosid|sid|PHPSESSID)$/i.test(key));
}

async function verifyClassicLogin(api, jar = {}) {
  const baseUrl = String(api.baseUrl || '').replace(/\/$/, '');
  try {
    const res = await fetch(`${baseUrl}/index.php?m=my&f=index&onlybody=yes`, {
      headers: {
        Cookie: formatCookies(jar),
        Referer: `${baseUrl}/index.php?m=user&f=login`
      },
      redirect: 'manual'
    });
    const text = await res.text();
    return res.ok && !isClassicLoginPage(text);
  } catch {
    return false;
  }
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
    const options = parseSelectOptionRows(match[2] || '');
    const selected = options.filter(option => option.selected);
    if (multiple) {
      selected.forEach(option => body.append(name, option.value));
    } else {
      const option = selected[0] || options[0];
      if (option) body.append(name, option.value);
    }
  }
}

function selectedChoiceFromForm(html = '', fieldNames = []) {
  for (const match of String(html || '').matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const tag = match[0];
    const name = htmlAttr(tag, 'name');
    if (!name || !fieldNames.includes(name) || hasHtmlAttr(tag, 'disabled')) continue;
    const options = parseSelectOptionRows(match[2] || '');
    const picked = options.find(option => option.selected) || options[0];
    if (!picked?.value) continue;
    return picked;
  }
  return null;
}

function parseSelectOptionRows(html = '') {
  return [...String(html || '').matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(option => {
    const optionTag = option[0];
    const attrValue = htmlAttr(optionTag, 'value');
    const label = stripHtml(option[2] || '');
    return {
      selected: hasHtmlAttr(optionTag, 'selected'),
      value: htmlDecode(attrValue !== '' ? attrValue : label),
      label: htmlDecode(label)
    };
  });
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

function classicRequiredHour(value, fallbackHour = '4') {
  const text = String(value ?? '').trim();
  if (!text || Number(text) <= 0) return String(fallbackHour || '4');
  return text;
}

function assignTaskWorkHours(detail = {}, task = {}, body = new URLSearchParams(), fallbackHour = '4') {
  const estimate = firstValue(detail.estimate, task.estimate, task.zentao?.estimate, body.get('estimate'), 0);
  const left = firstValue(detail.left, task.zentao?.left, body.get('left'), 0);
  if (hasMemberEditedWorkHours(detail, task)) {
    return {
      estimate: classicRequiredHour(estimate, fallbackHour),
      left: classicRequiredHour(left, fallbackHour)
    };
  }
  const hour = String(fallbackHour || '4');
  return {
    estimate: hour,
    left: hour
  };
}

function hasMemberEditedWorkHours(detail = {}, task = {}) {
  const estimate = numberValue(firstValue(detail.estimate, task.estimate, task.zentao?.estimate, 0));
  const left = numberValue(firstValue(detail.left, task.zentao?.left, 0));
  const consumed = numberValue(firstValue(detail.consumed, task.consumed, task.zentao?.consumed, 0));
  if (consumed > 0) return true;
  if (estimate > 0 && left > 0 && Math.abs(estimate - left) > 0.001) return true;
  const lastEditedBy = String(firstValue(detail.lastEditedBy, task.zentao?.lastEditedBy, '') || '').trim();
  const lastEditedDate = String(firstValue(detail.lastEditedDate, task.zentao?.lastEditedDate, '') || '').trim();
  const assignedDate = String(firstValue(detail.assignedDate, task.zentao?.assignedDate, '') || '').trim();
  if (lastEditedBy && lastEditedDate && (!assignedDate || Date.parse(lastEditedDate) > Date.parse(assignedDate))) return true;
  return false;
}

function numberValue(value) {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) ? number : 0;
}

function taskWorkloadAssignHour(task = {}, detail = {}) {
  if (isLowEffortArtAcceptanceTask(task, detail)) return WORKLOAD_ASSIGN_HOURS.S;
  const level = taskWorkloadLevel(task, detail);
  return WORKLOAD_ASSIGN_HOURS[level] || WORKLOAD_ASSIGN_HOURS.S;
}

function taskWorkloadLevel(task = {}, detail = {}) {
  const candidates = [
    task.workloadLevel,
    task.workloadEstimate?.level,
    task.zentao?.workloadLevel,
    task.zentao?.workloadEstimate?.level,
    detail.workloadLevel,
    detail.workloadEstimate?.level
  ];
  const explicit = candidates.map(normalizeWorkloadLevel).find(Boolean);
  return explicit || inferTaskWorkloadLevelForAssign(task, detail);
}

function normalizeWorkloadLevel(value = '') {
  const text = String(value || '').trim().toUpperCase();
  if (['XS', 'S', 'M', 'L'].includes(text)) return text;
  if (/小小单|微型|极小|很小/.test(text)) return 'XS';
  if (/小单|轻量|简单/.test(text)) return 'S';
  if (/中单|中等|标准/.test(text)) return 'M';
  if (/大单|大型|复杂|完整/.test(text)) return 'L';
  return '';
}

function inferTaskWorkloadLevelForAssign(task = {}, detail = {}) {
  const text = [
    detail.name,
    detail.title,
    detail.desc,
    detail.description,
    detail.storyTitle,
    task.title,
    task.displayTitle,
    task.requirement,
    task.description,
    task.summary,
    task.targetPage,
    task.figmaLinks,
    task.showdocHints,
    task.zentao?.desc,
    task.zentao?.description,
    task.zentao?.requirement,
    task.zentao?.storyTitle
  ].filter(Boolean).join('\n');
  let score = 1;
  const add = points => {
    score += points;
  };

  if (/web5|多主题|theme_\d|多版|多端|兼容|适配/i.test(text)) add(2);
  if (/接口|api|showdoc|联调|后台配置|配置控制|保存顺序|firebase|sdk/i.test(text)) add(2);
  if (/登录|绑定|密码|验证码|手机号|邮箱|人脸|cpf|账户|account/i.test(text)) add(3);
  if (/支付|充值|提现|钱包|余额|资金/i.test(text)) add(3);
  if (/新页面|新增页面|新模块|完整流程|全流程|详情页|子页面/i.test(text)) add(2);
  if (/figma|设计稿|还原|视觉|样式统一|皮肤|自定义入口|悬浮入口|弹窗/i.test(text)) add(1);
  if (/文案|翻译|多语言|颜色|间距|字号|图标|展示隐藏|显示隐藏/i.test(text)) add(1);
  if (/优化|调整|修改|支持|自定义/i.test(text)) add(1);

  const figmaCount = countMatches(task.figmaLinks || text, /figma\.com/ig);
  const showdocCount = countMatches(task.showdocHints || text, /showdoc|page_id|item_id|cat_id/ig);
  if (figmaCount > 1) add(1);
  if (showdocCount > 1) add(1);

  const isTinyChange = score <= 3
    && /文案|翻译|多语言|颜色|间距|字号|图标|展示隐藏|显示隐藏|展示|隐藏/i.test(text)
    && !/接口|api|showdoc|联调|登录|绑定|验证码|人脸|支付|充值|提现|钱包|新页面|新增页面|新模块|完整流程|全流程|sdk|firebase/i.test(text);

  if (isTinyChange) return 'XS';
  if (score >= 7) return 'L';
  if (score >= 4) return 'M';
  return 'S';
}

function countMatches(text = '', pattern) {
  return String(text || '').match(pattern)?.length || 0;
}

function isLowEffortArtAcceptanceTask(task = {}, detail = {}) {
  const titleText = [
    detail.name,
    detail.title,
    detail.storyTitle,
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
    detail.desc,
    detail.description,
    detail.type,
    detail.taskType,
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

function nonZeroIdValue(value) {
  const id = idValue(value);
  return id && id !== '0' && id !== '-1' ? id : '';
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

function childRow(name, assignedTo, deadline, executionId, parent, index, templateTask = {}, task = {}, detail = {}) {
  const templateEstimate = firstValue(templateTask?.estimate, templateTask?.left, 0);
  const estimate = Number(templateEstimate) > 0 ? templateEstimate : taskWorkloadAssignHour(task, detail);
  return {
    id: `child-${index + 1}`,
    enabled: true,
    name: normalizeTaskCreateTitle(name),
    assignedTo,
    deadline,
    estimate,
    executionId,
    parent,
    templateTaskId: String(templateTask?.id || templateTask?.taskID || '').trim()
  };
}

function relatedTaskList(detail = {}) {
  return extractRelatedTasks(detail)
    .filter(item => item && typeof item === 'object' && (item.id || item.taskID));
}

function findArtProductionTemplate(detail = {}, task = {}, related = []) {
  const currentId = String(zentaoTaskId(task) || zentaoTaskId(detail) || '').trim();
  const candidates = [detail, ...related].filter(item => {
    const id = String(item.id || item.taskID || '').trim();
    const name = String(item.name || item.title || '');
    if (!id) return false;
    if (currentId && id === currentId) return true;
    if (!/制作单|美术/i.test(name)) return false;
    if (/cocos|(?:^|[^A-Za-z])cos\s*\d*|客户端/i.test(name)) return false;
    return true;
  });
  return candidates.find(item => String(item.id || item.taskID || '') === currentId)
    || candidates.find(item => isArtAssigneeAccount(accountName(item.assignedTo)))
    || candidates[0]
    || detail;
}

function findCocosProductionTemplate(detail = {}, task = {}, related = []) {
  return [detail, ...related].find(item => {
    const haystack = [
      item?.name,
      item?.title,
      item?.type,
      item?.category,
      item?.taskType,
      item?.moduleName,
      item?.executionName
    ].map(value => String(value || '')).join('\n');
    if (!/制作单|美术/i.test(haystack)) return false;
    return /cocos|(?:^|[^A-Za-z])cos\s*\d*|客户端/i.test(haystack);
  }) || null;
}

function isArtAssigneeAccount(account = '') {
  const value = String(account || '').trim();
  return artAssigneeOptions.some(item => item.account === value);
}

function getBaseName(title) {
  return String(title || '')
    .replace(/^【.*?】\s*/, '')
    .replace(/\s*[-—_]*\s*美术$/, '')
    .replace(/\s*[-—_]*(?:2|cocos|cos|15)\s*$/i, '')
    .trim();
}

function normalizeTaskCreateTitle(value = '') {
  const text = String(value || '').replace(/^(?:【\s*制作单\s*】\s*)+/g, '').trim();
  return `【制作单】${text}`;
}

function withTaskSuffix(value = '', suffix = '') {
  const normalizedSuffix = String(suffix || '').trim();
  const text = String(value || '').trim();
  if (!normalizedSuffix) return text;
  return new RegExp(`${escapeRegExp(normalizedSuffix)}\\s*$`, 'i').test(text) ? text : `${text}${normalizedSuffix}`;
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

function splitMainCommentForTask(text = '') {
  const value = String(text || '');
  return /皮肤/i.test(value) && /web5?|web/i.test(value) ? WEB_SKIN_SPLIT_MAIN_COMMENT : '';
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
