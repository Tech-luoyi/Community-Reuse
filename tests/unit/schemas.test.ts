import { describe, expect, it } from 'vitest';

import {
  CONTACT_TEXT_MAX,
  CreateItemRequestSchema,
  ERROR_CODES,
  ErrorBodySchema,
  FaqRequestSchema,
  ItemDtoSchema,
  ItemListQuerySchema,
  JoinRequestSchema,
  MAX_ITEM_IMAGES,
  PatchMeRequestSchema,
  PricingRequestSchema,
} from '@/shared/schemas';

/** 一份合法的 ItemDto 样本（列表接口契约样例的镜像）。 */
const validItemDto = {
  id: 'i_1',
  communityId: 'c_1',
  name: '九成新婴儿车',
  category: '母婴',
  description: '宝宝大了用不上，轮子好推，可折叠。',
  tradeType: 'FREE',
  price: null,
  status: 'ACTIVE',
  publishedAt: '2026-09-28T06:00:00.000Z',
  coverUrl: '/uploads/abc.jpg',
  owner: { id: 'u_1', nickname: '3栋-老王' },
  favoriteCount: 2,
  claimCount: 3,
  freshness: { code: 'JUST_LISTED', label: '刚上架', ageHours: 3.2 },
} as const;

describe('shared/schemas · 通用信封与错误码', () => {
  it('错误码集合与契约 §0.2 完全一致', () => {
    expect([...ERROR_CODES]).toEqual([
      'INVALID_INPUT',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CLAIM_CONFLICT',
      'CONFLICT',
      'PAYLOAD_TOO_LARGE',
      'RATE_LIMITED',
      'INTERNAL',
      'DEPENDENCY_UNAVAILABLE',
    ]);
  });

  it('接受合法失败信封', () => {
    const result = ErrorBodySchema.safeParse({
      error: {
        code: 'CLAIM_CONFLICT',
        message: '该物品已被预约',
        details: [{ path: 'status', message: '非 ACTIVE' }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('拒绝未知错误码', () => {
    const result = ErrorBodySchema.safeParse({ error: { code: 'TEAPOT', message: 'nope' } });
    expect(result.success).toBe(false);
  });
});

describe('shared/schemas · 鉴权', () => {
  it('join 请求：合法', () => {
    const result = JoinRequestSchema.safeParse({
      inviteCode: 'LINFENG-2026',
      nickname: '3栋-老王',
    });
    expect(result.success).toBe(true);
  });

  it('join 请求：昵称超长被拒（与 VarChar(30) 对齐）', () => {
    const result = JoinRequestSchema.safeParse({
      inviteCode: 'LINFENG-2026',
      nickname: 'x'.repeat(31),
    });
    expect(result.success).toBe(false);
  });

  it('PATCH /api/me：contactText 允许空串（等价清空）', () => {
    const result = PatchMeRequestSchema.safeParse({ contactText: '' });
    expect(result.success).toBe(true);
  });

  it(`PATCH /api/me：contactText 最长 ${CONTACT_TEXT_MAX}`, () => {
    expect(
      PatchMeRequestSchema.safeParse({ contactText: 'x'.repeat(CONTACT_TEXT_MAX) }).success,
    ).toBe(true);
    expect(
      PatchMeRequestSchema.safeParse({ contactText: 'x'.repeat(CONTACT_TEXT_MAX + 1) }).success,
    ).toBe(false);
  });
});

describe('shared/schemas · 物品', () => {
  it('ItemDto 合法样本通过', () => {
    expect(ItemDtoSchema.safeParse(validItemDto).success).toBe(true);
  });

  it('ItemDto 拒绝负价格', () => {
    expect(ItemDtoSchema.safeParse({ ...validItemDto, price: -1 }).success).toBe(false);
  });

  it('CreateItem：FIXED_PRICE 必须带价格（与 DB CHECK 对称）', () => {
    const base = {
      communityId: 'c_1',
      name: '实木书架',
      description: '九成新，需自提。',
      tradeType: 'FIXED_PRICE' as const,
    };
    expect(CreateItemRequestSchema.safeParse({ ...base, price: 120 }).success).toBe(true);
    expect(CreateItemRequestSchema.safeParse({ ...base, price: null }).success).toBe(false);
    expect(CreateItemRequestSchema.safeParse(base).success).toBe(false);
  });

  it('CreateItem：免费赠送可不带价格', () => {
    const result = CreateItemRequestSchema.safeParse({
      communityId: 'c_1',
      name: '绿萝两盆',
      description: '搬家带不走。',
      tradeType: 'FREE',
    });
    expect(result.success).toBe(true);
  });

  it(`CreateItem：图片数量 ≤ ${MAX_ITEM_IMAGES}`, () => {
    const base = {
      communityId: 'c_1',
      name: '多图物品',
      description: '图片张数边界。',
      tradeType: 'FREE' as const,
    };
    const ok = CreateItemRequestSchema.safeParse({
      ...base,
      imageKeys: Array.from({ length: MAX_ITEM_IMAGES }, (_v, i) => `k${i}`),
    });
    const tooMany = CreateItemRequestSchema.safeParse({
      ...base,
      imageKeys: Array.from({ length: MAX_ITEM_IMAGES + 1 }, (_v, i) => `k${i}`),
    });
    expect(ok.success).toBe(true);
    expect(tooMany.success).toBe(false);
  });

  it('ItemListQuery：默认 status=ACTIVE / sort=latest / page=1 / pageSize=20', () => {
    const result = ItemListQuerySchema.parse({});
    expect(result.status).toBe('ACTIVE');
    expect(result.sort).toBe('latest');
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('ItemListQuery：字符串数值被 coerce 为 number，favorite 支持 true/false', () => {
    const result = ItemListQuerySchema.parse({ page: '3', pageSize: '50', favorite: 'true' });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
    expect(result.favorite).toBe(true);
  });

  it('ItemListQuery：拒绝非法排序值', () => {
    expect(ItemListQuerySchema.safeParse({ sort: 'random' }).success).toBe(false);
  });
});

describe('shared/schemas · AI 请求体', () => {
  it('pricing 请求：name 必填', () => {
    expect(PricingRequestSchema.safeParse({ name: '婴儿车' }).success).toBe(true);
    expect(PricingRequestSchema.safeParse({ description: '无名称' }).success).toBe(false);
  });

  it('faq 请求：itemId 与 question 必填', () => {
    expect(FaqRequestSchema.safeParse({ itemId: 'i_1', question: '还在吗？' }).success).toBe(true);
    expect(FaqRequestSchema.safeParse({ itemId: 'i_1', question: '' }).success).toBe(false);
  });
});
