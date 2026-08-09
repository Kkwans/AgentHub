# ADR-002：模块化单体

状态：接受。日期：2026-08-09。

v0.1 使用 host-native 模块化单体与 pnpm monorepo。领域边界通过 package 与 service/repository 隔离，不引入分布式服务和消息中间件。
