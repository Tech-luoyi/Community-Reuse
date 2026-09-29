/**
 * 庆祝彩带。
 *
 * `canvas-confetti` 只在"发布成功 / 申请被接受"这几瞬间用得上，
 * 但顶层 `import` 会把它塞进页面初始 chunk 并常驻解析执行。
 * 这里改成事件触发时才动态取，初始包里就不再带它。
 */
export interface BurstOptions {
  particleCount?: number;
  spread?: number;
  origin?: { x?: number; y?: number };
  colors?: string[];
}

export async function burst(options: BurstOptions): Promise<void> {
  const { default: confetti } = await import('canvas-confetti');
  confetti(options);
}
