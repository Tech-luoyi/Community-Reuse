/**
 * 缓存键作用域单测（**离线，无 DB**）。
 *
 * 守住 §6.5.3 的两条红线：
 *   1. **润色 / FAQ 的键必须逐字节不变** —— 否则这次改动会把两类缓存全量作废。
 *   2. **定价的键必须随社区与随数据变** —— 否则不同社区互相命中（静默跨租户泄漏）。
 *   3. 带作用域与不带作用域的预映像不同构 ⇒ 无需新增 `AiKind` 枚举也不会碰撞。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { canonicalize, computeCacheKey } from '@/server/ai/cache';

const INPUT = { name: '九成新电磁炉', description: '用了半年', category: '家电' };

function legacyKey(kind: string, payload: unknown): string {
  return createHash('sha256')
    .update(`${kind}:${canonicalize(payload)}`)
    .digest('hex');
}

describe('ai.cache.computeCacheKey：作用域', () => {
  it('无作用域时与 INC-1 旧公式逐字节一致（润色 / FAQ 不受影响）', () => {
    expect(computeCacheKey('POLISH', INPUT)).toBe(legacyKey('POLISH', INPUT));
    expect(computeCacheKey('FAQ', { itemId: 'i1', question: '还在吗' })).toBe(
      legacyKey('FAQ', { itemId: 'i1', question: '还在吗' }),
    );
  });

  it('同一社区、同一数据指纹 ⇒ 定价键稳定（属性书写顺序无关）', () => {
    const scope = { variant: 'PRICING_AGENT_V1', communityFingerprint: 'fp-A' };
    const a = computeCacheKey('PRICING', { name: 'x', description: 'd', category: 'c' }, scope);
    const b = computeCacheKey('PRICING', { category: 'c', description: 'd', name: 'x' }, scope);
    expect(a).toBe(b);
  });

  it('不同社区 ⇒ 定价键必不相同（跨租户泄漏的根因防线）', () => {
    const keyA = computeCacheKey('PRICING', INPUT, {
      variant: 'PRICING_AGENT_V1',
      communityFingerprint: 'fp-A',
    });
    const keyB = computeCacheKey('PRICING', INPUT, {
      variant: 'PRICING_AGENT_V1',
      communityFingerprint: 'fp-B',
    });
    expect(keyA).not.toBe(keyB);
  });

  it('同社区但成交数据变动 ⇒ 定价键失效（不返回旧价）', () => {
    const before = computeCacheKey('PRICING', INPUT, {
      variant: 'PRICING_AGENT_V1',
      communityFingerprint: 'fp-before',
    });
    const after = computeCacheKey('PRICING', INPUT, {
      variant: 'PRICING_AGENT_V1',
      communityFingerprint: 'fp-after',
    });
    expect(before).not.toBe(after);
  });

  it('带作用域与不带作用域不碰撞 ⇒ 无需新增 AiKind 枚举值', () => {
    const unscoped = computeCacheKey('PRICING', INPUT);
    const scoped = computeCacheKey('PRICING', INPUT, {
      variant: 'PRICING_AGENT_V1',
      communityFingerprint: 'fp-A',
    });
    expect(scoped).not.toBe(unscoped);
  });

  it('variant 参与预映像 ⇒ 未来换实现不会命中旧条目', () => {
    const v1 = computeCacheKey('PRICING', INPUT, {
      variant: 'PRICING_AGENT_V1',
      communityFingerprint: 'fp-A',
    });
    const v2 = computeCacheKey('PRICING', INPUT, {
      variant: 'PRICING_AGENT_V2',
      communityFingerprint: 'fp-A',
    });
    expect(v1).not.toBe(v2);
  });
});
