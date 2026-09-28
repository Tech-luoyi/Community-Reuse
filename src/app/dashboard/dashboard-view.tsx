'use client';

import { RefreshCw } from 'lucide-react';
import * as React from 'react';

import { BarSeries } from '@/components/features/bar-series';
import { FreshnessRibbon } from '@/components/features/freshness-ribbon';
import { PriceStrip } from '@/components/features/price-strip';
import { SessionGate } from '@/components/features/session-gate';
import { StatTile } from '@/components/features/stat-tile';
import { Button } from '@/components/ui/button';
import { ContractGap } from '@/components/ui/contract-gap';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Inset, Panel, PanelHeader } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { SCAN_PAGE_SIZE, useMyClaims, useStatusScan } from '@/lib/queries';
import type { FreshnessCode } from '@/shared/types';

const FALLBACK_FRESHNESS_LABEL: Record<FreshnessCode, string> = {
  JUST_LISTED: '刚刚上架',
  NEW: '较新',
  OLDER: '较早',
};

const FRESHNESS_ORDER: FreshnessCode[] = ['JUST_LISTED', 'NEW', 'OLDER'];

function Dashboard() {
  const scan = useStatusScan();
  const applied = useMyClaims('applied');
  const received = useMyClaims('received');

  const stats = React.useMemo(() => {
    const active = scan.items.filter((item) => item.status === 'ACTIVE');
    const archived = scan.items.filter((item) => item.status === 'ARCHIVED');

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const counts = new Map<string, number>();
    for (const item of active) {
      const key = item.category?.trim() || '未分类';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return {
      activeCount: active.length,
      archivedCount: archived.length,
      monthCount: scan.items.filter((item) => new Date(item.publishedAt) >= monthStart).length,
      bars: Array.from(counts, ([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
      points: archived
        .filter((item) => item.tradeType === 'FIXED_PRICE' && item.price !== null)
        .map((item) => ({ id: item.id, price: item.price ?? 0, label: item.name })),
      freshness: FRESHNESS_ORDER.map((code) => ({
        code,
        label:
          active.find((item) => item.freshness.code === code)?.freshness.label ??
          FALLBACK_FRESHNESS_LABEL[code],
        count: active.filter((item) => item.freshness.code === code).length,
      })),
    };
  }, [scan.items]);

  if (scan.isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-[104px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (scan.isError) {
    return (
      <Panel className="mt-6">
        <EmptyState
          icon={RefreshCw}
          title="看板数据没读到"
          desc="社区统计是翻物品列表算出来的，列表请求失败时这里没有可展示的数字。"
          action={
            <Button variant="secondary" onClick={scan.refetch}>
              重试
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="DASHBOARD · 数据看板"
        title="小区流转概况"
        desc="这些数字全部由 GET /api/items 现算，不是后端给的统计口径。"
        actions={
          <Button variant="secondary" size="sm" onClick={scan.refetch}>
            <RefreshCw size={13} aria-hidden />
            重新计算
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="在架物品" value={stats.activeCount} unit="件" hint="当前社区 ACTIVE" />
        <StatTile
          label="本月发布"
          value={stats.monthCount}
          unit="件"
          hint="按浏览器本地时区的当月"
        />
        <StatTile
          label="已归档"
          value={stats.archivedCount}
          unit="件"
          hint="归档即视为这一件流转结束"
        />
        <StatTile
          label="我的申请"
          value={applied.data?.length ?? '—'}
          unit="条"
          hint={`同时收到 ${received.data?.length ?? '—'} 条`}
        />
      </div>

      {scan.truncated && (
        <Inset className="mt-4">
          <div className="label-xs">口径说明</div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
            某个状态的社区物品超过 <span className="tnum">{SCAN_PAGE_SIZE}</span> 件，
            而接口单页上限就是它：下面的数字只覆盖每种状态的第一页，是抽样不是全量。
          </p>
        </Inset>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel className="p-5">
          <PanelHeader
            className="border-0 px-0 pt-0 pb-4"
            eyebrow="DISTRIBUTION"
            title="在架品类分布"
            desc="条宽按最大值归一，占比写在数值列。"
          />
          <BarSeries data={stats.bars} total={stats.activeCount} />
        </Panel>

        <Panel className="p-5">
          <PanelHeader
            className="border-0 px-0 pt-0 pb-4"
            eyebrow="PRICE · STRIP PLOT"
            title="成交价分布"
            desc="只统计已归档且定价的物品。"
          />
          <PriceStrip points={stats.points} />
        </Panel>

        <Panel className="p-5 lg:col-span-2">
          <PanelHeader
            className="border-0 px-0 pt-0 pb-4"
            eyebrow="FRESHNESS RIBBON"
            title="新鲜度构成"
            desc="分桶与文案都取服务端 freshness 字段，前端不重算时间差。"
          />
          <FreshnessRibbon segments={stats.freshness} />
        </Panel>
      </div>

      <div className="mt-5">
        <ContractGap
          section="§7"
          endpoint="GET /api/stats/community"
          existsInstead="社区级完成数、最快交接时间、活跃邻居数没有接口可算，所以这里不放这些数字；上方所有统计都是翻物品列表现算的结果。"
        />
      </div>
    </>
  );
}

export function DashboardView() {
  return (
    <SessionGate>
      <Dashboard />
    </SessionGate>
  );
}
