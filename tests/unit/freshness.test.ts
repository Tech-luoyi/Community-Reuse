/**
 * `bucketFreshness` 单元测试：钉死边界 + 证明**不读时钟**。
 * 事实源：docs/tech-design-final.md §4.3①（Q1 半开区间 / Q2 纯函数）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bucketFreshness } from '@/server/freshness';

describe('bucketFreshness（纯函数，不读时钟）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('边界钉死：23.99→JUST_LISTED / 24.00→NEW / 71.99→NEW / 72.00→OLDER（半开区间）', () => {
    expect(bucketFreshness(23.99)).toEqual({ code: 'JUST_LISTED', label: '刚上架' });
    expect(bucketFreshness(24.0)).toEqual({ code: 'NEW', label: '新上架' });
    expect(bucketFreshness(71.99)).toEqual({ code: 'NEW', label: '新上架' });
    expect(bucketFreshness(72.0)).toEqual({ code: 'OLDER', label: '已上架 3 天' });
  });

  it('0 → JUST_LISTED（刚上架）', () => {
    expect(bucketFreshness(0)).toEqual({ code: 'JUST_LISTED', label: '刚上架' });
  });

  it('96.5 → OLDER，label =「已上架 4 天」', () => {
    expect(bucketFreshness(96.5)).toEqual({ code: 'OLDER', label: '已上架 4 天' });
  });

  it('未来值 -5（SQL 侧已 clamp 到 0；纯函数也落 0 档 → JUST_LISTED）', () => {
    expect(bucketFreshness(-5)).toEqual({ code: 'JUST_LISTED', label: '刚上架' });
  });

  it('同输入恒等（结果只依赖入参）', () => {
    expect(bucketFreshness(50)).toEqual(bucketFreshness(50));
  });

  it('不读时钟：伪造系统时间后，同输入的输出不变', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2011-01-01T00:00:00.000Z'));
    const early = bucketFreshness(30);
    vi.setSystemTime(new Date('2099-12-31T23:59:59.000Z'));
    const late = bucketFreshness(30);
    vi.useRealTimers();

    expect(early).toEqual({ code: 'NEW', label: '新上架' });
    expect(late).toEqual(early);
  });
});
