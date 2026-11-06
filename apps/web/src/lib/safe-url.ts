/** SEC (stored XSS) — defensive render-side guard: only allow http(s)/mailto hrefs on user-supplied
 *  links, else fall back to '#'. The server already strips unsafe schemes at ingest; this is defense
 *  in depth so a legacy/stored `javascript:`/`data:` value can never become an active anchor href. */
export function safeHref(url: string | null | undefined): string {
  const u = (url ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : '#';
}
