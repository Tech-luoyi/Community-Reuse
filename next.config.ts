import type { NextConfig } from 'next';

/**
 * 本仓库当前只有后端（Route Handlers）。Next.js 仅作为 REST 接口的 HTTP 载体，
 * 不含任何页面 / 组件（客户本轮明确「前端不用管」）。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
