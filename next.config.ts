import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: process.env.NEXT_PUBLIC_SUPABASE_URL ? [
      new URL(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/gallery-photos/**`),
    ] : [],
  },
  async headers() {
    return [{ source: "/page-art/:file", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
  outputFileTracingIncludes: { "/api/factory": ["./app/fonts/anton.ttf"] },
  experimental: {
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
