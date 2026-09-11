/** Minimal preview formatter required by the copied PinHarness read panel. */
export function formatPreviewContent(content: string, format: 'json' | 'plain' | string): string {
  if (format !== 'json') return content;
  try {
    return JSON.stringify(JSON.parse(content), null, 2) ?? content;
  } catch {
    return content;
  }
}
