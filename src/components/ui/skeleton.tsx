import * as React from 'react';

import { cn } from '@/lib/cn';

/** 骨架屏：形状必须与被替代内容一致，否则加载完成时会发生布局位移。 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-xs', className)} aria-hidden />;
}

export function RowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-4 px-5 py-3.5', className)}>
      <Skeleton className="size-16 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-2.5 w-3/5" />
      </div>
      <Skeleton className="h-4 w-14 shrink-0" />
    </div>
  );
}
