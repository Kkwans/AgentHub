# Codex 正式执行 Prompt

退出 Plan Mode 后发送。

按已经确认的 Plan 执行 AgentHub v1.0.0。

## Source of truth
本 v1.0 package 高于旧 v0.x 设计文档。遇到冲突：v1 Final Solution > Screen Spec > Design System > QA > 旧文档。

## 工作方式
- 先阅读再改，不猜接口。
- 优先复用现有后端能力。
- UI 是 P0：每个阶段必须真实浏览器截图复核。
- 不允许“测试绿=视觉完成”。
- 不允许大规模重写业务后端来配 UI。
- 不允许创建 `v1Page.tsx`/`v1-final.css` 并长期并存。
- 不允许新增 eslint-disable 掩盖迁移问题。
- 不允许把完整路径/ID/raw payload 暴露为默认主信息。

## Git
每完成一个可独立验收的模块：
1. lint/typecheck/相关 test
2. screenshot / visual check
3. `git status` 确认范围
4. 中文 Conventional Commit，标题+正文
5. push 到当前工作分支

## Visual loop
实现 → screenshot → 与 v1 Prototype/Spec 对照 → 修正 → screenshot → gate。
不要把视觉 review 推迟到最后。

## 完成条件
只有 `05_qa/RELEASE_CHECKLIST.md` 和 `HUMAN_9_POINT_SCORECARD.md` 全部达标，才可以声称 v1.0 完成。
