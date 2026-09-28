/**
 * 邻里流转 · 共享 DTO 类型（由 `src/shared/schemas.ts` 的 Zod schema 推导）
 * ---------------------------------------------------------------------------
 * 所有对外（HTTP 契约）的类型都从这里取，确保「schema 即契约、类型即 schema」。
 * 前端与后端都只 import 本文件 / `schemas.ts`（唯一共享边界）。
 */
import { z } from 'zod';

import {
  AiKindSchema,
  AiMetaSchema,
  AiSourceSchema,
  ClaimStatusSchema,
  CommunitySummarySchema,
  CreateItemRequestSchema,
  ErrorBodySchema,
  ErrorCodeSchema,
  ErrorDetailSchema,
  FaqRequestSchema,
  FaqResultSchema,
  FreshnessCodeSchema,
  FreshnessSchema,
  HealthDataSchema,
  ItemDetailDtoSchema,
  ItemDtoSchema,
  ItemImageSchema,
  ItemListQuerySchema,
  ItemSortSchema,
  ItemStatusSchema,
  ItemViewerSchema,
  JoinRequestSchema,
  JoinResponseDataSchema,
  MeResponseDataSchema,
  MembershipSchema,
  MessageSenderTypeSchema,
  NotificationTypeSchema,
  PaginationSchema,
  PatchMeRequestSchema,
  PolishRequestSchema,
  PolishResultSchema,
  PricingModeSchema,
  PricingRequestSchema,
  PricingResultSchema,
  SwitchCommunityRequestSchema,
  TradeTypeSchema,
  UpdateItemRequestSchema,
  UserSelfSchema,
  UserSummarySchema,
} from './schemas';

/* ---- 通用 ---- */
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
export type Pagination = z.infer<typeof PaginationSchema>;

/* ---- 枚举 ---- */
export type ItemStatus = z.infer<typeof ItemStatusSchema>;
export type TradeType = z.infer<typeof TradeTypeSchema>;
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
export type MessageSenderType = z.infer<typeof MessageSenderTypeSchema>;
export type AiKind = z.infer<typeof AiKindSchema>;
export type FreshnessCode = z.infer<typeof FreshnessCodeSchema>;

/* ---- 鉴权与身份 ---- */
export type UserSummary = z.infer<typeof UserSummarySchema>;
export type UserSelf = z.infer<typeof UserSelfSchema>;
export type CommunitySummary = z.infer<typeof CommunitySummarySchema>;
export type Membership = z.infer<typeof MembershipSchema>;
export type JoinRequest = z.infer<typeof JoinRequestSchema>;
export type JoinResponseData = z.infer<typeof JoinResponseDataSchema>;
export type MeResponseData = z.infer<typeof MeResponseDataSchema>;
export type PatchMeRequest = z.infer<typeof PatchMeRequestSchema>;
export type SwitchCommunityRequest = z.infer<typeof SwitchCommunityRequestSchema>;

/* ---- 物品 ---- */
export type Freshness = z.infer<typeof FreshnessSchema>;
export type ItemImage = z.infer<typeof ItemImageSchema>;
export type ItemDto = z.infer<typeof ItemDtoSchema>;
export type ItemDetailDto = z.infer<typeof ItemDetailDtoSchema>;
export type ItemViewer = z.infer<typeof ItemViewerSchema>;
export type ItemSort = z.infer<typeof ItemSortSchema>;
export type ItemListQuery = z.infer<typeof ItemListQuerySchema>;
export type CreateItemRequest = z.infer<typeof CreateItemRequestSchema>;
export type UpdateItemRequest = z.infer<typeof UpdateItemRequestSchema>;

/* ---- LLM ---- */
export type AiSource = z.infer<typeof AiSourceSchema>;
export type AiMeta = z.infer<typeof AiMetaSchema>;
export type PricingRequest = z.infer<typeof PricingRequestSchema>;
export type PricingMode = z.infer<typeof PricingModeSchema>;
export type PricingResult = z.infer<typeof PricingResultSchema>;
export type PolishRequest = z.infer<typeof PolishRequestSchema>;
export type PolishResult = z.infer<typeof PolishResultSchema>;
export type FaqRequest = z.infer<typeof FaqRequestSchema>;
export type FaqResult = z.infer<typeof FaqResultSchema>;

/* ---- 健康检查 ---- */
export type HealthData = z.infer<typeof HealthDataSchema>;
