/**
 * `GET /api/me/claims?as=applied|received` —— 我发起的 / 我收到的领取申请（§4）。
 *
 * 权限 MEMBER；作用域仅当前会话社区；按 `createdAt DESC`。
 * `received` 每条按 D1 规则带 `contactText` 可见性（仅 ACCEPTED/COMPLETED 时对交易对手方可见）。
 */
import { ClaimListQuerySchema } from '@/shared/schemas';

import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { listMyClaims } from '@/server/claims/service';
import { jsonOk, parseSearchParams, withRoute } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);

  const query = parseSearchParams(request, ClaimListQuerySchema);
  const dtos = await listMyClaims(viewer, query.as);
  return jsonOk(dtos);
});
