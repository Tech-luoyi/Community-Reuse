/**
 * D2 验证 ⑤：默认流复合索引命中（真连库 EXPLAIN）。
 *
 * 主查询 = `(communityId, status=ACTIVE, publishedAt DESC)`，
 * 断言规划器选中 `Item_communityId_status_publishedAt_idx`（Index Scan）。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, describe, expect, it } from 'vitest';

import { closePool, pool } from './helpers/db';

const DEFAULT_FLOW_SQL = `
  SELECT id
    FROM "Item"
   WHERE "communityId" = $1 AND status = 'ACTIVE'
   ORDER BY "publishedAt" DESC
`;

describe('D2 默认流复合索引命中', () => {
  afterAll(async () => {
    await closePool();
  });

  it('⑤ EXPLAIN 显示 Index Scan（Backward）命中 Item_communityId_status_publishedAt_idx', async () => {
    const { rows } = await pool.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${DEFAULT_FLOW_SQL}`, [
      'c_lf',
    ]);
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
    // 命中索引（Backward 因 ORDER BY publishedAt DESC）
    expect(plan).toMatch(/Index (Only )?(Backward )?Scan/);
    expect(plan).toContain('Item_communityId_status_publishedAt_idx');
    // 复合索引的前两列（等值前缀）落在 Index Cond 上
    expect(plan).toContain('Index Cond');
    expect(plan).toContain('communityId');
    expect(plan).toContain('status');
  });

  it('该索引确实存在于 Item 上（catalog 校验）', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'Item' AND indexname = $1`,
      ['Item_communityId_status_publishedAt_idx'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('"communityId", status, "publishedAt"');
  });
});
