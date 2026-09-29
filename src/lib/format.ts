import type { BadgeTone } from '@/components/ui';
import type { ClaimStatus, FreshnessCode, ItemStatus, TradeType } from '@/shared/types';

export const TRADE_TYPE_LABEL: Record<TradeType, string> = {
  FREE: '免费送',
  PAY_WHATEVER: '随便给',
  FIXED_PRICE: '标价',
  OTHER: '面议',
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  ACTIVE: '在架',
  RESERVED: '待面交',
  ARCHIVED: '已送出',
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

/**
 * 新鲜度 → 色板。
 *
 * 上一版这里直接吐一串 Tailwind 类（`bg-emerald-500 text-white shadow-[0_0_18px_…]`），
 * 于是同一个"状态"的配色散落在组件、页面、以及调用方各自拼类名三处，
 * 改配色要全仓库搜。现在只返回 `BadgeTone`，配色归 `ui.tsx` 单一来源。
 */
export function freshnessTone(code: FreshnessCode): BadgeTone {
  switch (code) {
    case 'JUST_LISTED':
      return 'available';
    case 'NEW':
      return 'info';
    case 'OLDER':
      return 'done';
  }
}

/** 物品状态 → 统一的「文案 + 色调」。同一状态在所有页面用这一处映射。 */
export function itemStatusMeta(status: ItemStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'ACTIVE':
      return { label: '在架', tone: 'available' };
    case 'RESERVED':
      return { label: '待面交', tone: 'reserved' };
    case 'ARCHIVED':
      return { label: '已送出', tone: 'archived' };
  }
}

/** 申请状态 → 统一的「文案 + 色调」。取代原先散在 3 个组件里的三元链。 */
export function claimStatusMeta(status: ClaimStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'PENDING':
      return { label: '待处理', tone: 'pending' };
    case 'ACCEPTED':
      return { label: '已接受', tone: 'available' };
    case 'REJECTED':
      return { label: '已拒绝', tone: 'danger' };
    case 'CANCELED':
      return { label: '已取消', tone: 'done' };
    case 'COMPLETED':
      return { label: '已完成', tone: 'done' };
  }
}
