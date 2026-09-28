/**
 * 邻里流转 · 唯一共享边界（Single Shared Boundary）
 * ---------------------------------------------------------------------------
 * 本文件是前端与后端**唯一**共享的契约层（Zod schema）。
 *
 * D8 解耦纪律（见 docs/api-contract.md §10）：
 *   - 前端只 import：src/shared/**、src/lib/**、src/components/**
 *   - 后端（src/server/**、src/app/api/**）只 import：src/shared/**、src/server/**、npm 包
 *   - 禁止后端 import 任何前端组件 / 页面类型
 *
 * 事实源：docs/api-contract.md。改接口先改契约，再改本文件，最后各自实现。
 * 一致性：枚举值 / 字段名 / 长度上限与 docs/schema.prisma 对齐。
 */
import { z } from 'zod';

/* ===========================================================================
 * 1. 通用：错误码 / 响应信封
 * =========================================================================== */

/** 错误码（与 docs/api-contract.md §0.2 完全一致）。 */
export const ERROR_CODES = [
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CLAIM_CONFLICT',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL',
  'DEPENDENCY_UNAVAILABLE',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

/** 失败信封：`{ error: { code, message, details? } }` */
export const ErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    details: z.array(ErrorDetailSchema).optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** 分页信息（仅列表接口返回）。 */
export const PaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type Pagination = z.infer<typeof PaginationSchema>;

/** 成功信封：`{ data }` */
export function successEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data });
}

/** 列表信封：`{ data, pagination }` */
export function paginatedEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data: z.array(data), pagination: PaginationSchema });
}

/* ===========================================================================
 * 2. 与 schema.prisma 对齐的枚举
 * =========================================================================== */

export const ItemStatusSchema = z.enum(['ACTIVE', 'RESERVED', 'ARCHIVED']);
export const TradeTypeSchema = z.enum(['FREE', 'PAY_WHATEVER', 'FIXED_PRICE', 'OTHER']);
export const ClaimStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELED',
  'COMPLETED',
]);
export const NotificationTypeSchema = z.enum([
  'CLAIM_RECEIVED',
  'CLAIM_ACCEPTED',
  'CLAIM_REJECTED',
  'CLAIM_COMPLETED',
  'ITEM_RESERVED',
  'ITEM_ARCHIVED',
]);
export const MessageSenderTypeSchema = z.enum(['USER', 'AI']);
export const AiKindSchema = z.enum(['PRICING', 'POLISH', 'FAQ']);
export const FreshnessCodeSchema = z.enum(['JUST_LISTED', 'NEW', 'OLDER']);

export type ItemStatus = z.infer<typeof ItemStatusSchema>;
export type TradeType = z.infer<typeof TradeTypeSchema>;
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
export type MessageSenderType = z.infer<typeof MessageSenderTypeSchema>;
export type AiKind = z.infer<typeof AiKindSchema>;
export type FreshnessCode = z.infer<typeof FreshnessCodeSchema>;

/* ===========================================================================
 * 3. 鉴权与身份（api-contract.md §1）
 * =========================================================================== */

export const NICKNAME_MAX = 30;
export const CONTACT_TEXT_MAX = 120;

export const UserSummarySchema = z.object({
  id: z.string().min(1),
  nickname: z.string().min(1).max(NICKNAME_MAX),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

/** 当前用户自身的资料（含 contactText，仅本人可见）。 */
export const UserSelfSchema = z.object({
  id: z.string().min(1),
  nickname: z.string().min(1).max(NICKNAME_MAX),
  contactText: z.string().max(CONTACT_TEXT_MAX).nullable(),
});
export type UserSelf = z.infer<typeof UserSelfSchema>;

export const CommunitySummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
});
export type CommunitySummary = z.infer<typeof CommunitySummarySchema>;

/** 定稿决策：砍除治理模块后 `CommunityMember.role` 已移除，memberships 只返回 communityId。 */
export const MembershipSchema = z.object({
  communityId: z.string().min(1),
});
export type Membership = z.infer<typeof MembershipSchema>;

export const JoinRequestSchema = z.object({
  inviteCode: z.string().trim().min(1).max(60),
  nickname: z.string().trim().min(1).max(NICKNAME_MAX),
});
export type JoinRequest = z.infer<typeof JoinRequestSchema>;

export const JoinResponseDataSchema = z.object({
  user: UserSummarySchema,
  community: CommunitySummarySchema,
  memberships: z.array(MembershipSchema),
});
export type JoinResponseData = z.infer<typeof JoinResponseDataSchema>;

export const MeResponseDataSchema = z.object({
  user: UserSelfSchema,
  memberships: z.array(MembershipSchema),
  currentCommunity: CommunitySummarySchema,
});
export type MeResponseData = z.infer<typeof MeResponseDataSchema>;

/**
 * `PATCH /api/me` 请求体（D1 唯一写入路径）。
 * `contactText` 传空串等价于清空为 null（由服务层负责归一化）。
 */
export const PatchMeRequestSchema = z.object({
  nickname: z.string().trim().min(1).max(NICKNAME_MAX).optional(),
  contactText: z.string().max(CONTACT_TEXT_MAX).optional(),
});
export type PatchMeRequest = z.infer<typeof PatchMeRequestSchema>;

export const SwitchCommunityRequestSchema = z.object({
  communityId: z.string().min(1),
});
export type SwitchCommunityRequest = z.infer<typeof SwitchCommunityRequestSchema>;

/* ===========================================================================
 * 4. 物品（api-contract.md §2）
 * =========================================================================== */

export const ITEM_NAME_MAX = 80;
export const ITEM_CATEGORY_MAX = 40;
export const ITEM_DESCRIPTION_MAX = 2000;
export const MAX_ITEM_IMAGES = 6;

export const FreshnessSchema = z.object({
  code: FreshnessCodeSchema,
  label: z.string().min(1),
  ageHours: z.number().nonnegative(),
});
export type Freshness = z.infer<typeof FreshnessSchema>;

export const ItemImageSchema = z.object({
  url: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
});
export type ItemImage = z.infer<typeof ItemImageSchema>;

/** 列表项 DTO（D6：补入 `category`；`price` 为 JSON number 或 null）。 */
export const ItemDtoSchema = z.object({
  id: z.string().min(1),
  communityId: z.string().min(1),
  name: z.string().min(1).max(ITEM_NAME_MAX),
  category: z.string().max(ITEM_CATEGORY_MAX).nullable(),
  description: z.string().max(ITEM_DESCRIPTION_MAX),
  tradeType: TradeTypeSchema,
  price: z.number().nonnegative().nullable(),
  status: ItemStatusSchema,
  publishedAt: z.string().datetime(),
  coverUrl: z.string().nullable(),
  owner: UserSummarySchema,
  favoriteCount: z.number().int().nonnegative(),
  claimCount: z.number().int().nonnegative(),
  freshness: FreshnessSchema,
});
export type ItemDto = z.infer<typeof ItemDtoSchema>;

/** 前端按钮态与字段裁剪依据。 */
export const ItemViewerSchema = z.object({
  isOwner: z.boolean(),
  isFavorite: z.boolean(),
  canClaim: z.boolean(),
  isAcceptedApplicant: z.boolean(),
});
export type ItemViewer = z.infer<typeof ItemViewerSchema>;

/** 详情 DTO：D1 硬规则 —— `contactText` 在详情接口对任何人恒为 `null`。 */
export const ItemDetailDtoSchema = ItemDtoSchema.extend({
  images: z.array(ItemImageSchema),
  viewer: ItemViewerSchema,
  contactText: z.null(),
});
export type ItemDetailDto = z.infer<typeof ItemDetailDtoSchema>;

export const ItemSortSchema = z.enum(['latest', 'oldest']);
export type ItemSort = z.infer<typeof ItemSortSchema>;

const BooleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value): boolean => value === true || value === 'true');

/** `GET /api/items` query（D2：默认 `status=ACTIVE` + `sort=latest`）。 */
export const ItemListQuerySchema = z.object({
  q: z.string().trim().min(1).max(ITEM_NAME_MAX).optional(),
  category: z.string().trim().min(1).max(ITEM_CATEGORY_MAX).optional(),
  tradeType: TradeTypeSchema.optional(),
  status: ItemStatusSchema.default('ACTIVE'),
  freshness: FreshnessCodeSchema.optional(),
  favorite: BooleanQuerySchema.optional(),
  sort: ItemSortSchema.default('latest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ItemListQuery = z.infer<typeof ItemListQuerySchema>;

/** `POST /api/items` 请求体。 */
export const CreateItemRequestSchema = z
  .object({
    communityId: z.string().min(1),
    name: z.string().trim().min(1).max(ITEM_NAME_MAX),
    category: z.string().trim().max(ITEM_CATEGORY_MAX).optional(),
    description: z.string().trim().min(1).max(ITEM_DESCRIPTION_MAX),
    tradeType: TradeTypeSchema,
    price: z.number().nonnegative().nullable().optional(),
    imageKeys: z.array(z.string().min(1)).max(MAX_ITEM_IMAGES).optional(),
  })
  .superRefine((value, ctx) => {
    // 与 DB CHECK 对称：FIXED_PRICE 必填价格（此处做「友好报错」，DB 兜底见 migration.sql）
    if (value.tradeType === 'FIXED_PRICE' && (value.price === null || value.price === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: '交易方式为 FIXED_PRICE 时必须提供价格',
      });
    }
  });
export type CreateItemRequest = z.infer<typeof CreateItemRequestSchema>;

/** `PATCH /api/items/:id` 请求体（可选字段集；跨字段校验在服务层对照现存记录完成）。 */
export const UpdateItemRequestSchema = z.object({
  name: z.string().trim().min(1).max(ITEM_NAME_MAX).optional(),
  category: z.string().trim().max(ITEM_CATEGORY_MAX).optional(),
  description: z.string().trim().min(1).max(ITEM_DESCRIPTION_MAX).optional(),
  tradeType: TradeTypeSchema.optional(),
  price: z.number().nonnegative().nullable().optional(),
  imageKeys: z.array(z.string().min(1)).max(MAX_ITEM_IMAGES).optional(),
});
export type UpdateItemRequest = z.infer<typeof UpdateItemRequestSchema>;

/* ===========================================================================
 * 3a. 图片上传（api-contract.md §3）
 * =========================================================================== */

/** 单张上限 5 MiB（契约 §3「≤5MB」按二进制 MiB 解释，前后端同口径）。 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** MIME 白名单 → 落盘扩展名（服务端自行映射，不采信客户端文件名）。 */
export const ALLOWED_UPLOAD_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** `POST /api/uploads` 响应体（§3）。`url` 恒为 `/uploads/<key>`（本地适配器约定）。 */
export const UploadResultSchema = z.object({
  key: z.string().min(1),
  url: z.string().min(1),
});
export type UploadResult = z.infer<typeof UploadResultSchema>;

/* ===========================================================================
 * 3b. 公开留言板（api-contract.md §5）
 * =========================================================================== */

export const MESSAGE_CONTENT_MAX = 1000;

/**
 * 留言 DTO（§5）。`author` **可为 `null`**：`senderType="AI"` 的行没有作者外键
 * （`authorId:null`），前端须以「AI 建议」标签渲染，不得伪装为用户发言。
 */
export const MessageDtoSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  senderType: MessageSenderTypeSchema,
  author: UserSummarySchema.nullable(),
  content: z.string().max(MESSAGE_CONTENT_MAX),
  createdAt: z.string().datetime(),
});
export type MessageDto = z.infer<typeof MessageDtoSchema>;

/**
 * `POST /api/items/:id/messages` 请求体（§5）。
 * `senderType` 缺省 `USER`；`AI` **仅物品发布者**可用（服务端强制 `authorId=null`）。
 */
export const MessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(MESSAGE_CONTENT_MAX),
  senderType: MessageSenderTypeSchema.default('USER'),
});
export type MessageRequest = z.infer<typeof MessageRequestSchema>;

/* ===========================================================================
 * 3c. 收藏 / 我的 / 通知（api-contract.md §6）
 * =========================================================================== */

/** `POST` / `DELETE /api/items/:id/favorite` 响应体（§6）。 */
export const FavoriteResultSchema = z.object({ favorited: z.boolean() });
export type FavoriteResult = z.infer<typeof FavoriteResultSchema>;

/** `GET /api/me/items` query（§6）：`status` 缺省 = 三种状态全返回（含已归档）。 */
export const MyItemsQuerySchema = z.object({
  status: ItemStatusSchema.optional(),
});
export type MyItemsQuery = z.infer<typeof MyItemsQuerySchema>;

/** 通知 DTO（§6）。`title`/`content` 上限对齐 `@db.VarChar(80)` / `@db.VarChar(500)`。 */
export const NotificationDtoSchema = z.object({
  id: z.string().min(1),
  type: NotificationTypeSchema,
  title: z.string().min(1).max(80),
  content: z.string().max(500),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

/** `GET /api/me/notifications` query（§6）：`unreadOnly` 缺省 `false`（全量）。 */
export const NotificationListQuerySchema = z.object({
  unreadOnly: BooleanQuerySchema.optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

/* ===========================================================================
 * 3d. 数据看板（api-contract.md §7）
 * =========================================================================== */

/** 看板聚合口径时区：DB 存 UTC，自然月按此区间的 `[start, end)` 比较。 */
export const STATS_TIMEZONE = 'Asia/Shanghai';

/** `monthRange` 边界（ISO 8601 **带偏移**字符串，必须与实际聚合用的边界逐字一致）。 */
export const StatsMonthRangeSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});
export type StatsMonthRange = z.infer<typeof StatsMonthRangeSchema>;

/** 看板 DTO（§7）。`fastestItem` / `mostWantedItem` 无数据时为 `null`（前端渲染空态）。 */
export const StatsDtoSchema = z.object({
  monthPublished: z.number().int().nonnegative(),
  monthCompleted: z.number().int().nonnegative(),
  activeCount: z.number().int().nonnegative(),
  fastestItem: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      durationMinutes: z.number().int().nonnegative(),
    })
    .nullable(),
  mostWantedItem: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      wantCount: z.number().int().nonnegative(),
    })
    .nullable(),
  timezone: z.literal(STATS_TIMEZONE),
  monthRange: StatsMonthRangeSchema,
});
export type StatsDto = z.infer<typeof StatsDtoSchema>;

/** `GET /api/stats/community` query（§7）：缺省取会话社区；显式传入必须一致（否则 403）。 */
export const StatsQuerySchema = z.object({
  communityId: z.string().min(1).optional(),
});
export type StatsQuery = z.infer<typeof StatsQuerySchema>;

/* ===========================================================================
 * 4b. 领取申请（api-contract.md §4）
 * =========================================================================== */

export const CLAIM_MESSAGE_MAX = 500;
export const CLAIM_LOCATION_MAX = 120;

/** 领取申请 DTO（§4）。`contactText` 的可见性由服务层按 `claimContactTextForViewer` 决定（D1）。 */
export const ClaimDtoSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  applicant: UserSummarySchema,
  message: z.string().max(CLAIM_MESSAGE_MAX).nullable(),
  preferredAt: z.string().datetime().nullable(),
  preferredLocation: z.string().max(CLAIM_LOCATION_MAX).nullable(),
  status: ClaimStatusSchema,
  contactText: z.string().max(CONTACT_TEXT_MAX).nullable(),
  createdAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type ClaimDto = z.infer<typeof ClaimDtoSchema>;

/** `POST /api/items/:id/claims` 请求体（§4）。 */
export const CreateClaimRequestSchema = z.object({
  message: z.string().trim().max(CLAIM_MESSAGE_MAX).optional(),
  preferredAt: z.string().datetime().optional(),
  preferredLocation: z.string().trim().max(CLAIM_LOCATION_MAX).optional(),
});
export type CreateClaimRequest = z.infer<typeof CreateClaimRequestSchema>;

/** `GET /api/me/claims` query（§4）：我发起的（applied）/ 我收到的（received），缺省 applied。 */
export const ClaimListQuerySchema = z.object({
  as: z.enum(['applied', 'received']).default('applied'),
});
export type ClaimListQuery = z.infer<typeof ClaimListQuerySchema>;

/* ===========================================================================
 * 5. LLM 能力（api-contract.md §8）
 * =========================================================================== */

export const AiSourceSchema = z.enum(['llm', 'rule', 'cache']);
export type AiSource = z.infer<typeof AiSourceSchema>;

/** 三个能力响应共有的元信息（INC-1：新增 `usedTools` / `toolCalls`，`source` 取值不变）。 */
export const AiMetaSchema = z.object({
  degraded: z.boolean(),
  source: AiSourceSchema,
  usedTools: z.boolean(),
  toolCalls: z.number().int().nonnegative(),
});
export type AiMeta = z.infer<typeof AiMetaSchema>;

export const PricingRequestSchema = z.object({
  name: z.string().trim().min(1).max(ITEM_NAME_MAX),
  description: z.string().max(ITEM_DESCRIPTION_MAX).optional(),
  category: z.string().max(ITEM_CATEGORY_MAX).optional(),
});
export type PricingRequest = z.infer<typeof PricingRequestSchema>;

/** 契约口径为 `FREE | PRICED`（见 docs/api-contract.md §8）。 */
export const PricingModeSchema = z.enum(['FREE', 'PRICED']);
export type PricingMode = z.infer<typeof PricingModeSchema>;

export const PricingResultSchema = AiMetaSchema.extend({
  mode: PricingModeSchema,
  priceRange: z
    .object({
      min: z.number().nonnegative(),
      max: z.number().nonnegative(),
      currency: z.literal('CNY'),
    })
    .nullable(),
  reason: z.string().max(60),
});
export type PricingResult = z.infer<typeof PricingResultSchema>;

export const PolishRequestSchema = z.object({
  rawText: z.string().min(1).max(ITEM_DESCRIPTION_MAX),
  name: z.string().max(ITEM_NAME_MAX).optional(),
  tradeType: TradeTypeSchema.optional(),
});
export type PolishRequest = z.infer<typeof PolishRequestSchema>;

export const PolishResultSchema = AiMetaSchema.extend({
  title: z.string().max(30),
  description: z.string().min(20).max(300),
  highlights: z.array(z.string()).max(5),
});
export type PolishResult = z.infer<typeof PolishResultSchema>;

export const FaqRequestSchema = z.object({
  itemId: z.string().min(1),
  question: z.string().trim().min(1).max(200),
});
export type FaqRequest = z.infer<typeof FaqRequestSchema>;

export const FaqResultSchema = AiMetaSchema.extend({
  answer: z.string().max(120),
  confidence: z.number().min(0).max(1),
});
export type FaqResult = z.infer<typeof FaqResultSchema>;

/* ===========================================================================
 * 6. 健康检查（api-contract.md §9）
 * =========================================================================== */

export const HealthDataSchema = z.object({
  db: z.enum(['ok', 'down']),
  llm: z.boolean(),
  storage: z.string().min(1),
});
export type HealthData = z.infer<typeof HealthDataSchema>;
