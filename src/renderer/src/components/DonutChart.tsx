/**
 * DonutChart —— 圆环进度图
 *
 * 用于「每日反思」页面展示任务完成率
 * 中心显示百分比数字，圆环用颜色区分完成/未完成
 */

interface DonutChartProps {
  /** 完成率 0-100 */
  percentage: number
  /** 圆环尺寸（像素），默认 160 */
  size?: number
  /** 圆环粗细，默认 14 */
  strokeWidth?: number
  /** 标签文字（可选） */
  label?: string
}

export default function DonutChart({
  percentage,
  size = 160,
  strokeWidth = 14,
  label,
}: DonutChartProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(Math.max(percentage, 0), 100) / 100)

  // 根据完成率选颜色
  const color =
    percentage >= 80 ? '#10b981' :   // emerald-500
    percentage >= 50 ? '#f59e0b' :   // amber-500
    percentage >= 20 ? '#f97316' :   // orange-500
    '#ef4444'                        // red-500

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          {/* 背景圆 */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#f3f4f6"
            strokeWidth={strokeWidth}
          />
          {/* 进度圆 */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{
              transition: 'stroke-dashoffset 1s ease-in-out, stroke 0.5s ease',
            }}
          />
        </svg>

        {/* 中心数字 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-bold text-gray-800 leading-none"
            style={{ fontSize: size * 0.22 }}
          >
            {Math.round(percentage)}%
          </span>
          {label && (
            <span
              className="text-gray-400 mt-1"
              style={{ fontSize: size * 0.08 }}
            >
              {label}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
