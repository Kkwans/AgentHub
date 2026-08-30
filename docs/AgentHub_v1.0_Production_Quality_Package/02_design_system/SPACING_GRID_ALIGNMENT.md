# Spacing / Grid / Alignment

## 4px baseline
所有 padding/gap/height 优先使用 4 的倍数。

## 对齐优先级
1. Page left edge
2. Section title left edge
3. Surface content left edge
4. Row identity left edge
5. Form label baseline

## Grid rule
- sibling surfaces 同高时误差 0–1px。
- toolbar control vertical center 误差 ≤1px。
- icon optical alignment允许视觉补偿，但 box alignment 必须相同。

## 禁止
- `17px/19px/23px` 作为随意 padding；
- 同一类 Card 一会 13px radius 一会 16px；
- 使用 absolute positioning 维护业务布局；
- 为了“平衡”把内容强拉到两端。
