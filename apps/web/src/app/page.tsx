import { Suspense } from 'react';
import { HomeShell } from '@/components/home-shell';

export default function Home() {
  // Suspense boundary required because HomeShell reads the URL via useSearchParams.
  return (
    <Suspense>
      <HomeShell />
    </Suspense>
  );
}
