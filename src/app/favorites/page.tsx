'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { EmptyState, ErrorPanel, SectionTitle, Skeleton } from '@/components/ui';
import { ItemCard } from '@/components/ItemCard';
import type { ItemDto } from '@/shared/types';

export default function FavoritesPage() {
  const {
    data: items,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['my-favorites'],
    queryFn: () => get<ItemDto[]>('/api/me/favorites'),
  });

  return (
    <div className="space-y-4">
      <SectionTitle
        kicker="收藏夹"
        title={
          <>
            我的<span className="text-rose-500">心动好物</span>
          </>
        }
        desc="点过 ❤️ 的都在这里；被别人抢先也没关系，继续找下一个。"
      />

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <ErrorPanel
          title="收藏夹读取失败"
          hint="接口已就位，读不到就是出错了 —— 不降级成「收藏夹还空着」。"
          onRetry={() => void refetch()}
          fetching={isFetching}
        />
      )}

      {items?.length === 0 && !isLoading && !isError && (
        <EmptyState emoji="💌" title="收藏夹还是空的" hint="在物品详情页点 ❤️ 就会出现在这里。" />
      )}

      {!!items?.length && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
