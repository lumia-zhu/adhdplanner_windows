'use client'

import { useState, useMemo } from 'react'
import { exportCSV } from '@/lib/export-csv'

interface TaskRow {
  id: string
  date: string
  title: string
  priority: string
  completed: boolean
  focus_duration: number
  carried_from: string | null
  subtasks: Array<{ id: string; title: string; completed: boolean }> | null
}

interface ActivityRow {
  id: number
  date: string
  ts: number
  idle: number
  active_samples: number
  total_samples: number
  active_ratio: number
}

interface Props {
  tasks: TaskRow[]
  activities: ActivityRow[]
}

const TASK_PAGE_SIZE = 30
const ACTIVITY_PAGE_SIZE = 50

export default function TasksActivityTab({ tasks, activities }: Props) {
  const [taskFilter, setTaskFilter] = useState<'all' | 'completed' | 'pending'>('all')
  const [taskPage, setTaskPage] = useState(0)
  const [activityPage, setActivityPage] = useState(0)

  const filteredTasks = useMemo(() => {
    if (taskFilter === 'all') return tasks
    return tasks.filter(t => taskFilter === 'completed' ? t.completed : !t.completed)
  }, [tasks, taskFilter])

  const taskPages = Math.ceil(filteredTasks.length / TASK_PAGE_SIZE)
  const taskSlice = filteredTasks.slice(taskPage * TASK_PAGE_SIZE, (taskPage + 1) * TASK_PAGE_SIZE)

  const activityPages = Math.ceil(activities.length / ACTIVITY_PAGE_SIZE)
  const activitySlice = activities.slice(activityPage * ACTIVITY_PAGE_SIZE, (activityPage + 1) * ACTIVITY_PAGE_SIZE)

  return (
    <div className="space-y-8">
      {/* 任务表格 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">任务列表</h3>
          <div className="flex items-center gap-2">
            {(['all', 'completed', 'pending'] as const).map(f => (
              <button
                key={f}
                onClick={() => { setTaskFilter(f); setTaskPage(0) }}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${taskFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
              >
                {f === 'all' ? '全部' : f === 'completed' ? '已完成' : '未完成'}
              </button>
            ))}
            <button
              onClick={() => exportCSV(tasks.map(t => ({
                date: t.date, title: t.title, priority: t.priority,
                completed: t.completed ? '是' : '否',
                focus_min: Math.round(t.focus_duration / 60),
                carried_from: t.carried_from ?? '',
              })), 'tasks.csv')}
              className="text-xs text-blue-600 hover:underline"
            >
              导出 CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">日期</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">标题</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">优先级</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">状态</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">专注(分)</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">搬迁来源</th>
              </tr>
            </thead>
            <tbody>
              {taskSlice.map(t => (
                <tr key={`${t.date}-${t.id}`} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-500">{t.date}</td>
                  <td className="px-4 py-2 text-gray-800">{t.title}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      t.priority === 'high' ? 'bg-red-100 text-red-700' :
                      t.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{t.priority}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs ${t.completed ? 'text-green-600' : 'text-gray-400'}`}>
                      {t.completed ? '已完成' : '进行中'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{Math.round(t.focus_duration / 60)}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs">{t.carried_from ?? '-'}</td>
                </tr>
              ))}
              {taskSlice.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {taskPages > 1 && (
          <Pagination page={taskPage} total={taskPages} count={filteredTasks.length} onChange={setTaskPage} />
        )}
      </section>

      {/* 活跃度表格 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">活跃度记录</h3>
          <button
            onClick={() => exportCSV(activities.map(a => ({
              date: a.date, time: new Date(a.ts).toLocaleString('zh-CN'),
              idle_sec: a.idle, active_samples: a.active_samples,
              total_samples: a.total_samples, active_ratio: a.active_ratio.toFixed(3),
            })), 'activity.csv')}
            className="text-xs text-blue-600 hover:underline"
          >
            导出 CSV
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">时间</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">空闲(秒)</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">活跃采样</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">总采样</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">活跃比</th>
              </tr>
            </thead>
            <tbody>
              {activitySlice.map(a => (
                <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                    {new Date(a.ts).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{a.idle}</td>
                  <td className="px-4 py-2 text-gray-600">{a.active_samples}</td>
                  <td className="px-4 py-2 text-gray-600">{a.total_samples}</td>
                  <td className="px-4 py-2 text-gray-800 font-medium">
                    {(a.active_ratio * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
              {activitySlice.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {activityPages > 1 && (
          <Pagination page={activityPage} total={activityPages} count={activities.length} onChange={setActivityPage} />
        )}
      </section>
    </div>
  )
}

function Pagination({ page, total, count, onChange }: {
  page: number; total: number; count: number; onChange: (p: number) => void
}) {
  return (
    <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
      <span>共 {count} 条，第 {page + 1}/{total} 页</span>
      <div className="flex gap-2">
        <button disabled={page === 0} onClick={() => onChange(page - 1)}
          className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40">上一页</button>
        <button disabled={page >= total - 1} onClick={() => onChange(page + 1)}
          className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40">下一页</button>
      </div>
    </div>
  )
}
