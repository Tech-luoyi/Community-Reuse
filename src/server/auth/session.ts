/**
 * 会话（Session）：**无服务端会话表**，用 HMAC 签名的 Cookie 承载身份。
 *
 * 契约：docs/api-contract.md §0.3（鉴权与多租户）。
 * 设计要点：
 *   - Cookie 值 = `base64url(payload).base64url(HMAC-SHA256(payload))`，`payload` 为
 *     `{ userId, currentCommunityId }` 的 JSON。密钥取 `SESSION_SECRET`（Node 原生 `crypto`，不引依赖）。
 *   - **签名不通过一律视为未登录**（返回 null / 抛 401），**绝不**因为「userId 看起来合法」
 *     就回落到数据库查用户后放行。
 *   - Cookie 属性：`HttpOnly` + `SameSite=Lax` +（生产）`Secure`。
 *
 * 本模块只做「令牌签发 / 校验 / Cookie 读写」，不含任何数据库访问（权限推导见 guard.ts）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NextResponse } from 'next/server';
import { z } from 'zod';

/** 会话 Cookie 名称。 */
export const SESSION_COOKIE_NAME = 'cr_session';

/** 会话有效期（秒）：30 天。 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** 会话载荷：当前用户 + 当前租户（社区）。 */
export const SessionDataSchema = z.object({
  userId: z.string().min(1),
  currentCommunityId: z.string().min(1),
});
export type SessionData = z.infer<typeof SessionDataSchema>;

/**
 * 令牌信封 = 会话数据 + 过期时刻（**秒**，epoch）。
 *
 * 为什么 `exp` 必须落在**令牌里**而不是只靠 Cookie 的 `maxAge`：Cookie 的 `maxAge`
 * 只是浏览器的服从性提示——令牌一旦被复制走（日志、代理、抓包），浏览器管不着，
 * 签名又永远有效，等于拿到一个**永久通行证**。登出也只清 Cookie，无法吊销。
 * 把 `exp` 签进载荷后，过期令牌在 `verifySessionToken` 就被判为未登录。
 *
 * 仍然是**无状态**会话（没有服务端会话表），所以「登出即吊销」做不到；
 * 能做到的是「令牌自己会过期」。这是无状态方案的固有取舍，诚实标注于此。
 */
const SessionTokenSchema = SessionDataSchema.extend({
  exp: z.number().int().positive(),
});

function resolveSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('SESSION_SECRET 未设置：无法签发/校验会话（见 .env.example）');
  }
  return secret;
}

function base64Url(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buffer.toString('base64url');
}

function sign(payload: string): string {
  return base64Url(createHmac('sha256', resolveSecret()).update(payload).digest());
}

/**
 * 签发会话令牌：`<payload>.<signature>`。
 *
 * @param now 当前时刻（秒）。**仅测试注入**，生产用默认 `Date.now()`。
 */
export function createSessionToken(data: SessionData, now: number = Date.now()): string {
  const payload = base64Url(
    JSON.stringify({
      userId: data.userId,
      currentCommunityId: data.currentCommunityId,
      exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS,
    }),
  );
  return `${payload}.${sign(payload)}`;
}

/**
 * 校验会话令牌。
 * 任何异常（格式错 / 签名不符 / 载荷非法 / 缺密钥 / **已过期**）一律返回 `null`（视为未登录）。
 *
 * @param now 当前时刻（秒）。**仅测试注入**。
 */
export function verifySessionToken(
  token: string | null | undefined,
  now: number = Date.now(),
): SessionData | null {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }
  const dot = token.indexOf('.');
  if (dot <= 0 || dot >= token.length - 1) {
    return null;
  }
  const payload = token.slice(0, dot);
  const providedSignature = token.slice(dot + 1);

  let expectedSignature: string;
  try {
    expectedSignature = sign(payload);
  } catch {
    return null;
  }

  const provided = Buffer.from(providedSignature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    const parsed = SessionTokenSchema.safeParse(decoded);
    if (!parsed.success) {
      return null;
    }
    // 过期即未登录：`exp` 是签过名的，客户端改不了。
    if (parsed.data.exp <= Math.floor(now / 1000)) {
      return null;
    }
    // 只回会话数据本身：`exp` 属令牌层，不进 `Viewer` / `SessionData` 的语义面。
    return { userId: parsed.data.userId, currentCommunityId: parsed.data.currentCommunityId };
  } catch {
    return null;
  }
}

/** 从请求的 Cookie 头解析指定 Cookie（不依赖 `next/headers`，便于直接单测 Route Handler）。 */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) {
    return undefined;
  }
  for (const segment of header.split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = segment.slice(0, eq).trim();
    if (key === name) {
      return decodeURIComponent(segment.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** 从请求解析并校验会话；无有效会话返回 null。 */
export function getSessionFromRequest(request: Request): SessionData | null {
  return verifySessionToken(readCookie(request, SESSION_COOKIE_NAME));
}

/** 会话 Cookie 属性（HttpOnly + SameSite=Lax + 生产 Secure）。 */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/** 在响应上写入会话 Cookie（登录 / 切换社区后调用）。 */
export function attachSessionCookie(response: NextResponse, data: SessionData): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(data), sessionCookieOptions());
  return response;
}

/** 清除会话 Cookie（登出）。 */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
