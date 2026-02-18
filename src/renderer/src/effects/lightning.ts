import { createContainer, removeAfter } from './utils'

/**
 * 特效⑤：闪电光环
 * 一圈蓝紫色电光从勾选圆圈处向外扩散，带有抖动感
 */
export function triggerLightning(x: number, y: number): void {
  injectStyle()
  const container = createContainer(x, y)

  // 创建3层光环，颜色和大小略有不同，叠加出电光感
  const layers = [
    { color: '#818cf8', blur: 4, delay: 0 },
    { color: '#c084fc', blur: 8, delay: 50 },
    { color: '#38bdf8', blur: 6, delay: 100 },
  ]

  layers.forEach(({ color, blur, delay }) => {
    const ring = document.createElement('div')
    ring.style.cssText = `
      position: absolute;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 3px solid ${color};
      box-shadow: 0 0 ${blur}px ${color}, 0 0 ${blur * 2}px ${color};
      transform: translate(-50%, -50%) scale(0);
      animation: lightning-burst 0.6s ease-out ${delay}ms forwards;
    `
    container.appendChild(ring)
  })

  // 中心白色闪光点
  const flash = document.createElement('div')
  flash.style.cssText = `
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 0 12px #818cf8, 0 0 24px #c084fc;
    transform: translate(-50%, -50%) scale(0);
    animation: lightning-flash 0.4s ease-out forwards;
  `
  container.appendChild(flash)

  removeAfter(container, 800)
}

function injectStyle(): void {
  if (document.getElementById('lightning-style')) return
  const style = document.createElement('style')
  style.id = 'lightning-style'
  style.textContent = `
    @keyframes lightning-burst {
      0%   { transform: translate(-50%, -50%) scale(0);   opacity: 1; }
      50%  { opacity: 0.8; }
      100% { transform: translate(-50%, -50%) scale(5);   opacity: 0; }
    }
    @keyframes lightning-flash {
      0%   { transform: translate(-50%, -50%) scale(0); opacity: 1; }
      50%  { transform: translate(-50%, -50%) scale(1.5); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
    }
  `
  document.head.appendChild(style)
}
