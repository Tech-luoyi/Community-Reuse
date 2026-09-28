/**
 * `POST /api/ai/faq` —— 交易 FAQ 自动回复建议（docs/api-contract.md §8）。
 *
 * 请求：`{ itemId, question }` → `200 { data: FaqResult }`。
 * 权限：`MEMBER`。物品按**会话社区**加载（不存在/跨社区 → `NOT_FOUND` 404）。
 * 错误：`INVALID_INPUT`(400) / `NOT_FOUND`(404) / `RATE_LIMITED`(429)。LLM 不可用 → 规则降级（仍 200）。
 */
import { FaqRequestSchema } from '@/shared/schemas';

import { enforceAiRateLimit } from '@/server/ai/rate-limit';
import { requireMember, requireUser } from '@/server/auth/guard';
import { getSessionFromRequest } from '@/server/auth/session';
import { jsonOk, parseJsonBody, withRoute } from '@/server/http';
import { generateFaq } from '@/server/ai/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);
  enforceAiRateLimit(viewer.id);

  const body = await parseJsonBody(request, FaqRequestSchema);
  const result = await generateFaq(viewer, body);
  return jsonOk(result);
});
