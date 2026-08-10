'use client';

import { useT } from '@/lib/prefs-context';

/**
 * Shared profile-photo picker + resizer. Users can pick a normal, large photo (we accept up to
 * MAX_SOURCE_BYTES); the image is downscaled client-side to a STANDARD square-ish size before it
 * is stored as a data URL. That one standard image is sharp enough for the full profile view and
 * is simply CSS-scaled down for the small overview thumbnails — no need to keep two copies.
 * Used by the DRep, submitter and expert profile forms.
 */
export const ALLOWED_PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
/** Source files up to this size are accepted (we resize, so a big original is fine). */
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
/** Longest edge of the stored image — large enough for the profile, small in bytes. */
export const STANDARD_MAX_DIM = 640;
/** Stored data-URL length budget (chars). Stays under the API's photo column cap (700k). */
const MAX_OUTPUT_CHARS = 650_000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the image.'));
    img.src = src;
  });
}

/**
 * Validate, downscale to STANDARD_MAX_DIM (never upscale), and encode to a compact data URL.
 * Prefers WebP (keeps transparency + compresses well), backing off quality / falling back to
 * JPEG if needed to fit the storage budget. Throws a user-facing Error on any failure.
 */
export async function resizeImageFile(file: File): Promise<string> {
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    throw new Error('Only PNG, JPEG, WebP or GIF images are accepted.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`Image is ${(file.size / (1024 * 1024)).toFixed(1)} MB — keep it under ${MAX_SOURCE_BYTES / (1024 * 1024)} MB.`);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, STANDARD_MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process the image.');
    ctx.drawImage(img, 0, 0, w, h);
    let out = canvas.toDataURL('image/webp', 0.85);
    if (out.length > MAX_OUTPUT_CHARS) out = canvas.toDataURL('image/webp', 0.7);
    if (out.length > MAX_OUTPUT_CHARS) out = canvas.toDataURL('image/jpeg', 0.7);
    if (out.length > MAX_OUTPUT_CHARS) throw new Error('Could not compress the image enough — try a simpler photo.');
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PhotoUpload({
  photo,
  onChange,
  error,
  hint,
}: {
  photo: string | null;
  onChange: (next: string | null, error?: string) => void;
  error: string | null;
  hint?: string;
}) {
  const t = useT();
  const resolvedHint = hint ?? t('PNG, JPEG, WebP or GIF · up to 12 MB (resized to 640px)');
  const onFile = async (file: File) => {
    try {
      onChange(await resizeImageFile(file));
    } catch (e) {
      onChange(photo, e instanceof Error ? e.message : t('Could not process the image.'));
    }
  };
  return (
    <div className="space-y-1">
      <span className="text-sm font-medium">{t('Profile photo')}</span>
      <div className="flex items-center gap-3">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={t('profile')} className="h-16 w-16 rounded-full object-cover ring-1 ring-neutral-300 dark:ring-neutral-700" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-xs text-neutral-500 dark:bg-neutral-800">{t('none')}</div>
        )}
        <div className="space-y-1">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) void onFile(file); e.target.value = ''; }}
            className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-neutral-200 file:px-2 file:py-1 file:text-xs file:font-medium hover:file:bg-neutral-300 dark:file:bg-neutral-800 dark:hover:file:bg-neutral-700"
          />
          {photo ? (
            <button type="button" onClick={() => onChange(null)} className="text-xs text-red-600 hover:underline">{t('Remove')}</button>
          ) : null}
          <p className="text-[11px] text-neutral-500">{resolvedHint}</p>
        </div>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
