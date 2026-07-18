import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The Cycle Time page was renamed to Process Health Monitoring. This
      // preserves old bookmarks/links. Source matches the page URL exactly, so
      // it does NOT shadow the /api/cycle-time/* routes (a distinct path).
      {
        source: "/cycle-time",
        destination: "/process-health",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
