if (typeof document !== 'undefined' && typeof document.queryCommandSupported !== 'function') {
  Object.defineProperty(document, 'queryCommandSupported', {
    configurable: true,
    value: () => false,
  });
}

if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
}

// `react-resizable-panels` resolves ResizeObserver from the mounted document's
// window. Keep a constructor available across lazy Workspace mounts so a test
// finishing during route navigation cannot leave an unhandled `new undefined`
// callback behind.
if (typeof globalThis.ResizeObserver !== 'function') {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  });
}
