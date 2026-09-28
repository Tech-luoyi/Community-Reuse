/**
 * AI 接口**进程内令牌桶限流**（`src/server/ai/rate-limit.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.1（限流行）、docs/api-contract.md §8（`RATE_LIMITED` 429）。
 * 参数：**每用户 10 次/分、全局 60 次/分**。
 *
 * 桶算法本体在 `@/server/rate-limit`（与 §3 上传共用同一实现，避免两份漂移）；
 * 本文件只固定 AI 的容量参数并保留既有导出名（调用点与单测不变）。
 *
 * ⚠️ 诚实标注：状态仅存进程内、多实例不共享——见 `@/server/rate-limit` 的同名说明。
 * 计数口径：**请求进入即计数**（含缓存命中的请求），与是否真正调用模型无关。
 */
import { createRateLimiter } from '@/server/rate-limit';

const WINDOW_MS = 60_000;
const PER_USER_CAPACITY = 10;
const GLOBAL_CAPACITY = 60;

const aiLimiter = createRateLimiter({
  windowMs: WINDOW_MS,
  userCapacity: PER_USER_CAPACITY,
  globalCapacity: GLOBAL_CAPACITY,
});

/**
 * 尝试消费一个令牌（用户桶 + 全局桶须**同时**可用）。
 * @param now 注入当前时间（测试可传固定值以确定性驱动）。
 * @returns 是否放行。
 */
export function tryConsumeAiRateLimit(userId: string, now: number = Date.now()): boolean {
  return aiLimiter.tryConsume(userId, now);
}

/**
 * 强制限流：超限抛 `RATE_LIMITED`(429)。
 * @throws AppError RATE_LIMITED
 */
export function enforceAiRateLimit(userId: string): void {
  aiLimiter.enforce(userId);
}

/** 重置全部令牌桶（**测试专用**）。 */
export function resetAiRateLimit(): void {
  aiLimiter.reset();
}
