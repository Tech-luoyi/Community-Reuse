'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Check, KeyRound, Loader2, LogOut, Phone, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, patch, post } from '@/lib/api';
import { Button, Card, Input, SectionTitle } from '@/components/ui';
import { MyItemsPanel } from '@/components/MyItemsPanel';
import type { CommunitySummary, MeResponseData } from '@/shared/types';

export default function MePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [nickname, setNickname] = useState('');
  const [contact, setContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => get<MeResponseData>('/api/me'),
    retry: false,
  });

  useEffect(() => {
    if (me) {
      setNickname(me.user.nickname);
      setContact(me.user.contactText ?? '');
    }
  }, [me]);

  async function save() {
    setSaving(true);
    try {
      await patch('/api/me', { nickname, contactText: contact });
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('资料已更新 ✅');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await post('/api/auth/logout');
    await qc.invalidateQueries();
    toast.success('已退出，下次见 👋');
    router.push('/join');
    router.refresh();
  }

  /**
   * 切换当前社区：`POST /api/auth/switch` 重签会话 Cookie（契约 §1）。
   * 切换后所有租户作用域的数据都会变，因此整份缓存作废重取。
   */
  async function switchCommunity(communityId: string) {
    setSwitching(communityId);
    try {
      const data = await post<{ community: CommunitySummary }>('/api/auth/switch', {
        communityId,
      });
      await qc.invalidateQueries();
      toast.success(`已切换到 ${data.community.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '切换失败');
    } finally {
      setSwitching(null);
    }
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-3xl bg-stone-200/70" />
        ))}
      </div>
    );
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-md text-center">
        <Card className="p-8">
          <div className="text-4xl">🔒</div>
          <p className="mt-2 font-black">还未登录</p>
          <p className="mt-1 text-sm text-stone-500">会话 Cookie 不存在或已过期。</p>
          <Button className="mt-4 w-full" variant="accent" onClick={() => router.push('/join')}>
            去邀请码加入
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        kicker="个人中心"
        title={
          <>
            我的<span className="text-emerald-600">资料</span>
          </>
        }
        desc="联系方式唯一写入路径 = PATCH /api/me（D1）；仅在申请被接受后对交易对手方可见。"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}>
          <Card className="relative overflow-hidden p-5">
            <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-emerald-300/40 blur-3xl" />
            <div className="relative flex items-center gap-3">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-lime-400 text-xl font-black text-stone-900 shadow-lg">
                {me.user.nickname.slice(0, 1)}
              </span>
              <div>
                <div className="text-lg font-black">{me.user.nickname}</div>
                <div className="flex items-center gap-1 text-xs font-bold text-emerald-700">
                  <ShieldCheck size={13} /> {me.currentCommunity.name} · 正式成员
                </div>
              </div>
            </div>

            <div className="relative mt-4 space-y-3">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold">
                  昵称
                </label>
                <Input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={30}
                />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold">
                  <Phone size={14} className="text-emerald-600" /> 联系方式
                </label>
                <Input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  maxLength={120}
                  placeholder="微信 / 手机号，留空即清空"
                />
                <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-stone-500">
                  <KeyRound size={11} className="mt-0.5 shrink-0" />
                  「被接受后才对交易对手方展示」—— 详情页永不返回，PENDING 申请看到的也是 null。
                </p>
              </div>
              <Button variant="accent" className="w-full" disabled={saving} onClick={save}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                保存资料
              </Button>
            </div>

            <div className="relative mt-4 border-t border-dashed border-stone-200 pt-3">
              <div className="flex items-center gap-2 text-xs font-bold text-stone-500">
                <KeyRound size={13} /> 所属社区（{me.memberships.length}）
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {me.memberships.map((m, i) => {
                  if (m.communityId === me.currentCommunity.id) {
                    return (
                      <span
                        key={m.communityId}
                        className="rounded-full bg-stone-900 px-2.5 py-1 text-[11px] font-bold text-white"
                      >
                        📍 {me.currentCommunity.name}
                      </span>
                    );
                  }
                  /*
                    契约 §1 的 `memberships` 只返回 `communityId`，不含社区名，
                    名称要等 switch 成功才由服务端回传 —— 所以这里既不打印内部 ID，
                    也不假装知道名字，只标序号 + 提供切换。
                  */
                  return (
                    <button
                      key={m.communityId}
                      type="button"
                      disabled={switching !== null}
                      onClick={() => switchCommunity(m.communityId)}
                      className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold text-stone-600 transition hover:bg-stone-200 disabled:opacity-50"
                    >
                      {switching === m.communityId
                        ? '切换中…'
                        : `我的第 ${i + 1} 个社区 · 切过去 →`}
                    </button>
                  );
                })}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 text-red-500 hover:bg-red-50 hover:text-red-600"
                onClick={logout}
              >
                <LogOut size={15} /> 退出登录
              </Button>
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08 }}
          className="space-y-3"
        >
          <MyItemsPanel />
        </motion.div>
      </div>

      <Card className="flex items-center gap-2 p-4 text-xs leading-relaxed text-stone-500">
        <Check size={14} className="shrink-0 text-emerald-600" />
        退出登录会调用 <code className="font-mono">POST /api/auth/logout</code> 清除 HttpOnly
        Cookie；切换社区走 <code className="font-mono">POST /api/auth/switch</code>。
      </Card>
    </div>
  );
}
