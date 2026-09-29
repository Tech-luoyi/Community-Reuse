'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Compass, Heart, LayoutDashboard, LogOut, Plus, Recycle, User } from 'lucide-react';
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
  { href: '/items/new', label: '发布', icon: Plus },
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
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-ink text-white">
              <Recycle size={15} strokeWidth={2.25} />
            </span>
            <span className="text-sm font-semibold tracking-[-0.01em] text-ink">邻里流转</span>
          </Link>

          <nav className="ml-2 hidden items-center gap-0.5 md:flex">
            {NAV.map((n) => {
              const active = pathname === n.href || (n.href !== '/' && pathname.startsWith(n.href));
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                    active
                      ? 'bg-surface-sunken font-medium text-ink'
                      : 'text-ink-secondary hover:bg-surface-sunken/60 hover:text-ink',
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
              className={cn(
                'relative grid size-9 place-items-center rounded-md text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink',
                unreadCount ? 'text-ink' : '',
              )}
              aria-label={unreadCount ? `通知（${unreadCount} 条未读）` : '通知'}
            >
              <Bell size={17} />
              {!!unreadCount && (
                <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-danger text-[10px] font-medium text-white tabular">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
            {me ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex h-9 items-center gap-2 rounded-md border border-line bg-surface pl-1 pr-2.5 text-[13px] text-ink transition-colors hover:bg-surface-sunken"
                    aria-label="用户菜单"
                  >
                    <Avatar size="sm" className="size-6 rounded-sm">
                      <AvatarFallback className="size-6 rounded-sm bg-surface-sunken text-[11px] font-medium text-ink-secondary">
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
                <Button size="sm">加入小区</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-8 sm:px-6 md:pb-16">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 backdrop-blur-md md:hidden">
        <div className="grid grid-cols-5">
          {NAV.map((n) => {
            const active = pathname === n.href || (n.href !== '/' && pathname.startsWith(n.href));
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[10px] transition-colors',
                  active ? 'text-ink' : 'text-ink-tertiary',
                )}
              >
                <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <footer className="hidden border-t border-line py-6 text-center text-xs text-ink-tertiary md:block">
        邻里流转 · 让闲置在沉没之前被看到
      </footer>
    </div>
  );
}
