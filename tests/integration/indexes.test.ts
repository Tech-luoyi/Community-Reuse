/**
 * D2 验证 ⑤：默认流复合索引命中（真连库 EXPLAIN）。
 *
 * 主查询 = `(communityId, status=ACTIVE, publishedAt DESC)`，对应
 * `@@index([communityId, status, publishedAt])`。
 *
 * 关于「怎么证明」：
 *   在只有几行的种子数据上，规划器可能选 Seq Scan（对小表更便宜），且并发跑测试时
 *   表规模会波动 —— 直接断言「必须 Index Scan」会不稳定。因此本测试分三层、均可复现：
 *     1) catalog：索引确实存在且列序正确；
 *     2) 可命中性：在**回滚事务**内 `SET LOCAL enable_seqscan/enable_bitmapscan = off`
 *        → 必然得到 `Index Scan using Item_communityId_status_publishedAt_idx`（证明该索引
 *        正是本谓词的可用访问路径）；
 *     3) 规模收益：在**回滚事务**内造 4 万行（跨 200 社区）并 ANALYZE，不施加任何强制
 *        → 规划器**自然地**用上该复合索引（Bitmap Index Scan）。
 *   事务全部 ROLLBACK，不污染数据。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { closePool, pool } from './helpers/db';

const INDEX_NAME = 'Item_communityId_status_publishedAt_idx';

const DEFAULT_FLOW_SQL = `
  SELECT id
    FROM "Item"
   WHERE "communityId" = $1 AND status = 'ACTIVE'
   ORDER BY "publishedAt" DESC
`;

async function withRollbackTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

function explainText(rows: { 'QUERY PLAN': string }[]): string {
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe('D2 默认流复合索引命中', () => {
  afterAll(async () => {
    await closePool();
  });

  it('索引存在且列序为 (communityId, status, publishedAt)', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'Item' AND indexname = $1`,
      [INDEX_NAME],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('"communityId", status, "publishedAt"');
  });

  it('⑤ 可用性：EXPLAIN 显示 Index Scan 命中 Item_communityId_status_publishedAt_idx', async () => {
    // 在回滚事务内：临时移除 Item 上其它索引 + 关闭 seq/bitmap 扫描，
    // 从而**单值地**验证「本谓词唯一的可用访问路径就是该复合索引」；事务回滚后一切复原。
    const plan = await withRollbackTx(async (client) => {
      await client.query('DROP INDEX "Item_ownerId_status_idx"');
      await client.query('DROP INDEX "Item_communityId_tradeType_status_idx"');
      await client.query('SET LOCAL enable_seqscan = off');
      await client.query('SET LOCAL enable_bitmapscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${DEFAULT_FLOW_SQL}`, [
        'c_lf',
      ]);
      return explainText(rows);
    });

    expect(plan).toMatch(/Index (Only )?(Backward )?Scan/);
    expect(plan).toContain(INDEX_NAME);
    // 等值前缀 (communityId, status) 落在 Index Cond 上；排序列走索引顺序（Backward = DESC）
    expect(plan).toContain('Index Cond');
    expect(plan).toContain('communityId');
    expect(plan).toContain('status');
  });

  it('回滚后 Item 的三组复合索引仍完整（证明上面的 DROP 不落库）', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'Item' ORDER BY indexname`,
    );
    const names = rows.map((row) => row.indexname);
    expect(names).toContain('Item_communityId_status_publishedAt_idx');
    expect(names).toContain('Item_communityId_tradeType_status_idx');
    expect(names).toContain('Item_ownerId_status_idx');
  });

  it('⑤ 规模收益：造数后规划器自然选择该复合索引（无任何强制）', async () => {
    const plan = await withRollbackTx(async (client) => {
      await client.query(
        `INSERT INTO "Community" ("id","name","inviteCode","createdAt","updatedAt")
         SELECT 'perf-c' || g, 'Perf ' || g, 'PERF-' || g, now(), now()
           FROM generate_series(1, 200) AS g`,
      );
      await client.query(
        `INSERT INTO "User" ("id","nickname","createdAt","updatedAt")
         VALUES ('perf-u1', 'perf', now(), now())`,
      );
      await client.query(
        `INSERT INTO "Item"
           ("id","communityId","ownerId","name","description","tradeType","price","status","publishedAt","createdAt","updatedAt")
         SELECT 'perf-i' || g, 'perf-c' || ((g % 200) + 1), 'perf-u1', 'n', 'd', 'FREE', NULL,
                CASE WHEN g % 7 = 0 THEN 'ACTIVE' ELSE 'ARCHIVED' END::"ItemStatus",
                now() - (g || ' seconds')::interval, now(), now()
           FROM generate_series(1, 40000) AS g`,
      );
      await client.query('ANALYZE "Item"');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${DEFAULT_FLOW_SQL}`, [
        'perf-c1',
      ]);
      return explainText(rows);
    });

    // 4 万行、单社区筛选有选择性 → 规划器自然走索引（Index Scan 或 Bitmap Index Scan）
    expect(plan).toMatch(/Index (Only )?(Backward )?Scan|Bitmap Index Scan/);
    expect(plan).toContain(INDEX_NAME);
  });
});
