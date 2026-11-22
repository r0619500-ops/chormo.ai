import { useId } from 'react';

interface ChromoLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ChromoLogo({ size = 'md', className = '' }: ChromoLogoProps) {
  const uid = useId().replace(/:/g, '');
  const gradId = `chromo-prism-${uid}`;
  const accentId = `chromo-facet-${uid}`;

  const dimensions =
    size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-14 h-14' : 'w-8 h-8';

  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={`${dimensions} shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id={gradId} x1="5" y1="5" x2="35" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0EA5E9" />
          <stop offset="55%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#0F766E" />
        </linearGradient>
        <linearGradient id={accentId} x1="20" y1="8" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>

      {/* Outer architectural squircle frame */}
      <rect
        x="2"
        y="2"
        width="36"
        height="36"
        rx="10"
        className="fill-zinc-950/[0.03] dark:fill-white/[0.04] stroke-zinc-900/10 dark:stroke-white/15"
        strokeWidth="1.25"
      />

      {/* Precision geometric letter C arc */}
      <path
        d="M27.2 13.4C25.4 11.4 22.9 10.2 20 10.2C14.6 10.2 10.3 14.5 10.3 20C10.3 25.5 14.6 29.8 20 29.8C23 29.8 25.6 28.5 27.4 26.4"
        stroke={`url(#${gradId})`}
        strokeWidth="3.6"
        strokeLinecap="round"
      />

      {/* Chromatic aperture diamond focal point */}
      <path
        d="M28 17.6L30.4 20L28 22.4L25.6 20L28 17.6Z"
        fill={`url(#${accentId})`}
      />
    </svg>
  );
}
