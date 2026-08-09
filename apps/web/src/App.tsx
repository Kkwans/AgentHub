import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import {
  AgentsPage,
  OverviewPage,
  ProjectsPage,
  PromptOsPlaceholderPage,
  SessionsPage,
  SettingsPage,
  TasksPage,
} from './pages/ControlPages';
import { WorkspacePage } from './pages/WorkspacePage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate replace to="/overview" />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="sessions/:id" element={<WorkspacePage />} />
        <Route path="promptos" element={<PromptOsPlaceholderPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate replace to="/overview" />} />
      </Route>
    </Routes>
  );
}
