/**
 * LLM 统一网关（OpenAI 兼容，`src/server/ai/gateway.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.1（网关参数表）、§6.6.3（时间预算）。
 *
 * 设计要点：
 *   - **供应商**：OpenAI 兼容；`LLM_BASE_URL`（默认 DeepSeek）+ `LLM_MODEL`（默认 `deepseek-chat`），零代码切换。
 *   - **认证**：`LLM_API_KEY`；**缺失即直接降级** → 本函数**绝不发无效请求**（返回 `no_key`）。
 *   - **超时**：每轮模型 ≤ `MODEL_ROUND_TIMEOUT_MS=6000`，用 `AbortController` 实现；调用方可用
 *     `timeoutMs` 覆盖（测试用）。
 *   - **重试**：仅对「网络错误 / 5xx / 超时」**重试 1 次**（退避 `RETRY_BACKOFF_MS=300`）；4xx **不重试**。
 *   - **输出约束**：`response_format:{type:'json_object'}` + `stream:false`（整块 JSON）；调用方再做
 *     `JSON.parse` + Zod 校验（本模块只负责"把内容取回来"）。
 *
 * 本模块**只读环境变量、只用全局 `fetch`**（Node 22 原生），零新增 npm 依赖。
 */
import type { AiKind } from '@/shared/types';

/** 每轮模型调用的超时上限（§6.6.3）。 */
export const MODEL_ROUND_TIMEOUT_MS = 6000;
/** 全局硬闸（§6.6.3；本轮无工具，供 T12 使用）。 */
export const TOTAL_DEADLINE_MS = 20000;
/** 可重试故障的退避时长。 */
export const RETRY_BACKOFF_MS = 300;

/** 各能力的 `max_tokens`（§6.1）。 */
export const MODEL_MAX_TOKENS: Record<AiKind, number> = {
  PRICING: 300,
  POLISH: 400,
  FAQ: 250,
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
  let result = await attemptOnce(config, options, timeoutMs);
  if (!result.ok && isRetryable(result.reason)) {
    await sleep(RETRY_BACKOFF_MS);
    result = await attemptOnce(config, options, timeoutMs);
  }
  return result;
}
