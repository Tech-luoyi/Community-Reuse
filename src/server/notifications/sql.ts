/**
 * 通知查询 SQL（`src/server/notifications/sql.ts`）。
 *
 * 事实源：docs/api-contract.md §6。
 *   - 只按 `userId` 过滤（通知天然属于个人，**与社区无关**：切换空间不会丢历史）。
 *   - `unreadOnly` 的过滤由服务层传 `$2`：`true` → 仅未读；**缺省/`false` → 传 `null` 不过滤**
 *     （与 `listItems` 的 `favoriteViewerId` 同一口径：筛选器"不筛"用 `null`，而不是用 `false` 反选）。
 *   - 排序 `createdAt DESC` + `LIMIT 100`：契约明确「上限 100 条」以避免无界响应。
 *   - 索引 `@@index([userId, readAt, createdAt])` 与本谓词/排序匹配（集成测试 EXPLAIN 钉死走索引）。
 *
 * 参数：$1 viewerId, $2 unreadOnly（`true | null`）。
 */
export const NOTIFICATION_LIST_SQL = `
  SELECT n.id, n."type"::text AS "type", n.title, n.content, n."readAt", n."createdAt"
    FROM "Notification" n
   WHERE n."userId" = $1
     AND ($2::bool IS NULL OR (n."readAt" IS NULL) = $2::bool)
   ORDER BY n."createdAt" DESC, n.id DESC
   LIMIT 100
`;
