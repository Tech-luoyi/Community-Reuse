/**
 * 嵌入供应商抽象（`src/server/ai/embeddings.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.5.9。
 *
 * **为什么是接口而不是直接 fetch**：chat 与 embedding 在这个环境里**必然是两个供应商**——
 * 实测当前 chat 网关只有 4 个模型、全是 chat，`POST /embeddings` 返回
 * `503 model_not_found`；而 `api.openai.com` 在本机 `HTTP=000`（TCP 都握不上）。
 * 把 embedding 收成接口 + env 驱动，换供应商就是改三行配置，不动一行调用方代码。
 *
 * **维度纪律（本模块最重要的一条）**：`EMBEDDING_DIM` 进迁移、不进运行时——
 * 列宽在建表时定死。这里每次调用都校验返回向量长度是否等于配置维度，
 * **不符就抛错**，绝不静默写入。理由：若让维度在运行时可变，换一次模型就会
 * 得到「写入 1536、列宽 1024」或更糟的「列宽 1536、查询用 1024 向量算距离」，
 * 后者不报错、只是召回悄悄变差。显式失败好过静默错位。
 */
import { createHash } from 'node:crypto';

/** 嵌入不可用（无 key / 不可达 / 超时 / 维度不符）——调用方按 §6.5.7 F4 摘除检索工具。 */
export class EmbeddingUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

export interface EmbeddingProvider {
  readonly model: string;
  /** 向量维度；**必须**与迁移里 `vector(<dim>)` 一致。 */
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dim: number;
  timeoutMs: number;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * 读嵌入配置。
 * @returns 未配 `EMBEDDING_API_KEY` 时返回 `null` —— 与 chat 网关同纪律：**无 key 绝不发无效请求**。
 */
export function getEmbeddingConfig(): EmbeddingConfig | null {
  const rawKey = process.env.EMBEDDING_API_KEY;
  if (rawKey === undefined || rawKey.trim() === '') {
    return null;
  }
  const rawBaseUrl = process.env.EMBEDDING_BASE_URL?.trim() || 'https://api.openai.com/v1';
  // 去掉末尾斜杠：下面统一拼 `${baseUrl}/embeddings`，双斜杠会得到 404。
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  return {
    baseUrl,
    apiKey: rawKey.trim(),
    model: process.env.EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
    dim: positiveInt(process.env.EMBEDDING_DIM, 1536),
    timeoutMs: positiveInt(process.env.EMBEDDING_TIMEOUT_MS, 8_000),
  };
}

/** 单批最大条数：避免一次请求塞过长文本被上游拒。 */
const MAX_BATCH = 32;

/**
 * OpenAI 兼容协议的嵌入实现。
 *
 * 只用全局 `fetch`（Node 22 原生），与 `gateway.ts` 同一套风格，零新增依赖。
 *
 * @throws EmbeddingUnavailableError
 */
export const openAiCompatibleEmbeddings: EmbeddingProvider = {
  get model() {
    return getEmbeddingConfig()?.model ?? 'unconfigured';
  },
  get dim() {
    return getEmbeddingConfig()?.dim ?? 0;
  },
  async embed(texts: string[]): Promise<number[][]> {
    const config = getEmbeddingConfig();
    if (config === null) {
      throw new EmbeddingUnavailableError('未配置 EMBEDDING_API_KEY');
    }
    if (texts.length === 0) {
      return [];
    }
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetch(`${config.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({ model: config.model, input: batch }),
          signal: controller.signal,
        });
        const detail = response.ok ? '' : (await response.text().catch(() => '')).slice(0, 200);
        if (!response.ok) {
          throw new EmbeddingUnavailableError(
            `${config.baseUrl}/embeddings HTTP ${response.status} ${detail}`,
          );
        }
        const json = (await response.json()) as {
          data?: { index?: number; embedding?: number[] }[];
        };
        const rows = json.data ?? [];
        if (rows.length !== batch.length) {
          throw new EmbeddingUnavailableError(
            `嵌入条数不符：请求 ${batch.length} 收到 ${rows.length}`,
          );
        }
        // 按 index 归位：上游不保证返回顺序与请求顺序一致。
        const ordered: number[][] = new Array<number[]>(batch.length);
        for (const [pos, row] of rows.entries()) {
          const at = typeof row.index === 'number' ? row.index : pos;
          // index 越界会造出稀疏数组，后续 `vec.length` 抛 TypeError 并被误归因为「网络错误」——
          // 所以这里显式拦住，让归因说真话。
          if (!Number.isInteger(at) || at < 0 || at >= batch.length) {
            throw new EmbeddingUnavailableError(
              `嵌入返回非法 index ${String(row.index)}（本批 ${batch.length} 条）`,
            );
          }
          ordered[at] = row.embedding ?? [];
        }
        for (const [at, vec] of ordered.entries()) {
          if (!Array.isArray(vec)) {
            throw new EmbeddingUnavailableError(`嵌入缺少第 ${at} 条结果`);
          }
          if (vec.length !== config.dim) {
            throw new EmbeddingUnavailableError(
              `向量维度不符：第 ${at} 条长度 ${vec.length}，列宽 ${config.dim}（换模型需同步改迁移并回填）`,
            );
          }
        }
        out.push(...ordered);
      } catch (error) {
        if (error instanceof EmbeddingUnavailableError) {
          throw error;
        }
        const why = controller.signal.aborted ? `超时 ${config.timeoutMs}ms` : '网络错误';
        throw new EmbeddingUnavailableError(`嵌入请求失败（${why}）`);
      } finally {
        clearTimeout(timer);
      }
    }
    return out;
  },
};

/**
 * 配置齐备则返回 provider，否则 `null`。
 *
 * 存在的理由：调用方需要**在把语义工具交给模型之前**就知道嵌入到底有没有，
 * 而不是派出一轮注定失败的工具调用再靠降级兜——§6.6.4 的延迟预算是按轮计的。
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  return getEmbeddingConfig() === null ? null : openAiCompatibleEmbeddings;
}

/**
 * 语料规范化：物品 → 送去嵌入的文本。
 *
 * 覆盖**一切影响语义的字段**，且顺序固定——否则同一物品会因拼接顺序不同产生不同向量。
 */
export function itemCorpusText(item: {
  name: string;
  description: string | null;
  category: string | null;
}): string {
  return [item.name.trim(), (item.category ?? '').trim(), (item.description ?? '').trim()]
    .filter((part) => part.length > 0)
    .join('\n');
}

/**
 * 幂等指纹：语料未变则跳过重算，避免每次归档动作都白烧一次嵌入调用。
 * 长度也一并纳入，堵住「不同文本哈希碰撞」这一路（虽然实际极难发生）。
 */
export function contentHash(text: string): string {
  return createHash('sha256').update(`${text.length}:${text}`).digest('hex');
}
