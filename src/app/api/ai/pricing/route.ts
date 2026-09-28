/**
 * `POST /api/ai/pricing` —— 智能定价建议（docs/api-contract.md §8）。
 *
 * 请求：`{ name, description?, category? }` → `200 { data: PricingResult }`。
 * 权限：`MEMBER`（未登录 401 / 非成员 403）。
 * 错误：`INVALID_INPUT`(400) / `RATE_LIMITED`(429)。**LLM 不可用不算错误**：走降级并置 `degraded:true`。
 */
import { PricingRequestSchema } from '@/shared/schemas';

import { enforceAiRateLimit } from '@/server/ai/rate-limit';
import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { jsonOk, parseJsonBody, withRoute } from '@/server/http';
import { generatePricing } from '@/server/ai/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);
  enforceAiRateLimit(viewer.id);

  const body = await parseJsonBody(request, PricingRequestSchema);
  const result = await generatePricing(body);
  return jsonOk(result);
});
