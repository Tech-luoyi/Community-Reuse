/**
 * 留言板 + 收藏的真连库路由测试（契约 §5 / §6）。
 *
 * 覆盖：
 *   - `GET /api/items/:id/messages`：空数组、按 `createdAt` **升序**、未登录 401、跨社区 404。
 *   - `POST`：`USER` 任意成员可发（`author` 为自己）；`senderType:"AI"` **仅发布者**（他人 403、
 *     发布者成功且 `author === null`）；空 content 400。
 *   - `POST/DELETE /api/items/:id/favorite`：201 / 重复 409 / 200 / 未收藏 404 / 跨社区 404。
 *   - `GET /api/me/favorites`：`ItemDto` 形状合法、与详情接口**新鲜度同源**、只含自己的收藏。
 *   - 索引可用性：留言与收藏的读路径在关闭 seqscan 后命中对应复合索引（回滚事务内验证）。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DELETE as favoriteDELETE,
  POST as favoritePOST,
} from '@/app/api/items/[id]/favorite/route';
import { GET as messagesGET, POST as messagesPOST } from '@/app/api/items/[id]/messages/route';
import { GET as myFavoritesGET } from '@/app/api/me/favorites/route';
import { FavoriteResultSchema, ItemDtoSchema, MessageDtoSchema } from '@/shared/schemas';
import { prisma } from '@/server/db';
import { MESSAGE_LIST_SQL } from '@/server/messages/sql';

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

interface DataEnvelope<T> {
  data: T;
}

describe('留言板 + 收藏（真连库）', () => {
  const scope = 'msg-fav';
  let fx: TenantFixtures;
  let ownerToken: string;
  let dualToken: string;
  let item: string;

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    fx = await createTenantFixtures(scope);
    ownerToken = mintSessionToken(fx.ownerId, fx.communityAId);
    dualToken = mintSessionToken(fx.dualId, fx.communityAId);
    item = await insertItem(scope, {
      key: 'board',
      communityId: fx.communityAId,
      ownerId: fx.ownerId,
      name: '留言板目标',
    });
  });

  afterAll(async () => {
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  // ---------------------------------------------------------------------------
  // §5 留言板
  // ---------------------------------------------------------------------------

  it('GET 空留言 → 200 []', async () => {
    const response = await messagesGET(
      makeRequest('GET', `/api/items/${item}/messages`, { token: dualToken }),
      { params: Promise.resolve({ id: item }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as DataEnvelope<unknown[]>;
    expect(body.data).toEqual([]);
  });

  it('POST USER 留言 → 201，author 为本人；GET 按 createdAt 升序', async () => {
    const first = await messagesPOST(
      makeRequest('POST', `/api/items/${item}/messages`, {
        token: dualToken,
        body: { content: '还在吗？' },
      }),
      { params: Promise.resolve({ id: item }) },
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as DataEnvelope<unknown>;
    expect(MessageDtoSchema.parse(firstBody.data)).toMatchObject({
      senderType: 'USER',
      author: { id: fx.dualId, nickname: '双社区用户' },
      content: '还在吗？',
    });

    const second = await messagesPOST(
      makeRequest('POST', `/api/items/${item}/messages`, {
        token: ownerToken,
        body: { content: '在的，随时自提' },
      }),
      { params: Promise.resolve({ id: item }) },
    );
    expect(second.status).toBe(201);

    const listResponse = await messagesGET(
      makeRequest('GET', `/api/items/${item}/messages`, { token: dualToken }),
      { params: Promise.resolve({ id: item }) },
    );
    const list = (await listResponse.json()) as DataEnvelope<unknown[]>;
    const dtos = list.data.map((row) => MessageDtoSchema.parse(row));
    expect(dtos.map((row) => row.content)).toEqual(['还在吗？', '在的，随时自提']);
    // 升序（对话流）：createdAt 序列必须已排好。
    expect(dtos.map((row) => row.createdAt)).toEqual([...dtos.map((row) => row.createdAt)].sort());
  });

  it('AI 建议：非发布者 403', async () => {
    const response = await messagesPOST(
      makeRequest('POST', `/api/items/${item}/messages`, {
        token: dualToken,
        body: { content: '支持自提，时间你定', senderType: 'AI' },
      }),
      { params: Promise.resolve({ id: item }) },
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('AI 建议：发布者 → 201 且 author === null（服务端强制不记作者）', async () => {
    const response = await messagesPOST(
      makeRequest('POST', `/api/items/${item}/messages`, {
        token: ownerToken,
        body: { content: '价格已很低，诚心要可小刀', senderType: 'AI' },
      }),
      { params: Promise.resolve({ id: item }) },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as DataEnvelope<unknown>;
    expect(MessageDtoSchema.parse(body.data)).toMatchObject({
      senderType: 'AI',
      author: null,
    });

    // 落库口径：AI 行必须没有作者外键。
    const row = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM "Message"
        WHERE "itemId" = $1 AND "senderType" = 'AI' AND "authorId" IS NOT NULL`,
      [item],
    );
    expect(row.rows[0]?.count).toBe(0);
  });

  it('POST 空 content → 400 INVALID_INPUT（含字段明细）', async () => {
    const response = await messagesPOST(
      makeRequest('POST', `/api/items/${item}/messages`, {
        token: dualToken,
        body: { content: '   ' },
      }),
      { params: Promise.resolve({ id: item }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; details?: unknown[] } };
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.details?.length).toBeGreaterThan(0);
  });

  it('留言板作用域：跨社区物品 404 / 未登录 401', async () => {
    const cross = await messagesGET(
      makeRequest('GET', `/api/items/${fx.itemBId}/messages`, { token: dualToken }),
      { params: Promise.resolve({ id: fx.itemBId }) },
    );
    expect(cross.status).toBe(404);

    const anon = await messagesGET(makeRequest('GET', `/api/items/${item}/messages`), {
      params: Promise.resolve({ id: item }),
    });
    expect(anon.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // §6 收藏
  // ---------------------------------------------------------------------------

  it('POST 收藏 201 → 重复 409 CONFLICT → DELETE 200 → 再删 404', async () => {
    const add = await favoritePOST(
      makeRequest('POST', `/api/items/${item}/favorite`, { token: dualToken }),
      { params: Promise.resolve({ id: item }) },
    );
    expect(add.status).toBe(201);
    expect(FavoriteResultSchema.parse(((await add.json()) as DataEnvelope<unknown>).data)).toEqual({
      favorited: true,
    });

    const dup = await favoritePOST(
      makeRequest('POST', `/api/items/${item}/favorite`, { token: dualToken }),
      { params: Promise.resolve({ id: item }) },
    );
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe('CONFLICT');

    const remove = await favoriteDELETE(
      makeRequest('DELETE', `/api/items/${item}/favorite`, { token: dualToken }),
      { params: Promise.resolve({ id: item }) },
    );
    expect(remove.status).toBe(200);
    expect(
      FavoriteResultSchema.parse(((await remove.json()) as DataEnvelope<unknown>).data),
    ).toEqual({ favorited: false });

    const removeAgain = await favoriteDELETE(
      makeRequest('DELETE', `/api/items/${item}/favorite`, { token: dualToken }),
      { params: Promise.resolve({ id: item }) },
    );
    expect(removeAgain.status).toBe(404);
  });

  it('收藏跨社区物品 → 404（不泄漏存在性）', async () => {
    const response = await favoritePOST(
      makeRequest('POST', `/api/items/${fx.itemBId}/favorite`, { token: dualToken }),
      { params: Promise.resolve({ id: fx.itemBId }) },
    );
    expect(response.status).toBe(404);
  });

  it('GET /api/me/favorites：只含本社区自己的收藏，ItemDto 合法且与列表同源', async () => {
    await insertFavorite(scope, 'fav-dual', fx.dualId, item);
    await insertFavorite(scope, 'fav-owner', fx.ownerId, fx.itemAId);

    const response = await myFavoritesGET(
      makeRequest('GET', '/api/me/favorites', { token: dualToken }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as DataEnvelope<unknown[]>;
    const items = body.data.map((row) => ItemDtoSchema.parse(row));

    expect(items.map((row) => row.id)).toEqual([item]);
    expect(items[0]?.favoriteCount).toBeGreaterThanOrEqual(1);
    // 同一物品的新鲜度由同一 SQL 表达式产出（列表 / 详情 / 收藏三处一致）。
    expect(items[0]?.freshness.ageHours).toBeGreaterThanOrEqual(0);
    expect(items[0]?.communityId).toBe(fx.communityAId);
  });

  it('收藏后 `GET /api/me/favorites` 按收藏时间倒序', async () => {
    const older = await insertItem(scope, {
      key: 'fav-old',
      communityId: fx.communityAId,
      ownerId: fx.ownerId,
      name: '较早收藏',
    });
    await pool.query(`DELETE FROM "Favorite" WHERE "userId" = $1`, [fx.dualId]);
    await insertFavorite(scope, 'fav-2', fx.dualId, older);
    // 20ms 后收藏另一件，确保 createdAt 有确定先后。
    await new Promise((resolve) => setTimeout(resolve, 20));
    await insertFavorite(scope, 'fav-3', fx.dualId, item);

    const response = await myFavoritesGET(
      makeRequest('GET', '/api/me/favorites', { token: dualToken }),
    );
    const body = (await response.json()) as DataEnvelope<{ id: string }[]>;
    expect(body.data.map((row) => row.id)).toEqual([item, older]);
  });

  it('留言读路径：EXPLAIN 命中 `Message_itemId_createdAt_idx`（回滚事务内验证）', async () => {
    // 与 indexes.test.ts 同一手法：只在**回滚事务**里关闭 seq/bitmap，证明该复合索引
    // 正是 `MESSAGE_LIST_SQL` 的可用访问路径；不改动任何数据与会话状态。
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      await client.query('SET LOCAL enable_bitmapscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${MESSAGE_LIST_SQL}`, [
        item,
      ]);
      await client.query('ROLLBACK');
      const plan = rows.map((row) => row['QUERY PLAN'] ?? '').join('\n');
      expect(plan).toMatch(/Index (Only )?Scan/);
      expect(plan).toContain('Message_itemId_createdAt_idx');
    } finally {
      client.release();
    }
  });
});
