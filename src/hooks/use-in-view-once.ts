import * as React from 'react';

/**
 * 「进入视口后置真一次」的开关，用来触发一次性动效（列表错峰入场、图表绘制）。
 *
 * 为什么不挂载即播放：看板与列表大多在首屏之下，挂载就播等于没人看见的动画。
 * 为什么只拿它动 transform / opacity / 尺寸，绝不用它做内容显隐：
 * 那样脚本一旦没跑起来页面就是空白；文字与数值必须始终正常渲染在 DOM 里。
 *
 * 置真前额外等一帧，是为了让浏览器先把起点值算过一次，
 * 否则本来就在首屏内的元素会直接跳到终态、看不到过渡。
 * `prefers-reduced-motion` 下过渡与动画时长被全局压到 0.01ms，等价于直接显示终态。
 */
export function useInViewOnce<T extends HTMLElement>(): {
  ref: (node: T | null) => void;
  shown: boolean;
} {
  const [node, setNode] = React.useState<T | null>(null);
  const [shown, setShown] = React.useState(false);

  const ref = React.useCallback((next: T | null) => {
    setNode(next);
  }, []);

  React.useEffect(() => {
    if (!node || shown) return;

    let frame = 0;
    const play = () => {
      frame = requestAnimationFrame(() => setShown(true));
    };

    if (typeof IntersectionObserver === 'undefined') {
      play();
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        play();
      },
      // threshold 0 + 底部负 margin：长列表一露头就触发（threshold 按目标高度算，
      // 对 2000px 的列表 0.05 意味着要等 100px 进视口，首行会先闪一下静止态）。
      { threshold: 0, rootMargin: '0px 0px -12% 0px' },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [node, shown]);

  return { ref, shown };
}
