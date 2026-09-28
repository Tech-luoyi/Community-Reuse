import type { Metadata } from 'next';

import { ItemView } from './item-view';

export const metadata: Metadata = {
  title: '物品详情',
  description: '一件闲置的完整信息、申请入口与交接状态',
};

type ItemPageProps = { params: Promise<{ id: string }> };

/**
 * 详情路由。`params` 在 Next 15 是 Promise，服务端解开后再交给客户端岛，
 * 数据一律由客户端走 `/api`（带 Cookie），页面本身不做服务端取数。
 */
export default async function ItemPage({ params }: ItemPageProps) {
  const { id } = await params;
  return <ItemView id={id} />;
}
