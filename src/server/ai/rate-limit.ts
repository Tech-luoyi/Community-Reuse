/**
 * AI 接口**进程内令牌桶限流**（`src/server/ai/rate-limit.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.1（限流行）、docs/api-contract.md §8（`RATE_LIMITED` 429）。
 * 参数：**每用户 10 次/分、全局 60 次/分**。
 *
 * ⚠️ 诚实标注：令牌桶状态**仅存进程内**（`Map`），**多实例部署下不共享**（每实例各 60/分）。
 * 本项目为**单进程 Demo**，够用；生产需换 Redis 等共享计数（超出本期范围）。
 *
 * 计数口径：**请求进入即计数**（含缓存命中的请求），与是否真正调用模型无关——限流保护的是接口入口。
 */
import { errors } from '@/server/errors';

const WINDOW_MS = 60_000;
const PER_USER_CAPACITY = 10;
const GLOBAL_CAPACITY = 60;

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const userBuckets = new Map<string, Bucket>();
let globalBucket: Bucket = { tokens: GLOBAL_CAPACITY, updatedAt: Date.now() };

/** 按速率补充令牌。 */
function refill(bucket: Bucket, capacity: number, now: number): void {
  const elapsed = now - bucket.updatedAt;
  if (elapsed <= 0) {
    return;
  }
  const refillAmount = (elapsed * capacity) / WINDOW_MS;
  bucket.tokens = Math.min(capacity, bucket.tokens + refillAmount);
  bucket.updatedAt = now;
}

/**
 * 尝试消费一个令牌（用户桶 + 全局桶须**同时**可用）。
 * @param now 注入当前时间（测试可传固定值以确定性驱动）。
 * @returns 是否放行。
 */
export function tryConsumeAiRateLimit(userId: string, now: number = Date.now()): boolean {
  const userBucket = userBuckets.get(userId) ?? { tokens: PER_USER_CAPACITY, updatedAt: now };
  refill(userBucket, PER_USER_CAPACITY, now);
  refill(globalBucket, GLOBAL_CAPACITY, now);

  if (userBucket.tokens < 1 || globalBucket.tokens < 1) {
    userBuckets.set(userId, userBucket);
    return false;
  }

  userBucket.tokens -= 1;
  globalBucket.tokens -= 1;
  userBuckets.set(userId, userBucket);
  return true;
}

/**
 * 强制限流：超限抛 `RATE_LIMITED`(429)。
 * @throws AppError RATE_LIMITED
 */
export function enforceAiRateLimit(userId: string): void {
  if (!tryConsumeAiRateLimit(userId)) {
    throw errors.rateLimited();
  }
}

/** 重置全部令牌桶（**测试专用**）。 */
export function resetAiRateLimit(): void {
  userBuckets.clear();
  globalBucket = { tokens: GLOBAL_CAPACITY, updatedAt: Date.now() };
}
