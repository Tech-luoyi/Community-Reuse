'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { ApiError } from '@/lib/api';

/**
 * 全局查询默认值。
 *
 * · `refetchOnWindowFocus: false` —— 本轮要并排跑两个 dev server 做对比，
 *   焦点切换会引发无意义的重查风暴，也会让两边的网络面板互相干扰。
 * · `retry` 排除三类「重试也不会变」的错误：未登录（要跳登录页而不是刷）、
 *   申请冲突（服务端状态已变，重试只会再吃一次 409）、限流（重试等于加重惩罚）。
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (
            error instanceof ApiError &&
            (error.isUnauthenticated || error.isConflict || error.isRateLimited)
          ) {
            return false;
          }
          return failureCount < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
