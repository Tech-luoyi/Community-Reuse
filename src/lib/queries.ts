'use client';

/**
 * React Query 的 key 工厂与查询 hooks。
 *
 * key 设计原则：**按前缀失效**。物品可能落在任意筛选页里，所以改动物品后失效的是
 * `['items','list']` 整个前缀而不是某一个精确 key。
 */
import { keepPreviousData, useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import * as React from 'react';
import { z } from 'zod';

import { api, type ListResult } from '@/lib/api';
import {
  ClaimDtoSchema,
  HealthDataSchema,
  ItemDetailDtoSchema,
  ItemDtoSchema,
  MeResponseDataSchema,
} from '@/shared/schemas';
import type {
  ClaimDto,
  FreshnessCode,
  HealthData,
  ItemDetailDto,
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

export function useItemDetail(id: string): UseQueryResult<ItemDetailDto, Error> {
  return useQuery({
    queryKey: qk.itemDetail(id),
    queryFn: ({ signal }) => api.get(`/api/items/${id}`, ItemDetailDtoSchema, undefined, signal),
  });
}

/**
 * 某件物品上的申请列表。`GET /api/items/:id/claims` 只对物主开放，
 * 所以 `enabled` 由详情接口的 `viewer.isOwner` 决定 —— 不是先发了 403 再吞掉。
 */
export function useItemClaims(id: string, enabled: boolean): UseQueryResult<ClaimDto[], Error> {
  return useQuery({
    queryKey: qk.itemClaims(id),
    queryFn: ({ signal }) =>
      api.get(`/api/items/${id}/claims`, z.array(ClaimDtoSchema), undefined, signal),
    enabled,
  });
}

/** 我发起的（applied）/ 我收到的（received）。后端返回不带分页的全量数组。 */
export function useMyClaims(as: 'applied' | 'received'): UseQueryResult<ClaimDto[], Error> {
  return useQuery({
    queryKey: qk.myClaims(as),
    queryFn: ({ signal }) => api.get('/api/me/claims', z.array(ClaimDtoSchema), { as }, signal),
  });
}

export interface ItemSummary {
  id: string;
  name: string;
  category: string | null;
  coverUrl: string | null;
}

/**
 * 用详情接口补齐「申请行」上的物品摘要。
 *
 * `ClaimDto` 只有 `itemId`（契约 §4），而只有编号的行读不出是什么东西；
 * 这里按 id 去重后逐条取详情，命中的正好是 `useItemDetail` 用的同一份缓存。
 * 上限 24 条：再多就是给一页列表发 24 个请求，宁可让超出的行退回等宽编号。
 */
export function useItemSummaries(ids: string[]): {
  summaries: Map<string, ItemSummary>;
  isLoading: boolean;
} {
  const unique = React.useMemo(
    () => Array.from(new Set(ids.filter((id) => id.length > 0))).slice(0, 24),
    [ids],
  );

  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: qk.itemDetail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get(`/api/items/${id}`, ItemDetailDtoSchema, undefined, signal),
    })),
  });

  const summaries = new Map<string, ItemSummary>();
  unique.forEach((id, index) => {
    const data = results[index]?.data;
    if (!data) return;
    summaries.set(id, {
      id,
      name: data.name,
      category: data.category,
      coverUrl: data.coverUrl,
    });
  });

  return {
    summaries,
    isLoading: unique.length > 0 && results.some((result) => result.isPending),
  };
}
