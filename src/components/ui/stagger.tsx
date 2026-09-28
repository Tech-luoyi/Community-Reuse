'use client';

import * as React from 'react';

import { useInViewOnce } from '@/hooks/use-in-view-once';
import { cn } from '@/lib/cn';

/**
 * 错峰入场容器：直接子元素按顺序上浮 4px，间隔 24ms（曲线见 globals.css 的 `.stagger`）。
 *
 * 进入视口才开始播，所以首屏之下的列表不会在你看到之前就放完。
 * 只影响 opacity 与 transform：脚本没跑起来时内容照常渲染，不会变成一片空白。
 */
export function Stagger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, shown } = useInViewOnce<HTMLDivElement>();

  return (
    <div ref={ref} className={cn('stagger', className)} data-shown={shown}>
      {children}
    </div>
  );
}
