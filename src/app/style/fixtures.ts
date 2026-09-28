/**
 * 风格基线页的样例数据。
 *
 * 全部经 `src/shared/schemas.ts` 的真实 schema `parse` 过一遍才导出，
 * 所以「样例长得像契约」不是靠自觉，是靠运行时会抛错。
 * 字段名或形状一旦和后端漂移，这个页面直接白屏而不是悄悄展示错误数据。
 */
import { ClaimDtoSchema, ItemDtoSchema } from '@/shared/schemas';
import type { ClaimDto, ItemDto } from '@/shared/types';

const COMMUNITY_ID = 'c_linfeng';

const RAW_ITEMS = [
  {
    id: 'i_stroller',
    communityId: COMMUNITY_ID,
    name: '闲置婴儿推车',
    category: '母婴用品',
    description: '宝宝长大了用不上，八成新，轮子刚换过。',
    tradeType: 'PAY_WHATEVER',
    price: null,
    status: 'ACTIVE',
    publishedAt: '2026-09-29T01:20:00.000Z',
    // 刻意指向一个不存在的文件：public/uploads 是空目录，这就是线上的真实情况
    coverUrl: '/uploads/seed-stroller.svg',
    owner: { id: 'u_wang', nickname: '3栋-老王' },
    favoriteCount: 0,
    claimCount: 3,
    freshness: { code: 'JUST_LISTED', label: '刚刚上架', ageHours: 0.4 },
  },
  {
    id: 'i_lamp',
    communityId: COMMUNITY_ID,
    name: '宜家台灯',
    category: '家居',
    description: '搬家带不走，灯泡上个月才换。',
    tradeType: 'FIXED_PRICE',
    price: 45,
    status: 'ACTIVE',
    publishedAt: '2026-09-28T22:05:00.000Z',
    coverUrl: null,
    owner: { id: 'u_li', nickname: '5栋-小李' },
    favoriteCount: 0,
    claimCount: 1,
    freshness: { code: 'NEW', label: '较新', ageHours: 4 },
  },
  {
    id: 'i_textbooks',
    communityId: COMMUNITY_ID,
    name: '大学教材若干（计算机类）',
    category: '图书',
    description: '数据结构、操作系统、计算机网络，有笔记。',
    tradeType: 'FREE',
    price: null,
    status: 'RESERVED',
    publishedAt: '2026-09-24T09:00:00.000Z',
    coverUrl: null,
    owner: { id: 'u_zhao', nickname: '1栋-老赵' },
    favoriteCount: 0,
    claimCount: 5,
    freshness: { code: 'OLDER', label: '较早', ageHours: 112 },
  },
  {
    id: 'i_purifier',
    communityId: COMMUNITY_ID,
    name: '小米空气净化器 2S',
    category: '家电',
    description: '滤芯刚换新，功能正常。',
    tradeType: 'FIXED_PRICE',
    price: 210,
    status: 'ARCHIVED',
    publishedAt: '2026-09-02T12:30:00.000Z',
    coverUrl: null,
    owner: { id: 'u_wang', nickname: '3栋-老王' },
    favoriteCount: 0,
    claimCount: 2,
    freshness: { code: 'OLDER', label: '较早', ageHours: 640 },
  },
  {
    id: 'i_kettle',
    communityId: COMMUNITY_ID,
    name: '电热水壶',
    category: '家电',
    description: '重复购买了一个，这个几乎没用过。',
    tradeType: 'FIXED_PRICE',
    price: 30,
    status: 'ARCHIVED',
    publishedAt: '2026-08-19T08:00:00.000Z',
    coverUrl: null,
    owner: { id: 'u_chen', nickname: '2栋-小陈' },
    favoriteCount: 0,
    claimCount: 1,
    freshness: { code: 'OLDER', label: '较早', ageHours: 980 },
  },
] as const;

const RAW_CLAIMS = [
  {
    id: 'cl_pending',
    itemId: 'i_stroller',
    applicant: { id: 'u_li', nickname: '5栋-小李' },
    message: '今晚下班能过来拿，方便吗？',
    preferredAt: '2026-09-29T11:00:00.000Z',
    preferredLocation: '3栋楼下',
    status: 'PENDING',
    contactText: null,
    createdAt: '2026-09-29T01:48:00.000Z',
    acceptedAt: null,
    completedAt: null,
  },
  {
    id: 'cl_accepted',
    itemId: 'i_lamp',
    applicant: { id: 'u_zhao', nickname: '1栋-老赵' },
    message: '还在吗？想要。',
    preferredAt: null,
    preferredLocation: '1栋快递柜旁',
    status: 'ACCEPTED',
    contactText: '微信 zhao_1972',
    createdAt: '2026-09-28T23:10:00.000Z',
    acceptedAt: '2026-09-29T00:05:00.000Z',
    completedAt: null,
  },
  {
    id: 'cl_completed',
    itemId: 'i_textbooks',
    applicant: { id: 'u_wang', nickname: '3栋-老王' },
    message: null,
    preferredAt: null,
    preferredLocation: null,
    status: 'COMPLETED',
    // 已完成但对方没填联系方式：必须明说，不能留空槽让人以为没加载完
    contactText: null,
    createdAt: '2026-09-24T10:12:00.000Z',
    acceptedAt: '2026-09-24T13:40:00.000Z',
    completedAt: '2026-09-25T09:15:00.000Z',
  },
] as const;

export const SAMPLE_ITEMS: ItemDto[] = RAW_ITEMS.map((item) => ItemDtoSchema.parse(item));

export const SAMPLE_CLAIMS: ClaimDto[] = RAW_CLAIMS.map((claim) => ClaimDtoSchema.parse(claim));

/** id → 物品摘要：`ClaimDto` 不带物品名，调用方用已缓存的列表数据这样解析。 */
export const SAMPLE_ITEM_BY_ID: ReadonlyMap<string, ItemDto> = new Map(
  SAMPLE_ITEMS.map((item) => [item.id, item]),
);
