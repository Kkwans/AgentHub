# v0.6 PromptOS Presentation 收口记录

日期：2026-08-16  
代码提交：`8adb2a5`；NAS 发布提交使用同一 revision

## 变更范围

- Prompt Version 列表将 `UI`、`PROJECT_SCAN` 等内部来源映射为中文来源文案。
- Prompt Version 创建者不再直接显示 `local-user` 等内部标识，改为普通用户可理解的创建者文案。
- Skill 列表将扫描来源映射为中文。
- Binding 列表将数值 `priority` 映射为“默认顺序 / 更优先 / 较后执行”，避免直接暴露内部字段语义。
- Binding 表单说明修正为“数字越小越优先”，与服务端解析顺序一致。

## 验证

```text
corepack pnpm exec vitest run apps/web/src/presentation/domain-labels.test.ts apps/web/src/pages/PromptOsPage.test.tsx --reporter=dot
2 files / 4 tests passed
corepack pnpm lint
passed
corepack pnpm typecheck
passed
corepack pnpm build
passed; Web 1716 modules transformed
```

## 边界

- 本切片不改变 PromptOS API、数据库字段或解析算法，只修复展示层和错误说明。
- 本记录不是 TX5Pro/人工视觉验收；当前环境仍没有授权浏览器通道。
- NAS 已发布 `agenthub:0.6.0-nas.34`，容器 `running/healthy`。发布前备份为
  `/volume2/Project/.agenthub/central/deployments/20260816T121812Z-pre-nas34/`。
- `GET /api/v1/health` 返回 200，根页面返回 200；生产 Web bundle 含“项目扫描”和“数字越小越优先”，server 工作目录的 `node-pty` native binding smoke 返回 `READY`。
- nas.33 直接 overlay 构建触发 Docker daemon `max depth exceeded`，未激活该失败镜像；随后从 nas.33 运行时导出并以无 ACL/xattr 的单层 rootfs 导入 nas.34，再执行 `docker compose up -d --no-build agenthub`。整个过程未执行 `compose down`，未删除镜像、卷、用户数据或其他 Agent 容器。
