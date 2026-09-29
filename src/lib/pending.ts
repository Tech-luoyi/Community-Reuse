/**
 * 契约已定稿、后端尚未实现的接口清单（唯一事实源）。
 *
 * 判定原则 —— 两类失败必须分开处理，不得混为一谈：
 *   1. **接口未实现**：不发请求，直接渲染 `<PendingApi>` 说明。
 *      绝不用 `.catch(() => [])` 把「没有这个接口」伪装成「这里没有数据」——
 *      那会让用户读到假事实（例：明明有在架物品却显示「还没有发布物品」）。
 *   2. **接口已实现但调用失败**（401 / 网络抖动 / 5xx）：如实报错并给重试入口，
 *      不得下沉成空态。
 *
 * 后端补齐某个接口后，从本清单删除对应项，并把调用点改回真实请求。
 */
export const PENDING_ENDPOINTS = {
  uploads: 'POST /api/uploads',
  favorite: 'POST · DELETE /api/items/:id/favorite',
  itemMessages: 'GET · POST /api/items/:id/messages',
  myFavorites: 'GET /api/me/favorites',
  myItems: 'GET /api/me/items',
  notifications: 'GET /api/me/notifications',
  notificationRead: 'POST /api/me/notifications/:id/read',
  communityStats: 'GET /api/stats/community',
} as const;
