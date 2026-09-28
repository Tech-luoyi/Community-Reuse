/**
 * `POST /api/auth/logout` —— 登出（清除会话 Cookie）。
 *
 * 契约：docs/api-contract.md §1 → `200 { data: { ok: true } }`（无错误码）。
 * 幂等：未登录调用也返回 200（清空 Cookie 是安全且无副作用的）。
 */
import { clearSessionCookie } from '@/server/auth/session';
import { jsonOk, withRoute } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withRoute(async (_request: Request): Promise<Response> => {
  const response = jsonOk({ ok: true });
  clearSessionCookie(response);
  return response;
});
