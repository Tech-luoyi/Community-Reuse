import { describe, expect, it } from 'vitest';

import { buildSeedData } from '../../prisma/seed-data';

/**
 * 纯逻辑校验 seed 数据形状与 §4.4 的 DB 层不变量（零 DB）：
 * 与 migration.sql 的 CHECK 约束、以及 AI 定价工具对「已归档成交记录」的查询前提保持一致。
 */
const FIXED_NOW = new Date('2026-09-28T10:00:00.000Z');

describe('prisma/seed-data · 形状与不变量', () => {
  const data = buildSeedData(FIXED_NOW);

  it('两个小区，邀请码唯一', () => {
    expect(data.communities).toHaveLength(2);
    const codes = data.communities.map((community) => community.inviteCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('每个物品：价格非负（CHECK ①）', () => {
    for (const item of data.items) {
      if (item.price !== null) {
        expect(item.price).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('每个物品：FIXED_PRICE 必填价格（CHECK ②）', () => {
    for (const item of data.items) {
      if (item.tradeType === 'FIXED_PRICE') {
        expect(item.price).not.toBeNull();
      }
    }
  });

  it('每个物品：图片数量 ≤ 6（应用层不变量）', () => {
    for (const item of data.items) {
      expect(item.images.length).toBeLessThanOrEqual(6);
      for (const image of item.images) {
        expect(image.itemId).toBe(item.id);
      }
    }
  });

  it('成员关系 (communityId, userId) 唯一', () => {
    const keys = data.memberships.map((m) => `${m.communityId}:${m.userId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('存在至少一条「已归档且含价格」的成交记录（AI 定价工具的数据前提）', () => {
    const archivedWithPrice = data.items.filter(
      (item) => item.status === 'ARCHIVED' && item.price !== null,
    );
    expect(archivedWithPrice.length).toBeGreaterThanOrEqual(1);
  });

  it('申请记录的外键指向真实存在的物品与用户', () => {
    const itemIds = new Set(data.items.map((item) => item.id));
    const userIds = new Set(data.users.map((user) => user.id));
    for (const claim of data.claims) {
      expect(itemIds.has(claim.itemId)).toBe(true);
      expect(userIds.has(claim.applicantId)).toBe(true);
    }
  });

  it('留言与通知的外键自洽（AI 留言无作者）', () => {
    const itemIds = new Set(data.items.map((item) => item.id));
    const userIds = new Set(data.users.map((user) => user.id));
    for (const message of data.messages) {
      expect(itemIds.has(message.itemId)).toBe(true);
      if (message.senderType === 'AI') {
        expect(message.authorId).toBeNull();
      } else {
        expect(message.authorId).not.toBeNull();
        expect(userIds.has(message.authorId ?? '')).toBe(true);
      }
    }
    for (const notification of data.notifications) {
      expect(userIds.has(notification.userId)).toBe(true);
    }
  });

  it('RESERVED / ARCHIVED 物品具备对应时间戳', () => {
    for (const item of data.items) {
      if (item.status === 'RESERVED') {
        expect(item.reservedAt).not.toBeNull();
      }
      if (item.status === 'ARCHIVED') {
        expect(item.archivedAt).not.toBeNull();
      }
    }
  });
});
