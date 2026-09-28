'use client';

/**
 * React Query 的 key 工厂与查询 hooks。
 *
 * key 设计原则：**按前缀失效**。物品可能落在任意筛选页里，所以改动物品后失效的是
 * `['items','list']` 整个前缀而不是某一个精确 key。
 */
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api, type ListResult } from '@/lib/api';
import { HealthDataSchema, ItemDtoSchema, MeResponseDataSchema } from '@/shared/schemas';
import type {
  FreshnessCode,
  HealthData,
  ItemDto,
  ItemSort,
  ItemStatus,
  MeResponseData,
  TradeType,
} from '@/shared/types';

export const qk = {
  me: () => ['me'] as const,
  health: () => ['health'] as const,
  itemList: (query: Record<string, string | number | undefined>) =>
    ['items', 'list', query] as const,
  itemListPrefix: () => ['items', 'list'] as const,
  itemDetail: (id: string) => ['items', 'detail', id] as const,
  itemDetailPrefix: () => ['items', 'detail'] as const,
  itemClaims: (id: string) => ['items', 'claims', id] as const,
  myClaims: (as: 'applied' | 'received') => ['claims', 'mine', as] as const,
  myClaimsPrefix: () => ['claims', 'mine'] as const,
};

export interface ItemListFilter {
  q?: string;
  category?: string;
  tradeType?: TradeType | '';
  status?: ItemStatus;
  freshness?: FreshnessCode | '';
  sort?: ItemSort;
  page?: number;
  pageSize?: number;
}

/**
 * 省略契约默认值（`status=ACTIVE` / `sort=latest` / `page=1` / `pageSize=20`），
 * 让 URL 与 cache key 都保持最短；语义与 `ItemListQuerySchema` 的 default 一致。
 */
export function serializeItemListQuery(
  filter: ItemListFilter,
): Record<string, string | number | undefined> {
  return {
    q: filter.q?.trim() ? filter.q.trim() : undefined,
    category: filter.category?.trim() ? filter.category.trim() : undefined,
    tradeType: filter.tradeType || undefined,
    status: filter.status && filter.status !== 'ACTIVE' ? filter.status : undefined,
    freshness: filter.freshness || undefined,
    sort: filter.sort && filter.sort !== 'latest' ? filter.sort : undefined,
    page: filter.page && filter.page > 1 ? filter.page : undefined,
    pageSize: filter.pageSize && filter.pageSize !== 20 ? filter.pageSize : undefined,
  };
}

export function useSession(): UseQueryResult<MeResponseData, Error> {
  return useQuery({
    queryKey: qk.me(),
    queryFn: ({ signal }) => api.get('/api/me', MeResponseDataSchema, undefined, signal),
    // 未登录是正常状态而非故障：不重试，交给 SessionGate 决定跳转
    retry: false,
    staleTime: 30_000,
  });
}

export function useHealth(): UseQueryResult<HealthData, Error> {
  return useQuery({
    queryKey: qk.health(),
    queryFn: ({ signal }) => api.get('/api/health', HealthDataSchema, undefined, signal),
    retry: false,
    staleTime: 60_000,
  });
}

export function useItemList(filter: ItemListFilter): UseQueryResult<ListResult<ItemDto>, Error> {
  const query = serializeItemListQuery(filter);
  return useQuery({
    queryKey: qk.itemList(query),
    queryFn: ({ signal }) => api.list('/api/items', ItemDtoSchema, query, signal),
    // 翻页/改筛选时保留上一页数据，避免整页骨架闪烁
    placeholderData: keepPreviousData,
  });
}
