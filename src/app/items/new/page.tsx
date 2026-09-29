'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { burst } from '@/lib/confetti';
import { Loader2, Rocket } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { post, get } from '@/lib/api';
import { Button, Card, Input, SectionTitle, Textarea } from '@/components/ui';
import { ImageUploader } from '@/components/ImageUploader';
import { PricingAssistant, PolishAssistant } from '@/components/ai';
import { useMe } from '@/hooks/use-me';
import type { ItemDto } from '@/shared/types';

/** 表单 schema（与 `CreateItemRequestSchema` 对齐；该 schema 因 superRefine 是 ZodEffects，不能 extend） */
const FormSchema = z
  .object({
    communityId: z.string().optional(),
    name: z.string().trim().min(1, '必填').max(80),
    category: z.string().trim().max(40).optional(),
    description: z.string().trim().min(1, '必填').max(2000),
    tradeType: z.enum(['FREE', 'PAY_WHATEVER', 'FIXED_PRICE', 'OTHER']),
    price: z.number().nonnegative().nullable().optional(),
    imageKeys: z.array(z.string()).max(6).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.tradeType === 'FIXED_PRICE' && (value.price === null || value.price === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: '标价交易必须提供价格',
      });
    }
  });

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
      void burst({
        particleCount: 120,
        spread: 75,
        origin: { y: 0.3 },
        colors: ['#16a34a', '#f59e0b', '#fff'],
      });
      toast.success('发布成功！新鲜度开始计时 ⚡');
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
        title={
          <>
            发布一件<span className="text-emerald-600">闲置</span>
          </>
        }
        desc="30 秒上架：AI 帮你定价 + 润色，图片自动压缩。非标价交易的价格会被归一化为 null。"
      />
      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <motion.div initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }}>
          <Card className="space-y-4 p-5 sm:p-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[13px] font-bold">物品名称 *</label>
                <Input placeholder="如 九成新婴儿车" maxLength={80} {...register('name')} />
                {errors.name && (
                  <p className="mt-1 text-xs font-bold text-red-500">{errors.name.message}</p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[13px] font-bold">品类</label>
                  <Input
                    placeholder="母婴 / 数码 / 书籍…"
                    maxLength={40}
                    {...register('category')}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-bold">交易方式 *</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        ['FREE', '🎁免费'],
                        ['PAY_WHATEVER', '☕随给'],
                        ['FIXED_PRICE', '🏷️标价'],
                        ['OTHER', '💬面议'],
                      ] as const
                    ).map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setValue('tradeType', v)}
                        className={`rounded-xl border px-1 py-2 text-xs font-black transition ${tradeType === v ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-stone-200 text-stone-500'}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {tradeType === 'FIXED_PRICE' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                >
                  <label className="mb-1.5 block text-[13px] font-bold">价格（元）*</label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="如 60"
                    {...register('price', { valueAsNumber: true })}
                  />
                  {errors.price && (
                    <p className="mt-1 text-xs font-bold text-red-500">
                      {errors.price.message as string}
                    </p>
                  )}
                </motion.div>
              )}
              <div>
                <label className="mb-1.5 block text-[13px] font-bold">描述 *</label>
                <Textarea
                  placeholder="成色、入手渠道、可自提时间…"
                  maxLength={2000}
                  rows={4}
                  {...register('description')}
                />
                {errors.description && (
                  <p className="mt-1 text-xs font-bold text-red-500">
                    {errors.description.message}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-bold">图片（≤6）</label>
                <ImageUploader keys={imageKeys} onChange={setImageKeys} />
              </div>
              <Button
                type="submit"
                variant="accent"
                size="lg"
                className="w-full"
                disabled={publishing}
              >
                {publishing ? <Loader2 size={18} className="animate-spin" /> : <Rocket size={18} />}
                {publishing ? '发布中…' : '立即上架 ⚡'}
              </Button>
            </form>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-3"
        >
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
          <div className="rounded-3xl bg-stone-900 p-4 text-xs leading-relaxed text-stone-300">
            <span className="font-black text-lime-300">💡 面试话术：</span>
            左侧表单用 RHF+Zod 与后端同源校验；右侧两个 AI 助手消费{' '}
            <code className="rounded bg-white/10 px-1 font-mono">
              /api/ai/pricing · /api/ai/polish
            </code>
            ， 降级时照常返回 <code className="font-mono">degraded:true</code> 并打灰标，Demo
            不翻车。
          </div>
        </motion.div>
      </div>
    </div>
  );
}
