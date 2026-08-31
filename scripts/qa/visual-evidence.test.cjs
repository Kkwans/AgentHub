const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  completenessErrors,
  flattenPages,
  writeAudit,
  isReadOnlyRequest,
} = require('./visual-evidence.cjs');

test('production only allows reads and the source-audited POST computations', () => {
  assert.equal(isReadOnlyRequest('GET', '/api/v1/projects'), true);
  assert.equal(isReadOnlyRequest('POST', '/api/v1/projects/preflight'), true);
  assert.equal(
    isReadOnlyRequest('POST', '/api/v1/projects/11111111-1111-4111-8111-111111111111/preflight'),
    true,
  );
  assert.equal(isReadOnlyRequest('POST', '/api/v1/prompt-context/resolve'), true);
  for (const route of [
    '/api/v1/projects',
    '/api/v1/agents/a/preflight',
    '/api/v1/sessions/s/runs',
    '/api/v1/sessions/s/resume',
    '/api/v1/approvals/a/resolve',
    '/api/v1/projects/p/git/commit',
  ]) {
    assert.equal(isReadOnlyRequest('POST', route), false, route);
    assert.equal(isReadOnlyRequest('DELETE', route), false, route);
  }
});

const page = {
  route: '/home',
  theme: 'light',
  viewport: '1440x900',
  filename: 'home.png',
  layout: {},
};
const report = {
  complete: true,
  routes: ['/home'],
  themes: ['light'],
  viewports: ['1440x900'],
  pages: [page],
};

test('an interrupted or missing matrix cannot pass even when its captured pages have no errors', () => {
  assert.deepEqual(completenessErrors(report), []);
  assert.ok(completenessErrors({ ...report, complete: false }).includes('capture-incomplete'));
  assert.ok(
    completenessErrors({ ...report, themes: ['light', 'dark'] }).includes(
      'missing:dark/1440x900//home',
    ),
  );
  assert.ok(completenessErrors({ ...report, pages: [page, page] }).includes('duplicate-snapshot'));
  assert.ok(
    completenessErrors({
      ...report,
      pages: [{ ...page, captureError: 'renderer crashed' }],
    }).includes('capture-error:/home'),
  );
});

test('production group metadata survives flattening for theme and viewport validation', () => {
  const grouped = {
    ...report,
    pages: undefined,
    authenticated: [
      {
        theme: 'light',
        viewport: '1440x900',
        pages: [{ route: '/home', fileName: 'home.png', layout: {} }],
      },
    ],
  };
  assert.equal(flattenPages(grouped)[0].theme, 'light');
  assert.equal(flattenPages(grouped)[0].viewport, '1440x900');
  assert.deepEqual(completenessErrors(grouped), []);
});

test('each progress write leaves a readable incomplete report before completion', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-evidence-test-'));
  try {
    writeAudit(directory, { ...report, complete: false });
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directory, 'audit.json'), 'utf8')).complete,
      false,
    );
    writeAudit(directory, report);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directory, 'audit.json'), 'utf8')).complete,
      true,
    );
    assert.equal(fs.existsSync(path.join(directory, 'audit.json.tmp')), false);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
