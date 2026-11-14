import { Ellipsis } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './SessionSecondaryTools.module.css';

/** One mounted action tree across widths; closing never discards a draft or request. */
export function SessionSecondaryTools({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    setOpen(false);
  }, [sessionId]);
  useEffect(() => {
    if (!open) return;
    const modalOwnedEvents = new WeakSet<Event>();
    // Download UI may leave keyboard focus outside the modal. Snapshot its
    // ownership before document-capture dismissal can remove the modal DOM.
    const recordModalOwner = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) modalOwnedEvents.add(event);
    };
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (window.matchMedia?.('(max-width: 767px)').matches === false) return;
      if (modalOwnedEvents.has(event)) return;
      // A portalled modal owns dismissal and return focus until it closes.
      // The modal may have closed between native capture and bubble listeners.
      // Its original event path still owns that Escape; do not close twice.
      if (
        event
          .composedPath()
          .some(
            (node) =>
              node instanceof HTMLElement && node.matches('[role="dialog"][aria-modal="true"]'),
          )
      )
        return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
      } else if (root.current?.contains(event.target as Node)) return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener('keydown', recordModalOwner, true);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('keydown', recordModalOwner, true);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, [open]);
  return (
    <div ref={root} className={styles.root} data-open={open}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label="更多会话操作"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      <div
        id={id}
        className={styles.content}
        onClickCapture={() => setOpen(true)}
        role="group"
        aria-label="更多会话操作"
      >
        {children}
      </div>
    </div>
  );
}
