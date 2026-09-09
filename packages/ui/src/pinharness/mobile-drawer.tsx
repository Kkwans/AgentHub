/**
 * MobileDrawerPanel — copied from PinHarness layout/MobileDrawer.
 *
 * The panel intentionally owns only mobile interaction behavior. AgentHub
 * supplies its own navigation content through the render prop so no
 * PinHarness business routes leak into this package.
 */

import { type ReactNode, type TouchEvent, useCallback, useEffect, useRef, useState } from 'react';

import { cn } from './ui/cn.js';

export interface MobileDrawerPanelProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode | ((closeForAction: () => void) => ReactNode);
  className?: string;
}

function DrawerBackdrop({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="mobile-drawer-backdrop fixed inset-0 z-[80] bg-[hsl(220_32%_10%/0.42)] dark:bg-[hsl(220_30%_3%/0.62)]"
      onClick={onClose}
      aria-hidden="true"
    />
  );
}

function useMobileDrawerBehavior(open: boolean, onClose: () => void) {
  const drawerRef = useRef<HTMLDialogElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const historyMarkerRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [dragOffset, setDragOffset] = useState(0);

  const requestClose = useCallback(() => {
    const marker = historyMarkerRef.current;
    if (marker && window.history.state?.mobileDrawer === marker) {
      const restState = { ...window.history.state };
      delete restState.mobileDrawer;
      window.history.replaceState(restState, '');
      historyMarkerRef.current = null;
    }
    onCloseRef.current();
  }, []);

  const closeForAction = useCallback(() => {
    const marker = historyMarkerRef.current;
    if (marker && window.history.state?.mobileDrawer === marker) {
      const restState = { ...window.history.state };
      delete restState.mobileDrawer;
      window.history.replaceState(restState, '');
      historyMarkerRef.current = null;
    }
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousWidth = document.body.style.width;
    const previousTop = document.body.style.top;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const historyMarker = `mobile-drawer-${Date.now()}`;
    historyMarkerRef.current = historyMarker;
    window.history.pushState({ ...window.history.state, mobileDrawer: historyMarker }, '');
    const handlePopState = () => onCloseRef.current();
    window.addEventListener('keydown', handler);
    window.addEventListener('popstate', handlePopState);
    requestAnimationFrame(() =>
      drawerRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus(),
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.width = previousWidth;
      document.body.style.top = previousTop;
      window.scrollTo(0, scrollY);
      window.removeEventListener('keydown', handler);
      window.removeEventListener('popstate', handlePopState);
      historyMarkerRef.current = null;
      previouslyFocusedRef.current?.focus();
      setDragOffset(0);
    };
  }, [open, requestClose]);

  const onTouchStart = (event: TouchEvent<HTMLDialogElement>) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchMove = (event: TouchEvent<HTMLDialogElement>) => {
    const startX = touchStartXRef.current;
    const currentX = event.touches[0]?.clientX;
    if (startX == null || currentX == null) return;
    setDragOffset(Math.max(0, startX - currentX));
  };
  const onTouchEnd = () => {
    if (dragOffset > 72) requestClose();
    else setDragOffset(0);
    touchStartXRef.current = null;
  };
  const onTouchCancel = () => {
    touchStartXRef.current = null;
    setDragOffset(0);
  };

  return {
    drawerRef,
    dragOffset,
    requestClose,
    closeForAction,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };
}

export function MobileDrawerPanel({
  open,
  onClose,
  ariaLabel,
  children,
  className,
}: MobileDrawerPanelProps) {
  const drawer = useMobileDrawerBehavior(open, onClose);
  if (!open) return null;
  return (
    <>
      <DrawerBackdrop onClose={drawer.requestClose} />
      <dialog
        ref={drawer.drawerRef}
        open
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          'mobile-drawer fixed inset-y-0 left-0 z-[90] flex w-[80vw] max-w-[320px] flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] shadow-[var(--shadow-lg)] outline-none',
          className,
        )}
        style={{
          transform: `translateX(-${drawer.dragOffset}px)`,
          transition: drawer.dragOffset ? 'none' : undefined,
        }}
        onTouchStart={drawer.onTouchStart}
        onTouchMove={drawer.onTouchMove}
        onTouchEnd={drawer.onTouchEnd}
        onTouchCancel={drawer.onTouchCancel}
      >
        {typeof children === 'function' ? children(drawer.closeForAction) : children}
      </dialog>
    </>
  );
}
