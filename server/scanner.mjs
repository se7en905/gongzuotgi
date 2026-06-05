import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths } from './store.mjs';
import { buildWorkflowProfile } from './workflow.mjs';

const textExt = new Set(['.md', '.json', '.txt', '.log']);
const artGitProductExt = new Set(['.md']);
const imageExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const zentaoBaseUrl = 'https://cd.baa360.cc:20088/index.php';
const artGitSkillRepoUrl = process.env.ART_GIT_SKILL_REPO_URL || 'http://192.168.1.28:8090/art-project/Art.git';
const artGitSkillRepoDir = process.env.ART_GIT_SKILL_REPO_DIR || path.join(paths.dataDir, 'art-git');
let artGitLastSyncAt = 0;
let artGitLastSyncResult = null;

export async function scanProject(project, options = {}) {
  const root = project.rootPath;
  const shouldSyncGit = project.git?.remoteUrl && (
    project.sourceType === 'git'
    || (options.forceGitSync === true && path.resolve(root) === path.resolve(artGitSkillRepoDir))
  );
  if (shouldSyncGit) {
    await syncGenericGitRepository(project, options.forceGitSync === true);
  }
  const agentConfigAbs = path.join(root, project.agentConfigPath || 'AGENTS.md');
  const skillConfigAbs = path.join(root, project.skillConfigPath || '.agent-hub/config.md');
  const platformTaskDirAbs = path.join(paths.artifactDir, project.id);
  const packageJson = await readJsonIfExists(path.join(root, 'package.json'));
  const sourceType = String(project.sourceType || '').toLowerCase();
  const skills = ['local', 'shared'].includes(sourceType)
    ? await scanShallowDirectoryProducts(root, project)
    : project.id === (process.env.ART_PLATFORM_PROJECT_ID || process.env.ZENTAO_AUTO_SYNC_PROJECT_ID || 'art_department')
    ? await scanArtDepartmentSkills(root, options)
    : await scanSkills(root, { project });
  const configText = await readTextIfExists(skillConfigAbs);

  return {
    projectId: project.id,
    rootPath: root,
    scannedAt: new Date().toISOString(),
    framework: project.framework || detectFramework(packageJson),
    configs: {
      agentConfig: await fileInfo(root, agentConfigAbs),
      skillConfig: await fileInfo(root, skillConfigAbs),
      packageJson: await fileInfo(root, path.join(root, 'package.json'))
    },
    workflowProfile: buildWorkflowProfile(project, { skills, configText }),
    skills,
    tasks: await scanTasks(paths.artifactDir, platformTaskDirAbs, { source: 'platform', projectRoot: root }),
    detected: {
      packageManager: await detectPackageManager(root),
      scripts: packageJson?.scripts || {}
    }
  };
}

async function syncGenericGitRepository(project = {}, force = false) {
  const remoteUrl = String(project.git?.remoteUrl || '').trim();
  const root = String(project.rootPath || '').trim();
  if (!remoteUrl || !root) return null;
  try {
    await fs.mkdir(path.dirname(root), { recursive: true });
    if (await exists(path.join(root, '.git'))) {
      await restoreArtGitCacheSystemFiles(root);
      await runCommand('git', ['fetch', '--all', '--prune'], { cwd: root });
      await runCommand('git', ['pull', '--ff-only'], { cwd: root });
    } else if (!(await exists(root)) || !(await hasDirectoryEntries(root))) {
      await runCommand('git', ['clone', remoteUrl, root], { cwd: path.dirname(root) });
    } else if (force) {
      throw new Error(`Git 目录已存在但不是仓库：${root}`);
    }
  } catch (error) {
    error.message = `Git 资料库同步失败：${project.name || project.id || remoteUrl}；${error.message || error}`;
    throw error;
  }
  return { ok: true, syncedAt: new Date().toISOString(), repoUrl: remoteUrl, repoDir: root };
}

async function hasDirectoryEntries(dir = '') {
  try {
    const entries = await fs.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function collectRunArtifacts(project, run) {
  const root = resolveRunArtifactRoot(project, run);
  if (!root || !(await exists(root))) return [];

  const artifacts = [];
  const files = await walk(root, 4);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!textExt.has(ext) && !imageExt.has(ext)) continue;
    const stat = await fs.stat(file);
      artifacts.push({
        name: path.basename(file),
        path: file,
        relativePath: runArtifactRelativePath(project, file),
        type: imageExt.has(ext) ? 'image' : textArtifactType(ext, file),
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      });
  }
  return artifacts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function resolveRunArtifactRoot(project, run) {
  const taskRoot = path.join(project.rootPath, project.taskDir || '.task');
  const candidates = [
    run.artifactRoot,
    run.taskFolderName ? path.join(taskRoot, run.taskFolderName) : '',
    run.zentaoId && run.title ? path.join(taskRoot, sanitizeTaskFolderName(`${run.zentaoId} ${cleanTaskTitle(run.title, run.zentaoId)}`)) : '',
    run.title ? path.join(taskRoot, sanitizeTaskFolderName(cleanTaskTitle(run.title, run.zentaoId || ''))) : ''
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (isInsideDirectory(resolved, paths.artifactDir) || (resolved !== path.resolve(taskRoot) && isInsideDirectory(resolved, taskRoot))) {
      return resolved;
    }
  }
  return '';
}

function isInsideDirectory(target, parent) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  return resolvedTarget === resolvedParent || resolvedTarget.startsWith(`${resolvedParent}${path.sep}`);
}

function runArtifactRelativePath(project, file) {
  const artifactRoot = path.resolve(paths.artifactDir);
  const resolved = path.resolve(file);
  if (resolved.startsWith(`${artifactRoot}${path.sep}`) || resolved === artifactRoot) {
    return path.join('platform-artifacts', path.relative(artifactRoot, resolved));
  }
  return path.relative(project.rootPath, file);
}

function textArtifactType(ext, file) {
  if (ext === '.md') return 'report';
  if (ext === '.log' || /log|stdout|stderr|trace/i.test(file)) return 'log';
  if (ext === '.json') return 'data';
  return 'text';
}

async function scanSkills(root, options = {}) {
  const skillsRoot = path.join(root, '.agent-hub', 'skills');
  const directoryProducts = options.includeDirectoryProducts === false ? [] : await scanShallowDirectoryProducts(root, options.project || {});
  if (!(await exists(skillsRoot))) return directoryProducts;
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!(await exists(skillPath))) continue;
    const raw = await fs.readFile(skillPath, 'utf8');
    skills.push({
      id: entry.name,
      path: path.relative(root, skillPath),
      title: firstHeading(raw) || entry.name,
      triggers: extractTriggers(raw),
      description: extractSkillDescription(raw),
      preview: raw.slice(0, 2400)
    });
  }
  return [...skills, ...directoryProducts].sort((a, b) => a.id.localeCompare(b.id));
}

async function scanShallowDirectoryProducts(root, project = {}) {
  const resolvedRoot = path.resolve(String(root || ''));
  if (!(await exists(resolvedRoot))) {
    const error = new Error(`资料路径不存在：${resolvedRoot}`);
    error.code = 'ENOENT';
    throw error;
  }
  let entries = [];
  try {
    entries = await fs.readdir(resolvedRoot, { withFileTypes: true });
  } catch (error) {
    error.message = `资料路径读取失败：${resolvedRoot}；${error.message || error}`;
    throw error;
  }
  const products = [];
  const seenDisplayNames = new Set();
  const pushProduct = product => {
    const displayName = path.basename(String(
      product.productDisplayName
      || product.productFileName
      || product.relativePath
      || product.path
      || product.title
      || ''
    ).replace(/\\/g, '/'));
    const key = displayName.trim().toLowerCase();
    if (!key || seenDisplayNames.has(key)) return;
    seenDisplayNames.add(key);
    const productTitle = product.inventoryKind === 'skill' ? (product.title || displayName) : displayName;
    products.push({
      ...product,
      title: productTitle,
      productDisplayName: displayName,
      displayName,
      dedupeName: displayName
    });
  };
  for (const entry of entries) {
    if (!entry.isDirectory() || shouldSkipSharedProductDirectory(entry.name)) continue;
    const title = entry.name.trim();
    if (!title) continue;
    const fullPath = path.join(resolvedRoot, entry.name);
    let stat = null;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }
    pushProduct(await directoryProductRecord({
      project,
      fullPath,
      relativePath: title,
      title,
      stat,
      depth: 1
    }));
  }
  return products.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')) || a.title.localeCompare(b.title));
}

async function directoryProductRecord({ project = {}, fullPath = '', relativePath = '', title = '', stat = null, depth = 1, parentDirectory = '' } = {}) {
  const sourceLabel = project.sourceType === 'local' ? '本地目录' : '共享盘';
  const displayName = path.basename(String(title || relativePath || fullPath).replace(/\\/g, '/'));
  const skillFile = await findDirectorySkillFile(fullPath);
  const skillRaw = skillFile ? await readTextIfExists(skillFile) : '';
  const skillTitle = skillRaw ? firstHeading(skillRaw) || displayName : displayName;
  return {
    id: slugifySkillId(`directory-${relativePath || title}`),
    path: fullPath,
    skillPath: skillFile || '',
    skillRelativePath: skillFile ? path.relative(fullPath, skillFile).replace(/\\/g, '/') : '',
    relativePath,
    title: skillTitle,
    productDisplayName: displayName,
    productFileName: displayName,
    triggers: skillRaw ? extractTriggers(skillRaw) : [],
    description: skillRaw ? extractSkillDescription(skillRaw) : (depth > 1 ? `浅层目录：${relativePath}` : '共享盘浅层目录'),
    category: skillRaw ? 'Skill' : '文件夹产物',
    preview: skillRaw ? skillRaw.slice(0, 2400) : `产物目录：${relativePath || title}`,
    source: `${sourceLabel}:${project.name || '未命名资料库'}`,
    inventoryKind: skillRaw ? 'skill' : 'directory',
    directoryProduct: true,
    directoryDepth: depth,
    parentDirectory,
    uploadedAt: stat?.mtime?.toISOString() || '',
    status: 'ready',
    statusLabel: '已接入'
  };
}

async function findDirectorySkillFile(dir = '') {
  const root = path.resolve(String(dir || ''));
  const candidates = [];
  async function collect(currentDir, depth) {
    if (depth > 8) return;
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!shouldSkipSharedProductDirectory(entry.name)) await collect(path.join(currentDir, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const filePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
      candidates.push({ path: filePath, relativePath, name: entry.name, depth });
    }
  }
  await collect(root, 0);
  if (!candidates.length) return '';
  const rank = item => {
    if (item.name === 'SKILL.md') return 0;
    if (/^skill\.md$/i.test(item.name)) return 1;
    if (/skill/i.test(item.name)) return 2;
    return 9;
  };
  const selected = candidates
    .filter(item => rank(item) < 9)
    .sort((a, b) => rank(a) - rank(b) || a.depth - b.depth || a.relativePath.localeCompare(b.relativePath))[0];
  return selected?.path || '';
}

function shouldSkipSharedProductDirectory(name = '') {
  return /^(node_modules|dist|build|outputs?|scripts?|logs?|\.git|\.svn|\.hg|\.DS_Store|\.codex|\.agent-hub|__pycache__|tmp|temp)$/i.test(String(name || '').trim());
}

async function scanArtDepartmentSkills(root, options = {}) {
  const [projectSkills, gitSkills] = await Promise.all([
    scanSkills(root, { includeDirectoryProducts: false }),
    scanArtGitSkills(options)
  ]);
  const byId = new Map(projectSkills.map(skill => [`local:${skill.id}`, skill]));
  for (const skill of gitSkills) {
    const key = skill.git?.relativePath ? `git:${skill.git.relativePath}` : `git:${skill.id}:${skill.path || ''}`;
    const existing = byId.get(key);
    if (!existing) byId.set(key, skill);
    else byId.set(key, { ...existing, duplicatePaths: [skill.path, ...(existing.duplicatePaths || [])] });
  }
  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function scanArtGitSkills(options = {}) {
  const syncResult = await syncArtGitSkillRepo(options.forceGitSync === true);
  if (options.forceGitSync === true && syncResult?.ok === false) {
    throw new Error(syncResult.error || '美术资料库 Git 同步失败');
  }
  if (!(await exists(artGitSkillRepoDir))) return [];
  const files = await collectArtGitProductFiles(artGitSkillRepoDir);
  const skills = [];
  for (const entry of files) {
    const filePath = entry.path;
    const relativePath = entry.relativePath || path.relative(artGitSkillRepoDir, filePath).replace(/\\/g, '/');
    const isTextProduct = artGitProductExt.has(path.extname(relativePath).toLowerCase()) || !path.extname(relativePath);
    const raw = isTextProduct ? await fs.readFile(filePath, 'utf8') : '';
    const parsed = parseArtGitProduct(raw, filePath, relativePath, entry.productGroupPath || '');
    const stat = await fs.stat(filePath);
    const git = await gitFileMeta(filePath);
    const uploader = normalizeGitUploader(git);
    const uploadedAt = git?.uploadedAt || stat?.mtime?.toISOString() || '';
    skills.push({
      id: parsed.id,
      path: filePath,
      title: parsed.title,
      productDisplayName: parsed.productDisplayName || parsed.title,
      productFileName: parsed.productFileName || path.basename(relativePath),
      triggers: extractTriggers(raw),
      description: parsed.description,
      category: parsed.category,
      preview: raw.slice(0, 2400),
      source: `Git:${uploader || '未知'}`,
      inventoryKind: classifyArtGitMarkdown(filePath, raw, parsed),
      git,
      uploaderName: uploader || git?.uploaderName || '',
      uploaderEmail: git?.uploaderEmail || '',
      uploadedAt,
      commitSubject: git?.commitSubject || '',
      version: '1.0',
      status: 'draft',
      statusLabel: '1.0 待验证',
      validationCount: 0
    });
  }
  return skills.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')) || a.id.localeCompare(b.id));
}

async function collectMarkdownFiles(root) {
  const files = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && (entry.name === 'SKILL.md' || entry.name.toLowerCase().endsWith('.md'))) files.push(fullPath);
    }
  }
  await walk(root);
  return files;
}

async function collectArtGitProductFiles(root) {
  const candidates = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '.DS_Store' || entry.name === '.gitkeep' || shouldSkipArtGitDirectory(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && isArtGitProductPath(path.relative(root, fullPath).replace(/\\/g, '/'))) {
        candidates.push({ path: fullPath, relativePath: path.relative(root, fullPath).replace(/\\/g, '/') });
      }
    }
  }
  await walk(root);
  return selectArtGitInventoryFiles(candidates);
}

function isArtGitProductPath(relativePath = '') {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const ext = path.extname(normalized).toLowerCase();
  if (!artGitProductExt.has(ext)) return false;
  if (shouldSkipArtGitProductPath(normalized)) return false;
  return isUsefulArtGitMarkdown(normalized);
}

function shouldSkipArtGitDirectory(name = '') {
  return /^(node_modules|dist|build|outputs?|scripts?|logs?|\.codex|\.agent-hub)$/i.test(String(name || ''));
}

function shouldSkipArtGitProductPath(relativePath = '') {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return /(^|\/)(node_modules|dist|build|outputs?|scripts?|logs?)(\/|$)/i.test(normalized)
    || /(^|\/)(install|setup|report|auto-sync|troubleshooting|classification|CODEX_RULES|README)\.md$/i.test(normalized)
    || isFigmaUseConnectorPath(normalized);
}

function isFigmaUseConnectorPath(relativePath = '') {
  const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  const parts = normalized.split('/').filter(Boolean).map(part => part.replace(/\.(md|markdown)$/i, ''));
  return parts.some(part => /^(use[-_ ]?figma|figma[-_ ]?use|figma[-_ ]?mcp[-_ ]?use|mcp[-_ ]?figma[-_ ]?use)$/.test(part));
}

function isUsefulArtGitMarkdown(relativePath = '') {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const basename = path.basename(normalized);
  if (basename === 'SKILL.md') return true;
  if (!/\.md$/i.test(basename)) return false;
  if (/^(README|CLAUDE|AGENTS)\.md$/i.test(basename)) return false;
  return /(^|\/)(skills|规范类|Design|skins|美宣类|入口图|Claude-Figma-Workspace)(\/|$)/i.test(normalized);
}

function selectArtGitInventoryFiles(files = []) {
  const groups = new Map();
  for (const file of files) {
    const key = artGitProductGroupKey(file.relativePath);
    const list = groups.get(key) || [];
    list.push(file);
    groups.set(key, list);
  }
  const selected = [];
  for (const list of groups.values()) {
    const skillFile = list.find(item => path.basename(item.relativePath) === 'SKILL.md');
    if (skillFile) {
      selected.push({ ...skillFile, productGroupPath: artGitProductGroupKey(skillFile.relativePath) });
      continue;
    }
    for (const file of list.sort((a, b) => artGitMarkdownRank(a.relativePath) - artGitMarkdownRank(b.relativePath) || a.relativePath.localeCompare(b.relativePath))) {
      selected.push({ ...file, productGroupPath: artGitProductGroupKey(file.relativePath) });
    }
  }
  return selected.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function artGitMarkdownRank(relativePath = '') {
  const name = path.basename(relativePath);
  if (/规范|规则|清单|流程|指南|标准|说明|文档|模板/i.test(name)) return 0;
  return 1;
}

function artGitProductGroupKey(relativePath = '') {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts.at(-1) || '';
  if (fileName === 'SKILL.md') return parts.slice(0, -1).join('/');
  if (parts[0] === 'skills' && parts.length > 2) return `skills/${parts[1]}`;
  if (parts[0] === '入口图' && parts.length > 2) return `入口图/${parts[1]}`;
  if (parts.length <= 1) return '';
  if (parts.length === 2) return parts[0];
  return parts.slice(0, -1).join('/');
}

async function syncArtGitSkillRepo(force = false) {
  const now = Date.now();
  if (!force && artGitLastSyncResult && now - artGitLastSyncAt < 5 * 60 * 1000) return artGitLastSyncResult;
  artGitLastSyncAt = now;
  try {
    await fs.mkdir(path.dirname(artGitSkillRepoDir), { recursive: true });
    if (await exists(path.join(artGitSkillRepoDir, '.git'))) {
      await restoreArtGitCacheSystemFiles(artGitSkillRepoDir);
      await runCommand('git', ['fetch', '--all', '--prune'], { cwd: artGitSkillRepoDir });
      await runCommand('git', ['pull', '--ff-only'], { cwd: artGitSkillRepoDir });
    } else {
      await runCommand('git', ['clone', artGitSkillRepoUrl, artGitSkillRepoDir], { cwd: path.dirname(artGitSkillRepoDir) });
    }
    artGitLastSyncResult = { ok: true, syncedAt: new Date().toISOString(), repoUrl: artGitSkillRepoUrl, repoDir: artGitSkillRepoDir };
  } catch (error) {
    artGitLastSyncResult = { ok: false, error: error.message || String(error), syncedAt: new Date().toISOString(), repoUrl: artGitSkillRepoUrl, repoDir: artGitSkillRepoDir };
  }
  return artGitLastSyncResult;
}

async function restoreArtGitCacheSystemFiles(repoDir = '') {
  if (path.resolve(repoDir) !== path.resolve(artGitSkillRepoDir)) return [];
  const restored = [];
  try {
    const { stdout } = await runCommand('git', ['status', '--porcelain'], { cwd: repoDir });
    const systemFiles = stdout.split('\n')
      .map(line => line.trimEnd())
      .filter(Boolean)
      .map(line => {
        const status = line.slice(0, 2);
        const rawPath = line.slice(3).replace(/^"|"$/g, '');
        const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
        return { status, filePath };
      })
      .filter(item => path.basename(item.filePath) === '.DS_Store');
    for (const item of systemFiles) {
      if (item.status === '??') {
        await runCommand('git', ['clean', '-f', '--', item.filePath], { cwd: repoDir });
      } else {
        await runCommand('git', ['checkout', '--', item.filePath], { cwd: repoDir });
      }
      restored.push(item.filePath);
    }
  } catch {
    return restored;
  }
  return restored;
}

async function gitFileMeta(filePath) {
  if (!filePath.startsWith(artGitSkillRepoDir)) return null;
  const relativePath = path.relative(artGitSkillRepoDir, filePath);
  const history = await gitFileHistory(relativePath);
  try {
    const { stdout } = await runCommand('git', ['log', '-1', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s', '--', relativePath], { cwd: artGitSkillRepoDir });
    const [commit, uploaderName, uploaderEmail, uploadedAt, commitSubject] = stdout.trim().split('\x1f');
    return { repoUrl: artGitSkillRepoUrl, repoDir: artGitSkillRepoDir, relativePath, commit, uploaderName, uploaderEmail, uploadedAt, commitSubject, history };
  } catch {
    return { repoUrl: artGitSkillRepoUrl, repoDir: artGitSkillRepoDir, relativePath, history };
  }
}

async function gitFileHistory(relativePath = '') {
  if (!relativePath) return [];
  try {
    const { stdout } = await runCommand('git', ['log', '--follow', '-20', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s', '--', relativePath], { cwd: artGitSkillRepoDir });
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [commit, shortCommit, authorName, authorEmail, committedAt, subject] = line.split('\x1f');
      return { commit, shortCommit, authorName, authorEmail, committedAt, subject };
    });
  } catch {
    return [];
  }
}

function parseSkillMarkdown(raw, filePath) {
  let frontmatter = {};
  let body = raw;
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (match) {
    body = raw.slice(match[0].length);
    for (const line of match[1].split('\n')) {
      const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (pair) frontmatter[pair[1]] = pair[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  const id = frontmatter.name || slugifySkillId(path.basename(path.dirname(filePath)) === path.basename(artGitSkillRepoDir) ? path.basename(filePath, path.extname(filePath)) : path.dirname(filePath));
  const title = firstHeading(body) || frontmatter.title || id;
  const description = frontmatter.description || extractSkillDescription(body);
  const category = frontmatter.category || frontmatter.type || frontmatter.group || frontmatter.tags || '';
  return { id, title, description, category };
}

function parseArtGitProduct(raw, filePath, relativePath = '', productGroupPath = '') {
  const parsed = parseSkillMarkdown(raw, filePath);
  const productPath = relativePath || filePath;
  const fileName = path.basename(productPath);
  const fileBase = path.basename(productPath, path.extname(productPath));
  const extWithDot = path.extname(productPath).toLowerCase();
  const ext = extWithDot.replace(/^\./, '').toLowerCase();
  const id = slugifySkillId(relativePath || fileBase) || parsed.id;
  const folderName = productDisplayGroupName(productGroupPath || relativePath);
  const displayName = gitProductChineseDisplayName(parsed.title, folderName, fileBase, fileName);
  const title = fileName === 'SKILL.md'
    ? displayName || parsed.id
    : displayName || [folderName, fileName].filter(Boolean).join(' / ') || parsed.title || fileBase || parsed.id;
  const category = parsed.category || ext || '';
  const description = parsed.description || (ext ? `${ext} 文件` : '');
  return { ...parsed, id, title, productDisplayName: displayName || title, productFileName: displayName || fileName, category, description, productGroupPath };
}

function gitProductChineseDisplayName(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (/[\u4e00-\u9fa5]/.test(text)) return text;
  }
  return '';
}

function productDisplayGroupName(groupPath = '') {
  const parts = String(groupPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1 && /\.md$/i.test(parts[0])) return '';
  if (parts.length === 1 && /^skills?$/i.test(parts[0])) return '';
  if (parts[0] === 'skills' && parts[1]) return parts[1];
  if (parts.length === 1) return parts[0];
  return parts.slice(-2).join(' / ');
}

function classifyArtGitMarkdown(filePath, raw, parsed = {}) {
  const relativePath = path.relative(artGitSkillRepoDir, filePath).replace(/\\/g, '/');
  const basename = path.basename(filePath);
  const dirname = path.basename(path.dirname(filePath));
  const hasFrontmatterName = /^---\n[\s\S]*?\nname:\s*.+\n[\s\S]*?\n---/m.test(raw);
  const hasSkillWorkflow = /按以下方式使用本\s*skill|##\s*.*执行原则|##\s*.*工作流|##\s*.*工作流程|##\s*.*适用场景|触发(?:意图|场景|关键词)[：:]/i.test(raw);
  const inSkillDir = relativePath.startsWith('skills/') || relativePath.startsWith('入口图/');
  const isReferenceFile = /(^|\/)(references|Design|skins|规范类|\.claude)(\/|$)/i.test(relativePath);
  const title = String(parsed.title || '').toLowerCase();
  const looksLikeSkill = basename === 'SKILL.md' && inSkillDir && !isReferenceFile && (hasFrontmatterName || hasSkillWorkflow || /skill|技能/.test(title));
  return looksLikeSkill ? 'skill' : 'document';
}

function slugifySkillId(value = '') {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `skill-${Date.now()}`;
}

function normalizeGitUploader(meta) {
  const raw = String(meta?.uploaderName || meta?.uploaderEmail || '').trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  if (lowered.includes('zhangqw') || raw === '张倩文') return '张倩文';
  if (lowered.includes('yejunbo') || lowered.includes('yjb') || raw === '叶君博') return '叶君博';
  if (lowered.includes('fengshuqi') || raw === '冯淑琪') return '冯淑琪';
  if (lowered.includes('yushengwei') || raw === '余盛威') return '余盛威';
  if (lowered.includes('huangjianrong') || raw === '黄剑荣') return '黄剑荣';
  if (lowered.includes('lilh') || lowered === 'lhl' || lowered.includes('547569307') || raw === '李华玲') return '李华玲';
  if (lowered.includes('zhangzb') || raw === '张宗斌') return '张宗斌';
  if (lowered.includes('lanhj') || lowered === 'alan' || raw === '兰韩界') return '兰韩界';
  return lowered.replace(/@.*$/, '').replace(/\s+/g, '') || raw;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `${command} 退出码 ${code}`).trim()));
    });
  });
}

async function scanTasks(root, taskDirAbs, options = {}) {
  if (!(await exists(taskDirAbs))) return [];
  const entries = await fs.readdir(taskDirAbs, { withFileTypes: true });
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(taskDirAbs, entry.name);
    const runDir = await latestTaskRunDir(dir);
    const scanDir = runDir || dir;
    const stageReport = path.join(scanDir, '阶段执行报告.md');
    const requirement = path.join(scanDir, '需求清单.md');
    const material = path.join(scanDir, '资料.md');
    const files = await walk(scanDir, 4);
    const reports = files.filter(file => path.basename(file).endsWith('.md'));
    const images = files.filter(file => imageExt.has(path.extname(file).toLowerCase()));
    const reportRaw = (await exists(stageReport)) ? await fs.readFile(stageReport, 'utf8') : '';
    const devReport = path.join(scanDir, 'dev-report', 'report-round-1.md');
    const devReportRaw = (await exists(devReport)) ? await fs.readFile(devReport, 'utf8') : '';
    const stat = await fs.stat(scanDir);
    const audit = buildTaskAudit(reportRaw, devReportRaw, files, root, scanDir);
    const zentaoId = extractZentaoId(entry.name, reportRaw, devReportRaw);
    tasks.push({
      name: entry.name,
      path: path.relative(root, dir),
      rootPath: root,
      artifactRoot: dir,
      latestRunRoot: runDir || scanDir,
      source: options.source || 'platform',
      latestRunPath: runDir ? path.relative(root, runDir) : '',
      zentaoId,
      zentaoUrl: buildZentaoTaskUrl(zentaoId),
      material: (await exists(material)) ? path.relative(root, material) : '',
      stageReport: (await exists(stageReport)) ? path.relative(root, stageReport) : '',
      requirement: (await exists(requirement)) ? path.relative(root, requirement) : '',
      reports: reports.map(file => path.relative(root, file)),
      images: images.map(file => path.relative(root, file)),
      audit,
      updatedAt: stat.mtime.toISOString()
    });
  }
  return tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function latestTaskRunDir(taskDir) {
  const dirs = [];
  const collect = async (parent, importedOnly = false) => {
    if (!(await exists(parent))) return;
    const entries = await fs.readdir(parent, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(parent, entry.name);
      const stat = await fs.stat(dir);
      dirs.push({
        dir,
        mtime: stat.mtimeMs,
        imported: entry.name === 'imported-legacy',
        direct: !importedOnly
      });
    }
  };
  await collect(path.join(taskDir, 'runs'), true);
  const entries = await fs.readdir(taskDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'runs') continue;
    const dir = path.join(taskDir, entry.name);
    if (!(await looksLikeRunDir(dir))) continue;
    const stat = await fs.stat(dir);
    dirs.push({ dir, mtime: stat.mtimeMs, imported: false, direct: true });
  }
  dirs.sort((a, b) => Number(a.imported) - Number(b.imported) || b.mtime - a.mtime);
  return dirs[0]?.dir || '';
}

async function looksLikeRunDir(dir) {
  const markers = [
    '阶段执行报告.md',
    '资料.md',
    '需求清单.md',
    path.join('delivery-report', 'report-round-1.md'),
    path.join('dev-report', 'report-round-1.md'),
    path.join('code-review', 'report-round-1.md')
  ];
  for (const marker of markers) {
    if (await exists(path.join(dir, marker))) return true;
  }
  return false;
}

function extractZentaoId(...values) {
  for (const value of values) {
    const matched = String(value || '').match(/(?:禅道|zentao|task|任务|开发单)?\D*(\d{4,8})/i);
    if (matched) return matched[1];
  }
  return '';
}

function buildZentaoTaskUrl(taskId) {
  if (!taskId) return '';
  const url = new URL(zentaoBaseUrl);
  url.searchParams.set('m', 'task');
  url.searchParams.set('f', 'view');
  url.searchParams.set('taskID', taskId);
  url.searchParams.set('onlybody', 'yes');
  return url.toString();
}

function buildTaskAudit(stageReportRaw, devReportRaw, files, root, taskDir) {
  const stages = parseStageRows(stageReportRaw);
  const statusCounts = countStatuses(stages);
  const issueRows = parseIssueRows(devReportRaw || stageReportRaw);
  const rates = parseRates(devReportRaw);
    const evidenceFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return imageExt.has(ext) || file.endsWith('.json') || file.endsWith('.log');
  });
  const reportFiles = files.filter(file => file.endsWith('.md'));
  const hasRuntimeEvidence = /关键交互证据|截图证据|Playwright|运行态证据|HTTP 200|console/i.test(`${stageReportRaw}\n${devReportRaw}`);
  const hasFigmaEvidence = files.some(file => /figma-fidelity\/(comparison|diff|metrics|figma|page)/.test(file));
  const hasReviewReport = files.some(file => /code-review\/report-round-\d+\.md$/.test(file));
  const hasDeliveryReport = files.some(file => /delivery-report\/report-round-\d+\.md$/.test(file));
  const blocked = stages.filter(stage => /阻塞|❌/.test(stage.status));
  const conditional = stages.filter(stage => /有条件|⚠️/.test(stage.status));
  const passedLike = stages.filter(stage => /✅|通过|提测|⏭️/.test(stage.status)).length;
  const completion = stages.length ? Math.round((passedLike / stages.length) * 100) : 0;
  const gateScore = [
    stages.length >= 6,
    hasRuntimeEvidence,
    hasReviewReport,
    hasDeliveryReport,
    evidenceFiles.length > 0,
    issueRows.every(issue => issue.priority !== 'P0' && issue.priority !== 'P1')
  ].filter(Boolean).length;
  const manualReview = [
    {
      key: 'requirement',
      label: '需求覆盖人工确认',
      status: rates.featureRate >= 100 ? 'ready' : 'needs_review',
      detail: rates.featureRate ? `功能实现率 ${rates.featureRate}%` : '未解析到功能实现率'
    },
    {
      key: 'runtime',
      label: '运行态证据复核',
      status: hasRuntimeEvidence ? 'ready' : 'missing',
      detail: hasRuntimeEvidence ? '已检测到截图/Playwright/交互证据' : '缺少可识别运行态证据'
    },
    {
      key: 'integration',
      label: '接口联调复核',
      status: rates.integrationRate >= 100 ? 'ready' : 'needs_review',
      detail: rates.integrationRate ? `接口联调完成率 ${rates.integrationRate}%` : '未解析到接口联调完成率'
    },
    {
      key: 'delivery',
      label: '交付门禁复核',
      status: hasDeliveryReport && blocked.length === 0 ? 'ready' : 'needs_review',
      detail: hasDeliveryReport ? '存在最终交付报告' : '缺少最终交付报告'
    }
  ];

  return {
    completion,
    status: deriveTaskStatus(stages, issueRows, conditional, blocked),
    stageCount: stages.length,
    stages,
    statusCounts,
    rates,
    issueRows,
    evidenceCount: evidenceFiles.length,
    reportCount: reportFiles.length,
    hasRuntimeEvidence,
    hasFigmaEvidence,
    hasReviewReport,
    hasDeliveryReport,
    gateScore,
    gateTotal: 6,
    blockedCount: blocked.length,
    conditionalCount: conditional.length,
    manualReview,
    evidencePreview: evidenceFiles.slice(0, 8).map(file => path.relative(root, file)),
    images: files
      .filter(file => imageExt.has(path.extname(file).toLowerCase()))
      .map(file => describeImageArtifact(file, root)),
    reports: reportFiles.map(file => ({
      name: path.basename(file),
      path: file,
      relativePath: path.relative(root, file),
      stage: inferArtifactStage(file)
    })),
    taskDir: path.relative(root, taskDir)
  };
}

function describeImageArtifact(file, root) {
  const name = path.basename(file);
  const relativePath = path.relative(root, file);
  const stage = inferArtifactStage(file);
  const normalized = file.replaceAll(path.sep, '/');
  const lowerName = name.toLowerCase();
  const base = {
    name,
    path: file,
    relativePath,
    stage,
    title: name,
    meaning: '任务执行过程中留存的图片证据，用于辅助人工复核阶段结论。',
    reviewFocus: '确认图片内容与阶段报告描述一致，并检查是否存在白屏、遮挡、溢出或关键状态缺失。',
    evidenceType: '图片证据'
  };

  if (normalized.includes('/compat-check/')) {
    const viewport = lowerName.startsWith('pc-') ? 'PC 1366x768' : 'H5 375x812';
    const theme = name
      .replace(/\.(png|jpe?g|webp|gif)$/i, '')
      .replace(/^h5-/, '')
      .replace(/^pc-/, '')
      .replaceAll('-', '_');
    return {
      ...base,
      title: `${viewport} / ${theme} 兼容截图`,
      meaning: `用于证明 Team Goals 模块在 ${viewport}、${theme} 下可见，并且没有明显横向溢出、布局错位或主题变量失效。`,
      reviewFocus: '重点检查顶部导航、Team Goals tab、奖池卡片、预测区域和底部内容是否完整可见；PC 图额外检查内容宽度是否合理。',
      evidenceType: '兼容验证截图',
      viewport,
      theme
    };
  }

  if (normalized.includes('/dev-smoke/')) {
    const smokeMap = [
      ['before-auth', ['登录态进入后前态截图', '展示提交预测前的页面状态，用来证明目标页面、tab、奖池、球队卡片和记录区可渲染。']],
      ['after-submit-auth', ['提交预测后截图', '展示完成预测提交后的页面状态，用来证明关键交互已触发，票数、球队状态和记录区发生变化。']],
      ['entry-debug', ['入口定位截图', '用于定位 World Cup 页面入口和目标 tab 是否可进入。']],
      ['before', ['冒烟前态截图', '展示操作前页面状态，用于和后态截图共同证明交互闭环。']]
    ];
    const matched = smokeMap.find(([key]) => lowerName.includes(key));
    return {
      ...base,
      title: matched?.[1][0] || '轻量运行验证截图',
      meaning: matched?.[1][1] || '用于证明页面在本地运行环境中可访问、可渲染，并具备基础交互条件。',
      reviewFocus: '核对截图中的目标模块是否出现，关键按钮和状态文案是否可见，前后态是否能对应报告里的操作步骤。',
      evidenceType: '运行验证截图'
    };
  }

  if (normalized.includes('/figma-fidelity/')) {
    if (lowerName === 'comparison.png') {
      return {
        ...base,
        title: 'Figma vs 页面并排对比图',
        meaning: '用于人工比对设计稿截图与运行页面截图的布局、间距、字体、颜色、素材和模块状态差异。',
        reviewFocus: '先看整体结构是否一致，再逐块检查奖池、Team Total Goals、球队卡片、按钮、记录表和底部区域的差异。',
        evidenceType: '还原度对比图',
        leftLabel: '左侧：Figma 设计稿截图',
        rightLabel: '右侧：运行页面截图',
        compareMode: 'side-by-side'
      };
    }
    if (lowerName === 'diff.png') {
      return {
        ...base,
        title: '视觉差异热区图',
        meaning: '用于定位 Figma 与页面截图之间像素差异较大的区域，颜色越明显代表差异越集中。',
        reviewFocus: '结合 comparison.png 判断差异是否来自真实问题，还是 mock 数据、字体渲染、截图裁切或接口占位导致。',
        evidenceType: '差异图'
      };
    }
    if (lowerName === 'figma.png') {
      return {
        ...base,
        title: 'Figma 设计稿基准图',
        meaning: '作为还原度验收的设计基准，用来确认页面应该呈现的结构、素材、间距和状态。',
        reviewFocus: '核对当前节点是否是需求对应的正确 Figma 区域，以及是否包含 Team Goals 模块完整状态。',
        evidenceType: '设计稿截图'
      };
    }
    if (lowerName === 'page.png' || lowerName === 'page-aligned.png') {
      return {
        ...base,
        title: lowerName === 'page-aligned.png' ? '运行页面对齐截图' : '运行页面截图',
        meaning: '作为与 Figma 设计稿对比的实际页面截图，展示浏览器运行态下的模块效果。',
        reviewFocus: '核对截图是否来自正确页面、主题、语言和 mock/真实接口状态；关注球队图标、奖池和记录区是否与报告限制一致。',
        evidenceType: '页面截图'
      };
    }
  }

  if (normalized.includes('/figma/')) {
    return {
      ...base,
      title: 'Figma 节点读取截图',
      meaning: '用于证明阶段2已读取到设计交接节点，并沉淀为后续页面实现和还原度验收的输入。',
      reviewFocus: '确认截图对应需求里的 Figma node，且设计区域和目标模块一致。',
      evidenceType: '设计交接截图'
    };
  }

  return base;
}

function inferArtifactStage(file) {
  const normalized = file.replaceAll(path.sep, '/');
  const pairs = [
    ['dev-smoke', '运行验证'],
    ['compat-check', '兼容验证'],
    ['figma-fidelity', '还原度'],
    ['code-review', '代码审查'],
    ['dev-report', '质检报告'],
    ['delivery-report', '交付报告'],
    ['showdoc-model', '接口模型'],
    ['api-compose', '接口联调'],
    ['figma-to-code', '页面实现'],
    ['i18n', '多语言'],
    ['figma/', '设计交接']
  ];
  return pairs.find(([key]) => normalized.includes(`/${key}/`) || normalized.includes(`/${key}`))?.[1] || '任务资料';
}

function parseStageRows(raw) {
  if (!raw) return [];
  const rows = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].trim();
    if (!/^\|.+\|$/.test(header)) continue;
    if (!/阶段/.test(header) || !/状态/.test(header)) continue;

    const separator = lines[index + 1]?.trim() || '';
    if (!/^\|\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(separator)) continue;

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex].trim();
      if (!/^\|.+\|$/.test(line)) break;
      const cells = line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.trim());
      const first = cells[0] || '';
      if (!first || /^-+$/.test(first) || /^(序号|阶段|优先级|风险|问题|P\d)$/i.test(first)) continue;
      const numbered = first.match(/^(\d+)\.?\s*(.*)$/);
      const no = numbered ? Number(numbered[1]) : rows.length + 1;
      const name = numbered ? (numbered[2] || cells[1] || '').trim() : first;
      const status = numbered ? (cells[1] || '').trim() : (cells[1] || '').trim();
      const output = numbered ? (cells[2] || '').trim() : (cells[2] || '').trim();
      if (!name || /^P\d$/i.test(name) || /优先级/.test(name)) continue;
      rows.push({
        no,
        name,
        status,
        output: output.replace(/`/g, '').trim()
      });
    }
    if (rows.length) break;
  }
  return rows;
}

function countStatuses(stages) {
  return {
    pass: stages.filter(stage => /✅/.test(stage.status)).length,
    conditional: stages.filter(stage => /⚠️|有条件/.test(stage.status)).length,
    blocked: stages.filter(stage => /❌|阻塞/.test(stage.status)).length,
    skipped: stages.filter(stage => /⏭️|跳过|未触发/.test(stage.status)).length
  };
}

function parseRates(raw) {
  const pick = label => {
    const match = raw.match(new RegExp(`${label}[：:]\\s*(\\d+)%`));
    return match ? Number(match[1]) : 0;
  };
  return {
    featureRate: pick('功能实现率'),
    integrationRate: pick('接口联调完成率'),
    verificationRate: pick('验证通过率')
  };
}

function parseIssueRows(raw) {
  const rows = [];
  const re = /^\|\s*(P\d)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|(?:\s*([^|]+)\|)?/gm;
  let match;
  while ((match = re.exec(raw))) {
    rows.push({
      priority: match[1].trim(),
      issue: match[2].trim(),
      impact: match[3].trim(),
      suggestion: match[4].trim(),
      status: (match[5] || '').trim()
    });
  }
  return rows;
}

function deriveTaskStatus(stages, issueRows, conditional, blocked) {
  if (blocked.length || issueRows.some(issue => issue.priority === 'P0' || issue.priority === 'P1')) return 'blocked';
  if (conditional.length || issueRows.some(issue => issue.priority === 'P2')) return 'conditional';
  if (stages.length && stages.every(stage => /✅|⏭️|通过|提测/.test(stage.status))) return 'passed';
  return 'unknown';
}

async function fileInfo(root, file) {
  if (!(await exists(file))) return { exists: false, path: path.relative(root, file) };
  const stat = await fs.stat(file);
  return {
    exists: true,
    path: path.relative(root, file),
    size: stat.size,
    updatedAt: stat.mtime.toISOString()
  };
}

async function detectPackageManager(root) {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

function detectFramework(packageJson) {
  const deps = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
  if (deps.nuxt) return 'nuxt';
  if (deps.vite && deps.vue) return 'vue';
  if (deps.vite && deps.react) return 'react';
  if (deps.vue) return 'vue';
  if (deps.react) return 'react';
  return 'unknown';
}

function firstHeading(raw) {
  const match = raw.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function cleanTaskTitle(value = '', taskNo = '') {
  return String(value || 'Untitled task')
    .replace(new RegExp(`^\\s*${taskNo}\\s*[-_：:]*\\s*`), '')
    .trim() || 'Untitled task';
}

function sanitizeTaskFolderName(value = '') {
  return String(value || 'Untitled task')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function extractTriggers(raw) {
  const match = raw.match(/触发(?:意图|场景|关键词)[：:]\s*(.+)/);
  if (!match) return [];
  return match[1]
    .split(/[、,，]/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function extractSkillDescription(raw) {
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
  const fmDescription = frontmatter?.[1]?.match(/description:\s*>-\s*([\s\S]*?)(?:\n\w|$)/);
  if (fmDescription) {
    return fmDescription[1]
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, 360);
  }
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('---') && !line.startsWith('#') && !/^\w+:\s*/.test(line));
  return lines.slice(0, 4).join(' ').slice(0, 360);
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function readTextIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, maxDepth, depth = 0) {
  if (depth > maxDepth) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full, maxDepth, depth + 1));
    else files.push(full);
  }
  return files;
}
