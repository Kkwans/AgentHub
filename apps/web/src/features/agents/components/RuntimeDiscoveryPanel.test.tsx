import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Runtime discovery settings surface', () => {
  it('keeps runtime management discoverable without manual container fields', () => {
    const source = readFileSync(new URL('./RuntimeDiscoveryPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain("'/discovery/runtimes'");
    expect(source).toContain("'/discovery/agents'");
    expect(source).toContain('data-testid="runtime-discovery-panel"');
    expect(source).toContain('Settings → Runtime');
    expect(source).toContain('重新扫描');
    expect(source).toContain('DOCKER_INSPECT_FAILED');
    expect(source).not.toContain('expectedContainerId');
    expect(source).not.toContain('name="containerId"');
    expect(source).not.toContain('name="hostname"');
    expect(source).not.toContain('name="executable"');
  });

  it('does not render every Docker container while Agent discovery is pending', () => {
    const source = readFileSync(new URL('./RuntimeDiscoveryPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('if (!agents.isSuccess)');
    expect(source).toContain(
      "runtime.kind === 'LOCAL_HOST' || Boolean(runtime.targetId)",
    );
  });

  it('is mounted from Settings as the primary Runtime management entry', () => {
    const settingsSource = readFileSync(
      new URL('../../settings/pages/SettingsPageView.tsx', import.meta.url),
      'utf8',
    );
    expect(settingsSource).toContain("RuntimeDiscoveryPanel");
    expect(settingsSource).toContain('<RuntimeDiscoveryPanel />');
  });
});
