import { createContainer, removeAfter, randomBetween, randomPick, COLORS } from './utils'

/**
 * 特效②：星星迸射
 * 金色/彩色小星星从圆圈向四面八方射出，带旋转和淡出
 */
export function triggerStars(x: number, y: number): void {
  injectStyle()
  const container = createContainer(x, y)
  const count = 12  // 射出的星星数量
  const colors = [...COLORS.gold, '#ec4899', '#8b5cf6']

  for (let i = 0; i < count; i++) {
    const star = document.createElement('div')

    // 每颗星星飞行角度均匀分布在360度，再加随机偏移
    const angle = (360 / count) * i + randomBetween(-15, 15)
    const distance = randomBetween(40, 80)  // 飞行距离（px）
    const size = randomBetween(6, 12)       // 星星大小
    const duration = randomBetween(0.5, 0.9)
    const color = randomPick(colors)

    // 把飞行终点转换为 x/y 方向的分量
    const rad = (angle * Math.PI) / 180
    const tx = Math.cos(rad) * distance
    const ty = Math.sin(rad) * distance

    star.innerHTML = '★'
    star.style.cssText = `
      position: absolute;
      font-size: ${size}px;
      color: ${color};
      transform: translate(-50%, -50%);
      animation: star-fly ${duration}s ease-out forwards;
      --tx: ${tx}px;
      --ty: ${ty}px;
      text-shadow: 0 0 4px ${color};
    `
    container.appendChild(star)
  }

  removeAfter(container, 1000)
}

function injectStyle(): void {
  if (document.getElementById('stars-style')) return
  const style = document.createElement('style')
  style.id = 'stars-style'
  style.textContent = `
    @keyframes star-fly {
      0%   { transform: translate(-50%, -50%) scale(0) rotate(0deg);   opacity: 1; }
      40%  { opacity: 1; }
      100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(1) rotate(360deg); opacity: 0; }
    }
  `
  document.head.appendChild(style)
}
