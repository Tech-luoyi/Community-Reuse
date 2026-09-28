/**
 * `POST /api/claims/:id/accept` —— 接受申请（OWNER，§4）。
 * 单事务：申请 `PENDING→ACCEPTED`、物品 `ACTIVE→RESERVED`、其他 `PENDING→REJECTED`、写通知。
 * 错误：`FORBIDDEN`(非发布者) / `CLAIM_CONFLICT`(状态不符/并发被挤) / `NOT_FOUND`(跨社区)。
 */
import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { acceptClaim } from '@/server/claims/service';
import { jsonOk, withRoute } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ClaimRouteContext = { params: Promise<{ id: string }> | { id: string } };

async function resolveClaimId(context: ClaimRouteContext): Promise<string> {
  const resolved = await context.params;
  return resolved.id;
}

export const POST = withRoute(
  async (request: Request, context: ClaimRouteContext): Promise<Response> => {
    const viewer = await requireUser(getSessionFromRequest(request));
    await requireMember(viewer);

    const claimId = await resolveClaimId(context);
    const dto = await acceptClaim(viewer, claimId);
    return jsonOk(dto);
  },
);
