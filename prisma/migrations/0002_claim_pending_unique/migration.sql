-- ============================================================================
-- 邻里流转 · 迁移 0002：同用户同物品至多一条有效 PENDING 申请（部分唯一索引兜底）
--
-- 设计来源：docs/tech-design-final.md §4.4 兜底表第 7 行
--   「同用户对同物品仅一个有效 PENDING | 应用层 + DB 兜底 | 事务内断言
--     （itemId+applicantId+status=PENDING 唯一）+ 可选部分唯一索引」。
-- 应用层断言见 src/server/claims/service.ts 的 submitClaim（事务内 + 物品行锁）。
--
-- 为什么手写：Prisma schema 无法表达带 WHERE 的【部分】索引，故与 0001 的 CHECK 约束
-- 同源，直接手写进迁移。
--
-- 为什么必须是【部分】索引（WHERE status='PENDING'）：申请被 REJECTED / CANCELED /
-- COMPLETED 后，申请人有权**重新申请**同一物品；若用全量唯一索引（不为 PENDING 设条件），
-- 会把这条正常业务流永久封死。因此唯一性只作用于「有效（PENDING）申请」。
--
-- 幂等性：`CREATE UNIQUE INDEX`（非 IF NOT EXISTS）——若库内已存在重复 PENDING 行会失败，
-- 这是**期望行为**（那意味着真实脏数据，需人工处理，不可静默跳过）。
-- ============================================================================

CREATE UNIQUE INDEX "ClaimRequest_itemId_applicantId_pending_key"
  ON "ClaimRequest" ("itemId", "applicantId")
  WHERE status = 'PENDING';
