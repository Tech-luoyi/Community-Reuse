/**
 * 发布 / 编辑是否真的触发语义索引（§6.5.9「事务后异步重算」= T11b 验收的一条）。
 *
 * 这条一度只是文档口径：`indexAfterCommit` 写好了却**零生产调用方**，向量只有手工
 * `npm run db:embed` 才产得出。离线单测全绿也照不出来——桩函数压根不接参数，
 * 于是「有没有人调它」这件事从来没有断言覆盖。这里从**路由层**打到 `ItemEmbedding` 表，
 * 用确定性假 provider，**不需要任何 EMBEDDING_* Key**。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { POST as itemsPOST } from '@/app/api/items/route';
import { PATCH as itemPATCH } from '@/app/api/items/[id]/route';
import { contentHash, itemCorpusText } from '@/server/ai/embeddings';
import { prisma } from '@/server/db';
import type { ItemDto } from '@/shared/types';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
  mintSessionToken,
  pool,
} from './helpers/db';
import { makeRequest } from './helpers/http';

/** 被 mock 的 provider 与其调用记录（`vi.hoisted`：mock 工厂比 import 先执行）。 */
const holder = vi.hoisted(() => ({
  provider: null as null | {
    model: string;
    dim: number;
    embed: (texts: string[]) => Promise<number[][]>;
  },
  texts: [] as string[],
  failing: false,
}));

vi.mock('@/server/ai/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/ai/embeddings')>();
  return {
    // 其余原样保留：`contentHash` / `itemCorpusText` 必须用真实实现，
    // 否则断言哈希就成了自证。只替换「有没有 Key」这一个开关。
    ...actual,
    getEmbeddingProvider: () => holder.provider,
  };
});

const SCOPE = 'items-embedding';
const createdItemIds: string[] = [];

interface VectorRow {
  communityId: string;
  contentHash: string;
  embedding: string;
}

async function readVector(itemId: string): Promise<VectorRow | null> {
  const { rows } = await pool.query<VectorRow>(
    `SELECT "communityId", "contentHash", "embedding"::text AS "embedding"
       FROM "ItemEmbedding" WHERE "itemId" = $1`,
    [itemId],
  );
  return rows[0] ?? null;
}

/**
 * 等异步索引落库。`indexAfterCommit` 是 fire-and-forget，不 await 是刻意的
 * （发布接口的成败不该由嵌入服务决定），所以这里只能轮询——带上期望哈希才算真的验到
 * 「重算发生了」，而不是读到上一版的旧行。
 */
async function waitForVector(itemId: string, expectHash?: string): Promise<VectorRow | null> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const row = await readVector(itemId);
    if (row !== null && (expectHash === undefined || row.contentHash === expectHash)) {
      return row;
    }
    if (Date.now() > deadline) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function corpusOf(name: string, description: string, category: string | null): string {
  return contentHash(itemCorpusText({ name, description, category }));
}

describe('发布 / 编辑触发语义索引（真连库）', () => {
  let fx: TenantFixtures;
  let ownerToken = '';

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    // 上一轮崩在半路留下的 cuid 物品会一直挡住夹具用户的删除（`Item_ownerId_fkey`），
    // 而夹具的 LIKE 清理够不着它们 —— 先按 owner 兜底清一遍，保证可重复跑。
    const like = `itest-${SCOPE}-%`;
    await pool.query(
      `DELETE FROM "ItemEmbedding" WHERE "itemId" IN (SELECT id FROM "Item" WHERE "ownerId" LIKE $1)`,
      [like],
    );
    await pool.query(`DELETE FROM "Item" WHERE "ownerId" LIKE $1`, [like]);

    fx = await createTenantFixtures(SCOPE);
    ownerToken = mintSessionToken(fx.ownerId, fx.communityAId);

    holder.texts.length = 0;
    holder.failing = false;
    holder.provider = {
      model: 'fake-1024',
      dim: 1024,
      embed: async (texts) => {
        holder.texts.push(...texts);
        if (holder.failing) {
          throw new Error('嵌入服务不可用');
        }
        // 固定形状的 1024 维向量（= 迁移 0004 的列宽）：本文件验的是**写路径有没有被接上**，
        // 不是语义质量。维度对不上时 PG 会在 insert 处直接拒掉，所以这里的长度是断言的一部分。
        return texts.map(() => Array.from({ length: 1024 }, (_, i) => (i % 7) / 7));
      },
    };
  });

  afterAll(async () => {
    // POST 出来的物品 id 是 cuid，不匹配夹具的 `itest-<scope>-` 前缀，
    // cleanupFixtures 的 LIKE 删除够不着它们 —— 不先删就会卡在 Item_ownerId_fkey 上。
    if (createdItemIds.length > 0) {
      await prisma.itemEmbedding.deleteMany({ where: { itemId: { in: createdItemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
    }
    await cleanupFixtures(SCOPE);
    await prisma.$disconnect();
    await closePool();
    holder.provider = null;
  });

  async function publish(name: string, description: string): Promise<ItemDto> {
    const response = await itemsPOST(
      makeRequest('POST', '/api/items', {
        token: ownerToken,
        body: {
          communityId: fx.communityAId,
          name,
          description,
          category: '厨房小家电',
          tradeType: 'FREE',
        },
      }),
    );
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: ItemDto };
    createdItemIds.push(data.id);
    return data;
  }

  it('发布即建向量：行落在正确的社区，哈希与语料一致', async () => {
    const name = `${SCOPE}-电磁炉`;
    const item = await publish(name, '九成新，附带锅');

    const row = await waitForVector(item.id, corpusOf(name, '九成新，附带锅', '厨房小家电'));
    expect(row).not.toBeNull();
    expect(row?.communityId).toBe(fx.communityAId);
    // 列宽真被满足（1024 个分量 ⇒ 1023 个逗号）——维度错位是在 PG 侧炸的，不是在这里猜的。
    expect(row?.embedding.split(',')).toHaveLength(1024);
  });

  it('改文案触发重算：哈希推进到语料的新值', async () => {
    const name = `${SCOPE}-婴儿车`;
    const item = await publish(name, '能用');
    await waitForVector(item.id, corpusOf(name, '能用', '厨房小家电'));
    const before = holder.texts.length;

    const response = await itemPATCH(
      makeRequest('PATCH', `/api/items/${item.id}`, {
        token: ownerToken,
        body: { description: '可折叠，带雨罩' },
      }),
      { params: Promise.resolve({ id: item.id }) },
    );
    expect(response.status, await response.clone().text()).toBe(200);

    const row = await waitForVector(item.id, corpusOf(name, '可折叠，带雨罩', '厨房小家电'));
    expect(row).not.toBeNull();
    expect(holder.texts.length).toBe(before + 1);
  });

  it('语料未变则幂等：不白烧一次嵌入调用', async () => {
    const name = `${SCOPE}-台灯`;
    const item = await publish(name, '暖光');
    await waitForVector(item.id, corpusOf(name, '暖光', '厨房小家电'));
    const calls = holder.texts.length;

    // 只改价：嵌入语料（名称 / 分类 / 描述）一个字没动。
    const response = await itemPATCH(
      makeRequest('PATCH', `/api/items/${item.id}`, {
        token: ownerToken,
        body: { tradeType: 'FIXED_PRICE', price: 39 },
      }),
      { params: Promise.resolve({ id: item.id }) },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(holder.texts.length).toBe(calls);
    const row = await readVector(item.id);
    expect(row?.contentHash).toBe(corpusOf(name, '暖光', '厨房小家电'));
  });

  it('嵌入服务挂掉不阻断发布，只是没有向量', async () => {
    holder.failing = true;
    const name = `${SCOPE}-绿植`;
    const item = await publish(name, '养不死');

    expect(item.name).toBe(name);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await readVector(item.id)).toBeNull();

    holder.failing = false;
  });
});
