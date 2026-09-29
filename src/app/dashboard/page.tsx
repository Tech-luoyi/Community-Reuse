'use client';

import dynamic from 'next/dynamic';
import { Crown, Flame, Loader2, Timer } from 'lucide-react';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { Card, EmptyState, ErrorPanel, SectionTitle, Skeleton } from '@/components/ui';
import { useItems } from '@/hooks/use-items';
import type { ItemDto } from '@/shared/types';
import type { StatsDto } from '@/shared/schemas';

/* recharts 约 120 kB：让四张统计卡先画完，图表随后再取，别跟首屏抢带宽。 */
const DashboardCharts = dynamic(() => import('@/components/DashboardCharts'), {
  ssr: false,
  loading: () => (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-72" />
      ))}
    </div>
  ),
});

export default function DashboardPage() {
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    isFetching: statsFetching,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['stats'],
    queryFn: () => get<StatsDto>('/api/stats/community'),
  });
  const { data: itemsData, isLoading: itemsLoading } = useItems({ pageSize: 100 });

  const items: ItemDto[] = useMemo(() => itemsData?.data ?? [], [itemsData]);

  const tradeDist = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((i) => {
      map[i.tradeType] = (map[i.tradeType] ?? 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [items]);

  const freshDist = useMemo(() => {
    const map = { JUST_LISTED: 0, NEW: 0, OLDER: 0 };
    items.forEach((i) => {
      map[i.freshness.code] += 1;
    });
    return [
      { name: '⚡刚上架', value: map.JUST_LISTED },
      { name: '✨新上架', value: map.NEW },
      { name: '📚更早', value: map.OLDER },
    ];
  }, [items]);

  /*
    三张卡全部取自 `GET /api/stats/community`（契约 §7）的服务端聚合：
    按社区全量、按 Asia/Shanghai 自然月，口径与 `monthRange` 逐字一致。
    下面的两张分布图仍按当前页算，所以标题明确写「本页」，不冒充全量。
  */
  const cards = [
    {
      label: '本月发布',
      value: stats?.monthPublished,
      emoji: '📦',
      grad: 'from-emerald-500 to-teal-500',
    },
    {
      label: '本月成交',
      value: stats?.monthCompleted,
      emoji: '🤝',
      grad: 'from-orange-500 to-amber-500',
    },
    { label: '当前在售', value: stats?.activeCount, emoji: '🏷️', grad: 'from-sky-500 to-cyan-500' },
  ];

  if (statsLoading && itemsLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        kicker="数据看板"
        title={
          <>
            社区活跃<span className="text-emerald-600">一览</span>
          </>
        }
        desc={`服务端按社区全量与 ${'Asia/Shanghai'} 自然月聚合${
          stats
            ? `（${stats.monthRange.start.slice(0, 10)} ~ ${stats.monthRange.end.slice(0, 10)}）`
            : ''
        }`}
      />

      {statsError && (
        <ErrorPanel
          title="看板聚合加载失败"
          hint="接口已就位，读不到就是出错了 —— 空值和 0 都会是一个假事实，所以这里不放数字。"
          onRetry={() => void refetchStats()}
          fetching={statsFetching}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label}>
            <Card className="relative overflow-hidden p-4">
              <div
                className={`absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${c.grad} opacity-20 blur-2xl`}
              />
              <div className="text-2xl">{c.emoji}</div>
              <div key={c.label} className="mt-1 text-3xl font-black tabular-nums">
                {c.value ?? '—'}
              </div>
              <div className="text-xs font-bold text-stone-500">{c.label}</div>
            </Card>
          </div>
        ))}
      </div>

      <DashboardCharts tradeDist={tradeDist} freshDist={freshDist} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="transition-transform duration-200 ease-out hover:-translate-y-1">
          <Card className="flex items-center gap-4 bg-gradient-to-br from-amber-50 to-white p-5">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-2xl shadow-lg">
              <Timer size={26} className="text-white" />
            </span>
            <div>
              <div className="flex items-center gap-1.5 text-xs font-black text-amber-700">
                <Flame size={13} /> 最快被领走
              </div>
              {stats?.fastestItem ? (
                <div className="mt-0.5 font-black">
                  {stats.fastestItem.name} · {stats.fastestItem.durationMinutes} 分钟
                </div>
              ) : (
                <div className="mt-0.5 text-sm font-bold text-stone-500">
                  {stats
                    ? '还没有成交记录（口径为全部历史首次成交，不限本月）'
                    : '不可知 —— 聚合请求失败'}
                </div>
              )}
            </div>
          </Card>
        </div>
        <div className="transition-transform duration-200 ease-out hover:-translate-y-1">
          <Card className="flex items-center gap-4 bg-gradient-to-br from-rose-50 to-white p-5">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-pink-500 text-2xl shadow-lg">
              <Crown size={26} className="text-white" />
            </span>
            <div>
              <div className="text-xs font-black text-rose-700">
                ❤️ 最想要（未成交但被想要最多）
              </div>
              {stats?.mostWantedItem ? (
                <div className="mt-0.5 font-black">
                  {stats.mostWantedItem.name} · {stats.mostWantedItem.wantCount} 人想要
                </div>
              ) : (
                <div className="mt-0.5 text-sm font-bold text-stone-500">
                  {stats
                    ? '没有在架物品被想要过（已成交的按定义排除在外）'
                    : '不可知 —— 聚合请求失败'}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {itemsLoading && (
        <div className="flex items-center gap-2 text-sm text-stone-400">
          <Loader2 size={15} className="animate-spin" /> 聚合中…
        </div>
      )}
      {!itemsLoading && items.length === 0 && (
        <EmptyState emoji="📊" title="还没有数据" hint="发布第一件物品，看板就会活过来。" />
      )}
    </div>
  );
}
