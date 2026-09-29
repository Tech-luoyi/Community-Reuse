'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  Compass,
  Heart,
  LayoutDashboard,
  LogOut,
  PlusCircle,
  Recycle,
  User,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { get, post } from '@/lib/api';
import { Button } from './ui';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMe } from '@/hooks/use-me';
import type { NotificationDto } from '@/shared/schemas';

const NAV = [
  { href: '/', label: '发现', icon: Compass },
  { href: '/dashboard', label: '看板', icon: LayoutDashboard },
  { href: '/items/new', label: '发布', icon: PlusCircle },
  { href: '/requests', label: '请求', icon: Recycle },
  { href: '/favorites', label: '收藏', icon: Heart },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();

  /** 登出：清 Cookie（幂等）→ 清空查询缓存 → 回首页。失败也不阻断本地登出。 */
  async function logout() {
    try {
      await post('/api/auth/logout');
    } catch {
      // 服务端不可达时仍清本地态：会话 Cookie 已随响应过期或将被下次请求拒绝。
    }
    qc.clear();
    toast.success('已退出登录');
    router.push('/');
    router.refresh();
  }

  /*
    红点取自 `GET /api/me/notifications?unreadOnly=true`（契约 §6）的真实条数。
    读不到时 `unread` 为 undefined，此时不渲染任何角标 —— 而不是显示 0，
    因为 0 会被读成「没有新通知」这个假事实。
  */
  const { data: unread } = useQuery({
    queryKey: ['notifications-badge'],
    queryFn: () => get<NotificationDto[]>('/api/me/notifications', { unreadOnly: true }),
    enabled: !!me,
    refetchInterval: 60_000,
  });
  const unreadCount = unread?.length;

  return (
    <div className="min-h-dvh">
      {/*
        顶栏是 sticky 全宽层：原先挂 `backdrop-blur-xl`，等于每帧对整条横幅后面的
        所有像素做一次高斯模糊。换成不透明白底后视觉几乎无差，但省掉一个常驻模糊层。
      */}
      <header className="sticky top-0 z-40 border-b border-stone-200/60 bg-cream-50/95">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-stone-900 text-xl shadow-lg transition-transform duration-200 ease-out group-hover:-rotate-6">
              ♻️
            </span>
            <span className="leading-none">
              <span className="block text-[15px] font-black tracking-tight">邻里流转</span>
              <span className="block text-[11px] font-medium text-emerald-700">
                小区闲置 · 熟人流转
              </span>
            </span>
          </Link>

          <nav className="ml-6 hidden items-center gap-1 lg:flex">
            {NAV.map((n) => {
              const active = pathname === n.href || (n.href !== '/' && pathname.startsWith(n.href));
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    'relative rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-stone-900/[.07] text-stone-900'
                      : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900',
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/notifications"
              title={unreadCount ? `${unreadCount} 条未读通知` : '站内通知'}
              className="relative grid h-10 w-10 place-items-center rounded-2xl border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:shadow"
              aria-label={unreadCount ? `通知（${unreadCount} 条未读）` : '通知'}
            >
              <Bell size={18} className={unreadCount ? 'text-amber-600' : 'text-stone-500'} />
              {!!unreadCount && (
                <span className="absolute -right-1 -top-1 grid min-w-4.5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-black leading-4 text-white shadow">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
            {me ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex h-10 items-center gap-2 rounded-2xl bg-stone-900 py-1 pl-1 pr-3 text-sm font-bold text-white shadow transition hover:-translate-y-0.5 hover:bg-emerald-700"
                    aria-label="用户菜单"
                  >
                    <Avatar size="sm" className="rounded-xl after:rounded-xl">
                      <AvatarFallback className="rounded-xl bg-gradient-to-br from-emerald-400 to-lime-400 text-stone-900">
                        {me.user.nickname.slice(0, 1)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="max-w-20 truncate">{me.user.nickname}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel className="truncate">{me.user.nickname}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => router.push('/me')}>
                    <User /> 个人中心
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => router.push('/notifications')}>
                    <Bell /> 我的通知
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
                    <LogOut /> 退出登录
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link href="/join">
                <Button size="md" variant="accent">
                  加入小区
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-16">{children}</main>

      <nav className="fixed inset-x-3 bottom-3 z-40 rounded-3xl border border-stone-200/70 bg-white p-1.5 shadow-2xl lg:hidden">
        <div className="grid grid-cols-5 gap-1">
          {NAV.map((n) => {
            const active = pathname === n.href || (n.href !== '/' && pathname.startsWith(n.href));
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[11px] font-bold transition',
                  active ? 'bg-stone-900 text-white' : 'text-stone-500',
                )}
              >
                <Icon size={18} />
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <footer className="hidden border-t border-stone-200/60 py-8 text-center text-xs text-stone-400 lg:block">
        邻里流转 Community-Reuse · 让闲置在沉没之前被看到 · Next.js 15 + Prisma + LLM 网关
      </footer>
    </div>
  );
}
