/**
 * 展示层格式化。
 *
 * 纪律：`freshness.ageHours` / `code` / `label` 由服务端在同一条 SQL 里以 DB now() 算出
 * （api-contract.md §2），前端**只做格式化，绝不重新计算时间差**，否则两处会漂移。
 */
import type { ClaimStatus, FreshnessCode, ItemStatus, TradeType } from '@/shared/types';

/** 与 `badgeVariants` 的 tone 取值保持一致；单独定义避免 lib 反向依赖组件。 */
export type ChipTone = 'neutral' | 'accent' | 'info' | 'warning' | 'danger' | 'solid';

export const TRADE_TYPE_LABEL: Record<TradeType, string> = {
  FREE: '免费',
  PAY_WHATEVER: '随给',
  FIXED_PRICE: '标价',
  OTHER: '面议',
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  ACTIVE: '在架',
  RESERVED: '已预约',
  ARCHIVED: '已归档',
};

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  PENDING: '待处理',
  ACCEPTED: '已接受',
  REJECTED: '未通过',
  CANCELED: '已撤回',
  COMPLETED: '已完成',
};

/**
 * 物品状态用弱色：`ACTIVE` 是列表默认筛选值，每行都点一个亮色徽标等于没有重点，
 * 所以 `ItemRow` 对 ACTIVE 干脆不渲染 chip，这里只给 RESERVED 一个真正的警示色。
 */
export const ITEM_STATUS_TONE: Record<ItemStatus, ChipTone> = {
  ACTIVE: 'neutral',
  RESERVED: 'warning',
  ARCHIVED: 'neutral',
};

export const CLAIM_STATUS_TONE: Record<ClaimStatus, ChipTone> = {
  PENDING: 'info',
  ACCEPTED: 'accent',
  REJECTED: 'danger',
  CANCELED: 'neutral',
  COMPLETED: 'solid',
};

/** 新鲜度用同一色相的三段浓度，不引入第二个色相（见 FreshnessRibbon）。 */
export const FRESHNESS_TONE: Record<FreshnessCode, ChipTone> = {
  JUST_LISTED: 'accent',
  NEW: 'info',
  OLDER: 'neutral',
};

/** 价格展示：`price` 仅在 FIXED_PRICE 有值（§2 不变式），其余交易方式走文案。 */
export function formatPrice(price: number | null, tradeType: TradeType): string {
  if (tradeType === 'FIXED_PRICE') {
    if (price === null) return '待定';
    return Number.isInteger(price) ? `¥${price}` : `¥${price.toFixed(2)}`;
  }
  return TRADE_TYPE_LABEL[tradeType];
}

/** 等宽数字用的短时长：`<1h` / `6h` / `4d`。取整属展示层（§2 G2）。 */
export function formatAgeHours(ageHours: number): string {
  if (ageHours < 1) return '<1h';
  if (ageHours < 24) return `${Math.floor(ageHours)}h`;
  return `${Math.floor(ageHours / 24)}d`;
}

/** ISO → `09-28 14:03`（同年省略年份，跨年补全）。 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: sameYear ? undefined : 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const stamp = `${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
  return sameYear ? stamp : `${pick('year')}-${stamp}`;
}

/** 相对时间。负值（服务端时钟轻微超前）一律按「刚刚」处理，不显示「-3 分钟前」。 */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return '刚刚';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDateTime(iso);
}

/** 交接时长（分钟 → 人话）。 */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

/** CoverPlate 的确定性色板索引：同一物品每次渲染颜色一致，不随会话变化。 */
export function plateTintIndex(seed: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % size;
}
