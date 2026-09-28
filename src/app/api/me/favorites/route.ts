/**
 * `GET /api/me/favorites` —— 我的收藏（§6）。
 *
 * `200 { data: ItemDto[] }`，**形状与 `GET /api/items` 一致**（同一 `ITEM_SELECT`），
 * 按收藏时间倒序；作用域锁会话社区；无分页。
 */
import type { ItemDto } from '@/shared/types';

import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { jsonOk, withRoute } from '@/server/http';
import { listFavorites } from '@/server/favorites/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);

  const items: ItemDto[] = await listFavorites(viewer);
  return jsonOk(items);
});
