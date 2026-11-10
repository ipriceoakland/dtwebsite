import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.19"],
  async rewrites() {
    const backendOrigin = process.env.DELTATIME_BACKEND_ORIGIN ??
      (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8787" : null);
    if (!backendOrigin) return [];

    return ["/api/auth/:path*", "/api/reminders", "/api/reminders/:id", "/api/notifications"].map((source) => ({
      source,
      destination: new URL(source, backendOrigin).href,
    }));
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
