import type { LinkClass } from "@/lib/classify/classify";

/**
 * Original line-art spirits, one per link class. Drawn on a 32×32 grid with
 * currentColor so the theme decides the colour. Decorative: callers label them.
 */
export function SpiritIcon({ cls, size = 28, className }: { cls: LinkClass; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 32 32", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false, className: `spirit spirit-${cls} ${className ?? ""}` };
  switch (cls) {
    case "living":
      return (
        <svg {...common}>
          <path d="M16 3v3" />
          <path d="M12 6h8l1 3H11z" />
          <path d="M11 9c-1 4-1 10 0 14h10c1-4 1-10 0-14" />
          <path className="flame" d="M16 12c2 2.4 2.4 4.6 0 7-2.4-2.4-2-4.6 0-7z" fill="currentColor" fillOpacity=".35" />
          <path d="M10 23h12l-1 3H11z" />
        </svg>
      );
    case "tombstone":
      return (
        <svg {...common}>
          <path d="M8 28V12a8 8 0 0 1 16 0v16" />
          <path d="M5 28h22" />
          <path d="M13 13h6M16 10v8" />
          <path d="M19.5 21l-2 2 1.5 1.5-1.5 2" strokeWidth="1.2" />
        </svg>
      );
    case "ghost":
      return (
        <svg {...common}>
          <path d="M8 27V14a8 8 0 0 1 16 0v13l-2.7-2-2.6 2-2.7-2-2.7 2-2.6-2z" />
          <circle cx="13" cy="14" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="19" cy="14" r="1.2" fill="currentColor" stroke="none" />
          <path d="M14 19c1.3.9 2.7.9 4 0" />
        </svg>
      );
    case "drifted":
      return (
        <svg {...common}>
          <path d="M4 11c3-2 5-2 8 0s5 2 8 0 5-2 8 0" />
          <path d="M4 17c3-2 5-2 8 0s5 2 8 0 5-2 8 0" opacity=".7" />
          <path d="M4 23c3-2 5-2 8 0s5 2 8 0 5-2 8 0" opacity=".45" />
          <path d="M22 4l3 3-3 3" />
        </svg>
      );
    case "zombie":
      return (
        <svg {...common}>
          <path d="M3 28h26" />
          <path d="M12 28v-7l-2-6c-.5-1.5 1.5-2.2 2.2-.8L14 18V8.5c0-1.6 2.4-1.6 2.4 0V16V6.5c0-1.6 2.4-1.6 2.4 0V16V8c0-1.6 2.4-1.6 2.4 0v12c0 3-1 5-2 8" />
          <path d="M6 28l2-2M25 28l2-3" opacity=".6" />
        </svg>
      );
    case "restless":
      return (
        <svg {...common}>
          <path d="M16 16m-2 0a2 2 0 1 0 4 0a5 5 0 1 0 -10 0a8 8 0 1 0 16 0a11 11 0 0 0 -11 -11" />
        </svg>
      );
    case "sealed":
      return (
        <svg {...common}>
          <rect x="7" y="14" width="18" height="13" rx="2.5" />
          <path d="M11 14v-3a5 5 0 0 1 10 0v3" />
          <path d="M16 19v3" />
        </svg>
      );
  }
}
