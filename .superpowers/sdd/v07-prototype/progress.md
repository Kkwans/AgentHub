# SDD ledger — plan: user-requested AgentHub v0.7 prototype fidelity

## Preflight scan

| Task | Scope | Shared interface/file | Finding | Ruling |
|---|---|---|---|---|
| 1 | Prototype inventory and route mapping | `08_prototype/*` and v07 routes | Prototype HTML is structural/visual authority for this Goal; production APIs remain authoritative for data | Use prototype DOM/CSS semantics without copying its mock data or weakening API contracts |
| 2 | AppShell and global navigation | `AppShell.tsx`, `AppShell.module.css`, `@agenthub/ui` theme context | Shell is shared by every screen and must land before page fidelity work | Preserve command palette/realtime behavior; replace shell composition only |
| 3 | Home screen | `features/v07/pages.tsx`, new Home CSS module | Home consumes shell and existing dashboard/project queries | Keep real values; hide unavailable prototype-only metadata instead of inventing it |
| 4 | Remaining screens | feature pages and scoped CSS modules | Pages are coupled through route/context but can be migrated route-by-route | Do not delete old consumers until route-level visual gates pass |
| 5 | QA and release | Playwright, build, lint, test, deployment | Existing runtime is a baseline, not acceptance for the new prototype fidelity | Re-capture real NAS Chromium screenshots after each major slice; do not claim completion from static checks |

## Rulings

- Ruling: User's explicit request overrides the handoff package's older source priority for this Goal — because the requested outcome is faithful reproduction of the supplied prototype HTML; cost is that any stale prototype behavior must still be checked against real backend contracts.
- Ruling: First implementation slice is limited to shared shell plus Home — because broad simultaneous edits would make visual regressions untraceable; remaining screens follow after a fresh screenshot checkpoint.

## Tasks

- Task 1: completed — prototype inventory and route mapping are recorded in `prototype-route-map.md`.
- Task 2: completed — AppShell, navigation, token bridge, Mantine Provider, and theme runtime are implemented.
- Task 3: completed — Home, Projects, Project Context, Agent Center, Prompt Library, Settings, and Workspace compositions are implemented against the prototype structure.
- Task 4: completed — real backend states are wired, Settings preferences persist through the provider, Workspace Monaco is lazy, and the NAS route matrix has passed.
- Task 5: completed — full lint, full unit test suite, real Codex live gates, typecheck/build, and NAS visual evidence are recorded; remaining delivery action is exact commit/push scope review.
