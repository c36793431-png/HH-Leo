import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/cron/migration-drift-check": ["./db/migrations/*.sql"],
  },
};

export default nextConfig;
