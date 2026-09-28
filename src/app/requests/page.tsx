import type { Metadata } from 'next';

import { RequestsView } from './requests-view';

export const metadata: Metadata = {
  title: '我的申请',
  description: '我发出的与收到的流转申请，以及每条申请当前可做的动作',
};

export default function RequestsPage() {
  return <RequestsView />;
}
