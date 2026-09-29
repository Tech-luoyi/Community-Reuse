/**
 * `POST | DELETE /api/items/:id/favorite` —— 收藏 / 取消收藏（§6）。
 *
 *   - POST   → `201 { data: { favorited: true } }`；已收藏 → `CONFLICT`(409)。
 *   - DELETE → `200 { data: { favorited: false } }`；未收藏 → `NOT_FOUND`(404)。
 *
 * 明确**不做幂等放宽**（§6 细则）：前端按 `viewer.isFavorite` 选动词，竞态因此在契约层可见。
 */
import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { jsonCreated, jsonOk, withRoute } from '@/server/http';
import { addFavorite, removeFavorite } from '@/server/favorites/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ItemRouteContext = { params: Promise<{ id: string }> };

async function resolveItemId(context: ItemRouteContext): Promise<string> {
  return (await context.params).id;
}

export const POST = withRoute(
  async (request: Request, context: ItemRouteContext): Promise<Response> => {
    const viewer = await requireUser(getSessionFromRequest(request));
    await requireMember(viewer);

    await addFavorite(viewer, await resolveItemId(context));
    return jsonCreated({ favorited: true });
  },
);

export const DELETE = withRoute(
  async (request: Request, context: ItemRouteContext): Promise<Response> => {
    const viewer = await requireUser(getSessionFromRequest(request));
    await requireMember(viewer);

    await removeFavorite(viewer, await resolveItemId(context));
    return jsonOk({ favorited: false });
  },
);
