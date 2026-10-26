import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // OAuth codes and verification/reset tokens must not appear in dev access logs.
  logging: false,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
};

export default config;
