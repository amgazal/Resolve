import type { JSX } from "react";

const GLYPHS: Record<string, JSX.Element> = {
  wifi: (<><path d="M2.5 8a13 13 0 0 1 15 0" /><path d="M5.5 11.2a8.4 8.4 0 0 1 9 0" /><path d="M8.2 14.2a3.6 3.6 0 0 1 3.6 0" /><circle cx="10" cy="17" r=".9" fill="currentColor" stroke="none" /></>),
  lock: (<><rect x="4" y="9" width="12" height="8" rx="2.2" /><path d="M7.2 9V6.6a2.8 2.8 0 0 1 5.6 0V9" /></>),
  window: (<><rect x="3" y="4.5" width="14" height="11" rx="2" /><path d="M3 8.2h14" /></>),
  laptop: (<><rect x="4.5" y="5" width="11" height="7.5" rx="1.4" /><path d="M2.5 15.5h15" /></>),
  printer: (<><path d="M6.5 8.5V4.5h7v4" /><rect x="3.5" y="8.5" width="13" height="5.5" rx="1.6" /><path d="M6.5 11.5h7V17h-7z" /></>),
  dots: (<><circle cx="5.5" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="14.5" cy="10" r="1" fill="currentColor" stroke="none" /></>),
  arrow: <path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5" />,
  back: <path d="M16 10H4M8.5 5.5 4 10l4.5 4.5" />,
  check: <path d="M4.5 10.5 8 14l7.5-8" />,
  copy: (<><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4H5.5A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" /></>),
  close: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  trash: (<><path d="M4.5 6h11" /><path d="M8 6V4.5h4V6" /><path d="M6 6l.7 10h6.6L14 6" /></>),
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {GLYPHS[name] ?? GLYPHS.dots}
    </svg>
  );
}
