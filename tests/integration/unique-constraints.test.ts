/**
 * D3「DB 层兜底」验证 ③④：唯一约束（真连库）。
 *
 *   ③ Favorite `@@unique([userId,itemId])`      → 重复写入报 23505 / Favorite_userId_itemId_key
 *   ④ AiCache  `inputHash @unique`              → 重复写入报 23505 / AiCache_inputHash_key
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
  pool,
} from './helpers/db';

describe('D3 DB 层兜底：唯一约束', () => {
  const scope = 'uniq';
  let fx: TestFixtures;

  beforeAll(async () => {
    fx = await createFixtures(scope);
  });

  afterAll(async () => {
    await cleanupFixtures(scope);
    await closePool();
  });

  it('③ Favorite 同 (userId,itemId) 第二次写入被唯一约束拒绝', async () => {
    const first = await pool.query(
      `INSERT INTO "Favorite" ("id","userId","itemId","createdAt")
       VALUES ($1, $2, $3, now())
       RETURNING "id"`,
      [`${fx.scopePrefix}fav-1`, fx.userId, fx.itemId],
    );
    expect(first.rowCount).toBe(1);

    const error = await expectSqlError(
      `INSERT INTO "Favorite" ("id","userId","itemId","createdAt")
       VALUES ($1, $2, $3, now())`,
      [`${fx.scopePrefix}fav-2`, fx.userId, fx.itemId],
    );
    expect(error.code).toBe('23505'); // unique_violation
    expect(error.constraint).toBe('Favorite_userId_itemId_key');
  });

  it('③ 对照：换一个 itemId 后收藏可再次写入（唯一性只作用于组合键）', async () => {
    const otherItemId = `${fx.scopePrefix}item-2`;
    await pool.query(
      `INSERT INTO "Item"
         ("id","communityId","ownerId","name","description","tradeType","price","status","publishedAt","createdAt","updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'FREE', NULL, 'ACTIVE', now(), now(), now())`,
      [otherItemId, fx.communityId, fx.userId, '集成测试物品2', '对照用'],
    );
    const inserted = await pool.query(
      `INSERT INTO "Favorite" ("id","userId","itemId","createdAt")
       VALUES ($1, $2, $3, now())
       RETURNING "id"`,
      [`${fx.scopePrefix}fav-3`, fx.userId, otherItemId],
    );
    expect(inserted.rowCount).toBe(1);
  });

  it('④ AiCache.inputHash 重复写入被唯一约束拒绝', async () => {
    const hash = `${fx.scopePrefix}hash-1`;
    const first = await pool.query(
      `INSERT INTO "AiCache" ("id","inputHash","kind","outputJson","createdAt")
       VALUES ($1, $2, 'PRICING', $3, now())
       RETURNING "id"`,
      [`${fx.scopePrefix}cache-1`, hash, '{"variant":"PRICING_TOOL_V1"}'],
    );
    expect(first.rowCount).toBe(1);

    const error = await expectSqlError(
      `INSERT INTO "AiCache" ("id","inputHash","kind","outputJson","createdAt")
       VALUES ($1, $2, 'PRICING', $3, now())`,
      [`${fx.scopePrefix}cache-2`, hash, '{"variant":"PRICING_TOOL_V1"}'],
    );
    expect(error.code).toBe('23505');
    expect(error.constraint).toBe('AiCache_inputHash_key');
  });
});
