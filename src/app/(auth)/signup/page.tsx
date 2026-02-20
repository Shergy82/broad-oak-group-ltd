import { Suspense } from 'react';
import { SignUpFlow } from '@/components/auth/signup-flow';
import { Spinner } from '@/components/shared/spinner';

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen w-full flex-col items-center justify-center"><Spinner size="lg" /></div>}>
      <SignUpFlow />
    </Suspense>
  );
}
