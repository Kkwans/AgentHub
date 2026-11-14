# Opt-in live validation

Default test runs and test discovery do not launch providers, read credentials, or operate containers. `AGENTHUB_E2E_LIVE=1` alone is deliberately insufficient. Missing or invalid explicit selection is a configuration error, not a passed integration.

## Selection

- `AGENTHUB_LIVE_PROVIDER`: exactly `CODEX`, `CLAUDE_CODE`, `OPENCODE`, `HERMES`, or `OPENCLAW`.
- `AGENTHUB_LIVE_SUITE`: exactly `preflight`, `codex-session`, `discovery`, `remote-node`, or `worktree`.
- Only `preflight` accepts all five kinds. This is a reusable configuration contract, **not evidence that five providers were run or work**.
- No actual provider run is performed as part of this change's fixture validation.

## Isolated local protocol probe

`preflight` requires an absolute `AGENTHUB_LIVE_EXECUTABLE`. Optional `AGENTHUB_LIVE_ARGS_JSON` accepts only the protocol selectors `acp`, `--acp`, and `--stdio` (at most three). Arbitrary arguments and credentials in argv are rejected. There is no package installation, shell expansion, fallback executable, or automatic rerun.

The probe creates disposable HOME/config/cache and working directories and starts with `inheritEnv:false`. It does not consume a credential path or inherit host API keys, provider state, or login sessions. It performs ACP initialize, not session/new, prompts, tool calls, authentication or sign-in. Success requires process/initialize PASS, session SKIP and strict process cleanup. This is **local protocol-only** evidence, not the product's Docker/Remote integration, authenticated model availability, cancellation, or task acceptance. Unknown cleanup preserves the directory and fails with a fixed public diagnostic without raw causes.

Prepare explicit executable/suite/provider values only after authorizing a real invocation; do not use this as a routine unit test. Safe validation commands:

```sh
AGENTHUB_E2E_LIVE=0 corepack pnpm exec vitest run tests/regression/live-contract.test.ts
AGENTHUB_E2E_LIVE=0 corepack pnpm exec vitest list --config vitest.live.config.ts
AGENTHUB_E2E_LIVE=0 corepack pnpm exec vitest run --config vitest.live.config.ts
```

## Legacy Codex lifecycle suites

The other four scopes require provider CODEX, an explicit absolute `AGENTHUB_LIVE_CREDENTIAL_PATH` and separate `AGENTHUB_LIVE_ALLOW_LEGACY_ENV=1`. The path is referenced by symlink only, never read or copied by the harness. There is no default user path. These existing suites are **not environment-isolated**: they intentionally retain provider environment behavior. Do not invoke them with unrelated credentials or production configuration. Their fixture server environment explicitly clears `DATABASE_URL` to prevent touching an inherited persistent database.

These suites may perform real billed model turns, tool operations inside disposable test repositories, and approvals. They are not enabled by selecting another provider or the isolated protocol probe. Cancellation requires a `run.cancelled` event for the requested run; successful notification, random run ID, close, completion, or an event for another run cannot pass cancellation. The accompanying adapter change makes returned Session handle close propagate unconfirmed termination. Failures before a Session handle is returned remain a separate lifecycle limitation; the harness conservatively retains their directories and does not claim full resource isolation or cleanup. All legacy test and setup/teardown callback failures cross a fixed-message, no-cause reporting boundary: failures stay failures, while raw provider reports/events/subprocess errors are withheld. Unknown cleanup retains disposable directories.

Machine-specific probes that started/stopped pre-existing Claude/Hermes/OpenClaw containers and the OpenCode missing-binary pseudo-pass have been removed. Historical observations in other documentation are not current execution evidence.
