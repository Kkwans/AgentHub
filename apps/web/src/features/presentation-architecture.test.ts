import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('.', import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, root), 'utf8');

describe('presentation architecture boundaries', () => {
  it('keeps production pages in domain-owned feature directories', () => {
    expect(existsSync(new URL('./v07', root))).toBe(false);
    expect(existsSync(new URL('./v08', root))).toBe(false);
    expect(existsSync(new URL('./v09', root))).toBe(false);
    expect(existsSync(new URL('./surface.module.css', root))).toBe(false);
    for (const domain of ['home', 'projects', 'agents', 'promptos', 'settings', 'workspace']) {
      const domainRoot = new URL(`./${domain}/`, root);
      expect(existsSync(domainRoot)).toBe(true);
      const names = readdirSync(domainRoot, { recursive: true }).map(String).join('\n');
      expect(names).not.toMatch(/(?:V\d+|v\d+|final-fix|override).*\.css/);
    }
  });

  it('routes directly to domain pages and does not depend on the old pages tree', () => {
    const app = read('../App.tsx');
    expect(app).not.toContain('features/v07');
    expect(app).not.toContain('V07AppShell');
    expect(app).toContain('./features/workspace/pages/WorkspacePage');
    expect(app).toContain('./features/home/pages/HomePage');
    expect(app).toContain('./features/projects/pages/ProjectsPage');
    for (const path of [
      '../pages/WorkspacePage.tsx',
      '../pages/PromptOsPage.tsx',
      '../pages/RemoteNodesPanel.tsx',
    ]) {
      expect(existsSync(new URL(path, root))).toBe(false);
    }
  });

  it('keeps Workspace route data ownership separate from display panels', () => {
    const route = read('./workspace/pages/WorkspacePage.tsx');
    const view = read('./workspace/pages/WorkspaceView.tsx');
    expect(view).toContain("from '../components/Conversation'");
    expect(view).toContain("from '../components/Composer'");
    expect(route).toContain('fetchSessionEventPages');
    for (const panel of [
      'Conversation',
      'Composer',
      'FileInspector',
      'GitChangesTree',
      'DiffViewer',
      'ActivityPanel',
      'RunPanel',
      'SessionRail',
      'WorkspaceInspector',
    ]) {
      const path =
        panel === 'Conversation'
          ? './workspace/components/Conversation.tsx'
          : panel === 'Composer'
            ? './workspace/components/Composer.tsx'
            : panel === 'FileInspector'
              ? './workspace/components/FileInspector.tsx'
              : `./workspace/components/${panel}.tsx`;
      expect(read(path)).not.toMatch(/\bapi\s*\./);
      // Display components may consume shared API *types*; they must not import
      // the runtime client or call it directly. Type-only imports are erased by
      // the compiler and keep the route/container as the data owner.
      const source = read(path).replace(
        /import\s+type[\s\S]*?from ['"]\.\.\/\.\.\/\.\.\/lib\/api['"];?/g,
        '',
      );
      expect(source).not.toContain("from '../../../lib/api'");
    }
  });

  it('does not allow cross-owner global CSS selectors or page god files', () => {
    const sourceRoot = join(new URL('.', root).pathname);
    const files = readdirSync(sourceRoot, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'));
    for (const file of files) {
      const text = readFileSync(join(sourceRoot, file), 'utf8');
      expect(text).not.toMatch(/features\/v\d+/);
      expect(text).not.toMatch(/:global\([^)]*\.(?:home|projects|workspace|prompt)/);
    }
    expect(existsSync(new URL('./workspace/components/WorkspaceSections.tsx', root))).toBe(false);
  });
});
