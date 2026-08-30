# Dark Mode

Dark 不等于把所有 surface 变成纯黑。

- canvas #0b0d13 范围
- surface 与 canvas 至少有可辨 luminance 差
- border 比 light 稍强
- shadow 减弱，tonal separation 增强
- diff green/red 需满足可读性，不使用高饱和背景
- Monaco/xterm 必须跟随 theme

每个 visual baseline 同时截 light/dark。
