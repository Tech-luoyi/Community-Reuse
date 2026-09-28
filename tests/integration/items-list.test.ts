/**
 * 物品**读**接口的真连库路由测试：`GET /api/items`（列表）与 `GET /api/items/:id`（详情）。
 *
 * 覆盖 team-lead T-BE-04 §4 的硬要求：
 *   - 新鲜度分桶：造 `publishedAt = now() - interval 'N hours'` 的 25h / 100h 物品 →
 *     `NEW` / `OLDER`（label =「已上架 4 天」）；列表与详情**同一 item 的 freshness 必一致**。
 *   - `freshness=NEW` 过滤只返回 25h 那件（过滤与取值同源同钟）。
 *   - `q` 转义：`%` / `_` 一律按**字面**处理（`q='%'` 只命中名称里真带 `%` 的那件，而非全部）。
 *   - `favorite=true` 只返回当前用户已收藏的物品。
 *   - `price` 出参为 **JSON number**（闭环 P3）。
 *   - 多租户：跨社区详情 → 404；会话指向非成员社区 → 403。
 *   - D2 索引：import 真实列表 SQL，回滚事务造 4 万行 + ANALYZE，EXPLAIN 命中复合索引。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as itemGET } from '@/app/api/items/[id]/route';
import { GET as itemsGET } from '@/app/api/items/route';
import { prisma } from '@/server/db';
import { ITEM_LIST_SQL_LATEST } from '@/server/items/sql';
import { ItemDetailDtoSchema, ItemDtoSchema } from '@/shared/schemas';
import type { ItemDetailDto, ItemDto } from '@/shared/types';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
  insertFavorite,
  insertItem,
  mintSessionToken,
  pool,
} from './helpers/db';
import { makeRequest } from './helpers/http';

const INDEX_NAME = 'Item_communityId_status_publishedAt_idx';

interface ListEnvelope {
  data: ItemDto[];
  pagination: { page: number; pageSize: number; total: number };
}

async function withRollbackTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

describe('物品列表 / 详情（真连库）', () => {
  const scope = 'items-list';
  let fx: TenantFixtures;
  let token: string;

  /** 社区甲内的固定物品（除 itemA 外均在 beforeAll 用 DB `now()` 相对偏移写入）。 */
  const ids = {
    /** 0h → JUST_LISTED（tenant 夹具自带） */
    fresh: '',
    /** 25h → NEW */
    newer: '',
    /** 100h → OLDER */
    older: '',
    /** 5h → JUST_LISTED，FIXED_PRICE 12.5 */
    priced: '',
    /** 10h → JUST_LISTED，名称含字面 `%` */
    percent: '',
    /** 乙区物品（跨社区读取目标） */
    crossCommunity: '',
  };

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    fx = await createTenantFixtures(scope);
    token = mintSessionToken(fx.ownerId, fx.communityAId);

    const A = fx.communityAId;
    const O = fx.ownerId;
    ids.fresh = fx.itemAId; // 0h，JUST_LISTED，FREE
    ids.newer = await insertItem(scope, {
      key: 'newer',
      communityId: A,
      ownerId: O,
      name: '二手台灯',
      publishedAtOffsetHours: 25,
    });
    ids.older = await insertItem(scope, {
      key: 'older',
      communityId: A,
      ownerId: O,
      name: '老物件-特殊',
      publishedAtOffsetHours: 100,
    });
    ids.priced = await insertItem(scope, {
      key: 'priced',
      communityId: A,
      ownerId: O,
      name: '标价椅子',
      tradeType: 'FIXED_PRICE',
      price: 12.5,
      publishedAtOffsetHours: 5,
    });
    ids.percent = await insertItem(scope, {
      key: 'percent',
      communityId: A,
      ownerId: O,
      name: '折扣100%',
      publishedAtOffsetHours: 10,
    });

    // 乙区独立一件（owner 不属乙区，用于跨社区详情 404）。
    ids.crossCommunity = await insertItem(scope, {
      key: 'cross',
      communityId: fx.communityBId,
      ownerId: fx.dualId,
      name: '乙区物品',
      publishedAtOffsetHours: 1,
    });
  });

  afterAll(async () => {
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  // ---------------------------------------------------------------------------
  // GET /api/items
  // ---------------------------------------------------------------------------
  describe('GET /api/items（列表）', () => {
    it('200：返回本社区物品，DTO 通过契约校验，按 publishedAt DESC 排序（D2）', async () => {
      const response = await itemsGET(makeRequest('GET', '/api/items', { token }));
      expect(response.status).toBe(200);
      const json = (await response.json()) as ListEnvelope;

      expect(json.pagination).toEqual({ page: 1, pageSize: 20, total: 5 });
      // 每一条都必须满足 ItemDtoSchema（schema 即契约）
      for (const item of json.data) {
        expect(() => ItemDtoSchema.parse(item)).not.toThrow();
      }
      expect(json.data.map((item) => item.id)).toEqual([
        ids.fresh, // 0h
        ids.priced, // 5h
        ids.percent, // 10h
        ids.newer, // 25h
        ids.older, // 100h
      ]);
    });

    it('新鲜度分桶：0h/5h/10h → JUST_LISTED、25h → NEW、100h → OLDER（label「已上架 4 天」）', async () => {
      const response = await itemsGET(makeRequest('GET', '/api/items', { token }));
      const json = (await response.json()) as ListEnvelope;
      const byId = new Map(json.data.map((item) => [item.id, item]));

      expect(byId.get(ids.fresh)?.freshness.code).toBe('JUST_LISTED');
      expect(byId.get(ids.priced)?.freshness.code).toBe('JUST_LISTED');
      expect(byId.get(ids.percent)?.freshness.code).toBe('JUST_LISTED');

      const newer = byId.get(ids.newer)?.freshness;
      expect(newer?.code).toBe('NEW');
      expect(newer?.label).toBe('新上架');
      expect(newer?.ageHours).toBeGreaterThanOrEqual(24);
      expect(newer?.ageHours).toBeLessThan(72);

      const older = byId.get(ids.older)?.freshness;
      expect(older?.code).toBe('OLDER');
      expect(older?.label).toBe('已上架 4 天');
      expect(older?.ageHours).toBeGreaterThanOrEqual(72);
    });

    it('price 出参为 JSON number（FIXED_PRICE=12.5 / FREE=null）—— 闭环 P3', async () => {
      const response = await itemsGET(makeRequest('GET', '/api/items', { token }));
      const json = (await response.json()) as ListEnvelope;
      const byId = new Map(json.data.map((item) => [item.id, item]));

      const priced = byId.get(ids.priced);
      expect(typeof priced?.price).toBe('number');
      expect(priced?.price).toBe(12.5);

      const free = byId.get(ids.fresh);
      expect(free?.price).toBeNull();
    });

    it('freshness=NEW 过滤：只返回 25h 那件（过滤与取值同源同钟）', async () => {
      const response = await itemsGET(makeRequest('GET', '/api/items?freshness=NEW', { token }));
      expect(response.status).toBe(200);
      const json = (await response.json()) as ListEnvelope;
      expect(json.pagination.total).toBe(1);
      expect(json.data.map((item) => item.id)).toEqual([ids.newer]);
      expect(json.data[0]?.freshness.code).toBe('NEW');
    });

    it('q 子串匹配（name/description，ILIKE）：命中名称含关键词的那件', async () => {
      const response = await itemsGET(makeRequest('GET', '/api/items?q=老物件', { token }));
      const json = (await response.json()) as ListEnvelope;
      expect(json.pagination.total).toBe(1);
      expect(json.data.map((item) => item.id)).toEqual([ids.older]);
    });

    it("q='%' 按字面处理（转义）：只命中名称真带 '%' 的那件，绝不匹配全部", async () => {
      // 注意 URL 中 `%` 必须编码为 `%25`，否则会被解析成非法转义
      const response = await itemsGET(makeRequest('GET', '/api/items?q=%25', { token }));
      const json = (await response.json()) as ListEnvelope;
      expect(json.pagination.total).toBe(1);
      expect(json.data.map((item) => item.id)).toEqual([ids.percent]);
    });

    it("q='_' 按字面处理（转义）：无物品名含下划线 → 命中 0 件", async () => {
      const response = await itemsGET(makeRequest('GET', '/api/items?q=_', { token }));
      const json = (await response.json()) as ListEnvelope;
      expect(json.pagination.total).toBe(0);
      expect(json.data).toEqual([]);
    });

    it('favorite=true：只返回当前用户已收藏的物品', async () => {
      await insertFavorite(scope, 'fav-newer', fx.ownerId, ids.newer);
      const response = await itemsGET(makeRequest('GET', '/api/items?favorite=true', { token }));
      const json = (await response.json()) as ListEnvelope;
      expect(json.pagination.total).toBe(1);
      expect(json.data.map((item) => item.id)).toEqual([ids.newer]);

      // favorite=false / 缺省 → 不加过滤（返回全部 5 件）
      const unfiltered = await itemsGET(makeRequest('GET', '/api/items?favorite=false', { token }));
      const unfilteredJson = (await unfiltered.json()) as ListEnvelope;
      expect(unfilteredJson.pagination.total).toBe(5);
    });

    it('sort=oldest：按 publishedAt ASC 排序', async () => {
      const response = await itemsGET(makeRequest('GET', '/api/items?sort=oldest', { token }));
      const json = (await response.json()) as ListEnvelope;
      expect(json.data.map((item) => item.id)).toEqual([
        ids.older, // 100h
        ids.newer, // 25h
        ids.percent, // 10h
        ids.priced, // 5h
        ids.fresh, // 0h
      ]);
    });

    it('分页：pageSize=2&page=2 返回第 3、4 件，total 仍为总数', async () => {
      const response = await itemsGET(
        makeRequest('GET', '/api/items?pageSize=2&page=2', { token }),
      );
      const json = (await response.json()) as ListEnvelope;
      expect(json.pagination).toEqual({ page: 2, pageSize: 2, total: 5 });
      expect(json.data.map((item) => item.id)).toEqual([ids.percent, ids.newer]);
    });

    it('未登录 → 401 UNAUTHENTICATED', async () => {
      const response = await itemsGET(makeRequest('GET', '/api/items'));
      expect(response.status).toBe(401);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('UNAUTHENTICATED');
    });

    it('会话指向【非成员社区】→ 403（列表作用域只认会话）', async () => {
      // owner 只属甲；把 currentCommunityId 换成乙（签名仍合法）→ 成员校验失败
      const evilToken = mintSessionToken(fx.ownerId, fx.communityBId);
      const response = await itemsGET(makeRequest('GET', '/api/items', { token: evilToken }));
      expect(response.status).toBe(403);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('FORBIDDEN');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/items/:id
  // ---------------------------------------------------------------------------
  describe('GET /api/items/:id（详情）', () => {
    it('200：返回 ItemDetailDto，contactText 恒 null，viewer 关系标记正确（OWNER）', async () => {
      const response = await itemGET(makeRequest('GET', `/api/items/${ids.newer}`, { token }), {
        params: { id: ids.newer },
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: ItemDetailDto };
      expect(() => ItemDetailDtoSchema.parse(json.data)).not.toThrow();
      expect(json.data.contactText).toBeNull();
      expect(json.data.viewer.isOwner).toBe(true);
      expect(json.data.viewer.canClaim).toBe(false); // 发布者不可领取
      expect(json.data.images).toEqual([]);
    });

    it('列表与详情对同一 item 的 freshness 一致（ageHours 同源、code 恒等）', async () => {
      const listResponse = await itemsGET(makeRequest('GET', '/api/items', { token }));
      const list = (await listResponse.json()) as ListEnvelope;
      const listFreshness = list.data.find((item) => item.id === ids.older)?.freshness;
      expect(listFreshness?.code).toBe('OLDER');

      const detailResponse = await itemGET(
        makeRequest('GET', `/api/items/${ids.older}`, { token }),
        {
          params: { id: ids.older },
        },
      );
      const detail = (await detailResponse.json()) as { data: ItemDetailDto };
      expect(detail.data.freshness.code).toBe(listFreshness?.code);
      // 两次查询毫秒级相隔 → ageHours 差异极小（同一 now() 表达式，非应用时钟相减）
      expect(
        Math.abs((detail.data.freshness.ageHours ?? 0) - (listFreshness?.ageHours ?? 0)),
      ).toBeLessThan(0.05);
    });

    it('详情 price 为 JSON number（闭环 P3）', async () => {
      const response = await itemGET(makeRequest('GET', `/api/items/${ids.priced}`, { token }), {
        params: { id: ids.priced },
      });
      const json = (await response.json()) as { data: ItemDetailDto };
      expect(typeof json.data.price).toBe('number');
      expect(json.data.price).toBe(12.5);
    });

    it('跨社区详情 → 404（不泄漏存在性：itemB 属乙区，会话在甲区）', async () => {
      const response = await itemGET(
        makeRequest('GET', `/api/items/${ids.crossCommunity}`, { token }),
        { params: { id: ids.crossCommunity } },
      );
      expect(response.status).toBe(404);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('不存在的物品 → 404', async () => {
      const response = await itemGET(makeRequest('GET', '/api/items/no-such-item', { token }), {
        params: { id: 'no-such-item' },
      });
      expect(response.status).toBe(404);
    });

    it('未登录 → 401', async () => {
      const response = await itemGET(makeRequest('GET', `/api/items/${ids.newer}`), {
        params: { id: ids.newer },
      });
      expect(response.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // D2 索引命中（import 真实列表 SQL）
  // ---------------------------------------------------------------------------
  describe('D2 列表 SQL 复合索引命中', () => {
    it('真实列表 SQL 在规模下自然命中 Item_communityId_status_publishedAt_idx', async () => {
      const plan = await withRollbackTx(async (client) => {
        await client.query(
          `INSERT INTO "Community" ("id","name","inviteCode","createdAt","updatedAt")
           SELECT 'perf-c' || g, 'Perf ' || g, 'PERF-' || g, now(), now()
             FROM generate_series(1, 200) AS g`,
        );
        await client.query(
          `INSERT INTO "User" ("id","nickname","createdAt","updatedAt")
           VALUES ('perf-u1', 'perf', now(), now())`,
        );
        await client.query(
          `INSERT INTO "Item"
             ("id","communityId","ownerId","name","description","tradeType","price","status","publishedAt","createdAt","updatedAt")
           SELECT 'perf-i' || g, 'perf-c' || ((g % 200) + 1), 'perf-u1', 'n', 'd', 'FREE', NULL,
                  CASE WHEN g % 7 = 0 THEN 'ACTIVE' ELSE 'ARCHIVED' END::"ItemStatus",
                  now() - (g || ' seconds')::interval, now(), now()
             FROM generate_series(1, 40000) AS g`,
        );
        await client.query('ANALYZE "Item"');
        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN ${ITEM_LIST_SQL_LATEST}`,
          ['perf-c1', 'ACTIVE', null, null, null, null, null, 20, 0],
        );
        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });

      expect(plan).toMatch(/Index (Only )?(Backward )?Scan|Bitmap Index Scan/);
      expect(plan).toContain(INDEX_NAME);
    });
  });
});
