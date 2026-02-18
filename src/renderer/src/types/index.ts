/**
 * 任务数据结构定义
 * 就像一张表格的"列名"，规定了每个任务有哪些字段
 */
export interface Task {
  id: string              // 唯一标识符（用时间戳生成）
  title: string           // 任务标题（必填）
  note: string            // 备注说明（可选）
  priority: 'high' | 'medium' | 'low'  // 优先级：高/中/低
  completed: boolean      // 是否已完成
  createdAt: number       // 创建时间戳（毫秒）
}

/** 优先级显示配置 */
export const PRIORITY_CONFIG = {
  high: {
    label: '高',
    color: 'text-red-500',
    bg: 'bg-red-50',
    border: 'border-red-200',
    dot: 'bg-red-500'
  },
  medium: {
    label: '中',
    color: 'text-orange-500',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    dot: 'bg-orange-500'
  },
  low: {
    label: '低',
    color: 'text-blue-500',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    dot: 'bg-blue-400'
  }
} as const
