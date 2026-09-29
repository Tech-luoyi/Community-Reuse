'use client';

import { useRouter } from 'next/navigation';
import {
  Building2,
  Info,
  Loader2,
  LogOut,
  MapPin,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, patch, post } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button, Card, Field, Input, SectionTitle, Skeleton } from '@/components/ui';
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
      toast.success('资料已更新');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await post('/api/auth/logout');
    await qc.invalidateQueries();
    toast.success('已退出登录');
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
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-sm py-8">
        <Card className="p-6 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-full bg-surface-sunken text-ink-tertiary">
            <UserRound size={18} />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">还未登录</p>
          <p className="mt-1 text-[13px] text-ink-secondary">会话 Cookie 不存在或已过期。</p>
          <Button className="mt-5 w-full" onClick={() => router.push('/join')}>
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
        title="我的资料"
        desc="联系方式仅在申请被接受后对交易对手方可见。"
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-3 border-b border-line pb-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-sunken text-base font-medium text-ink-secondary">
              {me.user.nickname.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{me.user.nickname}</div>
              <div className="flex items-center gap-1 text-xs text-ink-tertiary">
                <ShieldCheck size={12} />
                {me.currentCommunity.name} · 正式成员
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="昵称">
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={30}
              />
            </Field>

            <Field
              label="联系方式"
              hint="留空即清空。只在申请被接受后对交易对手方展示，详情页永不返回。"
            >
              <Input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                maxLength={120}
                placeholder="微信号 / 手机号"
              />
            </Field>

            <Button className="w-full" disabled={saving} onClick={save}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              保存资料
            </Button>
          </div>

          <div className="mt-6 border-t border-line pt-4">
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
              <Building2 size={13} /> 所属社区（{me.memberships.length}）
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {me.memberships.map((m, i) => {
                if (m.communityId === me.currentCommunity.id) {
                  return (
                    <span
                      key={m.communityId}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-ink bg-ink px-2.5 text-[11px] text-white"
                    >
                      <MapPin size={11} />
                      {me.currentCommunity.name}
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
                    className={cn(
                      'h-7 rounded-full border border-line bg-surface px-2.5 text-[11px] text-ink-secondary transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50',
                    )}
                  >
                    {switching === m.communityId ? '切换中…' : `第 ${i + 1} 个社区`}
                  </button>
                );
              })}
            </div>

            <Button variant="ghost" size="sm" className="mt-4 text-danger" onClick={logout}>
              <LogOut size={14} /> 退出登录
            </Button>
          </div>
        </Card>

        <MyItemsPanel />
      </div>

      <Card className="flex gap-2 p-4 text-[13px] leading-relaxed text-ink-secondary">
        <Info size={14} className="mt-0.5 shrink-0 text-ink-tertiary" />
        <p>
          退出登录调用 <code className="font-mono">POST /api/auth/logout</code> 清除 HttpOnly
          Cookie；切换社区走 <code className="font-mono">POST /api/auth/switch</code>。
        </p>
      </Card>
    </div>
  );
}
