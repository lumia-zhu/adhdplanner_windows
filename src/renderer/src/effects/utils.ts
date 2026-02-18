/**
 * 特效工具函数库
 * 提供创建/销毁特效元素的通用方法
 */

/**
 * 获取一个 DOM 元素的中心坐标（相对于屏幕/视口）
 * 就像问"这个按钮的圆心在屏幕哪个位置"
 */
export function getElementCenter(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

/**
 * 创建一个固定在屏幕上的容器元素（特效的舞台）
 * position: fixed 让它不随页面滚动，始终在屏幕坐标系内
 * pointer-events: none 让鼠标事件穿透它，不影响下面的点击
 * @param x 水平中心坐标
 * @param y 垂直中心坐标
 */
export function createContainer(x: number, y: number): HTMLDivElement {
  const div = document.createElement('div')
  div.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 99999;
    overflow: visible;
  `
  document.body.appendChild(div)
  return div
}

/**
 * 创建一个覆盖全屏的 Canvas（用于粒子特效）
 * 因为粒子会飞到屏幕各处，需要全屏大小的画布
 */
export function createFullscreenCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  canvas.style.cssText = `
    position: fixed;
    left: 0;
    top: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 99999;
  `
  document.body.appendChild(canvas)
  return canvas
}

/**
 * 让一个元素在指定毫秒后自动从 DOM 中删除
 * 就像给特效设一个"自动消失的定时器"
 */
export function removeAfter(el: Element, ms: number): void {
  setTimeout(() => el.remove(), ms)
}

/**
 * 随机从数组中取一个元素
 */
export function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * 生成指定范围内的随机数
 */
export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** 常用特效颜色组 */
export const COLORS = {
  festive: ['#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#10b981', '#f97316', '#ec4899'],
  pastel:  ['#fde68a', '#fbcfe8', '#c4b5fd', '#93c5fd', '#6ee7b7', '#fca5a5', '#a5f3fc'],
  gold:    ['#fbbf24', '#f59e0b', '#d97706', '#fcd34d', '#fef08a'],
  fire:    ['#ef4444', '#f97316', '#fbbf24', '#dc2626', '#ea580c'],
  cool:    ['#60a5fa', '#a78bfa', '#34d399', '#38bdf8', '#818cf8'],
} as const
