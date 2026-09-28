'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Send, Sparkles, Wand2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { AiMetaLine } from '@/components/features/ai-meta';
import { SessionGate } from '@/components/features/session-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContractGap } from '@/components/ui/contract-gap';
import { CoverPlate } from '@/components/ui/cover-plate';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Inset, Panel, PanelHeader } from '@/components/ui/panel';
import { Segmented } from '@/components/ui/segmented';
import { isApiError, toMessage } from '@/lib/api';
import { applyApiFieldErrors } from '@/lib/form';
import { TRADE_TYPE_LABEL, formatPrice } from '@/lib/format';
import { useAiPolish, useAiPricing, useCreateItem } from '@/lib/mutations';
import { useSession } from '@/lib/queries';
import {
  ITEM_CATEGORY_MAX,
  ITEM_DESCRIPTION_MAX,
  ITEM_NAME_MAX,
  type TradeType,
} from '@/shared/schemas';

const TRADE_OPTIONS: { value: TradeType; label: string }[] = [
  { value: 'FREE', label: '免费' },
  { value: 'PAY_WHATEVER', label: '随意给' },
  { value: 'FIXED_PRICE', label: '定价' },
  { value: 'OTHER', label: '其他' },
];

/**
 * 表单自己的 schema：`priceText` 是输入框里的原始字符串，
 * 只有选到「定价」才要求它是合法非负数 —— 契约的 CreateItemRequest 在校验之前不该管这个。
 */
const ItemFormSchema = z
  .object({
    name: z.string().trim().min(1, '给物品起个名字').max(ITEM_NAME_MAX),
    category: z.string().trim().max(ITEM_CATEGORY_MAX),
    description: z.string().trim().min(1, '写两句说明，邻居才知道要不要').max(ITEM_DESCRIPTION_MAX),
    tradeType: z.enum(['FREE', 'PAY_WHATEVER', 'FIXED_PRICE', 'OTHER']),
    priceText: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    if (values.tradeType !== 'FIXED_PRICE') return;
    const parsed = Number(values.priceText);
    if (values.priceText.length === 0 || !Number.isFinite(parsed) || parsed < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceText'],
        message: '选择「定价」时需要填一个不小于 0 的价格',
      });
    }
  });

type ItemFormValues = z.input<typeof ItemFormSchema>;

const aiError = (error: unknown, fallback: string) =>
  isApiError(error) && error.isRateLimited
    ? 'AI 能力限流每分钟 10 次，稍等一会儿再试'
    : toMessage(error, fallback);

function PublishForm() {
  const router = useRouter();
  const session = useSession();
  const me = session.data;
  const createItem = useCreateItem();
  const pricing = useAiPricing();
  const polish = useAiPolish();

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(ItemFormSchema),
    defaultValues: { name: '', category: '', description: '', tradeType: 'FREE', priceText: '' },
  });

  const name = watch('name');
  const category = watch('category');
  const description = watch('description');
  const tradeType = watch('tradeType');
  const priceText = watch('priceText');

  const parsedPrice = Number(priceText);
  const previewPrice =
    tradeType === 'FIXED_PRICE' &&
    priceText.trim() !== '' &&
    Number.isFinite(parsedPrice) &&
    parsedPrice >= 0
      ? parsedPrice
      : null;

  if (!me) return null;

  const onSubmit = handleSubmit((values) => {
    createItem.mutate(
      {
        communityId: me.currentCommunity.id,
        name: values.name.trim(),
        category: values.category.trim() || undefined,
        description: values.description.trim(),
        tradeType: values.tradeType,
        price: values.tradeType === 'FIXED_PRICE' ? Number(values.priceText) : null,
      },
      {
        onSuccess: (item) => {
          toast.success('已发布，邻居现在就能看到');
          router.push(`/items/${item.id}`);
        },
        onError: (error) => {
          if (applyApiFieldErrors(setError, error)) return;
          toast.error(toMessage(error, '发布失败，请稍后重试'));
        },
      },
    );
  });

  const askPricing = () => {
    if (name.trim().length === 0) {
      toast.error('先填名字，AI 才知道要给什么定价');
      return;
    }
    pricing.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
      },
      { onError: (error) => toast.error(aiError(error, '定价建议没成功')) },
    );
  };

  const askPolish = () => {
    if (description.trim().length < 10) {
      toast.error('先随手写几句，润色才有原料');
      return;
    }
    polish.mutate(
      {
        rawText: description.trim(),
        name: name.trim() || undefined,
        tradeType,
      },
      { onError: (error) => toast.error(aiError(error, '润色没成功')) },
    );
  };

  const applyPrice = () => {
    const range = pricing.data?.priceRange;
    if (!range) return;
    setValue('tradeType', 'FIXED_PRICE', { shouldValidate: true, shouldDirty: true });
    setValue('priceText', String(Math.round((range.min + range.max) / 2)), {
      shouldValidate: true,
      shouldDirty: true,
    });
    toast.success('已按建议区间中值填好，可再改');
  };

  return (
    <>
      <PageHeader
        eyebrow="PUBLISH · 发布"
        title="发布一件闲置"
        desc={`发布到「${me.currentCommunity.name}」。描述越具体，来回问的次数越少。`}
      />

      <form
        className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]"
        onSubmit={onSubmit}
        noValidate
      >
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader eyebrow="BASICS" title="物品信息" className="border-b py-3" />
            <div className="space-y-4 p-5">
              <Field
                label="名称"
                htmlFor="item-name"
                required
                counter={`${ITEM_NAME_MAX} 字以内`}
                error={errors.name?.message}
              >
                <Input id="item-name" placeholder="九成新婴儿车" {...register('name')} />
              </Field>

              <Field
                label="分类"
                htmlFor="item-category"
                error={errors.category?.message}
                hint="随手写两个字就行，集市按它着色与筛选"
              >
                <Input
                  id="item-category"
                  placeholder="母婴 / 家电 / 书籍…"
                  {...register('category')}
                />
              </Field>

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Field
                    label="描述"
                    htmlFor="item-description"
                    required
                    counter={`${ITEM_DESCRIPTION_MAX} 字以内`}
                    error={errors.description?.message}
                  >
                    <Textarea
                      id="item-description"
                      className="min-h-[132px]"
                      placeholder="几成新、有什么小毛病、能不能自提、什么时候方便…"
                      {...register('description')}
                    />
                  </Field>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-6 shrink-0"
                  onClick={askPolish}
                  disabled={polish.isPending}
                >
                  <Wand2 size={13} aria-hidden />
                  {polish.isPending ? '润色中…' : '帮我润色'}
                </Button>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="TERMS" title="怎么给" className="border-b py-3" />
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="label-xs w-14 shrink-0">交易方式</span>
                <Segmented
                  ariaLabel="交易方式"
                  value={tradeType}
                  onChange={(value) =>
                    setValue('tradeType', value, { shouldValidate: true, shouldDirty: true })
                  }
                  options={TRADE_OPTIONS}
                />
              </div>

              {tradeType === 'FIXED_PRICE' && (
                <div className="anim-rise flex flex-wrap items-end gap-3">
                  <Field
                    label="价格（元）"
                    htmlFor="item-price"
                    required
                    error={errors.priceText?.message}
                    className="w-40"
                  >
                    <Input
                      id="item-price"
                      inputMode="decimal"
                      placeholder="45"
                      className="tnum"
                      {...register('priceText')}
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mb-0.5"
                    onClick={askPricing}
                    disabled={pricing.isPending}
                  >
                    <Sparkles size={13} aria-hidden />
                    {pricing.isPending ? '算价中…' : '让 AI 建议'}
                  </Button>
                </div>
              )}

              {tradeType !== 'FIXED_PRICE' && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[12.5px] text-ink-3">不确定收多少？</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={askPricing}
                    disabled={pricing.isPending}
                  >
                    <Sparkles size={13} aria-hidden />
                    {pricing.isPending ? '算价中…' : '让 AI 给个区间'}
                  </Button>
                </div>
              )}
            </div>
          </Panel>

          <Button variant="primary" size="lg" type="submit" disabled={createItem.isPending}>
            <Send size={15} aria-hidden />
            {createItem.isPending ? '发布中…' : '发布到小区'}
          </Button>
        </div>

        <aside className="space-y-4">
          <Panel className="overflow-hidden">
            <PanelHeader eyebrow="PREVIEW" title="集市里的样子" className="border-b py-3" />
            <div className="p-5">
              <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-line">
                <CoverPlate
                  name={name.trim() || '未命名物品'}
                  category={category.trim() || null}
                  size="lg"
                  className="rounded-none"
                />
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[15px] font-semibold text-ink">
                  {name.trim() || '物品名称'}
                </span>
                <span className="tnum shrink-0 text-[14px] font-semibold text-ink">
                  {formatPrice(previewPrice, tradeType)}
                </span>
              </div>
              <p className="mt-1 truncate text-[12px] text-ink-3">
                {category.trim() || '未分类'} · {TRADE_TYPE_LABEL[tradeType]}
              </p>
            </div>
          </Panel>

          {pricing.data && (
            <Inset className="anim-rise">
              <div className="flex items-center justify-between gap-2">
                <div className="label-xs">AI 定价建议</div>
                <Badge tone={pricing.data.mode === 'PRICED' ? 'accent' : 'neutral'}>
                  {pricing.data.mode === 'PRICED' ? '适合定价' : '建议免费或随意给'}
                </Badge>
              </div>
              {pricing.data.priceRange && (
                <div className="tnum mt-2 text-[19px] leading-none font-semibold text-ink">
                  ¥{pricing.data.priceRange.min} – ¥{pricing.data.priceRange.max}
                </div>
              )}
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{pricing.data.reason}</p>
              <AiMetaLine meta={pricing.data} className="mt-2.5" />
              {pricing.data.priceRange && (
                <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={applyPrice}>
                  按建议中值填好
                </Button>
              )}
            </Inset>
          )}

          {polish.data && (
            <Inset className="anim-rise">
              <div className="label-xs">AI 润色结果</div>
              <div className="mt-2 text-[13px] font-semibold text-ink">{polish.data.title}</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
                {polish.data.description}
              </p>
              {polish.data.highlights.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {polish.data.highlights.map((highlight) => (
                    <Badge key={highlight} tone="neutral">
                      {highlight}
                    </Badge>
                  ))}
                </div>
              )}
              <AiMetaLine meta={polish.data} className="mt-2.5" />
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setValue('name', polish.data?.title ?? '', {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                    toast.success('标题已替换，可再改');
                  }}
                >
                  用这个标题
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setValue('description', polish.data?.description ?? '', {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                    toast.success('描述已替换，可再改');
                  }}
                >
                  用这段描述
                </Button>
              </div>
            </Inset>
          )}

          <ContractGap
            section="§3"
            endpoint="POST /api/uploads"
            existsInstead="发布页因此没有图片上传：封面用的是按品类着色的排版盘。其余字段全部可写，发布流程完整。"
          />
        </aside>
      </form>
    </>
  );
}

export function NewItemView() {
  return (
    <SessionGate>
      <PublishForm />
    </SessionGate>
  );
}
