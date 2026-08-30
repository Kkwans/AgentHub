# Geometry Gates

Playwright 使用 `boundingBox()` 检查：

- page header/content left edge diff ≤2px
- table header/body columns diff ≤1px
- toolbar control centerY diff ≤1px
- metric tiles height identical
- workspace topbar/panel header boundaries aligned
- composer left/right edge 与 conversation readable column aligned
- drawer width within contract

将这些变成测试，而不是肉眼希望“差不多”。
