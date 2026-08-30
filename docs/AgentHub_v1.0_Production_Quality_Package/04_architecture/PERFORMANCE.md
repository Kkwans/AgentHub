# Performance Plan

## Budgets
- route JS chunk: core page <250KB gzip target（Monaco/xterm excluded lazy chunks）
- Home LCP <2.0s local LAN reference
- interaction INP <150ms target
- Workspace 200-change tree render <100ms target after data arrival
- 500 timeline item scroll no sustained frame <40fps

## Techniques
- lazy Monaco/xterm
- memoized tree model
- list/window virtualization thresholds
- avoid all-session re-render during streaming
- CSS containment for inspector/tree where useful
