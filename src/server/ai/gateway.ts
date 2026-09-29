/**
 * LLM 统一网关（OpenAI 兼容，`src/server/ai/gateway.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.1（网关参数表）、§6.6.3（时间预算）。
 *
 * 设计要点：
 *   - **供应商**：OpenAI 兼容；`LLM_BASE_URL`（默认 DeepSeek）+ `LLM_MODEL`（默认 `deepseek-chat`），零代码切换。
 *   - **认证**：`LLM_API_KEY`；**缺失即直接降级** → 本函数**绝不发无效请求**（返回 `no_key`）。
 *   - **超时**：每轮模型 ≤ `MODEL_ROUND_CAP_MS`（见 `budget.ts`，默认 22000），用 `AbortController` 实现；
 *     调用方可用 `timeoutMs` 覆盖（测试用）。
 *   - **重试**：仅对「网络错误 / 5xx / 超时」**重试 1 次**（退避 `RETRY_BACKOFF_MS=300`）；4xx **不重试**。
 *   - **输出约束**：`response_format:{type:'json_object'}` + `stream:false`（整块 JSON）；调用方再做
 *     `JSON.parse` + Zod 校验（本模块只负责"把内容取回来"）。
 *
 * 本模块**只读环境变量、只用全局 `fetch`**（Node 22 原生），零新增 npm 依赖。
 */
import type { AiKind } from '@/shared/types';

import { MODEL_ROUND_CAP_MS } from './budget';

/** 可重试故障的退避时长。 */
export const RETRY_BACKOFF_MS = 300;

/**
 * 单轮超时默认值。
 *
 * **唯一事实源是 `budget.MODEL_ROUND_CAP_MS`**（同样由 `LLM_TIMEOUT_MS` 决定）。
 * 这里曾经另有一份 6000 的默认值，于是同一个环境变量有三个数：`.env.example` 6000、
 * 本文件 6000、`budget` 22000。而 `budget` 的实测记录表明带工具单轮可达 20.7s——
 * 照 `.env.example` 配会把 agent 主路径稳定掐死并降级。
 */
const MODEL_ROUND_TIMEOUT_MS = MODEL_ROUND_CAP_MS;

/**
 * 每轮模型调用的超时上限（§6.6.3）。
 *
 * 推理型供应商需要更宽的预算：隐藏思考链会把单轮拉长到 7–13s，6s 会稳定触发
 * 「超时 → 重试 → 再超时 → 降级」链，表现为接口很慢且永远拿不到 `source:'llm'`。
 * 用 `LLM_TIMEOUT_MS` 按供应商调，不改代码即可换档。
 */

/**
 * 各能力的 `max_tokens`（§6.1）。
 *
 * 预算必须为**推理模型的隐藏思考**留出余量：部分供应商的模型会先消耗 300–600 token
 * 生成 `reasoning_content`（计入 `completion_tokens`，但 `reasoning_tokens` 不上报），
 * 预算不足时 `finish_reason` 会是 `length` 且 `content` 被截断在 JSON 中间 ——
 * 表现为 `JSON.parse` 失败 → REPAIR 轮同样截断 → 规则降级。
 */
export const MODEL_MAX_TOKENS: Record<AiKind, number> = {
  PRICING: 1200,
  POLISH: 1600,
  FAQ: 1000,
};

/** 各能力的 `temperature`（§6.1：0.3–0.7）。 */
export const MODEL_TEMPERATURE: Record<AiKind, number> = {
  PRICING: 0.3,
  POLISH: 0.7,
  FAQ: 0.4,
};

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

/** 解析后的网关配置。 */
export interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 读取网关配置（**每次调用时读**，便于测试切换 env）。
 * @returns 已配置 key 时返回配置；**无 key 返回 `null`**（调用方据此直接降级，不发请求）。
 */
export function getGatewayConfig(): GatewayConfig | null {
  const rawKey = process.env.LLM_API_KEY;
  if (rawKey === undefined || rawKey.trim() === '') {
    return null;
  }
  const baseUrl = (process.env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
  return { baseUrl, apiKey: rawKey.trim(), model };
}

/** 是否已配置可用 API Key（`/api/health` 的 `llm` 字段亦可用它）。 */
export function hasApiKey(): boolean {
  return getGatewayConfig() !== null;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CallModelOptions {
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  /** 覆盖默认超时（毫秒）；仅测试需要。 */
  timeoutMs?: number;
}

/** 失败的归因（决定是否重试 / 是否降级）。 */
export type ModelFailureReason =
  'no_key' | 'timeout' | 'network' | 'http_4xx' | 'http_5xx' | 'empty';

export type CallModelResult =
  { ok: true; content: string } | { ok: false; reason: ModelFailureReason; status?: number };

/** 是否值得重试（仅网络 / 5xx / 超时）。 */
function isRetryable(reason: ModelFailureReason): boolean {
  return reason === 'network' || reason === 'timeout' || reason === 'http_5xx';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 提取 OpenAI 兼容响应里的文本内容（`choices[0].message.content`）。 */
function extractContent(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : null;
}

/** 单次尝试（含 AbortController 超时）。 */
async function attemptOnce(
  config: GatewayConfig,
  options: CallModelOptions,
  timeoutMs: number,
): Promise<CallModelResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: options.messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: controller.signal,
    });

    if (response.status >= 500) {
      return { ok: false, reason: 'http_5xx', status: response.status };
    }
    if (response.status >= 400) {
      return { ok: false, reason: 'http_4xx', status: response.status };
    }

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      return { ok: false, reason: 'empty' };
    }
    const content = extractContent(data);
    if (content === null || content.trim() === '') {
      return { ok: false, reason: 'empty' };
    }
    return { ok: true, content };
  } catch {
    // AbortController 触发 ⇒ 超时；其余异常按网络错误处理。
    return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 「网络 / 5xx / 超时重试 1 次，4xx 与 `empty` 不重试」的唯一实现。
 *
 * 曾经这段退避逻辑在 `callModel` 与 `callModelTurn` 里各写一份。两份一旦漂移，
 * 就会出现「带工具的调用重试行为和直出的不一样」这种极难归因的差异。
 */
async function withRetryOnce<T extends { ok: boolean }>(attempt: () => Promise<T>): Promise<T> {
  let result = await attempt();
  if (!result.ok && isRetryable((result as { reason?: ModelFailureReason }).reason ?? 'empty')) {
    await sleep(RETRY_BACKOFF_MS);
    result = await attempt();
  }
  return result;
}

/**
 * 调用模型（含超时与「网络/5xx/超时重试 1 次」）。
 *
 * 返回 `CallModelResult`：**不抛异常**（把故障收敛为 `reason`），由上层服务决定降级或修补，
 * 从而保证「拔 Key / 断网」时接口**仍返回 200 + `degraded:true`**（R1）。
 */
export async function callModel(options: CallModelOptions): Promise<CallModelResult> {
  const config = getGatewayConfig();
  if (config === null) {
    // 无 Key：直接降级，**绝不发无效请求**。
    return { ok: false, reason: 'no_key' };
  }

  const timeoutMs = options.timeoutMs ?? MODEL_ROUND_TIMEOUT_MS;
  return withRetryOnce(() => attemptOnce(config, options, timeoutMs));
}

/* ========================= 工具轮次（INC-2） =========================
 *
 * 本模块有**两个**调用原语，形状不同但 abort / 退避 / 重试语义完全一致：
 *   - `callModel`    ：「一次直出 JSON」，无工具。**生产路径已不再直接使用**
 *                      （润色 / FAQ 在 INC-2 后统一走 agent 图）——保留它是因为
 *                      它仍是网关层最简单可测的原语，`gateway.test.ts` 9 个用例覆盖其
 *                      归因与重试判定。若日后确认无外部价值，删它连带删测试，别留着备用。
 *   - `callModelTurn`：agent 图专用（`graph.gatewayModelPort` 委托到这里），
 *                      把「模型要工具」与「模型给答案」两种终态都表达出来。
 */

/** 下发给模型的工具声明（OpenAI 兼容 `tools[]` 元素）。 */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema（`type: 'object'`）。**不得**包含 `communityId`（§6.5.6 第 1 条）。 */
  parameters: Record<string, unknown>;
}

/** 模型发起的一次工具调用请求。`args` 是**未校验的原始 JSON 文本**。 */
export interface ToolCall {
  id: string;
  name: string;
  args: string;
}

/** 一轮模型调用的三种终态。 */
export type ModelTurn =
  | { ok: true; kind: 'content'; content: string }
  | { ok: true; kind: 'tool_calls'; calls: ToolCall[] }
  | { ok: false; reason: ModelFailureReason; status?: number; detail?: string };

export interface CallModelTurnOptions {
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  /** 空数组 ⇒ 本轮不下发工具（`REPAIR` / 恢复轮用）。 */
  tools: ToolSpec[];
  /** 是否要求 `response_format: json_object`。与工具并存时多数供应商行为未定义，故由调用方显式选。 */
  jsonMode: boolean;
  timeoutMs: number;
}

function extractToolCalls(data: unknown): ToolCall[] | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const raw = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const calls: ToolCall[] = [];
  for (const item of raw) {
    const fn = (item as { function?: unknown })?.function as {
      name?: unknown;
      arguments?: unknown;
    };
    if (typeof fn?.name !== 'string') {
      continue;
    }
    calls.push({
      id: String((item as { id?: unknown }).id ?? `call_${calls.length}`),
      name: fn.name,
      args: typeof fn.arguments === 'string' ? fn.arguments : '',
    });
  }
  return calls.length > 0 ? calls : null;
}

async function attemptTurnOnce(
  config: GatewayConfig,
  options: CallModelTurnOptions,
): Promise<ModelTurn> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: options.messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        ...(options.tools.length > 0
          ? { tools: options.tools, tool_choice: 'auto' }
          : options.jsonMode
            ? { response_format: { type: 'json_object' } }
            : {}),
        stream: false,
      }),
      signal: controller.signal,
    });
    if (response.status >= 400) {
      // 4xx/5xx 的具体原因必须留下：网关返回 400 的可能原因很多（不支持 tools、
      // schema 字段不认、上下文超长），只报 `http_4xx` 等于把线上故障变成无法归因的黑洞。
      // 一并记下**实际请求的 URL**：`LLM_BASE_URL` 少写 `/v1` 会得到空响应体的 404，
      // 光看状态码完全分不清是"路径错"还是"模型无渠道"。
      //
      // 读 body 必须**整体**包在 try 里：`response.text()` 缺失 / 抛错时若漏出去，
      // 会被下面的 catch 归因成 `network` —— 而 `network` 是**可重试**的，
      // 于是一个本该"4xx 不重试"的调用被重发一次，既烧钱又掩盖了真实原因。
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        detail = '';
      }
      return {
        ok: false,
        reason: response.status >= 500 ? 'http_5xx' : 'http_4xx',
        status: response.status,
        detail: `${config.baseUrl}/chat/completions ${detail.slice(0, 260)}`,
      };
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, reason: 'empty' };
    }
    const calls = extractToolCalls(data);
    if (calls !== null) {
      return { ok: true, kind: 'tool_calls', calls };
    }
    const content = extractContent(data);
    if (content === null || content.trim() === '') {
      return { ok: false, reason: 'empty' };
    }
    return { ok: true, kind: 'content', content };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带工具的一轮模型调用。语义与 `callModel` 对齐：**不抛异常**，故障收敛为 `reason`；
 * 仅网络 / 5xx / 超时重试 1 次，4xx 与 `empty` 不重试。
 */
export async function callModelTurn(options: CallModelTurnOptions): Promise<ModelTurn> {
  const config = getGatewayConfig();
  if (config === null) {
    return { ok: false, reason: 'no_key' };
  }
  return withRetryOnce(() => attemptTurnOnce(config, options));
}
