#!/usr/bin/env node

/**
 * NAS-local visual gate for the real AgentHub deployment.
 *
 * The caller supplies a short-lived browser token via a file. The token is
 * read only in this process and never written to reports or screenshots.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const baseURL = (process.env.AGENTHUB_BASE_URL || 'http://127.0.0.1:3210').replace(/\/$/, '');
const tokenFile = process.env.AGENTHUB_BROWSER_TOKEN_FILE || '';
const outputDir = path.resolve(
  process.env.AGENTHUB_VISUAL_OUTPUT || path.join('docs', 'qa', 'visual', 'latest'),
);
const waitMs = Number(process.env.AGENTHUB_VISUAL_WAIT_MS || 2_500);
const screenshotTimeoutMs = Number(process.env.AGENTHUB_VISUAL_SCREENSHOT_TIMEOUT_MS || 60_000);
const navigationTimeoutMs = Number(process.env.AGENTHUB_VISUAL_NAVIGATION_TIMEOUT_MS || 60_000);

if (!tokenFile) {
  throw new Error(
    'AGENTHUB_BROWSER_TOKEN_FILE is required; do not put a token in command arguments.',
  );
}

const token = fs.readFileSync(tokenFile, 'utf8').trim();
if (!token) throw new Error('browser token file is empty');
fs.mkdirSync(outputDir, { recursive: true });

const viewports = [
  ['1600', { width: 1600, height: 1000 }],
  ['1440', { width: 1440, height: 1024 }],
  ['1024', { width: 1024, height: 900 }],
  ['768', { width: 768, height: 900 }],
  ['390', { width: 390, height: 844 }],
];

const themes = ['light', 'dark'];

function trimError(value) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 240);
}

function routeFileName(route) {
  return route
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-|-$/g, '') || 'home';
}

async function waitForStable(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(waitMs);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(200);
}

async function auditPage(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0);
    const clientWidth = root?.clientWidth || 0;
    const unnamedButtons = [...document.querySelectorAll('button')].filter((button) => {
      // Controls explicitly removed from the accessibility tree (for example,
      // Mantine's input clear affordance) are implementation details, not
      // user-facing unnamed actions.
      if (button.getAttribute('aria-hidden') === 'true') return false;
      return (
        !button.getAttribute('aria-label') &&
        !button.getAttribute('aria-labelledby') &&
        !button.getAttribute('title') &&
        !(button.textContent || '').trim()
      );
    }).length;
    const hiddenFocus = [...document.querySelectorAll(':focus-visible')].some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width === 0 || rect.height === 0;
    });
    return {
      scrollWidth,
      clientWidth,
      horizontalOverflow: scrollWidth > clientWidth + 1,
      unnamedButtons,
      hiddenFocus,
      visibleTextLength: body?.innerText?.length || 0,
      resolvedTheme: document.documentElement.dataset.agenthubTheme || 'unknown',
    };
  });
}

async function captureAuthenticated(browser, theme, viewport, routes) {
  const context = await browser.newContext({
    viewport,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  await context.addInitScript(({ apiToken, selectedTheme }) => {
    window.localStorage.setItem('agenthub-theme', selectedTheme);
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class AgentHubWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        const values = Array.isArray(protocols) ? [...protocols] : protocols ? [protocols] : [];
        if (!values.some((value) => String(value).startsWith('agenthub-token.'))) {
          values.push(`agenthub-token.${apiToken}`);
        }
        super(url, values);
      }
    };
  }, { apiToken: token, selectedTheme: theme });

  const pages = [];
  for (const route of routes) {
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(trimError(message.text()));
    });
    page.on('pageerror', (error) => pageErrors.push(trimError(error.message)));
    page.on('requestfailed', (request) =>
      failedRequests.push(trimError(`${request.method()} ${request.url()}`)),
    );
    await page.goto(`${baseURL}${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs,
    });
    await waitForStable(page);
    const layout = await auditPage(page);
    const fileName = `${theme}-${routeFileName(route)}-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({
      path: path.join(outputDir, fileName),
      fullPage: true,
      timeout: screenshotTimeoutMs,
    });
    pages.push({
      route,
      fileName,
      title: await page.title(),
      consoleErrors,
      pageErrors,
      failedRequests,
      layout,
    });
    await page.close();
  }
  await context.close();
  return { theme, viewport: `${viewport.width}x${viewport.height}`, pages };
}

async function discoverRoutes(page) {
  return page.evaluate(async () => {
    async function read(pathname) {
      const response = await fetch(pathname);
      if (!response.ok) return [];
      const envelope = await response.json();
      return envelope.data ?? [];
    }
    const [projects, sessions] = await Promise.all([
      read('/api/v1/projects'),
      read('/api/v1/sessions'),
    ]);
    const routes = [
      '/home',
      '/projects',
      '/projects/new',
      '/agents/agents',
      '/agents/agents/discover',
      '/agents/runtimes',
      '/agents/nodes',
      '/agents/nodes/register',
      '/agents/diagnostics',
      '/prompts',
      '/settings/appearance',
      '/settings/account',
      '/settings/security',
      '/settings/integrations',
      '/settings/system',
    ];
    const project = projects[0];
    if (project?.id) {
      routes.push(
        `/projects/${project.id}/overview`,
        `/projects/${project.id}/work`,
        `/projects/${project.id}/work/new`,
        `/projects/${project.id}/sessions`,
        `/projects/${project.id}/prompts`,
        `/projects/${project.id}/settings`,
      );
    }
    if (sessions[0]?.id) routes.push(`/workspace/${sessions[0].id}`);
    return routes;
  });
}

async function captureUnauthenticated(browser) {
  const [baselineLabel, baselineViewport] = viewports[0];
  const context = await browser.newContext({ viewport: baselineViewport });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(trimError(message.text()));
  });
  page.on('pageerror', (error) => pageErrors.push(trimError(error.message)));
  page.on('requestfailed', (request) =>
    failedRequests.push(trimError(`${request.method()} ${request.url()}`)),
  );
  await page.goto(`${baseURL}/overview`, {
    waitUntil: 'domcontentloaded',
    timeout: navigationTimeoutMs,
  });
  await waitForStable(page);
  await page.screenshot({
    path: path.join(outputDir, `login-${baselineLabel}x${baselineViewport.height}.png`),
    fullPage: true,
  });
  const title = await page.title();
  const layout = await auditPage(page);
  await context.close();
  return {
    route: '/overview',
    title,
    consoleErrors,
    pageErrors,
    failedRequests,
    layout,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const routeContext = await browser.newContext({
      viewport: viewports[0][1],
      extraHTTPHeaders: { authorization: `Bearer ${token}` },
    });
    const routePage = await routeContext.newPage();
    await routeContext.addInitScript((apiToken) => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class AgentHubWebSocket extends NativeWebSocket {
        constructor(url, protocols) {
          const values = Array.isArray(protocols) ? [...protocols] : protocols ? [protocols] : [];
          if (!values.some((value) => String(value).startsWith('agenthub-token.'))) {
            values.push(`agenthub-token.${apiToken}`);
          }
          super(url, values);
        }
      };
    }, token);
    await routePage.goto(`${baseURL}/home`, {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs,
    });
    const routes = await discoverRoutes(routePage);
    await routeContext.close();

    const report = {
      capturedAt: new Date().toISOString(),
      baseURL,
      routes,
      viewports: viewports.map(([label]) => label),
      themes,
      unauthenticated: await captureUnauthenticated(browser),
      authenticated: [],
    };
    for (const theme of themes) {
      for (const [label, viewport] of viewports) {
        report.authenticated.push(await captureAuthenticated(browser, theme, viewport, routes));
      }
    }
    fs.writeFileSync(path.join(outputDir, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`);
    const pages = report.authenticated.flatMap((entry) => entry.pages);
    const consoleErrorCount = pages.reduce((sum, page) => sum + page.consoleErrors.length, 0);
    const pageErrorCount = pages.reduce((sum, page) => sum + page.pageErrors.length, 0);
    const failedRequestCount = pages.reduce((sum, page) => sum + page.failedRequests.length, 0);
    const overflowCount = pages.filter((page) => page.layout.horizontalOverflow).length;
    const unnamedButtonCount = pages.reduce((sum, page) => sum + page.layout.unnamedButtons, 0);
    const hiddenFocusCount = pages.reduce((sum, page) => sum + (page.layout.hiddenFocus ? 1 : 0), 0);
    const summary = {
      outputDir,
      routes,
      themes,
      viewports: report.viewports,
      consoleErrorCount,
      pageErrorCount,
      failedRequestCount,
      overflowCount,
      unnamedButtonCount,
      hiddenFocusCount,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (
      consoleErrorCount ||
      pageErrorCount ||
      failedRequestCount ||
      overflowCount ||
      unnamedButtonCount ||
      hiddenFocusCount
    ) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
