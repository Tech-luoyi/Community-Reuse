/**
 * `POST /api/items/:id/claims`（提交申请） · `GET /api/items/:id/claims`（查看申请）
 *
 * 契约：docs/api-contract.md §4。
 *   - POST：`{ message?, preferredAt?, preferredLocation? }` → `201 { data: ClaimDto }`；
 *           错误 `INVALID_INPUT` / `FORBIDDEN`(发布者申请自己) / `CLAIM_CONFLICT`(非 ACTIVE / 已有 PENDING) / `NOT_FOUND`(跨社区)。
 *   - GET ：→ `200 { data: ClaimDto[] }`；OWNER 看全部、非 owner 申请人只看自己、其余人 403。
 *
 * 多租户：物品作用域只认会话社区（`loadItemInCurrentCommunity`）。写走服务层（Prisma Client，P5）。
 */
import { CreateClaimRequestSchema } from '@/shared/schemas';

import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { listItemClaims, submitClaim } from '@/server/claims/service';
import { jsonCreated, jsonOk, parseJsonBody, withRoute } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ItemRouteContext = { params: Promise<{ id: string }> | { id: string } };

async function resolveItemId(context: ItemRouteContext): Promise<string> {
  const resolved = await context.params;
  return resolved.id;
}

export const POST = withRoute(
  async (request: Request, context: ItemRouteContext): Promise<Response> => {
    const viewer = await requireUser(getSessionFromRequest(request));
    await requireMember(viewer);

    const itemId = await resolveItemId(context);
    const body = await parseJsonBody(request, CreateClaimRequestSchema);
    const dto = await submitClaim(viewer, itemId, body);
    return jsonCreated(dto);
  },
);

export const GET = withRoute(
  async (request: Request, context: ItemRouteContext): Promise<Response> => {
    const viewer = await requireUser(getSessionFromRequest(request));
    await requireMember(viewer);

    const itemId = await resolveItemId(context);
    const dtos = await listItemClaims(viewer, itemId);
    return jsonOk(dtos);
  },
);
