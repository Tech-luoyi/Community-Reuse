/**
 * `POST /api/items/:id/archive` —— 归档物品（OWNER）。
 *
 * 契约：docs/api-contract.md §2 → `200 { data: ItemDto }`；错误 `FORBIDDEN` / `CLAIM_CONFLICT`。
 * 规则（团队裁决 d）：仅 `ACTIVE` 可归档 → 写 `status='ARCHIVED'` + `archivedAt`（**应用时钟**，
 *   该列无 DB 默认值，见 §4.3② 时钟源清单）；`status !== 'ACTIVE'` → 409 CLAIM_CONFLICT。
 * 归档**不物理删除**（DB 层 FK/未删约定）；写走 Prisma Client（P5）。
 */
import { requireMember, requireOwner, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { jsonOk, withRoute } from '@/server/http';
import { loadItemDto } from '@/server/items/service';

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
    const item = await requireOwner(viewer, itemId);
    if (item.status !== 'ACTIVE') {
      throw errors.claimConflict('仅 ACTIVE 状态的物品可归档');
    }

    await prisma.item.update({
      where: { id: itemId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });

    const dto = await loadItemDto(itemId, viewer);
    return jsonOk(dto);
  },
);
