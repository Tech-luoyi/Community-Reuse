/**
 * 集成测试公共设施：直连 PostgreSQL（node-postgres）。
 *
 * 为什么用 `pg` 而不是 Prisma Client：本套测试断言的是 **DB 层约束本身**
 * （CHECK / UNIQUE / 索引命中）。`pg` 会把 PG 原生错误原样抛出
 * （`err.code = '23514' / '23505'`、`err.constraint = '<约束名>'`），
 * 便于直接断言「是哪条约束拒的」，不经过 ORM 的二次封装。
 *
 * 连接串解析优先级：真实 `process.env.DATABASE_URL`（CI 会注入）> 项目根 `.env`。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { createSessionToken } from '@/server/auth/session';

/** 极简 .env 读取（不引第三方依赖）；只填充【尚未设置】的键，绝不覆盖既有 env。 */
function loadDotEnv(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }
      const eq = trimmed.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (quoted) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // 无 .env：完全依赖外部注入的 DATABASE_URL / SESSION_SECRET。
  }
}

loadDotEnv();

const connectionString = process.env.DATABASE_URL ?? '';

if (connectionString === '') {
  throw new Error(
    '集成测试需要 DATABASE_URL：请在环境变量中设置，或参照 .env.example 在项目根创建 .env。',
  );
}

/** 集成测试专用连接池。 */
export const pool = new Pool({ connectionString, max: 4 });

/** 测试夹具固定前缀（`-` 在 SQL LIKE 中无通配含义，避免误伤种子数据）。 */
export const FIXTURE_PREFIX = 'itest-';

export interface TestFixtures {
  scopePrefix: string;
  communityId: string;
  userId: string;
  itemId: string;
}

/**
 * 清理某个 scope 下所有测试夹具行（顺序遵循外键依赖：子表在前）。
 * @param scope 作用域标识（同一 scope 固定 id，可重复执行）
 */
export async function cleanupFixtures(scope: string): Promise<void> {
  const like = `${FIXTURE_PREFIX}${scope}-%`;
  await pool.query(`DELETE FROM "AiCache" WHERE "inputHash" LIKE $1`, [like]);
  await pool.query(`DELETE FROM "Favorite" WHERE "userId" LIKE $1 OR "itemId" LIKE $1`, [like]);
  await pool.query(`DELETE FROM "Message" WHERE "itemId" LIKE $1`, [like]);
  await pool.query(`DELETE FROM "ClaimRequest" WHERE "itemId" LIKE $1`, [like]);
  await pool.query(`DELETE FROM "ItemImage" WHERE "itemId" LIKE $1`, [like]);
  await pool.query(`DELETE FROM "Item" WHERE "id" LIKE $1`, [like]);
  await pool.query(`DELETE FROM "CommunityMember" WHERE "userId" LIKE $1`, [like]);
  await pool.query(`DELETE FROM "User" WHERE "id" LIKE $1`, [like]);
  await pool.query(`DELETE FROM "Community" WHERE "id" LIKE $1`, [like]);
}

/**
 * 创建一套独立的测试夹具（社区 + 用户 + 物品），满足 Item 的外键前置。
 * @param scope 作用域标识，隔离并行运行的测试文件互不干扰
 */
export async function createFixtures(scope: string): Promise<TestFixtures> {
  const scopePrefix = `${FIXTURE_PREFIX}${scope}-`;
  const communityId = `${scopePrefix}community`;
  const userId = `${scopePrefix}user`;
  const itemId = `${scopePrefix}item`;

  await cleanupFixtures(scope);

  await pool.query(
    `INSERT INTO "Community" ("id","name","inviteCode","createdAt","updatedAt")
     VALUES ($1, $2, $3, now(), now())`,
    [communityId, '集成测试小区', `${scopePrefix}invite`],
  );
  await pool.query(
    `INSERT INTO "User" ("id","nickname","createdAt","updatedAt")
     VALUES ($1, $2, now(), now())`,
    [userId, '集成测试用户'],
  );
  await pool.query(
    `INSERT INTO "Item"
       ("id","communityId","ownerId","name","description","tradeType","price","status","publishedAt","createdAt","updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'FREE', NULL, 'ACTIVE', now(), now(), now())`,
    [itemId, communityId, userId, '集成测试物品', '仅供集成测试，勿作业务数据'],
  );

  return { scopePrefix, communityId, userId, itemId };
}

export interface TenantFixtures {
  scopePrefix: string;
  /** 社区甲 */
  communityAId: string;
  /** 社区乙 */
  communityBId: string;
  /** 仅属于甲，拥有 itemA（OWNER） */
  ownerId: string;
  /** 同时属于甲和乙（跨租户行为主体） */
  dualId: string;
  /** 仅属于甲（非发布者/非被接受申请人） */
  strangerId: string;
  /** 甲内的 ACTIVE 物品（属于 owner） */
  itemAId: string;
  /** 乙内的 ACTIVE 物品 */
  itemBId: string;
  /** itemA 上 dual 的 ACCEPTED 申请 */
  acceptedClaimId: string;
  /** itemA 上 stranger 的 PENDING 申请 */
  pendingClaimId: string;
}

/**
 * 构造多租户场景夹具：两个社区、三个用户（含一个「双社区」用户）、两件物品、两条申请。
 * 用于验证「社区只认会话」「越权 403」「跨租户不泄漏」。
 */
export async function createTenantFixtures(scope: string): Promise<TenantFixtures> {
  const p = `${FIXTURE_PREFIX}${scope}-`;
  const communityAId = `${p}cA`;
  const communityBId = `${p}cB`;
  const ownerId = `${p}owner`;
  const dualId = `${p}dual`;
  const strangerId = `${p}stranger`;
  const itemAId = `${p}itemA`;
  const itemBId = `${p}itemB`;
  const acceptedClaimId = `${p}claimAccepted`;
  const pendingClaimId = `${p}claimPending`;

  await cleanupFixtures(scope);

  for (const [id, name, code] of [
    [communityAId, '集成测试甲区', `${p}inviteA`],
    [communityBId, '集成测试乙区', `${p}inviteB`],
  ] as const) {
    await pool.query(
      `INSERT INTO "Community" ("id","name","inviteCode","createdAt","updatedAt")
       VALUES ($1, $2, $3, now(), now())`,
      [id, name, code],
    );
  }

  for (const [id, nickname, contact] of [
    [ownerId, '甲-发布者', '微信 owner-contact'],
    [dualId, '双社区用户', '微信 dual-contact'],
    [strangerId, '甲-路人', null],
  ] as const) {
    await pool.query(
      `INSERT INTO "User" ("id","nickname","contactText","createdAt","updatedAt")
       VALUES ($1, $2, $3, now(), now())`,
      [id, nickname, contact],
    );
  }

  for (const [communityId, userId] of [
    [communityAId, ownerId],
    [communityAId, dualId],
    [communityAId, strangerId],
    [communityBId, dualId],
  ] as const) {
    await pool.query(
      `INSERT INTO "CommunityMember" ("id","communityId","userId","joinedAt")
       VALUES ($1, $2, $3, now())`,
      [`${p}m-${communityId}-${userId}`, communityId, userId],
    );
  }

  for (const [id, communityId, owner] of [
    [itemAId, communityAId, ownerId],
    [itemBId, communityBId, dualId],
  ] as const) {
    await pool.query(
      `INSERT INTO "Item"
         ("id","communityId","ownerId","name","description","tradeType","price","status","publishedAt","createdAt","updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'FREE', NULL, 'ACTIVE', now(), now(), now())`,
      [id, communityId, owner, `集成测试物品-${id}`, '多租户夹具'],
    );
  }

  await pool.query(
    `INSERT INTO "ClaimRequest"
       ("id","itemId","applicantId","message","status","createdAt","updatedAt","acceptedAt")
     VALUES ($1, $2, $3, $4, 'ACCEPTED', now(), now(), now())`,
    [acceptedClaimId, itemAId, dualId, '集成测试-已接受'],
  );
  await pool.query(
    `INSERT INTO "ClaimRequest"
       ("id","itemId","applicantId","message","status","createdAt","updatedAt")
     VALUES ($1, $2, $3, $4, 'PENDING', now(), now())`,
    [pendingClaimId, itemAId, strangerId, '集成测试-待处理'],
  );

  return {
    scopePrefix: p,
    communityAId,
    communityBId,
    ownerId,
    dualId,
    strangerId,
    itemAId,
    itemBId,
    acceptedClaimId,
    pendingClaimId,
  };
}

/** 用真实签名逻辑签发一枚会话令牌（供集成测试构造合法 Cookie）。 */
export function mintSessionToken(userId: string, currentCommunityId: string): string {
  return createSessionToken({ userId, currentCommunityId });
}

export interface InsertItemSpec {
  /** id 后缀（最终 id = `${FIXTURE_PREFIX}${scope}-${key}`，随 cleanupFixtures 一起清理）。 */
  key: string;
  communityId: string;
  ownerId: string;
  name?: string;
  description?: string;
  category?: string | null;
  tradeType?: string;
  price?: number | null;
  status?: string;
  /** `publishedAt = now() - N hours`（DB 时钟，便于新鲜度分桶断言）。 */
  publishedAtOffsetHours?: number;
}

/** 插入一件测试物品（`publishedAt` 由 DB `now()` 相对偏移写入）。 */
export async function insertItem(scope: string, spec: InsertItemSpec): Promise<string> {
  const id = `${FIXTURE_PREFIX}${scope}-${spec.key}`;
  await pool.query(
    `INSERT INTO "Item"
       ("id","communityId","ownerId","name","description","category","tradeType","price","status","publishedAt","createdAt","updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7::"TradeType", $8, $9::"ItemStatus",
             now() - ($10 || ' hours')::interval, now(), now())`,
    [
      id,
      spec.communityId,
      spec.ownerId,
      spec.name ?? '测试物品',
      spec.description ?? '测试描述',
      spec.category ?? null,
      spec.tradeType ?? 'FREE',
      spec.price ?? null,
      spec.status ?? 'ACTIVE',
      String(spec.publishedAtOffsetHours ?? 0),
    ],
  );
  return id;
}

/** 插入一条收藏（`Favorite` 的 `@@unique([userId,itemId])` 保证不重复）。 */
export async function insertFavorite(
  scope: string,
  key: string,
  userId: string,
  itemId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO "Favorite" ("id","userId","itemId","createdAt") VALUES ($1, $2, $3, now())`,
    [`${FIXTURE_PREFIX}${scope}-${key}`, userId, itemId],
  );
}

/** PG 原生错误的可断言子集。 */
export interface PgErrorShape {
  code: string;
  constraint?: string;
  message: string;
}

/**
 * 断言某条 SQL 会被数据库拒绝，并返回 PG 错误对象（含 code / constraint）。
 * 若该 SQL 竟然成功，则抛错使测试失败。
 */
export async function expectSqlError(sql: string, params: unknown[] = []): Promise<PgErrorShape> {
  try {
    await pool.query(sql, params);
  } catch (error) {
    return error as PgErrorShape;
  }
  throw new Error(`期望 SQL 被拒绝但执行成功：${sql}`);
}

/** 关闭连接池（在测试文件的 afterAll 中调用，避免挂起进程）。 */
export async function closePool(): Promise<void> {
  await pool.end();
}
