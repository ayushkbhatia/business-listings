/** Display-tier icons. Same 16px grid and 1.5 stroke as the primitives set. */
type IconProps = { className?: string; size?: number };

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

export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.2" y="3" width="11.6" height="10" rx="1.4" />
    <circle cx="6" cy="6.4" r="1" />
    <path d="M2.6 11.2l3.1-2.8 2.6 2.3 2-1.7 3.1 2.7" />
  </Svg>
);

export const Pin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 14s4.6-4.1 4.6-7.4A4.6 4.6 0 008 2a4.6 4.6 0 00-4.6 4.6C3.4 9.9 8 14 8 14z" />
    <circle cx="8" cy="6.5" r="1.6" />
  </Svg>
);

export const Building = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.8 13.4V4.2a1 1 0 011-1h4.4a1 1 0 011 1v9.2" />
    <path d="M9.2 13.4V7h3a1 1 0 011 1v5.4" />
    <path d="M1.8 13.4h12.4M5 5.6h1.2M5 8h1.2M5 10.4h1.2M11 9.4h.8" />
  </Svg>
);
