/**
 * 语义索引管道单测（**mock prisma + 假 provider，离线**）。
 *
 * 守三条纪律（§6.5.10 / 迁移 0003 头注）：
 *   - **永不抛异常**：embedding 挂掉绝不能让发布 / 归档失败。
 *   - raw UPSERT 必须**显式推进 `updatedAt`**，否则 §6.5.3 的社区指纹漏检、旧定价缓存不失效。
 *   - 语料未变则**不重算**（省一次外部调用）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingProvider } from '@/server/ai/embeddings';
import { contentHash, itemCorpusText } from '@/server/ai/embeddings';
import { indexAfterCommit, indexItem, unindexItem } from '@/server/ai/index-pipeline';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock('@/server/db', () => ({
  prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw },
}));

const ITEM = {
  id: 'i_1',
  name: '九成新电磁炉',
  description: '用了半年，8档功率',
  category: '家电',
};

/** 本模块对 $queryRaw 有两类查询：读语料哈希（ItemEmbedding）与读真值社区（Item）。 */
const OWN_COMMUNITY = 'c_own';

function dispatchQueryRaw(opts?: {
  existing?: { contentHash: string }[];
  item?: { communityId: string }[];
}) {
  const existing = opts?.existing ?? [];
  const item = opts?.item ?? [{ communityId: OWN_COMMUNITY }];
  return async (parts: TemplateStringsArray): Promise<unknown> => {
    const text = parts.join('');
    if (text.includes('FROM "ItemEmbedding"')) {
      return existing;
    }
    if (text.includes('FROM "Item"')) {
      return item;
    }
    throw new Error(`index-pipeline 发出了预期的两类之外的查询：${text}`);
  };
}

function fakeProvider(vector: number[] = [0.1, 0.2, 0.3]): EmbeddingProvider {
  return {
    model: 'fake',
    dim: vector.length,
    embed: vi.fn(async () => [vector]),
  };
}

function sqlText(call: unknown[]): string {
  const [strings, ...values] = call as unknown as [TemplateStringsArray, ...unknown[]];
  // 只需静态文本来断言 SQL 形状，绑定值另取。
  void values;
  return strings.join('?');
}

function boundValues(call: unknown[]): unknown[] {
  const [, ...values] = call as unknown as [TemplateStringsArray, ...unknown[]];
  return values;
}

describe('ai.index-pipeline', () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.executeRaw.mockReset();
    mocks.queryRaw.mockImplementation(dispatchQueryRaw());
    mocks.executeRaw.mockResolvedValue(1);
  });

  it('provider 未配置 ⇒ skipped 且一次 DB 写都不发生', async () => {
    const r = await indexItem(ITEM, null);
    expect(r).toEqual({ status: 'skipped', why: 'embedding-unconfigured' });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('语料哈希未变 ⇒ 跳过，不调 provider 也不写库', async () => {
    const same = contentHash(itemCorpusText(ITEM));
    mocks.queryRaw.mockImplementation(dispatchQueryRaw({ existing: [{ contentHash: same }] }));
    const provider = fakeProvider();
    const r = await indexItem(ITEM, provider);
    expect(r).toEqual({ status: 'skipped', why: 'unchanged' });
    expect(provider.embed).not.toHaveBeenCalled();
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('物品不存在 ⇒ failed，且**不烧**一次必然作废的嵌入调用', async () => {
    mocks.queryRaw.mockImplementation(dispatchQueryRaw({ item: [] }));
    const provider = fakeProvider();
    const r = await indexItem({ ...ITEM, id: 'ghost' }, provider);
    expect(r).toMatchObject({ status: 'failed' });
    expect(provider.embed).not.toHaveBeenCalled();
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('语料变化 ⇒ 写入并显式推进 updatedAt（§6.5.3 指纹不漏检的前提）', async () => {
    const r = await indexItem(ITEM, fakeProvider());
    expect(r).toEqual({ status: 'indexed' });
    const call = mocks.executeRaw.mock.calls[0];
    expect(call).toBeDefined();
    const text = sqlText(call as unknown[]);
    expect(text).toMatch(/INSERT INTO "ItemEmbedding"/);
    expect(text).toMatch(/ON CONFLICT \("itemId"\) DO UPDATE/);
    // 关键断言：updatedAt 被显式赋值，而不是依赖 DB 默认值
    expect(text).toMatch(/"updatedAt"\s*=\s*now\(\)/);
    expect(text).toMatch(/"createdAt",\s*"updatedAt"/);
  });

  it('社区与向量都走绑定参数，不拼进 SQL 文本', async () => {
    await indexItem(ITEM, fakeProvider([1, 2, 3]));
    const call = mocks.executeRaw.mock.calls[0] as unknown[];
    expect(sqlText(call)).not.toContain('c_own');
    expect(boundValues(call)).toContain('c_own');
    expect(boundValues(call)).toContain('[1,2,3]');
    // 向量列在 SQL 侧 cast，而非把字面量拼进去
    expect(sqlText(call)).toMatch(/\$\?::vector|\?::vector/);
  });

  it('provider 抛错 ⇒ status=failed，且**不向上抛**（发布接口不受影响）', async () => {
    const broken: EmbeddingProvider = {
      model: 'x',
      dim: 3,
      embed: async () => {
        throw new Error('embeddings down');
      },
    };
    await expect(indexItem(ITEM, broken)).resolves.toMatchObject({ status: 'failed' });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('DB 写失败 ⇒ status=failed，不抛', async () => {
    mocks.executeRaw.mockRejectedValue(new Error('column does not exist'));
    await expect(indexItem(ITEM, fakeProvider())).resolves.toMatchObject({ status: 'failed' });
  });

  it('空向量 ⇒ failed（不写入无意义行）', async () => {
    const empty: EmbeddingProvider = { model: 'x', dim: 0, embed: async () => [[]] };
    await expect(indexItem(ITEM, empty)).resolves.toMatchObject({ status: 'failed' });
  });

  it('非有限向量分量被归零，避免写出非法 pgvector 字面量', async () => {
    await indexItem(ITEM, fakeProvider([Number.NaN, Infinity, 0.5]));
    const values = boundValues(mocks.executeRaw.mock.calls[0] as unknown[]);
    expect(values).toContain('[0,0,0.5]');
  });

  it('indexAfterCommit 是 fire-and-forget：内部失败既不抛也不阻塞', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: EmbeddingProvider = {
      model: 'x',
      dim: 1,
      embed: async () => {
        throw new Error('down');
      },
    };
    expect(() => indexAfterCommit(ITEM, broken)).not.toThrow();
    warn.mockRestore();
  });

  it('unindexItem 在表不存在时也不抛', async () => {
    mocks.executeRaw.mockRejectedValue(new Error('relation does not exist'));
    await expect(unindexItem('i_1')).resolves.toBeUndefined();
  });
});
