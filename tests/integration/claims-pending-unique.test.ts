/**
 * DB 层兜底：`ClaimRequest`「同用户同物品至多一条有效 PENDING」**部分唯一索引**（真连库）。
 *
 * 事实源：docs/tech-design-final.md §4.4 兜底表第 7 行；迁移 `0002_claim_pending_unique`。
 * 应用层断言见 `src/server/claims/service.ts::submitClaim`（事务内 + 物品行锁）；本用例**绕过应用层**，
 * 用 `pg` 直连 raw SQL 证明 DB 自身也能挡住重复 PENDING。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestFixtures,
  cleanupFixtures,
  closePool,
  createFixtures,
  expectSqlError,
  insertItem,
  pool,
} from './helpers/db';

const INDEX_NAME = 'ClaimRequest_itemId_applicantId_pending_key';

/** raw INSERT 一条申请；**必须自带 `createdAt` 与 `updatedAt`**（后者 NOT NULL 且无 DB 默认值）。 */
async function rawInsertClaim(
  id: string,
  itemId: string,
  applicantId: string,
  status: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO "ClaimRequest"
       ("id","itemId","applicantId","status","createdAt","updatedAt")
     VALUES ($1, $2, $3, $4::"ClaimStatus", now(), now())`,
    [id, itemId, applicantId, status],
  );
}

describe('DB 兜底：同用户同物品至多一条 PENDING（部分唯一索引）', () => {
  const scope = 'pending-uniq';
  let fx: TestFixtures;
  let item2 = '';

  beforeAll(async () => {
    fx = await createFixtures(scope);
    item2 = await insertItem(scope, {
      key: 'item2',
      communityId: fx.communityId,
      ownerId: fx.userId,
      name: '第二件物品',
    });
  });

  afterAll(async () => {
    await cleanupFixtures(scope);
    await closePool();
  });

  it('索引存在，且为【部分】索引（WHERE status = PENDING）——非全量唯一', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'ClaimRequest' AND indexname = $1`,
      [INDEX_NAME],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('UNIQUE INDEX');
    expect(rows[0]?.indexdef).toContain('"itemId", "applicantId"');
    expect(rows[0]?.indexdef).toContain("WHERE (status = 'PENDING'");
  });

  it('绕过应用层：同 (itemId, applicantId) 第二条 PENDING 被拒绝（23505 / 索引名）', async () => {
    await rawInsertClaim(`${fx.scopePrefix}c1`, fx.itemId, fx.userId, 'PENDING');

    const error = await expectSqlError(
      `INSERT INTO "ClaimRequest"
         ("id","itemId","applicantId","status","createdAt","updatedAt")
       VALUES ($1, $2, $3, 'PENDING'::"ClaimStatus", now(), now())`,
      [`${fx.scopePrefix}c2`, fx.itemId, fx.userId],
    );
    expect(error.code).toBe('23505'); // unique_violation
    expect(error.constraint).toBe(INDEX_NAME);
  });

  it('部分索引不封死复投：同 (itemId, applicantId) 在既有行非 PENDING 时可再插 PENDING', async () => {
    // 既有行 = REJECTED（同一 item 与 applicant）
    await rawInsertClaim(`${fx.scopePrefix}c3`, item2, fx.userId, 'REJECTED');
    // 再插 PENDING → 应被允许（因 WHERE status='PENDING' 不含那条 REJECTED）
    const inserted = await pool.query(
      `INSERT INTO "ClaimRequest"
         ("id","itemId","applicantId","status","createdAt","updatedAt")
       VALUES ($1, $2, $3, 'PENDING'::"ClaimStatus", now(), now())
       RETURNING "id"`,
      [`${fx.scopePrefix}c4`, item2, fx.userId],
    );
    expect(inserted.rowCount).toBe(1);

    // 该 PENDING 之后再插第二条 → 又被拒（证明索引确实在起作用）
    const error = await expectSqlError(
      `INSERT INTO "ClaimRequest"
         ("id","itemId","applicantId","status","createdAt","updatedAt")
       VALUES ($1, $2, $3, 'PENDING'::"ClaimStatus", now(), now())`,
      [`${fx.scopePrefix}c5`, item2, fx.userId],
    );
    expect(error.code).toBe('23505');
    expect(error.constraint).toBe(INDEX_NAME);
  });
});
