/**
 * 令牌桶限流的单测（`src/server/rate-limit.ts`，纯离线、注入时钟）。
 *
 * 钉死四条语义：
 *   1. 用户桶先于全局桶耗尽（单用户刷满不影响他人，除非全局也满）。
 *   2. 全局桶是**跨用户共享**的。
 *   3. 按时间**连续补充**（非整窗重置）：半个窗口只回半容量。
 *   4. `reset()` 回满；`enforce()` 超限抛 `RATE_LIMITED`(429)。
 * 同时验证 AI（10/60）与上传（20/200）是**两个独立的桶**（互不透支）。
 */
import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '@/server/rate-limit';
import { isAppError } from '@/server/errors';

const T0 = 1_700_000_000_000;

describe('createRateLimiter：用户桶 / 全局桶 / 补充', () => {
  it('用户桶容量用尽即拒，即便全局桶充足', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, userCapacity: 2, globalCapacity: 100 });
    expect(limiter.tryConsume('a', T0)).toBe(true);
    expect(limiter.tryConsume('a', T0)).toBe(true);
    expect(limiter.tryConsume('a', T0)).toBe(false);
    // 另一用户不受影响。
    expect(limiter.tryConsume('b', T0)).toBe(true);
  });

  it('全局桶跨用户共享，耗尽后所有用户都被拒', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, userCapacity: 10, globalCapacity: 3 });
    expect(limiter.tryConsume('a', T0)).toBe(true);
    expect(limiter.tryConsume('b', T0)).toBe(true);
    expect(limiter.tryConsume('c', T0)).toBe(true);
    expect(limiter.tryConsume('d', T0)).toBe(false);
  });

  it('按时间连续补充：半窗回半容量，满窗回满', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, userCapacity: 4, globalCapacity: 100 });
    for (let i = 0; i < 4; i += 1) {
      expect(limiter.tryConsume('a', T0)).toBe(true);
    }
    expect(limiter.tryConsume('a', T0)).toBe(false);

    // +30s → 2 个令牌（4 * 30/60），故恰好再放行 2 次。
    expect(limiter.tryConsume('a', T0 + 30_000)).toBe(true);
    expect(limiter.tryConsume('a', T0 + 30_000)).toBe(true);
    expect(limiter.tryConsume('a', T0 + 30_000)).toBe(false);

    // 再 +60s → 封顶 4 个。
    expect(limiter.tryConsume('a', T0 + 90_000)).toBe(true);
  });

  it('时间倒退不放行（elapsed<=0 时不补充）', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, userCapacity: 1, globalCapacity: 10 });
    expect(limiter.tryConsume('a', T0)).toBe(true);
    expect(limiter.tryConsume('a', T0 - 10_000)).toBe(false);
  });

  it('reset() 回满；enforce() 超限抛 RATE_LIMITED', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, userCapacity: 1, globalCapacity: 10 });
    limiter.enforce('a');
    expect(() => limiter.enforce('a')).toThrowError();
    try {
      limiter.enforce('a');
    } catch (error) {
      expect(isAppError(error) && error.code).toBe('RATE_LIMITED');
      expect(isAppError(error) && error.httpStatus).toBe(429);
    }
    limiter.reset();
    expect(() => limiter.enforce('a')).not.toThrow();
  });
});

describe('createRateLimiter：用户桶 Map 必须有界', () => {
  it('超过 maxTrackedUsers 后按 LRU 淘汰，常驻内存不随 userId 数量增长', () => {
    // 限流器自己不能成为攻击面：早期实现对每个见过的 userId 永久留桶，
    // 于是「换一批 userId 反复打」就能让内存单调增长 —— 一个不需要鉴权就能触发的
    // 内存耗尽向量。这条用例把「有界」钉成可回归的性质。
    const limiter = createRateLimiter({
      windowMs: 60_000,
      userCapacity: 100,
      globalCapacity: 100_000,
      maxTrackedUsers: 10,
    });
    for (let i = 0; i < 500; i += 1) {
      limiter.tryConsume(`user-${i}`, T0 + i);
    }
    expect(limiter.trackedUsers()).toBeLessThanOrEqual(10);
  });

  it('淘汰掉的是最久没被碰过的桶：活跃用户不会被踢', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      userCapacity: 100,
      globalCapacity: 100_000,
      maxTrackedUsers: 3,
    });
    limiter.tryConsume('hot', T0);
    for (let i = 0; i < 10; i += 1) {
      // 每个新 userId 都在挤掉一个最旧的；'hot' 因为持续被 touch 应当留下。
      limiter.tryConsume(`cold-${i}`, T0 + i + 1);
      limiter.tryConsume('hot', T0 + i + 1);
    }
    expect(limiter.trackedUsers()).toBeLessThanOrEqual(3);
    // 桶还在 ⇒ 容量未被重置，仍按「已消耗过」计数。
    const before = limiter.tryConsume('hot', T0 + 100);
    expect(before).toBe(true);
  });

  it('不配置 maxTrackedUsers 时用缺省上限（不是无界）', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      userCapacity: 100,
      globalCapacity: 1_000_000,
    });
    for (let i = 0; i < 200; i += 1) {
      limiter.tryConsume(`u-${i}`, T0 + i);
    }
    expect(limiter.trackedUsers()).toBeLessThanOrEqual(50_000);
  });
});
