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

function useMobileDrawerBehavior(open: boolean, onClose: () => void) {
  const drawerRef = useRef<HTMLDialogElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const historyMarkerRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [dragOffset, setDragOffset] = useState(0);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const marker = historyMarkerRef.current;
    if (marker && window.history.state?.mobileDrawer === marker) {
      const restState = { ...window.history.state };
      delete restState.mobileDrawer;
      window.history.replaceState(restState, '');
      historyMarkerRef.current = null;
    }
    onCloseRef.current();
  }, []);

  const closeForAction = requestClose;

  useEffect(() => {
    if (!open) return;
    const dialog = drawerRef.current;
    if (!dialog) return;
    closingRef.current = false;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousWidth = document.body.style.width;
    const previousTop = document.body.style.top;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;

    const historyMarker = `mobile-drawer-${Date.now()}`;
    historyMarkerRef.current = historyMarker;
    window.history.pushState({ ...window.history.state, mobileDrawer: historyMarker }, '');
    const handlePopState = requestClose;
    window.addEventListener('popstate', handlePopState);
    // showModal performs native initial focus. Do not schedule a second focus
    // pass that could steal a user's selection or survive a rapid close/reopen.
    return () => {
      // Route changes may already have focused a new destination. Native close
      // restores an opener, so preserve a deliberate focus outside this dialog.
      const outside =
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body &&
        !dialog.contains(document.activeElement)
          ? document.activeElement
          : null;
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.width = previousWidth;
      document.body.style.top = previousTop;
      window.scrollTo(0, scrollY);
      window.removeEventListener('popstate', handlePopState);
      if (
        historyMarkerRef.current &&
        window.history.state?.mobileDrawer === historyMarkerRef.current
      ) {
        const restState = { ...window.history.state };
        delete restState.mobileDrawer;
        window.history.replaceState(restState, '');
      }
      historyMarkerRef.current = null;
      const restore = outside?.isConnected ? outside : previouslyFocusedRef.current;
      if (restore?.isConnected) restore.focus();
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
    <dialog
      ref={drawer.drawerRef}
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      className={cn(
        'mobile-drawer m-0 h-dvh max-h-dvh overflow-hidden fixed inset-y-0 left-0 z-[90] flex w-[80vw] max-w-[320px] flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] shadow-[var(--shadow-lg)] outline-none',
        className,
      )}
      style={{
        transform: `translateX(-${drawer.dragOffset}px)`,
        transition: drawer.dragOffset ? 'none' : undefined,
      }}
      onKeyDown={(event) => {
        if (
          event.key !== 'Tab' ||
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const dialog = event.currentTarget;
        const targets = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'a[href], button, input, select, textarea, summary, [contenteditable="true"], [tabindex]',
          ),
        )
          .filter(
            (node) =>
              node.tabIndex >= 0 &&
              !node.matches(':disabled') &&
              !node.closest('[hidden], [inert]') &&
              node.getClientRects().length > 0 &&
              !['hidden', 'collapse'].includes(getComputedStyle(node).visibility),
          )
          .sort(
            (left, right) =>
              (left.tabIndex > 0 ? left.tabIndex : Infinity) -
              (right.tabIndex > 0 ? right.tabIndex : Infinity),
          );
        const first = targets[0];
        const last = targets.at(-1);
        const active = dialog.ownerDocument.activeElement;
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (
          !targets.includes(active as HTMLElement) ||
          (event.shiftKey ? active === first : active === last)
        ) {
          // Native modal inertness remains authoritative. Explicit edge cycling
          // keeps boundary traversal deterministic across browser hosts.
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        drawer.requestClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX >= rect.right ||
          event.clientY < rect.top ||
          event.clientY >= rect.bottom
        )
          drawer.requestClose();
      }}
      onTouchStart={drawer.onTouchStart}
      onTouchMove={drawer.onTouchMove}
      onTouchEnd={drawer.onTouchEnd}
      onTouchCancel={drawer.onTouchCancel}
    >
      {typeof children === 'function' ? children(drawer.closeForAction) : children}
    </dialog>
  );
}
