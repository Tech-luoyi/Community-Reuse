/**
 * D3「DB 层兜底」验证 ①②：Item 的 CHECK 约束（真连库）。
 *
 *   ① price = -1                → 被 `Item_price_non_negative_check` 拒绝
 *   ② tradeType=FIXED_PRICE 且 price IS NULL → 被 `Item_fixed_price_requires_price_check` 拒绝
 *
 * 断言 `err.code === '23514'`（check_violation）且 `err.constraint` 精确等于约束名。
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

const INSERT_ITEM = `
  INSERT INTO "Item"
    ("id","communityId","ownerId","name","description","tradeType","price","status","publishedAt","createdAt","updatedAt")
  VALUES ($1, $2, $3, $4, $5, $6::"TradeType", $7, 'ACTIVE', now(), now(), now())
`;

describe('D3 DB 层兜底：Item 的 CHECK 约束', () => {
  const scope = 'chk';
  let fx: TestFixtures;

  beforeAll(async () => {
    fx = await createFixtures(scope);
  });

  afterAll(async () => {
    await cleanupFixtures(scope);
    await closePool();
  });

  it('① price = -1 被 CHECK 拒绝（约束名 Item_price_non_negative_check）', async () => {
    const error = await expectSqlError(INSERT_ITEM, [
      `${fx.scopePrefix}neg`,
      fx.communityId,
      fx.userId,
      '负价物品',
      '不应写入数据库',
      'FREE',
      -1,
    ]);
    expect(error.code).toBe('23514'); // check_violation
    expect(error.constraint).toBe('Item_price_non_negative_check');
    // 该行必须确实未被写入
    const { rows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM "Item" WHERE id = $1`,
      [`${fx.scopePrefix}neg`],
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('边界对照：price = 0 合法（非负约束不误伤 0，证明约束语义正确）', async () => {
    const zeroId = `${fx.scopePrefix}zero`;
    await pool.query(INSERT_ITEM, [
      zeroId,
      fx.communityId,
      fx.userId,
      '零价物品',
      '免费送，price 记为 0',
      'FREE',
      0,
    ]);
    const { rows } = await pool.query<{ price: string }>(`SELECT price FROM "Item" WHERE id = $1`, [
      zeroId,
    ]);
    expect(rows[0]?.price).toBe('0.00');
  });

  it('② tradeType=FIXED_PRICE 且 price IS NULL 被 CHECK 拒绝（约束名 Item_fixed_price_requires_price_check）', async () => {
    const error = await expectSqlError(INSERT_ITEM, [
      `${fx.scopePrefix}fixed-null`,
      fx.communityId,
      fx.userId,
      '定价缺失物品',
      'FIXED_PRICE 必须有价格',
      'FIXED_PRICE',
      null,
    ]);
    expect(error.code).toBe('23514');
    expect(error.constraint).toBe('Item_fixed_price_requires_price_check');
  });

  it('对照：tradeType=FIXED_PRICE 且 price=88 可正常写入', async () => {
    const okId = `${fx.scopePrefix}fixed-ok`;
    await pool.query(INSERT_ITEM, [
      okId,
      fx.communityId,
      fx.userId,
      '定价正常物品',
      '合法',
      'FIXED_PRICE',
      88,
    ]);
    const { rows } = await pool.query<{ price: string }>(`SELECT price FROM "Item" WHERE id = $1`, [
      okId,
    ]);
    expect(rows[0]?.price).toBe('88.00');
  });
});
