import type { Metadata } from 'next';

import { MeView } from './me-view';

export const metadata: Metadata = {
  title: '资料与我的发布',
  description: '昵称、联系方式、我发布的物品与当前社区身份',
};

export default function MePage() {
  return <MeView />;
}
