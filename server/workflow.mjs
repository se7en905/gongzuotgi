export const workflowLevels = [
  {
    level: 'XS',
    name: '快速走查',
    workflow: 'art-micro-process',
    summary: '适合单个 Figma 节点、文案、颜色、间距、图标和轻量规范核对。',
    stages: [
      '读取任务与 Figma 线索',
      '匹配规范 / Skill',
      '轻量走查或生成',
      '简版交付摘要'
    ]
  },
  {
    level: 'S',
    name: '轻量执行',
    workflow: 'art-light-process',
    summary: '适合小范围 Figma 页面整理、规范套用、Skill 验证和局部产物归档。',
    stages: [
      '读取任务与 Figma 线索',
      '生成美术执行清单',
      '匹配规范 / Skill',
      '执行设计处理',
      '轻量验收',
      '简版交付摘要'
    ]
  },
  {
    level: 'M',
    name: '标准执行',
    workflow: 'art-standard-process',
    summary: '适合普通页面生成、设计规范套用、界面走查验收和 AI 产物归档。',
    stages: [
      '任务与验收点解析',
      'Figma / 规范资料整理',
      '自动匹配规范 / Skill',
      '执行设计生成或走查',
      '产物位置与截图证据',
      '规范一致性检查',
      '问题与风险整理',
      '美术交付报告'
    ]
  },
  {
    level: 'L',
    name: '完整执行',
    workflow: 'art-full-process',
    summary: '适合新界面、多状态、多规范、多成员产物联动和需要落到指定 Figma 位置的完整执行。',
    stages: [
      '任务与验收点解析',
      'Figma / 规范 / Skill 资料整理',
      '自动匹配可用规范与资产',
      '生成执行清单与放置计划',
      '执行 Figma 生成或界面整理',
      '规范一致性检查',
      '多状态 / 多尺寸走查',
      '截图与节点证据整理',
      'Skill / md 调用记录',
      '问题与风险清单',
      '负责人复核建议',
      '最终交付报告'
    ]
  }
];

const skillToStage = {
  'parse-task': ['需求解析', '资料整理'],
  'showdoc-generator': ['接口模型'],
  'api-compose': ['接口联调'],
  'figma-to-code': ['页面实现'],
  'i18n-generator': ['多语言'],
  'dev-smoke': ['运行验证'],
  'compat-check': ['兼容验证'],
  'figma-fidelity-report': ['还原度'],
  'code-review': ['代码审查'],
  'dev-report': ['质检报告'],
  'delivery-report': ['交付报告'],
  'bug-audit-report': ['Bug 质检']
};

export function buildWorkflowProfile(project, scanInput = {}) {
  const skills = scanInput.skills || [];
  const skillIds = new Set(skills.map(skill => skill.id));
  const configText = scanInput.configText || '';
  const hasFullProcess = /全流程|阶段1|阶段12|完整流程/.test(configText);
  const projectLevels = workflowLevels.map(level => {
    const missingSkills = expectedSkillsForLevel(level.level).filter(skillId => !skillIds.has(skillId));
    return {
      ...level,
      supported: level.level !== 'L' || hasFullProcess || missingSkills.length <= 2,
      missingSkills,
      projectRuleSource: project.skillConfigPath || '.agent-hub/config.md'
    };
  });

  return {
    projectId: project.id,
    ruleSource: {
      agentConfigPath: project.agentConfigPath || 'AGENTS.md',
      skillConfigPath: project.skillConfigPath || '.agent-hub/config.md',
      taskDir: project.taskDir || '.task'
    },
    skillCount: skills.length,
    skills: skills.map(skill => ({
      id: skill.id,
      title: skill.title,
      stages: skillToStage[skill.id] || []
    })),
    levels: projectLevels,
    defaultLevel: 'M',
    notes: [
      'XS/S/M/L 由人工在执行前指定，平台只做建议和计划预览。',
      '执行时会进入目标项目根目录，并遵循该项目自己的 AGENTS.md、.agent-hub/config.md 和技能文件。',
      '不同项目的技能、禁止命令和阶段规则相互隔离。'
    ]
  };
}

export function buildWorkflowPlan(input = {}) {
  const level = normalizeLevel(input.level);
  const base = workflowLevels.find(item => item.level === level) || workflowLevels[1];
  const stages = base.stages.map((name, index) => ({
    no: index + 1,
    name,
    status: 'pending'
  }));
  return {
    level: base.level,
    name: base.name,
    workflow: input.workflow || base.workflow,
    summary: base.summary,
    projectId: input.projectId || '',
    zentaoId: input.zentaoId || '',
    title: input.title || '',
    stages,
    policies: [
      '执行级别以人工选择为准。',
      '平台不会把一个项目的规范或 Skill 套到另一个项目。',
      'XS/S/M/L 只决定美术执行强度，具体处理仍读取目标项目规则、规范 md 和可用 Skill。',
      '执行任务可能生成或修改平台产物，也可能在具备 Figma 写入能力时写入 Figma；启动前请确认项目、ZenTao ID、Figma 链接和放置位置。'
    ]
  };
}

export function normalizeLevel(value) {
  const level = String(value || '').trim().toUpperCase();
  return ['XS', 'S', 'M', 'L'].includes(level) ? level : 'M';
}

export function workflowForLevel(level) {
  return (workflowLevels.find(item => item.level === normalizeLevel(level)) || workflowLevels[1]).workflow;
}

export function stagesForWorkflow(workflow, requestedStage = '', workflowLevel = '') {
  if (workflow === 'bug-fix') {
    return [
      'Bug 复现与定位',
      '最小修复',
      '针对性验证',
      '回归说明'
    ].map((name, index) => ({ no: index + 1, name, status: 'pending' }));
  }

  if (workflow === 'custom-workflow') {
    return normalizeCustomStages(requestedStage);
  }

  const normalizedWorkflow = normalizeWorkflowId(workflow);
  const levelByWorkflow = workflowLevels.find(item => item.workflow === normalizedWorkflow)?.level;
  const level = normalizeLevel(workflowLevel || levelByWorkflow);
  if (normalizedWorkflow !== 'art-single-skill') {
    return buildWorkflowPlan({ level }).stages;
  }

  return [
    {
      no: 1,
      name: requestedStage || '单技能执行',
      status: 'pending'
    }
  ];
}

export function normalizeWorkflowId(workflow = '') {
  return workflow;
}

export function normalizeCustomStages(stages = []) {
  const source = Array.isArray(stages) ? stages : [];
  const normalized = source
    .map((stage, index) => {
      const flags = normalizeStageFlags(stage);
      return {
        no: index + 1,
        id: safeStageId(stage.id || stage.skillId || stage.name || `stage-${index + 1}`),
        name: String(stage.name || stage.skillId || `自定义阶段 ${index + 1}`).trim(),
        skillId: String(stage.skillId || '').trim(),
        required: flags.required,
        skippable: flags.skippable,
        artifactDir: safeStageId(stage.artifactDir || stage.skillId || stage.id || stage.name || `custom-stage-${index + 1}`),
        description: String(stage.description || '').trim(),
        doneCriteria: String(stage.doneCriteria || '').trim(),
        status: stage.status || 'pending'
      };
    })
    .filter(stage => stage.name);
  return normalized.length ? normalized : [{ no: 1, id: 'custom-stage-1', name: '自定义阶段 1', skillId: '', required: true, skippable: false, artifactDir: 'custom-stage-1', description: '', doneCriteria: '', status: 'pending' }];
}

function normalizeStageFlags(stage = {}) {
  if (stage.skippable === true && stage.required !== true) {
    return { required: false, skippable: true };
  }
  return { required: true, skippable: false };
}

function safeStageId(value = '') {
  return String(value || 'custom-stage')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'custom-stage';
}

function expectedSkillsForLevel(level) {
  if (level === 'XS') return ['parse-task', 'dev-smoke', 'delivery-report'];
  if (level === 'S') return ['parse-task', 'dev-smoke', 'code-review', 'delivery-report'];
  if (level === 'M') return ['parse-task', 'dev-smoke', 'compat-check', 'code-review', 'dev-report', 'delivery-report'];
  return [
    'parse-task',
    'showdoc-generator',
    'api-compose',
    'figma-to-code',
    'i18n-generator',
    'dev-smoke',
    'compat-check',
    'figma-fidelity-report',
    'code-review',
    'dev-report',
    'delivery-report'
  ];
}
