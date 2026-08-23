/**
 * Inline icons. No icon library — these are ours, they inherit currentColor,
 * and they are marked aria-hidden because every one of them sits beside a word
 * or inside a control that carries its own accessible name.
 *
 * 16px grid, 1.5 stroke, round caps. Anything heavier reads as a different
 * family beside Geist at 13px.
 */
type IconProps = {
  className?: string;
  size?: number;
};

function Svg({ className, size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6l4 4 4-4" />
  </Svg>
);

export const ChevronUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10l4-4 4 4" />
  </Svg>
);

export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5l3.2 3.2L13 5" />
  </Svg>
);

export const Minus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8h9" />
  </Svg>
);

export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
);

export const Close = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const Search = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.2" cy="7.2" r="4.2" />
    <path d="M10.4 10.4L13.5 13.5" />
  </Svg>
);

export const Upload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 11V3.5M5 6.2L8 3.2l3 3" />
    <path d="M2.8 10.6v1.6a1.2 1.2 0 001.2 1.2h8a1.2 1.2 0 001.2-1.2v-1.6" />
  </Svg>
);

export const File = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 2H4.6A1.6 1.6 0 003 3.6v8.8A1.6 1.6 0 004.6 14h6.8a1.6 1.6 0 001.6-1.6V6z" />
    <path d="M9 2v3.2A.8.8 0 009.8 6H13" />
  </Svg>
);

export const Warning = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.8l5.6 9.7H2.4z" />
    <path d="M8 6.6v2.6M8 11.1h.01" />
  </Svg>
);

export const Spinner = ({ className, size = 16 }: IconProps) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
    <path
      d="M14 8a6 6 0 00-6-6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="origin-center motion-safe:animate-spin"
    />
  </svg>
);

export const Dots = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="3.6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="12.4" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);
