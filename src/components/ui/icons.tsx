/**
 * Minimal inline icon set — 1.5px stroke, currentColor, sized for dense UI.
 */

import type { SVGProps } from "react";

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function base({ size = 14, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconChevronRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const IconCloud = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M17.5 19a4.5 4.5 0 0 0 .42-8.98 6 6 0 0 0-11.7 1.62A4 4 0 0 0 7 19h10.5Z" />
  </svg>
);

export const IconTerminal = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 7 5 5-5 5M12 19h7" />
  </svg>
);

export const IconBranch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="6" cy="18" r="2.4" />
    <circle cx="18" cy="8" r="2.4" />
    <path d="M6 8.4v7.2M18 10.4c0 3-2.5 4.6-6 4.6H8.4" />
  </svg>
);

export const IconCommit = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M2.5 12h6M15.5 12h6" />
  </svg>
);

export const IconPullRequest = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="6" cy="18" r="2.4" />
    <circle cx="18" cy="18" r="2.4" />
    <path d="M6 8.4v7.2M13 6h2.5A2.5 2.5 0 0 1 18 8.5v7.1M13 6l2.2-2.2M13 6l2.2 2.2" />
  </svg>
);

export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5 22 20H2L12 3.5Z" />
    <path d="M12 10v4.5M12 17.5v.1" />
  </svg>
);

export const IconRetry = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 1 0 2.6-6.3" />
    <path d="M3 4.5V9h4.5" />
  </svg>
);

export const IconStop = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
  </svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />
  </svg>
);

export const IconGear = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6Z" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);

export const IconExternal = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 4h6v6M20 4l-9 9M19 14v5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V6.5A1.5 1.5 0 0 1 5.5 5H10" />
  </svg>
);

export const IconWrench = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14.5 6.5a4.5 4.5 0 0 0-6 6L3 18l3 3 5.5-5.5a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.5-3.5Z" />
  </svg>
);

export const IconFile = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8L13.5 3Z" />
    <path d="M13.5 3v5h5" />
  </svg>
);

export const IconImage = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m4 17 5-5 4 4 3-3 4 4" />
  </svg>
);

export const IconFolder = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11Z" />
  </svg>
);

export const IconBrain = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4.5c-1.2-1.5-4-1.6-5 .5-2.4.3-3.3 3-2 4.6-1.4 1.3-.9 3.9 1 4.5-.2 2.3 2 3.7 4 3 .5 1.5 1.5 1.9 2 1.9s1.5-.4 2-1.9c2 .7 4.2-.7 4-3 1.9-.6 2.4-3.2 1-4.5 1.3-1.6.4-4.3-2-4.6-1-2.1-3.8-2-5-.5Z" />
    <path d="M12 4.5V19" />
  </svg>
);

export const IconSend = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 3 10.5 13.5M21 3l-7 18-3.5-7.5L3 10l18-7Z" />
  </svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
);

export const IconWorktree = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v6M12 9c-4 0-6 2-6 6M12 9c4 0 6 2 6 6M6 15v6M18 15v6M12 9v12" />
  </svg>
);

/** friday logo glyph — four-point spark. */
export const IconSpark = (p: IconProps) => (
  <svg {...base({ strokeWidth: 0, ...p })}>
    <path
      fill="currentColor"
      d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10Z"
    />
  </svg>
);

export const Spinner = ({ size = 14, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={`animate-spin ${className ?? ""}`}
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);
