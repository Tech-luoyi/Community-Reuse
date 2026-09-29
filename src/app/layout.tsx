import type { Metadata } from 'next';
import { AmbientBackground } from '@/components/AmbientBackground';
import { AppShell } from '@/components/AppShell';
import { Providers } from '@/components/providers';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

export const metadata: Metadata = {
  title: '邻里流转 · 小区闲置流转',
  description: '让闲置物品在沉没之前被看到 — 小区/楼栋/办公室内部流转工具',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <TooltipProvider>
          <Providers>
            <AmbientBackground />
            <AppShell>{children}</AppShell>
          </Providers>
        </TooltipProvider>
      </body>
    </html>
  );
}
