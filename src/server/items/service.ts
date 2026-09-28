/**
 * 物品读写：把 `sql.ts` 的真实查询与 `mapper.ts` 的映射组装成路由可用的函数。
 *
 * - **读**走 `$queryRawUnsafe` + 占位符（SQL 来自 `sql.ts`，绝不拼字符串）。
 * - **不在此处写**：所有写操作在路由内用 Prisma Client（`prisma.item.*`）完成（P5）。
 */
import type { ItemDetailDto, ItemDto, ItemListQuery } from '@/shared/types';

import type { Viewer } from '@/server/auth/guard';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

import {
  type RawItemImageRow,
  type RawItemRow,
  type RawItemWithViewerRow,
  mapItemDetailRow,
  mapItemRow,
} from './mapper';
import {
  ITEM_BY_ID_SQL,
  ITEM_IMAGES_SQL,
  ITEM_LIST_COUNT_SQL,
  ITEM_LIST_SQL_LATEST,
  ITEM_LIST_SQL_OLDEST,
  escapeLike,
} from './sql';

export interface ItemListResult {
  items: ItemDto[];
  total: number;
}

/** `imageKeys[]` → `ItemImage.url`（本地 StorageAdapter 约定：`/uploads/<key>`；已带 `/` 则原样）。 */
export function toImageUrl(key: string): string {
  return key.startsWith('/') ? key : `/uploads/${key}`;
}

/** 物品列表（D2：默认 status=ACTIVE + sort=latest；分页 total 用同 WHERE 的 COUNT）。 */
export async function listItems(viewer: Viewer, query: ItemListQuery): Promise<ItemListResult> {
  const favoriteViewerId = query.favorite === true ? viewer.id : null;
  const params = [
    viewer.currentCommunityId,
    query.status,
    query.q === undefined ? null : escapeLike(query.q),
    query.category ?? null,
    query.tradeType ?? null,
    query.freshness ?? null,
    favoriteViewerId,
  ];
  const listSql = query.sort === 'oldest' ? ITEM_LIST_SQL_OLDEST : ITEM_LIST_SQL_LATEST;
  const limit = query.pageSize;
  const offset = (query.page - 1) * query.pageSize;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<RawItemRow[]>(listSql, ...params, limit, offset),
    prisma.$queryRawUnsafe<{ total: number }[]>(ITEM_LIST_COUNT_SQL, ...params),
  ]);

  return { items: rows.map(mapItemRow), total: countRows[0]?.total ?? 0 };
}

/** 取当前社区内某物品的 `ItemDto`（不存在/跨社区 → 404）。 */
export async function loadItemDto(itemId: string, viewer: Viewer): Promise<ItemDto> {
  const rows = await prisma.$queryRawUnsafe<RawItemWithViewerRow[]>(
    ITEM_BY_ID_SQL,
    itemId,
    viewer.currentCommunityId,
    viewer.id,
  );
  const row = rows[0];
  if (!row) {
    throw errors.notFound('物品不存在');
  }
  return mapItemRow(row);
}

/** 取当前社区内某物品的 `ItemDetailDto`（含图片与 viewer 关系标记）。 */
export async function loadItemDetail(itemId: string, viewer: Viewer): Promise<ItemDetailDto> {
  const rows = await prisma.$queryRawUnsafe<RawItemWithViewerRow[]>(
    ITEM_BY_ID_SQL,
    itemId,
    viewer.currentCommunityId,
    viewer.id,
  );
  const row = rows[0];
  if (!row) {
    throw errors.notFound('物品不存在');
  }
  const images = await prisma.$queryRawUnsafe<RawItemImageRow[]>(ITEM_IMAGES_SQL, itemId);
  return mapItemDetailRow(row, viewer.id, images);
}
