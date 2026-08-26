/** @type {import('next').NextConfig} */

// SEC-08 — baseline security headers for the Next-served HTML/asset responses (the API middleware
// only covers /api responses). CSP ships in Report-Only first: it observes and logs violations
// WITHOUT blocking anything, so the policy can be validated against the real app (wallet connect,
// data:-URI images, markdown) before it is switched to enforcing.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // Next.js hydration uses inline bootstrap scripts; 'unsafe-inline' is tolerable while Report-Only
  // and will be tightened to a nonce before enforcing.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:", // wallet icons + member photos are data: URIs
  "font-src 'self' data:",
  "connect-src 'self' https:", // API is same-origin; https: covers any explicit API origin
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  reactStrictMode: true,
  // Workspace libs ship compiled CJS + d.ts; transpile them so Next bundles cleanly.
  transpilePackages: ['@drep-dao/shared', '@drep-dao/cardano'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
