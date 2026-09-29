/**
 * AI 编排服务的单测（**mock 缓存 / `fetch` / 守卫与 prisma，离线**）。
 *
 * 覆盖 `ai/service.ts` 的隐式流程不变量：
 *   - 无 Key ⇒ `degraded:true, source:'rule'` 且 **0 次模型调用**。
 *   - 合法 JSON ⇒ `source:'llm'`；枚举**大小写/空白归一化**（`free`/`Free`/`FREE ` 不触发 REPAIR）。
 *   - 非法 JSON / 非法枚举 ⇒ `REPAIR` **恰好 1 次**；仍失败才降级。
 *   - 5xx / 网络 / 4xx ⇒ 降级（重试次数由 gateway 单测覆盖；此处只断言"最终降级"）。
 *   - 缓存命中 ⇒ `source:'cache'` 且 **0 次模型调用**。
 *   - 响应恒含四字段 `degraded/source/usedTools/toolCalls`。
 *
 * 注：`timeout → 降级` 由 `gateway.test.ts`（AbortController 归因 timeout）与本文件"任一网关失败 ⇒ 降级"
 * 共同覆盖——服务层对 `callModel` 的**任何** `ok:false` 一律降级（对 reason 无分支），故无需在服务层
 * 单独再跑一次真实 6s 超时。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCached: vi.fn(),
  putCached: vi.fn(),
  computeCacheKey: vi.fn(() => 'cache-key'),
  loadItem: vi.fn(),
  itemFindUnique: vi.fn(),
  communityFindUnique: vi.fn(),
  // 定价服务层会先算社区成交数据指纹（§6.5.3），故 prisma mock 必须提供 $queryRaw。
  queryRaw: vi.fn(),
}));

vi.mock('@/server/ai/cache', () => ({
  getCached: mocks.getCached,
  putCached: mocks.putCached,
  computeCacheKey: mocks.computeCacheKey,
}));
vi.mock('@/server/auth/guard', () => ({
  // FAQ 走 `requireOwner`（契约 §8 权限例外：仅发布者可取回复建议）；服务层不再用其它守卫。
  requireOwner: mocks.loadItem,
}));
vi.mock('@/server/db', () => ({
  prisma: {
    item: { findUnique: mocks.itemFindUnique },
    community: { findUnique: mocks.communityFindUnique },
    $queryRaw: mocks.queryRaw,
  },
}));

import { generateFaq, generatePricing, generatePolish } from '@/server/ai/service';

const VIEWER = { id: 'u1', nickname: 'n', contactText: null, currentCommunityId: 'c1' };

function jsonResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

function contentResponse(content: string): Response {
  return jsonResponse(200, { choices: [{ message: { content } }] });
}

describe('ai.service：定价/润色/FAQ 编排', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocks.getCached.mockReset();
    mocks.putCached.mockReset();
    // 定价会算社区指纹；默认给「空成交集合」，让键稳定且不抛错。
    mocks.queryRaw.mockReset();
    mocks.queryRaw.mockResolvedValue([{ count: 0, maxUpdatedAt: null }]);
    mocks.computeCacheKey.mockReset();
    mocks.loadItem.mockReset();
    mocks.itemFindUnique.mockReset();
    mocks.communityFindUnique.mockReset();

    mocks.getCached.mockResolvedValue(null);
    mocks.putCached.mockResolvedValue(undefined);
    mocks.computeCacheKey.mockReturnValue('cache-key');

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('无 Key ⇒ 降级为规则结果，且**一次模型调用都没有**', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    const result = await generatePricing({ name: '婴儿车' }, 'c1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: 'FREE',
      degraded: true,
      source: 'rule',
      usedTools: false,
      toolCalls: 0,
    });
    expect(mocks.putCached).not.toHaveBeenCalled();
  });

  it('合法 JSON ⇒ source=llm；大小写/空白归一化（free / Free / "FREE "）都不触发 REPAIR', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    for (const raw of ['free', 'Free', '  FREE  ']) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(
        contentResponse(JSON.stringify({ mode: raw, priceRange: null, reason: 'ok' })),
      );
      const result = await generatePricing({ name: '台灯' }, 'c1');
      expect(result.mode).toBe('FREE');
      expect(result.degraded).toBe(false);
      expect(result.source).toBe('llm');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    expect(mocks.putCached).toHaveBeenCalled();
  });

  it('非法 JSON ⇒ REPAIR 恰好 1 次 → 仍非法 ⇒ 降级', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    fetchMock
      .mockResolvedValueOnce(contentResponse('这不是 JSON'))
      .mockResolvedValueOnce(contentResponse('仍然不是 JSON'));
    const result = await generatePricing({ name: '台灯' }, 'c1');

    expect(fetchMock).toHaveBeenCalledTimes(2); // 首次 + 修补轮各 1 次
    expect(result).toMatchObject({
      degraded: true,
      source: 'rule',
      usedTools: false,
      toolCalls: 0,
    });
    expect(mocks.putCached).not.toHaveBeenCalled();
  });

  it('非法枚举(paid) ⇒ REPAIR 1 次 → 修补轮合法 ⇒ source=llm', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    fetchMock.mockResolvedValueOnce(
      contentResponse(JSON.stringify({ mode: 'paid', priceRange: null, reason: 'x' })),
    );
    fetchMock.mockResolvedValueOnce(
      contentResponse(
        JSON.stringify({
          mode: 'PRICED',
          priceRange: { min: 20, max: 80, currency: 'CNY' },
          reason: 'y',
        }),
      ),
    );
    const result = await generatePricing({ name: '台灯' }, 'c1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ mode: 'PRICED', degraded: false, source: 'llm' });
  });

  it('5xx ⇒ 重试后仍失败 ⇒ 降级（共 2 次 fetch）', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    fetchMock.mockResolvedValue(jsonResponse(503, {}));
    const result = await generatePricing({ name: '台灯' }, 'c1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ degraded: true, source: 'rule' });
  });

  it('4xx ⇒ 不重试 ⇒ 降级（共 1 次 fetch）', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    fetchMock.mockResolvedValue(jsonResponse(400, {}));
    const result = await generatePolish({ rawText: '九成新' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      degraded: true,
      source: 'rule',
      usedTools: false,
      toolCalls: 0,
    });
  });

  it('缓存命中 ⇒ source=cache 且**不调模型**，并回填缓存的 usedTools/toolCalls', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    mocks.getCached.mockResolvedValue({
      key: 'cache-key',
      envelope: {
        output: { mode: 'PRICED', priceRange: null, reason: 'cached' },
        usedTools: false,
        toolCalls: 0,
      },
    });
    const result = await generatePricing({ name: '台灯' }, 'c1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.putCached).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: 'PRICED', degraded: false, source: 'cache' });
  });

  it('FAQ：命中物品与社区后，合法模型输出 ⇒ source=llm', async () => {
    vi.stubEnv('LLM_API_KEY', 'k');
    mocks.loadItem.mockResolvedValue({
      id: 'item1',
      ownerId: 'o1',
      communityId: 'c1',
      name: '婴儿车',
      status: 'ACTIVE',
      tradeType: 'FREE',
      price: null,
    });
    mocks.itemFindUnique.mockResolvedValue({ description: '九成新' });
    mocks.communityFindUnique.mockResolvedValue({ name: '阳光小区' });
    fetchMock.mockResolvedValue(
      contentResponse(JSON.stringify({ answer: '在的，随时可约自提～', confidence: 0.86 })),
    );

    const result = await generateFaq(VIEWER, { itemId: 'item1', question: '还在吗' });
    expect(result).toMatchObject({
      degraded: false,
      source: 'llm',
      usedTools: false,
      toolCalls: 0,
    });
    expect(result.confidence).toBeCloseTo(0.86);
  });

  it('FAQ：无 Key ⇒ 规则降级且不含社区外信息（用社区名兜底文案）', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    mocks.loadItem.mockResolvedValue({
      id: 'item1',
      ownerId: 'o1',
      communityId: 'c1',
      name: '婴儿车',
      status: 'ACTIVE',
      tradeType: 'FREE',
      price: null,
    });
    mocks.itemFindUnique.mockResolvedValue({ description: '九成新' });
    mocks.communityFindUnique.mockResolvedValue({ name: '阳光小区' });

    const result = await generateFaq(VIEWER, { itemId: 'item1', question: '可以自提吗' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ degraded: true, source: 'rule' });
    expect(result.answer).toContain('阳光小区');
  });
});
