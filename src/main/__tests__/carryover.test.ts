/**
 * 搬迁算法专项测试
 *
 * 覆盖 findCarryOverTasks / findAllCarryOverTasks / executeCarryOver / executeMultiCarryOver
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

const mockUserDataDir = path.join(os.tmpdir(), `vitest-carryover-${Date.now()}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataDir),
  },
  powerMonitor: {
    getSystemIdleTime: vi.fn(() => 0),
  },
}))

import {
  loadTasks,
  saveTasks,
  findCarryOverTasks,
  findAllCarryOverTasks,
  executeCarryOver,
  executeMultiCarryOver,
} from '../storage'

// ---- 辅助函数 ----

function makeTask(id: string, title: string, completed = false) {
  return { id, title, completed, subtasks: [] }
}

function dateOffset(today: string, days: number): string {
  const d = new Date(today + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---- 生命周期 ----

beforeEach(() => {
  fs.mkdirSync(mockUserDataDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(mockUserDataDir, { recursive: true, force: true })
})

// ===================== findAllCarryOverTasks =====================

describe('findAllCarryOverTasks', () => {
  const TODAY = '2026-03-22'

  it('无历史数据时返回空数组', () => {
    expect(findAllCarryOverTasks(TODAY)).toEqual([])
  })

  it('昨天有未完成任务时返回 1 组', () => {
    const yesterday = dateOffset(TODAY, -1)
    saveTasks(yesterday, [
      makeTask('t1', '写作业', false),
      makeTask('t2', '已完成', true),
    ])

    const groups = findAllCarryOverTasks(TODAY)
    expect(groups).toHaveLength(1)
    expect(groups[0].fromDate).toBe(yesterday)
    expect(groups[0].tasks).toHaveLength(1)
    expect((groups[0].tasks[0] as Record<string, unknown>).title).toBe('写作业')
  })

  it('多天有未完成任务时返回多组（近→远）', () => {
    const day1 = dateOffset(TODAY, -1)
    const day3 = dateOffset(TODAY, -3)
    const day5 = dateOffset(TODAY, -5)

    saveTasks(day1, [makeTask('a', '任务A', false)])
    saveTasks(day3, [makeTask('b', '任务B', false)])
    saveTasks(day5, [makeTask('c', '任务C', false)])

    const groups = findAllCarryOverTasks(TODAY)
    expect(groups).toHaveLength(3)
    expect(groups[0].fromDate).toBe(day1)
    expect(groups[1].fromDate).toBe(day3)
    expect(groups[2].fromDate).toBe(day5)
  })

  it('只有已完成任务的日期不会出现', () => {
    const yesterday = dateOffset(TODAY, -1)
    saveTasks(yesterday, [
      makeTask('t1', '任务1', true),
      makeTask('t2', '任务2', true),
    ])

    expect(findAllCarryOverTasks(TODAY)).toEqual([])
  })

  it('不扫描超过 7 天的数据', () => {
    const day8 = dateOffset(TODAY, -8)
    saveTasks(day8, [makeTask('old', '很久之前', false)])

    expect(findAllCarryOverTasks(TODAY)).toEqual([])
  })

  it('不扫描今天自身', () => {
    saveTasks(TODAY, [makeTask('today-task', '今天的任务', false)])
    expect(findAllCarryOverTasks(TODAY)).toEqual([])
  })
})

// ===================== findCarryOverTasks (旧版兼容) =====================

describe('findCarryOverTasks', () => {
  const TODAY = '2026-03-22'

  it('无数据返回 null', () => {
    expect(findCarryOverTasks(TODAY)).toBeNull()
  })

  it('有数据时只返回第一组（最近的）', () => {
    const day1 = dateOffset(TODAY, -1)
    const day3 = dateOffset(TODAY, -3)

    saveTasks(day1, [makeTask('a', '任务A', false)])
    saveTasks(day3, [makeTask('b', '任务B', false)])

    const result = findCarryOverTasks(TODAY)
    expect(result).not.toBeNull()
    expect(result!.fromDate).toBe(day1)
  })
})

// ===================== executeCarryOver =====================

describe('executeCarryOver', () => {
  const TODAY = '2026-03-22'
  const YESTERDAY = '2026-03-21'

  it('正常搬迁：任务出现在今天', () => {
    saveTasks(YESTERDAY, [
      makeTask('t1', '写数学', false),
      makeTask('t2', '写英语', false),
    ])
    saveTasks(TODAY, [])

    const ok = executeCarryOver(YESTERDAY, ['t1', 't2'], TODAY)
    expect(ok).toBe(true)

    const todayTasks = loadTasks(TODAY) as Array<Record<string, unknown>>
    expect(todayTasks).toHaveLength(2)
    expect(todayTasks[0].title).toBe('写数学')
    expect(todayTasks[0].carriedFrom).toBe(YESTERDAY)
    expect(todayTasks[0].id).not.toBe('t1')
  })

  it('已完成的任务不会被搬迁', () => {
    saveTasks(YESTERDAY, [
      makeTask('t1', '写数学', true),
    ])
    saveTasks(TODAY, [])

    executeCarryOver(YESTERDAY, ['t1'], TODAY)
    expect(loadTasks(TODAY)).toEqual([])
  })

  it('今天已有同名任务时跳过（去重）', () => {
    saveTasks(YESTERDAY, [makeTask('t1', '写数学', false)])
    saveTasks(TODAY, [makeTask('t-existing', '写数学', false)])

    executeCarryOver(YESTERDAY, ['t1'], TODAY)

    const todayTasks = loadTasks(TODAY)
    expect(todayTasks).toHaveLength(1)
  })

  it('taskIds 为空时不报错', () => {
    saveTasks(YESTERDAY, [makeTask('t1', '写数学', false)])
    const ok = executeCarryOver(YESTERDAY, [], TODAY)
    expect(ok).toBe(true)
    expect(loadTasks(TODAY)).toEqual([])
  })

  it('来源任务不存在时不报错', () => {
    saveTasks(YESTERDAY, [makeTask('t1', '写数学', false)])
    const ok = executeCarryOver(YESTERDAY, ['not-exist'], TODAY)
    expect(ok).toBe(true)
    expect(loadTasks(TODAY)).toEqual([])
  })

  it('搬迁的任务带有子任务', () => {
    saveTasks(YESTERDAY, [{
      id: 't1',
      title: '大作业',
      completed: false,
      subtasks: [
        { id: 's1', title: '第一部分', completed: true },
        { id: 's2', title: '第二部分', completed: false },
      ],
    }])
    saveTasks(TODAY, [])

    executeCarryOver(YESTERDAY, ['t1'], TODAY)

    const todayTasks = loadTasks(TODAY) as Array<Record<string, unknown>>
    expect(todayTasks).toHaveLength(1)
    const subs = todayTasks[0].subtasks as Array<Record<string, unknown>>
    expect(subs).toHaveLength(2)
    expect(subs[0].title).toBe('第一部分')
  })

  it('部分 taskIds 匹配时只搬迁匹配的', () => {
    saveTasks(YESTERDAY, [
      makeTask('t1', '任务A', false),
      makeTask('t2', '任务B', false),
      makeTask('t3', '任务C', false),
    ])
    saveTasks(TODAY, [])

    executeCarryOver(YESTERDAY, ['t1', 't3'], TODAY)

    const todayTasks = loadTasks(TODAY) as Array<Record<string, unknown>>
    expect(todayTasks).toHaveLength(2)
    const titles = todayTasks.map(t => t.title)
    expect(titles).toContain('任务A')
    expect(titles).toContain('任务C')
    expect(titles).not.toContain('任务B')
  })
})

// ===================== executeMultiCarryOver =====================

describe('executeMultiCarryOver', () => {
  const TODAY = '2026-03-22'

  it('多天搬迁全部成功', () => {
    const day1 = dateOffset(TODAY, -1)
    const day3 = dateOffset(TODAY, -3)

    saveTasks(day1, [makeTask('a', '任务A', false)])
    saveTasks(day3, [makeTask('b', '任务B', false)])
    saveTasks(TODAY, [])

    const ok = executeMultiCarryOver({
      [day1]: ['a'],
      [day3]: ['b'],
    }, TODAY)

    expect(ok).toBe(true)

    const todayTasks = loadTasks(TODAY) as Array<Record<string, unknown>>
    expect(todayTasks).toHaveLength(2)
    const titles = todayTasks.map(t => t.title)
    expect(titles).toContain('任务A')
    expect(titles).toContain('任务B')
  })

  it('空映射不报错', () => {
    const ok = executeMultiCarryOver({}, TODAY)
    expect(ok).toBe(true)
  })

  it('跨天同名任务只搬迁第一个（去重）', () => {
    const day1 = dateOffset(TODAY, -1)
    const day2 = dateOffset(TODAY, -2)

    saveTasks(day1, [makeTask('x1', '相同任务', false)])
    saveTasks(day2, [makeTask('x2', '相同任务', false)])
    saveTasks(TODAY, [])

    executeMultiCarryOver({
      [day1]: ['x1'],
      [day2]: ['x2'],
    }, TODAY)

    const todayTasks = loadTasks(TODAY) as Array<Record<string, unknown>>
    expect(todayTasks).toHaveLength(1)
    expect(todayTasks[0].title).toBe('相同任务')
  })
})
