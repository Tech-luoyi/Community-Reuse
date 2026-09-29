'use client';

import dynamic from 'next/dynamic';
import { Heart, Loader2, Timer, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { TRADE_TYPE_LABEL } from '@/lib/format';
import { Card, EmptyState, ErrorPanel, SectionTitle, Skeleton, Stat } from '@/components/ui';
import { useItems } from '@/hooks/use-items';
import type { ItemDto, TradeType } from '@/shared/types';
import type { StatsDto } from '@/shared/schemas';

/* recharts 约 120 kB：让统计卡先画完，图表随后再取，别跟首屏抢带宽。 */
const DashboardCharts = dynamic(() => import('@/components/DashboardCharts'), {
  ssr: false,
  loading: () => (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-64" />
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
    return Object.entries(map).map(([name, value]) => ({
      name: TRADE_TYPE_LABEL[name as TradeType] ?? name,
      value,
    }));
  }, [items]);

  const freshDist = useMemo(() => {
    const map = { JUST_LISTED: 0, NEW: 0, OLDER: 0 };
    items.forEach((i) => {
      map[i.freshness.code] += 1;
    });
    return [
      { name: '刚上架', value: map.JUST_LISTED },
      { name: '新上架', value: map.NEW },
      { name: '更早', value: map.OLDER },
    ];
  }, [items]);

  /*
    三个数字全部取自 `GET /api/stats/community`（契约 §7）的服务端聚合：
    按社区全量、按 Asia/Shanghai 自然月，口径与 `monthRange` 逐字一致。
    下面两张分布图仍按当前页算，所以标题明确写「本页」，不冒充全量。
  */
  if (statsLoading && itemsLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  const monthRangeText = stats
    ? `${stats.monthRange.start.slice(0, 10)} ~ ${stats.monthRange.end.slice(0, 10)}`
    : null;

  return (
    <div className="space-y-6">
      <SectionTitle
        kicker="数据看板"
        title="社区活跃一览"
        desc={
          monthRangeText
            ? `服务端按社区全量与 Asia/Shanghai 自然月聚合（${monthRangeText}）`
            : '服务端按社区全量与 Asia/Shanghai 自然月聚合'
        }
      />

      {statsError && (
        <ErrorPanel
          title="看板聚合加载失败"
          hint="接口已就位，读不到就是出错了 —— 空值和 0 都会是一个假事实，所以这里不放数字。"
          onRetry={() => void refetchStats()}
          fetching={statsFetching}
        />
      )}

      {/* 三个数字放在一个容器里而不是三张卡：它们是同一组指标，不需要各自成卡。 */}
      <Card className="grid gap-6 p-5 sm:grid-cols-3">
        <Stat label="本月发布" value={stats?.monthPublished ?? '—'} />
        <Stat label="本月成交" value={stats?.monthCompleted ?? '—'} />
        <Stat label="当前在售" value={stats?.activeCount ?? '—'} />
      </Card>

      <DashboardCharts tradeDist={tradeDist} freshDist={freshDist} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex items-start gap-3 p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-pending-bg text-pending">
            <Timer size={16} />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink-tertiary">最快被领走</div>
            {stats?.fastestItem ? (
              <p className="mt-0.5 text-sm text-ink">
                {stats.fastestItem.name} · {stats.fastestItem.durationMinutes} 分钟
              </p>
            ) : (
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">
                {stats
                  ? '还没有成交记录（口径为全部历史首次成交，不限本月）'
                  : '不可知 —— 聚合请求失败'}
              </p>
            )}
          </div>
        </Card>

        <Card className="flex items-start gap-3 p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-danger-bg text-danger">
            <Heart size={16} />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink-tertiary">最想要（未成交但被点最多）</div>
            {stats?.mostWantedItem ? (
              <p className="mt-0.5 text-sm text-ink">
                {stats.mostWantedItem.name} · {stats.mostWantedItem.wantCount} 人想要
              </p>
            ) : (
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">
                {stats
                  ? '没有在架物品被想要过（已成交的按定义排除在外）'
                  : '不可知 —— 聚合请求失败'}
              </p>
            )}
          </div>
        </Card>
      </div>

      {itemsLoading && (
        <p className="flex items-center gap-2 text-[13px] text-ink-tertiary">
          <Loader2 size={14} className="animate-spin" /> 正在汇总本页分布…
        </p>
      )}
      {!itemsLoading && items.length === 0 && (
        <EmptyState
          icon={<TrendingUp size={18} />}
          title="还没有数据"
          hint="发布第一件物品，看板就会活过来。"
        />
      )}
    </div>
  );
}
