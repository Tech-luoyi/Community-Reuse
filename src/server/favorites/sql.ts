/**
 * 收藏查询 SQL（`src/server/favorites/sql.ts`）。
 *
 * 事实源：docs/api-contract.md §6 —— `GET /api/me/favorites` 返回的 `ItemDto`
 * **形状与 `GET /api/items` 完全一致**：故此处**复用 `items/sql.ts` 的 `ITEM_SELECT`**
 * （同一 `age_hours` 表达式 ⇒ 同一物品在列表页与收藏页的新鲜度必然相同）。
 *
 * 参数：$1 viewerId, $2 communityId。
 * 排序：收藏时间**倒序**（最近收藏在前），`i.id` 兜底保证同一时刻确定。
 */
import { ITEM_SELECT } from '@/server/items/sql';

export const MY_FAVORITES_SQL = `
  SELECT ${ITEM_SELECT}
    FROM "Favorite" f
    JOIN "Item" i ON i.id = f."itemId"
    JOIN "User" u ON u.id = i."ownerId"
   WHERE f."userId" = $1
     AND i."communityId" = $2
   ORDER BY f."createdAt" DESC, i.id DESC
`;
