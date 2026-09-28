'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { IdentitySlot } from '@/components/features/identity-slot';
import { cn } from '@/lib/cn';
import { NAV_SECTIONS, isNavActive, type NavItem } from '@/lib/nav';

/**
 * 左侧栏导航（Linear 式 app 外壳，不是营销落地页）。
 *
 * 是 client component 只因为需要 `usePathname` 高亮当前项与移动抽屉的开合状态；
 * 它自己不做鉴权，底部身份槽是一枚读 `GET /api/me` 的客户端岛，
 * 所以服务端外壳永远能渲染出来，会话未到时只有那一小块是骨架、外壳零位移。
 */

function NavEntry({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = item.stage === 'live' && isNavActive(item.href, pathname);
  const Icon = item.icon;

  const body = (
    <>
      <Icon
        size={15}
        strokeWidth={1.75}
        aria-hidden
        className={cn(
          'shrink-0 transition-colors duration-[170ms]',
          active ? 'text-ink' : 'text-ink-3',
        )}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.stage !== 'live' && (
        <span
          className="tnum shrink-0 text-[10px] text-ink-3"
          title={`计划第 ${item.stage} 步交付`}
        >
          #{item.stage}
        </span>
      )}
    </>
  );

  const sharedClass = cn(
    'relative flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-[13px]',
    'transition-[color,background-color] duration-[170ms] ease-out',
    active
      ? 'bg-sunken font-medium text-ink'
      : item.stage === 'live'
        ? 'text-ink-2 hover:bg-sunken/70 hover:text-ink'
        : 'cursor-default text-ink-3/75',
  );

  if (item.stage !== 'live') {
    return (
      <span className={sharedClass} aria-disabled="true" data-nav-active={active}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={sharedClass}
      data-nav-active={active}
      aria-current={active ? 'page' : undefined}
    >
      {body}
    </Link>
  );
}

/** 选中项左规则线：整块导航只有一根，切换时滑到新位置（含跨分组），因此"从哪来、到哪去"可见。 */
const BAR_HEIGHT = 16;

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [barTop, setBarTop] = React.useState<number | null>(null);

  // 桌面侧栏在 <lg 是 display:none，此时量到的高度为 0，先把指示条藏起来；
  // ResizeObserver 会在它重新显示时触发复量，所以不需要额外的断点监听。
  React.useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const measure = () => {
      const active = wrap.querySelector<HTMLElement>('[data-nav-active="true"]');
      if (!active) {
        setBarTop(null);
        return;
      }
      const wrapBox = wrap.getBoundingClientRect();
      const activeBox = active.getBoundingClientRect();
      if (activeBox.height === 0) {
        setBarTop(null);
        return;
      }
      setBarTop(activeBox.top - wrapBox.top + (activeBox.height - BAR_HEIGHT) / 2);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <div ref={wrapRef} className="relative">
      <span
        aria-hidden
        className={cn(
          'absolute top-0 left-0 w-[2px] rounded-full bg-accent',
          'ease-out transition-transform duration-[260ms]',
          barTop === null ? 'opacity-0 transition-none' : '',
        )}
        style={{ height: BAR_HEIGHT, transform: `translateY(${barTop ?? 0}px)` }}
      />
      <nav className="flex flex-col gap-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.eyebrow} className="space-y-0.5">
            <div className="label-xs px-2.5 pb-1.5">{section.eyebrow}</div>
            <div className="space-y-px">
              {section.items.map((item) => (
                <NavEntry key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}

function Wordmark() {
  return (
    <div className="px-2.5 pb-4">
      <div className="text-[15px] leading-none font-semibold tracking-[-0.015em] text-ink">
        邻里流转
      </div>
      <div className="label-xs mt-1.5 font-mono">NEIGHBORHOOD REUSE</div>
    </div>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // 抽屉打开时锁滚动，Esc 关闭；路由变化时自动收起
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* 桌面常驻侧栏 */}
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-paper lg:flex">
        <div className="pt-5">
          <Wordmark />
        </div>
        <div className="mx-2.5 border-t border-line" aria-hidden />
        <div className="hide-scrollbar flex-1 overflow-y-auto px-2.5 py-4">
          <NavList pathname={pathname} />
        </div>
        <div className="hairline-t px-2.5 py-3">
          <IdentitySlot />
        </div>
      </aside>

      {/* 移动端顶栏 */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-13 items-center justify-between border-b border-line bg-paper px-4 lg:hidden">
        <div className="text-[14px] font-semibold tracking-[-0.015em] text-ink">邻里流转</div>
        <button
          type="button"
          aria-label={open ? '关闭导航' : '打开导航'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="grid size-8 place-items-center rounded-sm text-ink-2 transition-colors duration-[110ms] hover:bg-sunken hover:text-ink"
        >
          {open ? <X size={17} aria-hidden /> : <Menu size={17} aria-hidden />}
        </button>
      </div>

      {/* 移动端抽屉 */}
      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={cn(
            'absolute inset-0 bg-ink/25 transition-opacity duration-[170ms] ease-out',
            open ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 flex w-[264px] max-w-[85vw] flex-col border-r border-line bg-paper',
            'transition-transform duration-[170ms] ease-out',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="pt-5">
            <Wordmark />
          </div>
          <div className="mx-2.5 border-t border-line" aria-hidden />
          <div className="flex-1 overflow-y-auto px-2.5 py-4">
            <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
          <div className="hairline-t px-2.5 py-3">
            <IdentitySlot />
          </div>
        </div>
      </div>
    </>
  );
}
