/**
 * 行为追踪器 —— 核心服务
 *
 * 使用方式（在任何组件/服务中）：
 *   import { tracker } from '../services/tracker'
 *   tracker.track('exec.micro_completed', { sessionId, taskId, ... })
 *
 * 设计要点：
 *   - 单例模式：全局只有一个 tracker 实例
 *   - 内存缓冲：事件先写入内存队列，每 N 秒或 N 条批量持久化
 *   - 异步无阻塞：埋点不影响用户操作的流畅度
 *   - 自动日期分片：每天自动存到独立文件
 */

import type { TrackEventType, TrackEventMap, TrackEvent } from './types'

// ===================== 工具函数 =====================

/** 获取今天的日期字符串 YYYY-MM-DD */
function getToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 生成简单唯一 ID */
function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ===================== Tracker 类 =====================

class Tracker {
  /** 内存事件缓冲区 */
  private buffer: TrackEvent[] = []
  /** 批量写入定时器 */
  private flushTimer: ReturnType<typeof setInterval> | null = null
  /** 批量写入间隔（毫秒） */
  private readonly FLUSH_INTERVAL = 5000
  /** 缓冲区满多少条就立即写入 */
  private readonly FLUSH_THRESHOLD = 10
  /** 是否已初始化 */
  private initialized = false

  // -------- 初始化 --------

  /**
   * 启动 tracker
   * 在 App 挂载时调用一次
   */
  init(): void {
    if (this.initialized) return
    this.initialized = true

    // 启动定时批量写入
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL)

    // 页面关闭前强制写入
    window.addEventListener('beforeunload', () => this.flush())

    console.log('[Tracker] 初始化完成，缓冲间隔', this.FLUSH_INTERVAL, 'ms')
  }

  /**
   * 停止 tracker（应用退出时调用）
   */
  destroy(): void {
    this.flush()
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.initialized = false
  }

  // -------- 核心 API --------

  /**
   * 记录一条事件
   *
   * @param type    事件类型（如 'exec.micro_completed'）
   * @param payload 事件数据（类型安全，TS 会自动推断）
   *
   * @example
   *   tracker.track('plan.focus_selected', {
   *     taskId: task.id,
   *     taskTitle: task.title,
   *   })
   */
  track<T extends TrackEventType>(type: T, payload: TrackEventMap[T]): void {
    const event: TrackEvent<T> = {
      id: uid(),
      type,
      timestamp: Date.now(),
      date: getToday(),
      payload,
    }

    this.buffer.push(event as TrackEvent)

    // 如果缓冲区满，立即写入
    if (this.buffer.length >= this.FLUSH_THRESHOLD) {
      this.flush()
    }
  }

  // -------- 内部方法 --------

  /**
   * 把缓冲区的事件批量写入磁盘
   * 通过 IPC 调用主进程完成文件 I/O
   */
  private flush(): void {
    if (this.buffer.length === 0) return

    const eventsToWrite = [...this.buffer]
    this.buffer = []

    // 按日期分组（通常都是同一天，但跨零点时可能有两天）
    const byDate = new Map<string, TrackEvent[]>()
    for (const event of eventsToWrite) {
      const list = byDate.get(event.date) || []
      list.push(event)
      byDate.set(event.date, list)
    }

    // 逐日写入
    for (const [date, events] of byDate) {
      window.electronAPI.appendTrackerEvents(date, events as unknown[]).catch((err) => {
        console.error('[Tracker] 写入失败:', err)
        // 写入失败 → 放回缓冲区（不丢数据）
        this.buffer.push(...events)
      })
    }
  }
}

// ===================== 导出单例 =====================

export const tracker = new Tracker()
