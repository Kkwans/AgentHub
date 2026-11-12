import { observeElementOffset } from '@tanstack/react-virtual';

// The upstream observer removes listeners on dispose, but its fallback scroll-end
// debounce may still fire. Keep its RTL/scrollend behavior while isolating that
// late notification from an unmounted or replaced virtualizer subscription.
export const observeTimelineOffset: typeof observeElementOffset = (instance, callback) => {
  let active = true;
  const unsubscribe = observeElementOffset(instance, (offset, scrolling) => {
    if (active) callback(offset, scrolling);
  });
  return () => {
    active = false;
    unsubscribe?.();
  };
};
