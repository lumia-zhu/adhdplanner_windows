import { createFullscreenCanvas, randomBetween, randomPick, COLORS } from './utils'

/** 单个彩带粒子的数据结构 */
interface Particle {
  x: number; y: number       // 当前位置
  vx: number; vy: number     // 速度（每帧移动量）
  color: string              // 颜色
  w: number; h: number       // 宽高（长方形纸片）
  rotation: number           // 当前旋转角度
  rotSpeed: number           // 旋转速度（每帧旋转量）
  life: number               // 剩余生命值（1→0）
  decay: number              // 每帧衰减量
}

/**
 * 特效⑥：彩带爆炸
 * 五彩纸片从圆圈中心向四周炸开，受重力下落旋转，像撒彩带一样
 */
export function triggerConfetti(x: number, y: number): void {
  const canvas = createFullscreenCanvas()
  const ctx = canvas.getContext('2d')!
  const colors = [...COLORS.festive, ...COLORS.pastel]

  // 创建 50 个粒子，均匀分布在360度
  const particles: Particle[] = []
  const count = 50

  for (let i = 0; i < count; i++) {
    // 角度均匀分布 + 随机偏移，让爆炸更自然
    const angle = (Math.PI * 2 * i) / count + randomBetween(-0.3, 0.3)
    const speed = randomBetween(3, 8)

    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - randomBetween(1, 3), // 初始向上偏移
      color: randomPick(colors),
      w: randomBetween(6, 12),
      h: randomBetween(3, 6),
      rotation: randomBetween(0, Math.PI * 2),
      rotSpeed: randomBetween(-0.15, 0.15),
      life: 1,
      decay: randomBetween(0.015, 0.025),
    })
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    let anyAlive = false

    for (const p of particles) {
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.25      // 重力：每帧向下加速
      p.vx *= 0.98      // 空气阻力：水平减速
      p.rotation += p.rotSpeed
      p.life -= p.decay

      if (p.life <= 0) continue
      anyAlive = true

      // 绘制旋转的矩形纸片
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)
      ctx.globalAlpha = Math.min(p.life, 0.9)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }

    if (anyAlive) {
      requestAnimationFrame(animate)
    } else {
      canvas.remove() // 所有粒子消失后移除画布，释放内存
    }
  }

  requestAnimationFrame(animate)
}
