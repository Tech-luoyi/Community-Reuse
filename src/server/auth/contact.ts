/**
 * D1 联系方式可见性（硬规则）+ `contactText` 写入归一化。
 *
 * 事实源：docs/api-contract.md §0.3 / §2 / §4。
 *   - 物品详情（`ItemDetailDto.contactText`）：对**任何人**恒为 `null`（字段仅为契约稳定）。
 *   - 领取申请（`ClaimDto.contactText`）：仅当 `status ∈ {ACCEPTED, COMPLETED}` 时，
 *     向**交易对手方**返回对方联系方式；其余状态恒 `null`。
 *   - 唯一写入路径是 `PATCH /api/me`：**空串等价于清空为 `null`**（长度上限对齐 `@db.VarChar(120)`）。
 *
 * 本模块为纯函数（无副作用、无 DB），供各服务层 / 路由复用，并作为 D1 的单点事实。
 */
import type { ClaimStatus } from '@/shared/types';

/** `contactText` 长度上限（对齐 schema.prisma 的 `@db.VarChar(120)`）。 */
export const CONTACT_TEXT_MAX_LENGTH = 120;

/** 物品详情接口：联系方式对任何人恒为 `null`（D1）。 */
export function itemDetailContactText(): null {
  return null;
}

export interface ClaimContactInput {
  /** 申请状态。 */
  status: ClaimStatus;
  /** 观看者（当前用户）id。 */
  viewerId: string;
  /** 物品发布者 id。 */
  ownerId: string;
  /** 申请人 id。 */
  applicantId: string;
  /** 发布者的联系方式。 */
  ownerContactText: string | null;
  /** 申请人的联系方式。 */
  applicantContactText: string | null;
}

/**
 * 领取申请中，观看者可见的联系方式。
 * 仅 `ACCEPTED` / `COMPLETED` 且观看者是交易一方时，返回**对方**的联系方式；否则 `null`。
 */
export function claimContactTextForViewer(input: ClaimContactInput): string | null {
  if (input.status !== 'ACCEPTED' && input.status !== 'COMPLETED') {
    return null;
  }
  if (input.viewerId === input.ownerId) {
    return input.applicantContactText;
  }
  if (input.viewerId === input.applicantId) {
    return input.ownerContactText;
  }
  return null;
}

/**
 * 归一化 `PATCH /api/me` 的 `contactText` 输入：
 *   - `undefined`   → `undefined`（保持不动，不写入该字段）；
 *   - 空串 / 纯空白 → `null`（清空）；
 *   - 其它          → 去除首尾空白后的字符串。
 * @throws RangeError 归一化后长度 > {@link CONTACT_TEXT_MAX_LENGTH}（服务层应据此抛 INVALID_INPUT）
 */
export function normalizeContactText(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (trimmed.length > CONTACT_TEXT_MAX_LENGTH) {
    throw new RangeError(`contactText 长度不得超过 ${CONTACT_TEXT_MAX_LENGTH}`);
  }
  return trimmed;
}
