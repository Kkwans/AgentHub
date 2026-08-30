# Component Acceptance Matrix

每个共享组件必须覆盖：default / hover / active / focus / disabled / loading / error（适用时）/ dark / long label / narrow width。

## Toolbar
32/36px controls align center；不同 control 内文字 baseline ≤1px。

## EntityRow
long name 不挤掉 action；secondary metadata 可隐藏；height 不因单行/双行随机变化。

## SettingRow
label 不和 control 上下错位；mobile 改为 vertical stack。

## TreeRow
indent 每级 16px；status glyph 固定列；path 不造成横向无限增长。
