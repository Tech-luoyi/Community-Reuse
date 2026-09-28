/**
 * `POST /api/auth/switch` —— 切换当前社区（MEMBER）。
 *
 * 契约：docs/api-contract.md §1 →
 *   `200 { data: { community } }` + 重新签发会话 Cookie；错误：`FORBIDDEN`。
 *
 * 多租户：只允许切换到**自己是成员**的社区；社区 id 来自请求体但必须命中成员关系，
 * 否则 403（不泄漏该社区是否存在）。
 */
import { SwitchCommunityRequestSchema } from '@/shared/schemas';
import type { CommunitySummary } from '@/shared/types';

import { attachSessionCookie, getSessionFromRequest } from '@/server/auth/session';
import { requireUser } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { jsonOk, parseJsonBody, withRoute } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  const body = await parseJsonBody(request, SwitchCommunityRequestSchema);

  const membership = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId: body.communityId, userId: viewer.id } },
    select: { community: { select: { id: true, name: true } } },
  });
  if (!membership) {
    throw errors.forbidden('你不是该社区的成员');
  }

  const community: CommunitySummary = membership.community;
  const response = jsonOk({ community });
  attachSessionCookie(response, {
    userId: viewer.id,
    currentCommunityId: community.id,
  });
  return response;
});
