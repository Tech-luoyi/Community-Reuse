import type { Metadata } from 'next';

import { NotificationsView } from './notifications-view';

export const metadata: Metadata = {
  title: '通知',
  description: '由申请状态与时间戳重建的动态时间线',
};

export default function NotificationsPage() {
  return <NotificationsView />;
}
