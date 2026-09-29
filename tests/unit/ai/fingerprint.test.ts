/**
 * 社区成交数据指纹单测（**mock prisma，离线**）。
 *
 * 覆盖 §6.5.3 与 §6.5.6 第 1/3 条：
 *   - `communityId` 必须以**绑定参数**下发，绝不字符串拼接进 SQL 文本。
 *   - SQL 恒带 `"communityId" = ?` 谓词与 `ARCHIVED` / `price IS NOT NULL` 限定。
 *   - 集合增删（count 变）与改价（max updatedAt 变）都必须改变指纹。
 *   - 空集合也要有稳定且与非空集合不同的指纹。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock('@/server/db', () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}));

import { computeCommunityFingerprint } from '@/server/ai/fingerprint';

/** 取标签模板的 SQL 文本与绑定值，用于断言「参数化而非拼接」。 */
function lastQuery(): { text: string; values: unknown[] } {
  const call = mocks.queryRaw.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('$queryRaw 未被调用');
  }
  const [strings, ...values] = call as unknown as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join('?'), values };
}

describe('ai.fingerprint.computeCommunityFingerprint', () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
  });

  it('communityId 走绑定参数，不出现在 SQL 文本里', async () => {
    mocks.queryRaw.mockResolvedValue([
      { count: 3, maxUpdatedAt: new Date('2026-09-01T00:00:00Z') },
    ]);
    await computeCommunityFingerprint('c_secret_tenant');
    const { text, values } = lastQuery();
    expect(text).not.toContain('c_secret_tenant');
    expect(values).toEqual(['c_secret_tenant']);
  });

  it('SQL 恒带社区谓词与「已成交且含价格」限定', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await computeCommunityFingerprint('c1');
    const { text } = lastQuery();
    expect(text).toContain('"communityId" = ?');
    expect(text).toContain("'ARCHIVED'");
    expect(text).toContain('"price" IS NOT NULL');
  });

  it('同一 (count, maxUpdatedAt) ⇒ 指纹稳定', async () => {
    const t = new Date('2026-09-01T00:00:00Z');
    mocks.queryRaw.mockResolvedValue([{ count: 5, maxUpdatedAt: t }]);
    const a = await computeCommunityFingerprint('c1');
    const b = await computeCommunityFingerprint('c1');
    expect(a).toBe(b);
  });

  it('新增一条归档（count 变）⇒ 指纹变', async () => {
    const t = new Date('2026-09-01T00:00:00Z');
    mocks.queryRaw.mockResolvedValue([{ count: 5, maxUpdatedAt: t }]);
    const before = await computeCommunityFingerprint('c1');
    mocks.queryRaw.mockResolvedValue([{ count: 6, maxUpdatedAt: t }]);
    const after = await computeCommunityFingerprint('c1');
    expect(before).not.toBe(after);
  });

  it('改了成交价（updatedAt 推进）⇒ 指纹变', async () => {
    mocks.queryRaw.mockResolvedValue([
      { count: 5, maxUpdatedAt: new Date('2026-09-01T00:00:00Z') },
    ]);
    const before = await computeCommunityFingerprint('c1');
    mocks.queryRaw.mockResolvedValue([
      { count: 5, maxUpdatedAt: new Date('2026-09-02T00:00:00Z') },
    ]);
    const after = await computeCommunityFingerprint('c1');
    expect(before).not.toBe(after);
  });

  it('空集合有稳定指纹，且与非空集合不同', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const empty1 = await computeCommunityFingerprint('c1');
    const empty2 = await computeCommunityFingerprint('c1');
    mocks.queryRaw.mockResolvedValue([
      { count: 1, maxUpdatedAt: new Date('2026-09-01T00:00:00Z') },
    ]);
    const nonEmpty = await computeCommunityFingerprint('c1');
    expect(empty1).toBe(empty2);
    expect(empty1).not.toBe(nonEmpty);
  });

  it('驱动返回字符串时间戳（pg 路径）时不因类型差异产生抖动', async () => {
    mocks.queryRaw.mockResolvedValue([{ count: 2, maxUpdatedAt: '2026-09-01T00:00:00.000Z' }]);
    const fromString = await computeCommunityFingerprint('c1');
    mocks.queryRaw.mockResolvedValue([
      { count: 2, maxUpdatedAt: new Date('2026-09-01T00:00:00Z') },
    ]);
    const fromDate = await computeCommunityFingerprint('c1');
    expect(fromString).toBe(fromDate);
  });
});
