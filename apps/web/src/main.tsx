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
  if (shouldShowBootstrap && canShowWorkspace(authStatus)) {
    bootstrapShell.hidden = false;
    void homeDataPromise?.then((homeData) => {
      if (!bootstrapHeading?.isConnected) return;
      const hasProjects = (homeData?.projects ?? []).some(
        (project) => (project.kind ?? 'STANDARD') === 'STANDARD',
      );
      bootstrapHeading.textContent = hasProjects ? '继续工作' : '从一个 Project 开始';
    });
  }

  const { mountApp } = await import('./app-entry');
  mountApp(appRoot);
}

void startApp();
