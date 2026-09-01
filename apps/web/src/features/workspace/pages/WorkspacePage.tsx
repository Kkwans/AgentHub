import { EmptyState, ErrorState, LoadingState } from '../../../components/Common';
import { useWorkspaceViewModel } from '../useWorkspaceViewModel';
import { WorkspaceView } from './WorkspaceView';

export { fetchSessionEventPages, mergeSessionEvents } from '../useWorkspaceViewModel';

export function WorkspacePage() {
  const model = useWorkspaceViewModel();

  if (model.session.isLoading) return <LoadingState label="正在打开 Coding Workspace" />;
  if (model.session.error) return <ErrorState error={model.session.error} />;
  if (!model.session.data)
    return <EmptyState title="会话不存在" description="返回会话列表选择可用会话。" />;

  return <WorkspaceView model={model} />;
}
