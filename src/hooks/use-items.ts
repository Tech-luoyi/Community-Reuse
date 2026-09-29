'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchItems } from '@/lib/api';

export interface ItemFilter {
  q?: string;
  tradeType?: string;
  freshness?: string;
  favorite?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useItems(filter: ItemFilter) {
  return useQuery({
    queryKey: ['items', filter],
    queryFn: () =>
      fetchItems({
        q: filter.q || undefined,
        tradeType: filter.tradeType || undefined,
        freshness: filter.freshness || undefined,
        favorite: filter.favorite ? true : undefined,
        sort: filter.sort ?? 'latest',
        page: filter.page ?? 1,
        pageSize: filter.pageSize ?? 12,
      }),
    placeholderData: keepPreviousData,
  });
}
