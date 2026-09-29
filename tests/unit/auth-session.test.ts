/**
 * 会话令牌单元测试（纯函数，无 DB）。
 *
 * 重点：**签名篡改一律判为未登录**——不得因为「payload 里 userId 看起来合法」就放行。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHmac } from 'node:crypto';

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getSessionFromRequest,
  readCookie,
  verifySessionToken,
} from '@/server/auth/session';

const ORIGINAL_SECRET = process.env.SESSION_SECRET;

beforeAll(() => {
  process.env.SESSION_SECRET = 'unit-test-secret';
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.SESSION_SECRET;
  } else {
    process.env.SESSION_SECRET = ORIGINAL_SECRET;
  }
});

describe('session：签发 / 校验', () => {
  it('签发后可原样校验回同一载荷', () => {
    const data = { userId: 'u_1', currentCommunityId: 'c_1' };
    const token = createSessionToken(data);
    expect(verifySessionToken(token)).toEqual(data);
  });

  it('空 / 缺失 / 结构错误一律返回 null', () => {
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('no-dot-here')).toBeNull();
    expect(verifySessionToken('.onlysignature')).toBeNull();
    expect(verifySessionToken('payload.')).toBeNull();
  });

  it('篡改签名 → null（不得放行）', () => {
    const token = createSessionToken({ userId: 'u_1', currentCommunityId: 'c_1' });
    const [payload, signature] = token.split('.');
    const forged = `${payload}.${(signature ?? '').slice(0, -1)}X`;
    expect(verifySessionToken(forged)).toBeNull();
  });

  it('篡改 payload（把 userId 改成别人）→ null（签名不再匹配）', () => {
    const token = createSessionToken({ userId: 'u_victim', currentCommunityId: 'c_1' });
    const signature = token.split('.')[1] ?? '';
    const forgedPayload = Buffer.from(
      JSON.stringify({ userId: 'u_attacker', currentCommunityId: 'c_1' }),
      'utf8',
    ).toString('base64url');
    expect(verifySessionToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it('换密钥签发的令牌 → null（签名与当前密钥不符）', () => {
    process.env.SESSION_SECRET = 'another-secret';
    const foreign = createSessionToken({ userId: 'u_1', currentCommunityId: 'c_1' });
    process.env.SESSION_SECRET = 'unit-test-secret';
    expect(verifySessionToken(foreign)).toBeNull();
  });

  it('缺少 SESSION_SECRET：签发抛错，校验返回 null（失败关闭）', () => {
    delete process.env.SESSION_SECRET;
    expect(() => createSessionToken({ userId: 'u_1', currentCommunityId: 'c_1' })).toThrow();
    expect(verifySessionToken('anything.here')).toBeNull();
    process.env.SESSION_SECRET = 'unit-test-secret';
  });
});

describe('session：Cookie 读取', () => {
  it('从 Cookie 头解析指定项，忽略无关项', () => {
    const request = new Request('http://localhost/api/me', {
      headers: { cookie: `foo=1; ${SESSION_COOKIE_NAME}=abc.def; bar=2` },
    });
    expect(readCookie(request, SESSION_COOKIE_NAME)).toBe('abc.def');
    expect(readCookie(request, 'missing')).toBeUndefined();
  });

  it('无 Cookie 头时返回 undefined', () => {
    const request = new Request('http://localhost/api/me');
    expect(readCookie(request, SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('getSessionFromRequest：携带合法 Cookie → 解析出会话', () => {
    const token = createSessionToken({ userId: 'u_1', currentCommunityId: 'c_1' });
    const request = new Request('http://localhost/api/me', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(getSessionFromRequest(request)).toEqual({
      userId: 'u_1',
      currentCommunityId: 'c_1',
    });
  });

  it('getSessionFromRequest：Cookie 被篡改 → null', () => {
    const token = createSessionToken({ userId: 'u_1', currentCommunityId: 'c_1' });
    const request = new Request('http://localhost/api/me', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}X` },
    });
    expect(getSessionFromRequest(request)).toBeNull();
  });

  describe('令牌自带过期时刻（exp）', () => {
    const NOW = 1_700_000_000_000;

    it('未过期 ⇒ 正常解析，且返回的会话数据**不含 exp**（exp 属令牌层）', () => {
      const token = createSessionToken({ userId: 'u_1', currentCommunityId: 'c_1' }, NOW);
      const session = verifySessionToken(token, NOW + 1000);
      expect(session).toEqual({ userId: 'u_1', currentCommunityId: 'c_1' });
      expect(session).not.toHaveProperty('exp');
    });

    it('超过 SESSION_MAX_AGE_SECONDS 后 ⇒ 判为未登录', () => {
      const token = createSessionToken({ userId: 'u_1', currentCommunityId: 'c_1' }, NOW);
      const justBefore = NOW + SESSION_MAX_AGE_SECONDS * 1000 - 1;
      expect(verifySessionToken(token, justBefore)).not.toBeNull();
      // 过期那一毫秒起失效。
      expect(verifySessionToken(token, NOW + SESSION_MAX_AGE_SECONDS * 1000)).toBeNull();
    });

    it('exp 被改大也救不回来：签名不再匹配 ⇒ null', () => {
      const token = createSessionToken({ userId: 'u_1', currentCommunityId: 'c_1' }, NOW);
      const [payload, signature] = token.split('.');
      const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as {
        exp: number;
      };
      const forged = Buffer.from(
        JSON.stringify({ ...decoded, exp: decoded.exp + 10 * 365 * 24 * 3600 }),
        'utf8',
      ).toString('base64url');
      expect(verifySessionToken(`${forged}.${signature ?? ''}`, NOW)).toBeNull();
    });

    it('载荷缺 exp（旧格式令牌）⇒ 判为未登录，不做向后兼容放行', () => {
      const legacy = Buffer.from(
        JSON.stringify({ userId: 'u_1', currentCommunityId: 'c_1' }),
        'utf8',
      ).toString('base64url');
      const signature = createHmac('sha256', process.env.SESSION_SECRET ?? '')
        .update(legacy)
        .digest('base64url');
      expect(verifySessionToken(`${legacy}.${signature}`, NOW)).toBeNull();
    });
  });
});
