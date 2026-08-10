/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace libs ship compiled CJS + d.ts; transpile them so Next bundles cleanly.
  transpilePackages: ['@drep-dao/shared', '@drep-dao/cardano'],
};

export default nextConfig;
