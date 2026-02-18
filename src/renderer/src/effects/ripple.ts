import { createContainer, removeAfter, randomPick } from './utils'

/**
 * 特效①：彩虹波纹
 * 多层彩色同心圆从圆圈中心向外扩散，像水波一样消失
 */
export function triggerRipple(x: number, y: number): void {
  const container = createContainer(x, y)

  // 颜色序列（每层波纹颜色不同）
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']

  colors.forEach((color, i) => {
    const ring = document.createElement('div')
    // 每层延迟 80ms 出现，形成波浪感
    ring.style.cssText = `
      position: absolute;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2.5px solid ${color};
      transform: translate(-50%, -50%) scale(0);
      opacity: 1;
      animation: ripple-expand 0.8s ease-out ${i * 80}ms forwards;
    `
    container.appendChild(ring)
  })

  // 注入关键帧动画（只注入一次）
  injectStyle('ripple-style', `
    @keyframes ripple-expand {
      0%   { transform: translate(-50%, -50%) scale(0);   opacity: 0.9; }
      60%  { opacity: 0.5; }
      100% { transform: translate(-50%, -50%) scale(4.5); opacity: 0; }
    }
  `)

  removeAfter(container, 1400)
}

// 把 CSS 注入到 <head>，避免重复注入
function injectStyle(id: string, css: string): void {
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
}
