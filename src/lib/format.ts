import type { FreshnessCode, TradeType } from '@/shared/types';

export const TRADE_TYPE_LABEL: Record<TradeType, string> = {
  FREE: '免费送',
  PAY_WHATEVER: '随便给',
  FIXED_PRICE: '标价',
  OTHER: '面议',
};

export const TRADE_TYPE_EMOJI: Record<TradeType, string> = {
  FREE: '🎁',
  PAY_WHATEVER: '☕',
  FIXED_PRICE: '💰',
  OTHER: '💬',
};

export function formatPrice(price: number | null, tradeType: TradeType): string {
  if (tradeType === 'FREE') return '免费';
  if (tradeType === 'PAY_WHATEVER') return '随便给';
  if (price === null || price === undefined) return '面议';
  return `¥${Number(price).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

export function formatAgeHours(ageHours: number): string {
  if (ageHours < 1) return `${Math.max(1, Math.round(ageHours * 60))} 分钟前`;
  if (ageHours < 24) return `${Math.floor(ageHours)} 小时前`;
  return `${Math.floor(ageHours / 24)} 天前`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function freshnessStyle(code: FreshnessCode): string {
  switch (code) {
    case 'JUST_LISTED':
      return 'bg-emerald-500 text-white shadow-[0_0_18px_rgba(16,185,129,.55)]';
    case 'NEW':
      return 'bg-amber-400 text-stone-900 shadow-[0_0_14px_rgba(251,191,36,.5)]';
    case 'OLDER':
      return 'bg-stone-200 text-stone-600';
  }
}
