import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('installed pinned Monaco refreshes deletion zones when token events retain the same completion state', () => {
  const requireWeb = createRequire(resolve('apps/web/package.json'));
  const root = resolve(dirname(requireWeb.resolve('monaco-editor')), '../..');
  // Run the installed observable expression with Monaco's real observable/event
  // implementation. No copied substitute algorithm and no browser/DOM required.
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { pathToFileURL } from 'node:url';
    const root = ${JSON.stringify(root)};
    const load = (path) => import(pathToFileURL(root + '/esm/vs/' + path).href);
    await load('base/common/observableInternal/index.js');
    const { Emitter } = await load('base/common/event.js');
    const { observableValue } = await load('base/common/observableInternal/observables/observableValue.js');
    const { observableFromEvent } = await load('base/common/observableInternal/observables/observableFromEvent.js');
    const { autorun } = await load('base/common/observableInternal/reactions/autorun.js');
    const source = readFileSync(root + '/esm/vs/editor/browser/widget/diffEditor/components/diffEditorViewZones/diffEditorViewZones.js', 'utf8');
    const match = source.match(/const originalModelTokens = ([\\s\\S]*?);\\n        const alignments =/);
    assert.ok(match, 'Expected version-pinned token-event patch to be installed');
    assert.ok(source.includes('originalModelTokens.read(reader)'));
    const events = new Emitter();
    const original = { onDidChangeTokens: events.event, tokenization: { backgroundTokenizationState: 2 } };
    const model = observableValue('model', { model: { original } });
    const observed = new Function('observableFromEvent', 'return ' + match[1]).call({ _diffModel: model }, observableFromEvent);
    let renders = 0;
    const reaction = autorun(reader => { observed.read(reader); renders++; });
    assert.equal(renders, 1);
    events.fire({ ranges: [{ fromLineNumber: 1, toLineNumber: 2 }] });
    events.fire({ ranges: [{ fromLineNumber: 1, toLineNumber: 2 }] });
    assert.equal(renders, 3, 'same completion boolean must not swallow real token changes');
    observed.get(); observed.get();
    assert.equal(renders, 3, 'ordinary reads must not create refresh loops');
    model.set(undefined, undefined);
    const detached = renders;
    events.fire({ ranges: [] });
    assert.equal(renders, detached, 'detached model must not keep its token subscription');
    model.set({ model: { original } }, undefined);
    const attached = renders;
    events.fire({ ranges: [] });
    assert.equal(renders, attached + 1, 'replacement model must subscribe again');
    reaction.dispose();
    const disposed = renders;
    events.fire({ ranges: [] });
    assert.equal(renders, disposed);
    events.dispose();
    console.log('token update, stable read, model replacement and disposal checks passed');
  `,
    ],
    { encoding: 'utf8' },
  );
  expect(output).toContain('checks passed');
});
