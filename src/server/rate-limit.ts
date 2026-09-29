/**
 * 进程内令牌桶限流的**通用实现**（`src/server/rate-limit.ts`）。
 *
 * 被两处复用：`/api/ai/*`（每用户 10/分、全局 60/分）与 `/api/uploads`（§3 的 20/分、200/分）。
 * 契约错误码：`RATE_LIMITED`(429)，见 docs/api-contract.md §0.2。
 *
 * ⚠️ 诚实标注（两条，缺一不可）：
 *   1. 桶状态**仅存进程内**（`Map`），**多实例部署下不共享**。
 *      本项目为**单进程 Demo**，够用；生产需换 Redis 等共享计数（超出本期范围）。
 *   2. 进程内 `Map` 也必须有界：`Map` 只增不减，早期版本对每个见过的 userId 永久留桶，
 *      于是「换一批 userId 反复打」就能让常驻内存单调增长——那是一个不需要鉴权就能触发的
 *      内存耗尽向量（限流器本身成了攻击面）。故按 `maxTrackedUsers` 做**近似 LRU** 淘汰。
 *
 * 计数口径：**请求进入即计数**（含缓存命中 / 校验失败的请求），与是否真正落到下游无关——
 * 限流保护的是接口入口。
 */
import { errors } from '@/server/errors';

interface Bucket {
  tokens: number;
  updatedAt: number;
  /** 最近一次被命中（毫秒）；用于近似 LRU 淘汰。 */
  touchedAt: number;
}

export interface RateLimiterConfig {
  /** 补充窗口（毫秒）：窗口内可消费 `capacity` 次。 */
  windowMs: number;
  /** 每用户容量。 */
  userCapacity: number;
  /** 全局容量。 */
  globalCapacity: number;
  /**
   * 进程内最多跟踪多少个用户桶（超出按近似 LRU 淘汰）。缺省 50_000。
   * 设为 `0` 或负数会退化成「不淘汰」，仅供测试观察增长用。
   */
  maxTrackedUsers?: number;
}

export interface RateLimiter {
  /** 尝试消费一个令牌（用户桶 + 全局桶须**同时**可用）；`now` 可注入以便确定性测试。 */
  tryConsume: (userId: string, now?: number) => boolean;
  /** 强制限流：超限抛 `RATE_LIMITED`(429)。 */
  enforce: (userId: string) => void;
  /** 重置全部令牌桶（**测试专用**）。 */
  reset: () => void;
  /** 当前跟踪的用户桶数（**测试专用**：断言 Map 有界）。 */
  trackedUsers: () => number;
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
  const maxTracked = config.maxTrackedUsers ?? 50_000;
  let globalBucket: Bucket = {
    tokens: config.globalCapacity,
    updatedAt: Date.now(),
    touchedAt: Date.now(),
  };

  /** 容量已满时，把最久没被碰过的桶挤掉（近似 LRU；不必精确，桶之间无协作关系）。 */
  function evictIfNeeded(): void {
    if (maxTracked <= 0 || userBuckets.size <= maxTracked) {
      return;
    }
    // 先删一个最旧的即可：每次插入至多超出一个键。
    let oldestKey: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of userBuckets) {
      if (bucket.touchedAt < oldestAt) {
        oldestAt = bucket.touchedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      userBuckets.delete(oldestKey);
    }
  }

  function tryConsume(userId: string, now: number = Date.now()): boolean {
    const userBucket = userBuckets.get(userId) ?? {
      tokens: config.userCapacity,
      updatedAt: now,
      touchedAt: now,
    };
    userBucket.touchedAt = now;
    refill(userBucket, config.userCapacity, config.windowMs, now);
    refill(globalBucket, config.globalCapacity, config.windowMs, now);

    if (userBucket.tokens < 1 || globalBucket.tokens < 1) {
      userBuckets.set(userId, userBucket);
      evictIfNeeded();
      return false;
    }
    userBucket.tokens -= 1;
    globalBucket.tokens -= 1;
    userBuckets.set(userId, userBucket);
    evictIfNeeded();
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
      globalBucket = {
        tokens: config.globalCapacity,
        updatedAt: Date.now(),
        touchedAt: Date.now(),
      };
    },
    /** 诊断用：当前跟踪的用户桶数量（单测断言「有界」）。 */
    trackedUsers: () => userBuckets.size,
  };
}
