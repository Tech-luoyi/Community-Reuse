/**
 * LLM 结果缓存（`src/server/ai/cache.ts`）：**L1 进程内 LRU** + **L2 `AiCache` 表**。
 *
 * 事实源：docs/tech-design-final.md §6.1（缓存行）、§6.5.3（定价指纹，**T11 再扩展**）。
 *
 * 键：`sha256(kind + 规范化输入)`。规范化 = 递归按 key 字典序排序的稳定 JSON，确保**同语义输入
 * 必得同键**（与调用方对象的属性书写顺序无关）。
 *
 * L2 为**尽力而为**：DB 抖动/不可用时缓存读写**静默失败**，绝不因此让接口降级或报错
 * （缓存失效只是"少省一次调用"，不是错误）。L1 命中即零延迟返回。
 *
 * 存储体（envelope）除模型输出外，**同时记录 `usedTools` / `toolCalls`**：`source` 回答"哪个引擎
 * 产出"，与"是否查了社区数据"正交（§6.6.4）——命中缓存时按缓存体内记录值回填，T11 引入工具后无需改表。
 */
import { createHash } from 'node:crypto';

import type { AiKind } from '@/shared/types';

import { prisma } from '@/server/db';

/** L1 容量（LRU 上限）。 */
const L1_MAX_ENTRIES = 200;

/** 缓存存储体：模型输出 + 工具元信息。 */
export interface CacheEnvelope {
  /** 模型输出对象（已通过 schema 校验）。 */
  output: unknown;
  usedTools: boolean;
  toolCalls: number;
}

/** L1：`key → envelope`。`Map` 的插入顺序即 LRU 顺序（最近使用的在末尾）。 */
const l1 = new Map<string, CacheEnvelope>();

/**
 * 稳定规范化：递归排序对象 key，产出与属性书写顺序无关的 JSON 字符串。
 * 数组保序；`null`/原始值原样；`undefined` 归一为 `null`（JSON 无 undefined）。
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      sorted[key] = normalize(item);
    }
    return sorted;
  }
  return value;
}

/** `sha256(kind + 规范化输入)` → 十六进制键。 */
export function computeCacheKey(kind: AiKind, payload: unknown): string {
  return createHash('sha256')
    .update(`${kind}:${canonicalize(payload)}`)
    .digest('hex');
}

/** 读 L1（命中即刷新 LRU 位置）。 */
export function getL1(key: string): CacheEnvelope | null {
  const hit = l1.get(key);
  if (hit === undefined) {
    return null;
  }
  l1.delete(key);
  l1.set(key, hit);
  return hit;
}

/** 写 L1（超容则淘汰最久未使用者）。 */
export function setL1(key: string, envelope: CacheEnvelope): void {
  if (l1.has(key)) {
    l1.delete(key);
  }
  l1.set(key, envelope);
  while (l1.size > L1_MAX_ENTRIES) {
    const oldest = l1.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    l1.delete(oldest);
  }
}

/** 清空 L1（测试用）。 */
export function clearL1(): void {
  l1.clear();
}

/** 读 L2 `AiCache`（尽力而为；DB 异常 → `null`）。 */
export async function getL2(key: string): Promise<CacheEnvelope | null> {
  try {
    const row = await prisma.aiCache.findUnique({
      where: { inputHash: key },
      select: { outputJson: true },
    });
    if (row === null) {
      return null;
    }
    const parsed = JSON.parse(row.outputJson) as CacheEnvelope;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** 写 L2 `AiCache`（upsert；并发唯一冲突或 DB 异常均**静默忽略**）。 */
export async function putL2(key: string, kind: AiKind, envelope: CacheEnvelope): Promise<void> {
  const outputJson = JSON.stringify(envelope);
  try {
    await prisma.aiCache.upsert({
      where: { inputHash: key },
      create: { inputHash: key, kind, outputJson },
      update: { outputJson },
    });
  } catch {
    // 缓存写失败不影响主流程。
  }
}

/** 两级缓存读取：先 L1，再 L2（L2 命中回填 L1）。 */
export async function getCached(
  kind: AiKind,
  payload: unknown,
): Promise<{ key: string; envelope: CacheEnvelope } | null> {
  const key = computeCacheKey(kind, payload);
  const fromL1 = getL1(key);
  if (fromL1 !== null) {
    return { key, envelope: fromL1 };
  }
  const fromL2 = await getL2(key);
  if (fromL2 !== null) {
    setL1(key, fromL2);
    return { key, envelope: fromL2 };
  }
  return null;
}

/** 两级缓存写入：写 L2 并回填 L1。 */
export async function putCached(key: string, kind: AiKind, envelope: CacheEnvelope): Promise<void> {
  setL1(key, envelope);
  await putL2(key, kind, envelope);
}
