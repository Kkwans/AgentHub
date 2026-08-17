#!/usr/bin/env node

/**
 * NAS-local visual gate for the real AgentHub deployment.
 *
 * This script intentionally has no remote-device or fixture mode. It reads a
 * short-lived browser token from a caller-provided file, uses it only in the
 * Playwright process, and writes screenshots plus non-sensitive diagnostics.
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

if (!tokenFile) {
  throw new Error(
    'AGENTHUB_BROWSER_TOKEN_FILE is required; do not put a token in command arguments.',
  );
}

const token = fs.readFileSync(tokenFile, 'utf8').trim();
if (!token) throw new Error('browser token file is empty');
fs.mkdirSync(outputDir, { recursive: true });

const viewports = [
  ['1440', { width: 1440, height: 1000 }],
  ['1024', { width: 1024, height: 900 }],
  ['768', { width: 768, height: 900 }],
  ['390', { width: 390, height: 844 }],
];

const routes = [
  '/overview',
  '/projects',
  '/tasks',
  '/agents',
  '/sessions',
  '/promptos',
  '/settings',
];

function trimError(value) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 240);
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
    return {
      scrollWidth,
      clientWidth,
      horizontalOverflow: scrollWidth > clientWidth + 1,
      visibleTextLength: body?.innerText?.length || 0,
    };
  });
}

async function captureUnauthenticated(browser) {
  const context = await browser.newContext({ viewport: viewports[0][1] });
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
  await page.goto(`${baseURL}/overview`, { waitUntil: 'domcontentloaded' });
  await waitForStable(page);
  await page.screenshot({ path: path.join(outputDir, '01-login-1440.png'), fullPage: true });
  return {
    route: '/overview',
    title: await page.title(),
    consoleErrors,
    pageErrors,
    failedRequests,
    layout: await auditPage(page),
  };
}

async function captureAuthenticated(browser, label, viewport) {
  const context = await browser.newContext({
    viewport,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  await context.addInitScript((apiToken) => {
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

  const pages = [];
  for (const [index, route] of routes.entries()) {
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
    await page.goto(`${baseURL}${route}`, { waitUntil: 'domcontentloaded' });
    await waitForStable(page);
    const layout = await auditPage(page);
    const fileName = `${String(index + 2).padStart(2, '0')}-${route.slice(1)}-${label}.png`;
    await page.screenshot({ path: path.join(outputDir, fileName), fullPage: true });
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
  return { viewport: label, pages };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const report = {
      capturedAt: new Date().toISOString(),
      baseURL,
      viewports: viewports.map(([label]) => label),
      unauthenticated: await captureUnauthenticated(browser),
      authenticated: [],
    };
    for (const [label, viewport] of viewports) {
      report.authenticated.push(await captureAuthenticated(browser, label, viewport));
    }
    fs.writeFileSync(path.join(outputDir, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`);
    const pages = report.authenticated.flatMap((entry) => entry.pages);
    const consoleErrorCount = pages.reduce((sum, page) => sum + page.consoleErrors.length, 0);
    const pageErrorCount = pages.reduce((sum, page) => sum + page.pageErrors.length, 0);
    const failedRequestCount = pages.reduce((sum, page) => sum + page.failedRequests.length, 0);
    const overflowCount = pages.filter((page) => page.layout.horizontalOverflow).length;
    const summary = {
      outputDir,
      viewports: report.viewports,
      consoleErrorCount,
      pageErrorCount,
      failedRequestCount,
      overflowCount,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (consoleErrorCount || pageErrorCount || failedRequestCount || overflowCount)
      process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
