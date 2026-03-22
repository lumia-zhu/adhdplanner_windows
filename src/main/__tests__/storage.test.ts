/**
 * storage.ts 单元测试
 *
 * 测试纯函数与文件 I/O 逻辑。
 * 通过 mock electron 和 fs 来隔离依赖。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ---- Mock electron ----
const mockUserDataDir = path.join(os.tmpdir(), `vitest-storage-${Date.now()}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataDir),
  },
  powerMonitor: {
    getSystemIdleTime: vi.fn(() => 0),
  },
}))

import {
  safeWriteJSON,
  getTodayStr,
  getNowHHMM,
  loadTasks,
  saveTasks,
  loadAIConfig,
  saveAIConfig,
  loadProfile,
  saveProfile,
  loadActivityData,
  appendActivityRecords,
  appendTrackerEvents,
  loadTrackerEvents,
  loadWidgetPos,
  saveWidgetPos,
} from '../storage'

// ---- 生命周期 ----

beforeEach(() => {
  fs.mkdirSync(mockUserDataDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(mockUserDataDir, { recursive: true, force: true })
})

// ===================== 日期工具 =====================

describe('getTodayStr', () => {
  it('返回 YYYY-MM-DD 格式', () => {
    const result = getTodayStr()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('与 Date 对象一致', () => {
    const d = new Date()
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(getTodayStr()).toBe(expected)
  })
})

describe('getNowHHMM', () => {
  it('返回 HH:MM 格式', () => {
    const result = getNowHHMM()
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })
})

// ===================== safeWriteJSON =====================

describe('safeWriteJSON', () => {
  it('能正确写入并读回 JSON', () => {
    const filePath = path.join(mockUserDataDir, 'test.json')
    const data = { hello: 'world', num: 42 }
    safeWriteJSON(filePath, data)

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    expect(content).toEqual(data)
  })

  it('写入后不留 .tmp 文件', () => {
    const filePath = path.join(mockUserDataDir, 'test2.json')
    safeWriteJSON(filePath, [1, 2, 3])

    expect(fs.existsSync(filePath + '.tmp')).toBe(false)
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('pretty=false 不缩进', () => {
    const filePath = path.join(mockUserDataDir, 'compact.json')
    safeWriteJSON(filePath, { a: 1 }, false)

    const raw = fs.readFileSync(filePath, 'utf-8')
    expect(raw).toBe('{"a":1}')
  })
})

// ===================== 任务数据读写 =====================

describe('loadTasks / saveTasks', () => {
  it('空文件系统返回空数组', () => {
    expect(loadTasks('2026-01-01')).toEqual([])
  })

  it('保存后能正确读回', () => {
    const tasks = [
      { id: 't1', title: '任务A', completed: false },
      { id: 't2', title: '任务B', completed: true },
    ]
    expect(saveTasks('2026-03-20', tasks)).toBe(true)
    expect(loadTasks('2026-03-20')).toEqual(tasks)
  })

  it('不同日期的数据互不干扰', () => {
    saveTasks('2026-03-20', [{ id: 'a' }])
    saveTasks('2026-03-21', [{ id: 'b' }])

    expect(loadTasks('2026-03-20')).toEqual([{ id: 'a' }])
    expect(loadTasks('2026-03-21')).toEqual([{ id: 'b' }])
  })

  it('文件损坏时返回空数组', () => {
    const filePath = path.join(mockUserDataDir, 'tasks-2026-01-01.json')
    fs.writeFileSync(filePath, 'not valid json{{{')
    expect(loadTasks('2026-01-01')).toEqual([])
  })
})

// ===================== AI 配置读写 =====================

describe('loadAIConfig / saveAIConfig', () => {
  it('无文件时返回空对象', () => {
    expect(loadAIConfig()).toEqual({})
  })

  it('保存后能正确读回', () => {
    const config = { apiKey: 'sk-xxx', modelId: 'gpt-4' }
    expect(saveAIConfig(config)).toBe(true)
    expect(loadAIConfig()).toEqual(config)
  })
})

// ===================== Profile 读写 =====================

describe('loadProfile / saveProfile', () => {
  it('无文件时返回空对象', () => {
    expect(loadProfile()).toEqual({})
  })

  it('保存后能正确读回', () => {
    const profile = { major: '计算机', grade: '高一' }
    expect(saveProfile(profile)).toBe(true)
    expect(loadProfile()).toEqual(profile)
  })
})

// ===================== Widget 位置 =====================

describe('loadWidgetPos / saveWidgetPos', () => {
  it('无文件时返回 null', () => {
    expect(loadWidgetPos()).toBeNull()
  })

  it('保存后能正确读回', () => {
    saveWidgetPos(100, 200)
    expect(loadWidgetPos()).toEqual({ x: 100, y: 200 })
  })
})

// ===================== Tracker 事件 =====================

describe('appendTrackerEvents / loadTrackerEvents', () => {
  it('空文件系统返回空数组', () => {
    expect(loadTrackerEvents('2026-03-20')).toEqual([])
  })

  it('追加后能读回', () => {
    const events = [{ type: 'click', ts: 1 }, { type: 'focus', ts: 2 }]
    expect(appendTrackerEvents('2026-03-20', events)).toBe(true)
    expect(loadTrackerEvents('2026-03-20')).toEqual(events)
  })

  it('多次追加合并', () => {
    appendTrackerEvents('2026-03-20', [{ a: 1 }])
    appendTrackerEvents('2026-03-20', [{ a: 2 }])
    expect(loadTrackerEvents('2026-03-20')).toEqual([{ a: 1 }, { a: 2 }])
  })
})

// ===================== Activity 数据 =====================

describe('appendActivityRecords / loadActivityData', () => {
  it('空文件系统返回空数组', () => {
    expect(loadActivityData('2026-03-20')).toEqual([])
  })

  it('写入并读回标准格式', () => {
    const records = [{
      ts: Date.now(),
      idle: 5,
      activeSamples: 10,
      totalSamples: 15,
      activeRatio: 0.67,
    }]
    appendActivityRecords('2026-03-20', records)
    const loaded = loadActivityData('2026-03-20')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].activeSamples).toBe(10)
  })

  it('旧版 inputs 字段兼容读取', () => {
    const legacyRecords = [{ ts: 1000, idle: 3, inputs: 4 }]
    const filePath = path.join(mockUserDataDir, 'activity-2026-03-20.json')
    fs.writeFileSync(filePath, JSON.stringify(legacyRecords))

    const loaded = loadActivityData('2026-03-20')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].activeSamples).toBeGreaterThanOrEqual(0)
    expect(loaded[0].totalSamples).toBe(15)
    expect(loaded[0].activeRatio).toBe(1)
  })

  it('无效记录被过滤', () => {
    const filePath = path.join(mockUserDataDir, 'activity-2026-03-20.json')
    fs.writeFileSync(filePath, JSON.stringify([
      { ts: 1, idle: 2, activeSamples: 1, totalSamples: 2, activeRatio: 0.5 },
      null,
      { noTs: true },
      'garbage',
    ]))

    const loaded = loadActivityData('2026-03-20')
    expect(loaded).toHaveLength(1)
  })
})
