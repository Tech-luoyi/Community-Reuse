'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { KeyRound, Loader2, PartyPopper, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { JoinRequestSchema, type JoinRequest } from '@/shared/schemas';
import { post } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';

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
      toast.success(
        `欢迎加入 ${(data as unknown as { community: { name: string } }).community.name} 🎉`,
      );
      router.push('/');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加入失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg pt-6">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <Card className="relative overflow-hidden p-7">
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
              <PartyPopper size={13} /> 30 秒加入 · 熟人社区
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight">
              凭邀请码<span className="text-emerald-600">加入小区</span>
            </h1>
            <p className="mt-1.5 text-sm text-stone-500">
              邀请码即身份：校验 → 建用户 → 签发 HttpOnly 会话 Cookie。
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-3.5">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold">
                  <KeyRound size={14} className="text-emerald-600" /> 邀请码
                </label>
                <Input placeholder="如 LINFENG-2026" {...register('inviteCode')} />
                {errors.inviteCode && (
                  <p className="mt-1 text-xs font-bold text-red-500">{errors.inviteCode.message}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {['LINFENG-2026', 'YUNQI-2026'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setValue('inviteCode', c)}
                      className="rounded-full bg-stone-100 px-2.5 py-1 font-mono text-[11px] font-bold text-stone-600 transition hover:bg-stone-900 hover:text-white"
                    >
                      {c}
                    </button>
                  ))}
                  <span className="py-1 text-[11px] text-stone-400">
                    ← 点一下自动填（种子数据）
                  </span>
                </div>
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold">
                  <UserRound size={14} className="text-emerald-600" /> 昵称
                </label>
                <Input placeholder="如 3栋-老王" maxLength={30} {...register('nickname')} />
                {errors.nickname && (
                  <p className="mt-1 text-xs font-bold text-red-500">{errors.nickname.message}</p>
                )}
              </div>
              <Button
                type="submit"
                variant="accent"
                size="lg"
                className="w-full"
                disabled={loading}
              >
                {loading && <Loader2 size={17} className="animate-spin" />}
                {loading ? '正在加入…' : '加入并开始流转 →'}
              </Button>
            </form>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              {[
                ['🔑', '邀请码准入'],
                ['🍪', 'Cookie 会话'],
                ['🏘️', '多租户隔离'],
              ].map(([e, t]) => (
                <div
                  key={t}
                  className="rounded-2xl bg-stone-50 px-2 py-2.5 text-[11px] font-bold text-stone-500"
                >
                  <div className="text-lg">{e}</div>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
