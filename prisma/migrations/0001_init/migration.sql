-- ============================================================================
-- 邻里流转 · 初始迁移（手写）
--
-- 本文件为【手写迁移】，与 `prisma/schema.prisma` 必须保持一致。
-- 设计来源：`docs/schema.prisma`（事实源）+ `docs/tech-design-final.md` §4.4（D3 约束分层）。
--
-- 为什么手写：本工程沙箱内 Prisma CLI 会被 SIGKILL（exit 137），无法用
-- `prisma migrate dev` 生成迁移；因此在具备 Docker / 正常环境时使用
-- `npx prisma migrate deploy` 直接应用本目录迁移（不要用 `migrate dev` 重新生成，
-- 否则会与 schema 产生漂移）。
--
-- 覆盖内容：
--   · 6 个 enum
--   · 10 张表（Community / CommunityMember / User / Item / ItemImage /
--     ClaimRequest / Message / Favorite / Notification / AiCache）
--   · 主键 / 外键（含 onDelete 语义）/ 唯一约束 / 复合索引
--   · D3「DB 层强制（区间/条件，Prisma 无法表达）」的 CHECK 约束：
--       1) 价格非负：price IS NULL OR price >= 0
--       2) FIXED_PRICE 必填价格：tradeType <> 'FIXED_PRICE' OR price IS NOT NULL
--     （§4.4 表中「图片 ≤6 张 / 类型 / 单张大小」属【应用层】，不作 DB CHECK；
--       跨行计数约束无法用普通 CHECK 表达。）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 枚举（6 个）
-- ---------------------------------------------------------------------------
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'RESERVED', 'ARCHIVED');

CREATE TYPE "TradeType" AS ENUM ('FREE', 'PAY_WHATEVER', 'FIXED_PRICE', 'OTHER');

CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED', 'COMPLETED');

CREATE TYPE "NotificationType" AS ENUM (
  'CLAIM_RECEIVED',
  'CLAIM_ACCEPTED',
  'CLAIM_REJECTED',
  'CLAIM_COMPLETED',
  'ITEM_RESERVED',
  'ITEM_ARCHIVED'
);

CREATE TYPE "MessageSenderType" AS ENUM ('USER', 'AI');

CREATE TYPE "AiKind" AS ENUM ('PRICING', 'POLISH', 'FAQ');

-- ---------------------------------------------------------------------------
-- 2. 表
-- ---------------------------------------------------------------------------

-- Community
CREATE TABLE "Community" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "inviteCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Community_inviteCode_key" ON "Community" ("inviteCode");

-- User
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "nickname" VARCHAR(30) NOT NULL,
  "contactText" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CommunityMember
CREATE TABLE "CommunityMember" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityMember_communityId_userId_key"
  ON "CommunityMember" ("communityId", "userId");

CREATE INDEX "CommunityMember_userId_idx" ON "CommunityMember" ("userId");

-- Item
CREATE TABLE "Item" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "category" VARCHAR(40),
  "description" VARCHAR(2000) NOT NULL,
  "tradeType" "TradeType" NOT NULL,
  "price" DECIMAL(10, 2),
  "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reservedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Item_pkey" PRIMARY KEY ("id"),
  -- D3 / §4.4：DB 层强制（CHECK）——价格非负
  CONSTRAINT "Item_price_non_negative_check"
    CHECK ("price" IS NULL OR "price" >= 0),
  -- D3 / §4.4：DB 层强制（CHECK）——FIXED_PRICE 必填价格
  CONSTRAINT "Item_fixed_price_requires_price_check"
    CHECK ("tradeType" <> 'FIXED_PRICE'::"TradeType" OR "price" IS NOT NULL)
);

CREATE INDEX "Item_communityId_status_publishedAt_idx"
  ON "Item" ("communityId", "status", "publishedAt");

CREATE INDEX "Item_communityId_tradeType_status_idx"
  ON "Item" ("communityId", "tradeType", "status");

CREATE INDEX "Item_ownerId_status_idx" ON "Item" ("ownerId", "status");

-- ItemImage
CREATE TABLE "ItemImage" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ItemImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ItemImage_itemId_sortOrder_idx" ON "ItemImage" ("itemId", "sortOrder");

-- ClaimRequest
CREATE TABLE "ClaimRequest" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "applicantId" TEXT NOT NULL,
  "message" VARCHAR(500),
  "preferredAt" TIMESTAMP(3),
  "preferredLocation" VARCHAR(120),
  "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ClaimRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClaimRequest_itemId_status_idx" ON "ClaimRequest" ("itemId", "status");

CREATE INDEX "ClaimRequest_applicantId_status_idx"
  ON "ClaimRequest" ("applicantId", "status");

-- Message
CREATE TABLE "Message" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "authorId" TEXT,
  "senderType" "MessageSenderType" NOT NULL DEFAULT 'USER',
  "content" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Message_itemId_createdAt_idx" ON "Message" ("itemId", "createdAt");

CREATE INDEX "Message_authorId_idx" ON "Message" ("authorId");

-- Favorite
CREATE TABLE "Favorite" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Favorite_userId_itemId_key" ON "Favorite" ("userId", "itemId");

CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite" ("userId", "createdAt");

-- Notification
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" VARCHAR(80) NOT NULL,
  "content" VARCHAR(500) NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_readAt_createdAt_idx"
  ON "Notification" ("userId", "readAt", "createdAt");

-- AiCache
CREATE TABLE "AiCache" (
  "id" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "kind" "AiKind" NOT NULL,
  "outputJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiCache_inputHash_key" ON "AiCache" ("inputHash");

CREATE INDEX "AiCache_kind_createdAt_idx" ON "AiCache" ("kind", "createdAt");

-- ---------------------------------------------------------------------------
-- 3. 外键（onDelete 语义与 schema.prisma 的 relation 定义一致）
-- ---------------------------------------------------------------------------

-- CommunityMember -> Community (Cascade) / User (Cascade)
ALTER TABLE "CommunityMember"
  ADD CONSTRAINT "CommunityMember_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityMember"
  ADD CONSTRAINT "CommunityMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Item -> Community (required，默认 RESTRICT) / User (required，默认 RESTRICT)
ALTER TABLE "Item"
  ADD CONSTRAINT "Item_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Item"
  ADD CONSTRAINT "Item_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ItemImage -> Item (Cascade)
ALTER TABLE "ItemImage"
  ADD CONSTRAINT "ItemImage_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ClaimRequest -> Item (Cascade) / User (required，默认 RESTRICT)
ALTER TABLE "ClaimRequest"
  ADD CONSTRAINT "ClaimRequest_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClaimRequest"
  ADD CONSTRAINT "ClaimRequest_applicantId_fkey"
  FOREIGN KEY ("applicantId") REFERENCES "User" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Message -> Item (Cascade) / User (SetNull，authorId 可空)
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Favorite -> User (Cascade) / Item (Cascade)
ALTER TABLE "Favorite"
  ADD CONSTRAINT "Favorite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Favorite"
  ADD CONSTRAINT "Favorite_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Notification -> User (Cascade)
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
