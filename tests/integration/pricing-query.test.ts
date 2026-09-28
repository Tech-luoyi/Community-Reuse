/**
 * §6.5 定价工具 SQL 真连库反查（seed 之后）。
 *
 * 内容：
 *   · §6.5.4 统计查询（`percentile_cont`）能从 seed 的归档成交数据取到结果（count ≥ 1）
 *   · §6.5.3 缓存指纹聚合（count + max(updatedAt)）
 *   · §6.5.4 样本查询（≤8 条，按 archivedAt DESC）
 *   · 【回答架构师不确定项 1】`percentile_cont` 的返回类型：用 `pg_typeof` 判定
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, describe, expect, it } from 'vitest';

import { closePool, pool } from './helpers/db';

/** 与 §6.5.4 设计文档逐字一致的统计 SQL（$1 社区，$2 品类，$3 交易方式）。 */
const STATS_SQL = `
  SELECT COUNT(*)::int AS count, MIN(price) AS min, MAX(price) AS max,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY price) AS p25,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY price) AS median,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY price) AS p75
    FROM "Item"
   WHERE "communityId" = $1 AND status = 'ARCHIVED' AND price IS NOT NULL
     AND ($2::text IS NULL OR category = $2)
     AND ($3::text IS NULL OR "tradeType" = $3::"TradeType")
`;

/** 与 §6.5.3 一致的指纹聚合 SQL。 */
const FINGERPRINT_SQL = `
  SELECT COUNT(*)::int AS count, MAX("updatedAt") AS max_updated_at
    FROM "Item"
   WHERE "communityId" = $1 AND status = 'ARCHIVED' AND price IS NOT NULL
`;

/** 与 §6.5.4 一致的样本 SQL（SQL 侧 LIMIT 8，name 截断 ≤24）。 */
const SAMPLES_SQL = `
  SELECT substring("name", 1, 24) AS name, price, "tradeType", "archivedAt"
    FROM "Item"
   WHERE "communityId" = $1 AND status = 'ARCHIVED' AND price IS NOT NULL
   ORDER BY "archivedAt" DESC
   LIMIT 8
`;

interface StatsRow {
  count: number;
  min: string | null;
  max: string | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
}

describe('§6.5 定价工具 SQL（真连库，seed 反查）', () => {
  afterAll(async () => {
    await closePool();
  });

  it('seed 后归档成交数据存在：ARCHIVED 且 price 非空 ≥ 1 条', async () => {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "Item"
        WHERE "communityId" = 'c_lf' AND status = 'ARCHIVED' AND price IS NOT NULL`,
    );
    expect(rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it('§6.5.4 统计查询可取数且能算出 median（无过滤）', async () => {
    const { rows } = await pool.query<StatsRow>(STATS_SQL, ['c_lf', null, null]);
    const row = rows[0];
    if (!row) {
      throw new Error('期望返回一行统计结果');
    }
    expect(row.count).toBeGreaterThanOrEqual(1);
    expect(row.median).not.toBeNull();
    expect(typeof row.median).toBe('number');
    expect(row.min).not.toBeNull();
    expect(row.max).not.toBeNull();
  });

  it('§6.5.4 品类过滤生效（category=家电 → 仅命中电磁炉，median=80）', async () => {
    const { rows } = await pool.query<StatsRow>(STATS_SQL, ['c_lf', '家电', null]);
    const row = rows[0];
    if (!row) {
      throw new Error('期望返回一行统计结果');
    }
    expect(row.count).toBe(1);
    expect(row.median).toBe(80);
  });

  it('§6.5.3 缓存指纹聚合返回 count 与 max(updatedAt)', async () => {
    const { rows } = await pool.query<{ count: number; max_updated_at: Date | null }>(
      FINGERPRINT_SQL,
      ['c_lf'],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('期望返回一行指纹结果');
    }
    expect(row.count).toBeGreaterThanOrEqual(1);
    expect(row.max_updated_at).not.toBeNull();
    expect(row.max_updated_at).toBeInstanceOf(Date);
  });

  it('§6.5.4 样本查询：≤8 条、字段裁剪、按 archivedAt DESC 排序', async () => {
    const { rows } = await pool.query<{
      name: string;
      price: string;
      tradeType: string;
      archivedAt: Date;
    }>(SAMPLES_SQL, ['c_lf']);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(8);
    for (const sample of rows) {
      expect(typeof sample.tradeType).toBe('string');
      expect(sample.archivedAt).toBeInstanceOf(Date);
      // 只回 {name,price,tradeType,archivedAt}，且 name 已被 SQL 截断 ≤24 字
      expect(sample.name.length).toBeLessThanOrEqual(24);
    }
    // 排序校验
    const times = rows.map((row) => row.archivedAt.getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });

  // --------------------------------------------------------------------------
  // 【架构师不确定项 1】PG `percentile_cont` 返回类型：是 Decimal 吗？
  // --------------------------------------------------------------------------
  it('不确定项 1：pg_typeof(percentile_cont(...)) = double precision（不是 numeric/Decimal）', async () => {
    const { rows } = await pool.query<{
      median_type: string;
      min_type: string;
      max_type: string;
      count_type: string;
    }>(
      `SELECT pg_typeof(percentile_cont(0.50) WITHIN GROUP (ORDER BY price))::text AS median_type,
              pg_typeof(MIN(price))::text AS min_type,
              pg_typeof(MAX(price))::text AS max_type,
              pg_typeof(COUNT(*)::int)::text AS count_type
         FROM "Item"
        WHERE "communityId" = 'c_lf' AND status = 'ARCHIVED' AND price IS NOT NULL`,
    );
    const row = rows[0];
    if (!row) {
      throw new Error('期望返回一行类型判定结果');
    }
    // 关键结论：percentile_cont 返回 double precision，并非 Decimal
    expect(row.median_type).toBe('double precision');
    // 只有 MIN/MAX（对 numeric 列）才是 numeric(Decimal)
    expect(row.min_type).toBe('numeric');
    expect(row.max_type).toBe('numeric');
    // COUNT(*)::int 是 int4
    expect(row.count_type).toBe('integer');
  });

  it('不确定项 1（驱动侧佐证）：pg 默认解析下 median/p25/p75 已是 number，min/max 是 string', async () => {
    const { rows } = await pool.query<StatsRow>(STATS_SQL, ['c_lf', null, null]);
    const row = rows[0];
    if (!row) {
      throw new Error('期望返回一行统计结果');
    }
    // percentile_cont = float8 → node-postgres 直接给 number
    expect(typeof row.median).toBe('number');
    expect(typeof row.p25).toBe('number');
    expect(typeof row.p75).toBe('number');
    // MIN/MAX = numeric → 为避免精度丢失，node-postgres 默认给 string
    expect(typeof row.min).toBe('string');
    expect(typeof row.max).toBe('string');
    expect(typeof row.count).toBe('number');
  });
});
