import { useEffect, useState } from 'react';

type WorkViewportBand = 'phone' | 'tablet' | 'wide';
/** Work navigation follows its one-column layout; phone filters keep their own breakpoint. */
export function useWorkViewport() {
  const [band, setBand] = useState<WorkViewportBand>('wide');
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const phone = window.matchMedia('(max-width: 767px)');
    const narrow = window.matchMedia('(max-width: 1023px)');
    // Either event reads both current matches and commits one coherent epoch band.
    const update = () => setBand(phone.matches ? 'phone' : narrow.matches ? 'tablet' : 'wide');
    update();
    phone.addEventListener?.('change', update);
    narrow.addEventListener?.('change', update);
    return () => {
      phone.removeEventListener?.('change', update);
      narrow.removeEventListener?.('change', update);
    };
  }, []);
  return { phone: band === 'phone', singlePane: band !== 'wide', band };
}
