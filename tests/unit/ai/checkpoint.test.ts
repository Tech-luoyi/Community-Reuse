/**
 * 多轮会话记忆单测（**离线**：LangGraph 的 `MemorySaver` 假 checkpointer，零 DB）。
 *
 * 守两件事：
 *   1. **thread key 的双维度**——只按 userId 分会让同一用户在 A 社区的定价锚点被带进
 *      B 社区的对话；只按 communityId 分会让同社区不同用户互读对话。两者都必须隔离。
 *   2. **有记忆时 system prompt 不重复追加**——否则第 N 轮会看到 N 份相同指令，
 *      既费 token 又稀释注意力。
 */
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';

import { z } from 'zod';

import { checkpointConnectionString, pricingThreadKey } from '@/server/ai/checkpoint';
import { type AgentRunSpec, runAgentGraph } from '@/server/ai/graph';
import type { ModelTurn } from '@/server/ai/gateway';
import type { AiKind } from '@/shared/types';

const Schema = z.object({ mode: z.enum(['FREE', 'PRICED']), reason: z.string() });

function content(text: string): ModelTurn {
  return { ok: true, kind: 'content', content: text };
}

function spec(
  overrides: Partial<AgentRunSpec<{ mode: 'FREE' | 'PRICED'; reason: string }>> & {
    seen?: (messages: { role: string; content: string }[]) => void;
  } = {},
): AgentRunSpec<{ mode: 'FREE' | 'PRICED'; reason: string }> {
  const { seen, ...rest } = overrides;
  return {
    kind: 'PRICING' as AiKind,
    systemPrompt: '你是定价助手',
    userPrompt: '第一轮：电磁炉怎么定价',
    schema: Schema,
    maxTokens: 1200,
    temperature: 0.3,
    tools: [],
    executeTool: async () => 'data',
    prefetchEnabled: false,
    fallback: () => ({ mode: 'FREE', reason: '规则' }),
    cachePayload: { k: Math.random() },
    model: {
      turn: async (options) => {
        seen?.(options.messages);
        return content('{"mode":"PRICED","reason":"ok"}');
      },
    },
    cache: { get: async () => null, put: async () => undefined },
    ...rest,
  };
}

describe('ai.checkpoint：thread key 的双维度隔离', () => {
  it('同一用户 + 同一社区 ⇒ 同一 thread（记忆才连得上）', () => {
    expect(pricingThreadKey('u1', 'c1')).toBe(pricingThreadKey('u1', 'c1'));
  });

  it('同社区不同用户 ⇒ 不同 thread（防止互读对话）', () => {
    expect(pricingThreadKey('u1', 'c1')).not.toBe(pricingThreadKey('u2', 'c1'));
  });

  it('同一用户跨社区 ⇒ 不同 thread（防止 A 社区定价锚点被当成 B 社区的现实）', () => {
    expect(pricingThreadKey('u1', 'cA')).not.toBe(pricingThreadKey('u1', 'cB'));
  });

  it('key 内含两个维度字面量，便于日志归因', () => {
    expect(pricingThreadKey('u1', 'c1')).toBe('pricing:c1:u1');
  });

  it('DATABASE_URL 缺 schema 查询参数时也能解析出连接串', () => {
    process.env.DATABASE_URL = 'postgresql://pg:pw@h:5432/db?schema=public';
    const dsn = checkpointConnectionString();
    expect(dsn).not.toContain('schema=public');
    expect(dsn).toContain('h:5432/db');
    delete process.env.DATABASE_URL;
  });

  it('DATABASE_URL 未配置 ⇒ 解析为 null（记忆自动关闭，不影响主流程）', () => {
    delete process.env.DATABASE_URL;
    expect(checkpointConnectionString()).toBeNull();
  });
});

describe('ai.graph：接 checkpointer 后的多轮行为', () => {
  it('第二次调用能看到第一次的对话轨迹', async () => {
    const checkpointer = new MemorySaver();
    const threadId = pricingThreadKey('u1', 'c1');
    const seenFirst: { role: string; content: string }[] = [];
    const seenSecond: { role: string; content: string }[] = [];

    await runAgentGraph(spec({ checkpointer, threadId, seen: (m) => seenFirst.push(...m) }));
    await runAgentGraph(
      spec({
        checkpointer,
        threadId,
        userPrompt: '第二轮：那婴儿车呢',
        seen: (m) => seenSecond.push(...m),
      }),
    );

    const firstContents = seenFirst.map((m) => m.content);
    const secondContents = seenSecond.map((m) => m.content);
    expect(firstContents).toContain('第一轮：电磁炉怎么定价');
    expect(secondContents).toContain('第一轮：电磁炉怎么定价');
    expect(secondContents).toContain('第二轮：那婴儿车呢');
  });

  it('system prompt 只出现一次，不随轮次累积', async () => {
    const checkpointer = new MemorySaver();
    const threadId = pricingThreadKey('u9', 'c9');
    const secondSeen: { role: string }[] = [];
    await runAgentGraph(spec({ checkpointer, threadId }));
    await runAgentGraph(
      spec({
        checkpointer,
        threadId,
        userPrompt: '再来一轮',
        seen: (m) => secondSeen.push(...m),
      }),
    );
    expect(secondSeen.filter((m) => m.role === 'system')).toHaveLength(1);
  });

  it('不同 thread 之间互不可见（记忆不串）', async () => {
    const checkpointer = new MemorySaver();
    await runAgentGraph(
      spec({ checkpointer, threadId: pricingThreadKey('uA', 'c1'), userPrompt: 'A 的私密问题' }),
    );
    const seenForB: string[] = [];
    await runAgentGraph(
      spec({
        checkpointer,
        threadId: pricingThreadKey('uB', 'c1'),
        userPrompt: 'B 的问题',
        seen: (m) => seenForB.push(...m.map((x) => x.content)),
      }),
    );
    expect(seenForB).not.toContain('A 的私密问题');
  });

  it('不传 checkpointer 时行为与单次调用完全一致（记忆关闭无回归）', async () => {
    const seen: string[] = [];
    const r = await runAgentGraph(spec({ seen: (m) => seen.push(...m.map((x) => x.content)) }));
    expect(r.meta.source).toBe('llm');
    expect(seen).toContain('你是定价助手');
  });
});
