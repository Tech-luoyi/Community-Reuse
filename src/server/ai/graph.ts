/**
 * LangGraph agent 图运行时（`src/server/ai/graph.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.6（状态图 / channel / 预算 / 降级层级）。
 *
 * **职责边界**：本模块只做**编排**——状态、条件边、预算、可观测、降级收敛。
 * 模型调用仍走 `gateway.ts` 的 `callModelTurn`（那套 abort / 退避 / 重试语义已有单测覆盖，
 * 换 `ChatOpenAI` 等于把验证过的代码扔掉重写）；取数走 `tools.ts`；缓存走 `cache.ts`。
 * 三者都以**可注入端口**形式进入，因此本文件的全部控制流可以离线单测。
 *
 * **三条不变量**：
 *   1. **R1 不退化**：任何失败路径都收敛到 `fallback()`，HTTP 层恒 200 + `degraded:true`。
 *   2. **终止性可证**：`toolRounds ≤ MAX_TOOL_ROUNDS`、`repairAttempt ≤ 1`、`prefetchUsed ≤ 1`
 *      三个单调计数器 + 每步查 `budget` ⇒ 图不可能无限循环。
 *   3. **租户只来自会话**：`communityId` 由调用方从 session 传入，工具入参里的同名字段被剥除。
 */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';

import type { AiKind, AiMeta } from '@/shared/types';

import {
  type Budget,
  MAX_REPAIR_ROUNDS,
  MAX_TOOL_ROUNDS,
  canEnterRepair,
  newBudget,
  roundTimeoutMs,
} from './budget';
import type { ChatMessage, ModelTurn, ToolSpec } from './gateway';
import { callModelTurn } from './gateway';

/** 模型端口：默认实现委托 `gateway.callModelTurn`；单测注入脚本化的假模型。 */
export interface ModelPort {
  turn(options: {
    messages: ChatMessage[];
    tools: ToolSpec[];
    jsonMode: boolean;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
  }): Promise<ModelTurn>;
}

/** 缓存端口：命中返回 `{output, usedTools, toolCalls}`。 */
export interface CachePort {
  get(
    kind: AiKind,
    payload: unknown,
  ): Promise<{ output: unknown; usedTools: boolean; toolCalls: number } | null>;
  put(
    kind: AiKind,
    payload: unknown,
    value: { output: unknown; usedTools: boolean; toolCalls: number },
  ): Promise<void>;
}

/** 解析所需的最小结构化契约（模型输出 schema 含归一化 transform，故不直接用 Zod 三参泛型）。 */
export interface ParseSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/**
 * 工具执行端口：返回**已按 §6.5.6 第 5 条渲染好**的 prompt 片段。抛错即视为不可用。
 *
 * `rawArgs` 是模型给出的**原始 JSON 文本**（预取路径传 `'{}'`），本模块不替执行器解析：
 * 解析 + `Zod.strict()` 剥除幻觉字段都在服务层执行器里做——那是不可信输入的唯一边界。
 * 早先这里传的是 `parseToolArgs()` 的对象、执行器却按字符串 `JSON.parse`，
 * 于是每次工具调用都在执行器里抛「不是合法 JSON」被 F4 摘除：类型写成 `unknown`
 * 正好看不到这类错位，所以这里的参数类型钉成 `string`。
 */
export type ToolExecutor = (name: string, rawArgs: string) => Promise<string>;

/** 一次图执行的输入。 */
export interface AgentRunSpec<T> {
  kind: AiKind;
  systemPrompt: string;
  userPrompt: string;
  schema: ParseSchema<T>;
  maxTokens: number;
  temperature: number;
  /** 可用工具集（已按租户纪律构造，schema 内不含 communityId）。 */
  tools: ToolSpec[];
  executeTool: ToolExecutor;
  /** 是否启用「模型不调工具时服务端预取」保险模式（§6.5.8）。 */
  prefetchEnabled: boolean;
  fallback: () => T;
  cachePayload: unknown;
  model: ModelPort;
  cache: CachePort;
  /**
   * 多轮记忆（§6.4 第 ③ 项）。两者**必须同时给**：只有 checkpointer 没有 threadId 时
   * LangGraph 会拒绝执行，所以这里不做「只传一个」的容错——静默忽略会让人以为记忆生效了。
   */
  checkpointer?: BaseCheckpointSaver;
  threadId?: string;
  now?: () => number;
  onEvent?: (event: GraphEvent) => void;
}

/** 可观测事件：每次状态迁移一条（§6.6.3）。响应体不承载它，仅日志 / SSE 用。 */
export interface GraphEvent {
  state: string;
  attempt: number;
  latencyMs: number;
  toolName?: string;
  toolMode?: 'model' | 'prefetch' | 'none';
  ok?: boolean;
  reason?: string;
}

const State = Annotation.Root({
  messages: Annotation<ChatMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  toolRounds: Annotation<number>({ reducer: (_p, n) => n, default: () => 0 }),
  toolCalls: Annotation<number>({ reducer: (_p, n) => n, default: () => 0 }),
  usedTools: Annotation<boolean>({ reducer: (p, n) => p || n, default: () => false }),
  availableTools: Annotation<ToolSpec[]>({ reducer: (_p, n) => n, default: () => [] }),
  repairAttempt: Annotation<number>({ reducer: (_p, n) => n, default: () => 0 }),
  /** 显式「不再修补」标志：取代魔法哨兵，让 REPAIR 的出口可被单测直接断言。 */
  repairBlocked: Annotation<boolean>({ reducer: (_p, n) => n, default: () => false }),
  prefetchUsed: Annotation<number>({ reducer: (_p, n) => n, default: () => 0 }),
  budget: Annotation<Budget>({ reducer: (_p, n) => n, default: () => newBudget(0) }),
  lastTurn: Annotation<ModelTurn | null>({ reducer: (_p, n) => n, default: () => null }),
  output: Annotation<unknown>({ reducer: (_p, n) => n, default: () => null }),
  meta: Annotation<AiMeta | null>({ reducer: (_p, n) => n, default: () => null }),
  cacheHit: Annotation<boolean>({ reducer: (_p, n) => n, default: () => false }),
});

type GraphState = typeof State.State;

function step(now: () => number, startedAt: number): number {
  return now() - startedAt;
}

/** `JSON.parse` + schema 校验；任一步失败返回 `null`（交由路由决定 REPAIR / 降级）。 */
function parseWith<T>(content: string, schema: ParseSchema<T>): T | null {
  let json: unknown;
  try {
    json = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}

/** 模型给出的 `arguments` 是不可信 JSON 文本：解析失败即按 §6.5.8 触发条件 2 处理。 */
function parseToolArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw === '' ? '{}' : raw) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * 构建并执行 agent 图。
 *
 * @returns 模型输出 + 终态元信息；**永不抛异常**（R1）。
 */
export async function runAgentGraph<T>(
  spec: AgentRunSpec<T>,
): Promise<{ output: T; meta: AiMeta }> {
  const now = spec.now ?? Date.now;
  const startedAt = now();
  const emit = spec.onEvent ?? (() => undefined);

  /** 图内共享的可变侧信道（不属于状态收敛，仅用于最终返回与事件计时）。 */
  let attempts = 0;

  const cacheLookup = async (): Promise<Partial<GraphState>> => {
    const t0 = now();
    const hit = await spec.cache.get(spec.kind, spec.cachePayload);
    // miss 不是失败——把 ok 设成 false 会让观测摘要把一次正常回源标成故障。
    emit({ state: 'CACHE_LOOKUP', attempt: 0, latencyMs: step(now, t0), ok: true });
    if (hit === null) {
      return { cacheHit: false };
    }
    return {
      cacheHit: true,
      output: hit.output,
      meta: {
        degraded: false,
        source: 'cache',
        usedTools: hit.usedTools,
        toolCalls: hit.toolCalls,
      },
    };
  };

  const buildPrompt = async (s: GraphState): Promise<Partial<GraphState>> => {
    emit({ state: 'BUILD_PROMPT', attempt: attempts, latencyMs: 0 });
    // 有记忆时 system prompt **不重复追加**：messages 通道已被 checkpointer 恢复，
    // 再塞一份会让模型看到 N 份相同指令，既费 token 又稀释注意力。
    const hasSystem = s.messages.some((m) => m.role === 'system');
    return {
      messages: [
        ...(hasSystem ? [] : [{ role: 'system' as const, content: spec.systemPrompt }]),
        { role: 'user' as const, content: spec.userPrompt },
      ],
      availableTools: spec.tools,
      budget: newBudget(now()),
    };
  };

  const agentCall = async (s: GraphState): Promise<Partial<GraphState>> => {
    attempts += 1;
    const t0 = now();
    // 剩余步数 = 本轮 + 工具后可能的一轮；用于把剩余额度摊薄（§6.6.4）。
    const timeoutMs = roundTimeoutMs(s.budget, s.toolRounds >= MAX_TOOL_ROUNDS ? 1 : 2, now());
    if (timeoutMs <= 0) {
      emit({ state: 'CALL_MODEL', attempt: attempts, latencyMs: 0, reason: 'deadline' });
      return { lastTurn: { ok: false, reason: 'timeout' } };
    }
    const turn = await spec.model.turn({
      messages: s.messages,
      tools: s.availableTools,
      jsonMode: s.availableTools.length === 0,
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
      timeoutMs,
    });
    emit({
      state: 'CALL_MODEL',
      attempt: attempts,
      latencyMs: step(now, t0),
      ok: turn.ok,
      ...(!turn.ok ? { reason: turn.detail ? `${turn.reason}: ${turn.detail}` : turn.reason } : {}),
    });
    return { lastTurn: turn };
  };

  /** 依据本轮形态决定去留（§6.6.1 的六条出边）。 */
  const routeAfterCall = (s: GraphState): string => {
    const turn = s.lastTurn;
    if (turn === null) {
      return 'fallback';
    }
    if (!turn.ok) {
      return 'fallback';
    }
    if (turn.kind === 'tool_calls') {
      const runnable = turn.calls.filter((c) => s.availableTools.some((t) => t.name === c.name));
      // F6：无工具可给 / 轮次超限 ⇒ 去 REPAIR，而不是继续执行。
      if (runnable.length === 0 || s.toolRounds >= MAX_TOOL_ROUNDS) {
        return 'repair';
      }
      return 'toolExec';
    }
    // content：首次未调工具且开了预取 ⇒ 保险模式（§6.5.8）
    if (
      s.prefetchUsed === 0 &&
      spec.prefetchEnabled &&
      s.toolRounds === 0 &&
      s.repairAttempt === 0
    ) {
      return 'prefetch';
    }
    return 'parse';
  };

  const toolExec = async (s: GraphState): Promise<Partial<GraphState>> => {
    const turn = s.lastTurn;
    if (turn === null || !turn.ok || turn.kind !== 'tool_calls') {
      return {};
    }
    const t0 = now();
    const results: { id: string; name: string; rendered: string }[] = [];
    const executedNames = new Set<string>();
    const failedNames = new Set<string>();

    // 一轮里可能有多个 tool_calls（同时下发了成交统计 + 语义检索两个工具）。
    // 逐个执行、**逐个记账**：某个工具挂掉只摘除它自己，已经拿到手的结果必须留下。
    for (const call of turn.calls) {
      if (!s.availableTools.some((t) => t.name === call.name)) {
        continue;
      }
      // 同一轮内同名工具只跑一次：结果按「已执行摘除、未执行保留」处理。
      if (executedNames.has(call.name) || failedNames.has(call.name)) {
        continue;
      }
      const args = parseToolArgs(call.args);
      if (args === null) {
        // 参数不是合法 JSON ⇒ 不执行，交给 prefetch 兜底。
        continue;
      }
      try {
        const rendered = await spec.executeTool(call.name, call.args);
        results.push({ id: call.id, name: call.name, rendered });
        executedNames.add(call.name);
      } catch (error) {
        // F4：工具挂了**不弃 LLM**——摘除该工具，本轮**其余结果照常送回模型**。
        // 注意这里是「记账后继续」，不是提前 return：早退会把本轮已成功的工具结果
        // 一起丢掉，表现为 usedTools:false 的「干净运行」，实际是定价根本没吃到社区数据。
        failedNames.add(call.name);
        emit({
          state: 'TOOL_EXEC',
          attempt: attempts,
          latencyMs: step(now, t0),
          toolName: call.name,
          ok: false,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    if (results.length === 0 && failedNames.size === 0) {
      // 全部因「未注册 / 参数非法」被跳过：没有可回报模型的进展，只推进轮次计数。
      return { toolRounds: s.toolRounds + 1 };
    }

    emit({
      state: 'TOOL_EXEC',
      attempt: attempts,
      latencyMs: step(now, t0),
      ...(results.length > 0 ? { toolMode: 'model' as const } : {}),
      ok: failedNames.size === 0,
    });

    // **已执行过与已失败的工具都从可用集里摘掉**：前者是幂等的（同参数同结果），
    // 再让模型调一次只会白烧一轮（实测单轮 15s+）；后者留着必然再失败一次。
    const removed = new Set([...executedNames, ...failedNames]);
    return {
      toolRounds: s.toolRounds + 1,
      toolCalls: s.toolCalls + results.length,
      usedTools: results.length > 0,
      availableTools: s.availableTools.filter((t) => !removed.has(t.name)),
      ...(results.length === 0
        ? {}
        : { messages: results.map((r) => ({ role: 'user' as const, content: r.rendered })) }),
    };
  };

  const prefetch = async (s: GraphState): Promise<Partial<GraphState>> => {
    const t0 = now();
    const only = spec.tools.find((tool) => tool.name === 'getCommunitySettlementStats');
    if (only === undefined) {
      return { prefetchUsed: 1 };
    }
    try {
      const rendered = await spec.executeTool(only.name, '{}');
      emit({
        state: 'PREFETCH',
        attempt: attempts,
        latencyMs: step(now, t0),
        toolName: only.name,
        toolMode: 'prefetch',
        ok: true,
      });
      return {
        prefetchUsed: s.prefetchUsed + 1,
        toolCalls: s.toolCalls + 1,
        usedTools: true,
        // 注入行情后要求模型直接给 JSON，不再给工具（避免二次绕圈）。
        availableTools: [],
        messages: [
          { role: 'user', content: rendered },
          {
            role: 'user',
            content: '请结合上方「本小区成交行情参考」重新作答，只输出规定的 JSON。',
          },
        ],
      };
    } catch (error) {
      emit({
        state: 'PREFETCH',
        attempt: attempts,
        latencyMs: step(now, t0),
        toolMode: 'prefetch',
        ok: false,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      // 预取失败 ⇒ 直接用模型已给的答案，不因此降级。
      return { prefetchUsed: s.prefetchUsed + 1 };
    }
  };

  const routeAfterPrefetch = (s: GraphState): string =>
    s.availableTools.length === 0 && s.usedTools ? 'parse' : 'agentCall';

  const parse = async (s: GraphState): Promise<Partial<GraphState>> => {
    const turn = s.lastTurn;
    if (turn === null || !turn.ok || turn.kind !== 'content') {
      return {};
    }
    const parsed = parseWith(turn.content, spec.schema);
    return { output: parsed, cacheHit: false };
  };

  const routeAfterParse = (s: GraphState): string => (s.output === null ? 'repair' : 'persist');

  const repair = async (s: GraphState): Promise<Partial<GraphState>> => {
    const next = s.repairAttempt + 1;
    const mayRun = next <= MAX_REPAIR_ROUNDS && canEnterRepair(s.budget, now());
    emit({ state: 'REPAIR', attempt: attempts, latencyMs: 0, ok: mayRun });
    if (!mayRun) {
      // 超出修补次数、或剩余时间不足以跑完一轮 ⇒ 直接收敛到规则，
      // 避免「进修补轮却被 deadline 从中间截断」这种不可归因的失败。
      return { repairAttempt: next, repairBlocked: true };
    }
    const turn = s.lastTurn;
    const bad = turn !== null && turn.ok && turn.kind === 'content' ? turn.content : '';
    return {
      repairAttempt: next,
      repairBlocked: false,
      availableTools: [],
      messages: [
        ...(bad === '' ? [] : [{ role: 'assistant' as const, content: bad }]),
        {
          role: 'user',
          content:
            '上一条输出不符合要求。请**只**输出一个合法 JSON 对象，不要任何解释、不要代码块围栏。',
        },
      ],
    };
  };

  const routeAfterRepair = (s: GraphState): string => (s.repairBlocked ? 'fallback' : 'agentCall');

  const fallback = async (): Promise<Partial<GraphState>> => {
    emit({ state: 'FALLBACK', attempt: attempts, latencyMs: 0, ok: true });
    return {
      output: spec.fallback(),
      meta: { degraded: true, source: 'rule', usedTools: false, toolCalls: 0 },
    };
  };

  const persist = async (s: GraphState): Promise<Partial<GraphState>> => {
    const meta: AiMeta = s.meta ?? {
      degraded: false,
      source: 'llm',
      usedTools: s.usedTools,
      toolCalls: s.toolCalls,
    };
    // 仅 source='llm' 写缓存；cache 命中不重复写。
    if (meta.source === 'llm' && s.output !== null) {
      await spec.cache.put(spec.kind, spec.cachePayload, {
        output: s.output,
        usedTools: meta.usedTools,
        toolCalls: meta.toolCalls,
      });
    }
    emit({ state: 'DONE', attempt: attempts, latencyMs: step(now, startedAt), ok: true });
    return { meta };
  };

  const routeAfterBuild = (s: GraphState): string => (s.cacheHit ? 'persist' : 'agentCall');

  const workflow = new StateGraph(State)
    .addNode('cacheLookup', cacheLookup)
    .addNode('buildPrompt', buildPrompt)
    .addNode('agentCall', agentCall)
    .addNode('toolExec', toolExec)
    .addNode('prefetch', prefetch)
    .addNode('parse', parse)
    .addNode('repair', repair)
    .addNode('fallback', fallback)
    .addNode('persist', persist)
    .addEdge(START, 'cacheLookup')
    .addEdge('cacheLookup', 'buildPrompt')
    .addConditionalEdges('buildPrompt', routeAfterBuild, {
      agentCall: 'agentCall',
      persist: 'persist',
    })
    .addConditionalEdges('agentCall', routeAfterCall, {
      toolExec: 'toolExec',
      prefetch: 'prefetch',
      repair: 'repair',
      parse: 'parse',
      fallback: 'fallback',
    })
    .addEdge('toolExec', 'agentCall')
    .addConditionalEdges('prefetch', routeAfterPrefetch, {
      agentCall: 'agentCall',
      parse: 'parse',
    })
    .addConditionalEdges('parse', routeAfterParse, { repair: 'repair', persist: 'persist' })
    .addConditionalEdges('repair', routeAfterRepair, {
      agentCall: 'agentCall',
      fallback: 'fallback',
    })
    .addEdge('fallback', 'persist')
    .addEdge('persist', END)
    .compile(spec.checkpointer ? { checkpointer: spec.checkpointer } : {});

  const final = (await workflow.invoke(
    {
      budget: newBudget(now()),
      availableTools: spec.tools,
    } as unknown as Partial<GraphState>,
    {
      recursionLimit: 24,
      ...(spec.threadId ? { configurable: { thread_id: spec.threadId } } : {}),
    },
  )) as unknown as GraphState;

  const meta = final.meta ?? {
    degraded: true,
    source: 'rule',
    usedTools: false,
    toolCalls: 0,
  };
  const output = (final.output ?? spec.fallback()) as T;
  return { output, meta };
}

/** 生产环境的模型端口：委托 gateway（保留既有 abort / 重试语义与单测）。 */
export const gatewayModelPort: ModelPort = {
  turn: (options) =>
    callModelTurn({
      messages: options.messages,
      tools: options.tools,
      jsonMode: options.jsonMode,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
    }),
};
