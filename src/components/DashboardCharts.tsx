'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui';

const COLORS = ['#16a34a', '#f59e0b', '#8b5cf6', '#0ea5e9'];

export interface DashboardChartsProps {
  tradeDist: { name: string; value: number }[];
  freshDist: { name: string; value: number }[];
}

/**
 * 两张图表单独成文件，好让看板页能用 `next/dynamic` 懒加载：
 * recharts 约 120 kB，没必要和四张统计卡一起阻塞首屏。
 */
export default function DashboardCharts({ tradeDist, freshDist }: DashboardChartsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h3 className="mb-1 font-black">📊 交易方式分布</h3>
        <p className="mb-2 text-[11px] text-stone-400">按当前已加载物品实时聚合</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tradeDist} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 14, fontSize: 12 }} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]} animationDuration={900}>
                {tradeDist.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card className="p-4">
        <h3 className="mb-1 font-black">⚡ 新鲜度分布</h3>
        <p className="mb-2 text-[11px] text-stone-400">同样按当前已加载物品聚合，越新越多说明流转健康</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={freshDist} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="freshGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a34a" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#16a34a" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 14, fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#16a34a"
                strokeWidth={2.5}
                fill="url(#freshGrad)"
                animationDuration={900}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
