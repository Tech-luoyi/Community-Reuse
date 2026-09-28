import type { Metadata } from 'next';

import { JoinScreen } from '@/components/features/join-screen';

export const metadata: Metadata = {
  title: '加入社区',
  description: '用邀请码加入你的小区，开始邻里之间的闲置流转',
};

/**
 * 加入页。受保护页面在未登录时会自己渲染同一个 JoinScreen（SessionGate），
 * 这个路由是给「退出登录后落地」和直接访问用的。
 */
export default function JoinPage() {
  return <JoinScreen />;
}
