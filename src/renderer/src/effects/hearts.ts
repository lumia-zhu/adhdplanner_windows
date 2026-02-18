import { createContainer, removeAfter, randomBetween } from './utils'

/**
 * 特效④：爱心飞散
 * 粉色/红色小爱心从圆圈飞出，向上漂浮旋转后消失
 */
export function triggerHearts(x: number, y: number): void {
  injectStyle()
  const container = createContainer(x, y)
  const count = 8
  const heartColors = ['#f43f5e', '#fb7185', '#fda4af', '#ec4899', '#f472b6', '#be185d']

  for (let i = 0; i < count; i++) {
    const heart = document.createElement('div')

    const size = randomBetween(10, 20)
    const color = heartColors[i % heartColors.length]
    const offsetX = randomBetween(-35, 35)
    const riseHeight = randomBetween(60, 120)
    const delay = i * 60  // 每个爱心间隔60ms出现
    const duration = randomBetween(0.9, 1.3)
    const rotation = randomBetween(-30, 30)

    heart.innerHTML = '♥'
    heart.style.cssText = `
      position: absolute;
      font-size: ${size}px;
      color: ${color};
      left: ${offsetX}px;
      transform: translate(-50%, -50%);
      animation: heart-float ${duration}s ease-out ${delay}ms forwards;
      --rise: -${riseHeight}px;
      --rotate: ${rotation}deg;
      text-shadow: 0 0 6px ${color}88;
      line-height: 1;
    `
    container.appendChild(heart)
  }

  removeAfter(container, 1800)
}

function injectStyle(): void {
  if (document.getElementById('hearts-style')) return
  const style = document.createElement('style')
  style.id = 'hearts-style'
  style.textContent = `
    @keyframes heart-float {
      0%   { transform: translate(-50%, -50%) scale(0) rotate(0deg); opacity: 1; }
      30%  { transform: translate(-50%, calc(-50% - 20px)) scale(1.2) rotate(var(--rotate)); opacity: 1; }
      100% { transform: translate(-50%, calc(-50% + var(--rise))) scale(0.6) rotate(var(--rotate)); opacity: 0; }
    }
  `
  document.head.appendChild(style)
}
