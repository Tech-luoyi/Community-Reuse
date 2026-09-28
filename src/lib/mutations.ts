'use client';

/**
 * 写操作集中在这里：每个 mutation 自己声明成功后要作废哪些缓存，
 * 页面因此不需要知道 query key 的结构。
 *
 * 会话级变更（加入 / 切换社区 / 退出）一律 `clear()`：这三件事会让**所有**已缓存数据失效，
 * 按前缀逐个失效既啰嗦又容易漏（漏一个就是拿旧社区的数据渲染新社区）。
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { CommunitySummarySchema, JoinResponseDataSchema, type JoinRequest } from '@/shared/schemas';

const OkSchema = z.object({ ok: z.boolean() });
const SwitchResponseSchema = z.object({ community: CommunitySummarySchema });

export function useJoin() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (body: JoinRequest) => api.post('/api/auth/join', JoinResponseDataSchema, body),
    onSuccess: () => {
      // Cookie 已随响应种下；`me` 之前以 401 失败过，必须显式作废才会重新拉取
      queryClient.invalidateQueries({ queryKey: qk.me() });
      router.replace('/');
    },
  });
}

export function useSwitchCommunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (communityId: string) =>
      api.post('/api/auth/switch', SwitchResponseSchema, { communityId }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.invalidateQueries({ queryKey: qk.me() });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => api.post('/api/auth/logout', OkSchema),
    onSuccess: () => {
      queryClient.clear();
      router.replace('/join');
    },
  });
}
