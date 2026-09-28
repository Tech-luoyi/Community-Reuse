import type { Metadata } from 'next';
import { Suspense } from 'react';

import { BrowseView } from './browse-view';
import { RowSkeleton, Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: '物品集市',
  description: '本小区正在流转的闲置：免费、随意给、定价都在同一列里',
};

/**
 * 集市页。`BrowseView` 用 `useSearchParams` 把筛选存在 URL 里，
 * 所以整棵子树要包一层 Suspense —— 外壳先出，列表位置放骨架。
 */
export default function BrowsePage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-2.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-52" />
          <div className="mt-7 space-y-2.5">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        </div>
      }
    >
      <BrowseView />
    </Suspense>
  );
}
