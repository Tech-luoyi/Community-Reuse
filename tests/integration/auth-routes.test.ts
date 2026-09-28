/**
 * 鉴权 / 多租户 / me 的**真连库路由级测试**：直接调用真实的 Route Handler，
 * 用构造的 `Request`（含真实签名的会话 Cookie）驱动，断言 HTTP 状态 + 信封 + DB 落库。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as joinPOST } from '@/app/api/auth/join/route';
import { POST as logoutPOST } from '@/app/api/auth/logout/route';
import { POST as switchPOST } from '@/app/api/auth/switch/route';
import { GET as meGET, PATCH as mePATCH } from '@/app/api/me/route';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/server/auth/session';
import { prisma } from '@/server/db';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
  mintSessionToken,
  pool,
} from './helpers/db';

const BASE = 'http://localhost';

interface RequestInitLike {
  body?: unknown;
  /** 明文会话令牌（会被写成 `cr_session=<token>` Cookie）。 */
  token?: string;
  /** 直接设置 cookie 头（用于伪造 / 篡改场景）。 */
  cookieHeader?: string;
}

function makeRequest(method: string, path: string, init: RequestInitLike = {}): Request {
  const headers = new Headers();
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (init.cookieHeader !== undefined) {
    headers.set('cookie', init.cookieHeader);
  } else if (init.token !== undefined) {
    headers.set('cookie', `${SESSION_COOKIE_NAME}=${init.token}`);
  }
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** 从响应头取指定 Set-Cookie 的原始值（未解码）。 */
function setCookieRaw(response: Response, name: string): string | undefined {
  const header = response.headers.get('set-cookie');
  if (!header) {
    return undefined;
  }
  const match = header.match(new RegExp(`${name}=([^;]*)`));
  return match?.[1];
}

describe('鉴权路由 + 多租户 + me（真连库）', () => {
  const scope = 'routes';
  let fx: TenantFixtures;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    fx = await createTenantFixtures(scope);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await pool.query(`DELETE FROM "User" WHERE "id" = ANY($1)`, [createdUserIds]);
    }
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/join
  // ---------------------------------------------------------------------------
  describe('POST /api/auth/join', () => {
    it('有效邀请码 → 201，建用户+成员，并下发 HttpOnly 会话 Cookie', async () => {
      const response = await joinPOST(
        makeRequest('POST', '/api/auth/join', {
          body: { inviteCode: `${fx.scopePrefix}inviteA`, nickname: '新加入的邻居' },
        }),
      );
      expect(response.status).toBe(201);
      const json = (await response.json()) as {
        data: {
          user: { id: string; nickname: string };
          community: { id: string; name: string };
          memberships: { communityId: string }[];
        };
      };
      expect(json.data.user.nickname).toBe('新加入的邻居');
      expect(json.data.community.id).toBe(fx.communityAId);
      expect(json.data.memberships).toEqual([{ communityId: fx.communityAId }]);
      createdUserIds.push(json.data.user.id);

      const rawCookie = setCookieRaw(response, SESSION_COOKIE_NAME);
      expect(rawCookie).toBeDefined();
      const header = response.headers.get('set-cookie') ?? '';
      expect(header).toContain('HttpOnly');
      expect(header.toLowerCase()).toContain('samesite=lax');

      const session = verifySessionToken(
        rawCookie === undefined ? null : decodeURIComponent(rawCookie),
      );
      expect(session).toEqual({
        userId: json.data.user.id,
        currentCommunityId: fx.communityAId,
      });

      const membership = await pool.query(
        `SELECT 1 FROM "CommunityMember" WHERE "communityId" = $1 AND "userId" = $2`,
        [fx.communityAId, json.data.user.id],
      );
      expect(membership.rowCount).toBe(1);
    });

    it('邀请码无效 → 404 NOT_FOUND', async () => {
      const response = await joinPOST(
        makeRequest('POST', '/api/auth/join', {
          body: { inviteCode: 'NO-SUCH-CODE', nickname: '路人' },
        }),
      );
      expect(response.status).toBe(404);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('昵称为空 → 400 INVALID_INPUT', async () => {
      const response = await joinPOST(
        makeRequest('POST', '/api/auth/join', {
          body: { inviteCode: `${fx.scopePrefix}inviteA`, nickname: '' },
        }),
      );
      expect(response.status).toBe(400);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('INVALID_INPUT');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/me
  // ---------------------------------------------------------------------------
  describe('GET /api/me', () => {
    it('合法会话 → 200 返回 user / memberships / currentCommunity', async () => {
      const token = mintSessionToken(fx.ownerId, fx.communityAId);
      const response = await meGET(makeRequest('GET', '/api/me', { token }));
      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        data: {
          user: { id: string; contactText: string | null };
          memberships: { communityId: string }[];
          currentCommunity: { id: string };
        };
      };
      expect(json.data.user.id).toBe(fx.ownerId);
      expect(json.data.user.contactText).toBe('微信 owner-contact');
      expect(json.data.memberships).toEqual([{ communityId: fx.communityAId }]);
      expect(json.data.currentCommunity.id).toBe(fx.communityAId);
    });

    it('无 Cookie → 401 UNAUTHENTICATED', async () => {
      const response = await meGET(makeRequest('GET', '/api/me'));
      expect(response.status).toBe(401);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('UNAUTHENTICATED');
    });

    it('被篡改的 Cookie → 401（不得因 userId 合法而放行）', async () => {
      const token = mintSessionToken(fx.ownerId, fx.communityAId);
      const response = await meGET(
        makeRequest('GET', '/api/me', { cookieHeader: `${SESSION_COOKIE_NAME}=${token}TAMPER` }),
      );
      expect(response.status).toBe(401);
    });

    it('合法签名但会话指向【非成员社区】→ 403（红线在真实路由上也守得住）', async () => {
      // owner 只属于甲；把 currentCommunityId 伪造成乙（签名仍合法）→ 成员校验失败
      const token = mintSessionToken(fx.ownerId, fx.communityBId);
      const response = await meGET(makeRequest('GET', '/api/me', { token }));
      expect(response.status).toBe(403);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('合法签名但会话指向【不存在的社区】→ 403（不得打成 500）', async () => {
      const token = mintSessionToken(fx.ownerId, `${fx.scopePrefix}ghost-community`);
      const response = await meGET(makeRequest('GET', '/api/me', { token }));
      expect(response.status).toBe(403);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('FORBIDDEN');
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/me（D1 唯一写入口）
  // ---------------------------------------------------------------------------
  describe('PATCH /api/me', () => {
    it('设置 contactText → 回显一致且落库', async () => {
      const token = mintSessionToken(fx.ownerId, fx.communityAId);
      const response = await mePATCH(
        makeRequest('PATCH', '/api/me', { token, body: { contactText: '微信 新联系方式' } }),
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: { user: { contactText: string | null } } };
      expect(json.data.user.contactText).toBe('微信 新联系方式');

      const row = await pool.query<{ contactText: string | null }>(
        `SELECT "contactText" FROM "User" WHERE "id" = $1`,
        [fx.ownerId],
      );
      expect(row.rows[0]?.contactText).toBe('微信 新联系方式');
    });

    it('传空串 → 归一化为 null（清空）', async () => {
      const token = mintSessionToken(fx.ownerId, fx.communityAId);
      const response = await mePATCH(
        makeRequest('PATCH', '/api/me', { token, body: { contactText: '' } }),
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: { user: { contactText: string | null } } };
      expect(json.data.user.contactText).toBeNull();

      const row = await pool.query<{ contactText: string | null }>(
        `SELECT "contactText" FROM "User" WHERE "id" = $1`,
        [fx.ownerId],
      );
      expect(row.rows[0]?.contactText).toBeNull();
    });

    it('可同时更新 nickname 与 contactText', async () => {
      const token = mintSessionToken(fx.ownerId, fx.communityAId);
      const response = await mePATCH(
        makeRequest('PATCH', '/api/me', {
          token,
          body: { nickname: '甲-发布者(改名)', contactText: '微信 again' },
        }),
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        data: { user: { nickname: string; contactText: string | null } };
      };
      expect(json.data.user.nickname).toBe('甲-发布者(改名)');
      expect(json.data.user.contactText).toBe('微信 again');
    });

    it('contactText 恰 120 个中文字符 → 200 且回读一致（PG VarChar 按字符计，非字节）', async () => {
      const token = mintSessionToken(fx.ownerId, fx.communityAId);
      const value = '微'.repeat(120);
      const response = await mePATCH(
        makeRequest('PATCH', '/api/me', { token, body: { contactText: value } }),
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: { user: { contactText: string | null } } };
      expect(json.data.user.contactText).toBe(value);

      const row = await pool.query<{ contactText: string | null }>(
        `SELECT "contactText" FROM "User" WHERE "id" = $1`,
        [fx.ownerId],
      );
      expect(row.rows[0]?.contactText).toBe(value);
      expect(value).toHaveLength(120);
    });

    it('contactText 超长（>120）→ 4xx 校验失败（契约映射为 400 INVALID_INPUT）', async () => {
      const token = mintSessionToken(fx.ownerId, fx.communityAId);
      const response = await mePATCH(
        makeRequest('PATCH', '/api/me', { token, body: { contactText: 'a'.repeat(121) } }),
      );
      // 契约 §0.2：Zod 校验失败 = 400 INVALID_INPUT（注：任务描述写的是 422，与契约不一致，按契约实现）
      expect(response.status).toBe(400);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('未登录 → 401', async () => {
      const response = await mePATCH(
        makeRequest('PATCH', '/api/me', { body: { contactText: 'x' } }),
      );
      expect(response.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/switch
  // ---------------------------------------------------------------------------
  describe('POST /api/auth/switch', () => {
    it('切到自己所属的社区 → 200，并重签会话 Cookie（当前社区随之改变）', async () => {
      const token = mintSessionToken(fx.dualId, fx.communityAId);
      const response = await switchPOST(
        makeRequest('POST', '/api/auth/switch', { token, body: { communityId: fx.communityBId } }),
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: { community: { id: string } } };
      expect(json.data.community.id).toBe(fx.communityBId);

      const raw = setCookieRaw(response, SESSION_COOKIE_NAME);
      const session = verifySessionToken(raw === undefined ? null : decodeURIComponent(raw));
      expect(session).toEqual({ userId: fx.dualId, currentCommunityId: fx.communityBId });
    });

    it('切换到「自己不是成员」的社区 → 403（不泄漏该社区是否存在）', async () => {
      const token = mintSessionToken(fx.ownerId, fx.communityAId);
      const response = await switchPOST(
        makeRequest('POST', '/api/auth/switch', { token, body: { communityId: fx.communityBId } }),
      );
      expect(response.status).toBe(403);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('未登录 → 401', async () => {
      const response = await switchPOST(
        makeRequest('POST', '/api/auth/switch', { body: { communityId: fx.communityBId } }),
      );
      expect(response.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/logout
  // ---------------------------------------------------------------------------
  describe('POST /api/auth/logout', () => {
    it('登出 → 200 { ok:true }，并清除会话 Cookie（Max-Age=0 / 空值）', async () => {
      const token = mintSessionToken(fx.ownerId, fx.communityAId);
      const response = await logoutPOST(makeRequest('POST', '/api/auth/logout', { token }));
      expect(response.status).toBe(200);
      const json = (await response.json()) as { data: { ok: boolean } };
      expect(json.data.ok).toBe(true);
      const header = response.headers.get('set-cookie') ?? '';
      expect(header).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(header.toLowerCase()).toContain('max-age=0');
    });
  });
});
