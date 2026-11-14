import type { HTMLAttributes } from 'react';
import styles from './AgentHubLogo.module.css';

export function AgentHubLogo({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={['agenthub-logo', styles.mark, className].filter(Boolean).join(' ')}
      aria-hidden="true"
      data-brand-initials="true"
      {...props}
    >
      <span data-brand-monogram="true">AH</span>
    </span>
  );
}
