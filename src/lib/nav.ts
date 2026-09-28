import {
  Heart,
  LayoutDashboard,
  LayoutGrid,
  Bell,
  Palette,
  ArrowLeftRight,
  PlusCircle,
  User,
  type LucideIcon,
} from 'lucide-react';

/**
 * 左侧栏导航的唯一事实源。
 *
 * `stage` 记录该页在实施计划里的提交序号：已上线的写 `'live'`，未建的写序号，
 * 侧栏据此把未建项渲染成不可点的灰项而不是丢一个 404 给读者。
 * 页面落地时把序号改成 `'live'` 即可，不用动侧栏组件。
 */
export type NavStage = 'live' | number;

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  stage: NavStage;
}

export interface NavSection {
  eyebrow: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    eyebrow: '浏览',
    items: [
      { href: '/', label: '物品集市', icon: LayoutGrid, stage: 'live' },
      { href: '/requests', label: '我的申请', icon: ArrowLeftRight, stage: 5 },
    ],
  },
  {
    eyebrow: '工作台',
    items: [
      { href: '/items/new', label: '发布物品', icon: PlusCircle, stage: 8 },
      { href: '/dashboard', label: '数据看板', icon: LayoutDashboard, stage: 8 },
    ],
  },
  {
    eyebrow: '个人',
    items: [
      { href: '/favorites', label: '收藏', icon: Heart, stage: 8 },
      { href: '/notifications', label: '通知', icon: Bell, stage: 8 },
      { href: '/me', label: '资料', icon: User, stage: 6 },
    ],
  },
  {
    eyebrow: '设计',
    items: [{ href: '/style', label: '风格基线', icon: Palette, stage: 'live' }],
  },
];

/** 根路径 `/` 是物品集市，但 `/items/:id` 也以 `/` 开头，需要精确匹配。 */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
