import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { AccessGate } from './components/AccessGate';
import { AppShell } from './components/AppShell';
import { LoadingState } from './components/Common';

const OverviewPage = lazy(() =>
  import('./pages/OverviewPage').then((module) => ({ default: module.OverviewPage })),
);
const ProjectsPage = lazy(() =>
  import('./pages/ControlPages').then((module) => ({ default: module.ProjectsPage })),
);
const TasksPage = lazy(() =>
  import('./pages/ControlPages').then((module) => ({ default: module.TasksPage })),
);
const AgentsPage = lazy(() =>
  import('./pages/ControlPages').then((module) => ({ default: module.AgentsPage })),
);
const SessionsPage = lazy(() =>
  import('./pages/ControlPages').then((module) => ({ default: module.SessionsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/ControlPages').then((module) => ({ default: module.SettingsPage })),
);
const WorkspacePage = lazy(() =>
  import('./pages/WorkspacePage').then((module) => ({ default: module.WorkspacePage })),
);
const PromptOsPage = lazy(() =>
  import('./pages/PromptOsPage').then((module) => ({ default: module.PromptOsPage })),
);

function DeferredPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingState label="正在加载页面" />}>{children}</Suspense>;
}

export function App() {
  return (
    <AccessGate>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate replace to="/overview" />} />
          <Route
            path="overview"
            element={
              <DeferredPage>
                <OverviewPage />
              </DeferredPage>
            }
          />
          <Route
            path="projects"
            element={
              <DeferredPage>
                <ProjectsPage />
              </DeferredPage>
            }
          />
          <Route
            path="tasks"
            element={
              <DeferredPage>
                <TasksPage />
              </DeferredPage>
            }
          />
          <Route
            path="agents"
            element={
              <DeferredPage>
                <AgentsPage />
              </DeferredPage>
            }
          />
          <Route
            path="sessions"
            element={
              <DeferredPage>
                <SessionsPage />
              </DeferredPage>
            }
          />
          <Route
            path="sessions/:id"
            element={
              <DeferredPage>
                <WorkspacePage />
              </DeferredPage>
            }
          />
          <Route
            path="promptos"
            element={
              <DeferredPage>
                <PromptOsPage />
              </DeferredPage>
            }
          />
          <Route
            path="settings"
            element={
              <DeferredPage>
                <SettingsPage />
              </DeferredPage>
            }
          />
          <Route path="*" element={<Navigate replace to="/overview" />} />
        </Route>
      </Routes>
    </AccessGate>
  );
}
