/**
 * 全站背景。
 *
 * 这里刻意**不放任何动画或 `filter: blur()`**：背景在 `position: fixed` 的整屏层上，
 * 一旦叠加模糊光斑并持续动画，浏览器每帧都要重算整条合成层，
 * 再叠上顶栏与卡片的 `backdrop-blur` 就会整体掉帧。
 * 纯 CSS 径向渐变即可拿到同样的"暖纸"氛围，且完全不上主线程。
 */
export function AmbientBackground() {
  return <div className="ambient-bg" aria-hidden />;
}
