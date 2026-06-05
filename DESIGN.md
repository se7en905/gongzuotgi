---
version: alpha
name: 美术部 Stitch 工作台
description: 面向美术部门负责人和组员的高保真生产工具界面，遵循 Stitch / DESIGN.md 的 token 化设计系统口径。
colors:
  primary: "#263F58"
  on-primary: "#FFFFFF"
  accent: "#6A7F96"
  background: "#F4F6F8"
  canvas: "#EEF2F6"
  surface: "#FFFFFF"
  surface-soft: "#F7F9FB"
  border: "#D7E0EA"
  border-strong: "#B9C7D6"
  text: "#243244"
  heading: "#101828"
  muted: "#697586"
  success: "#17803D"
  warning: "#B45309"
  danger: "#B42318"
typography:
  page-title:
    fontFamily: "ui-sans-serif, PingFang SC, Microsoft YaHei, Segoe UI, system-ui"
    fontSize: "21px"
    fontWeight: 860
    lineHeight: 1.15
    letterSpacing: "0"
  section-title:
    fontFamily: "ui-sans-serif, PingFang SC, Microsoft YaHei, Segoe UI, system-ui"
    fontSize: "14px"
    fontWeight: 860
    lineHeight: 1.3
    letterSpacing: "0"
  body:
    fontFamily: "ui-sans-serif, PingFang SC, Microsoft YaHei, Segoe UI, system-ui"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0"
  data:
    fontFamily: "ui-sans-serif, PingFang SC, Microsoft YaHei, Segoe UI, system-ui"
    fontSize: "12px"
    fontWeight: 760
    lineHeight: 1.2
    fontFeature: "tnum"
rounded:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    height: "30px"
    padding: "0 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    height: "30px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  table-header:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.heading}"
    rounded: "{rounded.sm}"
---

## Overview

美术部工作台是一个任务、AI 产物和执行记录密集的生产工具，不做营销页，不使用大面积 hero、装饰性渐变或无意义插画。界面应像 Stitch 生成的高保真工具稿：结构清晰、状态明确、组件规则一致，便于负责人快速扫描、分配和复核。

## Colors

使用冷灰白作为画布底色，主色是克制的蓝灰。主色只用于当前导航、主要按钮、选中态和关键进度，不铺满页面。危险操作只使用红色体系，避免和普通操作混淆。

## Typography

中文界面不使用负字距。页面标题控制在 18-21px，卡片和表格标题控制在 14px 左右，表格正文和按钮文案控制在 12px。数字启用 tabular figures，保证列表和卡片统计对齐。

## Layout & Spacing

整体布局是工具台，不是展示页。左侧导航、顶部栏、主内容三层稳定。页面区块间距保持 12-16px，表格行、按钮和卡片内边距要紧凑但不拥挤。长文本必须允许换行或省略，不能重叠。

## Elevation & Depth

使用低强度阴影和细边框表达层级。主页面背景可带极轻网格，模拟设计画布；卡片、弹窗、抽屉使用白色表面和柔和阴影。不要使用紫蓝 AI 渐变、漂浮光球或装饰性 bokeh。

## Shapes

组件圆角以 8-10px 为主。按钮、表格、输入框保持 8px；主要卡片保持 10px；头像或小徽标可以更圆。不要把所有元素做成胶囊形。

## Components

按钮必须有 hover、active、focus 三种状态，并保证悬浮时文字颜色可读。表格操作区使用同一套小尺寸按钮，删除按钮使用红色 plain 或红色实底。表格固定列背景必须与行 hover 状态同步，避免右侧操作列脏块。

## Do's and Don'ts

Do: 保持字段、权限、隐藏状态和业务逻辑不被视觉优化改动。  
Do: 优先调整 token、spacing、surface、state，少改模板结构。  
Do: 所有列表都要防止文字重叠，按钮宽度要能容纳中文。  
Don't: 恢复已删除模块。  
Don't: 添加营销式视觉、装饰图形或大面积渐变。  
Don't: 为了美化降低任务中心和 AI 产物清单的信息密度。
