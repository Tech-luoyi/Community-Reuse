'use client';

import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { post, get } from '@/lib/api';
import { burst } from '@/lib/confetti';
import { cn } from '@/lib/utils';
import { TRADE_TYPE_LABEL } from '@/lib/format';
import { Button, Card, Field, Input, SectionTitle, Textarea } from '@/components/ui';
import { ImageUploader } from '@/components/ImageUploader';
import { PricingAssistant, PolishAssistant } from '@/components/ai';
import { useMe } from '@/hooks/use-me';
import type { ItemDto, TradeType } from '@/shared/types';

/** 表单 schema（与 `CreateItemRequestSchema` 对齐；该 schema 因 superRefine 是 ZodEffects，不能 extend） */
const FormSchema = z
  .object({
    communityId: z.string().optional(),
    name: z.string().trim().min(1, '请填写物品名称').max(80),
    category: z.string().trim().max(40).optional(),
    description: z.string().trim().min(1, '请简单描述一下').max(2000),
    tradeType: z.enum(['FREE', 'PAY_WHATEVER', 'FIXED_PRICE', 'OTHER']),
    price: z.number().nonnegative().nullable().optional(),
    imageKeys: z.array(z.string()).max(6).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.tradeType === 'FIXED_PRICE' && (value.price === null || value.price === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: '标价交易必须填写价格',
      });
    }
  });

const TRADE_CHOICES: [TradeType, string][] = [
  ['FREE', '免费送'],
  ['PAY_WHATEVER', '随便给'],
  ['FIXED_PRICE', '标价'],
  ['OTHER', '面议'],
];

export default function NewItemPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [imageKeys, setImageKeys] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', description: '', tradeType: 'FREE', category: '' },
  });
  const tradeType = watch('tradeType');

  async function onSubmit(values: z.infer<typeof FormSchema>) {
    setPublishing(true);
    try {
      const my =
        me ?? (await get<{ currentCommunity: { id: string } }>('/api/me').catch(() => null));
      const communityId = (my as unknown as { currentCommunity?: { id: string } })?.currentCommunity
        ?.id;
      if (!communityId) {
        toast.error('请先加入小区', {
          action: { label: '去加入', onClick: () => router.push('/join') },
        });
        return;
      }
      const payload = {
        communityId,
        name: values.name,
        description: values.description,
        tradeType: values.tradeType,
        category: values.category || undefined,
        price: values.tradeType === 'FIXED_PRICE' ? (values.price ?? null) : null,
        imageKeys: imageKeys.length ? imageKeys : undefined,
      };
      const created = await post<ItemDto>('/api/items', payload);
      void burst({ particleCount: 100, spread: 72, origin: { y: 0.3 } });
      toast.success('发布成功');
      router.push(`/items/${created.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        kicker="发布"
        title="发布一件闲置"
        desc="填名称和描述就能上架，AI 定价和润色是可选项。"
      />

      <div className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
        <Card className="p-5">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Field label="物品名称" required error={errors.name?.message}>
              <Input placeholder="如 九成新婴儿车" maxLength={80} {...register('name')} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="品类" hint="留空也可以">
                <Input placeholder="母婴 / 数码 / 书籍" maxLength={40} {...register('category')} />
              </Field>

              <Field label="交易方式" required>
                <div className="grid grid-cols-2 gap-1.5">
                  {TRADE_CHOICES.map(([v, l]) => {
                    const active = tradeType === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setValue('tradeType', v)}
                        aria-pressed={active}
                        className={cn(
                          'h-8 rounded-md border text-[13px] transition-colors',
                          active
                            ? 'border-ink bg-ink text-white'
                            : 'border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink',
                        )}
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>

            {tradeType === 'FIXED_PRICE' && (
              <Field
                label={`价格（${TRADE_TYPE_LABEL.FIXED_PRICE}，单位元）`}
                required
                error={errors.price?.message as string | undefined}
              >
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="如 60"
                  {...register('price', { valueAsNumber: true })}
                />
              </Field>
            )}

            <Field label="描述" required error={errors.description?.message}>
              <Textarea
                placeholder="成色、入手渠道、可自提时间…"
                maxLength={2000}
                rows={4}
                {...register('description')}
              />
            </Field>

            <Field label="图片" hint={`最多 6 张，已选 ${imageKeys.length} 张`}>
              <ImageUploader keys={imageKeys} onChange={setImageKeys} />
            </Field>

            <Button type="submit" size="lg" className="w-full" disabled={publishing}>
              {publishing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {publishing ? '发布中…' : '立即上架'}
            </Button>
          </form>
        </Card>

        <div className="space-y-3">
          <PricingAssistant
            onApply={(r) => {
              if (r.priceRange)
                setValue('price', Math.round((r.priceRange.min + r.priceRange.max) / 2));
              if (r.mode === 'FREE') setValue('tradeType', 'FREE');
            }}
          />
          <PolishAssistant
            onApply={(r) => {
              setValue('name', r.title.slice(0, 80));
              setValue('description', r.description);
            }}
          />
        </div>
      </div>
    </div>
  );
}
