/**
 * AI 缓存与三接口的**真连库**集成测试。
 *
 * 覆盖（离线不可替代的部分）：
 *   1. **L2（`AiCache` 表）命中** ⇒ 返回 `source:'cache'` 且**不再调用模型**（真写库、清 L1 后走 L2）。
 *   2. 无 Key 时三接口**端到端**仍 200 + `degraded:true/source:'rule'`，且响应恒含四字段。
 *   3. FAQ 对**跨社区**物品返回 404（租户红线）。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { POST as faqPOST } from '@/app/api/ai/faq/route';
import { POST as polishPOST } from '@/app/api/ai/polish/route';
import { POST as pricingPOST } from '@/app/api/ai/pricing/route';
import { clearL1, computeCacheKey } from '@/server/ai/cache';
import { resetAiRateLimit } from '@/server/ai/rate-limit';
import { prisma } from '@/server/db';
import { generatePricing } from '@/server/services/ai.service';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
  mintSessionToken,
  pool,
} from './helpers/db';
import { makeRequest } from './helpers/http';

const SUBMIT_MARKER = 'itest-ai-cache';

// 传给服务层的请求体（`PricingRequest`：分类可选，故此处不传 category）。
const CACHE_INPUT = { name: `${SUBMIT_MARKER}-唯一缓存物品`, description: '缓存命中测试' };
// 与服务内部 cachePayload 对齐（分类缺省归一为 null），用于计算 / 清理缓存键。
const CACHE_PAYLOAD = {
  name: CACHE_INPUT.name,
  description: CACHE_INPUT.description ?? null,
  category: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

describe('AI 缓存与三接口（真连库）', () => {
  const scope = 'ai-cache';
  let fx: TenantFixtures;
  let ownerToken: string;
  let cacheKey = '';
  const originalKey = process.env.LLM_API_KEY;

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    fx = await createTenantFixtures(scope);
    ownerToken = mintSessionToken(fx.ownerId, fx.communityAId);
    resetAiRateLimit();
    clearL1();

    cacheKey = computeCacheKey('PRICING', CACHE_PAYLOAD);
    await pool.query(`DELETE FROM "AiCache" WHERE "inputHash" = $1`, [cacheKey]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM "AiCache" WHERE "inputHash" = $1`, [cacheKey]);
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
    if (originalKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalKey;
    }
    vi.unstubAllGlobals();
  });

  it('L2 命中 ⇒ source=cache，且**不再调用模型**', async () => {
    process.env.LLM_API_KEY = 'integration-test-key';

    // 第一次：真实走"模型"（mock fetch），成功后应写入 L2。
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                mode: 'PRICED',
                priceRange: { min: 30, max: 60, currency: 'CNY' },
                reason: '缓存命中测试用',
              }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await generatePricing(CACHE_INPUT);
    expect(first).toMatchObject({ mode: 'PRICED', degraded: false, source: 'llm' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const persisted = await pool.query(`SELECT 1 FROM "AiCache" WHERE "inputHash" = $1`, [
      cacheKey,
    ]);
    expect(persisted.rowCount).toBe(1);

    // 清 L1，强制走 L2；并把 fetch 换成"一调用即失败"，证明命中缓存后根本没碰模型。
    clearL1();
    const shouldNotCall = vi.fn().mockRejectedValue(new Error('模型不应被调用'));
    vi.stubGlobal('fetch', shouldNotCall);

    const second = await generatePricing(CACHE_INPUT);
    expect(second).toMatchObject({ mode: 'PRICED', degraded: false, source: 'cache' });
    expect(shouldNotCall).not.toHaveBeenCalled();
  });

  it('无 Key ⇒ 三接口端到端均 200 + degraded:true/source:rule，且四字段齐备', async () => {
    process.env.LLM_API_KEY = '';
    const notCalled = vi.fn().mockRejectedValue(new Error('无 Key 不应发请求'));
    vi.stubGlobal('fetch', notCalled);

    const pricing = await pricingPOST(
      makeRequest('POST', '/api/ai/pricing', { token: ownerToken, body: { name: '台灯' } }),
    );
    expect(pricing.status).toBe(200);
    const pricingJson = (await pricing.json()) as { data: Record<string, unknown> };
    expect(pricingJson.data).toMatchObject({
      degraded: true,
      source: 'rule',
      usedTools: false,
      toolCalls: 0,
    });

    const polish = await polishPOST(
      makeRequest('POST', '/api/ai/polish', { token: ownerToken, body: { rawText: '九成新台灯' } }),
    );
    expect(polish.status).toBe(200);
    const polishJson = (await polish.json()) as { data: Record<string, unknown> };
    expect(polishJson.data).toMatchObject({
      degraded: true,
      source: 'rule',
      usedTools: false,
      toolCalls: 0,
    });

    const faq = await faqPOST(
      makeRequest('POST', '/api/ai/faq', {
        token: ownerToken,
        body: { itemId: fx.itemAId, question: '还在吗' },
      }),
    );
    expect(faq.status).toBe(200);
    const faqJson = (await faq.json()) as { data: Record<string, unknown> };
    expect(faqJson.data).toMatchObject({
      degraded: true,
      source: 'rule',
      usedTools: false,
      toolCalls: 0,
    });

    expect(notCalled).not.toHaveBeenCalled();
  });

  it('FAQ 对**跨社区**物品返回 404（租户红线）', async () => {
    process.env.LLM_API_KEY = '';
    const response = await faqPOST(
      makeRequest('POST', '/api/ai/faq', {
        token: ownerToken,
        body: { itemId: fx.itemBId, question: '还在吗' },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('未登录 ⇒ 401', async () => {
    const response = await pricingPOST(
      makeRequest('POST', '/api/ai/pricing', { body: { name: '台灯' } }),
    );
    expect(response.status).toBe(401);
  });
});
