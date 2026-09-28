import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * 契约缺口标记。
 *
 * 本轮范围是「只做前端，不补后端」，所以缺失的接口不是要藏起来的破口，
 * 而是一份可见的契约审计。全站 6 处复用同一套版式：
 * 下沉表面 + 2px accent 左规则线 + 全大写眉标 + 等宽写出方法路径 + 一句正常语序说明。
 *
 * 刻意不加警告三角、不用红色、不出现「错误」字样 —— 这是工程纪律的展示，不是故障。
 */
export function ContractGap({
  section,
  endpoint,
  existsInstead,
  className,
}: {
  /** 契约章节号，例如 `§5`。 */
  section: string;
  /** 缺失的接口，写成 `METHOD /path` 原样，等宽呈现。 */
  endpoint: string;
  /** 一句正常语序说明「已经存在什么」，让读者知道这不是空白页。 */
  existsInstead: React.ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        'rounded-md border border-line border-l-2 border-l-accent bg-sunken px-4 py-3',
        className,
      )}
    >
      <div className="label-xs font-mono">契约缺口 · {section}</div>
      <div className="tnum mt-1.5 text-[12.5px] font-medium text-ink">{endpoint}</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{existsInstead}</p>
    </aside>
  );
}
