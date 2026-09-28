/**
 * `POST /api/ai/polish` —— 物品描述优化（docs/api-contract.md §8）。
 *
 * 请求：`{ rawText, name?, tradeType? }` → `200 { data: PolishResult }`。
 * 权限：`MEMBER`。错误：`INVALID_INPUT`(400) / `RATE_LIMITED`(429)。LLM 不可用 → 规则降级（仍 200）。
 */
import { PolishRequestSchema } from '@/shared/schemas';

import { enforceAiRateLimit } from '@/server/ai/rate-limit';
import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { jsonOk, parseJsonBody, withRoute } from '@/server/http';
import { generatePolish } from '@/server/ai/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);
  enforceAiRateLimit(viewer.id);

  const body = await parseJsonBody(request, PolishRequestSchema);
  const result = await generatePolish(body);
  return jsonOk(result);
});
