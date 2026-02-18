import { createFullscreenCanvas, randomBetween, randomPick, COLORS } from './utils'

interface Spark {
  x: number; y: number
  vx: number; vy: number
  color: string
  size: number
  life: number
  decay: number
  trail: { x: number; y: number }[]  // 拖尾轨迹点
}

/**
 * 特效⑦：烟花绽放
 * 一颗光球从圆圈处飞出后"爆炸"，绽放成放射状光点，带有拖尾轨迹
 */
export function triggerFireworks(x: number, y: number): void {
  const canvas = createFullscreenCanvas()
  const ctx = canvas.getContext('2d')!

  // 烟花颜色主题（每次随机选一个主题色）
  const themeColor = randomPick([...COLORS.festive, ...COLORS.cool])
  const sparks: Spark[] = []
  const sparkCount = 32

  // 先播放一个向上飞的"发射"阶段，再爆炸
  let launchPhase = true
  let launchX = x
  let launchY = y
  const targetY = y - randomBetween(30, 60)  // 爆炸点略高于触发点

  function explode(ex: number, ey: number) {
    launchPhase = false
    for (let i = 0; i < sparkCount; i++) {
      const angle = (Math.PI * 2 * i) / sparkCount
      const speed = randomBetween(2, 6)
      sparks.push({
        x: ex, y: ey,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: themeColor,
        size: randomBetween(2, 4),
        life: 1,
        decay: randomBetween(0.018, 0.03),
        trail: [],
      })
    }
  }

  function animate() {
    // 用半透明黑色覆盖，产生拖尾残影效果（而不是完全清空）
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (launchPhase) {
      // 发射阶段：绘制向上飞的光球
      launchY -= 4
      ctx.beginPath()
      ctx.arc(launchX, launchY, 4, 0, Math.PI * 2)
      ctx.fillStyle = themeColor
      ctx.shadowBlur = 12
      ctx.shadowColor = themeColor
      ctx.fill()
      ctx.shadowBlur = 0

      // 到达目标高度后爆炸
      if (launchY <= targetY) {
        explode(launchX, launchY)
      }
      requestAnimationFrame(animate)
      return
    }

    let anyAlive = false
    for (const s of sparks) {
      s.trail.push({ x: s.x, y: s.y })
      if (s.trail.length > 5) s.trail.shift() // 只保留最近5个轨迹点

      s.x += s.vx
      s.y += s.vy
      s.vy += 0.1   // 轻微重力
      s.vx *= 0.97
      s.vy *= 0.97
      s.life -= s.decay

      if (s.life <= 0) continue
      anyAlive = true

      // 绘制拖尾（从透明到不透明的渐变线段）
      for (let t = 0; t < s.trail.length - 1; t++) {
        const alpha = (t / s.trail.length) * s.life * 0.6
        ctx.beginPath()
        ctx.strokeStyle = s.color
        ctx.globalAlpha = alpha
        ctx.lineWidth = s.size * 0.6
        ctx.moveTo(s.trail[t].x, s.trail[t].y)
        ctx.lineTo(s.trail[t + 1].x, s.trail[t + 1].y)
        ctx.stroke()
      }

      // 绘制粒子本体（发光圆点）
      ctx.globalAlpha = s.life
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
      ctx.fillStyle = s.color
      ctx.shadowBlur = 6
      ctx.shadowColor = s.color
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
    }

    if (anyAlive || launchPhase) {
      requestAnimationFrame(animate)
    } else {
      // 清空残留画面后销毁 canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      canvas.remove()
    }
  }

  requestAnimationFrame(animate)
}
