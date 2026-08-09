# ADR-008：Prompt 版本不可变

状态：接受。日期：2026-08-09。

Prompt 是稳定 identity，Version 创建后不可变，任何内容修改创建新版本。Label 是可事务移动的指针；Run 保存最终解析版本、hash 和 provenance。
