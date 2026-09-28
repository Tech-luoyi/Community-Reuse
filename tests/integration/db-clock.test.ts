/**
 * DB 时钟一致性回归（真连库）：把「会话时区 = UTC」这一**可复现性前提**固化成断言。
 *
 * 事实源：docs/tech-design-final.md §4.3②（时钟源清单）/ §6.7.1 P13。
 *
 * 为什么需要它：`publishedAt` 由 **Prisma Client 按 UTC 语义**写入，读取端却用 **DB `now()`** 计算
 * `ageHours`；两者只有「DB 会话时区 = UTC」时才是同一时间轴。当前容器恰好是 UTC，但**没有任何东西
 * 守护**——本测试 + compose 的 `TZ: UTC` 一起把它变成受保护的不变量。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/server/db';

import { type TestFixtures, cleanupFixtures, closePool, createFixtures, pool } from './helpers/db';

const FIVE_SECONDS_MS = 5_000;

describe('DB 时钟一致性：会话时区 = UTC', () => {
  const scope = 'db-clock';
  let fx: TestFixtures;
  /** Prisma 建出来的物品（cuid，不匹配夹具前缀）→ 单列追踪、afterAll 显式清理。 */
  const createdItemIds: string[] = [];

  beforeAll(async () => {
    fx = await createFixtures(scope);
  });

  afterAll(async () => {
    if (createdItemIds.length > 0) {
      await pool.query(`DELETE FROM "ItemImage" WHERE "itemId" = ANY($1)`, [createdItemIds]);
      await pool.query(`DELETE FROM "ClaimRequest" WHERE "itemId" = ANY($1)`, [createdItemIds]);
      await pool.query(`DELETE FROM "Favorite" WHERE "itemId" = ANY($1)`, [createdItemIds]);
      await pool.query(`DELETE FROM "Item" WHERE "id" = ANY($1)`, [createdItemIds]);
    }
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  it("会话时区为 UTC（current_setting('TimeZone') = 'UTC'）", async () => {
    const { rows } = await pool.query<{ tz: string }>(`SELECT current_setting('TimeZone') AS tz`);
    expect(rows[0]?.tz).toBe('UTC');
  });

  it('prisma.item.create 不显式给 publishedAt → 值来自 Prisma/UTC（与应用时钟、DB 的 UTC 墙钟均差 <5s）', async () => {
    const before = Date.now();
    const created = await prisma.item.create({
      data: {
        communityId: fx.communityId,
        ownerId: fx.userId,
        name: '时钟一致性物品',
        description: '验证 publishedAt 由 Prisma/UTC 供值，而非受会话时区影响的 DB 默认',
        tradeType: 'FREE',
      },
      select: { id: true, publishedAt: true },
    });
    createdItemIds.push(created.id);
    const after = Date.now();
    const published = created.publishedAt.getTime();

    // 与应用时钟一致（<5s）
    expect(published).toBeGreaterThanOrEqual(before - FIVE_SECONDS_MS);
    expect(published).toBeLessThanOrEqual(after + FIVE_SECONDS_MS);

    // 与 DB 的 UTC 墙钟一致（<5s）。若 publishedAt 落到「受会话时区影响的 DB 默认值」，
    // 在非 UTC 会话下这里会看到一个时区量级的偏移 → 本断言即失败。
    const { rows } = await pool.query<{ epoch: string }>(
      `SELECT EXTRACT(EPOCH FROM (now() AT TIME ZONE 'UTC')) AS epoch`,
    );
    const dbUtcMs = Number(rows[0]?.epoch) * 1000;
    expect(Math.abs(published - dbUtcMs)).toBeLessThan(FIVE_SECONDS_MS);
  });

  it('Item.updatedAt 无列默认值（P5：@updatedAt 由 Prisma 推进，非 DB 触发器）', async () => {
    const { rows } = await pool.query<{ column_default: string | null }>(
      `SELECT column_default
         FROM information_schema.columns
        WHERE table_name = 'Item' AND column_name = 'updatedAt'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.column_default).toBeNull();
  });

  it('Item.publishedAt 的列默认为 CURRENT_TIMESTAMP（存在但 Prisma 不使用——防后来人误读）', async () => {
    const { rows } = await pool.query<{ column_default: string | null }>(
      `SELECT column_default
         FROM information_schema.columns
        WHERE table_name = 'Item' AND column_name = 'publishedAt'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.column_default).not.toBeNull();
    expect(String(rows[0]?.column_default)).toContain('CURRENT_TIMESTAMP');
  });
});
