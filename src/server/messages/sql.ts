/**
 * 留言板 SQL（`src/server/messages/sql.ts`）——真实查询的唯一来源（P5：读走 raw）。
 *
 * 事实源：docs/api-contract.md §5。
 *   - `LEFT JOIN "User"`：**AI 行没有作者外键**（`authorId IS NULL`），故必须外连接；
 *     映射层据此产出 `author: null`，前端不得把 AI 行伪装成用户发言。
 *   - 排序按 `createdAt` **升序**（对话流），`id` 兜底保证同一时刻的行也确定。
 *   - 索引 `@@index([itemId, createdAt])` 与本查询谓词/排序完全匹配（集成测试 EXPLAIN 钉死）。
 *
 * 参数：列表 $1 itemId；写回显由 Prisma create 的 select 完成（不在此处）。
 */

/** 留言列表行形状（与 `create` 后手工拼装的行一致，共用同一 mapper）。 */
export const MESSAGE_LIST_SQL = `
  SELECT m.id, m."itemId", m."senderType"::text AS "senderType", m.content, m."createdAt",
         u.id AS author_id, u.nickname AS author_nickname
    FROM "Message" m
    LEFT JOIN "User" u ON u.id = m."authorId"
   WHERE m."itemId" = $1
   ORDER BY m."createdAt" ASC, m.id ASC
`;
