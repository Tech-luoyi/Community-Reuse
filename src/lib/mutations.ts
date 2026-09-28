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
import { useCallback } from 'react';
import { z } from 'zod';

import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import {
  ClaimDtoSchema,
  CommunitySummarySchema,
  FaqResultSchema,
  ItemDtoSchema,
  JoinResponseDataSchema,
  PolishResultSchema,
  PricingResultSchema,
  UserSelfSchema,
  type CreateClaimRequest,
  type CreateItemRequest,
  type FaqRequest,
  type JoinRequest,
  type MeResponseData,
  type PatchMeRequest,
  type PolishRequest,
  type PricingRequest,
} from '@/shared/schemas';

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

/**
 * 改动物品或申请之后要作废的范围。
 *
 * 物品可能落在任意筛选页的列表里，申请同时牵动详情、两侧列表与对手方的收件箱，
 * 所以按前缀批量作废而不是精确 key —— 少失效一处就是拿旧状态继续渲染。
 */
function useInvalidateItemGraph() {
  const queryClient = useQueryClient();

  return useCallback(
    (itemId?: string) => {
      queryClient.invalidateQueries({ queryKey: qk.itemListPrefix() });
      queryClient.invalidateQueries({ queryKey: qk.itemDetailPrefix() });
      queryClient.invalidateQueries({ queryKey: qk.myClaimsPrefix() });
      if (itemId) queryClient.invalidateQueries({ queryKey: qk.itemClaims(itemId) });
    },
    [queryClient],
  );
}

export function useCreateItem() {
  const invalidate = useInvalidateItemGraph();

  return useMutation({
    mutationFn: (body: CreateItemRequest) => api.post('/api/items', ItemDtoSchema, body),
    onSuccess: (item) => invalidate(item.id),
  });
}

export function useCreateClaim(itemId: string) {
  const invalidate = useInvalidateItemGraph();

  return useMutation({
    mutationFn: (body: CreateClaimRequest) =>
      api.post(`/api/items/${itemId}/claims`, ClaimDtoSchema, body),
    onSuccess: () => invalidate(itemId),
  });
}

/** 契约 §4 状态机的四条转移边，路径都是 `/api/claims/:id/<action>`。 */
export type ClaimAction = 'accept' | 'reject' | 'complete' | 'cancel';

/** 状态机的四条转移边共用一个 hook：路径是 `/api/claims/:id/<action>`，返回转移后的 DTO。 */
export function useClaimAction(action: ClaimAction) {
  const invalidate = useInvalidateItemGraph();

  return useMutation({
    mutationFn: (claim: { id: string; itemId: string }) =>
      api.post(`/api/claims/${claim.id}/${action}`, ClaimDtoSchema),
    onSuccess: (_result, claim) => invalidate(claim.itemId),
  });
}

export function useArchiveItem() {
  const invalidate = useInvalidateItemGraph();

  return useMutation({
    mutationFn: (itemId: string) => api.post(`/api/items/${itemId}/archive`, ItemDtoSchema),
    onSuccess: (item) => invalidate(item.id),
  });
}

export function usePatchMe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PatchMeRequest) =>
      api.patch('/api/me', z.object({ user: UserSelfSchema }), body),
    onSuccess: (result) =>
      queryClient.setQueryData<MeResponseData>(qk.me(), (previous) =>
        previous ? { ...previous, user: result.user } : previous,
      ),
  });
}

/**
 * 三个 LLM 能力都是即时建议、结果不入库，所以既不写缓存也不作废任何查询：
 * 点一次就是一次真实请求。限流 10 次/分钟/人，RATE_LIMITED 由调用方原样转成文案。
 */
export function useAiPricing() {
  return useMutation({
    mutationFn: (body: PricingRequest) => api.post('/api/ai/pricing', PricingResultSchema, body),
  });
}

export function useAiPolish() {
  return useMutation({
    mutationFn: (body: PolishRequest) => api.post('/api/ai/polish', PolishResultSchema, body),
  });
}

/** 后端没有校验调用者是否物主（契约 §7），所以这个面板只在前端确认 isOwner 后才挂载。 */
export function useAiFaq() {
  return useMutation({
    mutationFn: (body: FaqRequest) => api.post('/api/ai/faq', FaqResultSchema, body),
  });
}
