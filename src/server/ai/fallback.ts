/**
 * 无 Key / 超时 / JSON 非法的**确定性规则降级**（`src/server/ai/fallback.ts`）。
 *
 * 事实源：docs/tech-design-final.md §6.3（降级表）。
 * 原则：降级必须**确定性、零依赖、即时** —— 保证断网 / 欠费时三个按钮依然"有反馈、不黑屏"。
 *
 * 输出类型为**模型输出**形状（`*ModelOutput`），不含 `degraded/source/usedTools/toolCalls`；
 * 元信息由上层 `ai/service.ts` 统一附加（`degraded:true, source:'rule'`）。
 * 所有输出均满足 §6.2 的**容忍边界** schema（保证降级结果也是合法 DTO）。
 */
import type { PricingRequest, PolishRequest, TradeType } from '@/shared/types';

import type { FaqModelOutput, PolishModelOutput, PricingModelOutput } from './prompts';

/** 定价降级命中即判「免费送」的关键词（§6.3，混合大小写便于英文命中）。 */
const FREE_KEYWORDS = ['婴儿车', '书', '绿植', '衣服'];

/** 定价降级判定「有明确品牌」的关键词（命中则给较高区间 `[50,150]`）。 */
const BRAND_KEYWORDS = [
  '品牌',
  '正品',
  '小米',
  '华为',
  '苹果',
  'iphone',
  'nike',
  '耐克',
  'adidas',
  '阿迪',
  '乐高',
  '宜家',
  '优衣库',
  '无印',
  'muji',
  'bose',
  'sony',
  '索尼',
];

/** 降级「成色词」（确定性常量，供润色模板使用）。 */
export const FALLBACK_CONDITION_WORD = '八成新';

function includesAny(haystack: string, keywords: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

/**
 * 定价降级（§6.3）：含「婴儿车/书/绿植/衣服」→ `FREE`；否则 `PRICED`
 * （命中品牌词 ? `[50,150]` : `[20,80]`）。**确定性**。
 */
export function fallbackPricing(input: PricingRequest): PricingModelOutput {
  const haystack = `${input.name} ${input.description ?? ''} ${input.category ?? ''}`;

  if (includesAny(haystack, FREE_KEYWORDS)) {
    return { mode: 'FREE', priceRange: null, reason: '价值不高，建议免费送' };
  }

  const brand = includesAny(haystack, BRAND_KEYWORDS);
  return {
    mode: 'PRICED',
    priceRange: brand
      ? { min: 50, max: 150, currency: 'CNY' }
      : { min: 20, max: 80, currency: 'CNY' },
    reason: brand ? '有品牌，给出合理二手价区间' : '常见二手价，可先随便给',
  };
}

/** 从文本中取前 `limit` 个非空短句（按中英文句末/换行切分）。 */
function takeSentences(text: string, limit: number): string[] {
  return text
    .split(/[。！？!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '')
    .slice(0, limit);
}

/**
 * 润色降级（§6.3）：`title = name + '（成色词）'`；`description = 原文 + 尾巴`；
 * `highlights` 取描述前 3 短句。保证落在 §6.2 容忍边界内。**确定性**。
 */
export function fallbackPolish(input: PolishRequest): PolishModelOutput {
  const name = input.name?.trim() ? input.name.trim() : '闲置好物';
  const base = input.rawText.trim();
  const suffix = '实物如图，随时可自提，先到先得～';

  let description = `${base}${suffix}`;
  if (description.length < 20) {
    // 兜住 §6.2 的 min(20) 容忍边界（原文极短时）。
    description = `${description}，欢迎私聊～`;
  }
  description = description.slice(0, 300);

  const title = `${name}（${FALLBACK_CONDITION_WORD}）`.slice(0, 30);
  const highlights = takeSentences(description, 3);

  return { title, description, highlights };
}

/** FAQ 降级的物品上下文（由服务层从当前社区物品解析而来）。 */
export interface FaqFallbackContext {
  name: string;
  description: string;
  tradeType: TradeType;
  status: string;
  communityName: string;
  question: string;
}

/**
 * FAQ 降级（§6.3）：关键词命中返回对应模板（`confidence=0.6`），否则通用回复（`confidence=0.4`）。
 * **确定性**。
 */
export function fallbackFaq(context: FaqFallbackContext): FaqModelOutput {
  const { question, tradeType } = context;

  if (question.includes('还在吗')) {
    return { answer: '在的，随时可约自提～', confidence: 0.6 };
  }
  if (question.includes('自提')) {
    return { answer: `支持自提，就在${context.communityName}，时间你定`, confidence: 0.6 };
  }
  if (question.includes('刀') || question.includes('便宜')) {
    if (tradeType === 'FREE' || tradeType === 'PAY_WHATEVER') {
      return { answer: '已经是送/随便给啦，不还价～', confidence: 0.6 };
    }
    if (tradeType === 'FIXED_PRICE') {
      return { answer: '价格已很低，诚心要可小刀', confidence: 0.6 };
    }
  }
  return { answer: '我先确认一下细节再回复你～', confidence: 0.4 };
}
