/**
 * 物品查询 SQL（**真实查询**的唯一来源）。
 *
 * 路由与集成测试**共用本文件的常量**：测试 import 真实 SQL 做 EXPLAIN，杜绝「手抄一份假 SQL 来测」。
 *
 * 设计铁律（docs/tech-design-final.md §4.3①）：
 *   - `ageHours` 一律由 SQL 用 DB `now()` 计算（`GREATEST(0, EXTRACT(EPOCH FROM (now() - "publishedAt")) / 3600.0)`），
 *     **列表与详情同一表达式** ⇒ 同一 item 两处必然一致；**禁止**用应用 `new Date()` 相减。
 *   - `freshness` 过滤与 `age_hours` 取值**同源同钟**（都用 `now()`），结构上杜绝「筛进来却标成 NEW」。
 *   - 读走 raw SQL；**写**一律走 Prisma Client（见 P5，切勿在别处 raw UPDATE）。
 *
 * 参数顺序（务必与路由传入顺序一致）：
 *   列表 / 计数：$1 communityId, $2 status, $3 q(已转义或 null), $4 category, $5 tradeType,
 *                $6 freshness, $7 favoriteViewerId；列表另加 $8 limit, $9 offset
 *   按 id 取一条：$1 itemId, $2 communityId, $3 viewerId
 *   图片：$1 itemId
 */

/** 公共 SELECT 片段（含 age_hours / owner / coverUrl / 计数）。 */
export const ITEM_SELECT = `
  i.id, i."communityId", i.name, i.category, i.description, i."tradeType", i.price, i.status,
  i."publishedAt",
  GREATEST(0, EXTRACT(EPOCH FROM (now() - i."publishedAt")) / 3600.0) AS age_hours,
  u.id AS owner_id, u.nickname AS owner_nickname,
  (SELECT img.url FROM "ItemImage" img
     WHERE img."itemId" = i.id ORDER BY img."sortOrder" ASC LIMIT 1) AS cover_url,
  (SELECT COUNT(*)::int FROM "Favorite" f WHERE f."itemId" = i.id) AS favorite_count,
  (SELECT COUNT(*)::int FROM "ClaimRequest" c WHERE c."itemId" = i.id) AS claim_count
`;

/** 列表 WHERE 片段（只引用别名 i；计数查询同样复用）。 */
export const ITEM_LIST_WHERE = `
  i."communityId" = $1
  AND i.status = $2::"ItemStatus"
  AND (
    $3::text IS NULL
    OR i.name ILIKE '%' || $3 || '%' ESCAPE '\\'
    OR i.description ILIKE '%' || $3 || '%' ESCAPE '\\'
  )
  AND ($4::text IS NULL OR i.category = $4)
  AND ($5::text IS NULL OR i."tradeType" = $5::"TradeType")
  AND (
    $6::text IS NULL
    OR ($6 = 'JUST_LISTED' AND now() - i."publishedAt" <  interval '24 hours')
    OR ($6 = 'NEW'         AND now() - i."publishedAt" >= interval '24 hours'
                           AND now() - i."publishedAt" <  interval '72 hours')
    OR ($6 = 'OLDER'       AND now() - i."publishedAt" >= interval '72 hours')
  )
  AND (
    $7::text IS NULL
    OR EXISTS (SELECT 1 FROM "Favorite" fv WHERE fv."itemId" = i.id AND fv."userId" = $7)
  )
`;

/** 列表（默认 sort=latest）：ORDER BY publishedAt DESC（D2，与复合索引完全匹配）。 */
export const ITEM_LIST_SQL_LATEST = `
  SELECT ${ITEM_SELECT}
    FROM "Item" i
    JOIN "User" u ON u.id = i."ownerId"
   WHERE ${ITEM_LIST_WHERE}
   ORDER BY i."publishedAt" DESC
   LIMIT $8 OFFSET $9
`;

/** 列表（sort=oldest）：ORDER BY publishedAt ASC。 */
export const ITEM_LIST_SQL_OLDEST = `
  SELECT ${ITEM_SELECT}
    FROM "Item" i
    JOIN "User" u ON u.id = i."ownerId"
   WHERE ${ITEM_LIST_WHERE}
   ORDER BY i."publishedAt" ASC
   LIMIT $8 OFFSET $9
`;

/** 同 WHERE 的总数（分页 total）。 */
export const ITEM_LIST_COUNT_SQL = `
  SELECT COUNT(*)::int AS total
    FROM "Item" i
   WHERE ${ITEM_LIST_WHERE}
`;

/** 按 id 取一条（含 viewer 关系标记；age_hours 与列表同表达式 ⇒ 一致）。 */
export const ITEM_BY_ID_SQL = `
  SELECT ${ITEM_SELECT},
    EXISTS (
      SELECT 1 FROM "Favorite" fv WHERE fv."itemId" = i.id AND fv."userId" = $3
    ) AS is_favorite,
    EXISTS (
      SELECT 1 FROM "ClaimRequest" ac
       WHERE ac."itemId" = i.id AND ac."applicantId" = $3
         AND ac.status IN ('ACCEPTED', 'COMPLETED')
    ) AS is_accepted_applicant
    FROM "Item" i
    JOIN "User" u ON u.id = i."ownerId"
   WHERE i.id = $1 AND i."communityId" = $2
`;

/** 物品图片（按 sortOrder 升序）。 */
export const ITEM_IMAGES_SQL = `
  SELECT img.url, img."sortOrder"
    FROM "ItemImage" img
   WHERE img."itemId" = $1
   ORDER BY img."sortOrder" ASC
`;

/**
 * 我发布的物品（`GET /api/me/items`，契约 §6）。
 *
 * 参数：$1 ownerId, $2 communityId, $3 status（`null` = **三种状态全返回**，含已归档——
 * 需求「已归档可查看」与 `/me` 的「我的发布」列表都依赖这一档）。
 * 排序：`publishedAt` 倒序（D2 的唯一时间序口径），`id` 兜底保证确定。
 */
export const MY_ITEMS_SQL = `
  SELECT ${ITEM_SELECT}
    FROM "Item" i
    JOIN "User" u ON u.id = i."ownerId"
   WHERE i."ownerId" = $1
     AND i."communityId" = $2
     AND ($3::text IS NULL OR i."status" = $3::"ItemStatus")
   ORDER BY i."publishedAt" DESC, i.id DESC
`;

/**
 * 转义 LIKE 模式中的特殊字符（`\`、`%`、`_`），防止用户输入被当成通配符。
 * 与 SQL 中的 `ESCAPE '\'` 配套使用；转义后的值仍走占位符绑定（绝不拼接）。
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
