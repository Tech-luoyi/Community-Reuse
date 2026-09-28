/**
 * D1 联系方式可见性 + contactText 归一化（纯函数，无 DB）。
 *
 * 断言「物品详情恒 null」「申请仅对手方可见」「空串清空」三条硬规则。
 */
import { describe, expect, it } from 'vitest';

import { ItemDetailDtoSchema } from '@/shared/schemas';

import {
  CONTACT_TEXT_MAX_LENGTH,
  claimContactTextForViewer,
  itemDetailContactText,
  normalizeContactText,
} from '@/server/auth/contact';

describe('D1：物品详情联系方式恒为 null', () => {
  it('itemDetailContactText() 恒返回 null', () => {
    expect(itemDetailContactText()).toBeNull();
  });

  it('ItemDetailDtoSchema 的 contactText 只接受 null（拒绝任何字符串）', () => {
    expect(ItemDetailDtoSchema.shape.contactText.safeParse(null).success).toBe(true);
    expect(ItemDetailDtoSchema.shape.contactText.safeParse('微信 abc').success).toBe(false);
    expect(ItemDetailDtoSchema.shape.contactText.safeParse('').success).toBe(false);
  });
});

describe('D1：领取申请联系方式仅对 ACCEPTED/COMPLETED 的对手方可见', () => {
  const base = {
    viewerId: 'u_viewer',
    ownerId: 'u_owner',
    applicantId: 'u_applicant',
    ownerContactText: '微信 owner',
    applicantContactText: '微信 applicant',
  } as const;

  it('PENDING / REJECTED / CANCELED 一律 null（即使观看者是交易一方）', () => {
    for (const status of ['PENDING', 'REJECTED', 'CANCELED'] as const) {
      expect(claimContactTextForViewer({ ...base, status, viewerId: base.ownerId })).toBeNull();
      expect(claimContactTextForViewer({ ...base, status, viewerId: base.applicantId })).toBeNull();
    }
  });

  it('ACCEPTED：发布者看到申请人联系方式', () => {
    expect(claimContactTextForViewer({ ...base, status: 'ACCEPTED', viewerId: base.ownerId })).toBe(
      '微信 applicant',
    );
  });

  it('ACCEPTED：申请人看到发布者联系方式', () => {
    expect(
      claimContactTextForViewer({ ...base, status: 'ACCEPTED', viewerId: base.applicantId }),
    ).toBe('微信 owner');
  });

  it('COMPLETED：与 ACCEPTED 同规则', () => {
    expect(
      claimContactTextForViewer({ ...base, status: 'COMPLETED', viewerId: base.ownerId }),
    ).toBe('微信 applicant');
    expect(
      claimContactTextForViewer({ ...base, status: 'COMPLETED', viewerId: base.applicantId }),
    ).toBe('微信 owner');
  });

  it('ACCEPTED 但观看者既非发布者也非申请人 → null（旁观者不可见）', () => {
    expect(
      claimContactTextForViewer({ ...base, status: 'ACCEPTED', viewerId: 'u_stranger' }),
    ).toBeNull();
  });

  it('对方未填写联系方式 → null（前端显示「对方未填写联系方式」）', () => {
    expect(
      claimContactTextForViewer({
        ...base,
        status: 'ACCEPTED',
        viewerId: base.ownerId,
        applicantContactText: null,
      }),
    ).toBeNull();
  });
});

describe('contactText 归一化（PATCH /api/me 唯一写入口）', () => {
  it('undefined → undefined（保持不动）', () => {
    expect(normalizeContactText(undefined)).toBeUndefined();
  });

  it('空串 → null（清空）', () => {
    expect(normalizeContactText('')).toBeNull();
  });

  it('纯空白 → null（清空）', () => {
    expect(normalizeContactText('   ')).toBeNull();
  });

  it('正常值 → 去除首尾空白', () => {
    expect(normalizeContactText('  微信 abc  ')).toBe('微信 abc');
  });

  it('等于上限（120）→ 保留', () => {
    const value = 'a'.repeat(CONTACT_TEXT_MAX_LENGTH);
    expect(normalizeContactText(value)).toBe(value);
  });

  it('超过上限 → 抛 RangeError', () => {
    expect(() => normalizeContactText('a'.repeat(CONTACT_TEXT_MAX_LENGTH + 1))).toThrow(RangeError);
  });
});
