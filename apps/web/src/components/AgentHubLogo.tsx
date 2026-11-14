import type { HTMLAttributes } from 'react';
import styles from './AgentHubLogo.module.css';

export function AgentHubLogo({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={['agenthub-logo', styles.mark, className].filter(Boolean).join(' ')}
      aria-hidden="true"
      {...props}
    >
      <span className={styles.glyph} data-brand-glyph="true" />
    </span>
  );
}
