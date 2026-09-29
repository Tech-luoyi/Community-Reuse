/**
 * 嵌入供应商抽象单测（**mock 全局 fetch，离线**）。
 *
 * 覆盖 §6.5.9 的两条核心纪律：
 *   - **无 key 绝不发请求**（与 chat 网关同纪律）。
 *   - **维度不符必须抛错**，绝不静默写入——这是「换模型导致列宽与向量错位」
 *     这一类静默故障的唯一拦截点。
 * 另覆盖返回顺序归一化、批量切分、超时归因、语料规范化与幂等哈希。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EmbeddingUnavailableError,
  contentHash,
  getEmbeddingConfig,
  itemCorpusText,
  openAiCompatibleEmbeddings as provider,
} from '@/server/ai/embeddings';

const ENV_KEYS = [
  'EMBEDDING_BASE_URL',
  'EMBEDDING_API_KEY',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIM',
  'EMBEDDING_TIMEOUT_MS',
] as const;

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, overrides);
}

const CONFIGURED = {
  EMBEDDING_BASE_URL: 'https://embed.example.test/v1',
  EMBEDDING_API_KEY: 'sk-test-key',
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIM: '4',
};

function embeddingResponse(data: { index?: number; embedding: number[] }[]): Response {
  return { ok: true, status: 200, json: async () => ({ data }) } as unknown as Response;
}

describe('ai.embeddings：配置与无 key 短路', () => {
  beforeEach(() => setEnv(CONFIGURED));
  afterEach(() => {
    vi.unstubAllGlobals();
    setEnv({});
  });

  it('未配 API key ⇒ getEmbeddingConfig 返回 null 且一次请求都不发', async () => {
    setEnv({ EMBEDDING_BASE_URL: 'https://x/v1', EMBEDDING_MODEL: 'm', EMBEDDING_DIM: '4' });
    expect(getEmbeddingConfig()).toBeNull();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(provider.embed(['电磁炉'])).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('只有空白的 key 也算未配置', () => {
    setEnv({ ...CONFIGURED, EMBEDDING_API_KEY: '   ' });
    expect(getEmbeddingConfig()).toBeNull();
  });

  it('base URL 末尾斜杠被规整，避免拼出双斜杠路径', async () => {
    setEnv({ ...CONFIGURED, EMBEDDING_BASE_URL: 'https://embed.example.test/v1///' });
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        seen.push(String(url));
        return embeddingResponse([{ index: 0, embedding: [1, 2, 3, 4] }]);
      }),
    );
    await provider.embed(['x']);
    expect(seen[0]).toBe('https://embed.example.test/v1/embeddings');
  });
});

describe('ai.embeddings：维度纪律（本模块最重要的一条）', () => {
  beforeEach(() => setEnv(CONFIGURED));
  afterEach(() => vi.unstubAllGlobals());

  it('返回向量长度 ≠ 配置维度 ⇒ 抛错并说明需同步改迁移', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => embeddingResponse([{ index: 0, embedding: [1, 2, 3] }])),
    );
    await expect(provider.embed(['x'])).rejects.toThrow(/维度不符[\s\S]*列宽 4/);
  });

  it('长度恰好等于配置维度 ⇒ 正常返回', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => embeddingResponse([{ index: 0, embedding: [0.5, 0.5, 0.5, 0.5] }])),
    );
    await expect(provider.embed(['x'])).resolves.toEqual([[0.5, 0.5, 0.5, 0.5]]);
  });

  it('返回条数少于请求条数 ⇒ 抛错（不静默补零）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        embeddingResponse([
          { index: 0, embedding: [1, 2, 3, 4] },
          // 缺第二条
        ]),
      ),
    );
    await expect(provider.embed(['a', 'b'])).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it('按 index 归位，不依赖上游返回顺序', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        embeddingResponse([
          { index: 1, embedding: [9, 9, 9, 9] },
          { index: 0, embedding: [1, 1, 1, 1] },
        ]),
      ),
    );
    const out = await provider.embed(['第一条', '第二条']);
    expect(out[0]).toEqual([1, 1, 1, 1]);
    expect(out[1]).toEqual([9, 9, 9, 9]);
  });
});

describe('ai.embeddings：失败归因与批量', () => {
  beforeEach(() => setEnv(CONFIGURED));
  afterEach(() => vi.unstubAllGlobals());

  it('HTTP 非 2xx ⇒ 抛错并带上状态码与响应片段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            text: async () => 'no available channel',
          }) as unknown as Response,
      ),
    );
    await expect(provider.embed(['x'])).rejects.toThrow(/HTTP 503[\s\S]*no available channel/);
  });

  it('AbortController 触发 ⇒ 归因为超时', async () => {
    setEnv({ ...CONFIGURED, EMBEDDING_TIMEOUT_MS: '1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    await expect(provider.embed(['x'])).rejects.toThrow(/超时/);
  });

  it('超过单批上限会分批请求，且结果按序拼接', async () => {
    const texts = Array.from({ length: 33 }, (_unused, i) => `文本${i}`);
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        const parsed = JSON.parse(String(init?.body)) as { input: string[] };
        bodies.push(parsed.input.length);
        // index 是**批内**相对值（OpenAI 协议如此）
        return embeddingResponse(
          parsed.input.map((_text, at) => ({ index: at, embedding: [1, 2, 3, 4] })),
        );
      }),
    );
    const out = await provider.embed(texts);
    expect(bodies).toEqual([32, 1]);
    expect(out).toHaveLength(33);
    expect(out[32]).toEqual([1, 2, 3, 4]);
  });

  it('上游返回越界 index ⇒ 明确报非法 index，而不是误归因为网络错误', async () => {
    // 条数必须等于请求条数，否则会先被「条数不符」拦住，测不到 index 校验。
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        embeddingResponse([
          { index: 0, embedding: [1, 2, 3, 4] },
          { index: 7, embedding: [1, 2, 3, 4] },
        ]),
      ),
    );
    await expect(provider.embed(['x', 'y'])).rejects.toThrow(/非法 index/);
  });

  it('空输入直接返回空数组，不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(provider.embed([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ai.embeddings：语料规范化与幂等哈希', () => {
  it('字段顺序固定，且不受对象属性书写顺序影响', () => {
    const a = itemCorpusText({ name: '电磁炉', description: '八成新', category: '家电' });
    const b = itemCorpusText({ category: '家电', description: '八成新', name: '电磁炉' });
    expect(a).toBe(b);
    expect(a.split('\n')).toEqual(['电磁炉', '家电', '八成新']);
  });

  it('空字段被跳过，不留空行', () => {
    expect(itemCorpusText({ name: '电磁炉', description: null, category: '  ' })).toBe('电磁炉');
  });

  it('文本变则哈希变、文本不变则哈希不变', () => {
    const t1 = itemCorpusText({ name: '电磁炉', description: '八成新', category: null });
    const t2 = itemCorpusText({ name: '电磁炉', description: '九成新', category: null });
    expect(contentHash(t1)).toBe(contentHash(t1));
    expect(contentHash(t1)).not.toBe(contentHash(t2));
  });

  it('长度不同但内容前缀相同的文本不会碰撞', () => {
    expect(contentHash('电磁炉')).not.toBe(contentHash('电磁炉电磁炉'));
  });
});
