import { describe, expect, it } from 'vitest';
import { toolFailurePreview } from './ToolUseEntry';
describe('provider supplied failure preview', () => {
  it('preserves only the supplied first nonempty line and bounds long text', () => {
    expect(toolFailurePreview('\nPermission denied\ninternal trace')).toBe('Permission denied');
    expect(toolFailurePreview('a'.repeat(200))).toHaveLength(141);
  });
  it('accepts explicit message text but does not infer an error from arbitrary JSON', () => {
    expect(toolFailurePreview('{"message":"Not found","code":2}')).toBe('Not found');
    expect(toolFailurePreview('{"code":2}')).toBe('');
    expect(toolFailurePreview('["error"]')).toBe('');
    expect(toolFailurePreview('{invalid')).toBe('');
    expect(toolFailurePreview(undefined)).toBe('');
  });
});
