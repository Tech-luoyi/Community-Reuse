'use client';

import { Heart, PackageSearch } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ItemRow } from '@/components/features/item-row';
import { SessionGate } from '@/components/features/session-gate';
import { ContractGap } from '@/components/ui/contract-gap';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { RowSkeleton } from '@/components/ui/skeleton';
import { Stagger } from '@/components/ui/stagger';
import { useItemList } from '@/lib/queries';

const PAGE_SIZE = 24;

/**
 * 收藏页。
 *
 * `GET /api/items?favorite=true` 是真的（服务端按当前会话过滤收藏），
 * 缺的是「加收藏」这个动作 —— 没有 `POST /api/items/:id/favorite`，
 * 所以这一页能读不能写，缺口如实标出来而不是藏成一个坏掉的心形按钮。
 */
function Favorites() {
  const [page, setPage] = React.useState(1);
  const list = useItemList({ favorite: true, page, pageSize: PAGE_SIZE });

  const items = list.data?.data ?? [];
  const pagination = list.data?.pagination;
  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
    : 1;

  return (
    <>
      <PageHeader
        eyebrow="FAVORITES · 收藏"
        title="我的收藏"
        desc="列表按你的收藏过滤，是真的；缺的是收藏这个动作本身还没有接口。"
        actions={
          <span className="tnum rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-3">
            {pagination ? `共 ${pagination.total} 件` : '读取中'}
          </span>
        }
      />

      <Panel className="overflow-hidden">
        {list.isPending && (
          <div className="space-y-2.5 p-5">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        )}

        {list.isError && (
          <EmptyState
            icon={PackageSearch}
            title="收藏列表没读到"
            desc={list.error instanceof Error ? list.error.message : '请求失败。'}
            action={
              <button
                type="button"
                className="text-[12.5px] font-medium text-accent hover:underline"
                onClick={() => void list.refetch()}
              >
                重试
              </button>
            }
          />
        )}

        {!list.isPending && !list.isError && items.length === 0 && (
          <EmptyState
            icon={Heart}
            title="还没有收藏过任何物品"
            desc="详情页上没有心形按钮：收藏开关需要的接口还没有，所以目前无法新增收藏。"
            action={
              <Link
                href="/"
                className="text-[12.5px] font-medium text-accent underline-offset-4 hover:underline"
              >
                去集市看看
              </Link>
            }
          />
        )}

        {items.length > 0 && (
          <Stagger className="divide-y divide-line">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </Stagger>
        )}

        {list.data && (
          <div className="hairline-t">
            <Pagination
              page={pagination?.page ?? 1}
              totalPages={totalPages}
              total={pagination?.total}
              onChange={setPage}
            />
          </div>
        )}
      </Panel>

      <ContractGap
        className="mt-5"
        section="§5"
        endpoint="POST /api/items/:id/favorite"
        existsInstead="ItemDto 带 favoriteCount，列表也能按收藏过滤，唯独「收藏 / 取消收藏」这个写入动作没有接口。"
      />
    </>
  );
}

export function FavoritesView() {
  return (
    <SessionGate>
      <Favorites />
    </SessionGate>
  );
}
