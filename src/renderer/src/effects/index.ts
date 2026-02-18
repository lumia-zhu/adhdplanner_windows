import { getElementCenter } from './utils'
import { triggerRipple } from './ripple'
import { triggerStars } from './stars'
import { triggerBubbles } from './bubbles'
import { triggerHearts } from './hearts'
import { triggerLightning } from './lightning'
import { triggerConfetti } from './confetti'
import { triggerFireworks } from './fireworks'
import { triggerCracker } from './cracker'

/**
 * 所有可用特效列表
 * 每个特效函数接收 (x, y) 坐标，在该位置触发动画
 */
const EFFECTS: Array<(x: number, y: number) => void> = [
  triggerRipple,    // 彩虹波纹
  triggerStars,     // 星星迸射
  triggerBubbles,   // 彩色泡泡
  triggerHearts,    // 爱心飞散
  triggerLightning, // 闪电光环
  triggerConfetti,  // 彩带爆炸
  triggerFireworks, // 烟花绽放
  triggerCracker,   // 爆竹火花
]

// 记录上一次用的特效索引，避免连续两次出现同一个
let lastEffectIndex = -1

/**
 * 主入口：在某个元素位置触发随机庆祝特效
 * 每次都从8种特效中随机选1种，且不会和上次重复
 *
 * 用法示例：
 *   import { triggerEffect } from '../effects'
 *   triggerEffect(buttonElement)  // 传入勾选按钮的 DOM 元素
 */
export function triggerEffect(el: Element): void {
  try {
    // 获取元素在屏幕上的中心坐标
    const { x, y } = getElementCenter(el)

    // 随机选一种特效（排除上次用过的）
    let index: number
    do {
      index = Math.floor(Math.random() * EFFECTS.length)
    } while (index === lastEffectIndex && EFFECTS.length > 1)

    lastEffectIndex = index
    EFFECTS[index](x, y)
  } catch (e) {
    // 特效失败不影响主功能，静默处理
    console.warn('[特效] 触发失败:', e)
  }
}
