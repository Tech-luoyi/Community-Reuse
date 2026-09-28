import type { Metadata, Viewport } from 'next';
import * as React from 'react';

import { AppSidebar } from '@/components/features/app-sidebar';
import { RouteTransition } from '@/components/features/route-transition';
import { QueryProvider } from '@/components/providers/query-provider';
import { Toaster } from '@/components/ui/toaster';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '邻里流转',
    template: '%s · 邻里流转',
  },
  description: '小区闲置物品流转工具 · 邻里之间把闲下来的东西交给用得上的人',
};

export const viewport: Viewport = {
  themeColor: '#faf9f7',
  colorScheme: 'light',
};

/**
 * 根布局：完整静态外壳在这里服务端渲染出来（侧栏 / 社区槽 / 发丝线 / 内容列）。
 *
 * 门禁刻意**不放这里** —— `verifySessionToken` 依赖 node:crypto，Edge 跑不了，
 * 而在布局层判断 Cookie 是否存在只是安全剧场。外壳不读会话，
 * 所以数据未到时只有内容列显示骨架，外壳零位移；鉴权由各页的 SessionGate 负责。
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-paper text-ink antialiased">
        <QueryProvider>
          <div className="flex min-h-dvh">
            <AppSidebar />
            <main className="min-w-0 flex-1 px-4 pt-[72px] pb-12 sm:px-6 lg:px-8 lg:pt-8">
              <div className="mx-auto w-full max-w-[1160px]">
                <RouteTransition>{children}</RouteTransition>
              </div>
            </main>
          </div>
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
