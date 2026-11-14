/* global __dirname, Buffer */
const assert = require('node:assert/strict');
const { readFileSync, statSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { test } = require('node:test');

const root = resolve(__dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const cssPath = require.resolve('@fontsource-variable/noto-sans-sc', {
  paths: [resolve(root, 'apps/web')],
});
const css = readFileSync(cssPath, 'utf8');

test('中文字体自托管，保留 Geist 优先与 Workspace 统一 token', () => {
  assert.match(read('apps/web/src/app-entry.tsx'), /import '@fontsource-variable\/noto-sans-sc';/);
  assert.match(
    read('packages/ui/src/tokens.css'),
    /'Geist Variable', 'Noto Sans SC Variable', 'PingFang SC'/,
  );
  assert.match(
    read('apps/web/src/features/workspace/workspace.module.css'),
    /font-family: var\(--ah-font-sans\);/,
  );
  assert.match(
    read('packages/ui/src/theme.ts'),
    /Geist Variable, "Noto Sans SC Variable", "PingFang SC"/,
  );
  const license = readFileSync(
    require.resolve('@fontsource-variable/noto-sans-sc/LICENSE', {
      paths: [resolve(root, 'apps/web')],
    }),
    'utf8',
  );
  assert.equal(read('apps/web/public/licenses/noto-sans-sc-OFL.txt'), license);
});

test('字体使用本地 Unicode-range 分片，无 CDN 或巨型单文件', () => {
  const faces = css.split('@font-face').slice(1);
  assert.ok(faces.length > 1, 'must retain lazy Unicode-range subsets');
  assert.ok(Buffer.byteLength(css) <= 128 * 1024, 'font CSS exceeds 128 KiB budget');
  let total = 0;
  for (const face of faces) {
    assert.match(face, /unicode-range:\s*U\+/i);
    assert.match(face, /font-display:\s*swap/);
    const source = face.match(/url\(([^)]+)\)/)?.[1];
    assert.match(source ?? '', /^\.\/files\/[a-z0-9-]+\.woff2$/);
    const bytes = statSync(resolve(dirname(cssPath), source)).size;
    assert.ok(bytes <= 100 * 1024, `${source} exceeds 100 KiB per-subset budget`);
    total += bytes;
  }
  // Deployment payload is not first-view traffic; browser requests are gated by
  // real-context E2E separately. Keep the complete multilingual font bounded.
  assert.ok(total <= 5 * 1024 * 1024, 'font deployment assets exceed 5 MiB budget');
  assert.doesNotMatch(css, /(?:https?:)?\/\//);
});
