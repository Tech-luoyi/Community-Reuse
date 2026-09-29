/**
 * 领取申请**提交 / 查询 / 联系方式可见性**的真连库路由测试（契约 §4）。
 *
 * 覆盖：
 *   - `POST /api/items/:id/claims`：201（含 `CLAIM_RECEIVED` 通知）、重复提交 409、
 *     发布者申请自己 403、非 ACTIVE 409、跨社区 404、未登录 401、超长/非法字段 400。
 *   - `GET /api/items/:id/claims`：OWNER 看全部、非 owner 申请人只看自己、第三人 403。
 *   - `GET /api/me/claims?as=applied|received`：两条路径 + 缺省 applied。
 *   - `contactText`：`PENDING` 双方 null；`ACCEPTED` 后各自看到**对方**联系方式。
 *
 * 门控：需 `RUN_INTEGRATION=1`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as itemClaimsGET, POST as claimPOST } from '@/app/api/items/[id]/claims/route';
import { GET as meClaimsGET } from '@/app/api/me/claims/route';
import { POST as acceptPOST } from '@/app/api/claims/[id]/accept/route';
import { prisma } from '@/server/db';
import { ClaimDtoSchema } from '@/shared/schemas';
import type { ClaimDto } from '@/shared/types';

import {
  type TenantFixtures,
  cleanupFixtures,
  closePool,
  createTenantFixtures,
  insertClaim,
  insertItem,
  mintSessionToken,
  pool,
} from './helpers/db';
import { makeRequest } from './helpers/http';

interface DataEnvelope<T> {
  data: T;
}

const OWNER_CONTACT = '微信 owner-contact';
const DUAL_CONTACT = '微信 dual-contact';

describe('领取申请提交 / 查询 / contactText（真连库）', () => {
  const scope = 'claims-api';
  let fx: TenantFixtures;
  let ownerToken: string;
  let dualToken: string;
  let outsiderToken: string;
  let outsiderId: string;

  const items = {
    submit: '',
    read: '',
    contact: '',
    cross: '',
    archived: '',
  };
  const claims = {
    readDual: '',
    readStranger: '',
    contactDual: '',
    cross: '',
  };

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'integration-test-secret';
    fx = await createTenantFixtures(scope);

    ownerToken = mintSessionToken(fx.ownerId, fx.communityAId);
    dualToken = mintSessionToken(fx.dualId, fx.communityAId);

    // 额外一名「无任何申请」的甲区成员，用于验证「第三人 → 403」。
    outsiderId = `${fx.scopePrefix}outsider`;
    await pool.query(
      `INSERT INTO "User" ("id","nickname","createdAt","updatedAt") VALUES ($1, $2, now(), now())`,
      [outsiderId, '甲-旁观者'],
    );
    await pool.query(
      `INSERT INTO "CommunityMember" ("id","communityId","userId","joinedAt")
       VALUES ($1, $2, $3, now())`,
      [`${fx.scopePrefix}mem-out`, fx.communityAId, outsiderId],
    );
    outsiderToken = mintSessionToken(outsiderId, fx.communityAId);

    const A = fx.communityAId;
    const O = fx.ownerId;
    items.submit = await insertItem(scope, {
      key: 'submit',
      communityId: A,
      ownerId: O,
      name: '提交目标',
    });
    items.read = await insertItem(scope, {
      key: 'read',
      communityId: A,
      ownerId: O,
      name: '查询目标',
    });
    items.contact = await insertItem(scope, {
      key: 'contact',
      communityId: A,
      ownerId: O,
      name: '联系方式目标',
    });
    items.cross = await insertItem(scope, {
      key: 'cross',
      communityId: fx.communityBId,
      ownerId: fx.dualId,
      name: '乙区物品',
    });
    items.archived = await insertItem(scope, {
      key: 'archived',
      communityId: A,
      ownerId: O,
      name: '已归档物品',
      status: 'ARCHIVED',
    });

    claims.readDual = await insertClaim(scope, {
      key: 'readDual',
      itemId: items.read,
      applicantId: fx.dualId,
    });
    claims.readStranger = await insertClaim(scope, {
      key: 'readStranger',
      itemId: items.read,
      applicantId: fx.strangerId,
    });
    claims.contactDual = await insertClaim(scope, {
      key: 'contactDual',
      itemId: items.contact,
      applicantId: fx.dualId,
    });
    claims.cross = await insertClaim(scope, {
      key: 'cross',
      itemId: items.cross,
      applicantId: fx.dualId,
    });
  });

  afterAll(async () => {
    await cleanupFixtures(scope);
    await prisma.$disconnect();
    await closePool();
  });

  // ---------------------------------------------------------------------------
  // POST /api/items/:id/claims
  // ---------------------------------------------------------------------------
  describe('POST /api/items/:id/claims（提交申请）', () => {
    it('201：建立 PENDING 申请，DTO 通过契约校验，并给物品 owner 写 CLAIM_RECEIVED', async () => {
      const before = await pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM "Notification" WHERE "userId" = $1 AND type = 'CLAIM_RECEIVED'`,
        [fx.ownerId],
      );

      const response = await claimPOST(
        makeRequest('POST', `/api/items/${items.submit}/claims`, {
          token: dualToken,
          body: { message: '今晚能拿', preferredLocation: '3栋楼下' },
        }),
        { params: Promise.resolve({ id: items.submit }) },
      );
      expect(response.status).toBe(201);
      const json = (await response.json()) as DataEnvelope<ClaimDto>;
      expect(() => ClaimDtoSchema.parse(json.data)).not.toThrow();
      expect(json.data.status).toBe('PENDING');
      expect(json.data.applicant.id).toBe(fx.dualId);
      expect(json.data.message).toBe('今晚能拿');
      expect(json.data.preferredLocation).toBe('3栋楼下');
      expect(json.data.contactText).toBeNull(); // PENDING → 不暴露联系方式
      expect(json.data.acceptedAt).toBeNull();
      expect(json.data.completedAt).toBeNull();

      const after = await pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM "Notification" WHERE "userId" = $1 AND type = 'CLAIM_RECEIVED'`,
        [fx.ownerId],
      );
      expect(after.rows[0]?.c).toBe((before.rows[0]?.c ?? 0) + 1);
    });

    it('重复提交同物品 → 409 CLAIM_CONFLICT（已有 PENDING）', async () => {
      const response = await claimPOST(
        makeRequest('POST', `/api/items/${items.submit}/claims`, {
          token: dualToken,
          body: { message: '再来一次' },
        }),
        { params: Promise.resolve({ id: items.submit }) },
      );
      expect(response.status).toBe(409);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('CLAIM_CONFLICT');
    });

    it('发布者申请自己的物品 → 403 FORBIDDEN', async () => {
      const response = await claimPOST(
        makeRequest('POST', `/api/items/${items.submit}/claims`, {
          token: ownerToken,
          body: { message: '自己申请自己' },
        }),
        { params: Promise.resolve({ id: items.submit }) },
      );
      expect(response.status).toBe(403);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('物品非 ACTIVE（已归档）→ 409 CLAIM_CONFLICT', async () => {
      const response = await claimPOST(
        makeRequest('POST', `/api/items/${items.archived}/claims`, {
          token: dualToken,
          body: { message: '申请已归档物品' },
        }),
        { params: Promise.resolve({ id: items.archived }) },
      );
      expect(response.status).toBe(409);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('CLAIM_CONFLICT');
    });

    it('跨社区物品（乙区）→ 404 NOT_FOUND', async () => {
      const response = await claimPOST(
        makeRequest('POST', `/api/items/${items.cross}/claims`, {
          token: dualToken,
          body: { message: '越界申请' },
        }),
        { params: Promise.resolve({ id: items.cross }) },
      );
      expect(response.status).toBe(404);
    });

    it('未登录 → 401 UNAUTHENTICATED', async () => {
      const response = await claimPOST(
        makeRequest('POST', `/api/items/${items.submit}/claims`, { body: { message: '匿名' } }),
        { params: Promise.resolve({ id: items.submit }) },
      );
      expect(response.status).toBe(401);
    });

    it('message 超过 500 → 400 INVALID_INPUT', async () => {
      const response = await claimPOST(
        makeRequest('POST', `/api/items/${items.read}/claims`, {
          token: dualToken,
          body: { message: 'a'.repeat(501) },
        }),
        { params: Promise.resolve({ id: items.read }) },
      );
      expect(response.status).toBe(400);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('preferredAt 非法 → 400 INVALID_INPUT', async () => {
      const response = await claimPOST(
        makeRequest('POST', `/api/items/${items.read}/claims`, {
          token: dualToken,
          body: { preferredAt: 'not-a-date' },
        }),
        { params: Promise.resolve({ id: items.read }) },
      );
      expect(response.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/items/:id/claims
  // ---------------------------------------------------------------------------
  describe('GET /api/items/:id/claims（查看该物品的申请）', () => {
    it('OWNER → 看到该物品全部申请（createdAt DESC）', async () => {
      const response = await itemClaimsGET(
        makeRequest('GET', `/api/items/${items.read}/claims`, { token: ownerToken }),
        { params: Promise.resolve({ id: items.read }) },
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as DataEnvelope<ClaimDto[]>;
      const ids = json.data.map((c) => c.id);
      expect(ids).toContain(claims.readDual);
      expect(ids).toContain(claims.readStranger);
      for (const claim of json.data) {
        expect(() => ClaimDtoSchema.parse(claim)).not.toThrow();
      }
    });

    it('非 owner 的申请人 → 只看自己那条', async () => {
      const response = await itemClaimsGET(
        makeRequest('GET', `/api/items/${items.read}/claims`, { token: dualToken }),
        { params: Promise.resolve({ id: items.read }) },
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as DataEnvelope<ClaimDto[]>;
      expect(json.data.map((c) => c.id)).toEqual([claims.readDual]);
    });

    it('第三人（非 owner、无申请）→ 403 FORBIDDEN', async () => {
      const response = await itemClaimsGET(
        makeRequest('GET', `/api/items/${items.read}/claims`, { token: outsiderToken }),
        { params: Promise.resolve({ id: items.read }) },
      );
      expect(response.status).toBe(403);
      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('跨社区物品 → 404', async () => {
      const response = await itemClaimsGET(
        makeRequest('GET', `/api/items/${items.cross}/claims`, { token: ownerToken }),
        { params: Promise.resolve({ id: items.cross }) },
      );
      expect(response.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/me/claims
  // ---------------------------------------------------------------------------
  describe('GET /api/me/claims', () => {
    it('as=applied：全部 applicant 都是我，且含我发起的 readItem 申请', async () => {
      const response = await meClaimsGET(
        makeRequest('GET', '/api/me/claims?as=applied', { token: dualToken }),
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as DataEnvelope<ClaimDto[]>;
      expect(json.data.length).toBeGreaterThan(0);
      for (const claim of json.data) {
        expect(claim.applicant.id).toBe(fx.dualId);
        expect(() => ClaimDtoSchema.parse(claim)).not.toThrow();
      }
      expect(json.data.map((c) => c.id)).toContain(claims.readDual);
    });

    it('as=received：返回的每条都挂在我名下的物品上，且含 readItem 申请', async () => {
      const owned = await pool.query<{ id: string }>(
        `SELECT id FROM "Item" WHERE "ownerId" = $1 AND "communityId" = $2`,
        [fx.ownerId, fx.communityAId],
      );
      const ownedIds = new Set(owned.rows.map((r) => r.id));

      const response = await meClaimsGET(
        makeRequest('GET', '/api/me/claims?as=received', { token: ownerToken }),
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as DataEnvelope<ClaimDto[]>;
      expect(json.data.length).toBeGreaterThan(0);
      for (const claim of json.data) {
        expect(ownedIds.has(claim.itemId)).toBe(true);
      }
      expect(json.data.map((c) => c.id)).toContain(claims.readStranger);
    });

    it('缺省 as → 等价于 applied', async () => {
      const withParam = await meClaimsGET(
        makeRequest('GET', '/api/me/claims?as=applied', { token: dualToken }),
      );
      const withoutParam = await meClaimsGET(
        makeRequest('GET', '/api/me/claims', { token: dualToken }),
      );
      const a = (await withParam.json()) as DataEnvelope<ClaimDto[]>;
      const b = (await withoutParam.json()) as DataEnvelope<ClaimDto[]>;
      expect(b.data.map((c) => c.id)).toEqual(a.data.map((c) => c.id));
    });

    it('非法 as → 400 INVALID_INPUT', async () => {
      const response = await meClaimsGET(
        makeRequest('GET', '/api/me/claims?as=bogus', { token: dualToken }),
      );
      expect(response.status).toBe(400);
    });

    it('未登录 → 401', async () => {
      const response = await meClaimsGET(makeRequest('GET', '/api/me/claims'));
      expect(response.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // contactText 可见性（D1）
  // ---------------------------------------------------------------------------
  describe('contactText 可见性', () => {
    it('PENDING：owner 侧与申请人侧都看不到联系方式（均为 null）', async () => {
      const ownerView = await itemClaimsGET(
        makeRequest('GET', `/api/items/${items.contact}/claims`, { token: ownerToken }),
        { params: Promise.resolve({ id: items.contact }) },
      );
      const ownerJson = (await ownerView.json()) as DataEnvelope<ClaimDto[]>;
      expect(ownerJson.data.every((c) => c.contactText === null)).toBe(true);

      const applicantView = await meClaimsGET(
        makeRequest('GET', '/api/me/claims?as=applied', { token: dualToken }),
      );
      const applicantJson = (await applicantView.json()) as DataEnvelope<ClaimDto[]>;
      const own = applicantJson.data.find((c) => c.id === claims.contactDual);
      expect(own?.contactText).toBeNull();
    });

    it('ACCEPTED 后：owner 看到申请人联系方式、申请人看到 owner 联系方式', async () => {
      const accepted = await acceptPOST(
        makeRequest('POST', `/api/claims/${claims.contactDual}/accept`, { token: ownerToken }),
        { params: Promise.resolve({ id: claims.contactDual }) },
      );
      expect(accepted.status).toBe(200);

      // owner 侧
      const ownerView = await itemClaimsGET(
        makeRequest('GET', `/api/items/${items.contact}/claims`, { token: ownerToken }),
        { params: Promise.resolve({ id: items.contact }) },
      );
      const ownerJson = (await ownerView.json()) as DataEnvelope<ClaimDto[]>;
      const ownerSeen = ownerJson.data.find((c) => c.id === claims.contactDual);
      expect(ownerSeen?.status).toBe('ACCEPTED');
      expect(ownerSeen?.contactText).toBe(DUAL_CONTACT);

      // 申请人侧
      const applicantView = await meClaimsGET(
        makeRequest('GET', '/api/me/claims?as=applied', { token: dualToken }),
      );
      const applicantJson = (await applicantView.json()) as DataEnvelope<ClaimDto[]>;
      const applicantSeen = applicantJson.data.find((c) => c.id === claims.contactDual);
      expect(applicantSeen?.contactText).toBe(OWNER_CONTACT);
    });

    it('旁观者（非交易方）看不到联系方式', async () => {
      // outsider 既非 owner 也非申请人；对 contactItem 的申请其 GET 会 403（无申请）。
      // 这里直接验证：outsider 无任何申请 → as=applied 为空，不可能泄漏。
      const response = await meClaimsGET(
        makeRequest('GET', '/api/me/claims?as=applied', { token: outsiderToken }),
      );
      const json = (await response.json()) as DataEnvelope<ClaimDto[]>;
      expect(json.data).toEqual([]);
    });
  });
});
