/**
 * `GET /api/me/items?status=` —— 我发布的物品（§6）。
 *
 * `status` 缺省 ⇒ `ACTIVE`/`RESERVED`/`ARCHIVED` **三态全返回**（需求「已归档可查看」）；
 * 按 `publishedAt` 倒序；无分页。非法 `status` → `INVALID_INPUT`。
 */
import { MyItemsQuerySchema } from '@/shared/schemas';
import type { ItemDto } from '@/shared/types';

import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { jsonOk, parseSearchParams, withRoute } from '@/server/http';
import { listMyItems } from '@/server/items/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);

  const query = parseSearchParams(request, MyItemsQuerySchema);
  const items: ItemDto[] = await listMyItems(viewer, query);
  return jsonOk(items);
});
