import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // OAuth codes and verification/reset tokens must not appear in dev access logs.
  logging: false,
};

export default config;
