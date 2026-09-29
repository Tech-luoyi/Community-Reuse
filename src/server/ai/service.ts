/**
 * LLM 能力编排（`src/server/ai/service.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.1（网关）、§6.2（prompt/schema）、§6.3（降级）、
 * §6.6.4（降级层级：`source` 与 `usedTools` 正交）；契约 docs/api-contract.md §8。
 *
 * **三个能力（定价 / 润色 / FAQ）共用同一张 agent 图**（`graph.runAgentGraph`），
 * 差别只在「是否下发工具」与「预映像是否含社区指纹」，不再各写一套编排。
 * 这条纪律的价值在于：deadline、REPAIR 次数、降级层级、可观测事件**只有一处实现**。
 * 曾经存在过一个并行的内联编排（润色 / FAQ 专用），它没有全局 deadline、没有可观测，
 * 于是「定价有兜底、润色没有」成了长期不一致的来源——已删除。
 *
 * 不变量：
 *   - **降级不是错误**：任何失败路径都返回可用结果，HTTP 恒 200，置 `degraded:true, source:'rule'`（R1）。
 *   - **无 Key 不发请求**：由 `gateway.callModelTurn` 保证（`no_key` 短路）。
 *   - **响应恒含四字段** `degraded/source/usedTools/toolCalls`；润色 / FAQ 不消费社区数据
 *     ⇒ 恒为 `usedTools:false, toolCalls:0`。
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
import { getCheckpointer } from '@/server/ai/checkpoint';
import { getEmbeddingConfig, getEmbeddingProvider } from '@/server/ai/embeddings';
import { computeCommunityFingerprint, PRICING_CACHE_VARIANT } from '@/server/ai/fingerprint';
import { fallbackFaq, fallbackPolish, fallbackPricing } from '@/server/ai/fallback';
import { MODEL_MAX_TOKENS, MODEL_TEMPERATURE } from '@/server/ai/gateway';
import {
  type CachePort,
  type GraphEvent,
  type ToolExecutor,
  gatewayModelPort,
  runAgentGraph,
} from '@/server/ai/graph';
import {
  SIMILAR_TOOL_SPEC,
  SimilarItemsArgsSchema,
  renderSimilarForPrompt,
  searchSimilarItems,
} from '@/server/ai/retrieve';
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
  buildFaqUserPrompt,
  buildPolishUserPrompt,
  buildPricingUserPrompt,
} from '@/server/ai/prompts';
import { type Viewer, requireOwner } from '@/server/auth/guard';
import { prisma } from '@/server/db';

/**
 * 解析器所需的最小结构化契约（避免依赖 Zod 的三参泛型 `_input/_output` 差异）。
 * 模型输出 schema 含「归一化 transform」（输入 `string` / 输出严格枚举），Zod 对象天然满足本接口。
 */
interface ParseSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/**
 * 通用编排：缓存短路 → 模型 → 校验 → REPAIR(≤1) → 降级。
 *
 * 润色 / FAQ 走这里：**不派工具、不开预取**（§6.5.8 的保险模式只对定价有意义），
 * 缓存键不带作用域 ⇒ 与纯单轮调用的历史键**逐字节一致**，升级不产生一次性的缓存雪崩。
 * deadline / REPAIR / 降级 / 观测全部由图运行时统一承担（§6.6）。
 */
async function runToolless<T>(spec: {
  kind: AiKind;
  systemPrompt: string;
  userPrompt: string;
  schema: ParseSchema<T>;
  maxTokens: number;
  temperature: number;
  cachePayload: unknown;
  fallback: () => T;
  /** 观测用的短标签（不含用户输入，避免 PII 进日志）。 */
  label: string;
}): Promise<{ output: T; meta: AiMeta }> {
  const observer = createObserver(spec.label);
  const { output, meta } = await runAgentGraph<T>({
    kind: spec.kind,
    systemPrompt: spec.systemPrompt,
    userPrompt: spec.userPrompt,
    schema: spec.schema,
    maxTokens: spec.maxTokens,
    temperature: spec.temperature,
    tools: [],
    // 无工具 ⇒ 永不触发；抛错而不是静默返回，避免以后误开工具时无声地产出错误数据。
    executeTool: (name) => {
      throw new ToolUnavailableError(`本能力未注册工具：${name}`);
    },
    prefetchEnabled: false,
    fallback: spec.fallback,
    cachePayload: spec.cachePayload,
    model: gatewayModelPort,
    cache: scopedCachePort(spec.kind, spec.cachePayload),
    onEvent: (event) => {
      observer.onEvent(event);
    },
  });
  flushObserver(observer);
  return { output, meta };
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
  options?: { onEvent?: (event: GraphEvent) => void; threadId?: string },
): Promise<PricingResult> {
  const commFp = await computeCommunityFingerprint(communityId);
  const scope: CacheKeyScope = {
    variant: PRICING_CACHE_VARIANT,
    communityFingerprint: commFp,
  };

  // 工具执行器：预取与模型 function-call 共用同一条路径 ⇒ 租户防线只有一处（§6.5.6）。
  const executeTool: ToolExecutor = async (name, rawArgs) => {
    const isSettlement = name === SETTLEMENT_TOOL_SPEC.name;
    const isSimilar = name === SIMILAR_TOOL_SPEC.name;
    if (!isSettlement && !isSimilar) {
      throw new ToolUnavailableError(`未注册的工具：${name}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(rawArgs === '' ? '{}' : rawArgs) as unknown;
    } catch {
      throw new ToolUnavailableError('工具 arguments 不是合法 JSON');
    }
    // `.strict()` 在此剥除模型幻觉出的 communityId 等未知字段。
    if (isSettlement) {
      const args = SettlementStatsArgsSchema.parse(json);
      return renderSettlementForPrompt(await getCommunitySettlementStats(communityId, args));
    }
    const provider = getEmbeddingProvider();
    if (provider === null) {
      // 只可能来自并发下的配置变化：正常路径下未配置就不会把本工具交给模型。
      throw new ToolUnavailableError('嵌入服务未配置');
    }
    const args = SimilarItemsArgsSchema.parse(json);
    return renderSimilarForPrompt(await searchSimilarItems(communityId, args, provider));
  };

  // 语义检索只在嵌入**真配了**的时候上桌：否则每轮都白派一个必然失败的工具，
  // 还多烧一次模型调用（§6.6.4 的延迟预算按轮计）。
  const similarityEnabled = getEmbeddingConfig() !== null;

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
    tools: similarityEnabled ? [SETTLEMENT_TOOL_SPEC, SIMILAR_TOOL_SPEC] : [SETTLEMENT_TOOL_SPEC],
    executeTool,
    prefetchEnabled: process.env.AI_PRICING_PREFETCH !== '0',
    fallback: () => fallbackPricing(input),
    cachePayload: payload,
    model: gatewayModelPort,
    cache: scopedCachePort('PRICING', payload, scope),
    // 记忆不可用（表没建 / 连接失败）时 getCheckpointer 返回 null ⇒ 退化为无记忆单次调用，
    // 接口语义完全不变（§6.4 纪律 3：增强项挂了不许把主路径拖下水）。
    ...(options?.threadId === undefined
      ? {}
      : { checkpointer: getCheckpointer() ?? undefined, threadId: options.threadId }),
    onEvent: (event) => {
      observer.onEvent(event);
      options?.onEvent?.(event);
    },
  });
  flushObserver(observer);
  return { ...meta, ...output };
}

/** `POST /api/ai/polish`（§8 B）：物品描述优化。 */
export async function generatePolish(input: PolishRequest): Promise<PolishResult> {
  const { output, meta } = await runToolless<PolishModelOutput>({
    kind: 'POLISH',
    systemPrompt: POLISH_SYSTEM_PROMPT,
    userPrompt: buildPolishUserPrompt(input),
    schema: PolishModelOutputSchema,
    maxTokens: MODEL_MAX_TOKENS.POLISH,
    temperature: MODEL_TEMPERATURE.POLISH,
    cachePayload: {
      rawText: input.rawText,
      name: input.name ?? null,
      tradeType: input.tradeType ?? null,
    },
    fallback: () => fallbackPolish(input),
    label: 'polish',
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
  //
  // `GuardedItem` 已含 description：曾经这里为了拿描述**再查一次同一个 item**，
  // 于是授权校验读的行与送进 prompt 的描述不是同一份快照（TOCTOU），且白白多一次往返。
  const item = await requireOwner(viewer, input.itemId);
  const description = item.description ?? '';
  const community = await prisma.community.findUnique({
    where: { id: viewer.currentCommunityId },
    select: { name: true },
  });
  const communityName = community?.name ?? '本社区';

  const { output, meta } = await runToolless<FaqModelOutput>({
    kind: 'FAQ',
    systemPrompt: FAQ_SYSTEM_PROMPT,
    userPrompt: buildFaqUserPrompt({
      name: item.name,
      description,
      tradeType: item.tradeType,
      status: item.status,
      question: input.question,
    }),
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
    label: 'faq',
  });
  return { ...meta, ...output };
}
