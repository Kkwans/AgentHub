# CSS Complexity Gate

发布目标：
- `workspace.module.css` shell <16KB。
- 单 component module <12KB recommended。
- global selectors 数量显著下降。
- no `!important` except vendor bridge documented。
- no feature override global accent semantic。

生成 `css-metrics.json` 记录 bytes/selectors/:global/!important/custom props。
