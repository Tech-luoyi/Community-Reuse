/**
 * 数据库种子脚本：`npm run db:seed`（内部 `tsx prisma/seed.ts`）。
 *
 * 数据内容见 `prisma/seed-data.ts`（纯数据，便于单测）。
 * 本文件只负责「把种子数据写进数据库」，脚本可重复执行（先清空再写入）。
 *
 * 前置：设置 DATABASE_URL（见 .env.example），并已 `prisma migrate deploy`。
 */
import { PrismaClient } from '@prisma/client';

import { buildSeedData } from './seed-data';

const prisma = new PrismaClient();

async function reset(): Promise<void> {
  // 顺序遵循外键依赖（子表在前）
  await prisma.notification.deleteMany();
  await prisma.message.deleteMany();
  await prisma.claimRequest.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.itemImage.deleteMany();
  await prisma.item.deleteMany();
  await prisma.communityMember.deleteMany();
  await prisma.user.deleteMany();
  await prisma.community.deleteMany();
}

async function main(): Promise<void> {
  const data = buildSeedData();

  await reset();

  for (const community of data.communities) {
    await prisma.community.create({ data: community });
  }

  for (const user of data.users) {
    await prisma.user.create({ data: user });
  }

  for (const membership of data.memberships) {
    await prisma.communityMember.create({ data: membership });
  }

  for (const item of data.items) {
    const { images, ...itemFields } = item;
    await prisma.item.create({
      data: {
        ...itemFields,
        ...(images.length > 0
          ? {
              images: {
                create: images.map((image) => ({
                  id: image.id,
                  url: image.url,
                  sortOrder: image.sortOrder,
                })),
              },
            }
          : {}),
      },
    });
  }

  for (const claim of data.claims) {
    await prisma.claimRequest.create({ data: claim });
  }

  for (const message of data.messages) {
    await prisma.message.create({ data: message });
  }

  for (const notification of data.notifications) {
    await prisma.notification.create({ data: notification });
  }

  const [communities, users, items, claims] = await Promise.all([
    prisma.community.count(),
    prisma.user.count(),
    prisma.item.count(),
    prisma.claimRequest.count(),
  ]);

  console.log(
    `[seed] done: communities=${communities} users=${users} items=${items} claims=${claims}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
