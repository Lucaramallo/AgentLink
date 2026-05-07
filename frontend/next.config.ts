import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.0.116'],
  turbopack: {
    root: '/home/agentlink/AgentLink/frontend',
  },
};
export default nextConfig;
