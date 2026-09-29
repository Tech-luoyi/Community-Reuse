/**
 * 迁移落地验证（真连库）：确认手写迁移 `prisma/migrations/0001_init/migration.sql`
 * 已把 schema.prisma 的 10 表 / 6 枚举 / 2 条 CHECK 约束如实建到 PG。
 *
 * 门控：需 `RUN_INTEGRATION=1`；默认 `npm run test` 不加载本文件。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { closePool, pool } from './helpers/db';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

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

/**
 * LangGraph `PostgresSaver.setup()` 建的**外部管理表**（见 §10 DDL 归属纪律）。
 *
 * 它们刻意不进 `prisma/schema.prisma`：否则 `prisma migrate` 会与框架抢同一批 DDL，
 * 把框架的表当成「意外表」生成 DROP。
 *
 * 这里显式列出的意义：业务表断言保持**严格白名单**，任何**新增**的意外表仍会让测试失败——
 * 而不是把期望数量往上加一号、从此对多出来的表视而不见。
 */
const EXTERNAL_TABLES = [
  'checkpoint_blobs',
  'checkpoint_migrations',
  'checkpoint_writes',
  'checkpoints',
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

  it('10 张业务表齐备（除去 _prisma_migrations 与 LangGraph 外部管理表）', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'
        ORDER BY table_name`,
    );
    const all = rows.map((row) => row.table_name);
    // 业务表：严格等于白名单
    expect(all.filter((t) => !EXTERNAL_TABLES.includes(t))).toEqual(EXPECTED_TABLES);
    // 不存在白名单之外的第三种表——新增意外表仍然会红
    expect(all.filter((t) => !EXPECTED_TABLES.includes(t) && !EXTERNAL_TABLES.includes(t))).toEqual(
      [],
    );
  });

  it('LangGraph checkpoint 表不由 Prisma 声明（DDL 归属纪律，§10）', async () => {
    const schema = readFileSync(join(projectRoot, 'prisma', 'schema.prisma'), 'utf8');
    for (const table of EXTERNAL_TABLES) {
      expect(schema, `checkpoint 表 ${table} 不应出现在 prisma/schema.prisma`).not.toContain(
        `model ${table}`,
      );
    }
    // 反向确认：这些表确实由框架建好了，记忆功能有落点
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [EXTERNAL_TABLES],
    );
    expect(rows).toHaveLength(EXTERNAL_TABLES.length);
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
