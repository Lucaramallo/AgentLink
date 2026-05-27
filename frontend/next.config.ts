import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:8000/api/v1/:path*',
      },
      {
        source: '/synthesis-g/:path*',
        destination: 'http://localhost:9001/:path*',
      },
    ];
  },
};
export default nextConfig;
