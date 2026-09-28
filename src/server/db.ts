/**
 * PrismaClient 单例。
 *
 * 目的：避免 Next.js 开发模式热重载时反复 new PrismaClient 导致连接数爆炸。
 * 仅本模块可 `new PrismaClient()`；其余服务层一律 `import { prisma }`。
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
