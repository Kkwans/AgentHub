import type { SVGProps } from 'react';

export function AgentHubLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden="true" focusable="false" {...props}>
      <rect width="36" height="36" rx="11" fill="#1E55B3" />
      <rect x="1" y="1" width="34" height="34" rx="10" fill="none" stroke="#4D83E1" />
      <path
        d="M10.8 10.5 14.6 14m10.6-3.5L21.4 14m3.8 11.5L21.4 22"
        fill="none"
        stroke="#9CC8FF"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="m18 12.2 5.1 2.9v5.8L18 23.8l-5.1-2.9v-5.8z"
        fill="#FFFFFF"
        fillOpacity="0.16"
        stroke="#FFFFFF"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="18" r="2.25" fill="#FFFFFF" />
      <circle cx="9.2" cy="9" r="2.4" fill="#DCEBFF" stroke="#FFFFFF" strokeWidth="1.2" />
      <circle cx="26.8" cy="9" r="2.4" fill="#DCEBFF" stroke="#FFFFFF" strokeWidth="1.2" />
      <circle cx="26.8" cy="27" r="2.4" fill="#79D8C2" stroke="#FFFFFF" strokeWidth="1.2" />
    </svg>
  );
}
