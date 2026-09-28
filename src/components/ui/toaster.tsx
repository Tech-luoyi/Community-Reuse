'use client';

import { Toaster as SonnerToaster } from 'sonner';

/**
 * sonner 重染入口。
 *
 * 默认主题是蓝底大圆角 + 彩色图标，是全站唯一会跑调的元素，
 * 所以配色统一在 globals.css 的 `[data-sonner-toast]` 块里改回纸墨 + 发丝线，
 * 这里只负责定位与无障碍属性。
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      gap={8}
      offset={20}
      toastOptions={{ duration: 4000 }}
      closeButton={false}
    />
  );
}
