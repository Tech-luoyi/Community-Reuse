/**
 * 种子数据（**纯数据 + 纯函数，不依赖 Prisma / 数据库**）。
 *
 * 拆出来的原因：让单元测试能在零 DB 环境下校验数据形状与 §4.4 的
 * DB 层不变量（价格非负 / FIXED_PRICE 必填价格 / 图片 ≤6 张）；
 * 由 `prisma/seed.ts` 负责把这些数据真正写入数据库。
 */

/** 与 schema.prisma 的枚举取值一致（此处用字符串字面量联合，避免依赖 @prisma/client） */
export type SeedItemStatus = 'ACTIVE' | 'RESERVED' | 'ARCHIVED';
export type SeedTradeType = 'FREE' | 'PAY_WHATEVER' | 'FIXED_PRICE' | 'OTHER';
export type SeedClaimStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELED' | 'COMPLETED';
export type SeedNotificationType =
  | 'CLAIM_RECEIVED'
  | 'CLAIM_ACCEPTED'
  | 'CLAIM_REJECTED'
  | 'CLAIM_COMPLETED'
  | 'ITEM_RESERVED'
  | 'ITEM_ARCHIVED';
export type SeedMessageSenderType = 'USER' | 'AI';

export interface SeedCommunity {
  id: string;
  name: string;
  inviteCode: string;
}

export interface SeedUser {
  id: string;
  nickname: string;
  contactText: string | null;
}

export interface SeedMembership {
  id: string;
  communityId: string;
  userId: string;
}

export interface SeedItemImage {
  id: string;
  itemId: string;
  url: string;
  sortOrder: number;
}

export interface SeedItem {
  id: string;
  communityId: string;
  ownerId: string;
  name: string;
  category: string | null;
  description: string;
  tradeType: SeedTradeType;
  price: number | null;
  status: SeedItemStatus;
  publishedAt: Date;
  reservedAt: Date | null;
  archivedAt: Date | null;
  images: SeedItemImage[];
}

export interface SeedClaim {
  id: string;
  itemId: string;
  applicantId: string;
  message: string | null;
  preferredLocation: string | null;
  preferredAt: Date | null;
  status: SeedClaimStatus;
  acceptedAt: Date | null;
  completedAt: Date | null;
}

export interface SeedMessage {
  id: string;
  itemId: string;
  authorId: string | null;
  senderType: SeedMessageSenderType;
  content: string;
}

export interface SeedNotification {
  id: string;
  userId: string;
  type: SeedNotificationType;
  title: string;
  content: string;
  readAt: Date | null;
}

export interface SeedData {
  communities: SeedCommunity[];
  users: SeedUser[];
  memberships: SeedMembership[];
  items: SeedItem[];
  claims: SeedClaim[];
  messages: SeedMessage[];
  notifications: SeedNotification[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * 构造种子数据。
 * @param now 时间基准（默认当前时间）；固定 `now` 可让数据相对时间可复现。
 */
export function buildSeedData(now: Date = new Date()): SeedData {
  const hoursAgo = (hours: number): Date => new Date(now.getTime() - hours * HOUR_MS);
  const daysAgo = (days: number): Date => new Date(now.getTime() - days * DAY_MS);

  const communities: SeedCommunity[] = [
    { id: 'c_lf', name: '临风小区', inviteCode: 'LINFENG-2026' },
    { id: 'c_yq', name: '云栖公寓', inviteCode: 'YUNQI-2026' },
  ];

  const users: SeedUser[] = [
    { id: 'u_wang', nickname: '3栋-老王', contactText: '微信 wang_3（仅对手方可见）' },
    { id: 'u_li', nickname: '5栋-小李', contactText: '微信 li_5（仅对手方可见）' },
    { id: 'u_zhao', nickname: '1栋-老赵', contactText: null },
    { id: 'u_sun', nickname: 'B座-小孙', contactText: '微信 sun_b（仅对手方可见）' },
  ];

  const memberships: SeedMembership[] = [
    { id: 'cm_1', communityId: 'c_lf', userId: 'u_wang' },
    { id: 'cm_2', communityId: 'c_lf', userId: 'u_li' },
    { id: 'cm_3', communityId: 'c_lf', userId: 'u_zhao' },
    { id: 'cm_4', communityId: 'c_yq', userId: 'u_sun' },
  ];

  const items: SeedItem[] = [
    {
      id: 'i_stroller',
      communityId: 'c_lf',
      ownerId: 'u_wang',
      name: '九成新婴儿车',
      category: '母婴',
      description: '宝宝大了用不上，轮子好推，可折叠。实物如图，随时可自提。',
      tradeType: 'FREE',
      price: null,
      status: 'ACTIVE',
      publishedAt: hoursAgo(3),
      reservedAt: null,
      archivedAt: null,
      images: [
        {
          id: 'img_stroller_0',
          itemId: 'i_stroller',
          url: '/uploads/seed-stroller-0.svg',
          sortOrder: 0,
        },
        {
          id: 'img_stroller_1',
          itemId: 'i_stroller',
          url: '/uploads/seed-stroller-1.svg',
          sortOrder: 1,
        },
      ],
    },
    {
      id: 'i_books',
      communityId: 'c_lf',
      ownerId: 'u_li',
      name: '考研英语真题一套',
      category: '书籍',
      description: '只做过一遍，答案完整，可在小区门口自取。',
      tradeType: 'PAY_WHATEVER',
      price: 20,
      status: 'ACTIVE',
      publishedAt: hoursAgo(30),
      reservedAt: null,
      archivedAt: null,
      images: [
        { id: 'img_books_0', itemId: 'i_books', url: '/uploads/seed-books-0.svg', sortOrder: 0 },
      ],
    },
    {
      id: 'i_plant',
      communityId: 'c_lf',
      ownerId: 'u_zhao',
      name: '绿萝两盆',
      category: '绿植',
      description: '长势很好，搬家带不走，希望有邻居接手照看。',
      tradeType: 'FREE',
      price: null,
      status: 'ACTIVE',
      publishedAt: hoursAgo(100),
      reservedAt: null,
      archivedAt: null,
      images: [
        { id: 'img_plant_0', itemId: 'i_plant', url: '/uploads/seed-plant-0.svg', sortOrder: 0 },
      ],
    },
    {
      id: 'i_shelf',
      communityId: 'c_lf',
      ownerId: 'u_wang',
      name: '实木书架',
      category: '家具',
      description: '四层实木书架，九成新，需自行搬运。',
      tradeType: 'FIXED_PRICE',
      price: 120,
      status: 'RESERVED',
      publishedAt: daysAgo(2),
      reservedAt: daysAgo(1),
      archivedAt: null,
      images: [
        { id: 'img_shelf_0', itemId: 'i_shelf', url: '/uploads/seed-shelf-0.svg', sortOrder: 0 },
      ],
    },
    {
      // ★ 已归档成交记录（供 AI 定价工具的「同小区成交行情」查询使用：status=ARCHIVED 且 price 非空）
      id: 'i_induction',
      communityId: 'c_lf',
      ownerId: 'u_zhao',
      name: '九成新电磁炉',
      category: '家电',
      description: '搬家闲置，功能完好，已顺利交接。',
      tradeType: 'FIXED_PRICE',
      price: 80,
      status: 'ARCHIVED',
      publishedAt: daysAgo(5),
      reservedAt: daysAgo(4),
      archivedAt: daysAgo(3),
      images: [
        {
          id: 'img_induction_0',
          itemId: 'i_induction',
          url: '/uploads/seed-induction-0.svg',
          sortOrder: 0,
        },
      ],
    },
    {
      // 第二条成交记录（无图）
      id: 'i_bottle',
      communityId: 'c_lf',
      ownerId: 'u_li',
      name: '保温杯',
      category: '日用品',
      description: '全新未拆封的多余保温杯，已送给邻居。',
      tradeType: 'PAY_WHATEVER',
      price: 15,
      status: 'ARCHIVED',
      publishedAt: daysAgo(8),
      reservedAt: null,
      archivedAt: daysAgo(6),
      images: [],
    },
    {
      id: 'i_chair',
      communityId: 'c_yq',
      ownerId: 'u_sun',
      name: '折叠椅两把',
      category: '家具',
      description: '露营买多了，用不上，送给需要的邻居。',
      tradeType: 'FREE',
      price: null,
      status: 'ACTIVE',
      publishedAt: hoursAgo(6),
      reservedAt: null,
      archivedAt: null,
      images: [
        { id: 'img_chair_0', itemId: 'i_chair', url: '/uploads/seed-chair-0.svg', sortOrder: 0 },
      ],
    },
  ];

  const claims: SeedClaim[] = [
    {
      id: 'cl_shelf_li',
      itemId: 'i_shelf',
      applicantId: 'u_li',
      message: '周末可以上门搬，有电梯。',
      preferredLocation: '3栋楼下',
      preferredAt: daysAgo(1),
      status: 'ACCEPTED',
      acceptedAt: daysAgo(1),
      completedAt: null,
    },
    {
      id: 'cl_shelf_zhao',
      itemId: 'i_shelf',
      applicantId: 'u_zhao',
      message: '我也想要，可以随时来拿。',
      preferredLocation: '3栋楼下',
      preferredAt: null,
      status: 'REJECTED',
      acceptedAt: null,
      completedAt: null,
    },
    {
      // ★ 成交闭环（数据看板的「最快被领走 / 本月成交」可用）
      id: 'cl_induction_li',
      itemId: 'i_induction',
      applicantId: 'u_li',
      message: '今晚能拿。',
      preferredLocation: '1栋门口',
      preferredAt: daysAgo(4),
      status: 'COMPLETED',
      acceptedAt: daysAgo(4),
      completedAt: daysAgo(3),
    },
    {
      id: 'cl_stroller_li',
      itemId: 'i_stroller',
      applicantId: 'u_li',
      message: '还在吗？我正好需要。',
      preferredLocation: '3栋楼下',
      preferredAt: null,
      status: 'PENDING',
      acceptedAt: null,
      completedAt: null,
    },
    {
      id: 'cl_stroller_zhao',
      itemId: 'i_stroller',
      applicantId: 'u_zhao',
      message: '明天下午方便取。',
      preferredLocation: null,
      preferredAt: null,
      status: 'PENDING',
      acceptedAt: null,
      completedAt: null,
    },
  ];

  const messages: SeedMessage[] = [
    {
      id: 'msg_stroller_1',
      itemId: 'i_stroller',
      authorId: 'u_li',
      senderType: 'USER',
      content: '还在吗？',
    },
    {
      id: 'msg_stroller_2',
      itemId: 'i_stroller',
      authorId: null,
      senderType: 'AI',
      content: '在的，随时可约自提～',
    },
    {
      id: 'msg_books_1',
      itemId: 'i_books',
      authorId: 'u_zhao',
      senderType: 'USER',
      content: '几成新？答案有缺页吗？',
    },
  ];

  const notifications: SeedNotification[] = [
    {
      id: 'n_claim_received',
      userId: 'u_wang',
      type: 'CLAIM_RECEIVED',
      title: '收到新的领取申请',
      content: '5栋-小李 申请领取「九成新婴儿车」。',
      readAt: null,
    },
    {
      id: 'n_claim_accepted',
      userId: 'u_li',
      type: 'CLAIM_ACCEPTED',
      title: '申请已通过',
      content: '你的申请已被接受，请与对方约定交接。',
      readAt: null,
    },
    {
      id: 'n_claim_rejected',
      userId: 'u_zhao',
      type: 'CLAIM_REJECTED',
      title: '申请未通过',
      content: '「实木书架」已被其他邻居预约。',
      readAt: null,
    },
    {
      id: 'n_claim_completed',
      userId: 'u_li',
      type: 'CLAIM_COMPLETED',
      title: '交接已完成',
      content: '「九成新电磁炉」已完成交接，感谢参与。',
      readAt: daysAgo(3),
    },
  ];

  return { communities, users, memberships, items, claims, messages, notifications };
}
