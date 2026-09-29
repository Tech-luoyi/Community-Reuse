'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import type { MeResponseData } from '@/shared/types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => get<MeResponseData>('/api/me'),
    retry: false,
  });
}
