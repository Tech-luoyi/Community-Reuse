/**
 * 数据看板 SQL（`src/server/stats/sql.ts`）——聚合查询的唯一来源（P5：读走 raw）。
 *
 * 事实源：docs/api-contract.md §7（定义 + 「看板细则」）。集成测试 import 本文件常量做 EXPLAIN，
 * 杜绝「手抄一份假 SQL 来测」。
 *
 * 三条口径说明：
 *   - **月界 `[start, end)`** 由服务层按 `Asia/Shanghai` 算好后作为**参数**传入（`$2/$3`），
 *     绝不在 SQL 里用 `date_trunc('month', now())`：那样聚合用的是**会话时区**，
 *     而回传的 `monthRange` 是应用算的，两者会漂移（契约要求二者逐字一致）。
 *   - **数值一律在 SQL 里 `::int`**：`COUNT(*)` 与 `ROUND(EXTRACT(...))` 若不 cast，
 *     Prisma 会返回 `Decimal`/`string`，DTO 校验（`z.number().int()`）当场失败。
 *   - **并列一律有兜底排序**（`fastest`：时长→`id`；`wanted`：数量→`publishedAt`→`id`），
 *     否则同一份数据两次请求可能返回不同的"冠军"。
 *
 * 参数：$1 communityId（月界查询另加 $2 start, $3 end）。
 */

/** 本月发布数：`Item.publishedAt ∈ [start, end)`。 */
export const STATS_MONTH_PUBLISHED_SQL = `
  SELECT COUNT(*)::int AS count
    FROM "Item" i
   WHERE i."communityId" = $1
     AND i."publishedAt" >= $2
     AND i."publishedAt" <  $3
`;

/** 本月成交数：`ClaimRequest.completedAt ∈ [start, end)` 且 `status='COMPLETED'`。 */
export const STATS_MONTH_COMPLETED_SQL = `
  SELECT COUNT(*)::int AS count
    FROM "ClaimRequest" c
    JOIN "Item" i ON i.id = c."itemId"
   WHERE i."communityId" = $1
     AND c.status = 'COMPLETED'
     AND c."completedAt" IS NOT NULL
     AND c."completedAt" >= $2
     AND c."completedAt" <  $3
`;

/** 当前在售数：`status='ACTIVE'`（`hiddenAt` 已随治理模块砍除，无此过滤）。 */
export const STATS_ACTIVE_COUNT_SQL = `
  SELECT COUNT(*)::int AS count
    FROM "Item" i
   WHERE i."communityId" = $1
     AND i.status = 'ACTIVE'
`;

/**
 * 最快被领走的物品：按物品取**首次**成交（`MIN(completedAt)`），再取时长最小者。
 * `duration_minutes` 已 `ROUND` 成非负整数（`GREATEST(0, …)` 兜住"先成交后发布"的异常数据）。
 */
export const STATS_FASTEST_ITEM_SQL = `
  SELECT i.id,
         i.name,
         GREATEST(0, ROUND(EXTRACT(EPOCH FROM (MIN(c."completedAt") - i."publishedAt")) / 60.0))
           ::int AS "duration_minutes"
    FROM "ClaimRequest" c
    JOIN "Item" i ON i.id = c."itemId"
   WHERE i."communityId" = $1
     AND c.status = 'COMPLETED'
     AND c."completedAt" IS NOT NULL
   GROUP BY i.id, i.name, i."publishedAt"
   ORDER BY "duration_minutes" ASC, i.id ASC
   LIMIT 1
`;

/**
 * 最想要的物品：候选 = 非 `ARCHIVED` 且**无** `COMPLETED` 申请；计数 = 该物品的申请总行数
 * （需求原文「被最多人点击"想要"」＝意向表达，不按状态过滤）。
 */
export const STATS_MOST_WANTED_ITEM_SQL = `
  SELECT i.id, i.name, COUNT(c.id)::int AS "want_count"
    FROM "ClaimRequest" c
    JOIN "Item" i ON i.id = c."itemId"
   WHERE i."communityId" = $1
     AND i.status <> 'ARCHIVED'
     AND NOT EXISTS (
       SELECT 1 FROM "ClaimRequest" d
        WHERE d."itemId" = i.id AND d.status = 'COMPLETED'
     )
   GROUP BY i.id, i.name, i."publishedAt"
   ORDER BY "want_count" DESC, i."publishedAt" DESC, i.id ASC
   LIMIT 1
`;
