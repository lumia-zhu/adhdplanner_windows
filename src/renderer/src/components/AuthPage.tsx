/**
 * 登录/注册页面（用户名 + 密码）
 */

import { useState } from 'react'

interface AuthPageProps {
  onLoginSuccess: (user: { id: string; email: string }) => void
}

export default function AuthPage({ onLoginSuccess }: AuthPageProps) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!username.trim() || !password.trim()) {
      setError('请填写用户名和密码')
      return
    }

    if (/[^a-zA-Z0-9_\-]/.test(username.trim())) {
      setError('用户名只能包含字母、数字、下划线和横线')
      return
    }

    if (isSignUp && password !== confirmPassword) {
      setError('两次密码不一致')
      return
    }

    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }

    setLoading(true)
    try {
      if (isSignUp) {
        const result = await window.electronAPI.authSignUp(username.trim(), password)
        if (!result.ok) {
          setError(result.error || '注册失败')
        } else if (result.user) {
          onLoginSuccess(result.user as { id: string; email: string })
        } else {
          setError('注册异常，请重试')
        }
      } else {
        const result = await window.electronAPI.authSignIn(username.trim(), password)
        if (!result.ok) {
          setError(result.error || '登录失败')
        } else if (result.user) {
          onLoginSuccess(result.user as { id: string; email: string })
        }
      }
    } catch {
      setError('网络错误，请检查网络连接')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="w-[380px] bg-white rounded-2xl shadow-lg shadow-indigo-100/50 p-8 relative"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* 标题 */}
        <div className="text-center mb-8">
          <div className="text-3xl mb-2">📋</div>
          <h1 className="text-xl font-bold text-gray-800">任务管理器</h1>
          <p className="text-xs text-gray-400 mt-1">
            {isSignUp ? '创建账号，开始使用' : '登录你的账号'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="字母、数字、下划线"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200
                         text-sm text-gray-800 placeholder-gray-300
                         focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400
                         transition-all"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200
                         text-sm text-gray-800 placeholder-gray-300
                         focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400
                         transition-all"
            />
          </div>

          {isSignUp && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">确认密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再输入一次密码"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200
                           text-sm text-gray-800 placeholder-gray-300
                           focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400
                           transition-all"
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600
                       disabled:opacity-50 disabled:cursor-not-allowed
                       text-white font-medium text-sm transition-colors"
          >
            {loading ? '处理中...' : isSignUp ? '注册' : '登录'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError('') }}
            className="text-xs text-gray-400 hover:text-indigo-500 transition-colors"
          >
            {isSignUp ? '已有账号？去登录' : '没有账号？注册一个'}
          </button>
        </div>

        {/* 关闭按钮 */}
        <button
          onClick={() => window.electronAPI.quitApp()}
          className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center
                     text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-all"
          title="退出"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
