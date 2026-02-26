/**
 * ProfileSettings —— 个人资料设置弹窗
 *
 * 让用户填写：专业、年级、挑战标签、常用工作场所、每日反思提醒时间
 * 这些信息会被 AI 用来提供更精准的个性化建议
 */

import { useState, useEffect } from 'react'
import type { UserProfile } from '../types'
import { EMPTY_PROFILE } from '../types'

interface ProfileSettingsProps {
  visible: boolean
  profile: UserProfile
  onSave: (profile: UserProfile) => void
  onClose: () => void
}

// -------- 预设选项 --------

/** 年级分组 */
const GRADE_OPTIONS = [
  { group: '本科', items: ['大一', '大二', '大三', '大四'] },
  { group: '硕士研究生', items: ['硕一', '硕二', '硕三'] },
  { group: '博士研究生', items: ['博一', '博二', '博三', '博四', '博五'] },
]

/** 预设挑战标签 */
const PRESET_CHALLENGES = ['拖延', '夜猫子', '容易分心', '完美主义', '时间估算不准', '优先级不清']

/** 预设工作场所 */
const PRESET_WORKPLACES = ['教室', '图书馆', '工位', '咖啡厅', '宿舍', '自习室', '家里']

// -------- 可复用的标签选择器 --------

function TagSelector({
  selected,
  presets,
  onChange,
  placeholder,
}: {
  selected: string[]
  presets: string[]
  onChange: (tags: string[]) => void
  placeholder: string
}) {
  const [customInput, setCustomInput] = useState('')

  // 合并预设和已选中的自定义标签（保证自定义标签也显示）
  const allTags = [...new Set([...presets, ...selected])]

  const toggle = (tag: string) => {
    if (selected.includes(tag)) {
      onChange(selected.filter(t => t !== tag))
    } else {
      onChange([...selected, tag])
    }
  }

  const addCustom = () => {
    const trimmed = customInput.trim()
    if (!trimmed || selected.includes(trimmed)) return
    onChange([...selected, trimmed])
    setCustomInput('')
  }

  return (
    <div>
      {/* 标签列表 */}
      <div className="flex flex-wrap gap-2 mb-2.5">
        {allTags.map(tag => {
          const isSelected = selected.includes(tag)
          return (
            <button
              key={tag}
              onClick={() => toggle(tag)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-150
                ${isSelected
                  ? 'bg-indigo-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              {tag}
              {/* 用固定宽度的 span 占位，避免选中/取消时宽度跳动 */}
              <span className="w-3.5 text-xs inline-flex justify-center">
                {isSelected ? '✓' : ''}
              </span>
            </button>
          )
        })}
      </div>

      {/* 自定义输入 */}
      <div className="flex gap-2">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200
                     focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100
                     outline-none bg-gray-50 focus:bg-white transition-all"
        />
        <button
          onClick={addCustom}
          disabled={!customInput.trim()}
          className="px-3 py-2 rounded-lg text-sm font-medium
                     bg-gray-100 text-gray-500 hover:bg-gray-200
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-all"
        >
          + 添加
        </button>
      </div>

      {/* 已选数量提示 */}
      <p className="text-xs text-gray-400 mt-1.5">
        已选择 {selected.length} 个标签 · 点击标签可取消选择
      </p>
    </div>
  )
}

// -------- 主组件 --------

export default function ProfileSettings({ visible, profile, onSave, onClose }: ProfileSettingsProps) {
  const [form, setForm] = useState<UserProfile>({ ...EMPTY_PROFILE })

  // 打开时同步外部数据
  useEffect(() => {
    if (visible) setForm({ ...profile })
  }, [visible])

  if (!visible) return null

  const handleSave = () => {
    onSave({ ...form })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* 面板 */}
      <div className="relative z-10 w-[440px] max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">个人资料设置</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center
                       text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 表单内容（可滚动） */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

          {/* 专业 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">专业</label>
            <input
              type="text"
              value={form.major}
              onChange={(e) => setForm(f => ({ ...f, major: e.target.value }))}
              placeholder="如：计算机科学、心理学、建筑设计…"
              className="w-full px-3 py-2.5 text-sm rounded-lg border border-gray-200
                         focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100
                         outline-none bg-gray-50 focus:bg-white transition-all
                         placeholder:text-gray-400"
            />
          </div>

          {/* 年级 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">年级</label>
            <select
              value={form.grade}
              onChange={(e) => setForm(f => ({ ...f, grade: e.target.value }))}
              className={`w-full px-3 py-2.5 text-sm rounded-lg border border-gray-200
                         focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100
                         outline-none bg-gray-50 focus:bg-white transition-all appearance-none
                         bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%239ca3af%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22/%3E%3C/svg%3E')]
                         bg-no-repeat bg-[right_0.5rem_center]
                         ${form.grade ? 'text-gray-800' : 'text-gray-400'}`}
            >
              <option value="" disabled className="text-gray-400">请选择年级</option>
              {GRADE_OPTIONS.map(group => (
                <optgroup key={group.group} label={group.group}>
                  {group.items.map(item => (
                    <option key={item} value={item} className="text-gray-800">{item}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* 我的挑战 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">我的挑战</label>
            <TagSelector
              selected={form.challenges}
              presets={PRESET_CHALLENGES}
              onChange={(tags) => setForm(f => ({ ...f, challenges: tags }))}
              placeholder="输入其他挑战"
            />
          </div>

          {/* 常用工作场所 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">常用工作场所</label>
            <TagSelector
              selected={form.workplaces}
              presets={PRESET_WORKPLACES}
              onChange={(tags) => setForm(f => ({ ...f, workplaces: tags }))}
              placeholder="输入其他场所"
            />
          </div>

          {/* 每日反思提醒时间 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">
              每日反思提醒时间
              <span className="text-xs text-gray-400 font-normal ml-1.5">(可选)</span>
            </label>
            <div className="relative">
              <input
                type="time"
                value={form.reflectionTime || ''}
                onChange={(e) => setForm(f => ({ ...f, reflectionTime: e.target.value || null }))}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-gray-200
                           focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100
                           outline-none bg-gray-50 focus:bg-white transition-all"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">设置后每天会在该时间提醒你进行反思总结</p>
          </div>

          {/* 个性化功能提示 */}
          <div className="bg-blue-50 rounded-xl p-4 flex gap-3">
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-400 flex items-center justify-center mt-0.5">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-700">个性化功能</p>
              <p className="text-xs text-blue-600 mt-0.5 leading-relaxed">
                完善个人资料后，AI 可以根据你的专业、年级、挑战和工作场所提供更精准的任务建议。
              </p>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="relative px-6 py-4 flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50/50">
          {/* 分割线上的滚动提示 */}
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 bg-white text-[10px] text-gray-400 whitespace-nowrap">
            ↕ 滚动查看更多
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-700
                       border border-gray-200 hover:bg-gray-100 transition-all"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg bg-indigo-500 text-white text-sm font-semibold
                       hover:bg-indigo-600 active:scale-95 shadow-md shadow-indigo-200/50 transition-all"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
