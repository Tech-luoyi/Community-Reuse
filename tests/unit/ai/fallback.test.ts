/**
 * 规则降级的单测（**纯函数、离线**）。
 *
 * 覆盖 §6.3 降级表：定价关键词 / 润色模板 / FAQ 关键词；并断言**确定性**（同输入两次结果全等）
 * 与**输出满足 §6.2 容忍边界**。
 */
import { describe, expect, it } from 'vitest';

import { fallbackFaq, fallbackPolish, fallbackPricing } from '@/server/ai/fallback';
import {
  FaqModelOutputSchema,
  PolishModelOutputSchema,
  PricingModelOutputSchema,
} from '@/server/ai/prompts';

describe('定价降级（§6.3）', () => {
  it('命中「婴儿车/书/绿植/衣服」→ FREE + priceRange=null', () => {
    for (const name of ['婴儿车', '一本旧书', '绿植一盆', '小孩衣服']) {
      const result = fallbackPricing({ name });
      expect(result.mode).toBe('FREE');
      expect(result.priceRange).toBeNull();
      expect(PricingModelOutputSchema.safeParse(result).success).toBe(true);
    }
  });

  it('未命中免费词且无品牌 → PRICED + [20,80]', () => {
    const result = fallbackPricing({ name: '旧台灯' });
    expect(result.mode).toBe('PRICED');
    expect(result.priceRange).toEqual({ min: 20, max: 80, currency: 'CNY' });
    expect(PricingModelOutputSchema.safeParse(result).success).toBe(true);
  });

  it('命中品牌词 → PRICED + [50,150]（描述亦可命中）', () => {
    const byName = fallbackPricing({ name: '小米 电饭煲' });
    expect(byName.priceRange).toEqual({ min: 50, max: 150, currency: 'CNY' });
    const byDesc = fallbackPricing({ name: '电饭煲', description: 'Nike 联名款' });
    expect(byDesc.priceRange).toEqual({ min: 50, max: 150, currency: 'CNY' });
  });

  it('确定性：同输入两次结果全等', () => {
    expect(fallbackPricing({ name: '婴儿车' })).toEqual(fallbackPricing({ name: '婴儿车' }));
  });
});

describe('润色降级（§6.3）', () => {
  it('title 含名称与成色词、description 以原文开头且追加尾巴、highlights 取前 3 短句', () => {
    const result = fallbackPolish({ rawText: '九成新。轮子顺滑！可折叠。还有第四个句子。' });
    expect(result.title).toContain('闲置好物');
    expect(result.description.startsWith('九成新。轮子顺滑！可折叠。还有第四个句子。')).toBe(true);
    expect(result.description).toContain('实物如图，随时可自提，先到先得～');
    expect(result.highlights.length).toBeLessThanOrEqual(3);
    expect(PolishModelOutputSchema.safeParse(result).success).toBe(true);
  });

  it('极短原文也能满足 description 的 min(20) 容忍边界', () => {
    const result = fallbackPolish({ rawText: '新' });
    expect(result.description.length).toBeGreaterThanOrEqual(20);
    expect(PolishModelOutputSchema.safeParse(result).success).toBe(true);
  });

  it('超长原文被截到 max(300) 以内', () => {
    const result = fallbackPolish({ rawText: '很'.repeat(500) });
    expect(result.description.length).toBeLessThanOrEqual(300);
    expect(PolishModelOutputSchema.safeParse(result).success).toBe(true);
  });

  it('确定性：同输入两次结果全等', () => {
    const input = { rawText: '九成新。轮子顺滑！' };
    expect(fallbackPolish(input)).toEqual(fallbackPolish(input));
  });
});

describe('FAQ 降级（§6.3）', () => {
  const base = {
    name: '婴儿车',
    description: '九成新',
    status: 'ACTIVE',
    communityName: '阳光小区',
  } as const;

  it('还在吗 → 在的，随时可约自提～', () => {
    const result = fallbackFaq({ ...base, tradeType: 'FREE', question: '还在吗？' });
    expect(result.answer).toBe('在的，随时可约自提～');
    expect(result.confidence).toBeCloseTo(0.6);
    expect(FaqModelOutputSchema.safeParse(result).success).toBe(true);
  });

  it('自提 → 含社区名', () => {
    const result = fallbackFaq({ ...base, tradeType: 'FREE', question: '可以自提吗' });
    expect(result.answer).toContain('阳光小区');
    expect(FaqModelOutputSchema.safeParse(result).success).toBe(true);
  });

  it('刀/便宜：FREE / PAY_WHATEVER → 已送不还价；FIXED_PRICE → 可小刀', () => {
    expect(fallbackFaq({ ...base, tradeType: 'FREE', question: '能便宜点吗' }).answer).toContain(
      '不还价',
    );
    expect(
      fallbackFaq({ ...base, tradeType: 'PAY_WHATEVER', question: '能刀吗' }).answer,
    ).toContain('不还价');
    expect(fallbackFaq({ ...base, tradeType: 'FIXED_PRICE', question: '能刀吗' }).answer).toContain(
      '小刀',
    );
  });

  it('未命中 → 通用回复，confidence 较低', () => {
    const result = fallbackFaq({ ...base, tradeType: 'FIXED_PRICE', question: '多大尺寸' });
    expect(result.confidence).toBeLessThan(0.6);
    expect(FaqModelOutputSchema.safeParse(result).success).toBe(true);
  });

  it('确定性：同输入两次结果全等', () => {
    const input = { ...base, tradeType: 'FREE' as const, question: '还在吗' };
    expect(fallbackFaq(input)).toEqual(fallbackFaq(input));
  });
});
