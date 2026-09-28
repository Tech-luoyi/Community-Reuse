/**
 * `Asia/Shanghai` 自然月界的单测（`src/server/stats/month.ts`，纯函数）。
 *
 * 为什么值得单独钉：契约 §7 要求「聚合用的月界」与「回传的 `monthRange`」**逐字一致**，
 * 而两者都出自本函数——一旦这里错一格（比如把 UTC 的 1 日 00:00 当成本地月初），
 * 看板的"本月"就会整体偏移 8 小时，且**回传字符串也会跟着错得自洽**、前端无从发现。
 *
 * 关键边界（`+08:00` 无夏令时 ⇒ 固定偏移）：
 *   - UTC `2026-08-31T16:00:00Z` **正是** 本地 `2026-09-01 00:00` ⇒ 属 9 月（半开区间的左端）。
 *   - UTC `2026-08-31T15:59:59.999Z` 仍属本地 8 月。
 *   - 年末跨界：年份 +1、`monthRange` 仍带 `+08:00`。
 */
import { describe, expect, it } from 'vitest';

import { SHANGHAI_TIMEZONE, shanghaiMonthWindow } from '@/server/stats/month';

describe('shanghaiMonthWindow：本地自然月 [start, end)', () => {
  it('月中：回传当月 1 日与下月 1 日（带 +08:00）', () => {
    const w = shanghaiMonthWindow(new Date('2026-09-28T06:00:00.000Z'));
    expect(w.startIso).toBe('2026-09-01T00:00:00+08:00');
    expect(w.endIso).toBe('2026-10-01T00:00:00+08:00');
    expect(w.start.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-30T16:00:00.000Z');
  });

  it('左端点闭合：本地 9 月 1 日 00:00 整属 9 月', () => {
    const w = shanghaiMonthWindow(new Date('2026-08-31T16:00:00.000Z'));
    expect(w.startIso).toBe('2026-09-01T00:00:00+08:00');
  });

  it('差 1ms 仍在上一月', () => {
    const w = shanghaiMonthWindow(new Date('2026-08-31T15:59:59.999Z'));
    expect(w.startIso).toBe('2026-08-01T00:00:00+08:00');
    expect(w.endIso).toBe('2026-09-01T00:00:00+08:00');
  });

  it('年末跨界：年份进位', () => {
    const w = shanghaiMonthWindow(new Date('2026-12-31T10:00:00.000Z'));
    expect(w.startIso).toBe('2026-12-01T00:00:00+08:00');
    expect(w.endIso).toBe('2027-01-01T00:00:00+08:00');
  });

  it('年初：1 月的上界是 2 月（不出现 0 月 / 13 月）', () => {
    const w = shanghaiMonthWindow(new Date('2027-01-15T00:00:00.000Z'));
    expect(w.startIso).toBe('2027-01-01T00:00:00+08:00');
    expect(w.endIso).toBe('2027-02-01T00:00:00+08:00');
  });

  it('区间恒为 1 个月长（本地日序），且 start<end', () => {
    for (const iso of [
      '2026-01-01T00:00:00Z',
      '2026-02-14T09:30:00Z',
      '2026-03-31T16:00:00Z',
      '2026-11-30T23:59:59Z',
    ]) {
      const w = shanghaiMonthWindow(new Date(iso));
      expect(w.end.getTime()).toBeGreaterThan(w.start.getTime());
      const shiftedStart = new Date(w.start.getTime() + 8 * 3600_000);
      const shiftedEnd = new Date(w.end.getTime() + 8 * 3600_000);
      expect(shiftedEnd.getUTCMonth()).toBe((shiftedStart.getUTCMonth() + 1) % 12);
      expect(shiftedStart.getUTCDate()).toBe(1);
      expect(shiftedEnd.getUTCDate()).toBe(1);
    }
  });

  it('时区常量与契约字面量一致', () => {
    expect(SHANGHAI_TIMEZONE).toBe('Asia/Shanghai');
  });
});
