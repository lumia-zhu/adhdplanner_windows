import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 找到 HTML 中 id="root" 的元素，把 React 应用渲染进去
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
