/**
 * LLM 三段 Prompt（A 定价 / B 润色 / C FAQ）与**模型输出 schema**。
 *
 * 事实源：docs/tech-design-final.md §6.2（三段 Prompt 全文，逐字照抄）。
 *
 * 分层原则（§6.2 统一说明，**勿误"修复"**）：
 *   - Prompt 里的字数（`≤30字 / ≤15字 / 80-150字 / ≤60字 / 3 条`）是给模型的**目标区间（guidance）**；
 *   - 本文件的 Zod schema 里的 `max()/min()` 是**验收容忍边界（tolerance）**。
 *   二者关系恒为 **prompt 目标 ⊆ schema 边界**：prompt 收紧以引导质量，schema 放宽以吸收模型合理
 *   波动、降低误 `REPAIR`。**请勿把 schema 收紧到 prompt 的目标值**（会抬高误判率）。
 *
 * 枚举大小写（§6.2）：对外口径为 `FREE | PRICED`。模型对枚举大小写**不稳定**（`free`/`Free`/`FREE `/…），
 * 故这里对模型输出做**宽容入、严格出**：先用 `z.string().trim().toUpperCase().pipe(z.enum(...))`
 * 吸收「大小写 + 空白」这一个**已定义等价类**，归一化后**仍须命中** `FREE|PRICED`；其它值
 * （如 `paid`、`freebie`）**依旧判非法**并按状态机走 `REPAIR`→`FALLBACK`。
 *
 * 注意：本文件仅被 **服务端** `src/server/ai/**` 使用（不进入 `src/shared`），因此带归一化的
 * **模型输出** schema 归此处；对外的 `PricingResult/PolishResult/FaqResult`（已归一化、严格枚举）
 * 仍在 `src/shared/schemas.ts`。
 */
import { z } from 'zod';

/* ===========================================================================
 * 1. Prompt 目标区间 vs schema 容忍边界（供边界单测逐档核对）
 * =========================================================================== */

/** Prompt 给模型的**目标区间**（引导质量）。 */
export const PROMPT_TARGET_LIMITS = {
  pricingReasonChars: 30,
  polishTitleChars: 15,
  polishDescriptionMinChars: 80,
  polishDescriptionMaxChars: 150,
  polishHighlightCount: 3,
  faqAnswerChars: 60,
} as const;

/** Schema 的**验收容忍边界**（吸收波动、降低误 REPAIR）。 */
export const SCHEMA_TOLERANCE_LIMITS = {
  pricingReasonChars: 60,
  polishTitleChars: 30,
  polishDescriptionMinChars: 20,
  polishDescriptionMaxChars: 300,
  polishHighlightCount: 5,
  faqAnswerChars: 120,
} as const;

/* ===========================================================================
 * 2. A. 智能定价建议  POST /api/ai/pricing
 * =========================================================================== */

export const PRICING_SYSTEM_PROMPT = `你是社区闲置物品流转的定价助手，面向中国城市小区熟人之间的二手/赠予场景。
只输出 JSON，不要任何解释或 Markdown 代码块。
规则：母婴/书籍/小件日用品且价值低或有使用痕迹→倾向"免费送"；有明确品牌且成色好→给出合理二手价区间（人民币）；不确定给保守区间并提示"可先随便给"。`;

export interface PricingPromptInput {
  name: string;
  description?: string;
  category?: string;
}

/** 组装定价 User Prompt（含内联 JSON schema；逐字对齐 §6.2 A）。 */
export function buildPricingUserPrompt(input: PricingPromptInput): string {
  return [
    `物品名称：${input.name}`,
    `补充描述：${input.description ?? '（无）'}`,
    `品类：${input.category ?? '（未提供）'}`,
    '按此 JSON schema 输出（枚举取值一律**全大写**）：',
    '{ "mode": "FREE" | "PRICED",',
    '  "priceRange": { "min": number, "max": number, "currency": "CNY" } | null,',
    `  "reason": "string ≤${PROMPT_TARGET_LIMITS.pricingReasonChars}字" }`,
  ].join('\n');
}

/** 定价**模型输出** schema（宽容入、严格出；见文件头「枚举大小写」）。 */
export const PricingModelOutputSchema = z.object({
  mode: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(['FREE', 'PRICED'])),
  priceRange: z
    .object({
      min: z.number().nonnegative(),
      max: z.number().nonnegative(),
      currency: z.literal('CNY'),
    })
    .nullable(),
  reason: z.string().max(SCHEMA_TOLERANCE_LIMITS.pricingReasonChars),
});
export type PricingModelOutput = z.infer<typeof PricingModelOutputSchema>;

/* ===========================================================================
 * 3. B. 物品描述优化  POST /api/ai/polish
 * =========================================================================== */

export const POLISH_SYSTEM_PROMPT =
  '你是社区闲置转让文案写手。把粗糙描述润色成真诚、简洁、有吸引力的转让文案；口语化、突出成色与可用性、不夸大、不刷屏、适合熟人社区。只输出 JSON。';

export interface PolishPromptInput {
  rawText: string;
  name?: string;
  tradeType?: string;
}

/** 组装润色 User Prompt（逐字对齐 §6.2 B）。 */
export function buildPolishUserPrompt(input: PolishPromptInput): string {
  return [
    `原始描述：${input.rawText}`,
    `物品名称：${input.name ?? '（未提供）'}`,
    `交易方式：${input.tradeType ?? '（未提供）'}`,
    '输出 JSON：',
    `{ "title": "string ≤${PROMPT_TARGET_LIMITS.polishTitleChars}字",`,
    `  "description": "string ${PROMPT_TARGET_LIMITS.polishDescriptionMinChars}-${PROMPT_TARGET_LIMITS.polishDescriptionMaxChars}字",`,
    `  "highlights": ["string","string","string"] }`,
  ].join('\n');
}

/** 润色**模型输出** schema。 */
export const PolishModelOutputSchema = z.object({
  title: z.string().max(SCHEMA_TOLERANCE_LIMITS.polishTitleChars),
  description: z
    .string()
    .min(SCHEMA_TOLERANCE_LIMITS.polishDescriptionMinChars)
    .max(SCHEMA_TOLERANCE_LIMITS.polishDescriptionMaxChars),
  highlights: z.array(z.string()).max(SCHEMA_TOLERANCE_LIMITS.polishHighlightCount),
});
export type PolishModelOutput = z.infer<typeof PolishModelOutputSchema>;

/* ===========================================================================
 * 4. C. 交易 FAQ 自动回复建议  POST /api/ai/faq
 * =========================================================================== */

export const FAQ_SYSTEM_PROMPT =
  '你是闲置物品的卖家助手。根据物品信息与买家问题，生成一句可直接发送的中文回复；友好、简短、真诚；信息不足时给出需要卖家补充确认的回复。只输出 JSON。';

export interface FaqPromptInput {
  name: string;
  description: string;
  tradeType: string;
  status: string;
  question: string;
}

/** 组装 FAQ User Prompt（逐字对齐 §6.2 C）。 */
export function buildFaqUserPrompt(input: FaqPromptInput): string {
  return [
    `物品名称：${input.name}`,
    `物品描述：${input.description}`,
    `交易方式：${input.tradeType}`,
    `物品状态：${input.status}`,
    `买家问题：${input.question}`,
    '输出 JSON：',
    `{ "answer": "string ≤${PROMPT_TARGET_LIMITS.faqAnswerChars}字", "confidence": number }`,
  ].join('\n');
}

/** FAQ**模型输出** schema。 */
export const FaqModelOutputSchema = z.object({
  answer: z.string().max(SCHEMA_TOLERANCE_LIMITS.faqAnswerChars),
  confidence: z.number().min(0).max(1),
});
export type FaqModelOutput = z.infer<typeof FaqModelOutputSchema>;

/* ===========================================================================
 * 5. REPAIR 纠正提示（JSON/schema 非法时，重提示模型**至多 1 次**）
 * =========================================================================== */

/**
 * 修补轮追加的 User 指令。刻意保持**确定性**（不含随机内容），便于单测断言「修复轮恰好 1 次」。
 */
export const REPAIR_INSTRUCTION =
  '上一次输出不是合法 JSON，或不符合要求的 schema。请仅输出**合法 JSON 对象**（json_object），字段名与类型必须完全符合前文给出的 JSON schema；不要输出任何解释、Markdown 代码块或多余文字。';
