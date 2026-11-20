import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No Next.js "N" badge on the dev server (it never shows in production)
  devIndicators: false,
};

export default nextConfig;
