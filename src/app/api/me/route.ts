/**
 * `GET` / `PATCH /api/me` —— 当前用户资料（MEMBER）。
 *
 * 契约：docs/api-contract.md §1。
 *   - `GET  ` → `200 { data: { user, memberships, currentCommunity } }`；错误 `UNAUTHENTICATED`。
 *   - `PATCH` → `{ nickname?, contactText? }` → `200 { data: { user } }`；错误 `INVALID_INPUT` / `UNAUTHENTICATED`。
 *
 * ★ D1 闭环：`PATCH /api/me` 是 `contactText` 的**唯一写入入口**；空串等价于清空为 `null`。
 *   写入**不改变**可见性规则（仅对 ACCEPTED/COMPLETED 的交易对手方展示，见 §4 / auth/contact.ts）。
 */
import type { Prisma } from '@prisma/client';

import { PatchMeRequestSchema } from '@/shared/schemas';
import type { MeResponseData, UserSelf } from '@/shared/types';

import { normalizeContactText } from '@/server/auth/contact';
import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { jsonOk, parseJsonBody, withRoute } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);

  const [memberships, currentCommunity] = await Promise.all([
    prisma.communityMember.findMany({
      where: { userId: viewer.id },
      select: { communityId: true },
    }),
    prisma.community.findUnique({
      where: { id: viewer.currentCommunityId },
      select: { id: true, name: true },
    }),
  ]);

  if (!currentCommunity) {
    // 会话指向的社区已不存在（防御性；正常流程不会发生）。
    throw errors.forbidden('当前社区不存在，请重新加入');
  }

  const data: MeResponseData = {
    user: { id: viewer.id, nickname: viewer.nickname, contactText: viewer.contactText },
    memberships,
    currentCommunity,
  };
  return jsonOk(data);
});

export const PATCH = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);
  const body = await parseJsonBody(request, PatchMeRequestSchema);

  const data: Prisma.UserUpdateInput = {};
  if (body.nickname !== undefined) {
    data.nickname = body.nickname;
  }
  if (body.contactText !== undefined) {
    // 空串 / 纯空白 → null（清空）；否则去首尾空白存储。
    // 归一化极端情况会抛 RangeError(>120) —— 转成契约错误码，避免被 normalizeError 收敛成 500。
    try {
      data.contactText = normalizeContactText(body.contactText) ?? null;
    } catch (error) {
      if (error instanceof RangeError) {
        throw errors.invalidInput(error.message);
      }
      throw error;
    }
  }

  const user = await prisma.user.update({
    where: { id: viewer.id },
    data,
    select: { id: true, nickname: true, contactText: true },
  });

  const result: { user: UserSelf } = { user };
  return jsonOk(result);
});
