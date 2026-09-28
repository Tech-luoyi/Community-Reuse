'use client';

import { PackageSearch, RefreshCw, SearchX } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { ItemRow } from '@/components/features/item-row';
import { SessionGate } from '@/components/features/session-gate';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, SearchInput } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { Segmented } from '@/components/ui/segmented';
import { RowSkeleton, Skeleton } from '@/components/ui/skeleton';
import { Stagger } from '@/components/ui/stagger';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/api';
import { useItemList, type ItemListFilter } from '@/lib/queries';
import type { FreshnessCode, ItemSort, ItemStatus, TradeType } from '@/shared/types';

const TRADE_TYPES = ['FREE', 'PAY_WHATEVER', 'FIXED_PRICE', 'OTHER'] as const;
const FRESHNESS_CODES = ['JUST_LISTED', 'NEW', 'OLDER'] as const;
const STATUSES = ['ACTIVE', 'RESERVED', 'ARCHIVED'] as const;
const SORTS = ['latest', 'oldest'] as const;

/** `''` 是「不限」这个前端态，落到 URL 与请求里都会被省略（契约没有 all 这个值）。 */
const TRADE_OPTIONS: { value: TradeType | ''; label: string }[] = [
  { value: '', label: '不限' },
  { value: 'FREE', label: '免费' },
  { value: 'PAY_WHATEVER', label: '随意给' },
  { value: 'FIXED_PRICE', label: '定价' },
  { value: 'OTHER', label: '其他' },
];

const FRESHNESS_OPTIONS: { value: FreshnessCode | ''; label: string }[] = [
  { value: '', label: '不限' },
  { value: 'JUST_LISTED', label: '刚刚' },
  { value: 'NEW', label: '较新' },
  { value: 'OLDER', label: '较早' },
];

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: 'ACTIVE', label: '在架' },
  { value: 'RESERVED', label: '已预约' },
  { value: 'ARCHIVED', label: '已归档' },
];

const SORT_OPTIONS: { value: ItemSort; label: string }[] = [
  { value: 'latest', label: '最新' },
  { value: 'oldest', label: '最早' },
];

/** URL 上的枚举值不可信（手改、旧书签），不在契约枚举里就当没填，而不是把 422 抛给用户。 */
function pick<T extends string>(raw: string | null, allowed: readonly T[]): T | undefined {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

function readFilter(sp: URLSearchParams): ItemListFilter {
  const page = Number(sp.get('page'));
  return {
    q: sp.get('q')?.trim() || undefined,
    category: sp.get('category')?.trim() || undefined,
    tradeType: pick(sp.get('tradeType'), TRADE_TYPES) ?? '',
    freshness: pick(sp.get('freshness'), FRESHNESS_CODES) ?? '',
    status: pick(sp.get('status'), STATUSES),
    sort: pick(sp.get('sort'), SORTS),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

function hasFilter(filter: ItemListFilter): boolean {
  return Boolean(filter.q || filter.category || filter.tradeType || filter.freshness);
}

/**
 * 文本型筛选：本地态立即回显，400ms 后才落到 URL。
 * 每敲一个字打一次接口没有意义，而 URL 是唯一事实源，所以刷新与后退都能还原筛选。
 */
function useDebouncedParam(
  committed: string,
  commit: (next: string) => void,
): [string, (next: string) => void] {
  const [text, setText] = React.useState(committed);

  React.useEffect(() => {
    setText(committed);
  }, [committed]);

  React.useEffect(() => {
    if (text.trim() === committed.trim()) return;
    const timer = setTimeout(() => commit(text.trim()), 400);
    return () => clearTimeout(timer);
  }, [text, committed, commit]);

  return [text, setText];
}

function BrowseList() {
  const router = useRouter();
  const sp = useSearchParams();
  const filter = React.useMemo(() => readFilter(new URLSearchParams(sp.toString())), [sp]);
  const list = useItemList(filter);
  const listTopRef = React.useRef<HTMLDivElement>(null);

  const patch = React.useCallback(
    (next: Record<string, string | undefined>, keepPage = false) => {
      const merged = new URLSearchParams(sp.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === '') merged.delete(key);
        else merged.set(key, value);
      }
      if (!keepPage) merged.delete('page');
      const qs = merged.toString();
      router.replace(qs.length > 0 ? `/?${qs}` : '/', { scroll: false });
    },
    [router, sp],
  );

  const commitQ = React.useCallback(
    (value: string) => patch({ q: value.length > 0 ? value : undefined }),
    [patch],
  );
  const commitCategory = React.useCallback(
    (value: string) => patch({ category: value.length > 0 ? value : undefined }),
    [patch],
  );
  const [qText, setQText] = useDebouncedParam(filter.q ?? '', commitQ);
  const [categoryText, setCategoryText] = useDebouncedParam(filter.category ?? '', commitCategory);

  const clearFilters = () => {
    setQText('');
    setCategoryText('');
    patch({ q: undefined, category: undefined, tradeType: undefined, freshness: undefined });
  };

  const pagination = list.data?.pagination;
  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
    : 1;
  const page = pagination?.page ?? filter.page ?? 1;
  const filtered = hasFilter(filter);
  const items = list.data?.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="MARKET · 物品集市"
        title="物品集市"
        desc="本小区正在流转的闲置。免费、随意给、定价收在同一列里，按发布先后排。"
        actions={
          <span className="tnum rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-3">
            {pagination ? `共 ${pagination.total} 件` : '读取中'}
          </span>
        }
      />

      <Panel className="mb-5 p-3.5">
        <div className="grid grid-cols-1 items-center gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
            <SearchInput value={qText} onValueChange={setQText} placeholder="搜索物品名称" />
            <Input
              aria-label="按分类筛选"
              placeholder="分类，如 家电"
              maxLength={40}
              value={categoryText}
              onChange={(event) => setCategoryText(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel="状态"
              size="sm"
              value={filter.status ?? 'ACTIVE'}
              onChange={(value) => patch({ status: value === 'ACTIVE' ? undefined : value })}
              options={STATUS_OPTIONS}
            />
            <Segmented
              ariaLabel="交易方式"
              size="sm"
              value={filter.tradeType ?? ''}
              onChange={(value) => patch({ tradeType: value })}
              options={TRADE_OPTIONS}
            />
            <Segmented
              ariaLabel="新鲜度"
              size="sm"
              value={filter.freshness ?? ''}
              onChange={(value) => patch({ freshness: value })}
              options={FRESHNESS_OPTIONS}
            />
            <Segmented
              ariaLabel="排序"
              size="sm"
              value={filter.sort ?? 'latest'}
              onChange={(value) => patch({ sort: value === 'latest' ? undefined : value })}
              options={SORT_OPTIONS}
            />
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                清除筛选
              </Button>
            )}
          </div>
        </div>
      </Panel>

      <div ref={listTopRef} />

      <Panel className="overflow-hidden">
        {list.isPending && (
          <div className="space-y-2.5 p-5">
            <Skeleton className="h-3 w-20" />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        )}

        {list.isError && (
          <EmptyState
            icon={isApiError(list.error) && list.error.code === 'NETWORK' ? RefreshCw : SearchX}
            title="这一页没读到"
            desc={
              list.error instanceof Error && list.error.message.length > 0
                ? list.error.message
                : '请求失败。'
            }
            action={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                <RefreshCw size={14} aria-hidden />
                重试
              </Button>
            }
          />
        )}

        {!list.isPending && !list.isError && items.length === 0 && (
          <EmptyState
            icon={PackageSearch}
            title={filtered ? '没有符合条件的物品' : '这个小区还没有在架物品'}
            desc={
              filtered
                ? '换个关键词，或者把筛选条件放宽一点。'
                : '第一位邻居发布之后，这里就会开始有内容。'
            }
            action={
              filtered ? (
                <Button variant="secondary" onClick={clearFilters}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        )}

        {items.length > 0 && (
          <div
            className={cn(
              'ease-out transition-opacity duration-[170ms]',
              list.isFetching && 'opacity-55',
            )}
          >
            <Stagger className="divide-y divide-line">
              {items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </Stagger>
          </div>
        )}

        {list.data && (
          <div className="hairline-t">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={pagination?.total}
              onChange={(next) => {
                patch({ page: String(next) }, true);
                listTopRef.current?.scrollIntoView({ block: 'start' });
              }}
            />
          </div>
        )}
      </Panel>
    </>
  );
}

export function BrowseView() {
  return (
    <SessionGate>
      <BrowseList />
    </SessionGate>
  );
}
