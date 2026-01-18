'use client';

import Link from 'next/link';

const LogoIcon = () => (
  <svg width="28" height="28" viewBox="0 0 32 32">
    <g transform="translate(16,16)">
      <path
        d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z"
        fill="#84cc16"
        transform="rotate(0)"
      />
      <path
        d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z"
        fill="#22d3ee"
        transform="rotate(90)"
      />
      <path
        d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z"
        fill="#f87171"
        transform="rotate(180)"
      />
      <path
        d="M 0 -14 A 14 14 0 0 1 14 0 L 8 0 A 8 8 0 0 0 0 -8 Z"
        fill="#fbbf24"
        transform="rotate(270)"
      />
    </g>
  </svg>
);

export function Logo() {
  return (
    <Link href="/" className="mr-6 flex items-center space-x-2">
      <LogoIcon />
      <span className="font-bold font-headline text-foreground text-xl whitespace-nowrap">
        BROAD OAK GROUP
      </span>
    </Link>
  );
}
