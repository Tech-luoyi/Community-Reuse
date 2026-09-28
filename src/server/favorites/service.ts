/**
 * 收藏读写（`src/server/favorites/service.ts`）。
 *
 * 事实源：docs/api-contract.md §6。
 *   - `POST` 已收藏 → `CONFLICT`(409)；`DELETE` 未收藏 → `NOT_FOUND`(404)。**幂等性明确不放宽**：
 *     前端据 `ItemDetailDto.viewer.isFavorite` 决定调哪个动词，竞态因此在契约层可见。
 *   - 并发下的最终防线是唯一约束 `@@unique([userId,itemId])`（`P2002` → `CONFLICT`），
 *     故**无需**先查后写（那对竞态毫无帮助，只多一次往返）。
 *   - 两个动词都先 `loadItemInCurrentCommunity` ⇒ 跨社区收藏不成立（404，不泄漏存在性）。
 */
import { Prisma } from '@prisma/client';

import type { ItemDto } from '@/shared/types';

import { type Viewer, loadItemInCurrentCommunity } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { type RawItemRow, mapItemRow } from '@/server/items/mapper';

import { MY_FAVORITES_SQL } from './sql';

/** Prisma 唯一约束冲突（P2002）。 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** 收藏当前社区内的物品。 */
export async function addFavorite(viewer: Viewer, itemId: string): Promise<void> {
  await loadItemInCurrentCommunity(viewer, itemId);
  try {
    await prisma.favorite.create({ data: { userId: viewer.id, itemId } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.conflict('你已收藏该物品');
    }
    throw error;
  }
}

/** 取消收藏（未收藏 → 404）。 */
export async function removeFavorite(viewer: Viewer, itemId: string): Promise<void> {
  await loadItemInCurrentCommunity(viewer, itemId);
  const deleted = await prisma.favorite.deleteMany({ where: { userId: viewer.id, itemId } });
  if (deleted.count === 0) {
    throw errors.notFound('你尚未收藏该物品');
  }
}

/** 我在当前社区的收藏（`ItemDto[]`，收藏时间倒序）。 */
export async function listFavorites(viewer: Viewer): Promise<ItemDto[]> {
  const rows = await prisma.$queryRawUnsafe<RawItemRow[]>(
    MY_FAVORITES_SQL,
    viewer.id,
    viewer.currentCommunityId,
  );
  return rows.map(mapItemRow);
}
