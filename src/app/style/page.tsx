import type { Metadata } from 'next';

import { StyleGuide } from './style-guide';

export const metadata: Metadata = {
  title: '风格基线',
  description: '邻里流转前端的视觉与交互基线，不接后端数据。',
};

export default function StylePage() {
  return <StyleGuide />;
}
