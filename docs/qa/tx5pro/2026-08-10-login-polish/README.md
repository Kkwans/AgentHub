# AgentHub 登录页视觉修订 TX5Pro 验收

- 日期：2026-08-10
- 结果：PASS
- 正式镜像：`agenthub:0.3.0-nas.3`
- TX5Pro：Google Chrome 150.0.7871.182
- 地址：`http://192.168.5.110:3210`

## 实机检查

- 大写字母 A 已替换为 AgentHub 专属“中心 Hub + 三个连接节点”SVG 标志，并用于登录页、
  应用侧栏与 favicon；
- 删除独占一行的钥匙图标，品牌区到账号说明区的实际间距不超过 36px；
- 用户名至少 3 个字符，密码至少 6 个字符，不要求大小写、数字或符号复杂度；
- 首次设置的密码和确认密码均使用同一个 `PasswordField`，各自具备显示/隐藏按钮；
- 密码可见性可在 `password` 与 `text` 间切换，按钮同步提供中文可访问名称和
  `aria-pressed`；
- Chrome computed style 确认输入本体 `outline=none`、Radix Root `outline-width=2px`、
  `box-shadow=none`，聚焦态只有一层蓝色描边；
- 1440 与 390 视口均无根页面横向溢出；
- 0 request failure、console/page/HTTP 错误与外部请求。

机器可读结果见 [report.json](report.json)。同目录保存桌面、移动端、完整聚焦页和密码表单
局部截图，均来自正式 Compose 服务。
