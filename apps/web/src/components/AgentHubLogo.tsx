import { ShareNetwork } from '@agenthub/ui';
import type { HTMLAttributes } from 'react';

export function AgentHubLogo({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={['agenthub-logo', className].filter(Boolean).join(' ')}
      aria-hidden="true"
      {...props}
    >
      <ShareNetwork size="64%" weight="duotone" />
    </span>
  );
}
