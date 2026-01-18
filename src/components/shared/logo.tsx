import Link from 'next/link';
import Image from 'next/image';

export function Logo() {
  return (
    <Link href="https://www.broadoakgroup.com/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary">
      <Image
        src="/broad-oak-logo.png"
        alt="BROAD OAK GROUP Logo"
        width={160}
        height={40}
        className="h-10 w-auto"
        priority
      />
    </Link>
  );
}
