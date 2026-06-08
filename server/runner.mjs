import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { appendRunLog, createArtProgressEvent, getCodexConfig, getRunWorkspace, paths, updateRun } from './store.mjs';

const processes = new Map();
const subscribers = new Map();
const runStageBuffers = new Map();
const handledRunProcessErrors = new Set();
const codexCliPath = process.env.CODEX_CLI_PATH || '/Applications/Codex.app/Contents/Resources/codex';
const execFileAsync = promisify(execFile);
const artifactStageDirs = [
  'api-compose',
  'auto-fix',
  'code-review',
  'compat-check',
  'delivery-report',
  'dev-report',
  'dev-smoke',
  'figma',
  'figma-fidelity',
  'figma-to-code',
  'i18n',
  'showdoc-model'
];

export function subscribe(runId, res) {
  if (!subscribers.has(runId)) subscribers.set(runId, new Set());
  subscribers.get(runId).add(res);
  res.on('close', () => subscribers.get(runId)?.delete(res));
}

export async function startRun(project, run) {
  if (processes.has(run.id)) {
    throw new Error('run is already running');
  }
  if (run.workflow === 'custom-workflow') {
    const validation = await validateCustomWorkflowRun(project, run);
    if (!validation.ok) {
      await updateRun(run.id, {
        status: 'blocked',
        blocker: {
          reason: validation.errors.join('；'),
          impact: '自定义流程绑定的技能不存在或阶段配置无效，平台不会启动真实执行。',
          nextStep: '修正自定义模板阶段和技能绑定后重新创建执行。'
        },
        resultSummary: {
          status: 'blocked',
          statusText: 'blocked',
          summary: validation.errors.join('；'),
          blockerReason: validation.errors.join('；'),
          impact: '执行前校验未通过。',
          nextStep: '修正自定义模板阶段和技能绑定后重新创建执行。',
          changedFiles: [],
          validationCommands: ['custom-workflow preflight validation'],
          artifacts: [],
          needsHumanReview: true,
          parsedAt: new Date().toISOString()
        }
      });
      emit(run.id, { type: 'status', status: 'blocked', message: validation.errors.join('；') });
      return { blocked: true, errors: validation.errors };
    }
  }

  const workspace = getRunWorkspace(run.id);
  await fs.mkdir(workspace, { recursive: true });
  const promptPath = path.join(workspace, 'prompt.md');
  const logPath = path.join(workspace, 'run.log');
  const artifactRoot = run.artifactRoot || buildRunArtifactRoot(project, run);
  const materialPath = run.materialPath || path.join(artifactRoot, '资料.md');
  const prompt = await buildPrompt(project, run);
  const beforeChanges = await collectGitChanges(project.rootPath);
  await prepareArtifactRoot(artifactRoot, run);
  await fs.writeFile(promptPath, prompt);
  await fs.writeFile(logPath, '');

  await updateRun(run.id, {
    status: 'running',
    currentStage: run.stages?.[0]?.name || null,
    stages: markInitialRunningStage(run.stages || []),
    startedAt: new Date().toISOString(),
    startedBy: run.startedBy || '',
    finishedAt: null,
    promptPath,
    logPath,
    artifactRoot,
    materialPath,
    changeSummary: {
      before: beforeChanges,
      after: [],
      added: [],
      changed: [],
      removed: [],
      collectedAt: ''
    }
  });

  await reportRunProgress(project, run, {
    eventType: 'task_started',
    status: 'running',
    stage: run.stages?.[0]?.name || '',
    summary: `开始执行：${run.title}`
  });
  emit(run.id, { type: 'status', status: 'running', message: 'Codex execution started' });
  const codexConfig = mergeRunCodexConfig(await getCodexConfig(), run.codexRequest);
  const args = [
    'exec',
    '--cd',
    project.rootPath,
    '--add-dir',
    artifactRoot,
    '--full-auto',
    '--sandbox',
    'workspace-write',
    '-'
  ];
  args.splice(1, 0, ...codexConfigArgs(codexConfig));

  const child = spawn(codexCliPath, args, {
    cwd: project.rootPath,
    env: codexEnvironment(codexConfig),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  processes.set(run.id, child);
  runStageBuffers.set(run.id, '');
  child.stdout.on('data', data => handleChunk(run.id, data));
  child.stderr.on('data', data => handleChunk(run.id, data, true));
  child.on('error', error => handleError(run.id, error));
  child.stdin.on('error', error => handleError(run.id, error));
  child.on('close', code => handleClose(run.id, code));
  await updateRun(run.id, { pid: child.pid });
  child.stdin.end(prompt);
  return { pid: child.pid, promptPath, logPath };
}

function codexConfigArgs(config = {}) {
  const args = [];
  if (config.model) args.push('-m', config.model);
  if (config.modelReasoningEffort) args.push('-c', `model_reasoning_effort=${tomlString(config.modelReasoningEffort)}`);
  if (config.modelProvider) args.push('-c', `model_provider=${tomlString(config.modelProvider)}`);
  if (config.baseUrl && config.modelProvider) args.push('-c', `model_providers.${config.modelProvider}.base_url=${tomlString(config.baseUrl)}`);
  if (config.wireApi && config.modelProvider) args.push('-c', `model_providers.${config.modelProvider}.wire_api=${tomlString(config.wireApi)}`);
  return args;
}

function mergeRunCodexConfig(base = {}, request = {}) {
  const reasoningEffort = String(request?.reasoningEffort || '').trim();
  const model = String(request?.model || '').trim();
  return {
    ...base,
    model: model || base.model,
    modelReasoningEffort: reasoningEffort || base.modelReasoningEffort || ''
  };
}

function codexEnvironment(config = {}) {
  const env = { ...process.env };
  if (config.apiKey) env[config.envKeyName || 'OPENAI_API_KEY'] = config.apiKey;
  return env;
}

function tomlString(value = '') {
  return JSON.stringify(String(value || ''));
}

function markInitialRunningStage(stages = []) {
  const now = new Date().toISOString();
  return stages.map((stage, index) => ({
    ...stage,
    status: index === 0 ? 'running' : 'pending',
    startedAt: index === 0 ? now : stage.startedAt || null,
    finishedAt: null,
    durationMs: 0
  }));
}

export async function cancelRun(runId, cancelledBy = '') {
  const child = processes.get(runId);
  if (!child) {
    await updateRun(runId, { status: 'cancelled', cancelledBy });
    await reportRunProgress(null, { id: runId, startedBy: cancelledBy }, {
      eventType: 'task_blocked',
      status: 'cancelled',
      summary: '执行被取消，未找到运行中的进程。'
    });
    return { cancelled: false };
  }
  child.kill('SIGTERM');
  processes.delete(runId);
  await updateRun(runId, { status: 'cancelled', cancelledBy });
  await reportRunProgress(null, { id: runId, startedBy: cancelledBy }, {
    eventType: 'task_blocked',
    status: 'cancelled',
    summary: '执行被用户中断。'
  });
  emit(runId, { type: 'status', status: 'cancelled', message: 'Run cancelled' });
  return { cancelled: true };
}

async function buildPrompt(project, run) {
  const workflowText = workflowInstruction(run);
  const artifactRoot = run.artifactRoot || buildRunArtifactRoot(project, run);

  const forbidden = [
    ...(project.forbiddenCommands || []),
    'pnpm lint:ts',
    'vue-tsc --noEmit',
    'pnpm tsc --noEmit',
    'nuxi typecheck',
    'pnpm build:local'
  ];

  return `# Art Department AI Execution Run

你正在由美术工作台调度执行一次 AI 美术任务。请严格遵循目标项目内的 AGENTS.md、.agent-hub/config.md、相关 SKILL.md、规范 md 和本次执行资料。

## Project

- projectId: ${project.id}
- name: ${project.name}
- rootPath: ${project.rootPath}
- framework: ${project.framework}
- agentConfigPath: ${project.agentConfigPath}
- skillConfigPath: ${project.skillConfigPath}
- projectTaskDir: ${project.taskDir}

## Run

- runId: ${run.id}
- taskId: ${run.taskId || '无'}
- title: ${run.title}
- taskFolderName: ${run.taskFolderName || safeTaskFolderName(run)}
- artifactRoot: ${artifactRoot}
- materialPath: ${run.materialPath || path.join(artifactRoot, '资料.md')}
- workflow: ${run.workflow}
- workflowLevel: ${run.workflowLevel || '未指定'}
- targetStage: ${run.stage || 'auto'}
- targetPage: ${run.targetPage || '无'}
- zentaoId: ${run.zentaoId || '无'}
- developer: ${run.developer || '无'}
- agentModel: ${run.agentModel || '无'}
- figmaLinks: ${run.figmaLinks || '无'}
- specOrSkillHints: ${run.showdocHints || '无'}

## Requirement

${run.requirement || '用户未填写额外需求文本，请基于标题、阶段和项目上下文执行。'}

## Task Material

本次执行资料已由平台生成在 artifactRoot/资料.md。开始处理前必须先读取这份资料，并以其中的禅道入口、任务概述、Figma 设计资料、规范 md / Skill 线索、目标放置位置和验收要求作为当前任务上下文。
如果资料中的 Figma、规范、Skill、目标页面或放置位置仍为“待确认/待补充”，不要伪造结论；请结合目标项目资料、AI 产物清单和禅道信息推断，并在阶段报告中明确记录读取限制。
存在多个 Figma 地址、多个状态或多主题矩阵时，必须逐项保留并按影响范围验证，不能按单个节点简单处理。
如果 figmaLinks 中提供了 Figma URL，该 URL 就是本次真实操作目标；必须从 URL 解析 file key、node-id、页面/Frame/分区语义，并优先在该地址对应的位置读取、检查或写入。targetPage 只是负责人补充的放置说明，不能替代 figmaLinks。
涉及 Figma 写入前，必须确认当前 Codex 会话工具列表里存在可执行的 use_figma 写入工具；只有 use_figma 成功返回 createdNodeIds 或 mutatedNodeIds，才算真实写入完成。缺少工具、插件未连接、无 node-id 或权限不足时，必须停止写入并记录具体阻塞原因。

## Execution Policy

${workflowText}

${run.workflow === 'custom-workflow'
  ? '本次是 custom-workflow 严格模式：自定义美术阶段清单优先于默认 XS/S/M/L 流程。目标项目规则只能作为单个规范或 Skill 的执行细则，不能把本次流程扩展回默认全流程。'
  : 'XS/S/M/L 执行范围由负责人选择，平台只负责编排强度。你必须以目标项目规则、规范 md 和可用 Skill 为准，不要把其他项目的规范迁移到当前项目。'}

本次执行以美术任务为主：优先读取 Figma、规范 md、Skill 和 AI 产物清单，完成设计生成、规范套用、界面走查、Skill 验证或产物归档。只有任务明确要求并且目标项目规则允许时，才修改业务代码。
所有平台产物必须写入 artifactRoot 对应目录，包括报告、截图、日志、阶段材料、Figma 证据、规范调用记录和临时审计文件。
不要把执行报告、截图、日志或验收材料写入接入项目的 .task、docs、reports 或业务源码目录。
如果具备 Figma 写入能力并需要生成界面，必须写入用户指定的 Figma 页面或 Frame；如果无法写入，必须说明缺少的工具、授权、node-id 或插件状态。

artifactRoot 是本次执行独立目录，位于平台侧任务目录的 runs 子目录下；每次重新执行都会生成新的 artifactRoot。
artifactRoot 必须保持以下目录结构，目录名和文件名不要改：

- api-compose/
- auto-fix/
- code-review/
- compat-check/
- delivery-report/
- dev-report/
- dev-smoke/
- figma/
- figma-fidelity/
- figma-to-code/
- i18n/
- showdoc-model/
- 阶段执行报告.md
- 需求清单.md

各阶段产物写入对应目录，例如 figma/report-round-1.md、figma-fidelity/report-round-1.md、delivery-report/report-round-1.md。
阶段执行报告.md 维护所有阶段的状态总览；需求清单.md 维护任务拆解、验收点、设计处理范围、规范引用和风险点。

## Art Execution Requirements

- 优先识别本次属于：Figma 设计稿生成、设计规范套用、界面走查验收、Skill 验证、产物归档整理或自定义美术流程。
- 必须记录实际读取到的规范 md、SKILL.md、Figma 链接、node-id、资产路径和放置位置。
- 如果使用了某个 Skill 或 md，必须在阶段报告里写明调用依据、输入材料、输出产物和验证结论。
- 如果本次只是走查或验收，不要无故修改原始文件；输出问题清单、截图证据和负责人复核建议即可。
- 如果生成或调整界面，必须关注字号、间距、组件层级、命名、响应式状态、重叠风险和是否符合美术部门规范。
- 最终报告必须面向美术负责人：说明完成了什么、放在哪里、还差什么、谁需要确认。

为了让平台实时展示阶段进度，进入和完成每个阶段时必须单独输出以下机器可读标记，阶段名必须与当前流程一致：

- AGENT_WORKFLOW_STAGE_START: 阶段名
- AGENT_WORKFLOW_STAGE_DONE: 阶段名 | passed
- AGENT_WORKFLOW_STAGE_DONE: 阶段名 | conditional_pass
- AGENT_WORKFLOW_STAGE_DONE: 阶段名 | skipped
- AGENT_WORKFLOW_STAGE_DONE: 阶段名 | failed

示例：

AGENT_WORKFLOW_STAGE_START: 需求解析
AGENT_WORKFLOW_STAGE_DONE: 需求解析 | passed

${run.workflow === 'custom-workflow' ? customWorkflowStrictPrompt(run) : ''}

禁止执行以下命令，除非用户在当前任务中明确要求：

${forbidden.map(item => `- ${item}`).join('\n')}

若发生阻塞，必须输出：

- 阻塞原因
- 影响范围
- 下一步最小解法

任务结束前请汇总：

- 修改或生成的关键文件
- 运行过的验证命令
- 报告/截图/日志产物路径
- 最终状态：passed / conditional_pass / failed / blocked / skipped
`;
}

function safeTaskFolderName(run) {
  return String(run.taskFolderName || run.title || run.id)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || run.id;
}

function buildRunArtifactRoot(project, run) {
  return path.join(
    paths.artifactDir,
    safePathSegment(project.id || 'project'),
    safeTaskFolderName(run),
    'runs',
    runArtifactFolderName(run)
  );
}

function runArtifactFolderName(run = {}) {
  const stamp = String(run.createdAt || new Date().toISOString())
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
    .replace(/[TZ]/g, '-')
    .replace(/-$/, '');
  const attempt = Number(run.attemptNo || 0);
  const attemptLabel = attempt > 0 ? `第${attempt}次执行` : '执行记录';
  return safePathSegment(`${attemptLabel}-${stamp}-${String(run.id || '').slice(0, 8) || 'run'}`);
}

async function prepareArtifactRoot(artifactRoot, run) {
  await fs.mkdir(artifactRoot, { recursive: true });
  const customDirs = Array.isArray(run.stages)
    ? run.stages.map(stage => stage.artifactDir || stage.skillId || '').filter(Boolean)
    : [];
  await Promise.all([...new Set([...artifactStageDirs, ...customDirs])].map(dir => fs.mkdir(path.join(artifactRoot, dir), { recursive: true })));
  await ensureTextFile(path.join(artifactRoot, '资料.md'), buildMaterialTemplate(run));
  await ensureTextFile(path.join(artifactRoot, '需求清单.md'), buildRequirementTemplate(run));
  await ensureTextFile(path.join(artifactRoot, '阶段执行报告.md'), buildStageReportTemplate(run));
}

async function ensureTextFile(file, content) {
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, content);
  }
}

function buildRequirementTemplate(run = {}) {
  return [
    `# ${run.title || '美术执行清单'}`,
    '',
    `- 任务ID：${run.zentaoId || run.taskId || '未关联'}`,
    `- 执行范围：${run.workflowLevel || '未指定'}`,
    `- 目标页面 / 放置位置：${run.targetPage || '未指定'}`,
    '',
    '## 美术执行拆解',
    '',
    '- 待执行过程中补充。',
    '',
    '## 验收点',
    '',
    '- 待执行过程中补充。',
    '',
    '## 风险与阻塞',
    '',
    '- 暂无。',
    ''
  ].join('\n');
}

function buildMaterialTemplate(run = {}) {
  return [
    '## 最小必填资料',
    '',
    '### 禅道入口',
    '',
    `- 禅道 ID / 链接：${run.zentaoId || run.taskId || '待补充'}`,
    `- 类型：${run.workflow === 'bug-fix' ? 'Bug 修复' : '美术执行'}`,
    `- 负责人 / 执行人：${run.developer || '待补充'}`,
    '',
    `### ${run.workflow === 'bug-fix' ? 'Bug 概述' : '需求概述'}`,
    '',
    run.requirement || `- ${run.title || '待补充任务说明'}`,
    '',
    '## Figma 设计资料',
    '',
    `- 是否涉及 Figma：${run.figmaLinks ? '有' : '待确认'}`,
    '- 多主题策略：待确认',
    '',
    '| 编号 | 主题 | 页面 / 模块 / 状态 | Figma 链接 / node-id | 说明 |',
    '| --- | --- | --- | --- | --- |',
    ...(String(run.figmaLinks || '').split(/\n|,|，/).map(item => item.trim()).filter(Boolean).map((item, index) => `| F-${String(index + 1).padStart(3, '0')} | 待确认 | 待确认 | ${item.replace(/\|/g, '\\|')} |  |`) || []),
    '',
    '## 规范 md / Skill 线索',
    '',
    `- 是否提供线索：${run.showdocHints ? '有' : '待确认'}`,
    `- 规范 / Skill 线索：${run.showdocHints || '待补充'}`,
    '',
    '## 美术执行约束',
    '',
    `- 目标页面 / Figma 放置位置：${run.targetPage || '待补充'}`,
    '- 涉及 Figma 写入时，必须记录页面、Frame、node-id 或不能写入的原因。',
    '- 涉及规范 md 或 Skill 时，必须记录实际读取路径、调用依据和验证结论。',
    ''
  ].join('\n');
}

function buildStageReportTemplate(run = {}) {
  const stages = Array.isArray(run.stages) && run.stages.length ? run.stages : [];
  const rows = stages.map(stage => `| ${stage.no || ''} | ${stage.name || ''} | 未执行 |  |`);
  return [
    `# ${run.title || '阶段执行报告'}`,
    '',
    `- 任务ID：${run.zentaoId || run.taskId || '未关联'}`,
    `- 执行范围：${run.workflowLevel || '未指定'}`,
    '',
    '| 序号 | 阶段 | 状态 | 产物/说明 |',
    '| --- | --- | --- | --- |',
    ...(rows.length ? rows : ['| 1 | 待执行 | 未执行 |  |']),
    '',
    '## 执行摘要',
    '',
    '- 待执行完成后补充。',
    ''
  ].join('\n');
}

function safePathSegment(value = '') {
  return String(value || 'item')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'item';
}

function workflowInstruction(run) {
  const workflow = normalizeRunWorkflow(run.workflow);
  if (workflow === 'art-micro-process') {
    return [
      '执行 XS 级快速走查：适合单个 Figma 节点、文案、颜色、间距、图标和轻量规范核对。',
      '流程：1. 读取任务与 Figma 线索；2. 匹配规范 / Skill；3. 轻量走查或生成；4. 简版交付摘要。',
      '严格控制范围，不要自动扩展为 XS/S/M/L 或完整 12 阶段，除非用户在当前任务中明确要求。'
    ].join('\n');
  }
  if (workflow === 'art-light-process') {
    return [
      '执行 S 级轻量执行：适合小范围 Figma 页面整理、规范套用、Skill 验证和局部产物归档。',
      '流程：1. 读取任务与 Figma 线索；2. 生成美术执行清单；3. 匹配规范 / Skill；4. 执行设计处理；5. 轻量验收；6. 简版交付摘要。',
      '不要自动扩展为完整 12 阶段，除非用户在当前任务中明确要求。'
    ].join('\n');
  }
  if (workflow === 'art-standard-process') {
    return [
      '执行 M 级标准执行：适合普通页面生成、设计规范套用、界面走查验收和 AI 产物归档。',
      '流程：任务与验收点解析、Figma / 规范资料整理、自动匹配规范 / Skill、执行设计生成或走查、产物位置与截图证据、规范一致性检查、问题与风险整理、美术交付报告。',
      '若某阶段按目标项目规则不涉及，必须记录跳过原因和证据。'
    ].join('\n');
  }
  if (workflow === 'art-full-process') {
    return '执行 L 级完整执行：适合新界面、多状态、多规范、多成员产物联动和需要落到指定 Figma 位置的完整任务；必须按美术阶段从资料读取到最终交付报告闭环执行。';
  }
  if (workflow === 'custom-workflow') {
    const stages = Array.isArray(run.stages) ? run.stages : [];
    return [
      `执行自定义工作流：${run.customWorkflowName || run.customWorkflowId || '未命名流程'}。`,
      '只按下方自定义阶段顺序推进，不自动扩展为 XS/S/M/L 完整流程。',
      '每个阶段开始和结束时仍必须输出 AGENT_WORKFLOW_STAGE_START / DONE 标记，阶段名必须和自定义阶段名称一致。',
      '如果阶段绑定了 skillId，请优先读取目标项目 .agent-hub/skills/<skillId>/SKILL.md；如果不存在，再按规范 md、AI 产物清单和目标项目规则判断是否跳过或用通用方式执行。',
      'required=true 表示必须执行，不能跳过；skippable=true 表示不适用时可以跳过，但必须在阶段执行报告中记录原因。',
      '',
      '自定义阶段清单：',
      ...stages.map(stage => [
        `${stage.no || ''}. ${stage.name}`,
        stage.skillId ? `skill=${stage.skillId}` : 'skill=未绑定',
        stage.skippable === true ? '可跳过' : '必跑',
        stage.doneCriteria ? `完成判定=${stage.doneCriteria}` : ''
      ].filter(Boolean).join(' | '))
    ].join('\n');
  }
  if (workflow === 'bug-fix') {
    return [
      '执行 bug-fix：只处理当前 Bug，不扩展为完整开发流程。',
      '流程：1. 复现或根据描述定位问题；2. 做最小必要代码修复；3. 运行针对性验证；4. 输出修复说明、影响范围和回归建议。',
      '不要重做需求解析、Figma 还原、ShowDoc 模型生成等完整开发单阶段，除非 Bug 修复本身明确需要。'
    ].join('\n');
  }
  return [
    `执行单个规范 / Skill：只执行目标规范或技能「${run.stage || '单技能执行'}」。`,
    `如果目标规范或技能是具体路径（例如包含 / 或以 .md、.markdown、SKILL.md 结尾），必须先读取该路径；否则先尝试读取目标项目中的 .agent-hub/skills/${run.stage || '<技能名>'}/SKILL.md。若仍不存在，再按 .agent-hub/config.md、规范 md 线索和 AI 产物清单定位对应内容。`,
    '禁止自动升级为 XS/S/M/L 流程或全流程；除非该技能文件明确要求，否则不要串行执行其他无关技能。',
    '输出必须包含：已读取的技能或规范文件、Figma / 输入材料、执行结果、证据路径、最终状态。'
  ].join('\n');
}

function normalizeRunWorkflow(workflow = '') {
  return workflow;
}

function customWorkflowStrictPrompt(run = {}) {
  const stageNames = (run.stages || []).map(stage => stage.name).filter(Boolean);
  return [
    '## Custom Workflow Strict Mode',
    '',
    '以下规则高于目标项目默认全流程阶段号：',
    '',
    `- 允许执行的阶段只有：${stageNames.join('、') || '无'}`,
    '- 禁止主动执行、补写或标记任何未列入上方清单的阶段。',
    '- 阶段执行报告.md 的总览表只能包含本次自定义阶段；不得自动生成或恢复为 12 阶段总览。',
    '- 如果某个项目技能文档提到“全流程阶段 X”，只把它理解为该技能的内部要求；不得因此追加未列入的阶段。',
    '- 每个必跑阶段必须有 START 和 DONE 标记；如果无法执行，DONE 状态必须是 failed 或 conditional_pass，并写明阻塞原因。',
    '- 可跳过阶段必须输出 DONE skipped，并在阶段执行报告中写清楚跳过原因。',
    '- 最终状态不能在必跑阶段缺失、越界阶段被执行、报告阶段不一致时写 passed。',
    ''
  ].join('\n');
}

async function handleChunk(runId, data, isError = false) {
  const text = data.toString();
  await appendRunLog(runId, text);
  await processStageMarkers(runId, text);
  emit(runId, { type: isError ? 'stderr' : 'stdout', text });
}

async function handleError(runId, error) {
  if (handledRunProcessErrors.has(runId)) return;
  handledRunProcessErrors.add(runId);
  processes.delete(runId);
  await appendRunLog(runId, `\n[runner error] ${error.message}\n`);
  await updateRun(runId, {
    status: 'failed',
    blocker: {
      reason: error.message,
      impact: 'Codex 执行进程未能正常启动或执行流程中断。',
      nextStep: '检查工作台服务环境中的 codex 命令是否可用，再重新执行该任务。'
    }
  });
  await reportRunProgress(null, { id: runId }, {
    eventType: 'task_failed',
    status: 'failed',
    summary: error.message
  });
  emit(runId, { type: 'error', message: error.message });
}

async function handleClose(runId, code) {
  if (handledRunProcessErrors.has(runId)) {
    handledRunProcessErrors.delete(runId);
    runStageBuffers.delete(runId);
    return;
  }
  processes.delete(runId);
  runStageBuffers.delete(runId);
  const baseStatus = code === 0 ? 'conditional_pass' : 'failed';
  const currentRun = await import('./store.mjs').then(mod => mod.getRun(runId));
  let changeSummary = currentRun?.changeSummary || null;
  let logText = '';
  if (currentRun?.logPath) {
    try {
      logText = await fs.readFile(currentRun.logPath, 'utf8');
    } catch {
      logText = '';
    }
  }
  if (currentRun?.projectId) {
    const project = await import('./store.mjs').then(mod => mod.getProject(currentRun.projectId));
    if (project?.rootPath) {
      const after = await collectGitChanges(project.rootPath);
      changeSummary = diffGitChanges(changeSummary?.before || [], after);
      await appendRunLog(runId, `\n[change-summary]\n${formatChangeSummary(changeSummary)}\n`);
    }
  }
  const resultSummary = buildResultSummary(logText, baseStatus, changeSummary);
  const finishedAt = new Date().toISOString();
  let stages = finalizeStageDurations(
    await inferFinishedStages(currentRun?.stages || [], baseStatus, currentRun?.artifactRoot, currentRun),
    currentRun,
    finishedAt
  );
  const strictResult = currentRun?.workflow === 'custom-workflow'
    ? validateCustomWorkflowCompletion(currentRun, stages)
    : { ok: true, errors: [] };
  const status = strictResult.ok ? baseStatus : 'failed';
  if (!strictResult.ok) {
    resultSummary.status = 'failed';
    resultSummary.statusText = 'failed';
    resultSummary.summary = `自定义流程严格校验未通过：${strictResult.errors.join('；')}`;
    resultSummary.blockerReason = strictResult.errors.join('；');
    resultSummary.impact = '本次执行没有严格按自定义阶段闭环，不能视为通过。';
    resultSummary.nextStep = '补齐缺失阶段、移除越界阶段或修正阶段报告后重新执行。';
    resultSummary.needsHumanReview = true;
    stages = stages.map(stage => strictResult.failedRequiredStageNos.has(Number(stage.no)) ? { ...stage, status: 'failed' } : stage);
    await appendRunLog(runId, `\n[custom-workflow strict-check failed]\n${strictResult.errors.map(item => `- ${item}`).join('\n')}\n`);
  }
  await updateRun(runId, { status, currentStage: null, stages, exitCode: code, pid: null, finishedAt, changeSummary, resultSummary, strictCheck: strictResult });
  await reportRunProgress(null, currentRun || { id: runId }, {
    eventType: status === 'failed' ? 'task_failed' : 'task_completed',
    status,
    summary: resultSummary.summary || `Codex exited with ${code}`
  });
  emit(runId, { type: 'status', status, exitCode: code, message: `Codex exited with ${code}` });
  if (changeSummary) emit(runId, { type: 'changeSummary', changeSummary });
  emit(runId, { type: 'resultSummary', resultSummary });
  emit(runId, { type: 'done' });
}

async function processStageMarkers(runId, text) {
  const buffered = `${runStageBuffers.get(runId) || ''}${text}`;
  const lines = buffered.split(/\r?\n/);
  runStageBuffers.set(runId, lines.pop() || '');
  for (const line of lines) {
    const event = parseStageMarker(line);
    if (!event) continue;
    await applyStageEvent(runId, event);
  }
}

function parseStageMarker(line = '') {
  const start = line.match(/AGENT_WORKFLOW_STAGE_START:\s*(.+)\s*$/);
  if (start) return { type: 'start', name: cleanupStageName(start[1]) };
  const done = line.match(/AGENT_WORKFLOW_STAGE_DONE:\s*([^|]+)\|\s*([a-z_]+)\s*$/i);
  if (done) return { type: 'done', name: cleanupStageName(done[1]), status: normalizeStageStatus(done[2]) };
  return null;
}

function cleanupStageName(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function applyStageEvent(runId, event) {
  const currentRun = await import('./store.mjs').then(mod => mod.getRun(runId));
  if (!currentRun) return;
  const now = new Date().toISOString();
  const matchedStage = (currentRun.stages || []).find(stage => stageNameMatches(stage.name, event.name));
  if (currentRun.workflow === 'custom-workflow' && !matchedStage) {
    const violation = {
      name: event.name,
      type: event.type,
      status: event.status || '',
      at: now
    };
    const strictViolations = [...(currentRun.strictViolations || []), violation];
    await appendRunLog(runId, `\n[custom-workflow violation] 未列入自定义流程的阶段标记：${event.name}\n`);
    await updateRun(runId, { strictViolations });
    emit(runId, { type: 'stageViolation', strictViolations });
    return;
  }
  const stages = (currentRun.stages || []).map(stage => {
    if (!stageNameMatches(stage.name, event.name)) return stage;
    if (event.type === 'start') {
      return {
        ...stage,
        status: 'running',
        startedAt: stage.startedAt || now,
        finishedAt: null,
        durationMs: stage.durationMs || 0
      };
    }
    const startedAt = stage.startedAt || currentRun.startedAt || now;
    return {
      ...stage,
      status: event.status,
      startedAt,
      finishedAt: now,
      durationMs: durationBetween(startedAt, now)
    };
  });
  const patch = {
    stages,
    currentStage: event.type === 'start' ? event.name : nextPendingStageName(stages)
  };
  await updateRun(runId, patch);
  await reportRunProgress(null, currentRun, {
    eventType: event.type === 'start' ? (matchedStage?.skillId ? 'skill_called' : 'task_progress') : 'task_progress',
    status: event.type === 'start' ? 'running' : event.status,
    stage: event.name,
    skillId: matchedStage?.skillId || '',
    summary: event.type === 'start' ? `进入阶段：${event.name}` : `完成阶段：${event.name}（${event.status}）`
  });
  emit(runId, { type: 'stage', ...patch });
}

async function reportRunProgress(project, run = {}, event = {}) {
  try {
    const store = await import('./store.mjs');
    const currentRun = run.id && !run.title ? await store.getRun(run.id) : run;
    const currentProject = project || (currentRun?.projectId ? await store.getProject(currentRun.projectId) : null);
    const task = currentRun?.taskId ? await store.getTask(currentRun.taskId) : null;
    await createArtProgressEvent({
      eventType: event.eventType || 'task_progress',
      runId: currentRun?.id || run.id || '',
      projectId: currentRun?.projectId || task?.projectId || '',
      projectName: currentProject?.name || '',
      taskId: currentRun?.taskId || task?.id || '',
      taskNo: currentRun?.zentaoId || task?.taskNo || '',
      zentaoTaskId: currentRun?.zentaoId || task?.taskNo || '',
      title: currentRun?.title || task?.title || '',
      memberAccount: currentRun?.startedBy || currentRun?.createdBy || currentRun?.ownerUserId || '',
      memberName: currentRun?.developer || '',
      skillId: event.skillId || currentRun?.stage || '',
      skillName: event.skillName || event.skillId || currentRun?.stage || '',
      repoPath: event.repoPath || '',
      stage: event.stage || currentRun?.currentStage || '',
      status: event.status || 'running',
      summary: event.summary || '',
      source: 'runner',
      metadata: {
        workflow: currentRun?.workflow || '',
        workflowLevel: currentRun?.workflowLevel || '',
        exitCode: currentRun?.exitCode ?? null
      }
    });
  } catch {
    // 进度上报不能阻断主执行流程。
  }
}

function durationBetween(startedAt = '', finishedAt = '') {
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (!start || !end || end < start) return 0;
  return end - start;
}

function finalizeStageDurations(stages = [], run = {}, finishedAt = new Date().toISOString()) {
  if (!Array.isArray(stages) || !stages.length) return stages;
  return stages.map((stage, index) => {
    if (stage.finishedAt && stage.durationMs) return stage;
    const startedAt = stage.startedAt || (isClosedStageStatus(stage.status) ? run?.startedAt : '');
    if (!startedAt || !isClosedStageStatus(stage.status)) return stage;
    const nextStartedAt = nextStageStartedAt(stages, index, startedAt);
    const inferredFinishedAt = nextStartedAt || (index === stages.length - 1 ? finishedAt : '');
    if (!inferredFinishedAt) return { ...stage, startedAt };
    return {
      ...stage,
      startedAt,
      finishedAt: inferredFinishedAt,
      durationMs: durationBetween(startedAt, inferredFinishedAt)
    };
  });
}

function nextStageStartedAt(stages = [], index = -1, lowerBound = '') {
  const start = Date.parse(lowerBound);
  for (let i = index + 1; i < stages.length; i += 1) {
    const nextStart = Date.parse(stages[i]?.startedAt || '');
    if (nextStart && (!start || nextStart > start)) return stages[i].startedAt;
  }
  return '';
}

function isClosedStageStatus(status = '') {
  return /done|success|passed|completed|conditional|skipped|failed|blocked|通过|完成|有条件|跳过|失败|阻塞/i.test(String(status || ''));
}

function nextPendingStageName(stages = []) {
  return stages.find(stage => /pending|created|queued|wait/i.test(String(stage.status || '')))?.name || null;
}

function stageNameMatches(stageName = '', eventName = '') {
  const source = normalizeStageName(stageName);
  const target = normalizeStageName(eventName);
  return source === target || source.includes(target) || target.includes(source);
}

async function collectGitChanges(cwd) {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', 'status', '--short', '-uall'], { cwd, timeout: 10000 });
    return stdout
      .split(/\r?\n/)
      .map(line => line.trimEnd())
      .filter(Boolean)
      .map(line => parseGitStatusLine(line));
  } catch (error) {
    return [{ status: 'ERR', path: error.message }];
  }
}

function parseGitStatusLine(line = '') {
  const status = line.slice(0, 2).trim() || '??';
  return {
    status,
    path: normalizeGitStatusPath(line.slice(3).trim())
  };
}

function normalizeGitStatusPath(value = '') {
  const raw = String(value)
    .replace(/^"(.*)"$/, '$1')
    .replace(/^.*? -> /, '')
    .trim();
  if (!/\\[0-7]{3}/.test(raw)) return raw;
  const bytes = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '\\' && /^[0-7]{3}$/.test(raw.slice(i + 1, i + 4))) {
      bytes.push(Number.parseInt(raw.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(...Buffer.from(raw[i]));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function diffGitChanges(before = [], after = []) {
  const keyOf = item => `${item.status} ${item.path}`;
  const beforeKeys = new Set(before.map(keyOf));
  const afterKeys = new Set(after.map(keyOf));
  return {
    before,
    after,
    added: after.filter(item => !beforeKeys.has(keyOf(item))),
    changed: after.filter(item => beforeKeys.has(keyOf(item))),
    removed: before.filter(item => !afterKeys.has(keyOf(item))),
    collectedAt: new Date().toISOString()
  };
}

function formatChangeSummary(summary) {
  if (!summary) return 'No change summary.';
  const lines = [
    `collectedAt: ${summary.collectedAt}`,
    `added: ${summary.added.length}`,
    `changed-existing: ${summary.changed.length}`,
    `removed-from-status: ${summary.removed.length}`
  ];
  for (const item of summary.after) lines.push(`- ${item.status} ${item.path}`);
  return lines.join('\n');
}

function buildResultSummary(logText = '', fallbackStatus = 'unknown', changeSummary = null) {
  const statusText = pickValue(logText, ['最终状态', '状态', 'Final status']) || fallbackStatus;
  const normalizedStatus = normalizeResultStatus(statusText, fallbackStatus);
  const blockerReason = pickValue(logText, ['阻塞原因', '失败原因', '原因']);
  const impact = pickValue(logText, ['影响范围', '影响']);
  const nextStep = pickValue(logText, ['下一步最小解法', '下一步', '最小解法']);
  const changedFiles = pickList(logText, ['修改或生成的关键文件', '关键文件', '变更文件']);
  const validationCommands = pickList(logText, ['运行过的验证命令', '验证命令', '验证']);
  const artifacts = pickList(logText, ['报告/截图/日志产物路径', '产物路径', '证据路径']);
  const summary = pickSummary(logText, normalizedStatus, blockerReason);

  return {
    status: normalizedStatus,
    statusText,
    summary,
    blockerReason,
    impact,
    nextStep,
    changedFiles: changedFiles.length ? changedFiles : (changeSummary?.after || []).map(item => `${item.status} ${item.path}`),
    validationCommands,
    artifacts,
    needsHumanReview: normalizedStatus !== 'passed' || Boolean(blockerReason) || Boolean(impact) || Boolean(nextStep),
    parsedAt: new Date().toISOString()
  };
}

function pickValue(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`[-*]?\\s*${escaped}\\s*[：:]\\s*(.+)`, 'i'),
      new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*([^|]+)\\|`, 'i')
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = match?.[1]?.trim();
      if (value) return cleanupValue(value);
    }
  }
  return '';
}

function pickList(text, labels) {
  const lines = text.split(/\r?\n/);
  for (const label of labels) {
    const index = lines.findIndex(line => line.includes(label));
    if (index === -1) continue;
    const inline = lines[index].split(/[：:]/).slice(1).join(':').trim();
    if (inline && !/^$|无|暂无/.test(inline)) return splitListValue(inline);
    const values = [];
    for (let i = index + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) {
        if (values.length) break;
        continue;
      }
      if (/^#{1,6}\s/.test(line) || /^[-*]?\s*[\u4e00-\u9fa5A-Za-z /]+[：:]\s*/.test(line) && values.length) break;
      const item = line.replace(/^[-*]\s*/, '').replace(/^\d+[.)、]\s*/, '').trim();
      if (item) values.push(cleanupValue(item));
      if (values.length >= 12) break;
    }
    if (values.length) return values;
  }
  return [];
}

function splitListValue(value) {
  return value
    .split(/[,，、]/)
    .map(item => cleanupValue(item))
    .filter(Boolean)
    .slice(0, 12);
}

function cleanupValue(value = '') {
  return String(value)
    .replace(/`/g, '')
    .replace(/\s+\|.*$/, '')
    .trim();
}

function normalizeResultStatus(value = '', fallback = '') {
  const raw = String(value || '').trim();
  if (/passed\s*\/\s*conditional_pass\s*\/\s*failed\s*\/\s*blocked\s*\/\s*skipped/i.test(raw)) {
    return fallback || 'unknown';
  }
  const text = `${raw} ${fallback}`.toLowerCase();
  if (/blocked|阻塞/.test(text)) return 'blocked';
  if (/failed|fail|失败|不通过/.test(text)) return 'failed';
  if (/conditional|有条件|部分|warning|风险/.test(text)) return 'conditional_pass';
  if (/skipped|skip|跳过/.test(text)) return 'skipped';
  if (/passed|pass|success|通过|完成/.test(text)) return 'passed';
  return fallback || 'unknown';
}

async function inferFinishedStages(stages = [], runStatus = '', artifactRoot = '', run = {}) {
  if (!Array.isArray(stages) || !stages.length) return stages;
  const reportStages = await readStageReportStages(artifactRoot);
  return stages.map(stage => {
    const matched = matchReportStage(stage, reportStages);
    if (matched) return { ...stage, status: normalizeStageStatus(matched.status), output: stage.output || matched.output || '' };
    if (!/pending|created|queued|wait/i.test(String(stage.status || ''))) return stage;
    if (run?.workflow === 'custom-workflow') {
      return { ...stage, status: stage.required === false ? 'skipped' : 'failed' };
    }
    if (/failed|blocked|cancelled|canceled/i.test(String(runStatus || ''))) return { ...stage, status: 'skipped' };
    if (/conditional/i.test(String(runStatus || ''))) return { ...stage, status: 'conditional_pass' };
    return { ...stage, status: 'passed' };
  });
}

async function readStageReportStages(artifactRoot = '') {
  if (!artifactRoot) return [];
  try {
    const raw = await fs.readFile(path.join(artifactRoot, '阶段执行报告.md'), 'utf8');
    return parseStageReportRows(raw);
  } catch {
    return [];
  }
}

function parseStageReportRows(raw = '') {
  const rows = [];
  const re = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm;
  let match;
  while ((match = re.exec(raw))) {
    rows.push({
      no: Number(match[1]),
      name: match[2].trim(),
      status: match[3].trim(),
      output: match[4].trim()
    });
  }
  return rows;
}

function matchReportStage(stage, reportStages) {
  const targetName = normalizeStageName(stage.name);
  return reportStages.find(item => normalizeStageName(item.name) === targetName)
    || reportStages.find(item => {
      const reportName = normalizeStageName(item.name);
      return reportName.includes(targetName) || targetName.includes(reportName);
    })
    || reportStages.find(item => Number(item.no) === Number(stage.no))
    || null;
}

function normalizeStageName(value = '') {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[\/]/g, '')
    .replace(/api/ig, '')
    .toLowerCase();
}

function normalizeStageStatus(status = '') {
  const value = String(status || '');
  if (/阻塞|失败|❌|failed|error/i.test(value)) return 'failed';
  if (/有条件|⚠️|conditional/i.test(value)) return 'conditional_pass';
  if (/跳过|未触发|⏭️|skipped|skip/i.test(value)) return 'skipped';
  if (/通过|完成|✅|passed|success|done/i.test(value)) return 'passed';
  if (/运行中|执行中|running|in_progress/i.test(value)) return 'running';
  return status || 'pending';
}

async function validateCustomWorkflowRun(project = {}, run = {}) {
  const errors = [];
  const stages = Array.isArray(run.stages) ? run.stages : [];
  if (!stages.length) errors.push('自定义流程至少需要 1 个阶段');
  const names = new Set();
  for (const stage of stages) {
    const name = String(stage.name || '').trim();
    if (!name) errors.push('存在未命名阶段');
    const normalizedName = normalizeStageName(name);
    if (normalizedName && names.has(normalizedName)) errors.push(`阶段名称重复：${name}`);
    if (normalizedName) names.add(normalizedName);
    if (stage.skillId) {
      const skillPath = path.join(project.rootPath || '', '.agent-hub', 'skills', stage.skillId, 'SKILL.md');
      try {
        await fs.access(skillPath);
      } catch {
        errors.push(`阶段「${name || stage.no}」绑定的技能不存在：${stage.skillId}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateCustomWorkflowCompletion(run = {}, stages = []) {
  const errors = [];
  const failedRequiredStageNos = new Set();
  const violations = Array.isArray(run.strictViolations) ? run.strictViolations : [];
  const requiredStages = stages.filter(stage => stage.required !== false);
  for (const stage of requiredStages) {
    const status = String(stage.status || '');
    if (!/passed|conditional_pass|skipped/i.test(status)) {
      errors.push(`必跑阶段未完成：${stage.no}. ${stage.name}`);
      failedRequiredStageNos.add(Number(stage.no));
    }
    if (/skipped/i.test(status) && stage.skippable === false) {
      errors.push(`不可跳过阶段被跳过：${stage.no}. ${stage.name}`);
      failedRequiredStageNos.add(Number(stage.no));
    }
  }
  const failedStages = stages.filter(stage => /failed|blocked/i.test(String(stage.status || '')));
  for (const stage of failedStages) {
    errors.push(`阶段失败：${stage.no}. ${stage.name}`);
    if (stage.required !== false) failedRequiredStageNos.add(Number(stage.no));
  }
  if (violations.length) {
    errors.push(`检测到 ${violations.length} 个未列入自定义流程的阶段标记：${violations.map(item => item.name).join('、')}`);
  }
  return { ok: errors.length === 0, errors, failedRequiredStageNos };
}

function pickSummary(text, status, blockerReason) {
  const explicit = pickValue(text, ['结论摘要', '总结', '执行结果', '结果']);
  if (explicit) return explicit;
  if (blockerReason) return `执行${status === 'failed' ? '失败' : '存在阻塞'}：${blockerReason}`;
  if (status === 'passed') return '执行完成，未解析到阻塞项。';
  if (status === 'conditional_pass') return '执行完成，但需要人工复核剩余风险。';
  if (status === 'failed') return '执行失败，请查看日志定位原因。';
  return '执行结束，日志未提供明确结论。';
}

function emit(runId, payload) {
  const message = `data: ${JSON.stringify({ runId, ...payload })}\n\n`;
  const set = subscribers.get(runId);
  if (!set) return;
  for (const res of set) res.write(message);
}
