import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** PinHarness 原样 class 合并工具，供共享 UI primitives 复用。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
