'use client';

import * as React from 'react';

import { cn } from '@/lib/cn';
import { plateTintIndex } from '@/lib/format';

/**
 * 图片兜底盘。
 *
 * 现状是 `public/uploads/` 为空目录，种子封面全部 404，所以这个盘子**就是全站主视觉**，
 * 不是异常分支。策略是「排版盘常驻，真实图片加载成功后才盖上来」，
 * 任何情况下都不会露出浏览器的破图图标。
 *
 * 着色按 `category` 哈希而非随机数：同品类同色，颜色因此携带信息而不是装饰。
 * 刻意不用 next/image —— 种子图是 SVG，走 next/image 必须开 `dangerouslyAllowSVG`，
 * 那是个 XSS 口子，不值得为兜底盘承担。
 */
const TINTS = [
  { bg: '#e8e4da', fg: '#6d6555' },
  { bg: '#dee8e2', fg: '#4d6157' },
  { bg: '#e9e2dc', fg: '#6f5c52' },
  { bg: '#dde4ea', fg: '#515f6c' },
  { bg: '#e5e5d8', fg: '#5e6049' },
] as const;

const TINT_FALLBACK = { bg: '#e8e4da', fg: '#6d6555' };

const SIZE_CLASS = {
  sm: { box: 'size-16 rounded-md', glyph: 'text-[21px]' },
  md: { box: 'size-full rounded-lg', glyph: 'text-[38px]' },
  lg: { box: 'size-full rounded-lg', glyph: 'text-[64px]' },
} as const;

export interface CoverPlateProps {
  /** 后端返回的 `coverUrl` / `images[].url`，前端不自行拼接路径。 */
  src?: string | null;
  name: string;
  /** 传了就按品类着色；为空则退回按名称着色，保证同一物品颜色稳定。 */
  category?: string | null;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}

export function CoverPlate({ src, name, category, size = 'sm', className }: CoverPlateProps) {
  // 记住「哪个 src 失败了」而不是布尔量，这样 src 变化时状态自动重新计算，无需 effect
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null);

  const shouldLoad = src !== null && src !== undefined && src.length > 0 && failedSrc !== src;
  const isShown = shouldLoad && loadedSrc === src;

  const tint = TINTS[plateTintIndex(category?.trim() || name, TINTS.length)] ?? TINT_FALLBACK;
  const glyph = Array.from(name.trim())[0] ?? '物';
  const shape = SIZE_CLASS[size];

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden ring-1 ring-line ring-inset',
        shape.box,
        className,
      )}
      style={{ backgroundColor: tint.bg }}
    >
      <div className="absolute inset-0 grid place-items-center" aria-hidden>
        <span
          className={cn('font-semibold leading-none select-none', shape.glyph)}
          style={{ color: tint.fg }}
        >
          {glyph}
        </span>
      </div>

      {shouldLoad && (
        // eslint-disable-next-line @next/next/no-img-element -- 见文件头：SVG 封面不能走 next/image
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-[260ms] ease-out',
            isShown ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  );
}
