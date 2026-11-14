# 会话文件树：按目录读取

## 当前证据，不重说已解决的问题

2026-11-14 21:43 UTC查阅aaa精确fixture文件页图和当前源码：FileInspector已有目录缩进、折叠箭头与递归子项，Git变更列表也已显示文件名+弱父目录且能切目录模式。不能描述为仍然平铺完整路径。

新缺口是读取边界：根查询固定depth=4；深度耗尽的DIRECTORY没有children，点击只切本地expanded，不继续请求。因此该代码路径不能继续浏览深层目录。现fixture将长相对路径文件直接放apps子项下，不能作为真实深层树验收。此结论目前为源码与fixture核验，深层端到端待补。

## 现有API边界

- GET /projects/:id/files?path=<项目相对目录>&depth=0 已返回直属项；entry.path已相对项目根，不能重复拼父路径。
- depth允许0–6；每次5000项上限，超限明确FILE_TREE_TOO_LARGE，无分页，本片不假装解决超大单目录。
- 本地与Remote Node均支持；继续使用现有路径/realpath containment与节点授权根检查，SYMLINK不作为DIRECTORY递归，blocked禁用。
- 不更改认证、权限或后端协议；不宣称新增文件系统竞态安全保障。

## 实施方案

1. 根depth0，仅文件tab按需启用，传AbortSignal；不直接扩大depth。
2. 子目录只有用户展开时读取depth0，缓存key按projectId/realRootPath/relativePath隔离、相对path URL编码。
3. 未加载children undefined、已加载空数组、加载与失败分开；就地反馈与重试，不盖住已有文件预览。
4. 不因默认展开而自动递归拉整仓；重复展开去重，收起或切项目后旧响应不得填入新树。刷新失效当前项目文件缓存，不只根层。
5. 保既有预载fixture兼容、只读文件预览与blocked状态；UI保持文件名/层级，不新增完整路径大段文案。

## 任务与验收

- [x] 核真实API合同、深度/预算限制与安全边界。
- [x] FileInspector+ViewModel+调用链实现与unit边界；独立CR发现旧授权缓存后已补owner/epoch及延迟响应回访回归。
- [x] 已写真实9层含空格/中文/#/&路径验收脚本；根/子depth0、未展开兄弟零读，已接CI，浏览器执行待结果。
- [ ] 空目录与失败/重试/慢请求切项目边界，SYMLINK不递归；保已有非法路径拒绝，不放宽后端校验。
- [ ] 四宽明暗真实图与无横溢出/层级/44px触点，记录fixture与真实服务区别。
- [x] 冻结CR、134文件1475测试、静态、串行build通过；commit&push后的精确新CI实图待取。

21:52 UTC：候选及真实E2E脚本已实现，冻结聚合中；未声称端到端或视觉已通过。
