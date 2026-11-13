import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let phones and other machines on the home network use the dev server (Next blocks
  // cross-origin dev requests such as hot reload unless the origin is listed).
  allowedDevOrigins: ["192.168.1.*", "grond-linux.local"],
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
