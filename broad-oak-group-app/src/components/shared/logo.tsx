
import Link from 'next/link';

export function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 text-primary">
      <div className="h-8 w-8">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="swirl-blue" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#2F80ED" />
              <stop offset="100%" stopColor="#56CCF2" />
            </linearGradient>
            <linearGradient id="swirl-green" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#27AE60" />
              <stop offset="100%" stopColor="#6FCF97" />
            </linearGradient>
            <linearGradient id="swirl-red" x1="1" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#EB5757" />
              <stop offset="100%" stopColor="#FF8282" />
            </linearGradient>
            <linearGradient id="swirl-orange" x1="1" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F2994A" />
              <stop offset="100%" stopColor="#F2C94C" />
            </linearGradient>
          </defs>

          <path d="M 50,10 A 40,40 0 0 1 85,35" stroke="url(#swirl-blue)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 65,85 A 40,40 0 0 1 50,90" stroke="url(#swirl-orange)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 15,65 A 40,40 0 0 1 10,50" stroke="url(#swirl-green)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 85,65 A 40,40 0 0 1 90,50" stroke="url(#swirl-red)" strokeWidth="16" fill="none" strokeLinecap="round" />
          
          <path d="M 35,15 A 40,40 0 0 1 50,10" stroke="url(#swirl-blue)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 15,35 A 40,40 0 0 1 35,15" stroke="url(#swirl-green)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 35,85 A 40,40 0 0 1 15,65" stroke="url(#swirl-green)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 65,15 A 40,40 0 0 1 85,35" stroke="url(#swirl-blue)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 85,35 A 40,40 0 0 1 90,50" stroke="url(#swirl-red)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 85,65 A 40,40 0 0 1 65,85" stroke="url(#swirl-red)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 65,85 A 40,40 0 0 1 50,90" stroke="url(#swirl-orange)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 35,85 A 40,40 0 0 1 15,65" stroke="url(#swirl-orange)" strokeWidth="16" fill="none" strokeLinecap="round" />
          <path d="M 15,35 A 40,40 0 0 1 10,50" stroke="url(#swirl-green)" strokeWidth="16" fill="none" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <h1 className="text-lg md:text-xl font-bold whitespace-nowrap">
          BROAD OAK GROUP
        </h1>
        <span className="block text-sm font-light leading-tight italic">
          Live
        </span>
      </div>
    </Link>
  );
}
