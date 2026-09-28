/**
 * 进程内令牌桶限流的**通用实现**（`src/server/rate-limit.ts`）。
 *
 * 被两处复用：`/api/ai/*`（每用户 10/分、全局 60/分）与 `/api/uploads`（§3 的 20/分、200/分）。
 * 契约错误码：`RATE_LIMITED`(429)，见 docs/api-contract.md §0.2。
 *
 * ⚠️ 诚实标注：桶状态**仅存进程内**（`Map`），**多实例部署下不共享**。
 * 本项目为**单进程 Demo**，够用；生产需换 Redis 等共享计数（超出本期范围）。
 *
 * 计数口径：**请求进入即计数**（含缓存命中 / 校验失败的请求），与是否真正落到下游无关——
 * 限流保护的是接口入口。
 */
import { errors } from '@/server/errors';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimiterConfig {
  /** 补充窗口（毫秒）：窗口内可消费 `capacity` 次。 */
  windowMs: number;
  /** 每用户容量。 */
  userCapacity: number;
  /** 全局容量。 */
  globalCapacity: number;
}

export interface RateLimiter {
  /** 尝试消费一个令牌（用户桶 + 全局桶须**同时**可用）；`now` 可注入以便确定性测试。 */
  tryConsume: (userId: string, now?: number) => boolean;
  /** 强制限流：超限抛 `RATE_LIMITED`(429)。 */
  enforce: (userId: string) => void;
  /** 重置全部令牌桶（**测试专用**）。 */
  reset: () => void;
}

/** 按速率补充令牌（就地修改）。 */
function refill(bucket: Bucket, capacity: number, windowMs: number, now: number): void {
  const elapsed = now - bucket.updatedAt;
  if (elapsed <= 0) {
    return;
  }
  bucket.tokens = Math.min(capacity, bucket.tokens + (elapsed * capacity) / windowMs);
  bucket.updatedAt = now;
}

/** 构造一个「用户桶 + 全局桶」双重限流的令牌桶。 */
export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const userBuckets = new Map<string, Bucket>();
  let globalBucket: Bucket = { tokens: config.globalCapacity, updatedAt: Date.now() };

  function tryConsume(userId: string, now: number = Date.now()): boolean {
    const userBucket = userBuckets.get(userId) ?? { tokens: config.userCapacity, updatedAt: now };
    refill(userBucket, config.userCapacity, config.windowMs, now);
    refill(globalBucket, config.globalCapacity, config.windowMs, now);

    if (userBucket.tokens < 1 || globalBucket.tokens < 1) {
      userBuckets.set(userId, userBucket);
      return false;
    }
    userBucket.tokens -= 1;
    globalBucket.tokens -= 1;
    userBuckets.set(userId, userBucket);
    return true;
  }

  return {
    tryConsume,
    enforce(userId: string): void {
      if (!tryConsume(userId)) {
        throw errors.rateLimited();
      }
    },
    reset(): void {
      userBuckets.clear();
      globalBucket = { tokens: config.globalCapacity, updatedAt: Date.now() };
    },
  };
}
