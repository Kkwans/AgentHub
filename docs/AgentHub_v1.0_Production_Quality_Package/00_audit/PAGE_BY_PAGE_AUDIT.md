# Page-by-Page Audit

## Home
**主要问题**：landing-page 比重过高、工作信息下沉、project card 面积/信息比失衡、绝对路径噪音。

**1.0 决策**：改成 work-first dashboard；只有首次空项目时展示 onboarding hero。

## Projects
**主要问题**：toolbar 过滤器过多、row 88px、logo 52px、path 常驻、migration imports/unused disable。

**1.0 决策**：list-first + 64–72px row + filter popover + path progressive disclosure。

## Project Context
**主要问题**：共享 Screen header + project context header 容易出现双标题/重复纵向空间；右侧事实卡在信息少时容易留下空白。

**1.0 决策**：进入 project 后采用 compact identity header；side facts 在无内容时自动收缩。

## Work
**主要问题**：业务对象 Task/Run/Session 容易在列表中同时暴露太多字段；状态多导致 chip 化。

**1.0 决策**：工作项是 primary，Run/Session 作为 secondary status/action。

## Sessions
**主要问题**：与 Workspace Session Rail 容易重复两套 session presentation。

**1.0 决策**：Project Sessions 是浏览/过滤入口；Workspace Rail 是最近协作切换器，两者组件语义可共享但密度不同。

## Agent Center
**主要问题**：如果把 runtime/provider/model/executable/capabilities 都首屏展示，会退化成诊断台。

**1.0 决策**：identity/readiness/runtime/last seen 为主；raw config detail drawer。

## Prompt Library
**主要问题**：页面职责过重；lifecycle mega dialog；Content/Variable/Binding/Playground 数据与 modal state 全在一个组件。

**1.0 决策**：asset workspace + version drawer；每个 tab 独立 component/hook。

## Settings
**主要问题**：当前“设置与诊断”把 unrelated infrastructure 混进设置；route section 失效。

**1.0 决策**：真正 sectioned Settings，Infrastructure 归 Agent。

## Workspace
**主要问题**：核心能力已经齐，但仍不够 calm/continuous；Git review double navigation、Diff fixed height、Composer secondary controls 太抢、execution data 混聊天。

**1.0 决策**：Conversation-first + continuous Review Inspector。
