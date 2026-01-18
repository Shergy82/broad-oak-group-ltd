import Link from 'next/link';

export function Logo() {
  return (
    <Link href="https://www.broadoakgroup.com/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary">
       <div>
        <h1 className="text-xl md:text-2xl font-bold whitespace-nowrap text-foreground">
          BROAD OAK GROUP
        </h1>
      </div>
    </Link>
  );
}
