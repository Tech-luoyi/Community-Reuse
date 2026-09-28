import type { NextConfig } from 'next';

/**
 * Next.js 在这里同时承载 REST 接口（`/api/**` Route Handlers）与前端页面（App Router）。
 *
 * 刻意不配置 `images`：物品封面用原生 `<img>` 而不是 `next/image` —— 种子封面是 SVG，
 * 走 next/image 必须打开 `dangerouslyAllowSVG`，那是个 XSS 口子，不值得为兜底盘承担。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
