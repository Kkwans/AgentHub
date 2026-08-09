# ADR-001：TypeScript First

状态：接受。日期：2026-08-09。

AgentHub 的 Server、Web、CLI 与共享包使用 TypeScript 严格模式，实现跨层契约复用和统一工具链。原生依赖仅在缺少可替代能力时采用，并必须可降级。
