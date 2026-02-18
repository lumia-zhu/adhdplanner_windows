import { createFullscreenCanvas, randomBetween, randomPick, COLORS } from './utils'

interface Ember {
  x: number; y: number
  vx: number; vy: number
  color: string
  size: number
  life: number
  decay: number
  shape: 'circle' | 'spark'  // 圆形碎屑 or 细长火花
}

/**
 * 特效⑧：爆竹炸开
 * 红色为主的火星和碎屑向四周炸开，带有短暂的白色闪光
 */
export function triggerCracker(x: number, y: number): void {
  const canvas = createFullscreenCanvas()
  const ctx = canvas.getContext('2d')!

  const embers: Ember[] = []
  const count = 45

  // 白色闪光效果（爆炸瞬间）
  let flashAlpha = 0.7
  const flashRadius = 30

  // 混合火焰颜色：红、橙、黄为主，少量其他色
  const colors = [...COLORS.fire, '#fef08a', '#fbbf24']

  for (let i = 0; i < count; i++) {
    const angle = randomBetween(0, Math.PI * 2)
    const speed = randomBetween(2, 9)
    const isSpark = Math.random() > 0.5  // 一半圆形，一半细长火花

    embers.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - randomBetween(0, 2),
      color: randomPick(colors),
      size: isSpark ? randomBetween(1.5, 3) : randomBetween(2, 5),
      life: 1,
      decay: randomBetween(0.02, 0.04),
      shape: isSpark ? 'spark' : 'circle',
    })
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 绘制爆炸瞬间的白色闪光圆
    if (flashAlpha > 0) {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, flashRadius)
      gradient.addColorStop(0, `rgba(255, 255, 255, ${flashAlpha})`)
      gradient.addColorStop(1, 'rgba(255, 200, 100, 0)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(x, y, flashRadius, 0, Math.PI * 2)
      ctx.fill()
      flashAlpha -= 0.08  // 闪光快速消退
    }

    let anyAlive = false
    for (const e of embers) {
      e.x += e.vx
      e.y += e.vy
      e.vy += 0.3      // 重力
      e.vx *= 0.97
      e.life -= e.decay

      if (e.life <= 0) continue
      anyAlive = true

      ctx.globalAlpha = e.life

      if (e.shape === 'circle') {
        // 圆形碎屑
        ctx.beginPath()
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2)
        ctx.fillStyle = e.color
        ctx.shadowBlur = 4
        ctx.shadowColor = e.color
        ctx.fill()
        ctx.shadowBlur = 0
      } else {
        // 细长火花：从出发点到当前点画一条线
        ctx.beginPath()
        ctx.moveTo(e.x - e.vx * 3, e.y - e.vy * 3)
        ctx.lineTo(e.x, e.y)
        ctx.strokeStyle = e.color
        ctx.lineWidth = e.size
        ctx.lineCap = 'round'
        ctx.shadowBlur = 3
        ctx.shadowColor = e.color
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      ctx.globalAlpha = 1
    }

    if (anyAlive || flashAlpha > 0) {
      requestAnimationFrame(animate)
    } else {
      canvas.remove()
    }
  }

  requestAnimationFrame(animate)
}
