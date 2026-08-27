import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { AhLoadingState } from '@agenthub/ui';
import { useQuery } from '@tanstack/react-query';

import { AccessGate } from './components/AccessGate';
import { AppShell as V07AppShell } from './app/shell/AppShell';
import type { SessionRecord } from './lib/api';
import { api } from './lib/api';

const HomePage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.HomePageV07 })),
);
const ProjectsPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.ProjectsPageV07 })),
);
const CreateProjectPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.CreateProjectPageV07 })),
);
const ProjectContextLayout = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.ProjectContextLayoutV07 })),
);
const ProjectOverviewPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.ProjectOverviewPageV07 })),
);
const ProjectWorkPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.ProjectWorkPageV07 })),
);
const NewWorkPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.NewWorkPageV07 })),
);
const ProjectSessionsPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.ProjectSessionsPageV07 })),
);
const AgentCenterPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.AgentCenterPageV07 })),
);
const DiscoverAgentsPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.DiscoverAgentsPageV07 })),
);
const PromptLibraryPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.PromptLibraryPageV07 })),
);
const SettingsPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.SettingsPageV07 })),
);
const WorkspacePage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.WorkspacePageV07 })),
);
const InfrastructurePage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.InfrastructurePageV07 })),
);
const RemoteNodeRegistrationPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({
    default: module.RemoteNodeRegistrationPageV07,
  })),
);
const RemoteNodeDetailPage = lazy(() =>
  import('./features/v07/pages').then((module) => ({ default: module.RemoteNodeDetailPageV07 })),
);

function DeferredPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AhLoadingState label="正在加载页面" />}>{children}</Suspense>;
}

function TasksRedirect() {
  const [params] = useSearchParams();
  const projectId = params.get('projectId');
  return <Navigate replace to={projectId ? `/projects/${projectId}/work` : '/projects'} />;
}

function SessionsRedirect() {
  const [params] = useSearchParams();
  const projectId = params.get('projectId');
  return <Navigate replace to={projectId ? `/projects/${projectId}/sessions` : '/projects'} />;
}

function WorkspaceCompatRedirect() {
  const { id } = useParams();
  return <Navigate replace to={id ? `/workspace/${id}` : '/home'} />;
}

function ProjectPromptsRedirect() {
  const { projectId } = useParams();
  return (
    <Navigate
      replace
      to={
        projectId ? `/prompts?projectId=${encodeURIComponent(projectId)}&tab=bindings` : '/prompts'
      }
    />
  );
}

function ProjectSettingsRedirect() {
  const { projectId } = useParams();
  return (
    <Navigate
      replace
      to={projectId ? `/projects/${projectId}/overview?panel=settings` : '/projects'}
    />
  );
}

function WorkspaceLandingRoute() {
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionRecord[]>('/sessions'),
  });
  if (sessions.isLoading) return <AhLoadingState label="正在打开最近工作区" />;
  if (sessions.error) return <Navigate replace to="/projects" />;
  const latest = [...(sessions.data ?? [])].sort((left, right) => {
    const rightTime = Date.parse(right.lastActiveAt);
    const leftTime = Date.parse(left.lastActiveAt);
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  })[0];
  return <Navigate replace to={latest ? `/workspace/${latest.id}` : '/projects'} />;
}

export function App() {
  return (
    <AccessGate>
      <Routes>
        <Route path="workspace" element={<WorkspaceLandingRoute />} />
        <Route
          path="workspace/:sessionId"
          element={
            <DeferredPage>
              <WorkspacePage />
            </DeferredPage>
          }
        />
        <Route path="sessions/:id" element={<WorkspaceCompatRedirect />} />
        <Route element={<V07AppShell />}>
          <Route index element={<Navigate replace to="/home" />} />
          <Route
            path="home"
            element={
              <DeferredPage>
                <HomePage />
              </DeferredPage>
            }
          />
          <Route path="overview" element={<Navigate replace to="/home" />} />
          <Route
            path="projects"
            element={
              <DeferredPage>
                <ProjectsPage />
              </DeferredPage>
            }
          />
          <Route
            path="projects/new"
            element={
              <DeferredPage>
                <CreateProjectPage />
              </DeferredPage>
            }
          />
          <Route
            path="projects/:projectId"
            element={
              <DeferredPage>
                <ProjectContextLayout />
              </DeferredPage>
            }
          >
            <Route index element={<Navigate replace to="overview" />} />
            <Route
              path="overview"
              element={
                <DeferredPage>
                  <ProjectOverviewPage />
                </DeferredPage>
              }
            />
            <Route
              path="work"
              element={
                <DeferredPage>
                  <ProjectWorkPage />
                </DeferredPage>
              }
            />
            <Route
              path="work/new"
              element={
                <DeferredPage>
                  <NewWorkPage />
                </DeferredPage>
              }
            />
            <Route
              path="sessions"
              element={
                <DeferredPage>
                  <ProjectSessionsPage />
                </DeferredPage>
              }
            />
            <Route path="prompts" element={<ProjectPromptsRedirect />} />
            <Route path="settings" element={<ProjectSettingsRedirect />} />
          </Route>
          <Route path="tasks" element={<TasksRedirect />} />
          <Route
            path="agents"
            element={
              <DeferredPage>
                <AgentCenterPage />
              </DeferredPage>
            }
          />
          <Route
            path="agents/agents/discover"
            element={
              <DeferredPage>
                <DiscoverAgentsPage />
              </DeferredPage>
            }
          />
          <Route
            path="agents/runtime"
            element={
              <DeferredPage>
                <InfrastructurePage kind="runtimes" />
              </DeferredPage>
            }
          />
          <Route
            path="agents/nodes"
            element={
              <DeferredPage>
                <InfrastructurePage kind="nodes" />
              </DeferredPage>
            }
          />
          <Route
            path="agents/nodes/register"
            element={
              <DeferredPage>
                <RemoteNodeRegistrationPage />
              </DeferredPage>
            }
          />
          <Route
            path="agents/nodes/:nodeId"
            element={
              <DeferredPage>
                <RemoteNodeDetailPage />
              </DeferredPage>
            }
          />
          <Route
            path="agents/diagnostics"
            element={
              <DeferredPage>
                <InfrastructurePage kind="diagnostics" />
              </DeferredPage>
            }
          />
          <Route path="agents/agents" element={<Navigate replace to="/agents" />} />
          <Route path="agents/runtimes" element={<Navigate replace to="/agents/runtime" />} />
          <Route path="sessions" element={<SessionsRedirect />} />
          <Route path="promptos" element={<Navigate replace to="/prompts" />} />
          <Route
            path="prompts"
            element={
              <DeferredPage>
                <PromptLibraryPage />
              </DeferredPage>
            }
          />
          <Route
            path="prompts/:promptId"
            element={
              <DeferredPage>
                <PromptLibraryPage />
              </DeferredPage>
            }
          />
          <Route path="settings/runtime" element={<Navigate replace to="/agents/runtime" />} />
          <Route path="settings" element={<Navigate replace to="/settings/appearance" />} />
          <Route
            path="settings/:section"
            element={
              <DeferredPage>
                <SettingsPage />
              </DeferredPage>
            }
          />
          <Route path="remote-nodes" element={<Navigate replace to="/agents/nodes" />} />
          <Route path="*" element={<Navigate replace to="/home" />} />
        </Route>
      </Routes>
    </AccessGate>
  );
}
