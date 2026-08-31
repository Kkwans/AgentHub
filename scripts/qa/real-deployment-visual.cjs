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
const { URL } = require('node:url');
const { measureLayout, writeAudit, isReadOnlyRequest } = require('./visual-evidence.cjs');

const baseURL = (process.env.AGENTHUB_BASE_URL || 'http://192.168.5.110:3210').replace(/\/$/, '');
const tokenFile = process.env.AGENTHUB_BROWSER_TOKEN_FILE || '';
const outputDir = path.resolve(
  process.env.AGENTHUB_VISUAL_OUTPUT || path.join('docs', 'qa', 'visual', 'latest'),
);
const waitMs = Number(process.env.AGENTHUB_VISUAL_WAIT_MS || 2_500);
const screenshotTimeoutMs = Number(process.env.AGENTHUB_VISUAL_SCREENSHOT_TIMEOUT_MS || 60_000);
const navigationTimeoutMs = Number(process.env.AGENTHUB_VISUAL_NAVIGATION_TIMEOUT_MS || 60_000);
const chromiumPath = process.env.AGENTHUB_CHROMIUM_PATH || '';
let currentReport;

if (!tokenFile) {
  throw new Error(
    'AGENTHUB_BROWSER_TOKEN_FILE is required; do not put a token in command arguments.',
  );
}

const token = fs.readFileSync(tokenFile, 'utf8').trim();
if (!token) throw new Error('browser token file is empty');
fs.mkdirSync(path.dirname(outputDir), { recursive: true });
fs.mkdirSync(outputDir); // Never overwrite a previous run's evidence.

const viewports = [
  ['1920', { width: 1920, height: 1080 }],
  ['1600', { width: 1600, height: 1000 }],
  ['1440', { width: 1440, height: 900 }],
  ['1280', { width: 1280, height: 800 }],
  ['1024', { width: 1024, height: 768 }],
  ['768', { width: 768, height: 1024 }],
  ['390', { width: 390, height: 844 }],
];

const themes = ['light', 'dark'];

function trimError(value) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 240);
}

function routeFileName(route) {
  return (
    route
      .replace(/^\//, '')
      .replace(/[^a-zA-Z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'home'
  );
}

async function waitForStable(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(waitMs);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(200);
}

async function auditPage(page) {
  return page.evaluate(measureLayout);
}

async function protectProductionContext(context) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) {
      const headers = { ...request.headers() };
      delete headers.authorization;
      return route.continue({ headers });
    }
    if (!isReadOnlyRequest(request.method(), url.pathname)) {
      if (currentReport) {
        currentReport.blockedWrites.push(`${request.method()} ${url.pathname}`);
        writeAudit(outputDir, currentReport);
      }
      return route.abort('blockedbyclient');
    }
    await route.continue({ headers: { ...request.headers(), authorization: `Bearer ${token}` } });
  });
}

async function captureAuthenticated(browser, theme, viewport, routes) {
  const context = await browser.newContext({
    viewport,
  });
  await protectProductionContext(context);
  await context.addInitScript(
    ({ apiToken, selectedTheme, origin }) => {
      if (window.location.origin !== origin) return;
      window.localStorage.setItem('agenthub-theme', selectedTheme);
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class AgentHubWebSocket extends NativeWebSocket {
        constructor(url, protocols) {
          const values = Array.isArray(protocols) ? [...protocols] : protocols ? [protocols] : [];
          if (!values.some((value) => String(value).startsWith('agenthub-token.'))) {
            if (new URL(url, window.location.href).host === window.location.host)
              values.push(`agenthub-token.${apiToken}`);
          }
          super(url, values);
        }
      };
    },
    { apiToken: token, selectedTheme: theme, origin: new URL(baseURL).origin },
  );

  const pages = [];
  const group = { theme, viewport: `${viewport.width}x${viewport.height}`, pages };
  currentReport.authenticated.push(group);
  for (const route of routes) {
    const page = await context.newPage();
    currentReport.activeSnapshot = `${theme}/${group.viewport}/${route}`;
    writeAudit(outputDir, currentReport);
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
    if (currentReport.blockedWrites.length)
      throw new Error('Production capture stopped after a blocked write request');
    await waitForStable(page);
    await page
      .locator('main, .workspace-shell')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    const layout = await auditPage(page);
    const fileName = `${theme}-${routeFileName(route)}-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({
      path: path.join(outputDir, fileName),
      fullPage: false,
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
    writeAudit(outputDir, currentReport);
    console.log(`captured ${theme} ${group.viewport} ${route}`);
    await page.close();
  }
  await context.close();
  return group;
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
      '/agents/runtime',
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
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader'],
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });
  try {
    const routeContext = await browser.newContext({
      viewport: viewports[0][1],
    });
    await protectProductionContext(routeContext);
    const authResponse = await routeContext.request.get(`${baseURL}/api/v1/auth/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!authResponse.ok() || !(await authResponse.json()).data?.authenticated)
      throw new Error('Existing browser token is not authenticated');
    const healthResponse = await routeContext.request.get(`${baseURL}/api/v1/health`);
    if (!healthResponse.ok()) throw new Error('Production health check failed');
    const serverHealth = (await healthResponse.json()).data;
    const routePage = await routeContext.newPage();
    await routeContext.addInitScript(
      ({ apiToken, origin }) => {
        if (window.location.origin !== origin) return;
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = class AgentHubWebSocket extends NativeWebSocket {
          constructor(url, protocols) {
            const values = Array.isArray(protocols) ? [...protocols] : protocols ? [protocols] : [];
            if (!values.some((value) => String(value).startsWith('agenthub-token.'))) {
              if (new URL(url, window.location.href).host === window.location.host)
                values.push(`agenthub-token.${apiToken}`);
            }
            super(url, values);
          }
        };
      },
      { apiToken: token, origin: new URL(baseURL).origin },
    );
    await routePage.goto(`${baseURL}/home`, {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs,
    });
    const discoveredRoutes = await discoverRoutes(routePage);
    const routes =
      process.env.AGENTHUB_VISUAL_SCOPE === 'baseline'
        ? discoveredRoutes.filter(
            (route) =>
              [
                '/home',
                '/projects',
                '/agents/agents',
                '/agents/runtime',
                '/agents/nodes',
                '/prompts',
                '/settings/appearance',
              ].includes(route) ||
              /^\/projects\/[^/]+\/(overview|work|sessions)$/.test(route) ||
              route.startsWith('/workspace/'),
          )
        : discoveredRoutes;
    await routeContext.close();

    const report = (currentReport = {
      source: 'production-read-only',
      scope: process.env.AGENTHUB_VISUAL_SCOPE || 'all-routes',
      complete: false,
      activeSnapshot: '',
      capturedAt: new Date().toISOString(),
      baseURL,
      serverHealth,
      sourceCommit: process.env.AGENTHUB_DEPLOYED_REVISION || 'unverified',
      routes,
      viewports: viewports.map(([, viewport]) => `${viewport.width}x${viewport.height}`),
      themes,
      unauthenticated: null,
      authenticated: [],
      blockedWrites: [],
    });
    writeAudit(outputDir, report);
    report.unauthenticated = await captureUnauthenticated(browser);
    writeAudit(outputDir, report);
    for (const theme of themes) {
      for (const [label, viewport] of viewports) {
        await captureAuthenticated(browser, theme, viewport, routes);
      }
    }
    report.complete = true;
    writeAudit(outputDir, report);
    const pages = report.authenticated.flatMap((entry) => entry.pages);
    const consoleErrorCount = pages.reduce((sum, page) => sum + page.consoleErrors.length, 0);
    const pageErrorCount = pages.reduce((sum, page) => sum + page.pageErrors.length, 0);
    const failedRequestCount = pages.reduce((sum, page) => sum + page.failedRequests.length, 0);
    const overflowCount = pages.filter((page) => page.layout.horizontalOverflow).length;
    const unnamedButtonCount = pages.reduce((sum, page) => sum + page.layout.unnamedButtons, 0);
    const hiddenFocusCount = pages.reduce(
      (sum, page) => sum + (page.layout.hiddenFocus ? 1 : 0),
      0,
    );
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
  if (currentReport) {
    currentReport.failure = trimError(error.message);
    writeAudit(outputDir, currentReport);
  }
  console.error(error?.stack || error);
  process.exitCode = 1;
});
