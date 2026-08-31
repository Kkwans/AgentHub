const fs = require('node:fs');
const path = require('node:path');

// Executed in the browser; keep this function free of Node/module references.
function measureLayout() {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    );
  };
  const box = (element) => {
    if (!element || !visible(element)) return null;
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  };
  const checks = [];
  const frames = [...document.querySelectorAll('.ah-page-frame')].filter(visible);
  for (const frame of frames) {
    const header = frame.querySelector('.ah-screen-header');
    const content = header?.nextElementSibling;
    const left = box(header);
    const right = box(content);
    if (left && right)
      checks.push({ rule: 'header-content-left', actual: Math.abs(left.x - right.x), maximum: 2 });
  }
  for (const toolbar of document.querySelectorAll('[role="toolbar"], .ah-screen-header-actions')) {
    const boxes = [...toolbar.querySelectorAll('button, input, select')].filter(visible).map(box);
    if (boxes.length < 2) continue;
    const centers = boxes.map((rect) => rect.y + rect.height / 2);
    // Wrapping toolbars are measured row by row by the feature gate, not as one row.
    if (
      Math.max(...centers) - Math.min(...centers) <
      Math.min(...boxes.map((rect) => rect.height))
    ) {
      checks.push({
        rule: 'toolbar-center',
        actual: Math.max(...centers) - Math.min(...centers),
        maximum: 1,
      });
    }
  }
  const controls = [...document.querySelectorAll('button, input, select, textarea, [role="tab"]')]
    .filter(visible)
    .filter((element) => element.getAttribute('aria-hidden') !== 'true')
    .map((element) => ({
      tag: element.tagName,
      role: element.getAttribute('role'),
      ...box(element),
    }));
  const root = document.documentElement;
  const scrollWidth = Math.max(root.scrollWidth, document.body.scrollWidth);
  return {
    scrollWidth,
    clientWidth: root.clientWidth,
    horizontalOverflow: scrollWidth > root.clientWidth + 1,
    unnamedButtons: [...document.querySelectorAll('button')].filter(
      (button) =>
        visible(button) &&
        button.getAttribute('aria-hidden') !== 'true' &&
        !button.getAttribute('aria-label') &&
        !button.getAttribute('aria-labelledby') &&
        !button.getAttribute('title') &&
        !(button.textContent || '').trim(),
    ).length,
    hiddenFocus: [...document.querySelectorAll(':focus-visible')].some(
      (element) => !visible(element),
    ),
    resolvedTheme: root.dataset.agenthubTheme || 'unknown',
    geometry: {
      checks,
      controls,
      workspace: Object.fromEntries(
        ['workspace-contextbar', 'session-rail-panel', 'conversation-panel', 'inspector-panel'].map(
          (name) => [name, box(document.querySelector(`.${name}`))],
        ),
      ),
      // These need state-specific feature assertions and must never silently pass.
      unmeasured: [
        'table-column-alignment',
        'state-frame-shift',
        'composer-readable-column',
        'drawer-width',
      ],
    },
  };
}

function writeAudit(outputDir, report) {
  const temporary = path.join(outputDir, 'audit.json.tmp');
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, path.join(outputDir, 'audit.json'));
}

function flattenPages(report) {
  if (Array.isArray(report.pages)) return report.pages;
  return (report.authenticated || []).flatMap((entry) =>
    (entry.pages || []).map((page) => ({ ...page, theme: entry.theme, viewport: entry.viewport })),
  );
}

function completenessErrors(report) {
  const errors = [];
  const pages = flattenPages(report);
  if (report.complete !== true) errors.push('capture-incomplete');
  if (!report.routes?.length || !report.themes?.length || !report.viewports?.length)
    errors.push('matrix-missing');
  const keys = pages.map((page) => `${page.theme}/${page.viewport}/${page.route}`);
  if (new Set(keys).size !== keys.length) errors.push('duplicate-snapshot');
  for (const theme of report.themes || []) {
    for (const viewport of report.viewports || []) {
      for (const route of report.routes || []) {
        if (!keys.includes(`${theme}/${viewport}/${route}`))
          errors.push(`missing:${theme}/${viewport}/${route}`);
      }
    }
  }
  for (const page of pages) {
    if (!page.layout || !(page.filename || page.fileName)) errors.push('snapshot-evidence-missing');
    if (page.captureError) errors.push(`capture-error:${page.route}`);
  }
  return errors;
}

function isReadOnlyRequest(method, pathname) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  // Source-audited computation and filesystem inspection endpoints, despite using POST.
  return (
    method === 'POST' &&
    (pathname === '/api/v1/prompt-context/resolve' ||
      pathname === '/api/v1/projects/preflight' ||
      /^\/api\/v1\/projects\/[0-9a-f-]{36}\/preflight$/.test(pathname))
  );
}

module.exports = { measureLayout, writeAudit, flattenPages, completenessErrors, isReadOnlyRequest };
