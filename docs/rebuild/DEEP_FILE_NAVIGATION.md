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

22:21 UTC精确补证：530a21a / run43646874561 的工作区短链24/24通过（0重试），其中深树8例覆盖四宽浅深、真实9层文件系统路径、空目录、未展开兄弟零读取、外逃symlink禁用、根/子depth0、文件内容读取、无横溢出与手机44px/桌面31px行。artifact14134613114（SHA256 242875a6077669f39a7fd2213b85c64df894e8897f5711fe9ce9db0d43b2f6ad）已下载实看390浅与1440深。慢请求/撤权缓存通过的是unit，不扩称本真实矩阵已含。手机九层全部展开把文件预览推到首屏下方，正确性进展不等于阅读体验已完善，留作后续问题；无付费或真实供应商会话，本矩阵使用真实服务/文件系统及本地ACP测试适配器。

## 下一片：文件阅读优先（未实现）

530四宽实图复审发现`.file-inspector`只有min-height而没有确定高度，已有百分比grid轨道无法可靠限制树区，深树撑高整体。先固定容器高度并分配独立树/预览滚动区，不引入两套手机视图；保树挂载、展开、选中、44px触点与原安全请求。标题以basename为主、完整路径键盘按需展开；考虑用户主动选中文件后聚焦预览标题，并提供回到当前树节点的入口，不能后台刷新抢焦点。真实门禁新增预览/首行与视口交集、预览可读高度至少160px、空目录展开不推移正文、目录/阅读往返保状态。不将源码有overflow或toBeVisible等同可读。

### 22:38 UTC 阅读候选已实现，等待精确新图

FileInspector现在明确100%高度，树占有限轨道并独立滚动，预览占余量；树不卸载、不重建展开状态。手机仍44px行，不通过压触点节省空间。预览默认仅一行目录/basename/路径/只读，路径按钮可键盘展开下方内容，切文件自动收起；loading/error也保留文件身份。主动选文件聚焦阅读标题，目录/阅读入口支持双向焦点往返且仅滚树内部；手动收起祖先时返回目录fallback聚焦树，不擅自重新展开。独立CR指出树标题可被flex压缩，已仅该标题固定shrink0，并增加动作容纳/首目录无重叠门禁。

已补真实9层阅读视口交集至少160px、marker首行在编辑器裁切区内可见、basename在视口、路径查看、往返保展开/文件、空目录不推正文；原安全/请求/44px/无横溢出约束保留。专项42与类型/lint过；当前最终聚合及build进行，尚未声称真实首屏已达标。

22:42 UTC最终冻结后：全量lint/typecheck、apps/web116文件1387例与串行完整build成功，四个实现/测试文件哈希一致。真实spec严格类型/list8也过；允许推候选进入精确CI，但首屏阅读几何与新图仍待验。本地全仓auth-stream worker SIGKILL边界见CI-VALIDATION.md，不称全仓重跑已绿。

### 22:53 UTC ec2真实阅读图证

`ec2e9fe` / run43649594476工作区24/24通过，包含新深树8例的真正视口交集>=160px、marker首行在编辑器裁切区内、basename完整可见、键盘往返保九层展开、空目录不推正文、44px/安全请求/无横溢出。artifact14135154125 SHA256=eaf51845a78a7741410444003a85ab0081bd614fd09f8b19224d6242735bb943。实看reading与empty共16图：390首行约367px（0ff同场景约820px），768/1024约483px，1440约393px。不是生产provider联调，也不是完整CI全部通过。

仍有可见细节：h3键盘聚焦的局部outline叠加全局[tabindex]:focus-visible box-shadow形成双框；仅该h3清shadow、保2pxoutline/焦点语义的小修另行验证。树滚动区底部空目录提示局部裁切、平板多层头部偏厚仍开放，不以本片功能门禁替代审美验收。

22:54 UTC标题聚焦小修：仅.file-preview-header h3:focus去掉box-shadow，保2px solid outline/-2px offset与全部焦点/键盘行为。新增源样式回归及真实首次阅读、键盘返回后computed shadow/outline门禁。43专项、web/真实类型、全仓lint/typecheck与串行build通过；这是局部CSS风险范围验证，不重复声称新一轮全仓单测完成，精确新图待CI。

43专项可复现范围：`corepack pnpm exec vitest run apps/web/src/features/workspace/components/FileInspector.test.tsx apps/web/src/features/workspace/pages/WorkspacePage.test.tsx`，FileInspector9+WorkspacePage34。

23:04 UTC dbc精确补证：run43650616675工作区24/24通过，artifact14135879213（SHA256 03b3a3df94836b3fd24a6f1c9a155656911fe507be74b4ba2e634b6a659943db）390浅/1440深实图确认h3外侧叠框消失，仅保2pxoutline。首次选择/键盘返回的computed shadow none与outline门禁通过，首屏/树状态行为不变。其完整CI仍非全部完成。
