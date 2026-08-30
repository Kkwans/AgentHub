import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { AhLoadingState } from '@agenthub/ui';
import { useQuery } from '@tanstack/react-query';

import { AccessGate } from './components/AccessGate';
import { AppShell } from './app/shell/AppShell';
import type { SessionRecord } from './lib/api';
import { api } from './lib/api';

const HomePage = lazy(() =>
  import('./features/home/pages/HomePage').then((module) => ({ default: module.HomePage })),
);
const ProjectsPage = lazy(() =>
  import('./features/projects/pages/ProjectsPage').then((module) => ({
    default: module.ProjectsPage,
  })),
);
const CreateProjectPage = lazy(() =>
  import('./features/projects/pages/CreateProjectPage').then((module) => ({
    default: module.CreateProjectPage,
  })),
);
const ProjectContextLayout = lazy(() =>
  import('./features/projects/pages/ProjectContextLayout').then((module) => ({
    default: module.ProjectContextLayout,
  })),
);
const ProjectOverviewPage = lazy(() =>
  import('./features/projects/pages/ProjectOverviewPage').then((module) => ({
    default: module.ProjectOverviewPage,
  })),
);
const ProjectWorkPage = lazy(() =>
  import('./features/projects/pages/ProjectWorkPage').then((module) => ({
    default: module.ProjectWorkPage,
  })),
);
const NewWorkPage = lazy(() =>
  import('./features/projects/pages/NewWorkPage').then((module) => ({
    default: module.NewWorkPage,
  })),
);
const ProjectSessionsPage = lazy(() =>
  import('./features/projects/pages/ProjectSessionsPage').then((module) => ({
    default: module.ProjectSessionsPage,
  })),
);
const AgentCenterPage = lazy(() =>
  import('./features/agents/pages/AgentCenterPage').then((module) => ({
    default: module.AgentCenterPage,
  })),
);
const DiscoverAgentsPage = lazy(() =>
  import('./features/agents/pages/DiscoverAgentsPage').then((module) => ({
    default: module.DiscoverAgentsPage,
  })),
);
const PromptLibraryPage = lazy(() =>
  import('./features/promptos/pages/PromptLibraryPage').then((module) => ({
    default: module.PromptLibraryPage,
  })),
);
const SettingsPage = lazy(() =>
  import('./features/settings/pages/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
);
const WorkspacePage = lazy(() =>
  import('./features/workspace/pages/WorkspacePage').then((module) => ({
    default: module.WorkspacePage,
  })),
);
const InfrastructurePage = lazy(() =>
  import('./features/agents/pages/InfrastructurePage').then((module) => ({
    default: module.InfrastructurePage,
  })),
);
const RemoteNodeRegistrationPage = lazy(() =>
  import('./features/agents/pages/RemoteNodeRegistrationPage').then((module) => ({
    default: module.RemoteNodeRegistrationPage,
  })),
);
const RemoteNodeDetailPage = lazy(() =>
  import('./features/agents/pages/RemoteNodeDetailPage').then((module) => ({
    default: module.RemoteNodeDetailPage,
  })),
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
          path="workspace/:id"
          element={
            <DeferredPage>
              <WorkspacePage />
            </DeferredPage>
          }
        />
        <Route path="sessions/:id" element={<WorkspaceCompatRedirect />} />
        <Route element={<AppShell />}>
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
