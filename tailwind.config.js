/** @type {import('tailwindcss').Config} */
export default {
  // 告诉 Tailwind 扫描哪些文件来生成样式
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      // 自定义颜色
      colors: {
        primary: '#6366f1',      // 主色调（靛蓝）
        'primary-dark': '#4f46e5',
      }
    },
  },
  plugins: [],
}
