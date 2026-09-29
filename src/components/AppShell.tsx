'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  Compass,
  Heart,
  Inbox,
  LayoutDashboard,
  LogOut,
  Plus,
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

/*
  导航按「住户要去哪里」分组，不按数据库实体分组。

  上一版是 发现 / 看板 / 发布 / 请求 / 收藏 五项平铺，问题有三层：

  1. **「请求」和「通知」是同一件事被拆成两处。** 两者都在回答
     「有什么在等我」，但一个在导航、一个在顶栏铃铛。铃铛还是个纯图标、
     没有文字的入口 —— 「为什么这个铃铛在响」得点进去才知道。
  2. **「发布」占了宝贵的导航位，但它是一个动作，不是一个地方。**
     发布完就回首页了，没有「发布列表」之类需要驻留的内容。
  3. **「看板」是运营视角，不是住户视角。** 谁会为了看「本月成交 12 件」
     而打开一个 App？但它确实是这个产品最动人的部分（东西真的在流转），
     所以不该删 —— 该从一级导航挪走。

  现在：顶栏承担「流转 / 待办 / 我的」三件事（都是要去的地方），
  「发布」变成一个显眼的动作按钮，「看板」与「收藏」进「我的」。
  导航从 5 项收到 3 项，顶栏宽度从 max-w-5xl 收到 max-w-3xl ——
  标签从两字变成三字，宽度必须跟着调，否则会在 lg 断点折行。
*/
const NAV = [
  { href: '/', label: '流转', icon: Compass },
  { href: '/requests', label: '待办', icon: Inbox, badge: true },
  { href: '/me', label: '我的', icon: User },
];

/** 当前路径是否属于某个导航项（用于高亮）。首页 '/' 单独精确匹配。 */
function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

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
      {/* 顶栏用 --shadow-header 而不是纯 1px 线：内容会从下面滚过，
          需要一点高度差才看得出它在浮着。backdrop-blur 保留。 */}
      <header className="sticky top-0 z-40 border-b border-line/60 bg-canvas/82 shadow-header backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            {/* 品牌绿只出现在这一处标识上，不做按钮填充。 */}
            <span className="grid size-7 place-items-center rounded-md bg-brand text-white shadow-xs">
              <Recycle size={15} strokeWidth={2.25} />
            </span>
            <span className="text-sm font-semibold text-ink">邻里流转</span>
          </Link>

          <nav className="ml-1 hidden items-center gap-0.5 md:flex">
            {NAV.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors',
                    active
                      ? 'bg-surface-sunken font-medium text-ink'
                      : 'text-ink-secondary hover:bg-surface-sunken/60 hover:text-ink',
                  )}
                >
                  {n.label}
                  {n.badge && !!unreadCount && (
                    <span className="grid min-w-4 place-items-center rounded-full bg-pending px-1 text-2xs font-medium leading-4 text-white tabular">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {me ? (
              <>
                {/* 「发布」是动作不是地方：从导航挪到这里，做成一个常驻的次级按钮。 */}
                <Link href="/items/new" className="hidden sm:block">
                  <Button size="sm" variant="secondary">
                    <Plus size={14} /> 发布
                  </Button>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex h-9 items-center gap-2 rounded-md border border-line bg-surface pl-1 pr-2.5 text-sm text-ink shadow-xs transition-[box-shadow,background-color] duration-200 hover:bg-surface-sunken hover:shadow-sm"
                      aria-label="用户菜单"
                    >
                      <Avatar size="sm" className="size-6 rounded-sm">
                        <AvatarFallback className="size-6 rounded-sm bg-surface-sunken text-2xs font-medium text-ink-secondary">
                          {me.user.nickname.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="max-w-20 truncate">{me.user.nickname}</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel className="truncate">{me.user.nickname}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => router.push('/me')}>
                      <User /> 我的资料
                    </DropdownMenuItem>
                    {/* 「看板」和「收藏」从一级导航下来，但没消失 —— 它们是
                        「我关心的小区运转得怎么样」和「我之前看上的东西」，
                        属于「我的」这一层，不是独立目的地。 */}
                    <DropdownMenuItem onSelect={() => router.push('/favorites')}>
                      <Heart /> 我的收藏
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => router.push('/dashboard')}>
                      <LayoutDashboard /> 社区看板
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => router.push('/notifications')}>
                      <Bell /> 通知记录
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
                      <LogOut /> 退出登录
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Link href="/join">
                <Button size="sm">加入小区</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-8 sm:px-6 md:pb-16">
        {children}
      </main>

      {/* 移动端底栏：3 项 + 中间的发布 FAB。原来是 5 项平铺，格子被压得很窄。 */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line/60 bg-canvas/90 shadow-[0_-4px_16px_-8px_color-mix(in_oklab,var(--color-ink)_12%,transparent)] backdrop-blur-xl backdrop-saturate-150 md:hidden">
        <div className="grid grid-cols-3 items-center gap-1 px-2 pb-[env(safe-area-inset-bottom)]">
          {NAV.map((n) => {
            if (n.href === '/requests') {
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={isActive(pathname, n.href) ? 'page' : undefined}
                  className="flex flex-col items-center gap-1 py-2.5 text-2xs text-ink-tertiary transition-colors"
                >
                  <span className="relative">
                    <Inbox size={20} strokeWidth={isActive(pathname, n.href) ? 2.25 : 1.75} />
                    {!!unreadCount && (
                      <span className="absolute -right-1.5 -top-1 grid min-w-4 place-items-center rounded-full bg-pending px-1 text-[9px] font-medium leading-4 text-white tabular">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </span>
                  {n.label}
                </Link>
              );
            }
            const Icon = n.icon;
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-2.5 text-2xs transition-colors',
                  active ? 'text-ink' : 'text-ink-tertiary',
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <footer className="hidden border-t border-line py-6 text-center text-2xs text-ink-tertiary md:block">
        邻里流转 · 让闲置在沉没之前被看到
      </footer>
    </div>
  );
}
