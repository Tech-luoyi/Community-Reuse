/**
 * `POST /api/auth/join` —— 用邀请码加入社区（GUEST）。
 *
 * 契约：docs/api-contract.md §1 →
 *   `201 { data: { user, community, memberships } }` + `Set-Cookie`。
 *   错误：`INVALID_INPUT`（体校验）/ `NOT_FOUND`（邀请码无效）。
 *
 * 行为：校验邀请码 → 新建 `User` 并建 `CommunityMember`（同一事务）→ 签发会话 Cookie。
 */
import { JoinRequestSchema } from '@/shared/schemas';
import type { JoinResponseData } from '@/shared/types';

import { attachSessionCookie } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { jsonCreated, parseJsonBody, withRoute } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withRoute(async (request: Request): Promise<Response> => {
  const body = await parseJsonBody(request, JoinRequestSchema);

  const community = await prisma.community.findUnique({
    where: { inviteCode: body.inviteCode },
    select: { id: true, name: true },
  });
  if (!community) {
    throw errors.notFound('邀请码无效');
  }

  const user = await prisma.user.create({
    data: {
      nickname: body.nickname,
      memberships: { create: { communityId: community.id } },
    },
    select: { id: true, nickname: true },
  });

  const data: JoinResponseData = {
    user,
    community,
    memberships: [{ communityId: community.id }],
  };

  const response = jsonCreated(data);
  attachSessionCookie(response, { userId: user.id, currentCommunityId: community.id });
  return response;
});
