/**
 * agent 图运行时的控制流单测（**离线：脚本化假模型 + 假缓存，零网络零 DB**）。
 *
 * 覆盖 docs/tech-design-final.md §6.6 的全部转移分支与三条不变量：
 *   - 缓存短路 ⇒ 0 次模型调用、`source:'cache'`。
 *   - 工具链：模型请求工具 → 执行 → 回模型 → 合法 JSON ⇒ `usedTools:true`、`toolCalls` 计数。
 *   - **F4**：工具抛错 ⇒ **摘除该工具继续用模型**，仍 `source:'llm'`、`degraded:false`（不退化为规则）。
 *   - **F6**：轮次超限仍请求工具 ⇒ 进 REPAIR，**不再执行工具**。
 *   - REPAIR **恰好 1 次**；仍非法 ⇒ 规则降级。
 *   - **R1**：无 Key / 超时 / 网络 / 4xx ⇒ 恒返回结果、**永不抛异常**、`degraded:true`。
 *   - §6.5.8 预取保险：模型首次直答未调工具 ⇒ 服务端预取注入，`toolCalls:1`、`usedTools:true`。
 *   - deadline 耗尽 ⇒ 不再调模型，直接规则收敛。
 *   - **终止性**：模型「一直要工具」「一直给非法 JSON」「一直超时」均有界收敛。
 */
import { describe, expect, it, vi } from 'vitest';

import { z } from 'zod';

import { type AgentRunSpec, type ModelPort, runAgentGraph } from '@/server/ai/graph';
import type { ModelTurn, ToolSpec } from '@/server/ai/gateway';
import type { AiKind } from '@/shared/types';

const Schema = z.object({
  mode: z.enum(['FREE', 'PRICED']),
  reason: z.string(),
});

const TOOL: ToolSpec = {
  name: 'getCommunitySettlementStats',
  description: '查本小区成交行情',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

function content(text: string): ModelTurn {
  return { ok: true, kind: 'content', content: text };
}

function toolCalls(names: string[] = ['getCommunitySettlementStats']): ModelTurn {
  return {
    ok: true,
    kind: 'tool_calls',
    calls: names.map((name, i) => ({ id: `t${i}`, name, args: '{}' })),
  };
}

function failure(
  reason: 'no_key' | 'timeout' | 'network' | 'http_4xx' | 'http_5xx' | 'empty',
): ModelTurn {
  return { ok: false, reason };
}

/** 脚本化假模型：按队列依次返回，队列耗尽则重复最后一个。 */
function scripted(
  first: ModelTurn,
  ...rest: ModelTurn[]
): { port: ModelPort; calls: () => number } {
  const turns: ModelTurn[] = [first, ...rest];
  let i = 0;
  const count = { n: 0 };
  return {
    port: {
      turn: async () => {
        count.n += 1;
        const t: ModelTurn = turns[i] ?? turns[turns.length - 1] ?? first;
        i += 1;
        return t;
      },
    },
    calls: () => count.n,
  };
}

function nullCache() {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
  };
}

function baseSpec(
  overrides: Partial<AgentRunSpec<{ mode: 'FREE' | 'PRICED'; reason: string }>> = {},
): AgentRunSpec<{ mode: 'FREE' | 'PRICED'; reason: string }> {
  return {
    kind: 'PRICING' as AiKind,
    systemPrompt: 'sys',
    userPrompt: 'usr',
    schema: Schema,
    maxTokens: 1200,
    temperature: 0.3,
    tools: [TOOL],
    executeTool: async () => '<<<DATA>>>\n统计：成交 3 件\n<<<DATA>>>',
    prefetchEnabled: false,
    fallback: () => ({ mode: 'FREE', reason: '规则降级' }),
    cachePayload: { name: 'x' },
    model: scripted(content('{"mode":"PRICED","reason":"ok"}')).port,
    cache: nullCache(),
    ...overrides,
  };
}

describe('ai.graph：缓存与直出路径', () => {
  it('缓存命中 ⇒ 0 次模型调用、source=cache、回填元信息', async () => {
    const model = scripted(content('{"mode":"PRICED","reason":"不该被调用"}'));
    const cache = {
      get: vi.fn(async () => ({
        output: { mode: 'PRICED', reason: 'cached' },
        usedTools: true,
        toolCalls: 2,
      })),
      put: vi.fn(async () => undefined),
    };
    const r = await runAgentGraph(baseSpec({ model: model.port, cache }));
    expect(model.calls()).toBe(0);
    expect(r).toEqual({
      output: { mode: 'PRICED', reason: 'cached' },
      meta: { degraded: false, source: 'cache', usedTools: true, toolCalls: 2 },
    });
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('无工具直出合法 JSON ⇒ source=llm，且写缓存', async () => {
    const cache = nullCache();
    const r = await runAgentGraph(
      baseSpec({
        tools: [],
        cache,
        model: scripted(content('{"mode":"FREE","reason":"免费送"}')).port,
      }),
    );
    expect(r.meta).toEqual({ degraded: false, source: 'llm', usedTools: false, toolCalls: 0 });
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('规则降级**不写缓存**（避免把降级结果固化）', async () => {
    const cache = nullCache();
    await runAgentGraph(baseSpec({ cache, model: scripted(failure('no_key')).port }));
    expect(cache.put).not.toHaveBeenCalled();
  });
});

describe('ai.graph：工具链', () => {
  it('模型请求工具 → 执行 → 回模型 → 合法 JSON ⇒ usedTools=true、toolCalls=1', async () => {
    const model = scripted(toolCalls(), content('{"mode":"PRICED","reason":"按行情"}'));
    const executeTool = vi.fn(async () => '<<<DATA>>>\n成交 5 件\n<<<DATA>>>');
    const r = await runAgentGraph(baseSpec({ model: model.port, executeTool }));
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(r.meta).toEqual({ degraded: false, source: 'llm', usedTools: true, toolCalls: 1 });
    expect(model.calls()).toBe(2);
  });

  it('F4：工具抛错 ⇒ 摘除该工具继续用模型，**不**退化为规则', async () => {
    const model = scripted(toolCalls(), content('{"mode":"PRICED","reason":"凭自身知识"}'));
    const r = await runAgentGraph(
      baseSpec({
        model: model.port,
        executeTool: async () => {
          throw new Error('db down');
        },
      }),
    );
    expect(r.meta).toEqual({ degraded: false, source: 'llm', usedTools: false, toolCalls: 0 });
    expect(r.output.reason).toBe('凭自身知识');
  });

  it('模型反复要工具、始终不给合法 JSON ⇒ 工具只执行一次，最终规则降级（R1）', async () => {
    const executeTool = vi.fn(async () => 'data');
    // 队列耗尽后重复最后一个 ⇒ 模型「永远在要工具」
    const model = scripted(toolCalls(), toolCalls(), toolCalls());
    const r = await runAgentGraph(baseSpec({ model: model.port, executeTool }));
    // 第一次执行后该工具已从可用集摘除 ⇒ 后续再要也不执行（不白烧查询）
    expect(executeTool).toHaveBeenCalledTimes(1);
    // 修补轮只允许 1 次，仍拿不到合法 JSON ⇒ 收敛到规则，且**有界**
    expect(model.calls()).toBeLessThanOrEqual(4);
    expect(r.meta).toEqual({ degraded: true, source: 'rule', usedTools: false, toolCalls: 0 });
    expect(r.output).toEqual({ mode: 'FREE', reason: '规则降级' });
  });

  it('F6：轮次达到 MAX_TOOL_ROUNDS 后，即使工具仍可用也不再执行', async () => {
    const a: ToolSpec = { ...TOOL, name: 'toolA' };
    const b: ToolSpec = { ...TOOL, name: 'toolB' };
    const c: ToolSpec = { ...TOOL, name: 'toolC' };
    const executed: string[] = [];
    const model = scripted(
      toolCalls(['toolA']),
      toolCalls(['toolB']),
      toolCalls(['toolC']),
      content('{"mode":"PRICED","reason":"r"}'),
    );
    const r = await runAgentGraph(
      baseSpec({
        tools: [a, b, c],
        model: model.port,
        executeTool: async (name) => {
          executed.push(name);
          return 'data';
        },
      }),
    );
    // MAX_TOOL_ROUNDS = 2 ⇒ toolC 的请求被轮次上限挡下，转 REPAIR
    expect(executed).toEqual(['toolA', 'toolB']);
    expect(r.meta.toolCalls).toBe(2);
    expect(r.meta.degraded).toBe(false);
  });

  it('未知工具名（模型幻觉）⇒ 不执行，转 REPAIR', async () => {
    const executeTool = vi.fn(async () => 'data');
    const model = scripted(
      toolCalls(['nonexistent_tool']),
      content('{"mode":"FREE","reason":"r"}'),
    );
    const r = await runAgentGraph(baseSpec({ model: model.port, executeTool }));
    expect(executeTool).not.toHaveBeenCalled();
    expect(r.meta.degraded).toBe(false);
  });

  it('已执行的工具会从可用集摘除，不重复执行（幂等工具不白烧轮次）', async () => {
    const executeTool = vi.fn(async () => '<<<DATA>>>\n成交 3 件\n<<<DATA>>>');
    // 模型第一轮要工具、第二轮又要一次、第三轮才给答案
    const model = scripted(toolCalls(), toolCalls(), content('{"mode":"PRICED","reason":"够了"}'));
    const r = await runAgentGraph(baseSpec({ model: model.port, executeTool }));
    // 第二次要工具时该工具已不在 availableTools ⇒ 走 F6 的 REPAIR 分支，不会执行第二次
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(r.meta.toolCalls).toBe(1);
    expect(r.meta.usedTools).toBe(true);
  });

  it('多工具时只摘除已执行的那个，未执行的仍可用（为 P1 检索工具预留）', async () => {
    const other: ToolSpec = {
      name: 'search_similar_items',
      description: '语义检索同类物品',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    };
    const executed: string[] = [];
    const model = scripted(
      toolCalls(['getCommunitySettlementStats']),
      toolCalls(['search_similar_items']),
      content('{"mode":"PRICED","reason":"两次取证"}'),
    );
    const r = await runAgentGraph(
      baseSpec({
        tools: [TOOL, other],
        model: model.port,
        executeTool: async (name) => {
          executed.push(name);
          return `<<<DATA>>>${name}<<<DATA>>>`;
        },
      }),
    );
    expect(executed).toEqual(['getCommunitySettlementStats', 'search_similar_items']);
    expect(r.meta.toolCalls).toBe(2);
    expect(r.meta.usedTools).toBe(true);
  });
});

describe('ai.graph：REPAIR 与 R1', () => {
  it('非法 JSON ⇒ REPAIR 恰好 1 次；修补轮合法则 source=llm', async () => {
    const model = scripted(content('这不是 JSON'), content('{"mode":"PRICED","reason":"修好了"}'));
    const r = await runAgentGraph(baseSpec({ tools: [], model: model.port }));
    expect(model.calls()).toBe(2);
    expect(r.meta.source).toBe('llm');
    expect(r.output.reason).toBe('修好了');
  });

  it('修补轮仍非法 ⇒ 规则降级（degraded=true, source=rule）', async () => {
    const model = scripted(content('垃圾'), content('还是垃圾'));
    const r = await runAgentGraph(baseSpec({ tools: [], model: model.port }));
    expect(model.calls()).toBe(2);
    expect(r.meta).toEqual({ degraded: true, source: 'rule', usedTools: false, toolCalls: 0 });
    expect(r.output).toEqual({ mode: 'FREE', reason: '规则降级' });
  });

  it.each([
    ['no_key', failure('no_key')],
    ['timeout', failure('timeout')],
    ['network', failure('network')],
    ['http_4xx', failure('http_4xx')],
    ['http_5xx', failure('http_5xx')],
    ['empty', failure('empty')],
  ])('R1：模型 %s ⇒ 恒返回规则结果且不抛异常', async (_label, turn) => {
    const model = scripted(turn);
    await expect(runAgentGraph(baseSpec({ model: model.port }))).resolves.toMatchObject({
      meta: { degraded: true, source: 'rule' },
    });
    expect(model.calls()).toBe(1);
  });

  it('schema 合法但枚举值非法 ⇒ 同样走 REPAIR 而非放行', async () => {
    const model = scripted(
      content('{"mode":"PAID","reason":"x"}'),
      content('{"mode":"PRICED","reason":"改对了"}'),
    );
    const r = await runAgentGraph(baseSpec({ tools: [], model: model.port }));
    expect(r.output.reason).toBe('改对了');
  });
});

describe('ai.graph：预取保险模式（§6.5.8）', () => {
  it('首次直答未调工具且开关开 ⇒ 服务端预取注入，usedTools=true、toolCalls=1', async () => {
    const executeTool = vi.fn(async () => '<<<DATA>>>\n成交 8 件\n<<<DATA>>>');
    const model = scripted(
      content('{"mode":"PRICED","reason":"初答"}'),
      content('{"mode":"PRICED","reason":"参考了行情"}'),
    );
    const r = await runAgentGraph(
      baseSpec({ prefetchEnabled: true, executeTool, model: model.port }),
    );
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(r.meta).toEqual({ degraded: false, source: 'llm', usedTools: true, toolCalls: 1 });
  });

  it('预取失败 ⇒ 直接用模型已给的答案，不降级', async () => {
    const model = scripted(content('{"mode":"FREE","reason":"初答即可"}'));
    const r = await runAgentGraph(
      baseSpec({
        prefetchEnabled: true,
        executeTool: async () => {
          throw new Error('embed down');
        },
        model: model.port,
      }),
    );
    expect(r.meta.degraded).toBe(false);
    expect(r.output.reason).toBe('初答即可');
  });

  it('开关关 ⇒ 不预取，尊重模型直答', async () => {
    const executeTool = vi.fn(async () => 'data');
    const r = await runAgentGraph(
      baseSpec({
        prefetchEnabled: false,
        executeTool,
        model: scripted(content('{"mode":"FREE","reason":"直答"}')).port,
      }),
    );
    expect(executeTool).not.toHaveBeenCalled();
    expect(r.meta.usedTools).toBe(false);
  });
});

describe('ai.graph：预算与终止性', () => {
  /** 每次读取都推进一大段的假时钟 ⇒ 第 2 步起 deadline 必然耗尽。 */
  function fastClock(): () => number {
    let t = 1_000_000;
    return () => {
      t += 100_000_000;
      return t;
    };
  }

  it('deadline 耗尽 ⇒ 不再调模型，直接规则收敛', async () => {
    const model = scripted(content('{"mode":"PRICED","reason":"不该被调用"}'));
    const r = await runAgentGraph(baseSpec({ model: model.port, now: fastClock() }));
    expect(model.calls()).toBe(0);
    expect(r.meta).toEqual({ degraded: true, source: 'rule', usedTools: false, toolCalls: 0 });
  });

  it('终止性：模型「一直要工具」也会收敛（不爆递归）', async () => {
    const model = scripted(toolCalls());
    const r = await runAgentGraph(baseSpec({ model: model.port, executeTool: async () => 'data' }));
    expect(model.calls()).toBeLessThanOrEqual(6);
    expect(['llm', 'rule']).toContain(r.meta.source);
  });

  it('终止性：模型「一直给非法 JSON」也会收敛', async () => {
    const model = scripted(content('垃圾'));
    const r = await runAgentGraph(baseSpec({ tools: [], model: model.port }));
    expect(model.calls()).toBeLessThanOrEqual(3);
    expect(r.meta.degraded).toBe(true);
  });

  it('终止性：模型「一直超时」也会收敛', async () => {
    const model = scripted(failure('timeout'));
    const r = await runAgentGraph(baseSpec({ model: model.port }));
    expect(model.calls()).toBeLessThanOrEqual(3);
    expect(r.meta.degraded).toBe(true);
  });

  it('每次状态迁移都发出可观测事件', async () => {
    const events: string[] = [];
    await runAgentGraph(
      baseSpec({
        model: scripted(toolCalls(), content('{"mode":"FREE","reason":"r"}')).port,
        onEvent: (e) => events.push(e.state),
      }),
    );
    expect(events).toEqual(
      expect.arrayContaining(['CACHE_LOOKUP', 'BUILD_PROMPT', 'CALL_MODEL', 'TOOL_EXEC', 'DONE']),
    );
  });
});
