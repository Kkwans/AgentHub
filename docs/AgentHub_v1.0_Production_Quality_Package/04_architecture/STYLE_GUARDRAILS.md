# Style Guardrails

建议 CI 添加静态检查：
- CSS module >25KB warning，>40KB fail（migration whitelist 临时）。
- React page >600 lines warning。
- `eslint-disable @typescript-eslint/no-unused-vars` in feature pages fail。
- feature CSS 定义 `--ah-accent-*` fail。
- px 值非 4-grid allowlist warning（1px border、font sizes、optical exceptions 除外）。
- `min-height:2xx` on card/hero requires allowlist。
