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
  const body = taskEditBody(detail, task, {
    assignedTo,
    name: options.name || options.title || '',
    comment: options.comment || ''
  });
  await classicPost(api, `index.php?m=task&f=edit&taskID=${taskId}`, body, `index.php?m=task&f=edit&taskID=${taskId}&onlybody=yes`);

  const fresh = unwrapTask(await api.request({ method: 'GET', path: `/api.php/v1/tasks/${taskId}` }));
  const currentAssignee = accountName(fresh.assignedTo);
  if (currentAssignee !== assignedTo) {
    const brother = fresh?.brother && typeof fresh.brother === 'object' ? fresh.brother[String(taskId)] : null;
    if (accountName(brother?.assignedTo) !== assignedTo) {
      throw new Error(`禅道指派验证失败，当前负责人仍为 ${currentAssignee || '空'}`);
    }
  }
  return fresh;
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
    const fresh = await assignZentaoTask({ ...task, ...detail, taskNo: taskId, zentao: { ...(task.zentao || {}), id: taskId } }, { account: mainAssignee }, {
      comment: options.comment || ''
    });
    results.push({ type: 'main', ok: true, taskId, assignedTo: accountName(fresh.assignedTo) || mainAssignee });
  }

  const children = Array.isArray(plan.children) ? plan.children : [];
  for (const row of children) {
    if (row.enabled === false) continue;
    const name = String(row.name || '').trim();
    const assignedTo = String(row.assignedTo || '').trim();
    if (!name || !assignedTo) continue;
    const created = await createChildTaskClassic(api, detail, task, {
      ...row,
      name,
      assignedTo,
      parent: row.parent || taskId,
      executionId: row.executionId || plan.executionId || executionIdOf(detail, task)
    });
    results.push({ type: 'child', ok: true, taskId: String(created.id || ''), name, assignedTo });
  }
  return { taskId, results };
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

function taskAssignBodyFromForm(html = '', detail = {}, task = {}, updates = {}) {
  const formHtml = firstFormHtml(html);
  const body = formBodyFromHtml(formHtml || html);
  const uid = String(html.match(/\bvar\s+kuid\s*=\s*['"]([^'"]+)['"]/)?.[1] || '').trim();
  const assignedTo = String(updates.assignedTo || accountName(detail.assignedTo) || '').trim();

  if (uid) setFormValue(body, 'uid', uid);
  setFormValue(body, 'assignedTo', assignedTo);
  setFormValue(body, 'comment', updates.comment || '');
  ensureFormValue(body, 'env', detail.env || task.zentao?.env || '');
  ensureFormValue(body, 'estStarted', validDate(detail.estStarted || task.zentao?.estStarted || ''));
  setFormValue(body, 'deadline', validDate(detail.deadline || task.deadline || task.zentao?.deadline));
  setFormValue(body, 'estimate', classicHour(detail.estimate ?? task.estimate ?? task.zentao?.estimate ?? 0));
  setFormValue(body, 'left', classicHour(detail.left ?? task.zentao?.left ?? 0));
  ensureFormValue(body, 'relatedModules', detail.relatedModules || task.zentao?.relatedModules || '');
  setFormValue(body, 'status', detail.status || task.zentaoStatus || task.zentao?.originalStatus || 'wait');
  return body;
}

function taskEditBody(detail = {}, task = {}, updates = {}) {
  const executionId = String(firstValue(
    detail.execution?.id,
    detail.executionID,
    detail.executionId,
    detail.execution,
    detail.project?.id,
    detail.projectID,
    task.zentao?.execution,
    task.executionId,
    task.executionID
  ));
  const currentParent = idValue(firstValue(detail.parent, task.zentao?.parent, 0)) || '0';
  const currentStory = idValue(firstValue(detail.story, detail.storyID, task.zentao?.story, 0)) || '0';
  const name = firstValue(updates.name, detail.name, detail.title, task.title, task.displayTitle);
  if (!executionId) throw new Error('所属版本为空，无法提交禅道指派');
  if (!name) throw new Error('任务标题为空，无法提交禅道指派');

  return new URLSearchParams({
    color: detail.color || '',
    name,
    desc: firstValue(detail.desc, detail.description, task.requirement, task.summary),
    comment: updates.comment || '',
    lastEditedDate: normalizeClassicDateTime(detail.lastEditedDate),
    consumed: String(detail.consumed ?? 0),
    storyAssess: detail.storyAssess || '',
    isGoldChange: detail.isGoldChange || '0',
    isSureStory: detail.isSureStory || 'unknown',
    execution: executionId,
    module: String(detail.module ?? task.zentao?.module ?? 0),
    source: detail.source ?? 'customer',
    category: detail.category ?? 'feature',
    story: currentStory,
    parent: currentParent,
    assignedTo: updates.assignedTo || accountName(detail.assignedTo),
    type: detail.type ?? task.zentao?.type ?? 'study',
    subtype: detail.subtype ?? '',
    ordertype: detail.ordertype ?? task.zentao?.ordertype ?? '',
    status: detail.status ?? task.zentaoStatus ?? 'wait',
    pri: String(detail.pri ?? task.pri ?? task.priority ?? 3),
    env: detail.env ?? '',
    isSelfTest: detail.isSelfTest || '0',
    selfTest: detail.selfTest || '',
    demandReview: detail.demandReview || '0',
    artReview: detail.artReview || '0',
    optimizationResults: detail.optimizationResults || '',
    onlineFeedback: detail.onlineFeedback || '',
    estStarted: detail.estStarted ?? '',
    deadline: validDate(detail.deadline || task.deadline || task.zentao?.deadline),
    estimate: String(detail.estimate ?? task.estimate ?? task.zentao?.estimate ?? 0),
    left: String(detail.left ?? task.zentao?.left ?? 0),
    realStarted: detail.realStarted || '',
    finishedBy: accountName(detail.finishedBy),
    finishedDate: normalizeClassicDateTime(detail.finishedDate),
    canceledBy: accountName(detail.canceledBy),
    canceledDate: normalizeClassicDateTime(detail.canceledDate),
    closedBy: accountName(detail.closedBy),
    closedReason: detail.closedReason || '',
    closedDate: normalizeClassicDateTime(detail.closedDate),
    mode: detail.mode ?? ''
  });
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
  const storyId = String(detail.story || detail.storyID || task.zentao?.story || 0);
  const moduleId = String(detail.module || task.zentao?.module || 0);
  const estimate = String(row.estimate ?? 0);
  const body = new URLSearchParams({
    execution: executionId,
    category: 'feature',
    pri: String(row.pri || 2),
    estimate,
    source: 'customer',
    type: row.type || 'study',
    subtype: '',
    selectTestStory: '0',
    ordertype: detail.ordertype || task.zentao?.ordertype || '',
    teamMember: '',
    multiple: '0',
    mode: '',
    module: moduleId,
    status: 'wait',
    story: storyId,
    parent: parentId,
    color: '',
    name: stripAutoTaskTypePrefix(row.name),
    storyEstimate: '',
    storyDesc: '',
    storyPri: '',
    env: '',
    desc: row.desc || '',
    estStarted: '',
    deadline: validDate(row.deadline || detail.deadline || task.deadline || task.zentao?.deadline),
    after: 'toTaskList'
  });
  body.append('assignedTo[]', row.assignedTo);
  body.append('mailto[]', '');
  await classicPost(
    api,
    `index.php?m=task&f=create&executionID=${executionId}&storyID=${storyId}&moduleID=${moduleId}&taskID=${parentId}`,
    body,
    `index.php?m=task&f=create&executionID=${executionId}&storyID=${storyId}&moduleID=${moduleId}&taskID=${parentId}&onlybody=yes`
  );
  return { id: '', name: row.name, assignedTo: row.assignedTo };
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
  if (!text || text === '0') return '0.0';
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
