import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * 空态。
 *
 * 必须区分「筛选后没有结果」和「本社区确实没有」两种语义 —— 前者给出清除筛选的动作，
 * 后者不该让人以为是 bug。调用方通过 `action` 决定，组件本身不猜。
 */
export function EmptyState({
  icon: Icon,
  title,
  desc,
  action,
  className,
}: {
  icon?: React.ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
  title: string;
  desc?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      {Icon && (
        <span className="mb-3 grid size-9 place-items-center rounded-md border border-line bg-sunken">
          <Icon size={16} className="text-ink-3" strokeWidth={1.75} aria-hidden />
        </span>
      )}
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {desc && (
        <p className="mt-1.5 max-w-[42ch] text-[12.5px] leading-relaxed text-ink-2">{desc}</p>
      )}
      {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
    </div>
  );
}
