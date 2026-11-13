export type ScanIdentity = { theme: string; viewport: string; route: string };
export function scanKey(page: ScanIdentity): string {
  return `${page.theme}|${page.viewport}|${page.route}`;
}
export function summarizeAccessibility(
  expected: string[],
  pages: ScanIdentity[],
  violationCount: number,
  failureCount: number,
) {
  const planned = new Set(expected);
  const scanned = new Set(pages.map(scanKey));
  const missing = expected.filter((key) => !scanned.has(key));
  const complete =
    expected.length === 154 &&
    planned.size === 154 &&
    pages.length === 154 &&
    scanned.size === 154 &&
    missing.length === 0 &&
    [...scanned].every((key) => planned.has(key));
  return { missing, complete, passed: complete && violationCount === 0 && failureCount === 0 };
}
