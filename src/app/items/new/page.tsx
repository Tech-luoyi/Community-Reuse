import type { Metadata } from 'next';

import { NewItemView } from './new-item-view';

export const metadata: Metadata = {
  title: '发布物品',
  description: '把闲下来的东西发布到自己所在的小区',
};

export default function NewItemPage() {
  return <NewItemView />;
}
