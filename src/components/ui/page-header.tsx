import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * 页头：全站「字号字重强对比」的锚点。
 *
 * 11px 全大写等宽眉标 ⇄ 26px 半粗标题，中间不塞任何装饰。
 * 纸墨 + 发丝线的方案要靠这种真实对比撑住质感，
 * 否则整页统一 14px 灰字会读成没画完的线框图。
 */
export function PageHeader({
  eyebrow,
  title,
  desc,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  desc?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-5', className)}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <div className="label-xs font-mono">{eyebrow}</div>}
        <h1 className="text-[26px] leading-[1.15] font-semibold tracking-[-0.021em] text-ink">
          {title}
        </h1>
        {desc && <p className="max-w-[68ch] text-[13px] leading-relaxed text-ink-2">{desc}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
