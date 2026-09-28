import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const docsSchemaPath = fileURLToPath(new URL('../../docs/schema.prisma', import.meta.url));
const prismaSchemaPath = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));
const migrationPath = fileURLToPath(
  new URL('../../prisma/migrations/0001_init/migration.sql', import.meta.url),
);

describe('数据层不变量 · 零 schema 改动', () => {
  it('prisma/schema.prisma 与 docs/schema.prisma 逐字一致', () => {
    const docsSchema = readFileSync(docsSchemaPath, 'utf8');
    const prismaSchema = readFileSync(prismaSchemaPath, 'utf8');
    expect(prismaSchema).toBe(docsSchema);
  });
});

describe('数据层不变量 · 手写迁移与 schema 对齐', () => {
  const migration = readFileSync(migrationPath, 'utf8');

  it('创建 6 个 enum / 10 张表', () => {
    expect(migration.match(/CREATE TYPE "/g)?.length).toBe(6);
    expect(migration.match(/CREATE TABLE "/g)?.length).toBe(10);
  });

  it('包含 D3 的两条 CHECK 约束（价格非负 / FIXED_PRICE 必填价格）', () => {
    expect(migration).toContain('Item_price_non_negative_check');
    expect(migration).toContain('CHECK ("price" IS NULL OR "price" >= 0)');
    expect(migration).toContain('Item_fixed_price_requires_price_check');
    expect(migration).toContain(
      `CHECK ("tradeType" <> 'FIXED_PRICE'::"TradeType" OR "price" IS NOT NULL)`,
    );
  });

  it('包含三组 Item 复合索引 / Favorite 唯一约束 / AiCache.inputHash 唯一', () => {
    expect(migration).toContain(
      'CREATE INDEX "Item_communityId_status_publishedAt_idx"\n  ON "Item" ("communityId", "status", "publishedAt")',
    );
    expect(migration).toContain('CREATE INDEX "Item_communityId_tradeType_status_idx"');
    expect(migration).toContain('CREATE INDEX "Item_ownerId_status_idx"');
    expect(migration).toContain('CREATE UNIQUE INDEX "Favorite_userId_itemId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "AiCache_inputHash_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "CommunityMember_communityId_userId_key"');
  });
});
