import type { NextConfig } from 'next';

/**
 * 同仓全栈：App Router 页面（src/app 下的 page.tsx）+ Route Handlers（src/app/api）。
 * 两侧靠 D8 解耦 —— 前端只能引 src/shared|lib|components，后端只能引 src/server + src/shared
 * （规则见 eslint.config.mjs 的 no-restricted-imports）。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
