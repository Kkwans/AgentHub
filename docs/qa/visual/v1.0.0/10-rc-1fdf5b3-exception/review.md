# 当前候选异常态复核

- 矩阵：login、error、offline、loading 四种入口/异常状态 × 7 视口 × light/dark，共 56 张截图。
- 自动化结果：health 为 `1.0.0`、`pglite`、web dist 可用；排除脚本明确声明的 404 与 offline 请求后，console、page error、failed request 和已测 geometry violations 均为 0。
- 当前候选运行时 commit：`1fdf5b316d8e4cdbe62528b7b088ba029fb9abe6`。
- PTY 生命周期与 approval 重连投递不由该矩阵覆盖，仍需专项真实能力证据。
