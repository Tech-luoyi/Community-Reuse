/**
 * 多轮会话记忆（真 `PostgresSaver`）集成测试。
 *
 * 与 `tests/unit/ai/checkpoint.test.ts` 的分工：那边用 `MemorySaver` 验证**图的控制流**
 * 与 thread key 语义（离线、可重复）；这里验证**真落库**——跨进程恢复、按 thread 隔离、
 * 以及 checkpoint 表里确实有行。假件永远测不出「连接串里带 `?schema=` 会把 node-postgres
 * 弄坏」这类只有真库才暴露的问题。
 *
 * 门控：需 `RUN_INTEGRATION=1`；表由 `npx tsx prisma/setup-checkpoint.ts` 建立。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  closeCheckpointer,
  getCheckpointer,
  pricingThreadKey,
  setupCheckpointer,
} from '@/server/ai/checkpoint';
import { type AgentRunSpec, runAgentGraph } from '@/server/ai/graph';
import type { ModelTurn } from '@/server/ai/gateway';
import { prisma } from '@/server/db';
import { closePool, pool } from './helpers/db';
const Schema = z.object({ mode: z.enum(['FREE', 'PRICED']), reason: z.string() });
type Out = { mode: 'FREE' | 'PRICED'; reason: string };
/** 记录每次模型调用看到的消息，用于断言「第二遍看得见第一遍」。 */
function recordingModel(sink: { role: string; content: string }[]) {
  return {
    turn: async (options: { messages: { role: string; content: string }[] }) => {
      sink.push(...options.messages);
      return {
        ok: true,
        kind: 'content',
        content: '{"mode":"PRICED","reason":"ok"}',
      } as ModelTurn;
    },
  };
}
function spec(
  overrides: Partial<AgentRunSpec<Out>> & { sink?: { role: string; content: string }[] },
): AgentRunSpec<Out> {
  const { sink, ...rest } = overrides;
  return {
    kind: 'PRICING',
    systemPrompt: '你是定价助手',
    userPrompt: '第一问：电磁炉',
    schema: Schema,
    maxTokens: 1200,
    temperature: 0.3,
    tools: [],
    executeTool: async () => 'data',
    prefetchEnabled: false,
    fallback: () => ({ mode: 'FREE', reason: '规则' }),
    cachePayload: { nonce: Math.random() },
    model: recordingModel(sink ?? []),
    // 缓存必须 miss，否则第二次直接命中缓存、根本不会调模型，测不到记忆。
    cache: { get: async () => null, put: async () => undefined },
    ...rest,
  };
}
describe('会话记忆（真 PostgresSaver）', () => {
  let threadSuffix = '';
  beforeAll(async () => {
    // 表可能尚未建立：脚本幂等，直接补一次。
    await setupCheckpointer();
    // 每次跑用唯一 thread 后缀，避免历史 checkpoint 干扰断言。
    threadSuffix = String(Date.now());
  });
  afterAll(async () => {
    await closeCheckpointer();
    await prisma.$disconnect();
    await closePool();
  });
  it('checkpointer 可构造（说明连接串去掉了 Prisma 的 schema 参数）', () => {
    expect(getCheckpointer()).not.toBeNull();
  });
  it('同一 thread 的第二次调用能恢复第一次的对话', async () => {
    const checkpointer = getCheckpointer();
    expect(checkpointer).not.toBeNull();
    const threadId = pricingThreadKey('it-mem-u1', `it-mem-c1-${threadSuffix}`);
    const first: { role: string; content: string }[] = [];
    const r1 = await runAgentGraph(
      spec({ checkpointer: checkpointer ?? undefined, threadId, sink: first }),
    );
    expect(r1.meta.source).toBe('llm');
    expect(first.map((m) => m.content)).toContain('第一问：电磁炉');
    const second: { role: string; content: string }[] = [];
    await runAgentGraph(
      spec({
        checkpointer: checkpointer ?? undefined,
        threadId,
        userPrompt: '第二问：婴儿车',
        sink: second,
      }),
    );
    const contents = second.map((m) => m.content);
    expect(contents).toContain('第二问：婴儿车');
    // 记忆生效的硬证据：第一次的问题出现在第二次的上下文里
    expect(contents).toContain('第一问：电磁炉');
    // system prompt 不累积
    expect(second.filter((m) => m.role === 'system')).toHaveLength(1);
  });
  it('不同 thread 的记忆互不可见', async () => {
    const checkpointer = getCheckpointer();
    expect(checkpointer).not.toBeNull();
    await runAgentGraph(
      spec({
        checkpointer: checkpointer ?? undefined,
        threadId: pricingThreadKey('it-mem-uA', `it-mem-c-${threadSuffix}`),
        userPrompt: 'A 的私密锚点',
      }),
    );
    const seen: { role: string; content: string }[] = [];
    await runAgentGraph(
      spec({
        checkpointer: checkpointer ?? undefined,
        threadId: pricingThreadKey('it-mem-uB', `it-mem-c-${threadSuffix}`),
        userPrompt: 'B 的问题',
        sink: seen,
      }),
    );
    expect(seen.map((m) => m.content)).not.toContain('A 的私密锚点');
  });
  it('checkpoint 表里确实落了行（不是只在内存里）', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM "checkpoints"`,
    );
    expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(0);
  });
  it('只给 checkpointer 不给 threadId ⇒ 显式失败，不静默忽略（契约：两者必须同时给）', async () => {
    // 若这里静默降级成「无记忆」，调用方会以为自己接上了记忆却毫无察觉——
    // 与 §6.4 纪律 1 的意图相反，所以 LangGraph 的这条硬报错是我们依赖的行为。
    const checkpointer = getCheckpointer();
    await expect(runAgentGraph(spec({ checkpointer: checkpointer ?? undefined }))).rejects.toThrow(
      /thread_id/,
    );
  });
});
