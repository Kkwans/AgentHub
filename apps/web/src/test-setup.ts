if (typeof document !== 'undefined' && typeof document.queryCommandSupported !== 'function') {
  Object.defineProperty(document, 'queryCommandSupported', {
    configurable: true,
    value: () => false,
  });
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
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

// JSDOM has no layout/animation engine. Model the observable position and scroll
// event, not smooth timing; lifecycle tests control requestAnimationFrame itself.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: function (this: Element, optionsOrX: ScrollToOptions | number, y?: number) {
      const options = typeof optionsOrX === 'number' ? { left: optionsOrX, top: y } : optionsOrX;
      if (options.top !== undefined) {
        this.scrollTop = Math.max(0, Math.min(options.top, this.scrollHeight - this.clientHeight));
      }
      if (options.left !== undefined) {
        this.scrollLeft = Math.max(0, Math.min(options.left, this.scrollWidth - this.clientWidth));
      }
      this.dispatchEvent(new Event('scroll'));
    },
  });
}
