# Fallback profile avatars

Drop the placeholder profile artwork here. They're shown wherever a user (DAO
member, submitter, expert) hasn't uploaded their own photo.

- **Single image:** save it as `default-profile.png` (or `.jpg`/`.webp` — then
  update the path in `apps/web/src/components/fallback-avatar.tsx`).
- **Several variants** (each user gets a stable one by name): name them
  `face-1.png`, `face-2.png`, … and list them in `AVATAR_FILES` in
  `fallback-avatar.tsx`.

Recommended: square images (e.g. 256×256 or 512×512), light/transparent
background, ≤ ~100 KB each. Anything in `apps/web/public/` is served at the
site root, so `default-profile.png` here is reachable at `/avatars/default-profile.png`.
