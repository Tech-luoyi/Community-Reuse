/**
 * 三段 Prompt 与**模型输出 schema**的单测（离线，不触网、不连库）。
 *
 * 覆盖：
 *   - 「prompt 目标 ⊆ schema 边界」的**逐档核对**（§6.2 统一说明，防被误"收紧"）。
 *   - 枚举**大小写/空白归一化**：`free`/`Free`/`FREE `/… 必过；`paid`/`freebie`/空串必挂。
 *   - A/B/C 三档 schema 的容忍边界（reason≤60 / title≤30 / desc 20–300 / highlights≤5 / answer≤120）。
 */
import { describe, expect, it } from 'vitest';

import {
  FaqModelOutputSchema,
  PolishModelOutputSchema,
  PricingModelOutputSchema,
  PROMPT_TARGET_LIMITS,
  SCHEMA_TOLERANCE_LIMITS,
  buildFaqUserPrompt,
  buildPolishUserPrompt,
  buildPricingUserPrompt,
} from '@/server/ai/prompts';

describe('prompt 目标 ⊆ schema 边界（逐档）', () => {
  it('每一项 prompt 目标都落在对应 schema 容忍边界之内', () => {
    expect(PROMPT_TARGET_LIMITS.pricingReasonChars).toBeLessThanOrEqual(
      SCHEMA_TOLERANCE_LIMITS.pricingReasonChars,
    );
    expect(PROMPT_TARGET_LIMITS.polishTitleChars).toBeLessThanOrEqual(
      SCHEMA_TOLERANCE_LIMITS.polishTitleChars,
    );
    expect(PROMPT_TARGET_LIMITS.polishDescriptionMinChars).toBeGreaterThanOrEqual(
      SCHEMA_TOLERANCE_LIMITS.polishDescriptionMinChars,
    );
    expect(PROMPT_TARGET_LIMITS.polishDescriptionMaxChars).toBeLessThanOrEqual(
      SCHEMA_TOLERANCE_LIMITS.polishDescriptionMaxChars,
    );
    expect(PROMPT_TARGET_LIMITS.polishHighlightCount).toBeLessThanOrEqual(
      SCHEMA_TOLERANCE_LIMITS.polishHighlightCount,
    );
    expect(PROMPT_TARGET_LIMITS.faqAnswerChars).toBeLessThanOrEqual(
      SCHEMA_TOLERANCE_LIMITS.faqAnswerChars,
    );
  });

  it('prompt 文本确实内嵌了对应的目标数字（常量与文案不脱钩）', () => {
    expect(buildPricingUserPrompt({ name: '婴儿车' })).toContain('≤30字');
    const polish = buildPolishUserPrompt({ rawText: '九成新' });
    expect(polish).toContain('≤15字');
    expect(polish).toContain('80-150字');
    expect(
      buildFaqUserPrompt({
        name: 'x',
        description: 'y',
        tradeType: 'FREE',
        status: 'ACTIVE',
        question: 'z',
      }),
    ).toContain('≤60字');
  });
});

describe('定价模型输出 schema（宽容入、严格出）', () => {
  it('大小写/空白归一化后命中 FREE|PRICED 者均通过', () => {
    for (const raw of ['FREE', 'free', 'Free', 'fReE', '  FREE  ', 'priced', 'PRICED']) {
      const result = PricingModelOutputSchema.safeParse({
        mode: raw,
        priceRange: null,
        reason: 'ok',
      });
      expect(result.success, `期望通过：${JSON.stringify(raw)}`).toBe(true);
    }
  });

  it('归一化后仍不命中枚举（paid/freebie/空串）者判非法', () => {
    for (const raw of ['paid', 'freebie', '', '  ', 'gratis']) {
      expect(
        PricingModelOutputSchema.safeParse({ mode: raw, priceRange: null, reason: 'ok' }).success,
      ).toBe(false);
    }
  });

  it('priceRange 允许 null 或 {min,max,currency:CNY}，拒绝负值 / 非 CNY 货币', () => {
    expect(
      PricingModelOutputSchema.safeParse({
        mode: 'PRICED',
        priceRange: { min: 20, max: 80, currency: 'CNY' },
        reason: 'ok',
      }).success,
    ).toBe(true);
    expect(
      PricingModelOutputSchema.safeParse({
        mode: 'PRICED',
        priceRange: { min: -1, max: 80, currency: 'CNY' },
        reason: 'ok',
      }).success,
    ).toBe(false);
    expect(
      PricingModelOutputSchema.safeParse({
        mode: 'PRICED',
        priceRange: { min: 1, max: 2, currency: 'USD' },
        reason: 'ok',
      }).success,
    ).toBe(false);
  });

  it('reason 超过容忍边界(60) 判非法', () => {
    expect(
      PricingModelOutputSchema.safeParse({
        mode: 'FREE',
        priceRange: null,
        reason: 'x'.repeat(61),
      }).success,
    ).toBe(false);
  });
});

describe('润色 / FAQ 模型输出 schema 的容忍边界', () => {
  it('润色：title≤30、description 20–300、highlights≤5', () => {
    expect(
      PolishModelOutputSchema.safeParse({
        title: 'x'.repeat(30),
        description: 'y'.repeat(20),
        highlights: ['a', 'b', 'c'],
      }).success,
    ).toBe(true);
    expect(
      PolishModelOutputSchema.safeParse({
        title: 'x'.repeat(31),
        description: 'y'.repeat(20),
        highlights: [],
      }).success,
    ).toBe(false);
    expect(
      PolishModelOutputSchema.safeParse({
        title: 'x',
        description: 'y'.repeat(19),
        highlights: [],
      }).success,
    ).toBe(false);
    expect(
      PolishModelOutputSchema.safeParse({
        title: 'x',
        description: 'y'.repeat(301),
        highlights: [],
      }).success,
    ).toBe(false);
    expect(
      PolishModelOutputSchema.safeParse({
        title: 'x',
        description: 'y'.repeat(20),
        highlights: ['1', '2', '3', '4', '5', '6'],
      }).success,
    ).toBe(false);
  });

  it('FAQ：answer≤120、confidence∈[0,1]', () => {
    expect(FaqModelOutputSchema.safeParse({ answer: 'x'.repeat(120), confidence: 1 }).success).toBe(
      true,
    );
    expect(
      FaqModelOutputSchema.safeParse({ answer: 'x'.repeat(121), confidence: 0.5 }).success,
    ).toBe(false);
    expect(FaqModelOutputSchema.safeParse({ answer: 'x', confidence: 1.1 }).success).toBe(false);
    expect(FaqModelOutputSchema.safeParse({ answer: 'x', confidence: -0.1 }).success).toBe(false);
  });
});
