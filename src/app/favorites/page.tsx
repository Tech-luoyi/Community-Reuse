import type { Metadata } from 'next';

import { FavoritesView } from './favorites-view';

export const metadata: Metadata = {
  title: '我的收藏',
  description: '按你的收藏过滤出来的物品列表',
};

export default function FavoritesPage() {
  return <FavoritesView />;
}
