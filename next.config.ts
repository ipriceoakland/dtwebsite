import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    const backendOrigin = process.env.DELTATIME_BACKEND_ORIGIN ??
      (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8787" : null);
    if (!backendOrigin) return [];

    return [{
      source: "/api/auth/:path*",
      destination: new URL("/api/auth/:path*", backendOrigin).href,
    }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
