/**
 * `POST /api/claims/:id/reject` —— 拒绝申请（OWNER，§4.1）。
 * `PENDING→REJECTED`（物品不变）；`ACCEPTED→REJECTED` 且释放物品（`RESERVED→ACTIVE`，`reservedAt=null`）。
 * 错误：`FORBIDDEN` / `CLAIM_CONFLICT` / `NOT_FOUND`。
 */
import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { rejectClaim } from '@/server/claims/service';
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
    const dto = await rejectClaim(viewer, claimId);
    return jsonOk(dto);
  },
);
