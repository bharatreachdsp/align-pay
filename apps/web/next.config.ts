import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@align-agent/paypal-guard"],
  serverExternalPackages: ["@paypal/agent-toolkit", "@modelcontextprotocol/sdk"],
  devIndicators: false,
  poweredByHeader: false,
};

export default config;
