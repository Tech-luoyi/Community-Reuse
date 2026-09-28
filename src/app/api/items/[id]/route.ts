/**
 * `GET /api/items/:id`（详情） · `PATCH /api/items/:id`（编辑，OWNER）
 *
 * 契约：docs/api-contract.md §2。
 *   - GET  ：`200 { data: ItemDetailDto }`；错误 `NOT_FOUND` / `FORBIDDEN`（跨社区按 404）。
 *   - PATCH：`{ 可选字段 }` → `200 { data: ItemDto }`；错误 `INVALID_INPUT` / `FORBIDDEN` / `CLAIM_CONFLICT`（非 ACTIVE）。
 *
 * 价格不变式（服务端归一化，交叉字段校验属服务层）：合并后的 (tradeType, price) 必须满足
 *   「price 仅在 FIXED_PRICE 时有值」——合并后为 FIXED_PRICE 且无价 → 400；非 FIXED_PRICE → price 强制 null。
 */
import type { Prisma } from '@prisma/client';

import { UpdateItemRequestSchema } from '@/shared/schemas';

import { requireMember, requireOwner, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { jsonOk, parseJsonBody, withRoute } from '@/server/http';
import { loadItemDetail, loadItemDto, toImageUrl } from '@/server/items/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Next 15 的 `params` 可能是 Promise（运行时）或已解好的对象（直接调用）——两者都兼容。 */
type ItemRouteContext = { params: Promise<{ id: string }> | { id: string } };

async function resolveItemId(context: ItemRouteContext): Promise<string> {
  const resolved = await context.params;
  return resolved.id;
}

export const GET = withRoute(
  async (request: Request, context: ItemRouteContext): Promise<Response> => {
    const viewer = await requireUser(getSessionFromRequest(request));
    await requireMember(viewer);

    const itemId = await resolveItemId(context);
    const detail = await loadItemDetail(itemId, viewer);
    return jsonOk(detail);
  },
);

export const PATCH = withRoute(
  async (request: Request, context: ItemRouteContext): Promise<Response> => {
    const viewer = await requireUser(getSessionFromRequest(request));
    await requireMember(viewer);

    const itemId = await resolveItemId(context);
    const item = await requireOwner(viewer, itemId);
    if (item.status !== 'ACTIVE') {
      throw errors.claimConflict('仅 ACTIVE 状态的物品可编辑');
    }

    const body = await parseJsonBody(request, UpdateItemRequestSchema);

    // 合并后的 (tradeType, price) 判定 —— 这是「先算合并结果再判定」的关键。
    const nextTradeType = body.tradeType ?? item.tradeType;
    const currentPrice = item.price === null ? null : item.price.toNumber();
    const nextPrice = body.price !== undefined ? body.price : currentPrice;
    if (nextTradeType === 'FIXED_PRICE' && nextPrice === null) {
      throw errors.invalidInput('交易方式为 FIXED_PRICE 时必须提供价格');
    }
    const normalizedPrice = nextTradeType === 'FIXED_PRICE' ? nextPrice : null;

    const data: Prisma.ItemUpdateInput = { price: normalizedPrice };
    if (body.name !== undefined) {
      data.name = body.name;
    }
    if (body.category !== undefined) {
      data.category = body.category;
    }
    if (body.description !== undefined) {
      data.description = body.description;
    }
    if (body.tradeType !== undefined) {
      data.tradeType = body.tradeType;
    }

    const imageKeys = body.imageKeys;
    await prisma.$transaction(async (tx) => {
      if (imageKeys !== undefined) {
        await tx.itemImage.deleteMany({ where: { itemId } });
        if (imageKeys.length > 0) {
          await tx.itemImage.createMany({
            data: imageKeys.map((key, index) => ({
              itemId,
              url: toImageUrl(key),
              sortOrder: index,
            })),
          });
        }
      }
      await tx.item.update({ where: { id: itemId }, data });
    });

    const dto = await loadItemDto(itemId, viewer);
    return jsonOk(dto);
  },
);
