# AgentHub nas.6 TX5Pro 视觉验收

## 结果

- 时间：2026-08-10 22:38 CST
- 设备：TX5Pro
- 浏览器：Chrome 150.0.7871.182
- 正式地址：`http://192.168.5.110:3210`
- 镜像：`agenthub:0.3.0-nas.6`
- 结果：PASS

## 验收边界

- 正式服务 `/api/v1/health` 和未登录登录页直接访问生产部署。
- 首次设置页通过只读网络 fixture 模拟 `setupRequired=true`，没有创建或修改正式管理员账号。
- 概览通过只读 Project/Session/Task/Agent fixture 和本地 WebSocket stub 提供确定性状态；加载的
  HTML、JavaScript、CSS 与组件均来自正式 `nas.6` 部署。
- 因此，本目录证明部署静态资源、响应式布局、视觉状态和浏览器运行时通过，不单独证明完整
  登录后业务数据链路；后端链路由 Vitest/Playwright 工程门禁覆盖。

## 自动断言

- 登录页：1440、390 无根页面横向溢出。
- 首次设置页：1440、390 每个密码框只有一个自定义眼睛，原生 reveal 不占布局，聚焦态为
  单层 2px outline。
- 概览：1440、1024、768、390 均为四个完整面板，无灰色空洞、无 `priority-section`、左右
  边框同为 1px；390 的卡片间距为 12px。
- 全过程 0 个 request failure、console/page/HTTP error 和外部请求。

结构化结果见 `report.json`，截图为同目录下 `login-*`、`setup-*` 与 `overview-*` 文件。
