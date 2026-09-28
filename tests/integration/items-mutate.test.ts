/**
 * 物品**写**接口的真连库路由测试：`POST /api/items`（发布）、`PATCH /api/items/:id`（编辑）、
 * `POST /api/items/:id/archive`（归档）。
 *
 * 覆盖 team-lead T-BE-04 §4 的硬要求：
 *   - `POST`：成功 201（含 imageKeys→coverUrl）；`communityId` 与会话不符 → 403；未登录 → 401；
 *     `FIXED_PRICE` 缺价 → 400；非 `FIXED_PRICE` 带价 → **归一化为 null（不报错）**。
 *   - `PATCH`：非 owner → 403；跨社区 → 404；非 ACTIVE → 409 CLAIM_CONFLICT；
 *     价格不变式（合并后 FIXED_PRICE 无价 → 400；合并后非 FIXED_PRICE → price 强制 null）；imageKeys 重建。
 *   - `archive`：成功 200（status=ARCHIVED 且 `archivedAt` 由**应用时钟**写入）；非 owner → 403；
 *     跨社区 → 404；非 ACTIVE 再次归档 → 409。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as itemArchivePOST } from '@/app/api/items/[id]/archive/route';
import { GET as itemGET, PATCH as itemPATCH } from '@/app/api/items/[id]/route';
import { POST as itemsPOST } from '@/app/api/items/route';
import { prisma } from '@/server/db';
import { ItemDetailDtoSchema, ItemDtoSchema } from '@/shared/schemas';
import type { ItemDetailDto, ItemDto } from '@/shared/types';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
  insertItem,
  mintSessionToken,
  pool,
} from './helpers/db';
import { makeRequest } from './helpers/http';

interface DataEnvelope<T> {
  data: T;
}

describe('物品发布 / 编辑 / 归档（真连库）', () => {
  const scope = 'items-mutate';
  let fx: TenantFixtures;
  let ownerToken: string;
  let dualToken: string;
  /** POST 出来的物品 id 是 cuid，不匹配夹具前缀 → 单列追踪，afterAll 显式清理。 */
  const createdItemIds: string[] = [];

  const ids = {
    patchOk: '',
    mergeFree: '',
    mergeFixed: '',
    archivedPatch: '',
    archOk: '',
    archConflict: '',
    archNonOwner: '',
  };

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    fx = await createTenantFixtures(scope);
    ownerToken = mintSessionToken(fx.ownerId, fx.communityAId);
    dualToken = mintSessionToken(fx.dualId, fx.communityAId);

    const A = fx.communityAId;
    const O = fx.ownerId;
    ids.patchOk = await insertItem(scope, {
      key: 'patchOk',
      communityId: A,
      ownerId: O,
      name: '待编辑物品',
    });
    // 当前 FREE / price=null；PATCH 提交 tradeType=FIXED_PRICE 而不带价 → 400
    ids.mergeFree = await insertItem(scope, {
      key: 'mergeFree',
      communityId: A,
      ownerId: O,
      name: '免价物品',
    });
    // 当前 FIXED_PRICE / price=9.9；PATCH 提交 tradeType=FREE → price 强制 null
    ids.mergeFixed = await insertItem(scope, {
      key: 'mergeFixed',
      communityId: A,
      ownerId: O,
      name: '定价物品',
      tradeType: 'FIXED_PRICE',
      price: 9.9,
    });
    ids.archivedPatch = await insertItem(scope, {
      key: 'archivedPatch',
      communityId: A,
      ownerId: O,
      name: '已归档物品',
      status: 'ARCHIVED',
    });
    ids.archOk = await insertItem(scope, {
      key: 'archOk',
      communityId: A,
      ownerId: O,
      name: '待归档物品',
    });
    ids.archConflict = await insertItem(scope, {
      key: 'archConflict',
      communityId: A,
      ownerId: O,
      name: '已归档不可再归档',
      status: 'ARCHIVED',
    });
    ids.archNonOwner = await insertItem(scope, {
      key: 'archNonOwner',
      communityId: A,
      ownerId: O,
      name: '他人物品',
    });
  });

  afterAll(async () => {
    if (createdItemIds.length > 0) {
      await pool.query(`DELETE FROM "ItemImage" WHERE "itemId" = ANY($1)`, [createdItemIds]);
      await pool.query(`DELETE FROM "Favorite" WHERE "itemId" = ANY($1)`, [createdItemIds]);
      await pool.query(`DELETE FROM "ClaimRequest" WHERE "itemId" = ANY($1)`, [createdItemIds]);
      await pool.query(`DELETE FROM "Item" WHERE "id" = ANY($1)`, [createdItemIds]);
    }
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  // ---------------------------------------------------------------------------
  // POST /api/items
  // ---------------------------------------------------------------------------
  describe('POST /api/items（发布）', () => {
    it('201：在本社区以自己为 owner 建物品，返回 ItemDto（FREE → price=null）', async () => {
      const response = await itemsPOST(
        makeRequest('POST', '/api/items', {
          token: ownerToken,
          body: {
            communityId: fx.communityAId,
            name: '新发布物品',
            description: '测试描述',
            tradeType: 'FREE',
          },
        }),
      );
      expect(response.status).toBe(201);
      const json = (await response.json()) as DataEnvelope<ItemDto>;
      expect(() => ItemDtoSchema.parse(json.data)).not.toThrow();
      expect(json.data.communityId).toBe(fx.communityAId);
      expect(json.data.owner.id).toBe(fx.ownerId);
      expect(json.data.status).toBe('ACTIVE');
      expect(json.data.price).toBeNull();
      expect(json.data.freshness.code).toBe('JUST_LISTED');
      createdItemIds.push(json.data.id);
    });

    it('201：FIXED_PRICE 带价 → price 为 JSON number（闭环 P3）', async () => {
      const response = await itemsPOST(
        makeRequest('POST', '/api/items', {
          token: ownerToken,
          body: {
            communityId: fx.communityAId,
            name: '定价新物',
            description: '描述',
            tradeType: 'FIXED_PRICE',
            price: 12.5,
          },
        }),
      );
      expect(response.status).toBe(201);
      const json = (await response.json()) as DataEnvelope<ItemDto>;
      expect(typeof json.data.price).toBe('number');
      expect(json.data.price).toBe(12.5);
      createdItemIds.push(json.data.id);
    });

    it('非 FIXED_PRICE 却带价 → 归一化为 null（放宽输入，不报错）', async () => {
      const response = await itemsPOST(
        makeRequest('POST', '/api/items', {
          token: ownerToken,
          body: {
            communityId: fx.communityAId,
            name: '免费却带价',
            description: '描述',
            tradeType: 'FREE',
            price: 5,
          },
        }),
      );
      expect(response.status).toBe(201);
      const json = (await response.json()) as DataEnvelope<ItemDto>;
      expect(json.data.price).toBeNull();
      createdItemIds.push(json.data.id);
    });

    it('imageKeys → 建图并回读 coverUrl（第一张按 sortOrder=0）', async () => {
      const response = await itemsPOST(
        makeRequest('POST', '/api/items', {
          token: ownerToken,
          body: {
            communityId: fx.communityAId,
            name: '带图物品',
            description: '描述',
            tradeType: 'FREE',
            imageKeys: ['a.jpg', 'b.jpg'],
          },
        }),
      );
      expect(response.status).toBe(201);
      const created = (await response.json()) as DataEnvelope<ItemDto>;
      createdItemIds.push(created.data.id);

      const detailResponse = await itemGET(
        makeRequest('GET', `/api/items/${created.data.id}`, { token: ownerToken }),
        { params: { id: created.data.id } },
      );
      const detail = (await detailResponse.json()) as DataEnvelope<ItemDetailDto>;
      expect(detail.data.coverUrl).toBe('/uploads/a.jpg');
      expect(detail.data.images).toEqual([
        { url: '/uploads/a.jpg', sortOrder: 0 },
        { url: '/uploads/b.jpg', sortOrder: 1 },
      ]);
    });

    it('FIXED_PRICE 缺价 → 400 INVALID_INPUT（Zod superRefine）', async () => {
      const response = await itemsPOST(
        makeRequest('POST', '/api/items', {
          token: ownerToken,
          body: {
            communityId: fx.communityAId,
            name: '缺价物品',
            description: '描述',
            tradeType: 'FIXED_PRICE',
          },
        }),
      );
      expect(response.status).toBe(400);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('communityId 与会话不符 → 403 FORBIDDEN（社区只认会话）', async () => {
      const response = await itemsPOST(
        makeRequest('POST', '/api/items', {
          token: ownerToken,
          body: {
            communityId: fx.communityBId,
            name: '越界发布',
            description: '描述',
            tradeType: 'FREE',
          },
        }),
      );
      expect(response.status).toBe(403);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('未登录 → 401 UNAUTHENTICATED', async () => {
      const response = await itemsPOST(
        makeRequest('POST', '/api/items', {
          body: {
            communityId: fx.communityAId,
            name: '匿名发布',
            description: '描述',
            tradeType: 'FREE',
          },
        }),
      );
      expect(response.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/items/:id
  // ---------------------------------------------------------------------------
  describe('PATCH /api/items/:id（编辑）', () => {
    it('200：OWNER 改名成功并落库', async () => {
      const response = await itemPATCH(
        makeRequest('PATCH', `/api/items/${ids.patchOk}`, {
          token: ownerToken,
          body: { name: '改名后物品' },
        }),
        { params: { id: ids.patchOk } },
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as DataEnvelope<ItemDto>;
      expect(json.data.name).toBe('改名后物品');

      const row = await pool.query<{ name: string }>(`SELECT name FROM "Item" WHERE id = $1`, [
        ids.patchOk,
      ]);
      expect(row.rows[0]?.name).toBe('改名后物品');
    });

    it('非 owner（同社区成员 dual）→ 403 FORBIDDEN', async () => {
      const response = await itemPATCH(
        makeRequest('PATCH', `/api/items/${fx.itemAId}`, {
          token: dualToken,
          body: { name: '越权改名' },
        }),
        { params: { id: fx.itemAId } },
      );
      expect(response.status).toBe(403);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('跨社区 → 404（itemB 属乙区，OWNER 会话在甲区）', async () => {
      const response = await itemPATCH(
        makeRequest('PATCH', `/api/items/${fx.itemBId}`, {
          token: ownerToken,
          body: { name: '越界改名' },
        }),
        { params: { id: fx.itemBId } },
      );
      expect(response.status).toBe(404);
    });

    it('非 ACTIVE（ARCHIVED）→ 409 CLAIM_CONFLICT', async () => {
      const response = await itemPATCH(
        makeRequest('PATCH', `/api/items/${ids.archivedPatch}`, {
          token: ownerToken,
          body: { name: '改已归档' },
        }),
        { params: { id: ids.archivedPatch } },
      );
      expect(response.status).toBe(409);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('CLAIM_CONFLICT');
    });

    it('价格不变式：合并后为 FIXED_PRICE 且无价 → 400 INVALID_INPUT', async () => {
      const response = await itemPATCH(
        makeRequest('PATCH', `/api/items/${ids.mergeFree}`, {
          token: ownerToken,
          body: { tradeType: 'FIXED_PRICE' },
        }),
        { params: { id: ids.mergeFree } },
      );
      expect(response.status).toBe(400);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('价格不变式：合并后非 FIXED_PRICE → price 强制 null（并落库）', async () => {
      const response = await itemPATCH(
        makeRequest('PATCH', `/api/items/${ids.mergeFixed}`, {
          token: ownerToken,
          body: { tradeType: 'FREE' },
        }),
        { params: { id: ids.mergeFixed } },
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as DataEnvelope<ItemDto>;
      expect(json.data.tradeType).toBe('FREE');
      expect(json.data.price).toBeNull();

      const row = await pool.query<{ price: string | null }>(
        `SELECT price FROM "Item" WHERE id = $1`,
        [ids.mergeFixed],
      );
      expect(row.rows[0]?.price).toBeNull();
    });

    it('编辑 imageKeys → 重建图片（旧图删、新图按序建）', async () => {
      // 先经 PATCH 写入两张图
      await itemPATCH(
        makeRequest('PATCH', `/api/items/${ids.patchOk}`, {
          token: ownerToken,
          body: { imageKeys: ['x.jpg', 'y.jpg'] },
        }),
        { params: { id: ids.patchOk } },
      );
      const first = await itemGET(
        makeRequest('GET', `/api/items/${ids.patchOk}`, { token: ownerToken }),
        { params: { id: ids.patchOk } },
      );
      const firstDetail = (await first.json()) as DataEnvelope<ItemDetailDto>;
      expect(firstDetail.data.images).toEqual([
        { url: '/uploads/x.jpg', sortOrder: 0 },
        { url: '/uploads/y.jpg', sortOrder: 1 },
      ]);

      // 再 PATCH 换成单张 → 旧图应被删除
      await itemPATCH(
        makeRequest('PATCH', `/api/items/${ids.patchOk}`, {
          token: ownerToken,
          body: { imageKeys: ['z.jpg'] },
        }),
        { params: { id: ids.patchOk } },
      );
      const second = await itemGET(
        makeRequest('GET', `/api/items/${ids.patchOk}`, { token: ownerToken }),
        { params: { id: ids.patchOk } },
      );
      const secondDetail = (await second.json()) as DataEnvelope<ItemDetailDto>;
      expect(() => ItemDetailDtoSchema.parse(secondDetail.data)).not.toThrow();
      expect(secondDetail.data.images).toEqual([{ url: '/uploads/z.jpg', sortOrder: 0 }]);
      expect(secondDetail.data.coverUrl).toBe('/uploads/z.jpg');
    });

    it('未登录 → 401', async () => {
      const response = await itemPATCH(
        makeRequest('PATCH', `/api/items/${ids.patchOk}`, { body: { name: 'x' } }),
        { params: { id: ids.patchOk } },
      );
      expect(response.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/items/:id/archive
  // ---------------------------------------------------------------------------
  describe('POST /api/items/:id/archive（归档）', () => {
    it('200：OWNER 归档成功 → status=ARCHIVED，archivedAt 由应用时钟写入', async () => {
      const before = Date.now();
      const response = await itemArchivePOST(
        makeRequest('POST', `/api/items/${ids.archOk}/archive`, { token: ownerToken }),
        { params: { id: ids.archOk } },
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as DataEnvelope<ItemDto>;
      expect(json.data.status).toBe('ARCHIVED');

      // 经 Prisma 读取：与写入侧共用同一 timestamp(3) 语义（`pg` 驱动会把无时区的
      // timestamp 当本地时间解析，跨驱动直接比 Date 会引入时区偏移，故此处不用 raw SQL）。
      const row = await prisma.item.findUnique({
        where: { id: ids.archOk },
        select: { status: true, archivedAt: true },
      });
      expect(row?.status).toBe('ARCHIVED');
      expect(row?.archivedAt).toBeInstanceOf(Date);
      const archivedAt = row?.archivedAt as Date;
      // 应用时钟写入：落在调用前后 60s 内（若由 DB 默认值写入则会为 null / 偏离）
      expect(Math.abs(archivedAt.getTime() - before)).toBeLessThan(60_000);
    });

    it('非 ACTIVE 再次归档 → 409 CLAIM_CONFLICT', async () => {
      const response = await itemArchivePOST(
        makeRequest('POST', `/api/items/${ids.archConflict}/archive`, { token: ownerToken }),
        { params: { id: ids.archConflict } },
      );
      expect(response.status).toBe(409);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('CLAIM_CONFLICT');
    });

    it('非 owner（同社区成员 dual）→ 403 FORBIDDEN', async () => {
      const response = await itemArchivePOST(
        makeRequest('POST', `/api/items/${ids.archNonOwner}/archive`, { token: dualToken }),
        { params: { id: ids.archNonOwner } },
      );
      expect(response.status).toBe(403);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('跨社区 → 404（itemB 属乙区）', async () => {
      const response = await itemArchivePOST(
        makeRequest('POST', `/api/items/${fx.itemBId}/archive`, { token: ownerToken }),
        { params: { id: fx.itemBId } },
      );
      expect(response.status).toBe(404);
    });

    it('未登录 → 401', async () => {
      const response = await itemArchivePOST(
        makeRequest('POST', `/api/items/${ids.archNonOwner}/archive`),
        { params: { id: ids.archNonOwner } },
      );
      expect(response.status).toBe(401);
    });
  });
});
