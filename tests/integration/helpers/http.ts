/**
 * 集成测试 HTTP 构造工具：直接调用真实 Route Handler 时，用它拼出**真实的 `Request`**
 * （含真实签名的会话 Cookie），从而在不启用 HTTP 服务器的前提下走完整请求管线。
 */
import { SESSION_COOKIE_NAME } from '@/server/auth/session';

const BASE = 'http://localhost';

export interface RequestInitLike {
  body?: unknown;
  /** 明文会话令牌（会被写成 `cr_session=<token>` Cookie）。 */
  token?: string;
  /** 直接设置 cookie 头（用于伪造 / 篡改 / 缺失场景）。 */
  cookieHeader?: string;
}

/** 构造一个可直接传入 Route Handler 的 `Request`。 */
export function makeRequest(method: string, path: string, init: RequestInitLike = {}): Request {
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

/** 从响应头取指定 Set-Cookie 的原始值（未解码）；不存在时返回 undefined。 */
export function setCookieRaw(response: Response, name: string): string | undefined {
  const header = response.headers.get('set-cookie');
  if (!header) {
    return undefined;
  }
  const match = header.match(new RegExp(`${name}=([^;]*)`));
  return match?.[1];
}
