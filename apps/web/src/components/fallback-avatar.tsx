'use client';

import { useState } from 'react';

/**
 * §2.1 — universal placeholder avatar when no photo/logo was provided.
 *
 * Uses real artwork served from `apps/web/public/avatars/`. List the files you
 * dropped there in AVATAR_FILES; each user gets a stable one picked from their
 * display name. If a file is missing/fails to load we fall back to a clean inline
 * silhouette so nothing renders broken.
 *
 * Used for DAO members, submitters and experts.
 */
const AVATAR_FILES: string[] = [
  '/avatars/default-profile.png',
  // Add more variants here as you drop them in, e.g.:
  // '/avatars/face-1.png', '/avatars/face-2.png', '/avatars/face-3.png',
];

// Clean inline fallback (head + shoulders) used only if the image asset is absent.
const INLINE_FALLBACK =
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" fill="#e5e7eb"/>` +
      `<g fill="#111827"><path d="M5 64 C5 49 17 43 32 43 C47 43 59 49 59 64 Z"/>` +
      `<circle cx="32" cy="24" r="14"/></g></svg>`,
  )}`;

function hash(name: string): number {
  let h = 0;
  for (const c of name || '?') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function FallbackAvatar({ name, className = 'h-9 w-9 rounded' }: { name: string; className?: string }) {
  const initial = AVATAR_FILES.length ? AVATAR_FILES[hash(name) % AVATAR_FILES.length] : INLINE_FALLBACK;
  const [src, setSrc] = useState(initial);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`object-cover ${className}`}
      onError={() => { if (src !== INLINE_FALLBACK) setSrc(INLINE_FALLBACK); }}
    />
  );
}
