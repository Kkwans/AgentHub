import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { parseEligibility } from '../lib/project-eligibility';

/** Registered project compatibility only, not a live Agent health promise. */
export function useProjectEligibility(projectId: string | undefined) {
  return useQuery({
    queryKey: ['agent-eligibility', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('项目尚未确定。');
      return parseEligibility(
        await api.get<unknown>(`/projects/${encodeURIComponent(projectId)}/agent-eligibility`),
        projectId,
      );
    },
    enabled: Boolean(projectId),
    retry: false,
  });
}
