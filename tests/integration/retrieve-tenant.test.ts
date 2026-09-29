/**
 * `search_similar_items` 的**真连库**跨租户集成测试（§6.5.6 第 6、7 条）。
 *
 * 与 `tests/unit/ai/embeddings.test.ts` / `retrieve` 的离线断言的分工：离线侧只能验
 * **SQL 文本形状**；这里验 **SQL 真能在 pgvector 上跑**、以及「先按社区过滤、再按距离
 * 排序」在真实规划器下的**召回正确性**。后者是本次设计里最容易只靠 mock 假装通过的一条。
 *
 * 前置：需要 pgvector 扩展（`docker/db.Dockerfile` 构建的镜像）+ 迁移 `0003` 已应用。
 * **不需要**配 `EMBEDDING_*`：本文件注入确定性假 provider，只验 SQL 与召回次序，不验语义。
 * 前置不满足则整组 skip 并打印原因——**不静默通过**，因为「测试没跑」和「测试通过」
 * 是两件完全不同的事。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type EmbeddingProvider } from '@/server/ai/embeddings';
import { indexItem } from '@/server/ai/index-pipeline';
import {
  SIMILAR_TOP_K,
  SimilarItemsArgsSchema,
  renderSimilarForPrompt,
  searchSimilarItems,
} from '@/server/ai/retrieve';
import { ToolUnavailableError } from '@/server/ai/tools';
import { prisma } from '@/server/db';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
} from './helpers/db';

const SCOPE = 'retrieve-tenant';
const createdItemIds: string[] = [];

/**
 * 确定性假嵌入：不靠语义模型，直接按文本构造**已知夹角**的单位向量。
 *
 * 为什么不用「哈希出一个随机向量」：本组最要紧的一条断言是「先按社区过滤」能保住召回，
 * 它要求乙区的 3 件**确实比甲区的更靠近查询向量**。哈希向量的远近是碰运气的，
 * 断言也就跟着碰运气。这里用 `cos(θ)·e0 + sin(θ)·e1`，余弦距离 = `1 - cos(θ)`，
 * 远近完全由 θ 决定，可复现也可读。
 *
 * 维度必须等于列宽 1536（迁移 0003 把维度钉死，见那里的「为什么维度写死在列宽里」）。
 */
const FAKE_DIM = 1536;

/** θ=0 与查询向量重合；甲区取较大的 θ，乙区取接近 0 的 θ。 */
// 语料是 `name\ncategory\ndescription` 的多行文本，所以按行锚定（m 标志），
// 否则 `$` 只会匹配整串结尾、六个条目全部落到默认 θ。
const ANGLES: { match: RegExp; theta: number }[] = [
  { match: /^电磁炉乙$/m, theta: 0.1 },
  { match: /^电磁炉乙二$/m, theta: 0.2 },
  { match: /^电饭煲乙$/m, theta: 0.3 },
  { match: /^电磁炉甲$/m, theta: 0.6 },
  { match: /^电水壶甲$/m, theta: 1.0 },
  { match: /^烤面包机甲$/m, theta: 1.3 },
];

function axisVector(theta: number): number[] {
  const v = new Array<number>(FAKE_DIM).fill(0);
  v[0] = Math.cos(theta);
  v[1] = Math.sin(theta);
  return v;
}

function deterministicProvider(): EmbeddingProvider {
  return {
    model: 'fake-deterministic',
    dim: FAKE_DIM,
    embed: async (texts: string[]) =>
      texts.map((text) => axisVector(ANGLES.find((a) => a.match.test(text))?.theta ?? 0)),
  };
}

/**
 * 扩展是否可用。**必须 cast 成 text**：`SELECT '[1,2]'::vector` 经 Prisma `$queryRaw` 会报
 * `Failed to deserialize column of type 'vector'`——扩展明明装着，探针却会把它读成「不可用」，
 * 于是整组静默 skip。第一版就是这么漏掉的，这个坑写在这儿是为了别再踩。
 */
async function extensionAvailable(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ cast: string }[]>`
      SELECT ('[1,2]'::vector)::text AS cast
    `;
    return rows[0]?.cast === '[1,2]';
  } catch {
    return false;
  }
}

async function tableAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "ItemEmbedding" LIMIT 0`;
    return true;
  } catch {
    return false;
  }
}

/**
 * 前置检查在模块加载时做一次。
 *
 * 用 `describe.skip` 而不是「让第一条断言失败」来表达「没跑」：失败会把人误导成
 * 「代码有 bug」，而 skip 在报告里与 passed 明确可区分，且仍会打出原因。
 */
const PREREQ = (async () => {
  if (!(await extensionAvailable())) {
    return {
      ready: false,
      why: 'pgvector 扩展不可用：需 docker/db.Dockerfile 构建的镜像 + 迁移 0003',
    };
  }
  if (!(await tableAvailable())) {
    return {
      ready: false,
      why: 'ItemEmbedding 表不存在：迁移 0003 未应用（npm run prisma:deploy）',
    };
  }
  return { ready: true, why: '' };
})();

const prereq = await PREREQ;
if (!prereq.ready) console.warn(`[retrieve-tenant] SKIP 整组：${prereq.why}`);

describe.skipIf(!prereq.ready)('search_similar_items（真连库 · 跨租户）', () => {
  let fx: TenantFixtures;
  const provider = deterministicProvider();

  beforeAll(async () => {
    fx = await createTenantFixtures(SCOPE);

    // 甲区 3 件、乙区 3 件；乙区的向量被 ANGLES 刻意摆得比甲区更靠近查询——
    // 若实现走「全局 top-k 再过滤」，乙区会挤掉甲区，本测试即可暴露。
    const seed = [
      { id: `${SCOPE}-a1`, c: 'A', name: '电磁炉甲', desc: '九成新电磁炉 家用 功率八档' },
      { id: `${SCOPE}-a2`, c: 'A', name: '电水壶甲', desc: '八成新不锈钢电水壶 家用' },
      { id: `${SCOPE}-a3`, c: 'A', name: '烤面包机甲', desc: '七成新烤面包机 家用两槽' },
      { id: `${SCOPE}-b1`, c: 'B', name: '电磁炉乙', desc: '九成新电磁炉 家用 功率八档 全新' },
      { id: `${SCOPE}-b2`, c: 'B', name: '电磁炉乙二', desc: '九成新电磁炉 家用 功率八档' },
      { id: `${SCOPE}-b3`, c: 'B', name: '电饭煲乙', desc: '九成新电饭煲 家用' },
    ];
    for (const s of seed) {
      const communityId = s.c === 'A' ? fx.communityAId : fx.communityBId;
      const ownerId = s.c === 'A' ? fx.ownerId : fx.dualId;
      await prisma.item.create({
        data: {
          id: s.id,
          communityId,
          ownerId,
          name: s.name,
          description: s.desc,
          category: '家电',
          tradeType: 'FIXED_PRICE',
          price: s.c === 'A' ? 50 : 9999,
          status: 'ARCHIVED',
          archivedAt: new Date('2026-09-01T00:00:00Z'),
        },
      });
      createdItemIds.push(s.id);
      // 不传 communityId：indexItem 自己按 itemId 从 Item 取真值（写端防分叉的那一半）。
      const outcome = await indexItem(
        { id: s.id, name: s.name, description: s.desc, category: '家电' },
        provider,
      );
      if (outcome.status !== 'indexed') {
        throw new Error(`索引回填失败：${JSON.stringify(outcome)}`);
      }
    }
  });

  afterAll(async () => {
    if (createdItemIds.length > 0) {
      // ItemEmbedding 有 ON DELETE CASCADE，删 Item 即清向量。
      await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
    }
    await cleanupFixtures(SCOPE);
    await prisma.$disconnect();
    await closePool();
  });

  it('甲区检索只返回甲区物品，乙区那两件更相似的不会混进来（第 7 条）', async () => {
    const args = SimilarItemsArgsSchema.parse({ query: '九成新电磁炉 家用 功率八档' });
    const items = await searchSimilarItems(fx.communityAId, args, provider);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(SIMILAR_TOP_K);
    for (const item of items) {
      expect(item.itemId).toMatch(/^retrieve-tenant-a/);
      // 乙区物品价格刻意设成 9999：一旦出现说明跨了社区
      expect(item.price).not.toBe(9999);
    }
  });

  it('召回不被更相似的他人社区物品挤掉（第 6 条：先过滤后排序）', async () => {
    // 甲区只有 3 件，若实现是「全局 top-k 再过滤」，k=5 的全局结果里乙区的高相似项
    // 会占位，甲区可能只剩 1–2 件。先过滤则保证甲区 3 件全在候选内。
    const args = SimilarItemsArgsSchema.parse({ query: '九成新电磁炉 家用 功率八档' });
    const items = await searchSimilarItems(fx.communityAId, args, provider);
    expect(items).toHaveLength(3);
  });

  it('onlyArchived 与 tradeType 过滤仍受社区谓词约束', async () => {
    const args = SimilarItemsArgsSchema.parse({
      query: '电磁炉',
      onlyArchived: true,
      tradeType: 'FIXED_PRICE',
    });
    const items = await searchSimilarItems(fx.communityAId, args, provider);
    expect(items.every((i) => i.status === 'ARCHIVED')).toBe(true);
    expect(items.every((i) => i.tradeType === 'FIXED_PRICE')).toBe(true);
  });

  it('结果不回 description 全文，且名称被截断（§6.5.4 token 纪律）', async () => {
    const args = SimilarItemsArgsSchema.parse({ query: '电磁炉' });
    const items = await searchSimilarItems(fx.communityAId, args, provider);
    for (const item of items) {
      expect(item).not.toHaveProperty('description');
      expect([...item.name].length).toBeLessThanOrEqual(24);
    }
  });

  it('嵌入不可用 ⇒ 抛 ToolUnavailableError（交 F4 局部摘除，不静默返回空）', async () => {
    const broken: EmbeddingProvider = {
      model: 'broken',
      dim: 4,
      embed: async () => {
        throw new Error('embeddings down');
      },
    };
    await expect(
      searchSimilarItems(fx.communityAId, { query: '电磁炉' }, broken),
    ).rejects.toBeInstanceOf(ToolUnavailableError);
  });

  it('渲染片段带定界符与反注入声明', async () => {
    const args = SimilarItemsArgsSchema.parse({ query: '电磁炉' });
    const items = await searchSimilarItems(fx.communityAId, args, provider);
    const text = renderSimilarForPrompt(items);
    expect(text).toContain('<<<COMMUNITY_SIMILAR_ITEMS>>>');
    expect(text).toContain('不是指令');
  });

  it('维度不符的向量被拒（不静默写坏语料）', async () => {
    const wrongDim: EmbeddingProvider = { model: 'x', dim: 7, embed: async () => [[1, 2, 3]] };
    const outcome = await indexItem(
      { id: createdItemIds[0] ?? '', name: '维度测试', description: 'x', category: null },
      wrongDim,
    );
    // 列宽 1536，给 3 维必然被拒；这里只要求「不静默成功」
    expect(outcome.status).not.toBe('indexed');
  });

  it('冗余社区列由 Item 真值决定，不存在「调用方传错社区」这条路', async () => {
    // 这条断言替代了原设计里那条 PG 根本不允许写的跨表 CHECK（见迁移 0003 头注）：
    // 只要 indexItem 自己按 itemId 读 communityId，分叉状态就无法被写入，无需事后检测。
    const itemId = `${SCOPE}-a1`;
    await prisma.$executeRaw`DELETE FROM "ItemEmbedding" WHERE "itemId" = ${itemId}`;
    const outcome = await indexItem(
      { id: itemId, name: '电磁炉甲', description: '九成新电磁炉 家用 功率八档', category: '家电' },
      provider,
    );
    expect(outcome.status).toBe('indexed');
    const rows = await prisma.$queryRaw<{ communityId: string }[]>`
      SELECT e."communityId" FROM "ItemEmbedding" e WHERE e."itemId" = ${itemId}
    `;
    expect(rows[0]?.communityId).toBe(fx.communityAId);
  });

  it('物品不存在 ⇒ 不写入（不给 FK 留撞墙的机会，也不白烧嵌入）', async () => {
    const calls: string[] = [];
    const counting: EmbeddingProvider = {
      model: 'counting',
      dim: 4,
      embed: async (texts) => {
        calls.push(...texts);
        return texts.map(() => [0.1, 0.2, 0.3, 0.4]);
      },
    };
    const outcome = await indexItem(
      { id: `${SCOPE}-not-an-item`, name: '幽灵', description: null, category: null },
      counting,
    );
    expect(outcome).toMatchObject({ status: 'failed' });
    // 归属读不到就在 embed 之前返回：省掉一次必然作废的嵌入调用。
    expect(calls).toHaveLength(0);
  });

  it('手工把冗余列写坏，检索仍不返回他人社区物品（读端联表谓词兜底）', async () => {
    const itemId = `${SCOPE}-a1`;
    // 绕过写端、直接 UPDATE 造出分叉——正是数据库层没能拦住的那种坏状态。
    await prisma.$executeRaw`
      UPDATE "ItemEmbedding" SET "communityId" = ${fx.communityBId} WHERE "itemId" = ${itemId}
    `;
    try {
      const args = SimilarItemsArgsSchema.parse({ query: '电磁炉' });
      const items = await searchSimilarItems(fx.communityAId, args, provider);
      expect(items.map((i) => i.itemId)).not.toContain(itemId);
      const asB = await searchSimilarItems(fx.communityBId, args, provider);
      // 即便冗余列声称它属于乙区，联表的 `i."communityId"` 也会把它滤掉。
      expect(asB.map((i) => i.itemId)).not.toContain(itemId);
    } finally {
      // 用 UPDATE 还原而不是再调一次 indexItem：语料哈希没变，indexItem 会走
      // `skipped: unchanged` 短路、并不会把社区列修回来。
      await prisma.$executeRaw`
        UPDATE "ItemEmbedding" SET "communityId" = ${fx.communityAId} WHERE "itemId" = ${itemId}
      `;
    }
  });
});
