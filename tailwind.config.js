import tailwindcssAnimate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  // 告诉 Tailwind 扫描哪些文件来生成样式
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        primary: '#6366f1',
        'primary-dark': '#4f46e5',
      },
      fontSize: {
        '3xs': ['9px',  { lineHeight: '12px' }],
        '2xs': ['10px', { lineHeight: '14px' }],
        'xxs': ['11px', { lineHeight: '16px' }],
        's':   ['13px', { lineHeight: '18px' }],
        'md':  ['15px', { lineHeight: '22px' }],
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
