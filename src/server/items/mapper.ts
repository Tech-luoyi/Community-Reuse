/**
 * DB 行 → DTO 映射（含 `Decimal` → `number`，闭环自查表 P3）。
 *
 * 为什么必须显式转换：`$queryRaw` 对 PG `numeric` 列返回 **`Prisma.Decimal`**，
 * 而契约的 `ItemDtoSchema.price` 是 `z.number().nonnegative().nullable()`；
 * `age_hours`（`EXTRACT(...)` 在 PG16 为 `numeric`）同理。若不转换，DTO 会带 `Decimal` 实例、校验失败。
 */
import type { Prisma } from '@prisma/client';

import { itemDetailContactText } from '@/server/auth/contact';
import { bucketFreshness } from '@/server/freshness';
import type {
  Freshness,
  ItemDetailDto,
  ItemDto,
  ItemImage,
  ItemStatus,
  TradeType,
  UserSummary,
} from '@/shared/types';

/** `Item` 列表行（`ITEM_SELECT` 的形状）。 */
export interface RawItemRow {
  id: string;
  communityId: string;
  name: string;
  category: string | null;
  description: string;
  tradeType: TradeType;
  price: Prisma.Decimal | null;
  status: ItemStatus;
  publishedAt: Date;
  /** PG16 `EXTRACT(...)` 为 numeric → Prisma 给 Decimal；兼容 number/string 以防驱动差异。 */
  age_hours: Prisma.Decimal | number | string;
  owner_id: string;
  owner_nickname: string;
  cover_url: string | null;
  favorite_count: number;
  claim_count: number;
}

/** `ITEM_BY_ID_SQL` 行（列表行 + viewer 关系标记）。 */
export interface RawItemWithViewerRow extends RawItemRow {
  is_favorite: boolean;
  is_accepted_applicant: boolean;
}

/** `ITEM_IMAGES_SQL` 行。 */
export interface RawItemImageRow {
  url: string;
  sortOrder: number;
}

type NumericInput = Prisma.Decimal | number | string;

/** `Decimal | number | string` → `number`；null 透传。 */
function toNumber(value: NumericInput | null): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return value.toNumber();
}

/** 非空数值列 → `number`（缺省按 0）。 */
function toRequiredNumber(value: NumericInput): number {
  return toNumber(value) ?? 0;
}

/** 列表行 → `ItemDto`。 */
export function mapItemRow(row: RawItemRow): ItemDto {
  const ageHours = toRequiredNumber(row.age_hours);
  const { code, label } = bucketFreshness(ageHours);
  const freshness: Freshness = { code, label, ageHours };
  const owner: UserSummary = { id: row.owner_id, nickname: row.owner_nickname };

  return {
    id: row.id,
    communityId: row.communityId,
    name: row.name,
    category: row.category,
    description: row.description,
    tradeType: row.tradeType,
    price: toNumber(row.price),
    status: row.status,
    publishedAt: row.publishedAt.toISOString(),
    coverUrl: row.cover_url,
    owner,
    favoriteCount: toRequiredNumber(row.favorite_count),
    claimCount: toRequiredNumber(row.claim_count),
    freshness,
  };
}

/** 图片行 → `ItemImage`。 */
export function mapItemImageRow(row: RawItemImageRow): ItemImage {
  return { url: row.url, sortOrder: toRequiredNumber(row.sortOrder) };
}

/**
 * 详情行 + 图片 → `ItemDetailDto`。
 * `contactText` 恒取自 {@link itemDetailContactText}（字面 `null`，D1 硬规则）。
 */
export function mapItemDetailRow(
  row: RawItemWithViewerRow,
  viewerId: string,
  images: RawItemImageRow[],
): ItemDetailDto {
  const base = mapItemRow(row);
  const isOwner = row.owner_id === viewerId;
  const isFavorite = row.is_favorite;
  const isAcceptedApplicant = row.is_accepted_applicant;

  return {
    ...base,
    images: images.map(mapItemImageRow),
    viewer: {
      isOwner,
      isFavorite,
      canClaim: row.status === 'ACTIVE' && !isOwner && !isAcceptedApplicant,
      isAcceptedApplicant,
    },
    contactText: itemDetailContactText(),
  };
}
