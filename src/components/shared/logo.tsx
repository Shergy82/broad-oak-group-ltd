import { Building2 } from 'lucide-react';
import Link from 'next/link';

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-primary">
      <Building2 className="h-6 w-6" />
      <div>
        <h1 className="text-xl font-bold whitespace-nowrap">
          Broad Oak Build
        </h1>
        <span className="block text-sm font-light leading-tight italic">
          Live
        </span>
      </div>
    </Link>
  );
}
