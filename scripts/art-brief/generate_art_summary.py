#!/usr/bin/env python3
"""半自动生成禅道美术需求摘要 HTML 和 AI 工作说明。"""

from __future__ import annotations

import argparse
import base64
import html
import json
import mimetypes
import re
import shutil
import ssl
import subprocess
import sys
import textwrap
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from json import JSONDecodeError
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = ROOT / "outputs"
BASE_URL = "https://cd.baa360.cc:20088"
NODE_BIN = Path("/Users/se7en/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
NODE_PACKAGE_CWD = Path("/Users/se7en/.cache/codex-runtimes/codex-primary-runtime/dependencies/node")
CHROME_BIN = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


class ContentExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.links: list[dict[str, str]] = []
        self.images: list[dict[str, str]] = []
        self._link_stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = {k: v or "" for k, v in attrs}
        if tag in {"p", "div", "li", "tr", "h1", "h2", "h3", "br"}:
            self.parts.append("\n")
        if tag == "a":
            href = html.unescape(attrs_map.get("href", ""))
            self._link_stack.append(href)
            if href:
                self.links.append({"text": "", "url": href})
        if tag == "img":
            src = html.unescape(attrs_map.get("src", ""))
            if src:
                alt = html.unescape(attrs_map.get("alt", ""))
                context = normalize_text(" ".join(self.parts[-80:]))
                self.images.append({"url": src, "alt": alt, "context": context[-600:]})

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._link_stack:
            self._link_stack.pop()
        if tag in {"p", "div", "li", "tr", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        text = html.unescape(data).strip()
        if not text:
            return
        self.parts.append(text)
        if self._link_stack and self.links:
            self.links[-1]["text"] = (self.links[-1].get("text", "") + text).strip()


@dataclass
class Asset:
    key: str
    title: str
    url: str
    filename: str
    include: bool
    reason: str


@dataclass
class SummaryModel:
    task_id: str
    title: str
    badge: str
    hero_title: str
    lead: str
    deadline: str
    suite: str
    scope: str
    work_type: str
    work_method: str
    points: list[str]
    rules: list[tuple[str, str, str]]
    context_rules: list[str]
    out_of_scope: list[tuple[str, str]]
    confirmations: list[str]
    primary_asset: Asset | None
    assets: list[Asset]
    output_dir: Path
    task: dict[str, Any]
    source_text: str


def normalize_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def html_to_text(value: Any) -> tuple[str, list[dict[str, str]], list[dict[str, str]]]:
    parser = ContentExtractor()
    parser.feed(str(value or ""))
    text = "".join(parser.parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip(), dedupe_links(parser.links), dedupe_images(parser.images)


def dedupe_links(links: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    result: list[dict[str, str]] = []
    for link in links:
        url = link.get("url", "")
        if not url or url in seen:
            continue
        seen.add(url)
        result.append({"text": normalize_text(link.get("text")) or url, "url": url})
    return result


def dedupe_images(images: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    result: list[dict[str, str]] = []
    for image in images:
        url = image.get("url", "")
        if not url or url in seen:
            continue
        seen.add(url)
        result.append(
            {
                "url": url,
                "alt": normalize_text(image.get("alt")),
                "context": normalize_text(image.get("context")),
            }
        )
    return result


def extract_task_id(value: str) -> str:
    match = re.search(r"(?:taskID=|^)(\d+)", value)
    if not match:
        raise ValueError(f"无法识别任务 ID：{value}")
    return match.group(1)


def run_zentao_task(task_id: str) -> dict[str, Any]:
    proc = subprocess.run(
        ["zentao", "task", "get", "--id", task_id, "--json"],
        cwd=str(ROOT),
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "zentao task get failed").strip())
    try:
        return json.loads(proc.stdout)
    except JSONDecodeError as exc:
        repaired = repair_truncated_task_json(proc.stdout)
        if repaired is not None:
            repaired["_warning"] = "禅道 CLI 返回内容在 actions 操作记录处被截断，已保留任务主体。"
            return repaired
        raise RuntimeError(f"禅道返回内容不是合法 JSON：{exc}") from exc


def repair_truncated_task_json(raw: str) -> dict[str, Any] | None:
    markers = [
        '\n    "actions": [',
        '\n    "storyVerify":',
    ]
    idx = -1
    for marker in markers:
        idx = raw.find(marker)
        if idx >= 0:
            break
    if idx < 0:
        return None
    prefix = raw[:idx].rstrip()
    if prefix.endswith(","):
        prefix = prefix[:-1].rstrip()
    try:
        return json.loads(prefix + "\n  }\n}\n")
    except JSONDecodeError:
        return None


def get_result(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("禅道返回结构中未找到 result 对象")
    return result


def slug_for_task(task: dict[str, Any], text: str) -> str:
    haystack = normalize_text(task.get("name")) + " " + normalize_text(task.get("storyTitle")) + " " + text
    profile = detect_profile(task, text)
    profile_slugs = {
        "game_icon_square": "game_icon_square",
        "wallet_my_account": "wallet_my_account",
        "floating_entry": "floating_entry",
        "vip_restructure": "vip_restructure",
        "refer_friend_page": "refer_friend_page",
        "login_binding_update": "login_binding_update",
        "vip_points": "vip_points",
        "lucky_wheel_claim": "lucky_wheel_claim",
        "member_task": "member_task",
        "signin": "signin",
        "xima": "xima",
        "pwa": "pwa",
        "channel_register": "channel_register",
        "bonus_cashout": "bonus_cashout",
        "worldcup": "worldcup",
    }
    if profile in profile_slugs:
        return profile_slugs[profile]
    mapping = [
        ("PWA", "pwa"),
        ("签到", "signin"),
        ("Daily Bonus", "signin"),
        ("洗码", "xima"),
        ("侧边栏", "sidebar"),
        ("世界杯", "worldcup"),
        ("召回", "recall"),
        ("猜你喜欢", "recommend"),
        ("大厅分类", "lobby"),
    ]
    for key, slug in mapping:
        if key.lower() in haystack.lower():
            return slug
    return "summary"


def infer_suite(task: dict[str, Any], text: str) -> str:
    haystack = " ".join(
        [
            normalize_text(task.get("name")),
            normalize_text(task.get("storyTitle")),
            normalize_text(task.get("executionName")),
            text,
            " ".join(normalize_text(c.get("name")) for c in task.get("children") or [] if isinstance(c, dict)),
        ]
    )
    if re.search(r"\bSG\b|SG版本", haystack, re.I):
        return "SG"
    if re.search(r"WEB5|Web5|web5", haystack):
        return "Web5"
    cocos = re.search(r"COCOS[\d&、 -]+|cocos[\d&、 -]+", haystack)
    if cocos:
        return normalize_text(cocos.group(0)).upper()
    if "PWA" in haystack:
        return "Web"
    return "-"


def build_assets(task: dict[str, Any], links: list[dict[str, str]], images: list[dict[str, str]], text: str) -> list[Asset]:
    assets: list[Asset] = []
    story_files = task.get("storyFiles") or {}
    for fid, meta in story_files.items():
        if not isinstance(meta, dict):
            continue
        ext = str(meta.get("extension") or "").lower()
        if ext not in {"png", "jpg", "jpeg", "webp"}:
            continue
        title = normalize_text(meta.get("title")) or f"附件图 {fid}"
        url = absolute_url(str(meta.get("webPath") or ""))
        include = should_include_asset(title, text)
        filename = safe_asset_name(title, fid, ext)
        assets.append(Asset(str(fid), title, url, filename, include, "storyFiles"))

    for i, image in enumerate(images, 1):
        url = image.get("url", "")
        alt = normalize_text(image.get("alt"))
        context = normalize_text(image.get("context"))
        abs_url = absolute_url(url)
        title = alt or f"正文图片 {i}"
        include = should_include_asset(title, context)
        assets.append(Asset(f"img{i}", title, abs_url, f"inline_{i}.png", include, f"inline image: {context[:120]}"))

    for i, link in enumerate(links, 1):
        url = link.get("url", "")
        title = normalize_text(link.get("text")) or f"链接图片 {i}"
        if not looks_like_image_link(url):
            continue
        include = should_include_asset(title, text)
        assets.append(Asset(f"link{i}", title, absolute_url(url), safe_asset_name(title, str(i), "png"), include, "link"))

    # 保留顺序并去重。
    seen: set[str] = set()
    unique: list[Asset] = []
    for asset in assets:
        if asset.url in seen:
            continue
        seen.add(asset.url)
        unique.append(asset)
    return unique


def absolute_url(url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("/"):
        return BASE_URL + url
    return BASE_URL + "/" + url


def looks_like_image_link(url: str) -> bool:
    return bool(re.search(r"(t=(png|jpg|jpeg|webp)|\\.(png|jpg|jpeg|webp)(\\?|$)|/data/upload/)", url, re.I))


def should_include_asset(title: str, text: str) -> bool:
    title_only = normalize_text(title)
    title_text = normalize_text(title + " " + text[:2000])
    if re.search(
        r"backend|后台|帐服|账服|配置页|配置区|运营管理|配置管理|玩家详情|玩家列表|"
        r"表单|数据表|权限|记录|报表|筛选|发奖按钮",
        title_only,
        re.I,
    ):
        return False
    if re.search(
        r"client|客户端|移动端|前端|web5|cocos|Mine|Account Setting|Mobile Number|My Email|"
        r"验证方式|密码验证|验证码验证|人脸验证|修改成功|face|success",
        title_only,
        re.I,
    ):
        return True
    backend_terms = re.search(
        r"backend|后台|帐服|账服|配置页|配置区|展示内容配置|头像下拉展示内容配置|侧边栏展示内容配置|"
        r"表单|数据表|权限|选择渠道|输入代理|多选组件|渠道多选|拖拽排序|保存后|"
        r"球队配置|发奖按钮|记录|VIP升级积分设置|升级积分设置|VIP等级|任务设置|"
        r"vip_points_modal|vip_level_popup|vip_task_reward",
        title_text,
        re.I,
    )
    if backend_terms:
        return False
    frontend_title = re.search(
        r"client|客户端|移动端|前端|web5|cocos|My Bonus|Task Details|Maximum cashout|Expiration Time|Daily Missions|弹窗|单游戏入口|游戏入口|奖励弹窗",
        title_only,
        re.I,
    )
    strong_frontend = re.search(
        r"客户端|移动端|前端|web5|cocos|My Bonus|Task Details|Maximum cashout|Expiration Time|弹窗|单游戏入口|游戏入口|奖励弹窗|client",
        title_text,
        re.I,
    )
    return bool(strong_frontend or re.search(r"页面|月份|展示|预览|参考|原型|确认|PWA|下载", title_text, re.I))


def safe_asset_name(title: str, fallback: str, ext: str) -> str:
    lower = title.lower()
    if re.search(r"客户端|移动端|前端|client|web5|cocos", title, re.I):
        base = "client_view"
    elif re.search(r"弹窗|单游戏|游戏入口|modal", title, re.I):
        base = "client_modal"
    elif re.search(r"后台|帐服|账服|配置|表单|记录", title):
        base = "backend_preview"
    else:
        base = "reference"
    return f"{base}_{fallback}.{ext if ext != 'jpeg' else 'jpg'}"


def detect_profile(task: dict[str, Any], text: str) -> str:
    haystack = normalize_text(task.get("name")) + " " + normalize_text(task.get("storyTitle")) + " " + text
    if re.search(r"游戏入口图.*方形|游戏图标比例|方形比例|正方形游戏图|冷热排行", haystack, re.I):
        return "game_icon_square"
    if re.search(r"双钱包个人中心|MyAccount下移|My Account下移|my account拿下来|金币两行居中|钱包金币", haystack, re.I):
        return "wallet_my_account"
    if re.search(r"悬浮入口功能整合|侧边栏.*头像下拉框.*悬浮入口|补充缺失入口默认图标", haystack, re.I):
        return "floating_entry"
    if re.search(r"VIP页面重构|VIP 页面重构|7 个 VIP 等级|7个 VIP 等级|7个VIP等级|青铜.*白银.*黄金|Bronze.*Silver.*Gold", haystack, re.I):
        return "vip_restructure"
    if re.search(r"推荐好友页面优化|Refer Gift|Referral Leaderboard|Monthly Leaderboard", haystack, re.I):
        return "refer_friend_page"
    if re.search(r"登录绑定信息支持修改|Mobile Number|My Email|Account Setting|修改手机号|修改邮箱|CPF 人脸验证", haystack, re.I):
        return "login_binding_update"
    if re.search(r"My Bonus|Maximum cashout|Expiration Time|奖金可下注|最高最低上限", haystack, re.I):
        return "bonus_cashout"
    if re.search(r"VIP升级按积分|VIP 升级按积分|奖励积分|VIP points|Points XX|Points\s*\d+", haystack, re.I):
        return "vip_points"
    if re.search(r"一键领取弹窗.*幸运转盘|幸运转盘次数|LUCKY WHEEL|SPIN NOW|Spins Ready", haystack, re.I):
        return "lucky_wheel_claim"
    if "会员任务" in haystack or "Daily Missions" in haystack:
        return "member_task"
    if "签到" in haystack or "Daily Bonus" in haystack:
        return "signin"
    if re.search(r"周洗码活动|Weekly Rebate|WEEKLY REBATE|weekly_rebate", haystack, re.I):
        return "weekly_rebate"
    if "洗码" in haystack:
        return "xima"
    if "渠道注册赠送" in haystack:
        return "channel_register"
    if "世界杯" in haystack or "球队总进球" in haystack:
        return "worldcup"
    if "PWA" in haystack:
        return "pwa"
    return "generic"


def art_points(profile: str, text: str) -> list[str]:
    if profile == "game_icon_square":
        return [
            "视频下方游戏入口图需要支持方形展示效果，美术重点以 PC 端展示为主。",
            "冷热排行榜中的游戏图需要适配正方形比例，保持游戏封面、名称和排行信息可读。",
        ]
    if profile == "vip_restructure":
        return [
            "输出 7 个 VIP 等级的金属质感视觉方案：青铜、白银、黄金、白金、钻石、钛合金、陨星。",
            "VIP 页面按 7 个固定等级重构视觉，等级越高视觉层级越强，需清楚区分材质、色彩和等级压迫感。",
            "VIP 页面头图、当前等级卡片、等级切换区、升级进度区、权益卡片和等级标识需跟随当前等级主题展示。",
            "侧边栏 VIP 模块需同步展示对应等级名称、等级图标和主色调。",
            "个人中心 VIP 模块需同步展示对应等级名称、等级图标和主色调。",
            "输出 VIP 页面关键视觉资源、等级图标/徽章，以及 PC/移动端适配所需资源，并预留多语言文案和权益数字展示空间。",
        ]
    if profile == "refer_friend_page":
        return [
            "基于原有 Refer Gift / 推荐好友页面优化顶部活动介绍区：该区位于邀请链接上方，展示活动标签、标题、副标题、奖池总额文案与辅助标签，并支持英语、德语、西班牙语。",
            "基于原有页面优化邀请统计区：下方 Friends Invited / Qualified 区块改为带表头的层级表格，固定展示 LV0 对 LV1、LV1 对 LV2 等对应关系。",
            "基于原有页面补充 Monthly Leaderboard 月榜区：展示前 5 名奖励档位与排行榜列表，榜单仅展示前 5 名次及命中奖励范围内的并列玩家。",
        ]
    if profile == "wallet_my_account":
        return [
            "Web5 个人中心页面中，将 `My Account` 从钱包金币信息框中拿出来，下移到 `My Bonus` 上方。",
            "`My Account` 与 `My Bonus` 作为同一组菜单入口展示，二者需要在列表区域内层级、间距和选中态保持一致。",
            "钱包金币信息框只保留余额/奖金等金币信息，不再把 `My Account` 混在同一个框内展示。",
            "金币信息改为两行居中展示，数值、币种图标和标签需在窄屏下保持可读、不溢出。",
            "保留个人头像、昵称、ID、Withdraw / Deposit 按钮和下方其它菜单入口的既有结构。",
            "基于参考原型做局部布局调整，不重做个人中心整体视觉风格。",
        ]
    if profile == "floating_entry":
        return [
            "补充本期新增悬浮入口缺失的默认图标，至少覆盖侧边栏和头像下拉框两个展示位置。",
            "新增入口图标需适配 Web5 当前侧边栏样式，保证小尺寸下识别度、留白和点击区域清楚。",
            "新增入口图标需适配 Web5 当前头像下拉框样式，与菜单文字、间距和列表层级保持一致。",
            "Web5 多版样式下的侧边栏和头像下拉框入口图标都需要完成设计适配。",
            "入口标题优先沿用原功能已有多语言标题；图标与文案并排时需预留多语言长度空间。",
            "原大厅悬浮入口保留，本期只补充侧边栏和头像下拉框的展示资源，不重做入口跳转和活动规则。",
        ]
    if profile == "login_binding_update":
        return [
            "Account Setting 入口状态：Mobile Number / My Email 按绑定状态展示 Bind 或 Change，入口位置和原页面层级保持一致。",
            "验证方式选择弹窗：点击 Change 后进入居中弹窗，展示可用验证方式，选项层级、关闭/返回操作和移动端间距要清楚。",
            "登录密码验证弹窗：输入当前登录密码完成验证，需处理输入框、错误提示、按钮禁用/可点击状态和多语言长度。",
            "验证码验证弹窗：新手机号或新邮箱按脱敏规则展示，验证码输入、倒计时、重发按钮和确认按钮不能溢出。",
            "CPF 人脸验证弹窗：复用现有 CPF 人脸识别流程，重点核对入口、拉起状态、验证通过后的流程衔接。",
            "修改成功状态：手机号/邮箱修改成功后展示成功反馈，并回到已绑定状态，成功图标、文案和 Done 按钮层级清楚。",
        ]
    if profile == "lucky_wheel_claim":
        return [
            "一键领取弹窗在领取前新增 Lucky Wheel / 幸运转盘模块，展示在未领取奖励列表中。",
            "Lucky Wheel 模块需要包含转盘图标、幸运转盘标题、剩余旋转次数文案和 `SPIN NOW` 点击按钮。",
            "`SPIN NOW` 点击后不关闭一键领取弹窗，而是在当前流程中弹出幸运转盘弹窗。",
            "当玩家无幸运转盘剩余次数时，不展示 Lucky Wheel 模块，也不保留空占位。",
            "一键领取结果弹窗中，当无领取失败项目时，不展示 `Failed Total` 失败栏。",
            "多语言需要重点检查 `LUCKY WHEEL`、`{x} Spins Ready!`、`SPIN NOW` 在 Web5 与 Cocos 端的按钮宽度和换行表现。",
        ]
    if profile == "vip_points":
        return [
            "客户端 VIP 页面升级条件文案调整为 `VIP points 当前值/目标值`，替代原充值或打码升级口径。",
            "客户端 Daily Missions / 会员任务活动页面在每项奖励右侧新增积分图标和 `Points XX` 展示。",
            "`Points XX` 需要与 GC、Free SC、Free Spins 等原有奖励项处在同一奖励区域内，保持间距、层级和横向阅读顺序清楚。",
            "任务奖励积分为空、未配置或为 0 时，不展示积分图标和 `Points XX`，也不保留空占位。",
            "奖励内容较长时按现有奖励区域换行或横向排列规则处理，不能遮挡任务按钮、进度条和其它奖励内容。",
            "本单美术重点是确认积分图标样式、尺寸、颜色、与奖励文字的对齐关系；不调整页面整体视觉结构。",
        ]
    if profile == "member_task":
        return [
            "旋转类任务条件区分 SC / GC 次数，客户端任务文案需要同时表达对应币种要求。",
            "SC 或 GC 其中一项配置为 0 时，客户端只展示非 0 币种的任务要求和进度。",
            "SC、GC 两项都需要次数时，展示上下两条进度条，分别展示对应币种进度。",
            "可见任务卡片右上角展示说明入口，样式为感叹号图标，点击后展示任务说明文本。",
            "进度数值展示在对应进度条右上方，需保证数值、币种和进度条一一对应。",
            "未开始且被遮罩/掩盖的任务不提供说明入口，避免误导用户可点击。",
        ]
    if profile == "signin":
        return [
            "取消 7 天视图，客户端只保留当前月份视图。",
            "玩家只能签到当前日期，当天签到按钮和状态需要清楚。",
            "当前日期之前未签到日期可补签，需要补签状态和奖励提示。",
            "当前日期之后只展示，不可签到、不可补签。",
            "跨月后只展示新月份，不能查看或补签上一个月份内容。",
            "星星资源展示：补签消耗资源命名为星星，并展示余额/说明。",
        ]
    if profile == "xima":
        return [
            "仅金币档位：只展示金币奖励，不展示免费旋转占位。",
            "仅免费旋转档位：只展示免费旋转奖励，不展示金币占位。",
            "金币 + 免费旋转档位：两类奖励同时展示，层级清楚。",
            "不满足门槛：只隐藏 Wagering Requirement，奖励区和说明内容保留。",
            "领取或自动派发后：需要清晰的已领取/已发放状态。",
        ]
    if profile == "weekly_rebate":
        return [
            "客户端新增 WEEKLY REBATE 活动入口，点击后进入周洗码活动内嵌活动页，入口和活动页风格需与 Web5 活动体系一致。",
            "活动页顶部按周一至周日及“更多”展示活动卡片，支持左右滑动，卡片切换时下方今日任务、游戏和活动说明同步切换。",
            "未开放日期、关闭日期、周日后的更多页展示“敬请期待”状态：保留卡片标题和主视觉，不展示今日任务、游戏列表和活动说明。",
            "今日任务区需要清楚展示任务标题、奖励类型、Claim/Go 按钮、倒计时和任务状态；免费旋转单款游戏奖励需展示游戏入口图和奖励次数。",
            "任务适用游戏与免费旋转适用游戏分区展示，默认展示 3 条，View More / Load More 和游戏列表弹窗层级需清楚。",
            "奖励历史、旋转历史、双钱包奖金任务中新增 Weekly Rebate 奖励类型展示，英文文案统一为 WEEKLY REBATE。",
        ]
    if profile == "pwa":
        return [
            "弹窗整体视觉：遮罩、弹窗容器、圆角、背景、阴影、装饰区。",
            "提示文案区域：默认文案为“是否下载并安装 APP？”，需支持多语言长度变化。",
            "按钮区域：取消 / 确认两个按钮，确认是主操作，取消是次操作。",
            "前端还原标注：间距、字号、色值、按钮高度、圆角、遮罩透明度。",
            "如新增图标或装饰图，补充切图资源、尺寸和导出倍率。",
        ]
    if profile == "channel_register":
        return [
            "web5 渠道注册赠送奖励弹窗：仅配置免费旋转且只配置 1 款游戏时，需要展示单游戏入口。",
            "单游戏入口需要展示游戏图标/封面、游戏名称和可点击进入状态，视觉以美术方案和客户确认稿为准。",
            "保留渠道注册赠送奖励弹窗原有标题、奖励信息、按钮和整体风格，只补充单游戏入口展示。",
            "多游戏免费旋转、混合奖励或非免费旋转场景保持原弹窗逻辑，不新增单游戏入口。",
            "游戏维护、下架、受限或不可进入时，按客户端现有统一提示规则处理，不额外设计新的提示态。",
        ]
    if profile == "bonus_cashout":
        return [
            "Web5 客户端 My Bonus 奖金任务卡片右上区域新增 `Maximum cashout: 金额`，展示该奖金任务最高可领取金额。",
            "`Maximum cashout` 金额由系统返回，客户端只展示，不自行计算最高上限、保底金额或最终可领取金额。",
            "当最高上限比例为 `0` 时表示关闭上限，客户端不展示 `Maximum cashout: 0`，避免误解为最高可领取金额为 0。",
            "奖金任务列表卡片 `Created Time` 时间补充到秒，格式统一为 `YYYY-MM-DD HH:mm:ss`。",
            "Task Details 详情弹窗新增 `Expiration Time`，仅在详情弹窗中展示过期时间，且精确到秒。",
            "已过期任务进入详情后仍展示 `Created Time` 和 `Expiration Time`，便于用户、客服和测试定位任务生命周期。",
        ]
    if profile == "worldcup":
        return [
            "基于现有客户端世界杯活动页新增球队总进球数预测模块，模块位于积分排行榜下方。",
            "主页面需区分预测进行中、预测结束-待开奖、预测结束-已开奖三种状态：时间文案、竞猜按钮、竞猜记录状态和结果展示要有明显差异。",
            "进行中状态下，未参与玩家展示 `Number Prediction` 竞猜按钮；已参与玩家展示已提交状态与竞猜记录。",
            "预测结束-待开奖状态下，竞猜按钮改为待开奖/等待态，不允许继续提交；竞猜记录保留玩家已选球队、进球区间和注数。",
            "预测结束-已开奖状态下，竞猜记录需展示开奖结果、命中/未命中或中奖状态；已开奖面板展示对应球队、进球区间与中奖标识。",
            "下方状态说明图需要作为设计依据，分别检查参与中-待参与、进行中-已参与、待开奖、已结束-已开奖的卡片、按钮、表格和中奖标识表现。",
        ]
    return generic_art_points(text)


def generic_art_points(text: str) -> list[str]:
    keywords = ("客户端", "页面", "弹窗", "展示", "图标", "素材", "视觉", "UI", "样式", "多语言", "文案", "预览", "补签", "奖励")
    lines: list[str] = []
    for raw in text.splitlines():
        line = re.sub(r"^\s*[-*•\d.、）)]+", "", raw).strip()
        if not line or len(line) > 90:
            continue
        if has_backend_text(line):
            continue
        if any(k in line for k in keywords) and line not in lines:
            lines.append(line)
        if len(lines) >= 6:
            break
    return lines or ["根据需求参考图完成客户端界面展示、状态区分和必要标注。"]


def rule_rows(profile: str) -> list[tuple[str, str, str]]:
    if profile == "game_icon_square":
        return [
            ("视频下方入口", "游戏入口图按方形比例展示", "主要检查 PC 端，不能拉伸变形。"),
            ("冷热排行榜", "游戏图按正方形效果展示", "封面、名称、厂商和排行信息不被遮挡。"),
            ("配置切换", "跟随矩形/方形配置展示", "特殊场景不能仍停留旧比例。"),
            ("角标/星标", "随方形图重新定位", "收藏星标、活动角标不压住主体。"),
            ("列表布局", "卡片间距和滚动区域稳定", "切换比例后不出现错位、截断或空白。"),
        ]
    if profile == "vip_restructure":
        return [
            ("7 个固定等级", "VIP1-VIP7 分别对应青铜、白银、黄金、白金、钻石、钛合金、陨星", "等级名称、图标、主色调和材质差异要一眼可区分。"),
            ("VIP 页面", "头图、当前等级卡片、切换区、进度区、权益卡片跟随当前等级主题", "同一等级内视觉体系统一，等级切换后主题一致变化。"),
            ("升级进度", "展示当前累计升级积分 / 下一等级所需累计积分", "只调整视觉表现，不改积分规则。"),
            ("侧边栏 VIP 模块", "展示等级名称、等级图标和主色调", "小尺寸下图标识别度和文案留白要足够。"),
            ("个人中心 VIP 模块", "展示等级名称、等级图标和主色调", "与 VIP 页面主视觉一致，但适配模块尺寸。"),
            ("多语言与数字", "预留文案和权益数字展示空间", "长文案、长数字不能挤压权益内容和领取状态。"),
        ]
    if profile == "refer_friend_page":
        return [
            ("原有页面优化", "基于 Refer Gift / 推荐好友现有界面处理", "延续原页面结构、暗色风格和侧栏关系，不从零重画。"),
            ("活动介绍区", "位于邀请链接上方，展示活动标签、标题、副标题、奖池总额和辅助标签", "信息层级清楚，多语言文案不能挤压邀请链接区。"),
            ("邀请统计表格", "Friends Invited / Qualified 区块改为带表头层级表格", "表头、行列间距、数字对齐和移动端可读性清楚。"),
            ("Monthly Leaderboard", "展示前 5 名奖励档位和榜单结果", "排名、玩家信息、GC/SC 奖励金额和并列名次要易读。"),
            ("并列名次", "第 4 名、第 5 名允许并列展示", "同名次多人并列时金额展示空间要足够，不遮挡下一行。"),
            ("Bonus History", "新增 Referral Leaderboard 类型记录展示", "GC、SC 拆分展示时，类型名称和金额不混淆。"),
        ]
    if profile == "wallet_my_account":
        return [
            ("My Account 入口", "下移到 My Bonus 上方", "与 My Bonus 同组展示，不再属于钱包金币框。"),
            ("钱包金币信息框", "只展示金币/奖金信息", "框内不要混入 My Account 菜单入口。"),
            ("金币信息", "两行居中展示", "数值、图标、标签在移动端不挤压。"),
            ("菜单列表", "保留 Deposit、Withdraw、Records 等入口", "只调整指定位置，不扩大改版范围。"),
            ("原型还原", "按红框标注区域调整", "其它个人中心模块保持现有风格。"),
        ]
    if profile == "floating_entry":
        return [
            ("侧边栏展示", "新增悬浮入口按侧边栏配置展示", "图标尺寸、留白、排序后的连续性和点击区域清楚。"),
            ("头像下拉框展示", "新增悬浮入口按头像下拉框配置展示", "与下拉菜单列表样式统一，不挤压头像区域。"),
            ("未配置/条件不满足", "对应位置不展示入口", "不保留空占位，不出现不可点击假入口。"),
            ("多版样式", "Web5 多版侧边栏和头像下拉框均需适配", "不同皮肤下图标识别度和对比度稳定。"),
            ("多语言标题", "优先使用原功能已有标题", "长文案不挤压图标和菜单间距。"),
        ]
    if profile == "login_binding_update":
        return [
            ("未绑定手机号/邮箱", "对应模块展示 Bind", "入口位置、按钮层级和现有 Account Setting 样式一致。"),
            ("已绑定手机号/邮箱", "对应模块展示 Change", "与 Bind 状态区分清楚，不能误导为新增绑定。"),
            ("验证方式选择", "弹窗展示可用验证方式", "选项、标题、关闭/返回操作清楚，移动端不拥挤。"),
            ("登录密码验证", "输入当前登录密码后进入下一步", "密码输入框、错误提示和按钮状态清楚。"),
            ("验证码验证", "展示脱敏手机号或邮箱并输入验证码", "长邮箱、倒计时、重发按钮和确认按钮不溢出。"),
            ("CPF 人脸验证", "按现有 CPF 人脸流程展示并衔接后续步骤", "拉起、通过、继续验证的状态衔接清楚。"),
            ("修改成功", "展示成功反馈并回到已绑定状态", "成功态文案、图标和按钮层级清楚。"),
        ]
    if profile == "lucky_wheel_claim":
        return [
            ("领取前有转盘次数", "一键领取弹窗展示 Lucky Wheel 模块", "图标、标题、次数、按钮层级清楚。"),
            ("点击 SPIN NOW", "不关闭一键领取弹窗，弹出幸运转盘弹窗", "按钮状态不能误导为 Claim All。"),
            ("无转盘次数", "不展示 Lucky Wheel 模块", "列表布局自然收起，不留空白。"),
            ("领取后弹窗", "Lucky Wheel 模块不展示", "仅展示领取结果相关内容。"),
            ("无失败项目", "不展示 Failed Total 失败栏", "结果弹窗不出现 0 失败占位。"),
            ("多语言", "标题、次数、按钮按端适配", "长文案不挤压图标和按钮。"),
        ]
    if profile == "vip_points":
        return [
            ("VIP 页面", "展示 VIP points 当前值/目标值", "沿用原 VIP 进度区域，不从零重画页面。"),
            ("Daily Missions 有积分", "奖励区追加积分图标和 Points XX", "与 GC、Free SC、Free Spins 的间距和层级统一。"),
            ("积分为 0/空/未配置", "不展示积分图标和 Points XX", "不保留空白占位。"),
            ("奖励内容较长", "按现有奖励区规则换行或横排", "不能挤压按钮、进度条和任务文案。"),
            ("多奖励并存", "原奖励后追加积分奖励", "阅读顺序清楚，避免误认为独立按钮。"),
        ]
    if profile == "member_task":
        return [
            ("仅 SC 有要求", "只展示 SC 任务要求和 SC 进度", "不保留 GC 空占位。"),
            ("仅 GC 有要求", "只展示 GC 任务要求和 GC 进度", "不保留 SC 空占位。"),
            ("SC + GC 均有要求", "展示上下两条进度条", "币种、数值、进度条对应清楚。"),
            ("可见任务卡片", "右上角展示说明入口", "感叹号图标不能遮挡任务内容。"),
            ("未开始遮罩任务", "不展示说明入口", "不要误导为可点击状态。"),
        ]
    if profile == "signin":
        return [
            ("当前日期", "可签到", "按钮层级、当天高亮、可点击状态清楚。"),
            ("过去漏签日期", "可补签", "补签入口、星星消耗、奖励提示需要区分。"),
            ("未来日期", "只展示，不可签到/补签", "禁用态不能误导可点击。"),
            ("跨月", "只展示新月份", "不设计上月回看或补签入口。"),
            ("补签开关关闭", "不展示补签入口和星星消耗", "正常签到和奖励展示仍保留。"),
        ]
    if profile == "xima":
        return [
            ("满足门槛", "正常展示 Wagering Requirement", "沿用正常展示样式。"),
            ("不满足门槛", "只隐藏 Wagering Requirement", "不做整页隐藏，页面不能断层。"),
            ("不满足门槛", "奖励区、活动说明、Ratio of Bet Bonus 保留", "其它模块仍需可读、连续。"),
            ("不满足门槛", "不置灰、不提示 VIP/充值不足", "不要新增错误态、禁用态或弹窗。"),
        ]
    if profile == "weekly_rebate":
        return [
            ("活动入口", "展示 WEEKLY REBATE 并进入内嵌活动页", "入口识别清楚，不做抽屉式交互。"),
            ("当天活动开放", "展示活动卡片、今日任务、任务适用游戏、免费旋转适用游戏和活动说明", "模块层级连续，滑动切换后内容同步。"),
            ("未开放/关闭/更多页", "展示敬请期待主视觉", "隐藏任务、游戏列表和活动说明，不留空白断层。"),
            ("任务奖励", "金币、免费旋转或单款免费旋转游戏奖励按返回内容展示", "奖励类型、次数、按钮状态和游戏入口图对应清楚。"),
            ("奖励类型展示", "奖励历史、旋转历史、双钱包奖金任务展示 WEEKLY REBATE", "类型名称和原有列表样式统一。"),
        ]
    if profile == "pwa":
        return [
            ("PWA 下载被取消/拒绝", "出现 APP 下载确认弹窗", "明确弹窗首屏视觉与遮罩。"),
            ("点击取消", "关闭弹窗", "取消按钮不能误导为主操作。"),
            ("点击确认", "走现有 APK 下载地址", "确认按钮为主操作，层级明显。"),
            ("多语言", "长文案可换行", "按钮与正文不溢出、不遮挡。"),
        ]
    if profile == "channel_register":
        return [
            ("仅免费旋转 + 单游戏", "奖励弹窗展示单游戏入口", "游戏入口层级清楚，可点击状态明确。"),
            ("免费旋转多游戏", "保持原弹窗逻辑", "不误展示单游戏入口。"),
            ("混合奖励/非免费旋转", "保持原奖励弹窗展示", "不额外新增不属于本次的入口。"),
            ("游戏不可进入", "沿用客户端统一提示", "不新增独立提示态。"),
        ]
    if profile == "bonus_cashout":
        return [
            ("My Bonus 列表卡片", "右上区域展示 Maximum cashout: 金额", "与 Created Time、按钮、奖励内容不挤压。"),
            ("上限比例为 0", "不展示 Maximum cashout: 0", "避免用户误解可领取金额为 0。"),
            ("列表 Created Time", "展示到秒", "格式为 YYYY-MM-DD HH:mm:ss。"),
            ("Task Details 弹窗", "新增 Expiration Time", "只在详情弹窗展示，时间到秒。"),
            ("已过期任务", "详情仍展示创建时间和过期时间", "便于定位生命周期。"),
        ]
    if profile == "worldcup":
        return [
            ("预测进行中-待参与", "展示可点击 `Number Prediction` 竞猜按钮", "按钮需要醒目，球队卡片和倒计时可读。"),
            ("预测进行中-已参与", "展示已提交竞猜记录", "提交后状态与未参与状态区分清楚。"),
            ("预测结束-待开奖", "不允许继续竞猜，显示等待开奖状态", "按钮弱化或改等待态，记录仍可查看。"),
            ("预测结束-已开奖", "展示开奖结果与中奖状态", "中奖标识、结果状态和表格行层级明确。"),
        ]
    return [
        ("默认展示", "按需求参考图还原", "层级、间距、状态清楚。"),
        ("异常/不可用状态", "按需求规则隐藏或置灰", "不能误导用户可点击。"),
    ]


def context_rules(profile: str) -> list[str]:
    if profile == "game_icon_square":
        return [
            "本单原需求有研发排查部分，但美术制作单明确只需要看方形游戏图展示效果。",
            "涉及自定义皮肤中的游戏入口图比例配置，目标是让特殊场景同步矩形/方形切换效果。",
            "美术重点是 PC 端视频下方入口和冷热排行榜两类前端展示场景。",
            "配置影响范围和研发同步属于背景；设计稿只呈现客户端/前端展示效果。",
        ]
    if profile == "vip_restructure":
        return [
            "本单影响前台 VIP 页面、侧边栏 VIP 模块、个人中心 VIP 模块及 VIP 等级视觉资源展示。",
            "VIP 等级固化为 7 个：VIP1 青铜、VIP2 白银、VIP3 黄金、VIP4 白金、VIP5 钻石、VIP6 钛合金、VIP7 陨星。",
            "升级进度仍展示当前累计升级积分 / 下一等级所需累计积分，不调整积分、保级、礼金、提现费率等业务规则。",
            "VIP 权益卡片保留现有权益内容和领取状态，仅调整不同等级主题下的视觉表现。",
            "本次未上传本地原型，需要以关联需求 #9110 中 7 个等级金属调性描述作为设计依据。",
        ]
    if profile == "refer_friend_page":
        return [
            "本单美术范围只看客户端 Refer Gift / 推荐好友页面和客户端 Bonus History 展示。",
            "原需求同时包含后台配置、后台记录、冻结、发放和报表联动，这些只作为研发背景，不进入美术成品。",
            "附件中有客户端原型 HTML 和 3 张客户端截图，分别对应活动介绍区、邀请统计区和 Monthly Leaderboard 月榜区；截图右侧说明属于美术判断依据，必须进入摘要。",
            "月榜只展示前 5 个名次及命中奖励范围内的并列玩家；第 6 名及以后不是客户端奖励展示重点。",
        ]
    if profile == "wallet_my_account":
        return [
            "本单是 Web5 双钱包个人中心界面调整，属于已有页面局部布局优化。",
            "产品诉求集中在 My Account 菜单位置和钱包金币信息展示方式，不涉及奖金任务字段。",
            "参考图红框展示目标结构：My Account 位于 My Bonus 上方，并从钱包金币信息框中拆出。",
            "金币两行居中是视觉排版要求，金额来源和钱包逻辑不属于美术处理范围。",
        ]
    if profile == "floating_entry":
        return [
            "本期在保留原大厅悬浮入口的基础上，把这批入口补充到 Web5 侧边栏和头像下拉框展示位置。",
            "侧边栏和头像下拉框为两套独立配置，同一入口可在多个位置同时展示。",
            "客户端展示入口标题时优先使用各活动或原功能已有多语言标题，保持与原入口一致。",
            "活动关闭、未到展示条件或功能关闭时，客户端不展示该入口。",
        ]
    if profile == "login_binding_update":
        return [
            "本单客户端入口位于 Mine - Account Setting - Mobile Number / My Email。",
            "手机号和邮箱修改流程均需要先从绑定状态入口进入，再根据可用方式完成验证。",
            "CPF 人脸验证只作为客户端可选验证方式之一，设计稿只处理用户可见流程和状态衔接。",
            "验证码目标手机号和邮箱需要脱敏展示，属于客户端弹窗内的视觉可读性检查点。",
        ]
    if profile == "lucky_wheel_claim":
        return [
            "需求范围覆盖 Web5 与 Cocos10、12、13、15；美术重点是客户端弹窗展示。",
            "Lucky Wheel 模块只在领取前的一键领取弹窗展示，领取后不展示。",
            "旋转次数展示玩家当前剩余次数，客户端只展示结果，不处理次数计算。",
            "需求还包含领取结果弹窗优化：没有失败项目时，失败栏需要隐藏。",
        ]
    if profile == "vip_points":
        return [
            "美术单明确要求确认 Daily Missions 页面新增积分图标样式，以及 Points XX 与 GC、Free SC、Free Spins 等奖励项的间距和层级。",
            "积分只用于 VIP 升级条件判断，客户端会员任务页只展示可获得积分奖励，不提供积分明细页。",
        ]
    if profile == "member_task":
        return [
            "玩家使用 SC 进入游戏时只累计 SC 旋转次数，使用 GC 进入游戏时只累计 GC 旋转次数。",
            "指定厂商/游戏范围内也分别累计 SC、GC 对应货币的旋转次数。",
            "任务记录中的旋转类任务详情和完成情况需区分 SC 次数、GC 次数。",
            "已生成玩家任务不回刷配置，配置变更后等待下一日新任务生成时生效。",
        ]
    if profile == "signin":
        return [
            "月份只有 30 天时，只读取第 1 天到第 30 天配置。",
            "2 月按实际天数读取，例如 28 天只读取 1-28 天。",
            "补签成功后补发该日奖励，并计入签到天数和里程碑进度。",
            "星星每日 00:00 清空，不跨天保留。",
        ]
    if profile == "xima":
        return [
            "档位新增“赠送金币”，可与免费旋转同时存在。",
            "金币打码倍数只作用于金币，不影响免费旋转。",
            "VIP 与充值门槛都开启时，玩家必须全部满足。",
            "客户端按资格结果展示，不自行计算门槛。",
        ]
    if profile == "weekly_rebate":
        return [
            "本单美术范围只看 Web5 客户端活动入口、内嵌活动页、任务/游戏展示、敬请期待状态和奖励类型记录展示。",
            "原需求同时包含管理端活动设置、记录、权限、报表和服务端规则，这些只作为背景，不进入美术成品。",
            "客户端活动页按内嵌活动页实现，不做抽屉；顶部活动卡片左右滑动，下方内容跟随卡片同步切换。",
            "Weekly Rebate 奖励类型会出现在奖励历史、旋转历史、双钱包奖金任务中，属于客户端可见文案展示，需要进入设计检查。",
        ]
    if profile == "pwa":
        return [
            "Android 下载页点击下载。",
            "Chrome 环境优先触发 PWA 下载。",
            "用户取消/拒绝 PWA 后出现 APP 下载确认弹窗。",
            "确认后走现有 APK 下载地址。",
        ]
    if profile == "channel_register":
        return [
            "美术单明确要求处理 web5 奖励弹窗单游戏入口视觉方案。",
            "参考正文中的单游戏入口现有示意、方案一、方案二，对应附件 fileID=134511、134512、134513。",
            "最终 UI 以美术方案和客户确认稿为准。",
        ]
    if profile == "bonus_cashout":
        return [
            "本单产品诉求集中在 Web5 - My Account - My Bonus 的奖金任务卡片和 Task Details 弹窗。",
            "客户端只展示 Maximum cashout、Created Time、Expiration Time，不自行计算。",
            "新增英文文案为 `Maximum cashout` 与 `Expiration Time`，需要关注多语言长度和卡片空间。",
        ]
    if profile == "worldcup":
        return [
            "附件中的客户端状态总览图是本单美术依据，不能按后台图处理。",
            "模块在客户端世界杯活动页内展示，位置在积分排行榜下方。",
            "状态差异集中在竞猜按钮、倒计时/开奖时间、竞猜记录表格、开奖结果和中奖标识。",
            "玩法支持重复猜球队和区间，支持自定义猜测注数；设计稿只表达用户可见选择和记录，不处理发奖计算。",
        ]
    return ["这些规则用于核对客户端展示状态；设计稿只呈现用户可见界面、状态和资源适配。"]


def out_of_scope(profile: str) -> list[tuple[str, str]]:
    if profile == "game_icon_square":
        return [
            ("不处理", "配置项研发排查和样式开关实现。"),
            ("不新增", "新的游戏入口、新排行榜模块或额外活动角标。"),
            ("不重做", "首页整体布局、底部导航、搜索筛选和游戏排序规则。"),
        ]
    if profile == "vip_restructure":
        return [
            ("不调整", "VIP 升级积分、保级、礼金、提现费率、洗码比例、亏损返还等业务规则。"),
            ("不处理", "历史等级数据处理方案。"),
            ("不展示", "执行人、工时和测试用例。"),
        ]
    if profile == "refer_friend_page":
        return [
            ("不处理", "管理端活动设置页、人数流水页、邀请明细弹窗和相关原型图。"),
            ("不处理", "批量冻结、单人冻结、批量发放、单人发放、奖池平分计算和统计链路。"),
            ("不新增", "推荐好友页面之外的新活动入口、新弹窗或管理端页面设计。"),
        ]
    if profile == "wallet_my_account":
        return [
            ("不调整", "Withdraw / Deposit 流程、钱包余额计算、奖金结算逻辑。"),
            ("不重做", "个人中心整体视觉、头像昵称区域和下方菜单体系。"),
            ("不涉及", "My Bonus 奖金任务卡片字段、Task Details 弹窗或 Maximum cashout。"),
        ]
    if profile == "floating_entry":
        return [
            ("不调整", "原大厅悬浮入口、入口跳转配置、活动开关、时间、资格、领取、红点或跳转规则。"),
            ("不处理", "入口排序、开关、跳转和历史数据兼容逻辑。"),
            ("不新增", "需求清单外的入口图标、额外活动入口或新的展示位置。"),
        ]
    if profile == "login_binding_update":
        return [
            ("不重做", "Mine / Account Setting 页面整体视觉结构。"),
            ("不新增", "需求清单外的安全验证方式、独立活动入口或额外弹窗。"),
            ("不处理", "验证规则、资料状态判断和修改记录沉淀逻辑。"),
        ]
    if profile == "lucky_wheel_claim":
        return [
            ("不处理", "幸运转盘次数计算、发放规则和资格校验。"),
            ("不新增", "一键领取弹窗之外的新入口或独立活动页面。"),
            ("不展示", "测试用例和执行人信息。"),
        ]
    if profile == "vip_points":
        return [
            ("不处理", "充值金额、GC 打码量、SC 打码量的积分换算比例和等级门槛校验。"),
            ("不调整", "Daily Missions 页面整体结构、入口、奖励领取流程、任务生成周期。"),
        ]
    if profile == "member_task":
        return [
            ("不调整", "入口、里程碑、奖励领取、倒计时、任务生成周期。"),
            ("不处理", "SC/GC 旋转次数统计逻辑和已生成任务回刷。"),
        ]
    if profile == "signin":
        return [
            ("不新增", "独立活动入口。"),
            ("不支持", "客户端跨月回看或补签上月日期。"),
            ("不处理", "旧 7 天数据迁移和奖励补发逻辑。"),
        ]
    if profile == "xima":
        return [
            ("不调整", "其它运营活动。"),
            ("不重构", "免费旋转既有发放规则。"),
            ("不新增", "不满足门槛的置灰态或提示弹窗。"),
        ]
    if profile == "weekly_rebate":
        return [
            ("不展示", "管理端活动设置、活动记录、权限、报表、账服表单和运营设置页面。"),
            ("不处理", "打码统计、发奖、自动派发、活动期数、接口和数据入库逻辑。"),
            ("不新增", "需求未要求的独立抽屉、额外提示弹窗或新的管理端预览图。"),
        ]
    if profile == "pwa":
        return [
            ("不重做", "下载页主界面。"),
            ("不新增", "Chrome 打开引导设计。"),
            ("不处理", "iOS、PC、App 内嵌 H5 特殊容器。"),
        ]
    if profile == "channel_register":
        return [
            ("不处理", "历史配置兼容和历史发奖记录。"),
            ("不新增", "多游戏和混合奖励场景之外的额外弹窗。"),
        ]
    if profile == "bonus_cashout":
        return [
            ("不处理", "最高上限倍数、保底开关的计算逻辑和结算规则。"),
            ("不新增", "My Bonus 之外的新入口、新弹窗或新的领取流程。"),
        ]
    if profile == "worldcup":
        return [
            ("不处理", "球队数据配置和发奖计算。"),
            ("不展示", "进球数预测记录后台表单、表单权限和发奖按钮后台截图。"),
        ]
    return [("不处理", "数据迁移、非本需求提到的历史逻辑。")]


def confirmations(profile: str, suite: str) -> list[str]:
    if profile == "game_icon_square":
        return [
            "确认视频下方游戏入口图方形效果是否只需要 PC 端，移动端是否同步出稿。",
            "确认方形图裁切规则：居中裁切、等比缩放留白，还是由素材按方形重新提供。",
            "确认冷热排行榜正方形游戏图是否需要单独标注星标、角标和排行信息的位置。",
        ]
    if profile == "vip_restructure":
        return [
            "确认 7 个等级的金属材质方向是否按青铜、白银、黄金、白金、钻石、钛合金、陨星递进表现。",
            "确认 VIP 页面、侧边栏 VIP 模块、个人中心 VIP 模块是否都需要分别输出 PC 和移动端适配稿。",
            "确认等级图标/徽章是否需要独立切图资源，以及各端导出尺寸和倍率。",
            "确认权益卡片领取状态是否沿用现有交互，只做不同等级主题下的视觉换肤。",
            "确认是否需要产品补充关联需求 #9110 的原型或等级调性参考图。",
        ]
    if profile == "refer_friend_page":
        return [
            "确认 3 张客户端原型图及截图说明是否就是本次美术底图，还是需要按现有 Refer Gift 页面视觉重新细化。",
            "确认活动介绍区、邀请统计表格、Monthly Leaderboard 是否都需要分别输出 PC 和移动端适配稿。",
            "确认 GC、SC 同时展示时的金额长度、币种图标和多语言文案是否需要压力测试稿。",
            "确认 Bonus History 的 Referral Leaderboard 类型记录是否需要补充客户端参考图。",
        ]
    if profile == "wallet_my_account":
        return [
            "确认 My Account 与 My Bonus 是否按参考图作为连续两行菜单入口展示。",
            "确认金币两行居中展示的最长金额、币种图标和标签在小屏下是否需要单独适配稿。",
            "确认本单仅调整 Web5 个人中心，不同步调整其它端或 My Bonus 奖金任务页面。",
        ]
    if profile == "floating_entry":
        return [
            "确认本期入口清单中哪些入口缺默认图标，以及是否已有可复用原悬浮入口图标。",
            "确认侧边栏和头像下拉框是否需要分别输出图标尺寸、间距和导出倍率标注。",
            "确认 Web5 多版样式具体覆盖哪些皮肤版本，是否都需要单独检查对比度和识别度。",
            "确认客户端参考图中的英文标题是否为最终文案，是否需要多语言最长文本适配稿。",
        ]
    if profile == "login_binding_update":
        return [
            "确认是否按附件中的客户端流程图还原，还是需要在现有 Web5 视觉规范上重新细化。",
            "确认 Mobile Number / My Email 的 Bind 与 Change 是否需要分别输出 PC 和移动端状态稿。",
            "确认 CPF 人脸验证流程是否完全复用现有弹窗和 SDK 页面，只补充入口与衔接状态。",
            "确认验证码弹窗中手机号/邮箱脱敏后的最长文本是否需要多语言压力测试稿。",
        ]
    if profile == "lucky_wheel_claim":
        return [
            "确认 Lucky Wheel 图标是否直接按现有美术稿使用，还是需要重新输出切图资源。",
            "确认 Web5 与 Cocos10、12、13、15 是否共用同一版弹窗布局与多语言换行规则。",
            "确认无失败项目时是否完全隐藏 Failed Total 整栏，包括标题、图标和 0 数值。",
        ]
    if profile == "vip_points":
        return [
            "确认积分图标是否直接沿用附件红框中的 P 图标，还是需要美术重新输出图标资源。",
            "确认 `Points XX` 与 GC、Free SC、Free Spins 同排时的最大长度和换行规则。",
            "确认 VIP 页面 `VIP points 当前值/目标值` 是否只做文案替换，不改进度条和等级卡片视觉。",
        ]
    if profile == "member_task":
        return [
            "确认客户端会员任务页是否完全按附件图还原，还是需要重新出设计稿。",
            "确认说明入口点击后的说明文本展示形式：气泡、弹层还是展开区域。",
            "确认 SC/GC 双进度条在移动端窄屏下的高度、间距和数值换行规则。",
        ]
    if profile == "signin":
        return [
            "确认本单是否只做移动端 Daily Bonus 弹窗。",
            "确认客户端 31 天月历在小屏设备上的格子尺寸、文本溢出和奖励气泡展示方式。",
            "确认补签开关关闭时，客户端是否需要完全隐藏星星区域，还是只隐藏补签入口/消耗。",
        ]
    if profile == "xima":
        return [
            f"确认 {suite} 端是否只需要客户端 /newBet 展示调整，以及是否需要补标注/切图。",
            "确认仅金币、仅免费旋转、金币+免费旋转三种状态是否均需出图。",
            "确认不满足门槛时是否完全不新增提示态。",
        ]
    if profile == "weekly_rebate":
        return [
            "确认 Web5 端是否需要分别输出入口、当天活动页、敬请期待页、游戏列表弹窗和奖励类型记录页状态稿。",
            "确认周一至周日卡片、更多页和关闭日期是否共用同一套主视觉资源，还是需要分别出图。",
            "确认 WEEKLY REBATE 多语言文案、游戏入口图、Claim/Go 按钮和奖励状态是否需要补切图标注。",
        ]
    if profile == "pwa":
        return [
            "确认弹窗是否沿用现有下载页风格，不新增主下载页改版。",
            "确认多语言最长文案是否需要单独压力测试稿。",
            "确认新增装饰图或图标是否需要切图。",
        ]
    if profile == "channel_register":
        return [
            "确认最终采用方案一、方案二，还是客户另行确认稿。",
            "确认单游戏入口点击区域、游戏名称长度和维护/下架态是否沿用现有游戏卡规则。",
            "确认是否需要输出单游戏弹窗的切图资源和适配标注。",
        ]
    if profile == "bonus_cashout":
        return [
            "确认 `Maximum cashout` 在卡片右上区域的最终位置是否按原型图执行。",
            "确认 `Maximum cashout` 多语言最长文案在 Web5 卡片内是否需要单独适配稿。",
            "确认 `Expiration Time` 只出详情弹窗展示，列表卡片不展示该字段。",
        ]
    if profile == "worldcup":
        return [
            "确认客户端状态总览图是否就是本次设计底稿，还是需要在现有活动页视觉上重新细化。",
            "确认预测进行中、预测结束-待开奖、预测结束-已开奖是否都需要分别输出完整页面稿。",
            "确认参与中-待参与、进行中-已参与、待开奖、已开奖的小卡片/记录区是否需要单独切图或标注。",
        ]
    return [
        f"确认 {suite} 套系/端是否为本次美术范围。",
        "确认是否按附件参考图还原，还是需要重新出设计稿。",
        "确认是否需要补充标注、切图或多语言适配稿。",
    ]


def build_model(task: dict[str, Any], payload: dict[str, Any], out_dir: Path) -> SummaryModel:
    text_parts: list[str] = []
    links: list[dict[str, str]] = []
    images: list[str] = []
    for key in ["desc", "storySpec", "storyVerify", "testDemo", "selfTest"]:
        text, found_links, found_images = html_to_text(task.get(key))
        if text:
            text_parts.append(text)
        links.extend(found_links)
        images.extend(found_images)
    text = "\n".join(text_parts)
    profile = detect_profile(task, text)
    task_id = str(task.get("id") or "")
    title = normalize_title(task)
    suite = infer_suite(task, text)
    scope = scope_for_profile(profile)
    assets = build_assets(task, links, images, text)
    assets = apply_profile_asset_rules(profile, assets)
    assets = recover_profile_assets(profile, assets, out_dir)
    primary = choose_primary_asset(assets)
    if primary is None:
        primary = find_local_primary_asset(out_dir)
        if primary is not None:
            assets.append(primary)
    raw_context_rules = context_rules(profile)
    raw_out_of_scope = out_of_scope(profile)
    return SummaryModel(
        task_id=task_id,
        title=title,
        badge=f"禅道 #{task_id} · {title} · 美术需求摘要",
        hero_title=hero_title_for_profile(profile, title),
        lead=lead_for_profile(profile, scope),
        deadline=normalize_text(task.get("deadline")) or "-",
        suite=suite,
        scope=scope,
        work_type=work_type_for_profile(profile, text, primary),
        work_method=work_method_for_profile(profile, text, primary),
        points=art_points(profile, text),
        rules=rule_rows(profile),
        context_rules=filter_backend_text(raw_context_rules),
        out_of_scope=filter_backend_pairs(raw_out_of_scope),
        confirmations=confirmations(profile, suite),
        primary_asset=primary,
        assets=assets,
        output_dir=out_dir,
        task=task,
        source_text=text,
    )


def apply_profile_asset_rules(profile: str, assets: list[Asset]) -> list[Asset]:
    if profile == "game_icon_square":
        result: list[Asset] = []
        for asset in assets:
            include = asset.key in {"img1", "img2"} or asset.filename in {"inline_1.png", "inline_2.png"}
            result.append(Asset(asset.key, asset.title, asset.url, asset.filename, include, asset.reason))
        return result
    if profile == "worldcup":
        result: list[Asset] = []
        for asset in assets:
            include = asset.key in {"img1", "img2"} or asset.filename in {"inline_1.png", "inline_2.png"}
            result.append(
                Asset(
                    key=asset.key,
                    title="世界杯客户端预测模块状态图" if asset.key == "img2" else asset.title,
                    url=asset.url,
                    filename=asset.filename,
                    include=include,
                    reason=asset.reason,
                )
            )
        return result
    if profile == "refer_friend_page":
        result: list[Asset] = []
        for asset in assets:
            title = asset.title
            is_client_proto = bool(re.search(r"客户端.*(活动介绍|邀请统计|月榜).*原型", title))
            is_backend = bool(re.search(r"后台|配置|记录|明细", title))
            result.append(
                Asset(
                    key=asset.key,
                    title=asset.title,
                    url=asset.url,
                    filename=asset.filename,
                    include=is_client_proto and not is_backend,
                    reason=asset.reason,
                )
            )
        return result
    if profile == "login_binding_update":
        ordered_names = {
            "prd_client_account_setting_marked.png",
            "prd_client_method_select.png",
            "prd_client_password_verify.png",
            "prd_client_verification_code.png",
            "prd_client_face_sdk.png",
            "prd_client_success.png",
        }
        result: list[Asset] = []
        for asset in assets:
            title = asset.title
            include = title in ordered_names
            result.append(
                Asset(
                    key=asset.key,
                    title=asset.title,
                    url=asset.url,
                    filename=asset.filename,
                    include=include,
                    reason=asset.reason,
                )
            )
        return result
    return assets


def recover_profile_assets(profile: str, assets: list[Asset], out_dir: Path) -> list[Asset]:
    if profile == "xima":
        demo_assets = [
            ("local:xima-demo-eligible", "洗码任务交互 demo：满足门槛展示 Wagering Requirement", "xima_demo_eligible.png"),
            ("local:xima-demo-ineligible", "洗码任务交互 demo：不满足门槛隐藏 Wagering Requirement", "xima_demo_ineligible.png"),
        ]
        recovered = [
            Asset(key, title, "", filename, True, "local rendered frontend interaction demo")
            for key, title, filename in demo_assets
            if local_asset_exists(out_dir, filename)
        ]
        if not recovered:
            return assets
        demo_names = {filename for _, _, filename in demo_assets}
        rest = [asset for asset in assets if asset.filename not in demo_names]
        return recovered + rest
    """制作单取消父任务关联后，禅道可能不再返回原需求附件；从本地归档恢复前端图。"""
    if profile != "refer_friend_page":
        return assets
    required = [
        ("136698", "推荐好友页面优化-客户端活动介绍区原型.png", "client_view_136698.png"),
        ("136699", "推荐好友页面优化-客户端邀请统计表格区原型.png", "client_view_136699.png"),
        ("136700", "推荐好友页面优化-客户端月榜区原型.png", "client_view_136700.png"),
    ]
    by_filename = {asset.filename: asset for asset in assets}
    recovered: list[Asset] = []
    for fid, title, filename in required:
        existing = by_filename.get(filename)
        if existing is not None:
            recovered.append(Asset(existing.key, existing.title or title, existing.url, filename, True, existing.reason))
            continue
        if local_asset_exists(out_dir, filename):
            recovered.append(Asset(f"local:{fid}", title, "", filename, True, "local recovered frontend reference asset"))
    if not recovered:
        return assets
    required_names = {filename for _, _, filename in required}
    rest = [asset for asset in assets if asset.filename not in required_names]
    return recovered + rest


def local_asset_exists(out_dir: Path, filename: str) -> bool:
    return (out_dir / "assets" / filename).exists() or (out_dir / "_archive" / "assets" / filename).exists()


def has_backend_text(value: str) -> bool:
    return bool(
        re.search(
            r"后台|帐服|账服|运营配置|配置页|配置区|表单|数据表|权限|记录|勾选|拖拽排序|保存|"
            r"开关|字段|接口|报表|结算|互斥|服务端|后端|数据迁移|执行人|工时|测试用例",
            value,
        )
    )


def filter_backend_text(items: list[str]) -> list[str]:
    return [item for item in items if not has_backend_text(item)]


def filter_backend_pairs(items: list[tuple[str, str]]) -> list[tuple[str, str]]:
    return [(title, body) for title, body in items if not has_backend_text(f"{title} {body}")]


def normalize_title(task: dict[str, Any]) -> str:
    title = normalize_text(task.get("storyTitle")) or normalize_text(task.get("name")) or f"任务 {task.get('id')}"
    title = re.sub(r"^【需求单】", "", title)
    title = re.sub(r"^【SG版本需求】", "", title)
    title = re.sub(r"^【制作单】", "", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title


def scope_for_profile(profile: str) -> str:
    return {
        "game_icon_square": "Web5 游戏入口图方形比例展示",
        "wallet_my_account": "Web5 个人中心 My Account 与钱包信息布局",
        "floating_entry": "Web5 侧边栏与头像下拉框悬浮入口图标适配",
        "login_binding_update": "Web5 Account Setting 手机号/邮箱绑定信息修改流程",
        "vip_restructure": "VIP 页面、侧边栏 VIP 模块与个人中心 VIP 模块重构",
        "refer_friend_page": "客户端 Refer Gift 推荐好友页面优化",
        "lucky_wheel_claim": "一键领取弹窗幸运转盘模块与领取结果弹窗",
        "vip_points": "客户端 VIP 页面与 Daily Missions 积分展示",
        "member_task": "客户端会员任务页",
        "signin": "客户端月签弹窗",
        "xima": "/newBet 奖励展示",
        "weekly_rebate": "Web5 周洗码活动入口、活动页与奖励类型展示",
        "pwa": "APP 下载确认弹窗",
        "channel_register": "Web5 注册赠送奖励弹窗",
        "worldcup": "客户端世界杯预测模块",
        "bonus_cashout": "Web5 My Bonus 奖金任务卡片与详情弹窗",
        "generic": "客户端展示与状态处理",
    }.get(profile, "客户端展示与状态处理")


def work_type_for_profile(profile: str, text: str, primary: Asset | None) -> str:
    if profile == "vip_restructure":
        return "原功能改版"
    if profile == "refer_friend_page":
        return "原界面优化"
    if re.search(r"全新|新页面|新活动页|新弹窗|新增页面|从零|重新设计|改版", text):
        return "新需求设计"
    if profile in {"game_icon_square", "wallet_my_account", "login_binding_update", "lucky_wheel_claim", "vip_points", "member_task", "xima", "weekly_rebate", "pwa", "channel_register", "bonus_cashout"}:
        return "原界面优化"
    if profile in {"signin"}:
        return "原功能改版"
    if profile in {"worldcup"}:
        return "原页面新增模块"
    if primary:
        return "基于参考图优化"
    return "待确认：新做或原界面优化"


def work_method_for_profile(profile: str, text: str, primary: Asset | None) -> str:
    if profile == "game_icon_square":
        return "基于现有游戏入口和冷热排行榜场景适配方形游戏图比例，不重做页面整体结构。"
    if profile == "wallet_my_account":
        return "基于现有 Web5 个人中心原型局部调整 My Account 位置和钱包金币信息排版，不重做个人中心。"
    if profile == "floating_entry":
        return "基于现有悬浮入口资源补充默认图标，并适配 Web5 侧边栏、头像下拉框和多版样式展示。"
    if profile == "login_binding_update":
        return "基于现有 Web5 Mine - Account Setting 页面和弹窗体系，补充手机号/邮箱已绑定状态下的 Change 入口及修改验证流程状态。"
    if profile == "vip_restructure":
        return "基于现有 VIP 功能重构 7 个固定等级视觉主题，并同步 VIP 页面、侧边栏和个人中心模块资源。"
    if profile == "refer_friend_page":
        return "基于现有 Refer Gift / 推荐好友页面优化活动介绍、邀请统计表格和 Monthly Leaderboard 月榜展示；截图右侧说明同步作为美术处理依据，不处理后台管理界面。"
    if profile == "lucky_wheel_claim":
        return "在现有一键领取弹窗中新增 Lucky Wheel 模块，并调整领取结果弹窗失败栏展示。"
    if profile == "vip_points":
        return "沿用现有 VIP 页面和 Daily Missions 结构，只替换升级口径并追加积分奖励展示。"
    if profile == "member_task":
        return "沿用会员任务页卡片结构，补充 SC/GC 任务要求、双进度条和说明入口状态。"
    if profile == "signin":
        return "基于现有签到功能改成月份视图，补齐签到、补签、未来日期和星星资源状态。"
    if profile == "xima":
        return "基于现有 /newBet 页面调整奖励展示和门槛隐藏规则，不新增独立入口。"
    if profile == "weekly_rebate":
        return "基于 Web5 现有活动入口和活动页体系新增周洗码活动展示，补齐入口、活动页、关键状态和奖励类型展示；管理端内容不进入美术范围。"
    if profile == "pwa":
        return "基于现有下载链路新增 APP 下载确认弹窗，不重做下载页主界面。"
    if profile == "channel_register":
        return "基于现有注册赠送奖励弹窗补充单游戏入口，只处理免费旋转单游戏场景。"
    if profile == "bonus_cashout":
        return "基于现有 My Bonus 卡片和详情弹窗追加字段展示，不改变奖金领取流程。"
    if profile == "worldcup":
        return "基于现有世界杯活动页状态总览图，在积分排行榜下方新增球队总进球数预测模块，并补齐进行中、待开奖、已开奖状态。"
    if re.search(r"全新|新页面|新活动页|新弹窗|新增页面|从零|重新设计|改版", text):
        return "按需求新建设计稿，并补齐入口、默认态、关键状态和必要适配说明。"
    if primary:
        return "优先基于参考图进行新增、调整或隐藏处理，不从零重画页面。"
    return "需先确认是否已有原界面底图；有底图则基于原图优化，无底图再按新需求设计。"


def hero_title_for_profile(profile: str, title: str) -> str:
    if profile == "game_icon_square":
        return "美术重点：<br>游戏入口图方形比例适配"
    if profile == "wallet_my_account":
        return "美术重点：<br>双钱包个人中心布局调整"
    if profile == "floating_entry":
        return "美术重点：<br>悬浮入口图标补齐与侧边栏适配"
    if profile == "login_binding_update":
        return "美术重点：<br>手机号/邮箱绑定信息修改流程"
    if profile == "vip_restructure":
        return "美术重点：<br>SG VIP 七等级金属质感重构"
    if profile == "refer_friend_page":
        return "美术重点：<br>推荐好友原页面优化"
    if profile == "lucky_wheel_claim":
        return "美术重点：<br>一键领取弹窗 Lucky Wheel 展示"
    if profile == "vip_points":
        return "美术重点：<br>VIP points 与 Daily Missions 积分奖励"
    if profile == "member_task":
        return "美术重点：<br>会员任务 SC/GC 进度展示"
    if profile == "signin":
        return "美术重点：<br>Daily Bonus 月签改版"
    if profile == "xima":
        return "美术重点：<br>Web5 洗码奖励展示"
    if profile == "weekly_rebate":
        return "美术重点：<br>Web5 周洗码活动展示"
    if profile == "pwa":
        return "美术重点：<br>APP 下载确认弹窗"
    if profile == "channel_register":
        return "美术重点：<br>Web5 注册赠送单游戏弹窗"
    if profile == "worldcup":
        return "美术重点：<br>世界杯球队进球预测模块"
    if profile == "bonus_cashout":
        return "美术重点：<br>My Bonus 最高可领取金额展示"
    return f"美术重点：<br>{escape_html(title)}"


def lead_for_profile(profile: str, scope: str) -> str:
    if profile == "game_icon_square":
        return "本摘要只提炼美术需要处理的内容：Web5 游戏入口图在视频下方入口和冷热排行榜场景中适配方形/正方形展示效果。"
    if profile == "wallet_my_account":
        return "本摘要只提炼美术需要处理的内容：Web5 个人中心 My Account 下移到 My Bonus 上方，并将钱包金币信息改为两行居中展示。"
    if profile == "floating_entry":
        return "本摘要只提炼美术需要处理的内容：补充本期新增悬浮入口缺失默认图标，并适配 Web5 侧边栏、头像下拉框及多版样式。"
    if profile == "login_binding_update":
        return "本摘要只提炼美术需要处理的内容：Web5 Account Setting 中手机号和邮箱已绑定状态支持修改，并补齐验证方式选择、密码验证、验证码验证、CPF 人脸验证和成功态展示。"
    if profile == "vip_restructure":
        return "本摘要只提炼美术需要处理的内容：SG VIP 页面按 7 个固定等级重构金属质感视觉，并同步侧边栏 VIP 模块、个人中心 VIP 模块、等级图标/徽章和 PC/移动端适配资源。业务规则仅作为理解背景。"
    if profile == "refer_friend_page":
        return "本摘要只提炼美术需要处理的内容：基于原有客户端 Refer Gift / 推荐好友页面优化活动介绍区、邀请统计表格和 Monthly Leaderboard 月榜展示；客户端截图说明属于美术依据，后台配置、记录和发放操作不进入美术范围。"
    if profile == "lucky_wheel_claim":
        return "本摘要只提炼美术需要处理的内容：一键领取弹窗领取前新增 Lucky Wheel 模块，以及领取结果弹窗无失败项目时隐藏 Failed Total。"
    if profile == "vip_points":
        return "本摘要只提炼美术需要处理的内容：客户端 VIP 页面展示 VIP points 进度，以及 Daily Missions 奖励区新增积分图标和 Points XX。"
    if profile == "member_task":
        return "本摘要只提炼美术需要处理的内容：客户端会员任务页的 SC/GC 任务要求、双进度条、说明入口和遮罩任务状态。"
    if profile == "signin":
        return "本摘要只提炼美术需要处理的内容：客户端签到弹窗从 7 天视图改为月份视图，并补充当前月签到、补签、未来日期和星星资源展示规则。"
    if profile == "xima":
        return "本摘要只展示美术需要处理的部分：客户端 /newBet 的金币、免费旋转和门槛隐藏规则。"
    if profile == "weekly_rebate":
        return "本摘要只展示美术需要处理的部分：Web5 客户端 WEEKLY REBATE 入口、周洗码活动页、敬请期待状态、任务/游戏展示和奖励类型展示；管理端内容不进入美术范围。"
    if profile == "pwa":
        return "本摘要只展示美术需要处理的部分：取消 PWA 后的 APP 下载确认弹窗。其他下载链路仅用于理解触发流程。"
    if profile == "channel_register":
        return "本摘要只展示美术需要处理的部分：Web5 渠道注册赠送奖励弹窗在免费旋转单游戏场景下的游戏入口。"
    if profile == "worldcup":
        return "本摘要只展示美术需要处理的部分：客户端世界杯活动页新增球队总进球数预测模块。"
    if profile == "bonus_cashout":
        return "本摘要只展示美术需要处理的部分：Web5 My Bonus 奖金任务卡片的 Maximum cashout、Created Time 到秒，以及 Task Details 的 Expiration Time。"
    return f"本摘要只提炼美术需要处理的内容：{scope}。"


def choose_primary_asset(assets: list[Asset]) -> Asset | None:
    included = [asset for asset in assets if asset.include]
    if not included:
        return None
    for asset in included:
        if asset.filename == "xima_demo_eligible.png":
            return asset
    for asset in included:
        if re.search(r"客户端.*活动介绍", asset.title):
            return asset
    for asset in included:
        if re.search(r"My Account|MyAccount|个人中心|钱包金币|Account Balance|Bonus", asset.title + " " + asset.reason, re.I):
            return asset
    for asset in included:
        if re.search(r"LUCKY WHEEL|SPIN NOW|Spins Ready|一键领取|幸运转盘", asset.title + " " + asset.reason, re.I):
            return asset
    for asset in included:
        if re.search(r"Daily Missions|Points|奖励积分|积分图标", asset.title + " " + asset.reason, re.I):
            return asset
    for asset in included:
        if re.search(r"account_setting|Account Setting|Mobile Number|My Email", asset.title, re.I):
            return asset
    for asset in included:
        if re.search(r"client|客户端|My Bonus|Maximum cashout|Task Details|单游戏入口|奖励弹窗", asset.title, re.I):
            return asset
    for asset in included:
        if re.search(r"客户端|移动端|client|前端|弹窗|月份|展示", asset.title, re.I):
            return asset
    return included[0]


def find_local_primary_asset(out_dir: Path) -> Asset | None:
    assets_dir = out_dir / "assets"
    if not assets_dir.exists():
        return None
    preferred_names = [
        "client_display.png",
        "client_display.jpg",
        "client_view.png",
        "client_view.jpg",
        "frontend_display.png",
        "frontend_view.png",
    ]
    candidates = [assets_dir / name for name in preferred_names if (assets_dir / name).exists()]
    if not candidates:
        candidates = sorted(
            path
            for path in assets_dir.iterdir()
            if path.is_file()
            and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
            and re.search(r"client|frontend|display|view|客户端|前端", path.name, re.I)
        )
    if not candidates:
        return None
    path = candidates[0]
    return Asset(
        key=f"local:{path.name}",
        title=path.name,
        url="",
        filename=path.name,
        include=True,
        reason="local frontend reference asset",
    )


def download_assets(model: SummaryModel, skip_download: bool = False) -> None:
    assets_dir = model.output_dir / "assets"
    archive_assets_dir = model.output_dir / "_archive" / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    archive_assets_dir.mkdir(parents=True, exist_ok=True)
    context = ssl._create_unverified_context()
    for asset in model.assets:
        target_dir = assets_dir if asset.include else archive_assets_dir
        target = target_dir / asset.filename
        archived_source = archive_assets_dir / asset.filename
        if asset.include and archived_source.exists() and not target.exists():
            shutil.move(str(archived_source), str(target))
        restore_asset_from_duplicate_archive(model, asset, target)
        stale_active = assets_dir / asset.filename
        if not asset.include and stale_active.exists():
            archived = archive_assets_dir / asset.filename
            if archived.exists():
                archived = archive_assets_dir / f"{Path(asset.filename).stem}_excluded{Path(asset.filename).suffix}"
            shutil.move(str(stale_active), str(archived))
        if skip_download:
            continue
        if target.exists() and target.stat().st_size > 0:
            continue
        try:
            with urllib.request.urlopen(asset.url, context=context, timeout=30) as response:
                target.write_bytes(response.read())
        except Exception as exc:  # noqa: BLE001
            print(f"下载附件失败：{asset.title} {asset.url}；{exc}", file=sys.stderr)


def restore_asset_from_duplicate_archive(model: SummaryModel, asset: Asset, target: Path) -> None:
    if target.exists() or not asset.include:
        return
    archive_root = model.output_dir.parent / "_archive" / "duplicate_task_dirs"
    if not archive_root.exists():
        return
    for base in sorted(archive_root.glob(f"task_{model.task_id}_*")):
        for rel in (Path("assets") / asset.filename, Path("_archive") / "assets" / asset.filename):
            source = base / rel
            if source.exists() and source.is_file():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                return


def render_html(model: SummaryModel) -> str:
    task = model.task or {}
    task_url_value = task_url(model.task_id)
    status_text = f"{normalize_text(task.get('status')) or '-'} / P{normalize_text(task.get('pri')) or '-'}"
    deadline_text = model.deadline or normalize_text(task.get('deadline')) or '-'
    assigned_to = assignee_text(task) or '-'
    story_title = normalize_text(task.get('storyTitle') or task.get('story') or task.get('storyName')) or '-'
    images_html = render_standard_images(model)
    source_lines = [line.strip() for line in model.source_text.splitlines() if line.strip()]
    task_desc_text, _, _ = html_to_text(task.get('desc'))
    return STANDARD_HTML_TEMPLATE.format(
        title=escape_html(f"禅道美术简报 - {model.task_id}"),
        task_id=escape_html(model.task_id),
        task_title=escape_html(task.get('name') or task.get('title') or model.title or f"任务 {model.task_id}"),
        task_url=escape_attr(task_url_value),
        status_text=escape_html(status_text),
        deadline_text=escape_html(deadline_text),
        assigned_to=escape_html(assigned_to),
        story_title=escape_html(story_title),
        needs=render_standard_list_section('需要美术做', model.points, 'need'),
        avoid=render_standard_list_section('不需要美术做', [f"{title}：{body}" for title, body in model.out_of_scope], 'avoid'),
        confirm=render_standard_list_section('需要确认', model.confirmations, 'confirm'),
        images=images_html,
        source_lines=escape_html('\n'.join(source_lines) or '未识别到明确美术关键词。'),
        task_desc=escape_html(task_desc_text or '无'),
    )


def assignee_text(task: dict[str, Any]) -> str:
    candidates = [
        task.get('assignedToRealName'),
        task.get('assignedToName'),
        task.get('assignedTo'),
    ]
    assigned = task.get('assignedTo')
    if isinstance(assigned, dict):
        candidates = [assigned.get('realname'), assigned.get('name'), assigned.get('account'), *candidates]
    for value in candidates:
        text = normalize_text(value)
        if text:
            return text
    return ''


def render_standard_list_section(title: str, items: list[str], class_name: str) -> str:
    clean_items = [normalize_text(item) for item in items if normalize_text(item)]
    body = '<ul>' + ''.join(f'<li>{escape_html(item)}</li>' for item in clean_items) + '</ul>' if clean_items else '<div class="empty">暂无</div>'
    return f'<div class="section {class_name}"><h2>{escape_html(title)}<span class="count">{len(clean_items)}</span></h2>{body}</div>'


def render_standard_images(model: SummaryModel) -> str:
    assets = [asset for asset in model.assets if asset.include]
    if model.primary_asset:
        assets = [model.primary_asset] + [asset for asset in assets if asset.filename != model.primary_asset.filename]
    if not assets:
        return '<div class="empty">未发现图片附件。</div>'
    figures = []
    for index, asset in enumerate(assets, 1):
        src = asset_src(model, asset)
        alt = f'参考图 {index}'
        caption = asset.url or asset.title or asset.reason or alt
        figures.append(
            f'<figure><button class="image-button" type="button" data-lightbox-src data-full-src="{escape_attr(src)}" data-alt="{escape_attr(alt)}" data-caption="{escape_attr(caption)}"><img src="{src}" alt="{escape_attr(alt)}"></button><figcaption>{escape_html(caption)}</figcaption></figure>'
        )
    return '<div class="images">' + ''.join(figures) + '</div>'


def uses_flow_cards(model: SummaryModel) -> bool:
    return model.scope in {
        "Web5 Account Setting 手机号/邮箱绑定信息修改流程",
        "客户端 Refer Gift 推荐好友页面优化",
        "Web5 周洗码活动入口、活动页与奖励类型展示",
    }


def render_flow_reference_cards(model: SummaryModel, ordered_assets: list[Asset]) -> str:
    cards: list[str] = []
    for index, asset in enumerate(ordered_assets[: len(model.points)], 1):
        local_src = asset_src(model, asset)
        point = model.points[index - 1]
        caption = caption_for_asset(model, index)
        cards.append(
            f"""
        <article class="flow-card">
          <figure class="flow-shot annotated">
            <button class="image-open" type="button" data-full-image="{escape_attr(local_src)}" aria-label="点击放大查看参考图">
              <img src="{local_src}" alt="{escape_attr(asset.title)}">
            </button>
            {render_marks_for_asset(model, index)}
            <figcaption>
              <strong>{'核心参考图' if index == 1 else '补充参考图'} {index}：{escape_html(asset.title)}</strong><br>{caption}
              <span class="image-actions">
                <button type="button" data-full-image="{escape_attr(local_src)}" class="zoom-btn">放大查看</button>
                <button type="button" data-copy-image="{escape_attr(local_src)}" class="copy-btn">复制图片</button>
              </span>
            </figcaption>
          </figure>
          <div class="flow-copy">
            <div class="todo-item"><span class="todo-id">C{index}</span><span>{escape_html(point)}</span></div>
          </div>
        </article>"""
        )
    return f'<div class="flow-card-list">\n{"".join(cards)}\n        </div>'


def task_url(task_id: str) -> str:
    return f"{BASE_URL}/index.php?m=task&f=view&taskID={task_id}"


def asset_src(model: SummaryModel, asset: Asset) -> str:
    """返回自包含 data URI，便于 Teams/ArtBot 直接推送 HTML 文件。"""
    asset_path = model.output_dir / "assets" / asset.filename
    if not asset_path.exists():
        return f"assets/{escape_attr(asset.filename)}"
    mime = mimetypes.guess_type(asset_path.name)[0] or "image/png"
    data = base64.b64encode(asset_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


def render_marks(count: int) -> str:
    return "\n          ".join(f'<span class="mark client-m{i}">C{i}</span>' for i in range(1, count + 1))


def render_marks_for_asset(model: SummaryModel, asset_index: int) -> str:
    if model.scope == "客户端会员任务页":
        if asset_index != 1:
            return ""
        return "\n          ".join(
            [
                '<span class="mark member-task-m1">C1</span>',
                '<span class="mark member-task-m2">C2</span>',
                '<span class="mark member-task-m3">C3</span>',
                '<span class="mark member-task-m4">C4</span>',
                '<span class="mark member-task-m5">C5</span>',
                '<span class="mark member-task-m6">C6</span>',
            ]
        )
    if model.scope == "Web5 游戏入口图方形比例展示":
        if asset_index == 1:
            return '<span class="mark game-square-video">C1</span>'
        if asset_index == 2:
            return '<span class="mark game-square-hot">C2</span>'
        return ""
    if model.scope == "客户端 Refer Gift 推荐好友页面优化":
        if asset_index == 1:
            return '<span class="mark refer-intro">C1</span>'
        if asset_index == 2:
            return '<span class="mark refer-stats">C2</span>'
        if asset_index == 3:
            return '<span class="mark refer-leaderboard">C3</span>'
        return ""
    if model.scope == "Web5 Account Setting 手机号/邮箱绑定信息修改流程":
        return f'<span class="mark login-m{asset_index}">C{asset_index}</span>' if asset_index <= len(model.points) else ""
    return render_marks(len(model.points)) if asset_index == 1 else ""


def caption_for_asset(model: SummaryModel, asset_index: int) -> str:
    if model.scope == "客户端会员任务页":
        if asset_index == 1:
            return "标记 C1：任务文案币种要求；C2：单币种任务要求；C3：SC/GC 双进度条；C4：右上角感叹号说明入口；C5：进度数值在进度条右上方；C6：未开始遮罩任务不展示说明入口。"
        return "补充参考图，用于核对会员任务页展示状态。"
    if model.scope == "Web5 游戏入口图方形比例展示":
        if asset_index == 1:
            return "标记 C1：视频下方游戏入口图方形展示区域。"
        if asset_index == 2:
            return "标记 C2：冷热排行榜正方形游戏图展示区域。"
        return "补充参考图，用于核对同一需求下的另一处前端展示场景。"
    if model.scope == "客户端 Refer Gift 推荐好友页面优化":
        if asset_index == 1:
            return "标记 C1：客户端活动介绍区。"
        if asset_index == 2:
            return "标记 C2：客户端邀请统计表格区。"
        if asset_index == 3:
            return "标记 C3：客户端 Monthly Leaderboard 月榜区。"
        return "补充参考图，用于核对客户端推荐好友页面展示。"
    if model.scope == "Web5 Account Setting 手机号/邮箱绑定信息修改流程":
        captions = {
            1: "标记 C1：Account Setting 中 Mobile Number / My Email 的 Bind / Change 入口状态。",
            2: "标记 C2：点击 Change 后的验证方式选择弹窗。",
            3: "标记 C3：登录密码验证弹窗。",
            4: "标记 C4：新手机号或新邮箱的验证码验证弹窗。",
            5: "标记 C5：CPF 人脸验证弹窗和拉起状态。",
            6: "标记 C6：手机号或邮箱修改成功后的成功态。",
        }
        return captions.get(asset_index, "补充参考图，用于核对客户端绑定信息修改流程。")
    if asset_index == 1:
        return f"标记 C1-C{len(model.points)} 与右侧美术处理点一一对应。"
    return "补充参考图，用于核对同一需求下的另一处前端展示场景。"


def render_points(points: list[str]) -> str:
    return "\n".join(
        f'<div class="todo-item"><span class="todo-id">C{i}</span><span>{escape_html(point)}</span></div>'
        for i, point in enumerate(points, 1)
    )


def render_rules(rules: list[tuple[str, str, str]]) -> str:
    rows = "\n".join(
        f"<tr><td>{escape_html(a)}</td><td>{escape_html(b)}</td><td>{escape_html(c)}</td></tr>"
        for a, b, c in rules
    )
    return f"<tbody>\n{rows}\n</tbody>"


def render_context_rules(rules: list[str]) -> str:
    return "\n".join(
        f'<div class="step"><b>{i}</b><br>{escape_html(rule)}</div>' for i, rule in enumerate(rules, 1)
    )


def render_out_of_scope(items: list[tuple[str, str]]) -> str:
    return "\n".join(
        f'<div class="mini-card"><b>{escape_html(title)}</b><br>{escape_html(body)}</div>' for title, body in items
    )


def render_confirmations(items: list[str]) -> str:
    return "\n".join(
        f'<div class="todo-item confirm"><span class="todo-id">?</span><span>{escape_html(item)}</span></div>'
        for item in items
    )


def escape_html(value: Any) -> str:
    return html.escape(str(value), quote=False)


def escape_attr(value: Any) -> str:
    return html.escape(str(value), quote=True)


def render_png(html_path: Path, png_path: Path) -> None:
    node = NODE_BIN if NODE_BIN.exists() else shutil.which("node")
    if not node:
        raise RuntimeError("未找到 Node.js，无法渲染 PNG")
    cwd = NODE_PACKAGE_CWD if NODE_PACKAGE_CWD.exists() else ROOT
    chrome_line = f"executablePath: {json.dumps(str(CHROME_BIN))}," if CHROME_BIN.exists() else ""
    code = f"""
        import {{ chromium }} from 'playwright';
        const browser = await chromium.launch({{ headless: true, {chrome_line} }});
        const page = await browser.newPage({{ viewport: {{ width: 1440, height: 2200 }}, deviceScaleFactor: 1 }});
        await page.goto('file://' + {json.dumps(str(html_path))}, {{ waitUntil: 'load' }});
        await page.screenshot({{ path: {json.dumps(str(png_path))}, fullPage: true }});
        await browser.close();
    """
    subprocess.run([str(node), "--input-type=module", "-e", textwrap.dedent(code)], cwd=str(cwd), check=True)


def archive_payloads(model: SummaryModel, payload: dict[str, Any]) -> None:
    archive = model.output_dir / "_archive"
    archive.mkdir(parents=True, exist_ok=True)
    (archive / f"task_{model.task_id}_raw.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "task_id": model.task_id,
        "title": model.title,
        "deadline": model.deadline,
        "suite": model.suite,
        "scope": model.scope,
        "work_type": model.work_type,
        "work_method": model.work_method,
        "points": model.points,
        "assets": [asset.__dict__ for asset in model.assets],
    }
    (archive / f"task_{model.task_id}_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


def quality_checks(model: SummaryModel, html_path: Path, ai_md_path: Path) -> dict[str, Any]:
    included_assets = [asset for asset in model.assets if asset.include]
    issues: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    if not html_path.exists():
        issues.append({"code": "missing_html", "message": "未生成美术需求摘要 HTML。"})
    if not ai_md_path.exists():
        issues.append({"code": "missing_ai_md", "message": "未生成 AI 工作说明。"})
    if not included_assets:
        warnings.append({"code": "missing_frontend_image", "message": "未提取到可展示的前端/客户端参考图，需要负责人确认是否补图。"})

    frontend_text = "\n".join(
        [
            model.lead,
            "\n".join(model.points),
            "\n".join(" ".join(row) for row in model.rules),
            "\n".join(model.context_rules),
        ]
    )
    if has_backend_text(frontend_text):
        warnings.append({"code": "backend_leak_risk", "message": "美术处理内容中疑似混入后台/配置/研发字段，需要复核。"})

    if uses_flow_cards(model) and len(included_assets) < len(model.points):
        warnings.append({"code": "asset_mismatch", "message": "流程型摘要的参考图数量少于处理点数量，截图和说明可能无法一一对应。"})

    if ai_md_path.exists():
        ai_text = ai_md_path.read_text(encoding="utf-8")
        if re.search(r"\bC\d+\b|截图标识|ArtBot|raw JSON|过程文件路径|summary-manifest", ai_text):
            warnings.append({"code": "ai_md_dirty", "message": "AI 工作说明疑似混入 HTML 摘要标识或过程说明，需要清理。"})

    status = "ok"
    if issues:
        status = "failed"
    elif warnings:
        status = "needs_review"

    return {
        "status": status,
        "issues": issues,
        "warnings": warnings,
    }


def write_summary_manifest(model: SummaryModel, html_path: Path, ai_md_path: Path, png_path: Path) -> Path:
    included_assets = [asset for asset in model.assets if asset.include]
    checks = quality_checks(model, html_path, ai_md_path)
    manifest = {
        "version": 1,
        "taskId": model.task_id,
        "title": model.title,
        "generatedAt": current_iso(),
        "taskUrl": task_url(model.task_id),
        "outputDir": str(model.output_dir),
        "htmlPath": str(html_path),
        "aiWorkPath": str(ai_md_path),
        "pngPath": str(png_path) if png_path.exists() else "",
        "relative": {
            "htmlPath": html_path.name,
            "aiWorkPath": ai_md_path.name,
            "pngPath": png_path.name if png_path.exists() else "",
        },
        "deadline": model.deadline,
        "suite": model.suite,
        "scope": model.scope,
        "workType": model.work_type,
        "workMethod": model.work_method,
        "pointsCount": len(model.points),
        "assetCount": len(included_assets),
        "assets": [
            {
                "title": asset.title,
                "filename": asset.filename,
                "path": str(model.output_dir / "assets" / asset.filename),
            }
            for asset in included_assets
        ],
        "confirmationsCount": len(model.confirmations),
        "quality": checks,
    }
    manifest_path = model.output_dir / "summary-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    rebuild_summary_index(model.output_dir.parent)
    return manifest_path


def current_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def rebuild_summary_index(out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    items: list[dict[str, Any]] = []
    for task_dir in sorted(path for path in out_dir.glob("task_*_*") if path.is_dir()):
        manifest_path = task_dir / "summary-manifest.json"
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, JSONDecodeError):
                continue
            manifest["manifestPath"] = str(manifest_path)
            items.append(manifest)
            continue
        fallback = fallback_manifest_for_task_dir(task_dir)
        if fallback:
            items.append(fallback)
    items.sort(key=lambda item: (str(item.get("deadline") or "9999-12-31"), int(str(item.get("taskId") or "0"))))
    index = {
        "version": 1,
        "generatedAt": current_iso(),
        "count": len(items),
        "items": items,
    }
    index_path = out_dir / "summary-index.json"
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    return index_path


def fallback_manifest_for_task_dir(task_dir: Path) -> dict[str, Any] | None:
    match = re.match(r"task_(\d+)_", task_dir.name)
    if not match:
        return None
    task_id = match.group(1)
    html_path = task_dir / f"{task_id}-美术需求摘要.html"
    ai_md_path = task_dir / f"{task_id}-AI工作说明.md"
    if not html_path.exists() and not ai_md_path.exists():
        return None
    assets_dir = task_dir / "assets"
    assets = []
    if assets_dir.exists():
        assets = [
            {
                "title": path.name,
                "filename": path.name,
                "path": str(path),
            }
            for path in sorted(assets_dir.iterdir())
            if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        ]
    title = task_dir.name.removeprefix(f"task_{task_id}_").replace("_", " ")
    return {
        "version": 1,
        "taskId": task_id,
        "title": title,
        "generatedAt": "",
        "taskUrl": task_url(task_id),
        "outputDir": str(task_dir),
        "htmlPath": str(html_path) if html_path.exists() else "",
        "aiWorkPath": str(ai_md_path) if ai_md_path.exists() else "",
        "pngPath": "",
        "relative": {
            "htmlPath": html_path.name if html_path.exists() else "",
            "aiWorkPath": ai_md_path.name if ai_md_path.exists() else "",
            "pngPath": "",
        },
        "deadline": "",
        "suite": "",
        "scope": "历史摘要产物",
        "workType": "历史产物",
        "workMethod": "该目录生成于 manifest 接入前，可打开 HTML / AI 工作说明查看详情。",
        "pointsCount": 0,
        "assetCount": len(assets),
        "assets": assets,
        "confirmationsCount": 0,
        "quality": {
            "status": "legacy",
            "issues": [],
            "warnings": [{"code": "legacy_manifest", "message": "历史产物缺少详细 manifest，重新生成后可获得完整质检信息。"}],
        },
        "manifestPath": "",
    }


def generate_one(task_ref: str, args: argparse.Namespace) -> Path:
    task_id = extract_task_id(task_ref)
    if args.from_json:
        payload = json.loads(Path(args.from_json).read_text(encoding="utf-8"))
    else:
        payload = run_zentao_task(task_id)
    task = get_result(payload)
    text, _, _ = html_to_text(task.get("storySpec"))
    slug = args.slug or slug_for_task(task, text)
    output_dir = Path(args.out_dir) / f"task_{task_id}_{slug}"
    archive_duplicate_task_dirs(Path(args.out_dir), task_id, output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    model = build_model(task, payload, output_dir)
    archive_payloads(model, payload)
    download_assets(model, skip_download=args.skip_download)
    archive_supporting_story_files(model, payload, skip_download=args.skip_download)
    prune_active_assets(model)
    html_path = output_dir / f"{task_id}-美术需求摘要.html"
    png_path = output_dir / f"{task_id}-美术需求摘要.png"
    ai_md_path = output_dir / f"{task_id}-AI工作说明.md"
    html_path.write_text(render_html(model), encoding="utf-8")
    ai_md_path.write_text(render_ai_work_md(model), encoding="utf-8")
    if args.render_png and not args.skip_render:
        render_png(html_path, png_path)
    else:
        archive_optional_png(png_path)
    print(html_path)
    if args.render_png and png_path.exists():
        print(png_path)
    print(ai_md_path)
    manifest_path = write_summary_manifest(model, html_path, ai_md_path, png_path)
    print(manifest_path)
    return html_path


def archive_duplicate_task_dirs(base_dir: Path, task_id: str, keep_dir: Path) -> None:
    """同一任务只保留当前正确输出目录，旧目录自动归档，避免用户误用。"""
    if not base_dir.exists():
        return
    archive_root = base_dir / "_archive" / "duplicate_task_dirs"
    for path in sorted(base_dir.glob(f"task_{task_id}_*")):
        if not path.is_dir() or path.resolve() == keep_dir.resolve():
            continue
        archive_root.mkdir(parents=True, exist_ok=True)
        dest = archive_root / path.name
        if dest.exists():
            index = 1
            while True:
                candidate = archive_root / f"{path.name}_{index}"
                if not candidate.exists():
                    dest = candidate
                    break
                index += 1
        shutil.move(str(path), str(dest))


def archive_optional_png(png_path: Path) -> None:
    """默认交付只保留 HTML/AI MD；已有 PNG 预览归档，避免误当成必需产物。"""
    if not png_path.exists():
        return
    archive_dir = png_path.parent / "_archive" / "optional_png"
    archive_dir.mkdir(parents=True, exist_ok=True)
    dest = archive_dir / png_path.name
    if dest.exists():
        stem = png_path.stem
        suffix = png_path.suffix
        index = 1
        while True:
            candidate = archive_dir / f"{stem}_{index}{suffix}"
            if not candidate.exists():
                dest = candidate
                break
            index += 1
        shutil.move(str(png_path), str(dest))


def archive_supporting_story_files(model: SummaryModel, payload: dict[str, Any], skip_download: bool = False) -> None:
    """归档非图片原型/说明文件；客户端原型 HTML 可作为美术复核依据。"""
    if model.scope != "客户端 Refer Gift 推荐好友页面优化":
        return
    task = get_result(payload)
    story_files = task.get("storyFiles") or {}
    source_dir = model.output_dir / "_archive" / "source_files"
    source_dir.mkdir(parents=True, exist_ok=True)
    context = ssl._create_unverified_context()
    for fid, meta in story_files.items():
        if not isinstance(meta, dict):
            continue
        ext = str(meta.get("extension") or "").lower()
        title = normalize_text(meta.get("title")) or f"附件 {fid}"
        if ext not in {"html", "htm", "txt", "md"}:
            continue
        if "后台" in title and "客户端" not in title:
            continue
        if not re.search(r"客户端原型|需求说明", title):
            continue
        target = source_dir / safe_source_filename(title, str(fid), ext)
        if skip_download or (target.exists() and target.stat().st_size > 0):
            continue
        try:
            with urllib.request.urlopen(absolute_url(str(meta.get("webPath") or "")), context=context, timeout=30) as response:
                target.write_bytes(response.read())
        except Exception as exc:  # noqa: BLE001
            print(f"下载原型/说明附件失败：{title}；{exc}", file=sys.stderr)


def safe_source_filename(title: str, fallback: str, ext: str) -> str:
    title_path = Path(title)
    suffix = title_path.suffix.lower().lstrip(".")
    final_ext = suffix or ext
    stem = title_path.stem if suffix else title
    stem = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", stem).strip("._")
    return f"{stem or fallback}.{final_ext}"


def render_ai_work_md(model: SummaryModel) -> str:
    """生成给 AI 设计稿使用的专业需求说明，只保留设计处理内容。"""
    primary_ref = f"assets/{model.primary_asset.filename}" if model.primary_asset else "-"
    included_refs = [f"assets/{asset.filename}" for asset in model.assets if asset.include]
    lines: list[str] = []
    lines.append(f"# AI设计需求说明｜禅道 #{model.task_id}｜{model.title}")
    lines.append("")
    lines.append("## 设计范围")
    lines.append("")
    lines.append(f"- 需求名称：{model.title}")
    lines.append(f"- 套系/端：{model.suite}")
    lines.append(f"- 美术范围：{model.scope}")
    lines.append(f"- 处理类型：{model.work_type}")
    lines.append(f"- 处理方式：{model.work_method}")
    if model.scope == "客户端 Refer Gift 推荐好友页面优化" and included_refs:
        lines.append("- 参考图：")
        for ref in included_refs:
            lines.append(f"  - {ref}")
    elif model.primary_asset:
        lines.append(f"- 参考图：{primary_ref}")
    lines.append("")
    lines.append("## 设计目标")
    lines.append("")
    lines.append(f"围绕「{model.scope}」完成设计稿处理，只表达用户可见的界面、状态、层级、资源和适配要求。")
    lines.append(f"本单处理类型为「{model.work_type}」：{model.work_method}")
    if "新需求" not in model.work_type and model.primary_asset:
        lines.append("优先基于参考图进行优化和补充，不从零重画；除非需求明确要求改版，应延续原界面的结构、视觉风格和交互位置。")
    elif "新需求" in model.work_type:
        lines.append("按新需求补完整设计稿，同时确认是否存在可复用的原入口、组件样式或活动页视觉规范。")
    lines.append("")
    lines.append("设计稿只呈现真实界面内容，不加入摘要页辅助标识、清单编号、推送说明或过程文件说明。")
    lines.append("")
    lines.append("## 需要设计处理的内容")
    lines.append("")
    for point in model.points:
        lines.append(f"- {point}")
    lines.append("")
    lines.append("## 状态与展示规则")
    lines.append("")
    lines.append("| 场景 | 展示口径 | 美术检查点 |")
    lines.append("|---|---|---|")
    for scene, display, check in model.rules:
        lines.append(f"| {scene} | {display} | {check} |")
    lines.append("")
    lines.append("## 设计理解背景")
    lines.append("")
    for rule in model.context_rules:
        lines.append(f"- {rule}")
    lines.append("")
    lines.append("## 不处理范围")
    lines.append("")
    for title, body in model.out_of_scope:
        lines.append(f"- {title}：{body}")
    lines.append("")
    lines.append("## 设计前确认点")
    lines.append("")
    for item in model.confirmations:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## 输出要求")
    lines.append("")
    lines.append("- 输出可直接给美术评审的设计稿，重点体现界面结构、视觉层级、状态差异和必要标注。")
    lines.append("- 若涉及多状态，请分别呈现关键状态；不要新增需求中没有要求的入口、弹窗或错误态。")
    lines.append("- 若需要切图或图标资源，请在设计稿旁标注资源名称、尺寸、导出倍率和使用位置。")
    lines.append("")
    return "\n".join(lines)


def prune_active_assets(model: SummaryModel) -> None:
    """保持 assets 主目录只放成品实际引用的前端/客户端参考图。"""
    assets_dir = model.output_dir / "assets"
    archive_assets_dir = model.output_dir / "_archive" / "assets"
    if not assets_dir.exists():
        return
    archive_assets_dir.mkdir(parents=True, exist_ok=True)
    active_names = {asset.filename for asset in model.assets if asset.include}
    if model.primary_asset:
        active_names.add(model.primary_asset.filename)
    for path in assets_dir.iterdir():
        if not path.is_file() or path.name in active_names:
            continue
        dest = archive_assets_dir / path.name
        if dest.exists():
            stem = path.stem
            suffix = path.suffix
            index = 1
            while True:
                candidate = archive_assets_dir / f"{stem}_stale_{index}{suffix}"
                if not candidate.exists():
                    dest = candidate
                    break
                index += 1
        shutil.move(str(path), str(dest))


HTML_TEMPLATE = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <style>
    :root {{
      --bg: #eef6ff; --paper: #f8fcff; --card: #ffffff; --ink: #172033;
      --muted: #657489; --line: #d8e7f6; --deep: #122e54;
      --blue: #2796d8; --cyan: #16b7b0; --red: #b84a3a;
      --shadow: 0 22px 58px rgba(18, 46, 84, .14);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--ink);
      background: radial-gradient(circle at 10% 8%, rgba(39,150,216,.24), transparent 28%),
                  radial-gradient(circle at 90% 12%, rgba(22,183,176,.18), transparent 30%),
                  linear-gradient(145deg, #fbfdff, var(--bg));
    }}
    .wrap {{ max-width: 1160px; margin: 0 auto; padding: 24px 18px 46px; }}
    .panel {{ background: rgba(248,252,255,.95); border: 1px solid var(--line); border-radius: 24px; box-shadow: var(--shadow); }}
    .hero {{ display: grid; grid-template-columns: 1.1fr .9fr; gap: 16px; align-items: stretch; }}
    .hero-main {{ padding: 22px 26px 20px; overflow: hidden; }}
    .badge {{ display: inline-flex; padding: 6px 11px; border-radius: 999px; background: var(--deep); color: #f3f9ff; font-size: 12px; text-decoration: none; transition: transform .18s ease, box-shadow .18s ease; }}
    .badge:hover {{ transform: translateY(-1px); box-shadow: 0 8px 18px rgba(18,46,84,.22); }}
    h1 {{ margin: 12px 0 8px; font-size: clamp(28px, 3.4vw, 46px); line-height: 1.08; letter-spacing: -1px; }}
    h2 {{ margin: 0 0 16px; font-size: 25px; }}
    .lead {{ max-width: 760px; color: var(--muted); font-size: 15px; line-height: 1.65; }}
    .key-info {{ padding: 14px; display: grid; gap: 10px; }}
    .info-card {{ background: var(--card); border: 1px solid #dfeefa; border-radius: 16px; padding: 13px 15px; }}
    .info-card span {{ display: block; color: var(--muted); font-size: 12px; margin-bottom: 5px; }}
    .info-card b {{ display: block; font-size: 24px; line-height: 1.12; }}
    .info-card .small {{ font-size: 19px; }}
    .section {{ margin-top: 18px; padding: 24px; }}
    .focus {{ display: grid; grid-template-columns: .82fr 1.18fr; gap: 20px; align-items: start; }}
    .flow-focus {{ display: block; }}
    .flow-focus > div:last-child {{ display: none; }}
    .flow-card-list {{ display: grid; gap: 16px; }}
    .flow-card {{ display: grid; grid-template-columns: minmax(260px, 42%) 1fr; gap: 18px; align-items: start; background: var(--card); border: 1px solid #dfeefa; border-radius: 20px; padding: 14px; box-shadow: 0 10px 24px rgba(18,46,84,.07); }}
    .flow-shot {{ border-radius: 16px; box-shadow: none; }}
    .flow-shot img {{ max-height: 300px; object-fit: contain; }}
    .flow-shot figcaption {{ padding: 10px 12px 12px; }}
    .flow-copy {{ display: grid; gap: 10px; align-content: start; padding-top: 2px; }}
    .flow-copy .todo-item {{ font-size: 17px; }}
    .flow-copy p {{ margin: 0; color: var(--muted); line-height: 1.65; }}
    figure {{ margin: 0; background: var(--card); border: 1px solid #dfeefa; border-radius: 22px; overflow: hidden; box-shadow: 0 12px 30px rgba(18,46,84,.08); }}
    .image-open {{ display: block; width: 100%; padding: 0; border: 0; background: #eef4fa; cursor: zoom-in; }}
    figure img {{ width: 100%; display: block; background: #eef4fa; }}
    figcaption {{ padding: 13px 15px 16px; color: var(--muted); font-size: 14px; line-height: 1.6; }}
    .core-img {{ border: 2px solid var(--blue); }}
    .annotated {{ position: relative; }}
    .mark {{ position: absolute; width: 34px; height: 34px; border-radius: 999px; background: var(--blue); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 14px; border: 3px solid #f8fcff; box-shadow: 0 6px 16px rgba(18,46,84,.24); z-index: 2; }}
    .client-m1 {{ left: 45%; top: 35%; }} .client-m2 {{ left: 45%; top: 88%; }} .client-m3 {{ left: 25%; top: 47%; }}
    .client-m4 {{ left: 81%; top: 51%; }} .client-m5 {{ left: 13%; top: 39%; }} .client-m6 {{ left: 83%; top: 16%; }}
    .client-m7 {{ left: 64%; top: 62%; }} .client-m8 {{ left: 37%; top: 70%; }}
    .member-task-m1 {{ left: 46%; top: 36%; }}
    .member-task-m2 {{ left: 48%; top: 92%; }}
    .member-task-m3 {{ left: 28%; top: 56%; }}
    .member-task-m4 {{ left: 94%; top: 45%; }}
    .member-task-m5 {{ left: 83%; top: 59%; }}
    .member-task-m6 {{ left: 86%; top: 27%; }}
    .game-square-video {{ left: 48%; top: 14%; }}
    .game-square-hot {{ left: 13%; top: 39%; }}
    .refer-intro {{ left: 46%; top: 24%; }}
    .refer-stats {{ left: 50%; top: 48%; }}
    .refer-leaderboard {{ left: 47%; top: 56%; }}
    .login-m1 {{ left: 82%; top: 42%; }}
    .login-m2 {{ left: 50%; top: 38%; }}
    .login-m3 {{ left: 50%; top: 48%; }}
    .login-m4 {{ left: 50%; top: 45%; }}
    .login-m5 {{ left: 50%; top: 44%; }}
    .login-m6 {{ left: 50%; top: 46%; }}
    .image-actions {{ display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }}
    .image-actions button, .modal-actions button {{ border: 1px solid #b9dcf5; background: #eef8ff; color: #195f8f; border-radius: 999px; padding: 7px 11px; font: inherit; font-size: 13px; cursor: pointer; }}
    .image-actions button:hover, .modal-actions button:hover {{ background: #dff2ff; }}
    .todo {{ display: grid; gap: 11px; }}
    .todo-item {{ display: flex; gap: 11px; align-items: center; background: var(--card); border: 1px solid #dfeefa; border-radius: 16px; padding: 13px 14px; line-height: 1.58; border-left: 4px solid var(--blue); }}
    .todo-id {{ width: 38px; height: 38px; border-radius: 999px; background: var(--blue); color: #fff; display: inline-grid; place-items: center; font-weight: 800; flex: 0 0 auto; }}
    table {{ width: 100%; border-collapse: collapse; background: var(--card); border-radius: 16px; overflow: hidden; }}
    th, td {{ padding: 12px 13px; border-bottom: 1px solid #e5eff9; text-align: left; vertical-align: top; }}
    th {{ background: var(--deep); color: #f3f9ff; }} tr:last-child td {{ border-bottom: 0; }}
    .flow {{ display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }}
    .step {{ background: var(--card); border: 1px solid #dfeefa; border-radius: 16px; padding: 14px; min-height: 118px; line-height: 1.6; }}
    .step b, .mini-card b {{ color: var(--blue); }}
    .flow-note {{ margin-top: 14px; padding: 14px 16px; border-radius: 16px; background: #fff8e8; border: 1px solid #ead5a8; color: #684715; line-height: 1.7; }}
    .plain-grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }}
    .mini-card {{ background: var(--card); border: 1px solid #dfeefa; border-radius: 18px; padding: 16px; line-height: 1.65; }}
    .warn {{ border-color: #efc4b8; background: #fff8f5; }}
    .empty-shot {{ min-height: 420px; display: grid; place-items: center; gap: 8px; text-align: center; background: #fff; border: 2px dashed #b7d8f2; border-radius: 22px; color: var(--muted); padding: 30px; }}
    .empty-shot strong {{ display: block; color: var(--ink); font-size: 22px; }}
    .footer {{ text-align: center; color: var(--muted); margin-top: 26px; font-size: 13px; }}
    .lightbox {{ position: fixed; inset: 0; z-index: 20; display: none; padding: 28px; background: rgba(12,24,42,.78); backdrop-filter: blur(6px); }}
    .lightbox.active {{ display: grid; grid-template-rows: auto 1fr; gap: 14px; }}
    .modal-actions {{ display: flex; justify-content: flex-end; gap: 10px; }}
    .modal-actions button {{ background: #fff; }}
    .lightbox img {{ max-width: 100%; max-height: calc(100vh - 110px); justify-self: center; align-self: center; border-radius: 18px; box-shadow: 0 24px 70px rgba(0,0,0,.36); background: #fff; }}
    .toast {{ position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 30; display: none; padding: 10px 14px; border-radius: 8px; background: rgba(18,46,84,.94); color: #fff; font-size: 14px; }}
    .toast.show {{ display: block; }}
    @media (max-width: 900px) {{ .hero, .focus, .flow, .plain-grid, .flow-card {{ grid-template-columns: 1fr; }} .hero-main {{ padding: 20px; }} .key-info {{ grid-template-columns: 1fr; }} .flow-shot img {{ max-height: none; }} }}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="panel hero-main">
        <a class="badge" href="{task_link}" target="_blank" rel="noopener noreferrer" title="点击查看禅道原始需求">{badge}</a>
        <h1>{hero_title}</h1>
        <p class="lead">{lead}</p>
      </div>
      <aside class="panel key-info">
        <div class="info-card"><span>美术截止日</span><b>{deadline}</b></div>
        <div class="info-card"><span>套系/端</span><b>{suite}</b></div>
        <div class="info-card"><span>处理类型</span><b class="small">{work_type}</b></div>
        <div class="info-card"><span>处理方式</span><b class="small">{work_method}</b></div>
        <div class="info-card"><span>美术处理内容</span><b class="small">{scope}</b></div>
      </aside>
    </section>

    <section class="panel section">
      <h2>需要美术处理的内容</h2>
      <div class="{focus_class}">
        {figure}
        <div>
          <div class="todo">
            {points}
          </div>
        </div>
      </div>
    </section>

    <section class="panel section">
      <h2>关键展示规则</h2>
      <table>
        <thead><tr><th>场景</th><th>展示口径</th><th>美术检查点</th></tr></thead>
        {rules}
      </table>
    </section>

    <section class="panel section">
      <h2>只需了解的规则</h2>
      <div class="flow">
        {context_rules}
      </div>
      <div class="flow-note">这些规则用于核对客户端展示状态；设计稿只呈现用户可见界面、状态和资源适配。</div>
    </section>

    <section class="panel section">
      <h2>不在本次美术范围</h2>
      <div class="plain-grid">
        {out_of_scope}
      </div>
    </section>

    <section class="panel section warn">
      <h2>确认点</h2>
      <div class="todo">
        {confirmations}
      </div>
    </section>

    <div class="footer">自动生成摘要 HTML：仅突出美术处理点、编号对应标识、截止与必要边界。</div>
  </main>
  <div class="lightbox" id="imageLightbox" aria-hidden="true">
    <div class="modal-actions">
      <button type="button" id="copyLightboxImage">复制图片</button>
      <button type="button" id="closeLightbox">关闭</button>
    </div>
    <img id="lightboxImage" alt="放大参考图">
  </div>
  <div class="toast" id="copyToast">已复制图片</div>
  <script>
    const lightbox = document.getElementById('imageLightbox');
    const lightboxImage = document.getElementById('lightboxImage');
    const copyLightboxImage = document.getElementById('copyLightboxImage');
    const closeLightbox = document.getElementById('closeLightbox');
    const toast = document.getElementById('copyToast');
    let activeImageSrc = '';

    function showToast(message) {{
      toast.textContent = message;
      toast.classList.add('show');
      window.setTimeout(() => toast.classList.remove('show'), 1800);
    }}

    function openImage(src) {{
      activeImageSrc = src;
      lightboxImage.src = src;
      lightbox.classList.add('active');
      lightbox.setAttribute('aria-hidden', 'false');
    }}

    function closeImage() {{
      lightbox.classList.remove('active');
      lightbox.setAttribute('aria-hidden', 'true');
      lightboxImage.removeAttribute('src');
    }}

    async function copyImage(src) {{
      try {{
        const response = await fetch(src);
        const blob = await response.blob();
        await navigator.clipboard.write([new ClipboardItem({{ [blob.type || 'image/png']: blob }})]);
        showToast('已复制图片');
      }} catch (error) {{
        showToast('当前浏览器不支持直接复制图片，可放大后右键复制/保存');
      }}
    }}

    document.querySelectorAll('[data-full-image]').forEach((button) => {{
      button.addEventListener('click', () => openImage(button.dataset.fullImage));
    }});
    document.querySelectorAll('[data-copy-image]').forEach((button) => {{
      button.addEventListener('click', () => copyImage(button.dataset.copyImage));
    }});
    copyLightboxImage.addEventListener('click', () => activeImageSrc && copyImage(activeImageSrc));
    closeLightbox.addEventListener('click', closeImage);
    lightbox.addEventListener('click', (event) => {{
      if (event.target === lightbox) closeImage();
    }});
    document.addEventListener('keydown', (event) => {{
      if (event.key === 'Escape') closeImage();
    }});
  </script>
</body>
</html>
"""

STANDARD_HTML_TEMPLATE = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{
      --bg: #f3f6fb;
      --panel: #ffffff;
      --text: #111827;
      --muted: #64748b;
      --line: #d7e0ec;
      --soft-line: #e8eef6;
      --blue: #1d4ed8;
      --green: #059669;
      --orange: #d97706;
      --red: #dc2626;
      --shadow: 0 16px 42px rgba(15, 23, 42, .08);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
      line-height: 1.55;
    }}
    .page {{ max-width: 1240px; margin: 0 auto; padding: 32px 28px 44px; }}
    .header {{
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: end;
      padding: 24px 26px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: linear-gradient(135deg, #ffffff 0%, #f8fbff 100%);
      box-shadow: var(--shadow);
    }}
    h1 {{ margin: 0 0 12px; font-size: 28px; line-height: 1.25; letter-spacing: 0; }}
    .meta {{ display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); }}
    .pill {{
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 4px 11px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      font-size: 13px;
    }}
    .open-task {{ color: var(--blue); font-weight: 600; }}
    a {{ color: var(--blue); text-decoration: none; }}
    .grid {{
      display: grid;
      grid-template-columns: minmax(0, 1.22fr) minmax(0, .9fr) minmax(0, .9fr);
      gap: 16px;
      margin-top: 22px;
    }}
    .section {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, .04);
    }}
    .section h2 {{ margin: 0 0 14px; font-size: 17px; letter-spacing: 0; }}
    .section.need h2 {{ color: var(--green); }}
    .section.avoid h2 {{ color: var(--red); }}
    .section.confirm h2 {{ color: var(--orange); }}
    ul {{ margin: 0; padding-left: 0; list-style: none; }}
    li {{ position: relative; margin: 10px 0; padding-left: 18px; color: #0f172a; }}
    li::before {{ content: ""; position: absolute; left: 0; top: .72em; width: 6px; height: 6px; border-radius: 999px; background: #94a3b8; }}
    .need li::before {{ background: var(--green); }}
    .avoid li::before {{ background: var(--red); }}
    .confirm li::before {{ background: var(--orange); }}
    .refs {{ margin-top: 18px; }}
    .refs h2, .raw h2 {{ margin: 0 0 14px; font-size: 18px; }}
    .images {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }}
    figure {{ margin: 0; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 10px; transition: transform .14s ease, box-shadow .14s ease; }}
    figure:hover {{ transform: translateY(-2px); box-shadow: 0 14px 30px rgba(15, 23, 42, .10); }}
    figure img {{ display: block; width: 100%; height: 250px; object-fit: contain; border-radius: 6px; background: #f1f5f9; }}
    .image-button {{ display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }}
    .image-button:focus-visible {{ outline: 3px solid rgba(29, 78, 216, .35); outline-offset: 3px; border-radius: 8px; }}
    figcaption {{ margin-top: 8px; color: var(--muted); font-size: 12px; word-break: break-all; }}
    .raw {{ margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
    details.raw-details {{ margin-top: 18px; }}
    details.raw-details > summary {{ cursor: pointer; color: var(--muted); font-weight: 600; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }}
    pre {{ margin: 0; padding: 14px; white-space: pre-wrap; word-break: break-word; background: #0f172a; color: #e5e7eb; border-radius: 8px; font-size: 13px; max-height: 420px; overflow: auto; }}
    .empty {{ color: var(--muted); }}
    .count {{ color: var(--muted); font-size: 13px; font-weight: 400; margin-left: 6px; }}
    .lightbox {{ position: fixed; inset: 0; z-index: 50; display: none; align-items: center; justify-content: center; padding: 28px; background: rgba(15, 23, 42, .78); }}
    .lightbox.is-open {{ display: flex; }}
    .lightbox-panel {{ position: relative; width: min(1280px, 96vw); max-height: 92vh; display: grid; gap: 10px; }}
    .lightbox img {{ display: block; width: 100%; max-height: calc(92vh - 54px); object-fit: contain; border-radius: 8px; background: #fff; box-shadow: 0 24px 80px rgba(0, 0, 0, .34); }}
    .lightbox-caption {{ color: #e5e7eb; font-size: 13px; word-break: break-all; }}
    .lightbox-close {{ position: absolute; top: -14px; right: -14px; width: 36px; height: 36px; border: 1px solid rgba(255, 255, 255, .36); border-radius: 999px; background: rgba(15, 23, 42, .9); color: #fff; cursor: pointer; font-size: 22px; line-height: 1; }}
    @media (max-width: 900px) {{ .grid, .raw {{ grid-template-columns: 1fr; }} .header {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <div>
        <h1>{task_title}</h1>
        <div class="meta">
          <span class="pill">任务 #{task_id}</span>
          <span class="pill">状态 {status_text}</span>
          <span class="pill">截止 {deadline_text}</span>
          <span class="pill">指派 {assigned_to}</span>
          <span class="pill">需求 {story_title}</span>
        </div>
      </div>
      <a class="pill open-task" href="{task_url}" target="_blank" rel="noreferrer">打开禅道任务</a>
    </header>

    <section class="grid">
      {needs}
      {avoid}
      {confirm}
    </section>

    <section class="section refs">
      <h2>参考图</h2>
      {images}
    </section>

    <details class="raw-details">
      <summary>查看原文与任务描述</summary>
      <section class="raw">
        <div class="section">
          <h2>美术相关原文</h2>
          <pre>{source_lines}</pre>
        </div>
        <div class="section">
          <h2>任务描述</h2>
          <pre>{task_desc}</pre>
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
    (() => {{
      const lightbox = document.getElementById("image-lightbox");
      const image = lightbox.querySelector("img");
      const caption = lightbox.querySelector(".lightbox-caption");
      const close = lightbox.querySelector(".lightbox-close");
      function openPreview(button) {{
        image.src = button.dataset.fullSrc || button.querySelector("img")?.src || "";
        image.alt = button.dataset.alt || "";
        caption.textContent = button.dataset.caption || "";
        lightbox.classList.add("is-open");
        lightbox.setAttribute("aria-hidden", "false");
        close.focus();
      }}
      function closePreview() {{
        lightbox.classList.remove("is-open");
        lightbox.setAttribute("aria-hidden", "true");
        image.removeAttribute("src");
      }}
      document.querySelectorAll("[data-lightbox-src]").forEach((button) => {{ button.addEventListener("click", () => openPreview(button)); }});
      close.addEventListener("click", closePreview);
      lightbox.addEventListener("click", (event) => {{ if (event.target === lightbox) closePreview(); }});
      document.addEventListener("keydown", (event) => {{ if (event.key === "Escape" && lightbox.classList.contains("is-open")) closePreview(); }});
    }})();
  </script>
</body>
</html>"""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成禅道美术需求摘要 HTML 和 AI 工作说明")
    parser.add_argument("task_refs", nargs="*", help="禅道任务 ID 或任务链接")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUTPUT_DIR), help="输出根目录")
    parser.add_argument("--from-json", help="只处理单个任务时，可指定已有 raw JSON")
    parser.add_argument("--slug", help="自定义输出目录短名，只处理单个任务时使用")
    parser.add_argument("--skip-download", action="store_true", help="不下载附件图片")
    parser.add_argument("--render-png", action="store_true", help="额外渲染 PNG 预览图；默认只生成 HTML 和 AI 工作说明")
    parser.add_argument("--skip-render", action="store_true", help="兼容旧参数：不渲染 PNG")
    parser.add_argument("--rebuild-index", action="store_true", help="只重建 outputs/summary-index.json，不重新读取禅道")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.rebuild_index:
        index_path = rebuild_summary_index(Path(args.out_dir))
        print(index_path)
        return 0
    if not args.task_refs:
        raise SystemExit("请提供禅道任务 ID / 链接，或使用 --rebuild-index")
    if args.from_json and len(args.task_refs) != 1:
        raise SystemExit("--from-json 只能和单个任务一起使用")
    if args.slug and len(args.task_refs) != 1:
        raise SystemExit("--slug 只能和单个任务一起使用")
    for task_ref in args.task_refs:
        generate_one(task_ref, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
