import styles from './AgentHubWordmark.module.css';

/** Quiet reference-aligned wordmark; not a finalized graphic brand identity. */
export function AgentHubWordmark() {
  return (
    <span className={styles.wordmark} data-brand-wordmark="true">
      AgentHub
    </span>
  );
}
