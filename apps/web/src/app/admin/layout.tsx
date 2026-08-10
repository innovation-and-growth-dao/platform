'use client';

import { AdminAuthProvider } from '@/lib/admin-auth-context';

// §18.9 — visually distinct admin surface, separate from the public site.
export default function SysadminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="bg-amber-600/90 px-4 py-1.5 text-center text-xs font-semibold tracking-wide text-black">
          PLATFORM ADMIN — handle with care
        </div>
        <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>
      </div>
    </AdminAuthProvider>
  );
}
