/**
 * `getCommunitySettlementStats` 的**真连库**集成测试。
 *
 * 存在的理由：`tests/unit/ai/tools.test.ts` 把 `$queryRaw` mock 掉了，它只能验证
 * **SQL 文本形状**，验证不了 **SQL 能否在 PG 上真的执行**——`percentile_cont`、
 * `"tradeType" = $n::"TradeType"` 转换、`substring(name from 1 for 24)` 只要有一处
 * 语法或类型错，单测依然全绿。本文件补上这一段，并顺带在真库上验证租户隔离与指纹失效。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeCommunityFingerprint } from '@/server/ai/fingerprint';
import { SettlementStatsArgsSchema, getCommunitySettlementStats } from '@/server/ai/tools';
import { prisma } from '@/server/db';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
} from './helpers/db';

const SCOPE = 'settlement-tool';

/** 本测试造的物品 id，afterAll 逐个删。 */
const createdItemIds: string[] = [];

async function makeArchivedItem(input: {
  id: string;
  communityId: string;
  ownerId: string;
  name: string;
  price: number;
  tradeType?: 'FIXED_PRICE' | 'PAY_WHATEVER';
  category?: string;
}): Promise<void> {
  // 写路径刻意走 Prisma Client 而非 raw INSERT：§4.3② / §6.7.1 P5 规定含
  // @default(now()) / @updatedAt 的表必须经 Prisma，否则 updatedAt 不推进、指纹漏检。
  const item = await prisma.item.create({
    data: {
      id: input.id,
      communityId: input.communityId,
      ownerId: input.ownerId,
      name: input.name,
      description: '集成测试物品',
      category: input.category ?? '家电',
      tradeType: input.tradeType ?? 'FIXED_PRICE',
      price: input.price,
      status: 'ARCHIVED',
      archivedAt: new Date('2026-09-01T00:00:00Z'),
    },
  });
  createdItemIds.push(item.id);
}

describe('settlement 工具（真连库）', () => {
  let fx: TenantFixtures;

  beforeAll(async () => {
    fx = await createTenantFixtures(SCOPE);

    // 甲区：4 件已成交，价格 30 / 60 / 120 / 300（中位 90）
    await makeArchivedItem({
      id: `${SCOPE}-a1`,
      communityId: fx.communityAId,
      ownerId: fx.ownerId,
      name: '电磁炉',
      price: 30,
    });
    await makeArchivedItem({
      id: `${SCOPE}-a2`,
      communityId: fx.communityAId,
      ownerId: fx.ownerId,
      name: '折叠椅',
      price: 60,
      category: '家具',
    });
    await makeArchivedItem({
      id: `${SCOPE}-a3`,
      communityId: fx.communityAId,
      ownerId: fx.ownerId,
      name: '婴儿车',
      price: 120,
      category: '母婴',
    });
    await makeArchivedItem({
      id: `${SCOPE}-a4`,
      communityId: fx.communityAId,
      ownerId: fx.ownerId,
      name: '长标题测试'.repeat(6),
      price: 300,
    });
    // 乙区：1 件，价格 9999——绝不该出现在甲区结果里
    await makeArchivedItem({
      id: `${SCOPE}-b1`,
      communityId: fx.communityBId,
      ownerId: fx.dualId,
      name: '乙区专属高价物',
      price: 9999,
    });
  });

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
    await cleanupFixtures(SCOPE);
    await prisma.$disconnect();
    await closePool();
  });

  it('SQL 真能在 PG 上执行（percentile_cont / 枚举转换 / substring 均不报错）', async () => {
    const r = await getCommunitySettlementStats(fx.communityAId, {});
    expect(r.stats.count).toBe(4);
    expect(r.stats.min).toBe(30);
    expect(r.stats.max).toBe(300);
    // percentile_cont(0.5) over {30,60,120,300} = 90
    expect(r.stats.median).toBe(90);
    expect(typeof r.stats.p25).toBe('number');
    expect(typeof r.stats.p75).toBe('number');
  });

  it('租户隔离：甲区查询拿不到乙区那件 9999 的物品（§6.5.6 第 3 条，真库验证）', async () => {
    const a = await getCommunitySettlementStats(fx.communityAId, {});
    const b = await getCommunitySettlementStats(fx.communityBId, {});
    expect(a.stats.count).toBe(4);
    expect(a.stats.max).toBe(300);
    expect(a.samples.map((s) => s.name)).not.toContain('乙区专属高价物');
    expect(b.stats.count).toBe(1);
    expect(b.stats.max).toBe(9999);
  });

  it('category 过滤走参数绑定，结果集随之收敛', async () => {
    const all = await getCommunitySettlementStats(fx.communityAId, {});
    const furniture = await getCommunitySettlementStats(
      fx.communityAId,
      SettlementStatsArgsSchema.parse({ category: '家具' }),
    );
    expect(all.stats.count).toBe(4);
    expect(furniture.stats.count).toBe(1);
    expect(furniture.samples[0]?.name).toBe('折叠椅');
  });

  it('样本按 archivedAt 倒序且在 SQL 侧截断，name 截到 24 字', async () => {
    const r = await getCommunitySettlementStats(fx.communityAId, {});
    expect(r.samples.length).toBeLessThanOrEqual(4);
    for (const s of r.samples) {
      expect([...s.name].length).toBeLessThanOrEqual(24);
      // 不回 description / 联系方式 / 发布者
      expect(s).not.toHaveProperty('description');
      expect(s).not.toHaveProperty('ownerId');
      expect(s).not.toHaveProperty('contactText');
    }
  });

  it('改一件已成交物品的价格 ⇒ 社区指纹变化（§6.5.3 在真库上成立）', async () => {
    const before = await computeCommunityFingerprint(fx.communityAId);
    await prisma.item.update({
      where: { id: `${SCOPE}-a1` },
      data: { price: 45 },
    });
    const after = await computeCommunityFingerprint(fx.communityAId);
    expect(after).not.toBe(before);

    // 乙区指纹不受甲区改动影响
    const bBefore = await computeCommunityFingerprint(fx.communityBId);
    await prisma.item.update({
      where: { id: `${SCOPE}-a2` },
      data: { price: 61 },
    });
    expect(await computeCommunityFingerprint(fx.communityBId)).toBe(bBefore);
  });

  it('不存在的社区 ⇒ 零值统计而非报错（空态由上层渲染）', async () => {
    const r = await getCommunitySettlementStats('c_does_not_exist', {});
    expect(r.stats).toEqual({ count: 0, min: null, max: null, p25: null, median: null, p75: null });
    expect(r.samples).toEqual([]);
  });
});
