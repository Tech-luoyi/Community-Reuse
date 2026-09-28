/**
 * `GET /api/items`（列表） · `POST /api/items`（发布）
 *
 * 契约：docs/api-contract.md §2。
 *   - GET  ：`200 { data: ItemDto[], pagination }`；错误 `INVALID_INPUT` / `UNAUTHENTICATED`。
 *   - POST ：`{ communityId, name, category?, description, tradeType, price?, imageKeys? }`
 *            → `201 { data: ItemDto }`；错误 `INVALID_INPUT` / `FORBIDDEN` / `PAYLOAD_TOO_LARGE`。
 *
 * 多租户：作用域一律取 `viewer.currentCommunityId`；POST 的 `communityId` 必须与会话一致（否则 403）。
 * 写入：一律走 Prisma Client（P5：`@updatedAt` 非 DB 触发器，raw UPDATE 会让定价缓存指纹漏检）。
 */
import { CreateItemRequestSchema, ItemListQuerySchema } from '@/shared/schemas';

import { assertCurrentCommunity, requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { prisma } from '@/server/db';
import {
  jsonCreated,
  jsonPaginated,
  parseJsonBody,
  parseSearchParams,
  withRoute,
} from '@/server/http';
import { loadItemDto, listItems, toImageUrl } from '@/server/items/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);

  const query = parseSearchParams(request, ItemListQuerySchema);
  const { items, total } = await listItems(viewer, query);
  return jsonPaginated(items, { page: query.page, pageSize: query.pageSize, total });
});

export const POST = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);

  const body = await parseJsonBody(request, CreateItemRequestSchema);
  // 多租户红线：社区只认会话；请求体里的 communityId 必须与会话一致。
  assertCurrentCommunity(viewer, body.communityId);

  // 价格不变式：price 仅在 FIXED_PRICE 时有值；其余交易方式一律归一化为 null（不报错）。
  const price = body.tradeType === 'FIXED_PRICE' ? (body.price ?? null) : null;
  const imageKeys = body.imageKeys ?? [];

  const created = await prisma.item.create({
    data: {
      communityId: viewer.currentCommunityId,
      ownerId: viewer.id,
      name: body.name,
      category: body.category ?? null,
      description: body.description,
      tradeType: body.tradeType,
      price,
      status: 'ACTIVE',
      images:
        imageKeys.length > 0
          ? {
              create: imageKeys.map((key, index) => ({
                url: toImageUrl(key),
                sortOrder: index,
              })),
            }
          : undefined,
    },
    select: { id: true },
  });

  const dto = await loadItemDto(created.id, viewer);
  return jsonCreated(dto);
});
