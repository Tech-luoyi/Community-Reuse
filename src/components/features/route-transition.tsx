'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

/**
 * 路由切换时内容列的一次性上浮。
 *
 * `key` 让容器随路径重挂载，动画因此能重放；这也正好对齐 App Router 的既有行为
 * ——每个路由本来就是新的页面组件，这里不会额外丢状态。侧栏在容器外，不参与动画。
 */
export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="anim-rise">
      {children}
    </div>
  );
}
