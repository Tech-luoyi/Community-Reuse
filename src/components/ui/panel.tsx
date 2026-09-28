import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * 发丝线容器（取代常见的 Card + 阴影）：1px 边框、小圆角、无投影。
 * `PanelHeader` 提供「眉标 + 标题 + 右侧动作」的统一版式，这是全站排版节奏的来源。
 */
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-surface', className)} {...props} />;
}

export function PanelHeader({
  eyebrow,
  title,
  desc,
  action,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  desc?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-line px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow && <div className="label-xs font-mono">{eyebrow}</div>}
        <h2 className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {desc && <p className="text-[12.5px] leading-relaxed text-ink-2">{desc}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** 下沉的信息块：用于说明性文字、契约缺口、元信息表。 */
export function Inset({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-md border border-line bg-sunken px-4 py-3', className)}
      {...props}
    />
  );
}

/** 键值元信息表：等宽值列，避免数字长度不同导致的锯齿。 */
export function MetaList({
  rows,
  className,
}: {
  rows: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn('divide-y divide-line text-[12.5px]', className)}>
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="shrink-0 text-ink-3">{row.label}</dt>
          <dd className="min-w-0 truncate text-right font-medium text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
