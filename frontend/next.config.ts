import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The /api rewrite proxy defaults to ~30s, but some backend calls (lesson
    // regeneration, scenario generation) legitimately take longer; a timeout made
    // the request look failed while the backend carried on.
    proxyTimeout: 120_000,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3500/:path*", // Proxy to Backend
      },
    ];
  },
};

export default nextConfig;
