#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const defaultOutDir = path.join(rootDir, ".cache", "art-brief");
const zentaoBaseUrl = normalizeZentaoBaseUrl(process.env.ZENTAO_URL || process.env.ART_BRIEF_ZENTAO_URL || "https://cd.baa360.cc:20088");

const ART_KEYWORDS = [
  "美术",
  "效果图",
  "UI",
  "ui",
  "图标",
  "金币",
  "锁住",
  "锁定",
  "未解锁",
  "蒙版",
  "提示条",
  "tips",
  "tip",
  "弹层",
  "按钮",
  "卡片",
  "展示",
  "样式",
  "切图",
  "资源",
  "视觉",
  "客户端",
  "搜索结果页",
  "搜索状态",
  "搜索游戏",
  "推荐游戏",
  "热门推荐",
  "web",
  "Web5",
  "空状态",
  "状态分页",
  "类型分页",
  "入口展示",
  "页面适配",
  "适配效果",
  "单钱包",
  "双钱包",
];

const DEV_KEYWORDS = [
  "接口",
  "后台",
  "校验",
  "发放",
  "派发",
  "字段",
  "保存",
  "回显",
  "自动",
  "逻辑",
  "数据库",
  "统计口径",
];

function parseArgs(argv) {
  const args = {
    task: "",
    outDir: defaultOutDir,
    open: false,
    json: false,
    download: true,
    taskJson: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      if (arg.includes("=")) return arg.slice(arg.indexOf("=") + 1);
      i += 1;
      return argv[i];
    };

    if (arg === "--open") args.open = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--no-download") args.download = false;
    else if (arg.startsWith("--task-json")) args.taskJson = path.resolve(readValue());
    else if (arg.startsWith("--task")) args.task = readValue();
    else if (arg.startsWith("--url")) args.task = readValue();
    else if (arg.startsWith("--out-dir")) args.outDir = path.resolve(readValue());
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!args.task) {
      args.task = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node zentao-art-brief.mjs <task-id-or-url> [options]

Options:
  --task <id>       ZenTao task id
  --url <url>       ZenTao task URL
  --out-dir <dir>   output directory, default: .cache/art-brief
  --task-json <file> read task data from a local JSON file first
  --open            open generated HTML report
  --json            print machine-readable summary
  --no-download     skip downloading image attachments
`);
}

function normalizeZentaoBaseUrl(value) {
  return String(value || "")
    .replace(/\/index\.php.*$/i, "")
    .replace(/\/+$/, "");
}

function extractTaskId(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  const taskMatch = text.match(/[?&]taskID=(\d+)/i);
  if (taskMatch) return taskMatch[1];
  const idMatch = text.match(/\b(\d{2,})\b/);
  return idMatch ? idMatch[1] : "";
}

function readTask(taskId) {
  const raw = runCommand(findCommand("zentao"), ["task", "get", "--id", String(taskId), "--json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const payload = JSON.parse(raw);
  if (!payload || payload.status !== 1 || !payload.result) {
    throw new Error(payload?.msg || `Cannot read ZenTao task ${taskId}`);
  }
  return payload.result;
}

function readTaskFromJson(file) {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const task = payload?.result || payload?.task || payload;
  if (!task || typeof task !== "object") {
    throw new Error(`Task JSON is invalid: ${file}`);
  }
  return normalizeLocalTask(task);
}

function normalizeLocalTask(task) {
  const zentao = task.zentao || {};
  return {
    ...task,
    id: task.zentao?.id || task.taskNo || task.id,
    name: task.name || task.title || task.displayTitle || `任务 ${task.taskNo || task.id || ""}`.trim(),
    desc: task.desc || task.description || task.requirement || task.summary || "",
    storySpec: task.storySpec || task.story?.spec || task.zentao?.storySpec || task.requirement || "",
    storyVerify: task.storyVerify || task.story?.verify || task.zentao?.storyVerify || "",
    files: task.files || zentao.files || {},
    actions: task.actions || zentao.actions || []
  };
}

function runCommand(command, args, options) {
  if (process.platform !== "win32") return execFileSync(command, args, options);
  const cmdLine = [quoteCmd(command), ...args.map(quoteCmd)].join(" ");
  return execFileSync("cmd.exe", ["/d", "/s", "/c", cmdLine], options);
}

function quoteCmd(value) {
  const text = String(value);
  if (!/[ \t&()^=;!'+,`~[\]{}]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function findCommand(name) {
  if (process.platform !== "win32") return name;
  const pathDirs = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  const names = [`${name}.cmd`, `${name}.exe`, `${name}.ps1`, name];
  for (const dir of pathDirs) {
    for (const candidateName of names) {
      const candidate = path.join(dir, candidateName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return name;
}

function htmlToText(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*(p|li|h[1-6]|tr|table|ul|ol|div)\s*>/gi, "\n")
      .replace(/<\s*(p|li|h[1-6]|tr|table|ul|ol|div)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function uniqueRequirementItems(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item || "").replace(/^\s*\d+[、.．]\s*/, "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSourceLines(task) {
  const texts = [
    htmlToText(task.desc),
    htmlToText(task.storySpec),
    htmlToText(task.storyVerify),
    ...((task.actions || []).map((action) => htmlToText(action.comment || ""))),
  ];

  return unique(
    texts
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

function includesAny(text, keywords) {
  const source = String(text || "");
  return keywords.some((keyword) => source.includes(keyword));
}

function isExternalArtMaterialRequestLine(line) {
  const text = String(line || "");
  return /(?:厂商|廠家|厂家|外部|CP|供应商).*(?:素材|资源).*(?:提供|提交|补充|给|上传)|(?:素材|资源).*(?:按优先级|优先级从小到大|1为最优先).*(?:提供|提交)|(?:美术素材|素材).*(?:请|需要).*(?:提供|提交)/.test(text);
}

function extractQuotedNoDo(lines) {
  return lines.filter((line) => isExternalArtMaterialRequestLine(line) || /(?:美术|设计|UI|视觉|图标|图片|效果图).*(?:不要|不需要|不调整|不做|无需|不再)|(?:不要|不需要|不调整|不做|无需|不再).*(?:美术|设计|UI|视觉|图标|图片|效果图)/.test(line));
}

function extractRequestedRequirementNumbers(task = {}) {
  const desc = htmlToText(task.desc || "");
  const match = desc.match(/(?:^|[^\d])((?:\d+[、,，、\s]*){2,})/);
  if (!match) return [];
  return unique((match[1].match(/\d+/g) || []).map(Number)).filter((num) => num > 0 && num < 100);
}

function isTranslationDetailLine(line = "") {
  const text = String(line || "").trim();
  if (/^(cocos|web)全部翻译|测试核对[:：]?|^[a-z]{2}(?:-[a-z]+)?\s*[—-]/i.test(text)) return true;
  const commaCount = (text.match(/,/g) || []).length;
  return text.length > 180 && commaCount >= 6;
}

function normalizeRequirementSummary(text = "") {
  return String(text || "")
    .replace(/^\s*[\d一二三四五六七八九十]+[、.．]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNumberedRequirementItems(task = {}, lines = []) {
  const requested = extractRequestedRequirementNumbers(task);
  const requestedSet = new Set(requested);
  const items = [];
  let current = null;

  for (const line of lines) {
    const match = String(line || "").match(/^\s*(\d+)[、.．]\s*(.*)$/);
    if (match) {
      const rest = String(match[2] || "").trim();
      if (/^\d+[、,，]/.test(rest)) continue;
      if (current) items.push(current);
      current = { number: Number(match[1]), parts: [rest].filter(Boolean) };
      continue;
    }
    if (!current) continue;
    if (/^需求[:：]?$|^需求范围$|^后台[:：]|^皮肤[:：]/.test(line)) continue;
    if (isTranslationDetailLine(line)) continue;
    if (/^https?:\/\//i.test(line)) continue;
    if (String(line).length > 220 && !/[\u4e00-\u9fa5]/.test(line)) continue;
    current.parts.push(line);
  }
  if (current) items.push(current);

  return items
    .filter((item) => !requestedSet.size || requestedSet.has(item.number))
    .map((item) => {
      const parts = item.parts.map(normalizeRequirementSummary).filter(Boolean);
      const title = parts[0] || "第 " + item.number + " 项需求";
      const detail = parts.slice(1).find((part) => !isTranslationDetailLine(part) && !/^测试核对/.test(part));
      const text = detail && !title.includes(detail) ? item.number + ". " + title + "：" + detail : item.number + ". " + title;
      return text.length > 160 ? text.slice(0, 157) + "..." : text;
    })
    .filter(Boolean);
}
function inferArtItems(task, lines) {
  const numberedItems = extractNumberedRequirementItems(task, lines);
  const artLines = lines.filter((line) => includesAny(line, ART_KEYWORDS));
  const noDoLines = extractQuotedNoDo(lines);
  const title = String(task.name || "");
  const combined = `${title}\n${lines.join("\n")}`;
  const addedEntryNames = extractAddedEntryNames(task);
  const needs = [...numberedItems];
  const avoid = [];
  const confirm = [];

  for (const line of artLines) {
    const isVisual = isVisualDeliverableLine(line);
    const isMostlyDev = includesAny(line, DEV_KEYWORDS) && !isVisual;
    const isLongRequirement = line.length > 80 && !/美术|效果图|蒙版|展示/.test(line);
    const isConfigRule = isNonArtConfigRule(line);
    const isHeading = /^(美术需求|客户端表现|展示规则|需求说明)$/.test(line) || /^[\d一二三四五六七八九十]+[\s、.．-]*(美术需求|客户端表现|展示规则|需求说明)?$/.test(line);
    const isVersionRecord = /^v\d+(?:\.\d+)?\d{4}-\d{2}-\d{2}/i.test(line);
    const isProcessNote = /同步.*参考图|更新.*截图|回填.*截图|删除.*描述|创建需求说明/.test(line);
    const isBackendInteraction = isBackendInteractionRule(line);
    if (isVisual && !isHeading && !isVersionRecord && !isProcessNote && !isBackendInteraction && !isConfigRule && !isMostlyDev && !isLongRequirement && !isExternalArtMaterialRequestLine(line) && !/不要|不需要|不调整|不做|无需/.test(line)) {
      needs.push(line);
    }
  }

  if (addedEntryNames.length && /补充.*入口.*图标|缺失.*入口.*图标|默认图标/.test(combined)) {
    needs.unshift(`为以下 ${addedEntryNames.length} 个新增入口补充默认图标：${addedEntryNames.join("、")}。`);
  }

  for (const line of noDoLines) {
    avoid.push(line);
  }

  for (const line of artLines) {
    if (isBackendInteractionRule(line)) {
      avoid.push(`${line}（后台交互/后端实现，不作为美术产出）`);
    }
  }

  if (/金币/.test(combined)) {
    needs.unshift("任务奖励类型新增金币奖励，需要补充/确认金币奖励在任务档位中的展示样式。");
    confirm.push("金币奖励是否完全沿用现有金币图标、单位和领取反馈样式。");
  }

  if (/锁住|锁定|未解锁|门槛|蒙版/.test(combined)) {
    needs.unshift("新增不满足门槛时的锁住态视觉：任务内容弱化、覆盖半透明蒙版、居中锁图标/未解锁提示。");
    confirm.push("锁住态是只覆盖任务档位区域，还是覆盖整个洗码任务模块。");
  }

  if (/tips|tip|黑色/.test(combined) && /不要|不做|无需/.test(combined)) {
    avoid.unshift("参考图里的黑色 tips / 气泡弹层不做。");
  }

  return {
    needs: uniqueRequirementItems(needs).slice(0, 8),
    avoid: unique(avoid).slice(0, 8),
    confirm: unique(confirm).slice(0, 8),
    sourceLines: unique([...numberedItems, ...artLines]).slice(0, 20),
  };
}

function extractAddedEntryNames(task) {
  const htmlBlocks = [task.desc, task.storySpec, task.storyCustomDemandSpec].filter(Boolean).map(String);
  const names = [];

  for (const html of htmlBlocks) {
    const cue = html.search(/同步新增以下入口|新增以下入口|本期新增.*入口/);
    if (cue < 0) continue;

    const afterCue = html.slice(cue);
    for (const tableMatch of afterCue.matchAll(/<table[\s\S]*?<\/table>/gi)) {
      const table = tableMatch[0];
      if (!/<th[^>]*>\s*入口名称\s*<\/th>/i.test(table)) continue;

      for (const match of table.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)) {
        const value = htmlToText(match[1]).trim();
        if (!value || /入口名称|范围项|内容|所属后台|涉及皮肤|涉及国家|路径/.test(value)) continue;
        if (value.length > 30) continue;
        names.push(value);
      }
    }
  }

  return unique(names);
}

function isVisualDeliverableLine(line) {
  const text = String(line || "");
  const visualTerms = /美术|效果图|图标|蒙版|样式|视觉|锁住|锁定|未解锁|提示条|卡片|客户端活动卡片|奖励展示|尺寸|格式|大小限制|间距|字号|Banner|图片|短文案|空状态|状态分页|类型分页|入口展示|页面适配|适配效果|Web5\s*页面适配|单钱包|双钱包|搜索结果页|搜索状态|搜索游戏|推荐游戏|热门推荐/.test(text);
  const displayOnly = /展示/.test(text) && /尺寸|间距|字号|样式|图标|图片|Banner|卡片|蒙版|弹框|弹窗|入口区域|入口|横向|顶部|搜索|游戏|推荐/.test(text);
  const searchFlow = /搜索/.test(text) && /客户端|app|pc|图标|输入|未输入|结果页|推荐游戏|搜索游戏|热门推荐|状态|展示/.test(text);
  return visualTerms || displayOnly || searchFlow;
}

function isNonArtConfigRule(line) {
  const text = String(line || "");
  if (isBackendInteractionRule(text)) return true;
  if (/上传位置|后台上传提示/.test(text)) return true;
  const hasConcreteVisualAsk = /图标.*(尺寸|格式|大小限制)|展示尺寸|间距|字号|样式确认|效果图|视觉/.test(text);
  if (hasConcreteVisualAsk) return false;
  if (/搜索/.test(text) && /客户端|app|pc|图标|输入|未输入|结果页|推荐游戏|搜索游戏|热门推荐|状态|展示/.test(text)) return false;
  if (/上传位置|上传提示|后台上传提示/.test(text)) return true;
  return /配置|保存|启停|启用|关闭|开启|排序|跳转|内链|外链|上传|维护|选择|开关|允许|后台|运营/.test(text);
}

function isBackendInteractionRule(line) {
  const text = String(line || "");
  return /鼠标移入|鼠标移出|移入时|未移入|预览按钮|点击后弹出|点击.*弹出.*预览|弹出.*预览图|不显示预览按钮/.test(text);
}

function extractImageUrls(task) {
  const urls = [];
  const htmlBlocks = [task.desc, task.storySpec, task.storyVerify].filter(Boolean);

  for (const html of htmlBlocks) {
    const srcMatches = String(html).matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
    for (const match of srcMatches) {
      urls.push({ url: resolveZenTaoUrl(decodeEntities(match[1])), title: "", fileId: "" });
    }
    const placeholderMatches = String(html).matchAll(/\{?(\d+)\.(png|jpg|jpeg|gif|webp)\}?/gi);
    for (const match of placeholderMatches) {
      urls.push({ url: resolveZenTaoUrl(match[1] + "." + match[2]), title: "", fileId: match[1] });
    }
  }

  for (const file of Object.values(task.files || {})) {
    if (isImageExt(file.extension)) {
      urls.push({
        url: zentaoBaseUrl + "/index.php?m=file&f=read&t=" + encodeURIComponent(file.extension) + "&fileID=" + file.id,
        title: file.title || file.pathname || "",
        fileId: file.id || ""
      });
    }
  }

  const seen = new Set();
  return urls.filter((item) => {
    const key = item.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveZenTaoUrl(value) {
  const text = String(value || "").trim();
  const fileId = text.match(/\{?(\d+)\.(png|jpg|jpeg|gif|webp)\}?/i);
  if (fileId && !/^https?:\/\//i.test(text)) {
    return zentaoBaseUrl + "/index.php?m=file&f=read&t=" + fileId[2].toLowerCase() + "&fileID=" + fileId[1];
  }
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("/")) return zentaoBaseUrl + text;
  return text;
}

function isImageExt(ext) {
  return /^(png|jpg|jpeg|gif|webp)$/i.test(String(ext || ""));
}

function extensionFromUrl(url) {
  const t = String(url).match(/[?&]t=([a-z0-9]+)/i);
  if (t) return t[1].toLowerCase();
  const ext = String(url).match(/\.([a-z0-9]+)(?:[?#]|$)/i);
  return ext ? ext[1].toLowerCase() : "png";
}

async function downloadImages(urls, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const images = [];

  for (let i = 0; i < urls.length; i += 1) {
    const item = typeof urls[i] === "string" ? { url: urls[i], title: "", fileId: "" } : urls[i];
    const url = item.url;
    const ext = extensionFromUrl(url);
    const file = path.join(outDir, "ref-" + String(i + 1).padStart(2, "0") + "." + ext);
    try {
      await downloadFile(url, file);
      images.push({ ...item, url, file, ok: true, ...classifyImage(file, url, item) });
    } catch (error) {
      images.push({ ...item, url, file: "", ok: false, error: error.message });
    }
  }

  return images;
}

function downloadFile(url, file) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const options = url.startsWith("https:")
      ? { rejectUnauthorized: false }
      : {};

    const request = client.get(url, options, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        downloadFile(new URL(response.headers.location, url).href, file).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error("HTTP " + response.statusCode));
        return;
      }

      const stream = fs.createWriteStream(file);
      response.pipe(stream);
      stream.on("finish", () => stream.close(resolve));
      stream.on("error", reject);
    });

    request.on("error", reject);
  });
}

function isBackendAttachmentTitle(value = "") {
  return /(^|[_\-\s])(backend|admin|record|setting|config|permission|menu|report|forecast|summary|activity_setting|game_setting)([_\-\s.]|$)|后台|配置|报表|记录|权限|菜单|游戏设置|活动设置|明细|统计|查询/.test(String(value || ""));
}

function classifyImage(file, url, input = {}) {
  const meta = readPngMeta(file);
  const title = input.title || "";
  if (isBackendAttachmentTitle(title)) {
    return {
      role: "filtered",
      reason: "后台/配置/报表类截图：" + (title || url) + "，按原规则收起，不放入美术参考图主区。",
      width: meta?.width,
      height: meta?.height,
    };
  }
  if (!meta) return { role: "reference", reason: "" };

  const sample = samplePngPixels(file, meta);
  const web5ClientShot = meta.width >= 760 && meta.width <= 980 && meta.height >= 360 && meta.height <= 520 && sample.lightRatio < 0.45;
  const likelyGameOrClient = sample.darkRatio > 0.22 && sample.colorfulRatio > 0.08;
  if (web5ClientShot) {
    return { role: "reference", reason: "", width: meta.width, height: meta.height };
  }
  const wideBackendShot = meta.width >= 760 && meta.height <= 520;
  const veryWide = meta.width / Math.max(meta.height, 1) >= 1.8;
  const hugeWideAdminShot = meta.width >= 1200 && meta.height >= 520 && meta.width / Math.max(meta.height, 1) >= 1.7;
  const likelyTable = sample.lightRatio > 0.72 && sample.darkLeftRatio > 0.08;
  const lowColorAdmin = sample.lightRatio > 0.76 && sample.colorfulRatio < 0.08;

  if (!likelyGameOrClient && ((wideBackendShot && (likelyTable || lowColorAdmin || veryWide)) || (hugeWideAdminShot && sample.darkLeftRatio > 0.04 && sample.colorfulRatio < 0.12))) {
    return {
      role: "filtered",
      reason: "疑似后台表格/配置截图（" + meta.width + "x" + meta.height + "），按原规则收起，不放入美术参考图主区。",
      width: meta.width,
      height: meta.height,
    };
  }

  return { role: "reference", reason: "", width: meta.width, height: meta.height };
}

function readPngMeta(file) {
  try {
    const buffer = fs.readFileSync(file);
    if (buffer.length < 24) return null;
    if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } catch {
    return null;
  }
}

function samplePngPixels(file, meta) {
  try {
    const buffer = fs.readFileSync(file);
    const chunks = [];
    let offset = 8;
    let colorType = 6;
    let bitDepth = 8;

    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (type === "IHDR") {
        bitDepth = buffer[dataStart + 8];
        colorType = buffer[dataStart + 9];
      } else if (type === "IDAT") {
        chunks.push(buffer.subarray(dataStart, dataEnd));
      } else if (type === "IEND") {
        break;
      }
      offset = dataEnd + 4;
    }

    if (bitDepth !== 8 || ![2, 6].includes(colorType) || !chunks.length) {
      return { lightRatio: 0, darkLeftRatio: 0, colorfulRatio: 0 };
    }

    const channels = colorType === 6 ? 4 : 3;
    const stride = meta.width * channels;
    const inflated = zlib.inflateSync(Buffer.concat(chunks));
    let pos = 0;
    let prev = Buffer.alloc(stride);
    let light = 0;
    let dark = 0;
    let darkLeft = 0;
    let colorful = 0;
    let total = 0;

    for (let y = 0; y < meta.height; y += 1) {
      const filter = inflated[pos++];
      const row = Buffer.alloc(stride);
      for (let x = 0; x < stride; x += 1) {
        const raw = inflated[pos++];
        const left = x >= channels ? row[x - channels] : 0;
        const up = prev[x] || 0;
        const upLeft = x >= channels ? prev[x - channels] : 0;
        row[x] = (raw + unfilter(filter, left, up, upLeft)) & 255;
      }

      const yStep = Math.max(1, Math.floor(meta.height / 80));
      if (y % yStep === 0) {
        const xStep = Math.max(1, Math.floor(meta.width / 120));
        for (let x = 0; x < meta.width; x += xStep) {
          const p = x * channels;
          const r = row[p];
          const g = row[p + 1];
          const b = row[p + 2];
          const brightness = (r + g + b) / 3;
          const saturation = Math.max(r, g, b) - Math.min(r, g, b);
          if (brightness > 226) light += 1;
          if (brightness < 80) dark += 1;
          if (x < meta.width * 0.18 && brightness < 70) darkLeft += 1;
          if (saturation > 55) colorful += 1;
          total += 1;
        }
      }
      prev = row;
    }

    return {
      lightRatio: total ? light / total : 0,
      darkRatio: total ? dark / total : 0,
      darkLeftRatio: total ? darkLeft / total : 0,
      colorfulRatio: total ? colorful / total : 0,
    };
  } catch {
    return { lightRatio: 0, darkLeftRatio: 0, colorfulRatio: 0 };
  }
}

function unfilter(filter, left, up, upLeft) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) return paeth(left, up, upLeft);
  return 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function relativeFile(fromFile, targetFile) {
  return path.relative(path.dirname(fromFile), targetFile).replace(/\\/g, "/");
}

function reportAssetSrc(fromFile, targetFile) {
  if (process.env.ART_BRIEF_ASSET_URL === "artifact") {
    return `/api/artifact?path=${encodeURIComponent(path.resolve(targetFile))}`;
  }
  return relativeFile(fromFile, targetFile);
}

function makeReport(task, brief, images, reportFile) {
  const taskUrl = `${zentaoBaseUrl}/index.php?m=task&f=view&taskID=${task.id}`;
  const statusText = `${task.status || "-"} / P${task.pri || "-"}`;
  const deadlineText = task.deadline || "-";
  const storyTitle = task.storyTitle || task.story || "-";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>禅道美术简报 - ${escapeHtml(task.id)}</title>
  <script>
    try {
      document.documentElement.dataset.theme = localStorage.getItem("awp-theme") || "light";
    } catch {}
  </script>
  <style>
    :root,
    :root[data-theme="light"] {
      color-scheme: light;
      --bg: #f7f9fc;
      --bg-a: rgba(226, 233, 243, .62);
      --bg-b: rgba(238, 241, 247, .74);
      --panel: #ffffff;
      --card: #ffffff;
      --line: #e3e8f0;
      --line-strong: #d3dbe7;
      --text: #1e293b;
      --heading: #0f172a;
      --muted: #667085;
      --subtle: #8a94a6;
      --primary: #20324a;
      --primary-soft: rgba(32, 50, 74, .06);
      --soft-card: #f5f7fb;
      --soft-card-strong: #edf1f7;
      --control-bg: #ffffff;
      --shadow: 0 1px 2px rgba(15, 23, 42, .035);
      --lift-shadow: 0 16px 42px rgba(30, 41, 59, .10);
      --ok: #1ea64a;
      --warn: #b45309;
      --danger: #dc2626;
      --radius: 14px;
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --bg: #06050d;
      --bg-a: rgba(155, 92, 255, .26);
      --bg-b: rgba(255, 61, 139, .18);
      --panel: rgba(17, 17, 28, .92);
      --card: rgba(21, 22, 35, .94);
      --line: rgba(226, 232, 255, .12);
      --line-strong: rgba(226, 232, 255, .2);
      --text: #e8e9f3;
      --heading: #ffffff;
      --muted: #aeb5c8;
      --subtle: #7e879f;
      --primary: #ffffff;
      --primary-soft: rgba(255, 255, 255, .1);
      --soft-card: rgba(255, 255, 255, .06);
      --soft-card-strong: rgba(255, 255, 255, .095);
      --control-bg: rgba(255, 255, 255, .065);
      --shadow: 0 1px 0 rgba(255, 255, 255, .035), 0 20px 60px rgba(0, 0, 0, .24);
      --lift-shadow: 0 24px 70px rgba(0, 0, 0, .48), 0 0 42px rgba(155, 92, 255, .18);
      --ok: #31d17f;
      --warn: #f7b84b;
      --danger: #f04444;
      --radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 18% -8%, var(--bg-a), transparent 30%),
        radial-gradient(circle at 88% 0%, var(--bg-b), transparent 28%),
        var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      line-height: 1.58;
    }
    .page { max-width: 1240px; margin: 0 auto; padding: 28px 28px 44px; }
    .header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: end;
      padding: 24px 26px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: linear-gradient(135deg, var(--panel), var(--soft-card));
      box-shadow: var(--lift-shadow);
    }
    h1 { margin: 0 0 14px; color: var(--heading); font-size: 28px; line-height: 1.25; letter-spacing: 0; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 4px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--control-bg);
      color: var(--muted);
      font-size: 13px;
      font-weight: 650;
    }
    .open-task { color: var(--primary); font-weight: 760; }
    a { color: var(--primary); text-decoration: none; }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.22fr) minmax(0, .9fr) minmax(0, .9fr);
      gap: 16px;
      margin-top: 22px;
    }
    .section {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--card);
      padding: 20px;
      box-shadow: var(--shadow);
    }
    .section h2 {
      margin: 0 0 14px;
      font-size: 17px;
      letter-spacing: 0;
      color: var(--heading);
    }
    .section.need h2 { color: var(--ok); }
    .section.avoid h2 { color: var(--danger); }
    .section.confirm h2 { color: var(--warn); }
    ul { margin: 0; padding-left: 0; list-style: none; }
    li {
      position: relative;
      margin: 10px 0;
      padding-left: 18px;
      color: var(--text);
    }
    li::before {
      content: "";
      position: absolute;
      left: 0;
      top: .72em;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--subtle);
    }
    .need li::before { background: var(--ok); }
    .avoid li::before { background: var(--danger); }
    .confirm li::before { background: var(--warn); }
    .refs { margin-top: 18px; }
    .refs h2, .raw h2 { margin: 0 0 14px; color: var(--heading); font-size: 18px; }
    .images {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 16px;
    }
    figure {
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--panel);
      padding: 10px;
      transition: transform .14s ease, box-shadow .14s ease;
    }
    figure:hover {
      transform: translateY(-2px);
      box-shadow: var(--lift-shadow);
    }
    figure img {
      display: block;
      width: 100%;
      height: 250px;
      object-fit: contain;
      border-radius: 6px;
      background: var(--soft-card);
    }
    .image-button {
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: zoom-in;
    }
    .image-button:focus-visible {
      outline: 3px solid rgba(29, 78, 216, .35);
      outline-offset: 3px;
      border-radius: 8px;
    }
    figcaption {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      word-break: break-all;
    }
    .raw {
      margin-top: 16px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    details.raw-details {
      margin-top: 18px;
    }
    details.raw-details > summary {
      cursor: pointer;
      color: var(--muted);
      font-weight: 760;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--card);
      box-shadow: var(--shadow);
    }
    pre {
      margin: 0;
      padding: 14px;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid var(--line);
      background: var(--soft-card);
      color: var(--text);
      border-radius: 8px;
      font-size: 13px;
      max-height: 420px;
      overflow: auto;
    }
    .empty { color: var(--muted); }
    .count {
      color: var(--muted);
      font-size: 13px;
      font-weight: 400;
      margin-left: 6px;
    }
    .lightbox {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 28px;
      background: rgba(15, 23, 42, .78);
    }
    .lightbox.is-open { display: flex; }
    .lightbox-panel {
      position: relative;
      width: min(1280px, 96vw);
      max-height: 92vh;
      display: grid;
      gap: 10px;
    }
    .lightbox img {
      display: block;
      width: 100%;
      max-height: calc(92vh - 54px);
      object-fit: contain;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 24px 80px rgba(0, 0, 0, .34);
    }
    .lightbox-caption {
      color: #e5e7eb;
      font-size: 13px;
      word-break: break-all;
    }
    .lightbox-close {
      position: absolute;
      top: -14px;
      right: -14px;
      width: 36px;
      height: 36px;
      border: 1px solid rgba(255, 255, 255, .36);
      border-radius: 999px;
      background: rgba(15, 23, 42, .9);
      color: #fff;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
    }
    @media (max-width: 900px) {
      .grid, .raw { grid-template-columns: 1fr; }
      .header { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <div>
        <h1>${escapeHtml(task.name || `任务 ${task.id}`)}</h1>
        <div class="meta">
          <span class="pill">任务 #${escapeHtml(task.id)}</span>
          <span class="pill">状态 ${escapeHtml(statusText)}</span>
          <span class="pill">截止 ${escapeHtml(deadlineText)}</span>
          <span class="pill">需求 ${escapeHtml(storyTitle)}</span>
        </div>
      </div>
      <a class="pill open-task" href="${escapeHtml(taskUrl)}" target="_blank" rel="noreferrer">打开禅道任务</a>
    </header>

    <section class="grid">
      ${renderListSection("需要美术做", brief.needs, "need")}
      ${renderListSection("不需要美术做", brief.avoid, "avoid")}
      ${renderListSection("需要确认", brief.confirm, "confirm")}
    </section>

    <section class="section refs">
      <h2>参考图</h2>
      ${renderImages(images, reportFile)}
    </section>

    <details class="raw-details">
      <summary>查看原文与任务描述</summary>
      <section class="raw">
        <div class="section">
          <h2>美术相关原文</h2>
          <pre>${escapeHtml(brief.sourceLines.join("\n") || "未识别到明确美术关键词。")}</pre>
        </div>
        <div class="section">
          <h2>任务描述</h2>
          <pre>${escapeHtml(htmlToText(task.desc) || "无")}</pre>
        </div>
      </section>
    </details>
  </main>
  <div class="lightbox" id="image-lightbox" aria-hidden="true">
    <div class="lightbox-panel" role="dialog" aria-modal="true" aria-label="参考图预览">
      <button class="lightbox-close" type="button" aria-label="关闭预览">&times;</button>
      <img alt="">
      <div class="lightbox-caption"></div>
    </div>
  </div>
  <script>
    (() => {
      const lightbox = document.getElementById("image-lightbox");
      const image = lightbox.querySelector("img");
      const caption = lightbox.querySelector(".lightbox-caption");
      const close = lightbox.querySelector(".lightbox-close");

      function openPreview(button) {
        image.src = button.dataset.fullSrc || button.querySelector("img")?.src || "";
        image.alt = button.dataset.alt || "";
        caption.textContent = button.dataset.caption || "";
        lightbox.classList.add("is-open");
        lightbox.setAttribute("aria-hidden", "false");
        close.focus();
      }

      function closePreview() {
        lightbox.classList.remove("is-open");
        lightbox.setAttribute("aria-hidden", "true");
        image.removeAttribute("src");
      }

      document.querySelectorAll("[data-lightbox-src]").forEach((button) => {
        button.addEventListener("click", () => openPreview(button));
      });
      close.addEventListener("click", closePreview);
      lightbox.addEventListener("click", (event) => {
        if (event.target === lightbox) closePreview();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && lightbox.classList.contains("is-open")) closePreview();
      });
    })();
  </script>
</body>
</html>`;
}

function renderListSection(title, items, className) {
  const body = items.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<div class="empty">暂无</div>`;
  return `<div class="section ${className}"><h2>${escapeHtml(title)}<span class="count">${items.length}</span></h2>${body}</div>`;
}

function renderImages(images, reportFile) {
  if (!images.length) return `<div class="empty">未发现图片附件。</div>`;
  const referenceImages = images.filter((image) => image.role !== "filtered");
  const filteredImages = images.filter((image) => image.role === "filtered");

  const refs = referenceImages.length
    ? `<div class="images">${referenceImages
    .map((image, index) => {
      if (!image.ok) {
        return `<figure><figcaption>参考图 ${index + 1} 下载失败：${escapeHtml(image.error || image.url)}</figcaption></figure>`;
      }
      const src = reportAssetSrc(reportFile, image.file);
      const alt = `参考图 ${index + 1}`;
      return `<figure><button class="image-button" type="button" data-lightbox-src data-full-src="${escapeHtml(src)}" data-alt="${escapeHtml(alt)}" data-caption="${escapeHtml(image.url)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></button><figcaption>${escapeHtml(image.url)}</figcaption></figure>`;
    })
    .join("")}</div>`
    : `<div class="empty">未识别到适合美术参考的图片。</div>`;

  const filtered = filteredImages.length
    ? `<details style="margin-top:14px;"><summary>已过滤后台/表格类截图 ${filteredImages.length} 张</summary><div class="images" style="margin-top:12px;">${filteredImages.map((image, index) => {
        if (!image.ok || !image.file) {
          return `<figure><figcaption>过滤图 ${index + 1} 下载失败：${escapeHtml(image.error || image.url)}</figcaption></figure>`;
        }
        const src = reportAssetSrc(reportFile, image.file);
        const alt = `过滤图 ${index + 1}`;
        return `<figure><button class="image-button" type="button" data-lightbox-src data-full-src="${escapeHtml(src)}" data-alt="${escapeHtml(alt)}" data-caption="${escapeHtml(image.reason || "")}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></button><figcaption>${escapeHtml(image.reason || "")}<br><a href="${escapeHtml(src)}" target="_blank">打开原图</a></figcaption></figure>`;
      }).join("")}</div></details>`
    : "";

  return refs + filtered;
}

function openFile(file) {
  if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "start", "", file], { windowsHide: true });
  } else if (process.platform === "darwin") {
    spawnSync("open", [file]);
  } else {
    spawnSync("xdg-open", [file]);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const taskId = extractTaskId(options.task);
  if (!taskId) {
    printHelp();
    throw new Error("Please provide a ZenTao task id or task URL.");
  }

  const task = options.taskJson ? readTaskFromJson(options.taskJson) : readTask(taskId);
  const outDir = path.resolve(options.outDir, String(task.id));
  const imageDir = path.join(outDir, "assets");
  fs.mkdirSync(outDir, { recursive: true });

  const lines = collectSourceLines(task);
  const brief = inferArtItems(task, lines);
  const imageUrls = extractImageUrls(task);
  const images = options.download ? await downloadImages(imageUrls, imageDir) : imageUrls.map((url) => ({ url, ok: false, error: "download skipped" }));
  const reportFile = path.join(outDir, "index.html");
  const report = makeReport(task, brief, images, reportFile);
  fs.writeFileSync(reportFile, `${report}${os.EOL}`, "utf8");

  const summary = {
    taskId: task.id,
    name: task.name,
    reportFile,
    needs: brief.needs,
    avoid: brief.avoid,
    confirm: brief.confirm,
    images,
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`美术简报已生成：${reportFile}`);
    console.log("");
    console.log("需要美术做：");
    for (const item of brief.needs) console.log(`- ${item}`);
    if (!brief.needs.length) console.log("- 暂无");
    console.log("");
    console.log("不需要美术做：");
    for (const item of brief.avoid) console.log(`- ${item}`);
    if (!brief.avoid.length) console.log("- 暂无");
  }

  if (options.open) openFile(reportFile);
}

main().catch((error) => {
  console.error(`zentao-art-brief failed: ${error.message}`);
  process.exit(1);
});
