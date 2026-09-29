/**
 * 「我的」列表 / 通知 / 看板 / FAQ 归属 / 上传路由的真连库测试（契约 §6 / §7 / §8 / §3）。
 *
 * 覆盖：
 *   - `GET /api/me/items`：缺省含 `ARCHIVED`（「已归档可查看」）、`status` 过滤、非法值 400。
 *   - `GET /api/me/notifications?unreadOnly=`：倒序、未读过滤、100 上限由 SQL `LIMIT` 保证。
 *   - `POST /api/me/notifications/:id/read`：写 `readAt`、**幂等**（不刷新时间）、他人 404。
 *   - `GET /api/stats/community`：三项计数与**独立 SQL 复算一致**、`monthRange` 确实框住当前
 *     `Asia/Shanghai` 时间、`fastestItem` / `mostWantedItem` 的取值与空态、跨社区 403。
 *   - `POST /api/ai/faq`：非发布者 403（§8 权限例外）。
 *   - `POST /api/uploads`：201 落盘 + `{key,url}`、SVG 400、超限 413、未登录 401。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as faqPOST } from '@/app/api/ai/faq/route';
import { POST as uploadPOST } from '@/app/api/uploads/route';
import { GET as myItemsGET } from '@/app/api/me/items/route';
import { POST as readPOST } from '@/app/api/me/notifications/[id]/read/route';
import { GET as notificationsGET } from '@/app/api/me/notifications/route';
import { GET as statsGET } from '@/app/api/stats/community/route';
import { MAX_UPLOAD_BYTES, NotificationDtoSchema, StatsDtoSchema } from '@/shared/schemas';
import { prisma } from '@/server/db';
import { SESSION_COOKIE_NAME } from '@/server/auth/session';

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

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('我的列表 / 通知 / 看板 / FAQ 归属 / 上传（真连库）', () => {
  const scope = 'me-stats';
  let fx: TenantFixtures;
  let ownerToken: string;
  let dualToken: string;
  let uploadDir: string;
  let savedUploadDir: string | undefined;

  /** 夹具物品：3 件 ACTIVE（其中 1 件另作归档）+ 1 件 RESERVED。 */
  const items = {
    active1: '',
    active2: '',
    toArchive: '',
    reserved: '',
  };

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    savedUploadDir = process.env.UPLOAD_DIR;
    uploadDir = await mkdtemp(path.join(tmpdir(), 'cr-itest-uploads-'));
    process.env.UPLOAD_DIR = uploadDir;

    fx = await createTenantFixtures(scope);
    ownerToken = mintSessionToken(fx.ownerId, fx.communityAId);
    dualToken = mintSessionToken(fx.dualId, fx.communityAId);

    const A = fx.communityAId;
    const O = fx.ownerId;
    items.active1 = await insertItem(scope, { key: 'm-active1', communityId: A, ownerId: O });
    items.active2 = await insertItem(scope, { key: 'm-active2', communityId: A, ownerId: O });
    items.toArchive = await insertItem(scope, { key: 'm-arch', communityId: A, ownerId: O });
    items.reserved = await insertItem(scope, {
      key: 'm-reserved',
      communityId: A,
      ownerId: O,
      status: 'RESERVED',
    });
    await pool.query(`UPDATE "Item" SET status='ARCHIVED', "archivedAt"=now() WHERE id=$1`, [
      items.toArchive,
    ]);
  });

  afterAll(async () => {
    if (savedUploadDir === undefined) {
      delete process.env.UPLOAD_DIR;
    } else {
      process.env.UPLOAD_DIR = savedUploadDir;
    }
    await rm(uploadDir, { recursive: true, force: true });
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  // ---------------------------------------------------------------------------
  // §6 GET /api/me/items
  // ---------------------------------------------------------------------------

  it('缺省 status：三态全返回（含已归档），且只含自己发布的', async () => {
    const response = await myItemsGET(makeRequest('GET', '/api/me/items', { token: ownerToken }));
    expect(response.status).toBe(200);
    const body = await json<DataEnvelope<{ id: string; status: string }[]>>(response);
    const ids = body.data.map((row) => row.id);

    expect(ids).toContain(items.active1);
    expect(ids).toContain(items.reserved);
    expect(ids).toContain(items.toArchive);

    // 同社区的非发布者：自己的列表里没有别人的物品。
    const asStranger = await myItemsGET(
      makeRequest('GET', '/api/me/items', {
        token: mintSessionToken(fx.strangerId, fx.communityAId),
      }),
    );
    const strangerBody = await json<DataEnvelope<{ id: string }[]>>(asStranger);
    expect(strangerBody.data.map((row) => row.id)).not.toContain(items.active1);
  });

  it('status=ARCHIVED 只回已归档；非法值 400', async () => {
    const filtered = await myItemsGET(
      makeRequest('GET', '/api/me/items?status=ARCHIVED', { token: ownerToken }),
    );
    const body = await json<DataEnvelope<{ id: string; status: string }[]>>(filtered);
    expect(body.data.map((row) => row.id)).toContain(items.toArchive);
    expect(body.data.every((row) => row.status === 'ARCHIVED')).toBe(true);

    const bad = await myItemsGET(
      makeRequest('GET', '/api/me/items?status=NOPE', { token: ownerToken }),
    );
    expect(bad.status).toBe(400);
    expect((await json<{ error: { code: string } }>(bad)).error.code).toBe('INVALID_INPUT');
  });

  // ---------------------------------------------------------------------------
  // §6 通知
  // ---------------------------------------------------------------------------

  async function insertNotification(
    id: string,
    userId: string,
    readAt: string | null,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO "Notification" ("id","userId","type","title","content","readAt","createdAt")
       VALUES ($1, $2, 'CLAIM_RECEIVED', '收到新的领取申请', $3, $4, now())`,
      [id, userId, `集成测试通知-${id}`, readAt],
    );
  }

  it('GET 列表按 createdAt 倒序；unreadOnly=true 只看未读', async () => {
    await insertNotification(`${fx.scopePrefix}n-1`, fx.ownerId, null);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await insertNotification(`${fx.scopePrefix}n-2`, fx.ownerId, null);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await insertNotification(`${fx.scopePrefix}n-3`, fx.ownerId, new Date().toISOString());
    await insertNotification(`${fx.scopePrefix}n-4`, fx.dualId, null);

    const all = await notificationsGET(
      makeRequest('GET', '/api/me/notifications', { token: ownerToken }),
    );
    expect(all.status).toBe(200);
    const allBody = await json<DataEnvelope<unknown[]>>(all);
    const dtos = allBody.data.map((row) => NotificationDtoSchema.parse(row));
    expect(dtos.length).toBeGreaterThanOrEqual(3);
    expect(dtos.every((row) => row.type === 'CLAIM_RECEIVED')).toBe(true);
    // 倒序：第一条必是最后写入的已读那条。
    expect(dtos[0]?.id).toBe(`${fx.scopePrefix}n-3`);

    const unread = await notificationsGET(
      makeRequest('GET', '/api/me/notifications?unreadOnly=true', { token: ownerToken }),
    );
    const unreadBody = await json<DataEnvelope<{ id: string; readAt: string | null }[]>>(unread);
    expect(unreadBody.data.every((row) => row.readAt === null)).toBe(true);
    // 他人的通知绝不出现在我的列表里。
    expect(unreadBody.data.map((row) => row.id)).not.toContain(`${fx.scopePrefix}n-4`);
  });

  it('POST 标记已读：写入 readAt 且幂等（不刷新）；他人通知 404；未登录 401', async () => {
    const target = `${fx.scopePrefix}n-1`;
    const first = await readPOST(
      makeRequest('POST', `/api/me/notifications/${target}/read`, { token: ownerToken }),
      { params: Promise.resolve({ id: target }) },
    );
    expect(first.status).toBe(200);
    const dto = NotificationDtoSchema.parse((await json<DataEnvelope<unknown>>(first)).data);
    expect(dto.id).toBe(target);
    expect(dto.readAt).not.toBeNull();

    const again = await readPOST(
      makeRequest('POST', `/api/me/notifications/${target}/read`, { token: ownerToken }),
      { params: Promise.resolve({ id: target }) },
    );
    const againDto = NotificationDtoSchema.parse((await json<DataEnvelope<unknown>>(again)).data);
    expect(againDto.readAt).toBe(dto.readAt);

    const foreign = await readPOST(
      makeRequest('POST', `/api/me/notifications/${fx.scopePrefix}n-4/read`, {
        token: ownerToken,
      }),
      { params: Promise.resolve({ id: `${fx.scopePrefix}n-4` }) },
    );
    expect(foreign.status).toBe(404);

    const anon = await readPOST(makeRequest('POST', `/api/me/notifications/${target}/read`), {
      params: Promise.resolve({ id: target }),
    });
    expect(anon.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // §7 看板
  // ---------------------------------------------------------------------------

  it('三项计数与独立 SQL 复算一致，monthRange 框住当前上海时间', async () => {
    const response = await statsGET(
      makeRequest('GET', '/api/stats/community', { token: ownerToken }),
    );
    expect(response.status).toBe(200);
    const stats = StatsDtoSchema.parse((await json<DataEnvelope<unknown>>(response)).data);

    const bounds = await pool.query<{ start: string; end: string }>(
      `SELECT $1::timestamptz AS start, $2::timestamptz AS end`,
      [stats.monthRange.start, stats.monthRange.end],
    );
    const start = new Date(String(bounds.rows[0]?.start)).getTime();
    const end = new Date(String(bounds.rows[0]?.end)).getTime();
    const now = Date.now();
    expect(start).toBeLessThanOrEqual(now);
    expect(end).toBeGreaterThan(now);
    // 月初对齐：`+08:00` 口径下 start 的本地日期恒为 1 日 00:00。
    expect(stats.monthRange.start).toMatch(/-01T00:00:00\+08:00$/);
    expect(stats.timezone).toBe('Asia/Shanghai');

    const expected = await pool.query<{
      published: number;
      completed: number;
      active: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "Item" i
           WHERE i."communityId" = $1 AND i."publishedAt" >= $2 AND i."publishedAt" < $3) AS published,
         (SELECT COUNT(*)::int FROM "ClaimRequest" c
           JOIN "Item" i ON i.id = c."itemId"
          WHERE i."communityId" = $1 AND c.status = 'COMPLETED'
            AND c."completedAt" >= $2 AND c."completedAt" < $3) AS completed,
         (SELECT COUNT(*)::int FROM "Item" i
           WHERE i."communityId" = $1 AND i.status = 'ACTIVE') AS active`,
      [fx.communityAId, stats.monthRange.start, stats.monthRange.end],
    );
    expect(stats.monthPublished).toBe(expected.rows[0]?.published);
    expect(stats.monthCompleted).toBe(expected.rows[0]?.completed);
    expect(stats.activeCount).toBe(expected.rows[0]?.active);
    // 夹具里有 2 件 ACTIVE（`toArchive` 已归档、`reserved` 为 RESERVED）+ 租户夹具的 itemA。
    expect(stats.activeCount).toBeGreaterThanOrEqual(3);
  });

  it('fastestItem / mostWantedItem：有数据时取极值，无数据时为 null', async () => {
    // 成交：active1 发布 2 小时前、30 分钟前完成 → 150 分钟；active2 完成用时 600 分钟。
    await pool.query(
      `INSERT INTO "ClaimRequest"
         ("id","itemId","applicantId","message","status","createdAt","updatedAt","acceptedAt","completedAt")
       VALUES ($1, $2, $3, '集成测试-成交', 'COMPLETED', now(), now(), now() - interval '40 minutes',
               now() - interval '30 minutes')`,
      [`${fx.scopePrefix}c-fast`, items.active1, fx.dualId],
    );
    await pool.query(
      `UPDATE "Item" SET "publishedAt" = now() - interval '10 hours' WHERE id = $1`,
      [items.active1],
    );
    // 最想要：active2 有 2 条 PENDING 且无 COMPLETED、非归档 ⇒ 冠军。
    await pool.query(
      `INSERT INTO "ClaimRequest"
         ("id","itemId","applicantId","message","status","createdAt","updatedAt")
       VALUES ($1, $2, $3, '集成测试-意向', 'PENDING', now(), now()),
              ($4, $2, $5, '集成测试-意向2', 'PENDING', now(), now())`,
      [`${fx.scopePrefix}c-w1`, items.active2, fx.dualId, `${fx.scopePrefix}c-w2`, fx.strangerId],
    );

    const response = await statsGET(
      makeRequest('GET', '/api/stats/community', { token: ownerToken }),
    );
    const stats = StatsDtoSchema.parse((await json<DataEnvelope<unknown>>(response)).data);

    expect(stats.fastestItem?.id).toBe(items.active1);
    expect(stats.fastestItem?.durationMinutes).toBe(570); // 10h - 30min
    expect(stats.mostWantedItem?.id).toBe(items.active2);
    expect(stats.mostWantedItem?.wantCount).toBe(2);
  });

  it('空态：新社区无成交/无意向 → 两个 null 且计数为 0', async () => {
    const lonely = mintSessionToken(fx.dualId, fx.communityBId);
    const response = await statsGET(makeRequest('GET', '/api/stats/community', { token: lonely }));
    const stats = StatsDtoSchema.parse((await json<DataEnvelope<unknown>>(response)).data);
    // 乙区只有租户夹具的 itemB（ACTIVE、刚发布）。
    expect(stats.monthPublished).toBe(1);
    expect(stats.monthCompleted).toBe(0);
    expect(stats.activeCount).toBe(1);
    expect(stats.fastestItem).toBeNull();
    expect(stats.mostWantedItem).toBeNull();
  });

  it('多租户：显式传入他人 communityId → 403', async () => {
    const response = await statsGET(
      makeRequest('GET', `/api/stats/community?communityId=${fx.communityBId}`, {
        token: ownerToken,
      }),
    );
    expect(response.status).toBe(403);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe('FORBIDDEN');
  });

  // ---------------------------------------------------------------------------
  // §8 FAQ 归属
  // ---------------------------------------------------------------------------

  it('FAQ：非发布者 403，发布者才进入生成链路（§8 权限例外）', async () => {
    const denied = await faqPOST(
      makeRequest('POST', '/api/ai/faq', {
        token: dualToken,
        body: { itemId: items.active1, question: '还在吗？' },
      }),
    );
    expect(denied.status).toBe(403);
    expect((await json<{ error: { code: string } }>(denied)).error.code).toBe('FORBIDDEN');

    const missing = await faqPOST(
      makeRequest('POST', '/api/ai/faq', {
        token: ownerToken,
        body: { itemId: 'no-such-item', question: '还在吗？' },
      }),
    );
    expect(missing.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // §3 上传
  // ---------------------------------------------------------------------------

  function uploadRequest(token: string | undefined, file: File): Request {
    const form = new FormData();
    form.set('file', file);
    const headers = new Headers();
    if (token !== undefined) {
      headers.set('cookie', `${SESSION_COOKIE_NAME}=${token}`);
    }
    return new Request('http://localhost/api/uploads', {
      method: 'POST',
      headers,
      body: form,
    });
  }

  it('POST /api/uploads：PNG 落盘并返回 {key,url}', async () => {
    const response = await uploadPOST(
      uploadRequest(ownerToken, new File([new Uint8Array(64)], 'p.png', { type: 'image/png' })),
    );
    expect(response.status).toBe(201);
    const body = await json<DataEnvelope<{ key: string; url: string }>>(response);
    expect(body.data.key).toMatch(/\.png$/);
    expect(body.data.url).toBe(`/uploads/${body.data.key}`);
    expect(await readdir(uploadDir)).toEqual([body.data.key]);
  });

  it('POST /api/uploads：SVG → 400、超限 → 413、未登录 → 401', async () => {
    const svgResponse = await uploadPOST(
      uploadRequest(ownerToken, new File([new Uint8Array(8)], 'x.svg', { type: 'image/svg+xml' })),
    );
    expect(svgResponse.status).toBe(400);
    expect((await json<{ error: { code: string } }>(svgResponse)).error.code).toBe('INVALID_INPUT');

    const big = await uploadPOST(
      uploadRequest(
        ownerToken,
        new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' }),
      ),
    );
    expect(big.status).toBe(413);
    expect((await json<{ error: { code: string } }>(big)).error.code).toBe('PAYLOAD_TOO_LARGE');

    const anon = await uploadPOST(
      uploadRequest(undefined, new File([new Uint8Array(8)], 'p.jpg', { type: 'image/jpeg' })),
    );
    expect(anon.status).toBe(401);
  });
});
