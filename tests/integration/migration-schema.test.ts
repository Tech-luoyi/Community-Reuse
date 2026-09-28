/**
 * 迁移落地验证（真连库）：确认手写迁移 `prisma/migrations/0001_init/migration.sql`
 * 已把 schema.prisma 的 10 表 / 6 枚举 / 2 条 CHECK 约束如实建到 PG。
 *
 * 门控：需 `RUN_INTEGRATION=1`；默认 `npm run test` 不加载本文件。
 */
import { afterAll, describe, expect, it } from 'vitest';

import { closePool, pool } from './helpers/db';

const EXPECTED_TABLES = [
  'AiCache',
  'ClaimRequest',
  'Community',
  'CommunityMember',
  'Favorite',
  'Item',
  'ItemImage',
  'Message',
  'Notification',
  'User',
];

const EXPECTED_ENUMS = [
  'AiKind',
  'ClaimStatus',
  'ItemStatus',
  'MessageSenderType',
  'NotificationType',
  'TradeType',
];

describe('迁移落地：结构（10 表 / 6 枚举 / 2 CHECK）', () => {
  afterAll(async () => {
    await closePool();
  });

  it('10 张业务表齐备（除去 _prisma_migrations）', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'
        ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES);
  });

  it('6 个枚举类型齐备', async () => {
    const { rows } = await pool.query<{ typname: string }>(
      `SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname`,
    );
    expect(rows.map((row) => row.typname)).toEqual(EXPECTED_ENUMS);
  });

  it('Item 上的两条 CHECK 约束存在且命名与设计一致', async () => {
    const { rows } = await pool.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = '"Item"'::regclass
          AND contype = 'c'
        ORDER BY conname`,
    );
    expect(rows.map((row) => row.conname)).toEqual([
      'Item_fixed_price_requires_price_check',
      'Item_price_non_negative_check',
    ]);

    const byName = new Map(rows.map((row) => [row.conname, row.def]));
    expect(byName.get('Item_price_non_negative_check')).toContain('price');
    expect(byName.get('Item_fixed_price_requires_price_check')).toContain('FIXED_PRICE');
  });

  it('Item 的三组复合索引齐备', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_indexes
        WHERE tablename = 'Item'
        ORDER BY indexname`,
    );
    const names = rows.map((row) => row.indexname);
    expect(names).toContain('Item_communityId_status_publishedAt_idx');
    expect(names).toContain('Item_communityId_tradeType_status_idx');
    expect(names).toContain('Item_ownerId_status_idx');
  });
});
