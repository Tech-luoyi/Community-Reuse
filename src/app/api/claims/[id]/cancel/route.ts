/**
 * `POST /api/claims/:id/cancel` —— 取消申请（申请人本人，§4.1）。
 * `PENDING→CANCELED`（物品不变）；`ACCEPTED→CANCELED` 且释放物品（`RESERVED→ACTIVE`，`reservedAt=null`）。
 * 不发通知（`NotificationType` 无 cancel 语义）。错误：`FORBIDDEN` / `CLAIM_CONFLICT` / `NOT_FOUND`。
 */
import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { cancelClaim } from '@/server/claims/service';
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
    const dto = await cancelClaim(viewer, claimId);
    return jsonOk(dto);
  },
);
