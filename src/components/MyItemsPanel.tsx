'use client';

import Link from 'next/link';
import { Loader2, Package } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { formatPrice, itemStatusMeta, ITEM_STATUS_LABEL } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorPanel, Skeleton } from './ui';
import type { ItemDto, ItemStatus } from '@/shared/types';

const TABS: { key: 'ALL' | ItemStatus; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'ACTIVE', label: '在架' },
  { key: 'RESERVED', label: '待面交' },
  { key: 'ARCHIVED', label: '已送出' },
];

/**
 * 我的发布（`GET /api/me/items`，契约 §6）。缺省不带 `status`，
 * 服务端返回三种状态全量 —— 这也是已归档物品在界面上唯一的入口，
 * 否则「可查看但不可操作」的物品将只能靠直链访问。
 */
export function MyItemsPanel() {
  const [tab, setTab] = useState<'ALL' | ItemStatus>('ALL');

  const {
    data: items,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['my-items', tab],
    queryFn: () => get<ItemDto[]>('/api/me/items', tab === 'ALL' ? undefined : { status: tab }),
  });

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Package size={15} className="text-ink-tertiary" /> 我的发布
        <span className="ml-auto text-[11px] text-ink-tertiary">含已归档</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={`h-7 rounded-full border px-2.5 text-xs transition-colors ${
                active
                  ? 'border-ink bg-ink text-white'
                  : 'border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      )}

      {isError && !isLoading && (
        <ErrorPanel
          title="读取失败"
          hint="接口已就位，读不到就是出错了 —— 不降级成「还没有发布物品」。"
          onRetry={() => void refetch()}
          fetching={isFetching}
        />
      )}

      {items?.length === 0 && !isLoading && !isError && (
        <EmptyState
          icon={<Package size={18} />}
          title={tab === 'ALL' ? '你还没有发布过物品' : `没有${ITEM_STATUS_LABEL[tab]}的物品`}
          hint="发布一件，30 秒的事。"
          action={
            <Link href="/items/new">
              <Button size="sm">去发布</Button>
            </Link>
          }
        />
      )}

      {!!items?.length && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {items.map((i) => {
            const status = itemStatusMeta(i.status);
            return (
              <li key={i.id}>
                <Link
                  href={`/items/${i.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{i.name}</span>
                  {isFetching && (
                    <Loader2 size={13} className="shrink-0 animate-spin text-ink-tertiary" />
                  )}
                  <span className="shrink-0 text-[13px] font-medium text-ink tabular">
                    {formatPrice(i.price, i.tradeType)}
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
