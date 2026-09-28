/**
 * `POST /api/claims/:id/complete` —— 完成交接（OWNER，§4.1）。
 * `ACCEPTED→COMPLETED`+`completedAt`；物品 `RESERVED→ARCHIVED`+`archivedAt`（应用时钟）；通知申请人 `CLAIM_COMPLETED`。
 * 错误：`FORBIDDEN` / `CLAIM_CONFLICT` / `NOT_FOUND`。
 */
import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { completeClaim } from '@/server/claims/service';
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
    const dto = await completeClaim(viewer, claimId);
    return jsonOk(dto);
  },
);
