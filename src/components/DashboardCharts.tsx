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

/**
 * 图表色板。取自 globals.css 的语义色与中性刻度，保持与状态标签同一套颜色语言。
 * 上一版是 `['#16a34a','#f59e0b','#8b5cf6','#0ea5e9']` 四色环 ——
 * 四根柱子四种饱和色相，读者要靠记忆配对 legend 与柱子，这里降到一色深浅。
 */
const TRADE_COLORS = ['#171717', '#525252', '#8a8a8a', '#a3a3a3'];
const AXIS = { fontSize: 11, fill: '#8a8a8a' };
const GRID = '#e5e5e5';

export interface DashboardChartsProps {
  tradeDist: { name: string; value: number }[];
  freshDist: { name: string; value: number }[];
}

/** 两张图表单独成文件，好让看板页能用 `next/dynamic` 懒加载。 */
export default function DashboardCharts({ tradeDist, freshDist }: DashboardChartsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h3 className="text-sm font-medium text-ink">交易方式分布</h3>
        <p className="mt-0.5 text-[11px] text-ink-tertiary">按当前已加载物品聚合</p>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tradeDist} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: '#f5f5f5' }}
                contentStyle={{
                  borderRadius: 8,
                  fontSize: 12,
                  border: '1px solid #e5e5e5',
                  boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                }}
              />
              <Bar dataKey="value" radius={[3, 3, 0, 0]} animationDuration={400}>
                {tradeDist.map((_, i) => (
                  <Cell key={i} fill={TRADE_COLORS[i % TRADE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-medium text-ink">新鲜度分布</h3>
        <p className="mt-0.5 text-[11px] text-ink-tertiary">
          同样按当前已加载物品聚合，越新越多说明流转健康
        </p>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={freshDist} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="freshFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#047857" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#047857" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  fontSize: 12,
                  border: '1px solid #e5e5e5',
                  boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#047857"
                strokeWidth={2}
                fill="url(#freshFill)"
                animationDuration={400}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
