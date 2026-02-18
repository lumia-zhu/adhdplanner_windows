import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 主进程配置
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  // 预加载脚本配置
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  // 渲染进程（React前端）配置
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
