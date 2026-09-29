'use client';

import Link from 'next/link';
import { Loader2, Package } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { formatPrice, ITEM_STATUS_LABEL } from '@/lib/format';
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
      <div className="mb-3 flex items-center gap-2 text-sm font-black">
        <Package size={16} className="text-emerald-600" /> 我的发布
        <span className="ml-auto text-[11px] font-bold text-stone-400">含已归档</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-2.5 py-1 text-xs font-bold transition ${
              tab === t.key ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            {t.label}
          </button>
        ))}
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
          emoji="📦"
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
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.id}>
              <Link
                href={`/items/${i.id}`}
                className="flex items-center gap-2.5 rounded-2xl border border-stone-200/70 bg-white px-3 py-2.5 transition hover:border-emerald-300 hover:bg-emerald-50/40"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-black">{i.name}</span>
                {isFetching && <Loader2 size={13} className="animate-spin text-stone-300" />}
                <span className="shrink-0 text-xs font-black text-emerald-700">
                  {formatPrice(i.price, i.tradeType)}
                </span>
                <Badge
                  className={
                    i.status === 'ARCHIVED'
                      ? 'bg-stone-200 text-stone-600'
                      : i.status === 'RESERVED'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                  }
                >
                  {ITEM_STATUS_LABEL[i.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
