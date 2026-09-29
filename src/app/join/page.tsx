'use client';

import { useRouter } from 'next/navigation';
import { KeyRound, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { JoinRequestSchema, type JoinRequest } from '@/shared/schemas';
import { post } from '@/lib/api';
import { Button, Card, Field, Input } from '@/components/ui';

const SEED_CODES = ['LINFENG-2026', 'YUNQI-2026'];

export default function JoinPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<JoinRequest>({
    resolver: zodResolver(JoinRequestSchema),
    defaultValues: { inviteCode: '', nickname: '' },
  });

  async function onSubmit(values: JoinRequest) {
    setLoading(true);
    try {
      const data = await post<{ community: { name: string } }>('/api/auth/join', values);
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(`欢迎加入 ${data.community.name}`);
      router.push('/');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加入失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-8">
      <Card className="p-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink">加入小区</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">
          邀请码即身份。校验通过后签发 HttpOnly 会话 Cookie。
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <Field label="邀请码" required error={errors.inviteCode?.message}>
            <Input
              placeholder="如 LINFENG-2026"
              className="font-mono"
              {...register('inviteCode')}
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {SEED_CODES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setValue('inviteCode', c)}
                  className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>

          <Field label="昵称" required error={errors.nickname?.message}>
            <Input placeholder="如 3栋-老王" maxLength={30} {...register('nickname')} />
          </Field>

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
            {loading ? '正在加入…' : '加入'}
          </Button>
        </form>

        <p className="mt-5 border-t border-line pt-4 text-[11px] leading-relaxed text-ink-tertiary">
          加入后物品流按小区隔离，只看得到本社区的闲置。
        </p>
      </Card>
    </div>
  );
}
