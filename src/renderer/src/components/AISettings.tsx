/**
 * AISettings —— AI 配置弹窗
 *
 * 让用户填写豆包 API 的三个字段：
 *   - API 地址 (URL)
 *   - API Key
 *   - 模型 ID
 */

import { useState, useEffect } from 'react'
import type { AIConfig } from '../services/ai'
import { DEFAULT_AI_CONFIG } from '../services/ai'

interface AISettingsProps {
  visible: boolean
  config: AIConfig
  onSave: (config: AIConfig) => void
  onClose: () => void
}

export default function AISettings({ visible, config, onSave, onClose }: AISettingsProps) {
  const [form, setForm] = useState<AIConfig>({ ...DEFAULT_AI_CONFIG })

  // 打开时同步外部配置
  useEffect(() => {
    if (visible) setForm({ ...config })
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
      <div className="relative z-10 w-[380px] max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-y-auto">
        {/* 标题 */}
        <div className="px-6 pt-5 pb-3">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-sm">🤖</span>
            AI 配置
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            填写豆包 (Doubao) API 信息后，系统会在你开始任务时自动生成微动作建议。
          </p>
        </div>

        {/* 表单 */}
        <div className="px-6 py-3 space-y-4">
          {/* API 地址 */}
          <div>
            <label className="block text-xs text-gray-500 font-medium mb-1">API 地址</label>
            <input
              type="text"
              value={form.apiUrl}
              onChange={(e) => setForm(f => ({ ...f, apiUrl: e.target.value }))}
              placeholder="https://ark.cn-beijing.volces.com/api/v3/chat/completions"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200
                         focus:border-violet-400 focus:ring-1 focus:ring-violet-100
                         outline-none bg-gray-50 focus:bg-white transition-all"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-gray-500 font-medium mb-1">API Key</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm(f => ({ ...f, apiKey: e.target.value }))}
              placeholder="Bearer Token（如 sk-xxxx…）"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200
                         focus:border-violet-400 focus:ring-1 focus:ring-violet-100
                         outline-none bg-gray-50 focus:bg-white transition-all"
            />
          </div>

          {/* 模型 ID */}
          <div>
            <label className="block text-xs text-gray-500 font-medium mb-1">模型 ID</label>
            <input
              type="text"
              value={form.modelId}
              onChange={(e) => setForm(f => ({ ...f, modelId: e.target.value }))}
              placeholder="如 doubao-pro-32k / ep-xxxx"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200
                         focus:border-violet-400 focus:ring-1 focus:ring-violet-100
                         outline-none bg-gray-50 focus:bg-white transition-all"
            />
          </div>
        </div>

        {/* 按钮 */}
        <div className="px-6 py-4 flex items-center justify-end gap-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-xl transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-semibold
                       hover:bg-violet-600 active:scale-95 shadow-md shadow-violet-200/50 transition-all"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
