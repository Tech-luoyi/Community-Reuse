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
import { pricingThreadKey } from '@/server/ai/checkpoint';
import { sseResponse, wantsStream } from '@/server/ai/sse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireUser(getSessionFromRequest(request));
  await requireMember(viewer);
  enforceAiRateLimit(viewer.id);

  const body = await parseJsonBody(request, PricingRequestSchema);
  // 社区只取会话：它决定定价缓存指纹的租户维度，不可由请求体左右（§6.5.6 第 1 条）。
  //
  // threadId 同理**必须由服务端派生**（userId + communityId 双维度）：若接受客户端传来的
  // 自由文本 threadId，就等于把「谁能读到谁的对话记忆」交给请求体——与缓存指纹同类的
  // 跨租户泄漏，只是换了载体（§6.4 checkpoint 纪律 1）。
  const threadId = pricingThreadKey(viewer.id, viewer.currentCommunityId);
  //
  // 表示层协商（§8.2）：带 `Accept: text/event-stream` 时流过程事件 + 唯一一个 result；
  // 否则维持整包 JSON。**鉴权 / 限流 / 参数校验都在此之前完成**——它们失败时直接返回
  // 对应状态码的错误信封，不进入事件流（契约 §8.2 第 4 条）。
  if (wantsStream(request)) {
    return sseResponse((onEvent) =>
      generatePricing(body, viewer.currentCommunityId, { onEvent, threadId }),
    );
  }
  const result = await generatePricing(body, viewer.currentCommunityId, { threadId });
  return jsonOk(result);
});
