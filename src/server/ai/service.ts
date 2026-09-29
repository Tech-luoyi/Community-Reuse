/**
 * LLM 能力编排（`src/server/ai/service.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.1（网关）、§6.2（prompt/schema）、§6.3（降级）、
 * §6.6.4（降级层级：`source` 与 `usedTools` 正交）；契约 docs/api-contract.md §8。
 *
 * 单条请求的**隐式流程**（T12 将把它显式化为有限状态机）：
 *   查缓存 →（未命中）调模型 → `JSON.parse` + Zod 校验 →
 *   （非法）`REPAIR` 重提示 **≤1 次** →（仍非法 / 无 Key / 超时 / 4xx）**规则降级**。
 *
 * 不变量：
 *   - **降级不是错误**：任何失败路径都返回可用结果，HTTP 恒 200，置 `degraded:true, source:'rule'`（R1）。
 *   - **无 Key 不发请求**：由 `gateway.callModel` 保证（`no_key` 短路）。
 *   - **响应恒含四字段** `degraded/source/usedTools/toolCalls`；本轮无工具 ⇒ `usedTools:false, toolCalls:0`
 *     （字段**必须在**，T11 再让其取真值）。
 *   - **缓存短路**：命中即 `source:'cache'` 且**不调模型**。
 */
import type {
  AiKind,
  AiMeta,
  FaqRequest,
  FaqResult,
  PricingRequest,
  PricingResult,
  PolishRequest,
  PolishResult,
} from '@/shared/types';

import { type CacheKeyScope, computeCacheKey, getCached, putCached } from '@/server/ai/cache';
import { computeCommunityFingerprint, PRICING_CACHE_VARIANT } from '@/server/ai/fingerprint';
import { fallbackFaq, fallbackPolish, fallbackPricing } from '@/server/ai/fallback';
import {
  type ChatMessage,
  MODEL_MAX_TOKENS,
  MODEL_TEMPERATURE,
  callModel,
} from '@/server/ai/gateway';
import {
  type CachePort,
  type ToolExecutor,
  gatewayModelPort,
  runAgentGraph,
} from '@/server/ai/graph';
import {
  SETTLEMENT_TOOL_SPEC,
  SettlementStatsArgsSchema,
  ToolUnavailableError,
  getCommunitySettlementStats,
  renderSettlementForPrompt,
} from '@/server/ai/tools';
import { createObserver, flushObserver } from '@/server/ai/observe';
import {
  FAQ_SYSTEM_PROMPT,
  type FaqModelOutput,
  FaqModelOutputSchema,
  POLISH_SYSTEM_PROMPT,
  type PolishModelOutput,
  PolishModelOutputSchema,
  PRICING_SYSTEM_PROMPT,
  type PricingModelOutput,
  PricingModelOutputSchema,
  REPAIR_INSTRUCTION,
  buildFaqUserPrompt,
  buildPolishUserPrompt,
  buildPricingUserPrompt,
} from '@/server/ai/prompts';
import { type Viewer, requireOwner } from '@/server/auth/guard';
import { prisma } from '@/server/db';

/** 本轮（未引入工具）的固定工具元信息；T11 会让定价档取真值。 */
const NO_TOOLS = { usedTools: false, toolCalls: 0 } as const;

/**
 * 解析器所需的最小结构化契约（避免依赖 Zod 的三参泛型 `_input/_output` 差异）。
 * 模型输出 schema 含「归一化 transform」（输入 `string` / 输出严格枚举），Zod 对象天然满足本接口。
 */
interface ParseSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

interface RunLlmSpec<T> {
  kind: AiKind;
  messages: ChatMessage[];
  schema: ParseSchema<T>;
  maxTokens: number;
  temperature: number;
  /** 参与缓存键的**规范化输入**（须覆盖一切影响输出的字段）。 */
  cachePayload: unknown;
  /**
   * 缓存键作用域（§6.5.3）。**仅定价传**：润色 / FAQ 不依赖社区数据，键必须逐字节不变。
   */
  cacheScope?: CacheKeyScope;
  fallback: () => T;
}

interface RunLlmResult<T> {
  output: T;
  meta: AiMeta;
}

/** `JSON.parse` + schema 校验；任一步失败返回 `null`（交由上层决定 REPAIR/降级）。 */
function parseAndValidate<T>(content: string, schema: ParseSchema<T>): T | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}

/**
 * 通用编排：缓存短路 → 模型 → 校验 → REPAIR(≤1) → 降级。
 */
async function runLlm<T>(spec: RunLlmSpec<T>): Promise<RunLlmResult<T>> {
  const key = computeCacheKey(spec.kind, spec.cachePayload, spec.cacheScope);

  const cached = await getCached(spec.kind, spec.cachePayload, spec.cacheScope);
  if (cached !== null) {
    return {
      output: cached.envelope.output as T,
      meta: {
        degraded: false,
        source: 'cache',
        usedTools: cached.envelope.usedTools,
        toolCalls: cached.envelope.toolCalls,
      },
    };
  }

  const first = await callModel({
    messages: spec.messages,
    maxTokens: spec.maxTokens,
    temperature: spec.temperature,
  });
  let output: T | null = first.ok ? parseAndValidate(first.content, spec.schema) : null;

  if (output === null && first.ok) {
    // REPAIR：把非法输出回灌为 assistant 消息 + 追加**确定性**纠正提示，重提示**恰好 1 次**。
    const repairMessages: ChatMessage[] = [
      ...spec.messages,
      { role: 'assistant', content: first.content },
      { role: 'user', content: REPAIR_INSTRUCTION },
    ];
    const second = await callModel({
      messages: repairMessages,
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
    });
    output = second.ok ? parseAndValidate(second.content, spec.schema) : null;
  }

  if (output === null) {
    // 无 Key / 超时 / 4xx / JSON 仍非法 ⇒ 确定性规则降级（degraded:true, source:'rule'）。
    return {
      output: spec.fallback(),
      meta: { degraded: true, source: 'rule', ...NO_TOOLS },
    };
  }

  await putCached(key, spec.kind, {
    output,
    ...NO_TOOLS,
    // 键命名空间与指纹写进 outputJson 供事后归因（不占表结构，§6.5.3）。
    ...(spec.cacheScope === undefined
      ? {}
      : {
          variant: spec.cacheScope.variant,
          commFp: spec.cacheScope.communityFingerprint,
        }),
  });
  return { output, meta: { degraded: false, source: 'llm', ...NO_TOOLS } };
}

/**
 * 把 `cache.ts` 的两级缓存包装成图的 `CachePort`。
 *
 * 作用域（`variant` + `commFp`）在这里注入——**图本身不知道租户的存在**，
 * 租户纪律全部留在服务层，便于单测替图注入任意假缓存。
 */
function scopedCachePort(kind: AiKind, payload: unknown, scope?: CacheKeyScope): CachePort {
  return {
    get: async () => {
      const hit = await getCached(kind, payload, scope);
      if (hit === null) {
        return null;
      }
      return {
        output: hit.envelope.output,
        usedTools: hit.envelope.usedTools,
        toolCalls: hit.envelope.toolCalls,
      };
    },
    put: async (_kind, _payload, value) => {
      await putCached(computeCacheKey(kind, payload, scope), kind, {
        output: value.output,
        usedTools: value.usedTools,
        toolCalls: value.toolCalls,
        ...(scope === undefined
          ? {}
          : { variant: scope.variant, commFp: scope.communityFingerprint }),
      });
    },
  };
}

/**
 * `POST /api/ai/pricing`（§8 A）：智能定价建议——**走 agent 图**（§6.6）。
 *
 * `communityId` **只允许来自服务端会话**（route 传 `viewer.currentCommunityId`）：它决定缓存
 * 指纹的租户维度与工具查询的租户谓词，若可被请求体左右，等价于把跨租户隔离交还给客户端。
 */
export async function generatePricing(
  input: PricingRequest,
  communityId: string,
): Promise<PricingResult> {
  const commFp = await computeCommunityFingerprint(communityId);
  const scope: CacheKeyScope = {
    variant: PRICING_CACHE_VARIANT,
    communityFingerprint: commFp,
  };

  // 工具执行器：预取与模型 function-call 共用同一条路径 ⇒ 租户防线只有一处（§6.5.6）。
  const executeTool: ToolExecutor = async (name, rawArgs) => {
    if (name !== SETTLEMENT_TOOL_SPEC.name) {
      throw new ToolUnavailableError(`未注册的工具：${name}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(rawArgs === '' ? '{}' : rawArgs) as unknown;
    } catch {
      throw new ToolUnavailableError('工具 arguments 不是合法 JSON');
    }
    // `.strict()` 在此剥除模型幻觉出的 communityId 等未知字段。
    const args = SettlementStatsArgsSchema.parse(json);
    return renderSettlementForPrompt(await getCommunitySettlementStats(communityId, args));
  };

  const payload = {
    name: input.name,
    description: input.description ?? null,
    category: input.category ?? null,
  };
  const observer = createObserver(`pricing:${input.name.slice(0, 16)}`);
  const { output, meta } = await runAgentGraph<PricingModelOutput>({
    kind: 'PRICING',
    systemPrompt: PRICING_SYSTEM_PROMPT,
    userPrompt: buildPricingUserPrompt(input),
    schema: PricingModelOutputSchema,
    maxTokens: MODEL_MAX_TOKENS.PRICING,
    temperature: MODEL_TEMPERATURE.PRICING,
    tools: [SETTLEMENT_TOOL_SPEC],
    executeTool,
    prefetchEnabled: process.env.AI_PRICING_PREFETCH !== '0',
    fallback: () => fallbackPricing(input),
    cachePayload: payload,
    model: gatewayModelPort,
    cache: scopedCachePort('PRICING', payload, scope),
    onEvent: observer.onEvent,
  });
  flushObserver(observer);
  return { ...meta, ...output };
}

/** `POST /api/ai/polish`（§8 B）：物品描述优化。 */
export async function generatePolish(input: PolishRequest): Promise<PolishResult> {
  const { output, meta } = await runLlm<PolishModelOutput>({
    kind: 'POLISH',
    messages: [
      { role: 'system', content: POLISH_SYSTEM_PROMPT },
      { role: 'user', content: buildPolishUserPrompt(input) },
    ],
    schema: PolishModelOutputSchema,
    maxTokens: MODEL_MAX_TOKENS.POLISH,
    temperature: MODEL_TEMPERATURE.POLISH,
    cachePayload: {
      rawText: input.rawText,
      name: input.name ?? null,
      tradeType: input.tradeType ?? null,
    },
    fallback: () => fallbackPolish(input),
  });
  return { ...meta, ...output };
}

/**
 * `POST /api/ai/faq`（§8 C）：交易 FAQ 自动回复建议。
 * 先按会话社区加载物品（不存在/跨社区 → 404，全站一致的租户红线）。
 */
export async function generateFaq(viewer: Viewer, input: FaqRequest): Promise<FaqResult> {
  // FAQ 是「卖家回复建议」：仅发布者可用（契约 §8 权限例外）。非发布者 → 403，
  // 物品不存在/跨社区 → 404（`requireOwner` 内部先做租户校验）。
  const item = await requireOwner(viewer, input.itemId);
  // `GuardedItem` 不含 description；物品存在性与租户已由上面的守卫校验，这里只补取 prompt 所需的描述。
  const detail = await prisma.item.findUnique({
    where: { id: item.id },
    select: { description: true },
  });
  const description = detail?.description ?? '';
  const community = await prisma.community.findUnique({
    where: { id: viewer.currentCommunityId },
    select: { name: true },
  });
  const communityName = community?.name ?? '本社区';

  const { output, meta } = await runLlm<FaqModelOutput>({
    kind: 'FAQ',
    messages: [
      { role: 'system', content: FAQ_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildFaqUserPrompt({
          name: item.name,
          description,
          tradeType: item.tradeType,
          status: item.status,
          question: input.question,
        }),
      },
    ],
    schema: FaqModelOutputSchema,
    maxTokens: MODEL_MAX_TOKENS.FAQ,
    temperature: MODEL_TEMPERATURE.FAQ,
    // 缓存键含物品快照：改名 / 改描述 / 换状态都不应命中旧的 FAQ 回复。
    cachePayload: {
      itemId: item.id,
      name: item.name,
      description,
      tradeType: item.tradeType,
      status: item.status,
      question: input.question,
    },
    fallback: () =>
      fallbackFaq({
        name: item.name,
        description,
        tradeType: item.tradeType,
        status: item.status,
        communityName,
        question: input.question,
      }),
  });
  return { ...meta, ...output };
}
