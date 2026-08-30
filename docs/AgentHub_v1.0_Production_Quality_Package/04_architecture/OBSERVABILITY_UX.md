# Observability UX

生产级不等于把所有日志露给用户。

三层：
1. User state：运行中/等待权限/失败/完成。
2. Engineering detail：Activity/Run Inspector。
3. Diagnostics：raw error/code/payload，折叠。

后台日志仍保留完整 trace，但主 UI 不显示 stack/raw payload。
