# 中文字体一致性

## 已知证据

69efd21精确CI43538691004的HTML报告包含8档（四宽×明暗）内容态Home的24个CDP实际字形样本：中文WenQuanYi Zen Hei（系统字体），英文Agent为自托管Geist。不能据此把空态Home或Prompt的具体字体断言为宋体，也不能说CI缺少中文黑体。问题是产品依赖操作系统fallback，中文风格和字重跨平台不统一。

## 本片方案与成本

- 精确依赖官方`@fontsource-variable/noto-sans-sc@5.3.1`，registry包SHA-512与lock一致；OFL-1.1原文随public/licenses分发。
- 保留Geist作为英文优先，随后Noto Sans SC Variable，再保留PingFang/YaHei/Noto CJK/system fallback。Workspace复用全局token；旧兼容主题helper也保持同顺序。
- 使用包的101个Unicode-range本地WOFF2分片和font-display:swap，不运行时访问字体CDN，不全量preload。包总4,500,544字节；单片2,072–76,324字节；原CSS101,698字节。构建98个独立WOFF2共4,491,296字节，另3小片被Vite内联。
- 部署总量不是首屏下载量。按现有字形区间推算空Home约705,368字节、Prompt约460,680字节，只是预测，不是浏览器结果；冷启动成本不能隐去。

## 验收门禁

1. 静态QA验证Geist/Noto顺序、Workspace和兼容helper一致、本地URL、Unicode-range、swap、单片≤100KiB、总字体≤5MiB、CSS≤128KiB及许可证一致。
2. 真实Home四宽双主题每次新context，内容加载且document.fonts.ready后测几何/截图。CDP要求中文实际custom Noto，混排Agent仍实际custom Geist。
3. 记录WOFF资源PerformanceResourceTiming的transfer/encoded/decoded字节、同源性；Noto独立字体响应体冷首屏预算<2MiB。小片内联在CSS，不把独立WOFF统计冒充全部页面流量。
4. 390额外阻断Noto网络请求，验证字体确实失败、中文有实际系统fallback字形、首页主操作与几何保持可用，保存截图。
5. 只有精确新CI及新截图/CDP/实际字节结果可证明本片视觉和网络通过；本地构建或旧WenQuanYi截图不替代。
