# Monaco 0.56.0 inline Diff token update patch

## Observed failure

Commit `b12b8fc` CI run `43558415448`, job `132336417393`, passed only after retries: the mobile TSX test failed on its initial attempt and first retry. In the saved trace, the normal original editor eventually rendered `'idle'` as `mtk6`, while its visible inline deletion copy remained `mtk1 char-delete` with `rgb(212, 212, 212)`, rather than the configured string color `rgb(244, 199, 175)`.

Preloading the grammar before mounting did **not** reliably fix this. The preloader remains useful for initial language readiness; it is not the correctness fix for stale deletion zones.

## Narrow source correction

The installed `esm/vs/editor/browser/widget/diffEditor/components/diffEditorViewZones/diffEditorViewZones.js` observes `original.onDidChangeTokens`, but maps each event to `backgroundTokenizationState === Completed`. Monaco's `observableFromEvent` uses strict equality. Consequently, real token updates that leave this boolean unchanged do not invalidate the cached inline deletion DOM.

The version-pinned patch maps those events to a per-model monotonically increasing revision instead. The value is computed by the event observable, not by rendering. Ordinary subscribed reads remain cached; model replacement and disposal retain Monaco's existing subscription lifecycle. Only inline deleted-line rendering reads this dependency. No syntax token colors, CSS selectors, diff algorithm, model text or public API is changed. Only the ESM build used by this app is patched, not Monaco's separate minified distribution.

Tradeoff: inline deletion zones may rebuild on each actual original-token event rather than only on completion-state transitions. Large diffs still require performance measurement; this patch is not evidence of a performance improvement.

## Verification and maintenance

- `tests/regression/monaco-inline-tokens.test.ts` evaluates the installed patched observable expression with Monaco's real event/observable implementation. It checks same-state token updates, stable reads, model replacement and disposal without substituting a copied implementation.
- `pnpm install --frozen-lockfile` verifies the pinned patch hash and dependency graph.
- The existing visible dark CSS/TSX browser assertions remain unchanged. CI additionally runs both mobile tests three times with `--retries=0`; artifacts go to `token-test-results/`. A retry-based overall success no longer suffices for this gate.
- Browser verification remains required. The source regression does not prove real rendered colors or accessibility contrast.
- On Monaco upgrades, review the upstream implementation and remove this patch only after the zero-retry repeated browser gate passes without it. Do not silently port a patch across versions or keep unused patches.
