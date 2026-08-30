# Release Truth Gate

建议新增脚本 `scripts/release/check-version-truth.ts`：

- 读取 root/apps/packages package version；
- 读取 UI build version；
- 检查 README current version；
- 检查 Docker compose image tag；
- grep current source/tests 的 v0.x residue；
- 检查 `docs/qa/visual/v1.0.0/manifest.json`；
- 检查 `docs/RELEASE-v1.0.0.md`。

任一不一致 exit 1。
