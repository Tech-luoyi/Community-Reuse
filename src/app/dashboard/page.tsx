import type { Metadata } from 'next';

import { DashboardView } from './dashboard-view';

export const metadata: Metadata = {
  title: '数据看板',
  description: '社区流转的现算统计与分布图表',
};

export default function DashboardPage() {
  return <DashboardView />;
}
