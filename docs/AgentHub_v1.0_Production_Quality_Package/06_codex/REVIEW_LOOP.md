# Codex Visual Review Loop

每个 UI task：
1. 先截 before。
2. 实现一小块。
3. 截 1440×900 light。
4. 检查 4px grid、left edges、height、density、truncation。
5. 截 1280×800。
6. 截 dark。
7. 跑 real-data fixture。
8. 修正。
9. 相关 tests。
10. commit+push。

不要一次改 8 个页面再看截图。
