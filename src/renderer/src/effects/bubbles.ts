import { createContainer, removeAfter, randomBetween, randomPick, COLORS } from './utils'

/**
 * 特效③：彩色泡泡漂浮
 * 七彩半透明泡泡从圆圈冒出，向上漂浮后消失，像吹泡泡一样
 */
export function triggerBubbles(x: number, y: number): void {
  injectStyle()
  const container = createContainer(x, y)
  const count = 10
  const colors = [...COLORS.pastel, '#c4b5fd', '#93c5fd']

  for (let i = 0; i < count; i++) {
    const bubble = document.createElement('div')

    const size = randomBetween(8, 22)
    const color = randomPick(colors)
    const offsetX = randomBetween(-30, 30)   // 水平偏移，让泡泡散开
    const riseHeight = randomBetween(50, 110) // 上升高度
    const delay = randomBetween(0, 0.35)
    const duration = randomBetween(0.8, 1.4)
    const wobble = randomBetween(-20, 20)     // 飘动偏移（左右摇摆感）

    bubble.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, white, ${color});
      border: 1.5px solid ${color};
      opacity: 0.85;
      left: ${offsetX}px;
      transform: translate(-50%, -50%);
      animation: bubble-rise ${duration}s ease-out ${delay}s forwards;
      --rise: -${riseHeight}px;
      --wobble: ${wobble}px;
    `
    container.appendChild(bubble)
  }

  removeAfter(container, 2000)
}

function injectStyle(): void {
  if (document.getElementById('bubbles-style')) return
  const style = document.createElement('style')
  style.id = 'bubbles-style'
  style.textContent = `
    @keyframes bubble-rise {
      0%   { transform: translate(-50%, -50%) scale(0);   opacity: 0.8; }
      20%  { transform: translate(calc(-50% + var(--wobble)), -50%) scale(1); opacity: 0.8; }
      80%  { opacity: 0.5; }
      100% { transform: translate(calc(-50% + var(--wobble)), calc(-50% + var(--rise))) scale(0.6); opacity: 0; }
    }
  `
  document.head.appendChild(style)
}
