type AuthStatus = {
  mode?: string;
  authenticated?: boolean;
};

type HomeData = {
  projects?: Array<{ kind?: string }>;
};

type BootstrapWindow = Window & {
  __agenthubAuthStatusPromise?: Promise<AuthStatus>;
  __agenthubHomeDataPromise?: Promise<HomeData | undefined>;
};

const root = document.getElementById('root');
if (!root) throw new Error('缺少应用根节点');
const appRoot: HTMLElement = root;

const bootstrapShell = document.createElement('main');
bootstrapShell.id = 'agenthub-bootstrap-shell';
bootstrapShell.hidden = true;
bootstrapShell.setAttribute('aria-busy', 'true');
bootstrapShell.setAttribute('aria-label', '正在连接 AgentHub');
bootstrapShell.innerHTML = `
  <section>
    <span>WORKSPACE</span>
    <h1>继续工作</h1>
    <p>正在汇总 Project、Session 与 Agent 状态。</p>
  </section>
`;
appRoot.replaceChildren(bootstrapShell);

const authStatusPromise = (window as BootstrapWindow).__agenthubAuthStatusPromise;
const homeDataPromise = (window as BootstrapWindow).__agenthubHomeDataPromise;
const bootstrapHeading = bootstrapShell.querySelector('h1');
const shouldShowBootstrap =
  window.location.pathname === '/' || window.location.pathname === '/home';
// Fetch the application entry in parallel with the auth/data preloads. The
// entry is still mounted only after auth resolves, so unauthenticated routes
// never render the protected application shell; this only removes idle time
// before the first authenticated Home render.
const appEntryPromise = import('./app-entry');

function canShowWorkspace(status: AuthStatus | undefined): boolean {
  return Boolean(
    status?.mode === 'local_trusted' || (status?.mode === 'token' && status.authenticated),
  );
}

async function startApp() {
  let authStatus: AuthStatus | undefined;
  if (authStatusPromise) {
    try {
      authStatus = await authStatusPromise;
    } catch {
      // AccessGate owns the user-facing unavailable state after the app mounts.
    }
  }
  const showWorkspaceBootstrap = shouldShowBootstrap && canShowWorkspace(authStatus);
  if (showWorkspaceBootstrap) {
    bootstrapShell.hidden = false;
    void homeDataPromise?.then((homeData) => {
      if (!bootstrapHeading?.isConnected) return;
      const hasProjects = (homeData?.projects ?? []).some(
        (project) => (project.kind ?? 'STANDARD') === 'STANDARD',
      );
      bootstrapHeading.textContent = hasProjects ? '继续工作' : '从一个 Project 开始';
    });
    // Keep the bootstrap shell visible while the preloaded Home snapshot
    // settles, then mount React with initial query data already available.
    // This avoids replacing a painted loading heading with the final hero
    // heading after the LCP window on a slower NAS.
    await homeDataPromise?.catch(() => undefined);
  }

  const { mountApp } = await appEntryPromise;
  mountApp(appRoot);
}

void startApp();
