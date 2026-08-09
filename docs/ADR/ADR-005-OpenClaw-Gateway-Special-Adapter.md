# ADR-005：OpenClaw 特殊适配

状态：接受。日期：2026-08-09。

OpenClaw 优先使用官方 `openclaw acp` Gateway bridge，不支持时回退到 `openclaw agent exec` 单回合能力。直接 Gateway SDK 延后，能力差异必须显式呈现。
