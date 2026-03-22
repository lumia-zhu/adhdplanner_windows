import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// 全局异常兜底：防止未捕获的错误导致白屏
window.addEventListener('error', (e) => {
  console.error('[Renderer] Uncaught error:', e.error || e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Renderer] Unhandled rejection:', e.reason)
})

// 找到 HTML 中 id="root" 的元素，把 React 应用渲染进去
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
