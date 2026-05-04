import {
  BrowserWindow, Tray, Menu, Notification,
  nativeImage, shell, screen,
} from 'electron'
import { join } from 'path'
import fs from 'fs'
import { S } from './state'
import { loadProfile, getTodayStr, getNowHHMM } from './storage'

// ===================== 窗口尺寸常量 =====================

export const MAIN_WIDTH  = 480
export const MAIN_HEIGHT = 680
export const WIDGET_WIDTH  = 560
export const WIDGET_HEIGHT = 52

// ===================== 屏幕自适应缩放 =====================

export function computeUIScale(): number {
  const { width } = screen.getPrimaryDisplay().workAreaSize
  if (width <= 1920) return 1.0
  if (width <= 2560) return 1.1
  if (width <= 3200) return 1.2
  return 1.3
}

export function scaled(n: number): number {
  return Math.round(n * S.uiScale)
}

// ===================== 安全窗口操作 =====================

export function safeWinOp(label: string, fn: (win: BrowserWindow) => void): void {
  try {
    if (S.mainWindow && !S.mainWindow.isDestroyed()) {
      fn(S.mainWindow)
    }
  } catch (e) {
    console.error(`[safeWinOp:${label}]`, e)
  }
}

// ===================== 拖拽区域刷新 =====================

export function refreshDragRegion(): void {
  setTimeout(() => {
    if (S.mainWindow && !S.mainWindow.isDestroyed()) {
      S.mainWindow.webContents.send('widget:refreshDrag')
    }
  }, 80)
}

/**
 * 原子化把悬浮窗居中到当前屏幕。
 *
 * 关键点：必须用传入的目标宽度计算居中，不要用 getBounds()/getContentBounds()，
 * 因为 setSize 在 Windows 上是异步的，紧接着读 getBounds 仍是旧尺寸，会导致按旧宽度居中。
 *
 * 使用 setBounds 一次性设置 x / y / width / height，避免“先 setSize 再 setPosition”
 * 之间出现尺寸/位置不一致的过渡帧。
 */
export function centerWidgetWindow(win: BrowserWindow, width: number, height: number): { x: number; y: number } {
  const { workArea } = screen.getDisplayMatching(win.getBounds())
  const x = workArea.x + Math.round((workArea.width - width) / 2)
  const y = workArea.y + 8
  win.setBounds({ x, y, width, height })
  console.log(`[CenterWidget] workArea=${workArea.x},${workArea.y} ${workArea.width}x${workArea.height} → bar ${width}x${height} @ ${x},${y}`)
  return { x, y }
}

// ===================== Widget 心跳守护 =====================

export function startWidgetHeartbeat(): void {
  stopWidgetHeartbeat()
  S.widgetHeartbeatTimer = setInterval(() => {
    if (!S.mainWindow || S.mainWindow.isDestroyed() || !S.isWidgetMode) return

    try {
      if (S.mainWindow.isMinimized()) {
        console.log('[Heartbeat] Widget was minimized, restoring')
        S.mainWindow.restore()
        refreshDragRegion()
      }

      if (!S.mainWindow.isVisible()) {
        console.log('[Heartbeat] Widget not visible, showing')
        S.mainWindow.show()
        refreshDragRegion()
      }

      if (!S.mainWindow.isAlwaysOnTop()) {
        console.log('[Heartbeat] alwaysOnTop lost, re-applying')
        S.mainWindow.setAlwaysOnTop(true, 'screen-saver')
        S.mainWindow.moveTop()
        refreshDragRegion()
      }
    } catch (e) {
      console.error('[Heartbeat] Error:', e)
    }
  }, 1500)
}

export function stopWidgetHeartbeat(): void {
  if (S.widgetHeartbeatTimer) {
    clearInterval(S.widgetHeartbeatTimer)
    S.widgetHeartbeatTimer = null
  }
}

// ===================== Widget 边界校验 =====================

export function validateWidgetBounds(): void {
  if (!S.mainWindow || S.mainWindow.isDestroyed() || !S.isWidgetMode) return

  try {
    const bounds = S.mainWindow.getBounds()
    const { workArea } = screen.getDisplayMatching(bounds)

    const halfW = Math.round(bounds.width / 2)
    if (
      bounds.x < workArea.x - halfW
      || bounds.x > workArea.x + workArea.width - halfW
      || bounds.y < workArea.y - 10
      || bounds.y > workArea.y + workArea.height - 10
    ) {
      console.log(`[BoundsCheck] Widget out of screen (${bounds.x},${bounds.y}), recentering`)
      centerWidgetWindow(S.mainWindow, bounds.width, bounds.height)
    }
  } catch (e) {
    console.error('[BoundsCheck] Error:', e)
  }
}

// ===================== Widget 事件处理 =====================

export function onWidgetMoved(): void {
  // 已废弃位置记忆：拖动后不再持久化坐标，下次进入小组件统一回到顶部中间。
  // 保留此空函数以维持现有事件订阅接口。
  if (!S.mainWindow || !S.isWidgetMode) return
}

export function onWidgetBlur(): void {
  if (!S.mainWindow || S.mainWindow.isDestroyed() || !S.isWidgetMode) return
  setTimeout(() => {
    safeWinOp('widget-blur-restore', (win) => {
      if (S.isWidgetMode) {
        win.setAlwaysOnTop(true, 'screen-saver')
        win.moveTop()
      }
    })
  }, 100)
}

export function onWidgetMinimize(): void {
  if (!S.mainWindow || S.mainWindow.isDestroyed() || !S.isWidgetMode) return
  setTimeout(() => {
    safeWinOp('anti-minimize', (win) => {
      if (S.isWidgetMode && win.isMinimized()) {
        win.restore()
        win.setAlwaysOnTop(true, 'screen-saver')
        win.moveTop()
        refreshDragRegion()
      }
    })
  }, 50)
}

// ===================== 进入/退出 Widget =====================

export function enterWidget(): void {
  if (!S.mainWindow || S.isWidgetMode) return
  S.isWidgetMode = true

  // 每次进入小组件都强制放到顶部中间（不再使用"位置记忆"）：
  // 用户反馈"任务开始时悬浮窗不在顶部中间"——是因为之前拖动过的位置被记住了。
  // 去掉记忆后，每次进入位置稳定可预期；后续若想拖动，依然可以，但本次会话外不持久化。
  const scaledW = scaled(WIDGET_WIDTH)
  const scaledH = scaled(WIDGET_HEIGHT)

  safeWinOp('enterWidget', (win) => {
    win.setMinimumSize(1, 1)
    win.setMaximumSize(9999, 9999)
    win.setBackgroundColor('#00000000')
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true)
    centerWidgetWindow(win, scaledW, scaledH)
    win.setMinimumSize(scaledW, scaledH)
    win.setMaximumSize(scaledW, scaledH)
    win.show()
    win.moveTop()
  })

  S.mainWindow.on('moved', onWidgetMoved)
  S.mainWindow.on('minimize', onWidgetMinimize)
  S.mainWindow.on('blur', onWidgetBlur)
  startWidgetHeartbeat()
}

export function exitWidget(): void {
  if (!S.mainWindow || S.mainWindow.isDestroyed() || !S.isWidgetMode) return
  S.isWidgetMode = false

  stopWidgetHeartbeat()

  S.mainWindow.off('moved', onWidgetMoved)
  S.mainWindow.off('minimize', onWidgetMinimize)
  S.mainWindow.off('blur', onWidgetBlur)

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  safeWinOp('exitWidget', (win) => {
    win.setMinimumSize(1, 1)
    win.setMaximumSize(0, 0)
    win.setBackgroundColor('#ffffff')
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(false)
    win.setSize(scaled(MAIN_WIDTH), scaled(MAIN_HEIGHT))
    win.setMinimumSize(scaled(MAIN_WIDTH), scaled(MAIN_HEIGHT))
    win.setPosition(Math.round((sw - scaled(MAIN_WIDTH)) / 2), Math.round((sh - scaled(MAIN_HEIGHT)) / 2))
  })
}

// ===================== 每日反思提醒 =====================

export function showReflectionView(): void {
  if (!S.mainWindow || S.mainWindow.isDestroyed()) return
  if (S.isWidgetMode) {
    exitWidget()
    safeWinOp('showReflection:exitWidget', (win) => win.webContents.send('widget:exit'))
  }
  safeWinOp('showReflection', (win) => {
    win.show()
    win.focus()
    win.webContents.send('navigate:reflection')
  })
  updateTrayMenu()
}

function checkReflectionTime(): void {
  if (!S.cachedReflectionTime) return
  const today = getTodayStr()
  const now = getNowHHMM()
  if (S.lastNotifiedDate === today) return
  if (now === S.cachedReflectionTime) {
    S.lastNotifiedDate = today
    safeWinOp('reflectionReminderPending', (win) => {
      win.webContents.send('reflection:reminder-pending', today)
    })
    const notification = new Notification({
      title: '🌙 该反思了',
      body: '今天辛苦了，花几分钟回顾一下吧',
      silent: false,
    })
    notification.on('click', () => showReflectionView())
    notification.show()
  }
}

export function startReflectionTimer(): void {
  if (S.reflectionTimer) clearInterval(S.reflectionTimer)
  const profile = loadProfile()
  S.cachedReflectionTime = profile.reflectionTime ? String(profile.reflectionTime) : null
  if (!S.cachedReflectionTime) {
    S.reflectionTimer = null
    return
  }
  checkReflectionTime()
  S.reflectionTimer = setInterval(checkReflectionTime, 30_000)
}

// ===================== 每日计划提醒 =====================

// 多套文案 + emoji，每次提醒时随机挑一条，避免每天都长一样让用户失去兴趣
const PLAN_NOTIFICATIONS: Array<{ title: string; body: string }> = [
  { title: '☀️ 新的一天开始了',    body: '花两分钟列一下今天的计划吧'           },
  { title: '📝 该列今日清单啦',    body: '想想今天最想完成哪 3 件事？'           },
  { title: '🌱 给今天种几个目标',  body: '小小一步也算数，写下来更有方向'         },
  { title: '🚀 准备发车了',        body: '今天打算先做什么？写下来就完成 10% 啦' },
  { title: '🗓️ 今天要做什么？',    body: '先列出来，再决定从哪里开始'            },
  { title: '📋 今天先列个清单',    body: '写下来，脑子就不用一直记着了'           },
  { title: '✏️ 花些时间列好今天的事', body: '写完之后做起来会顺很多'             },
]

function pickPlanNotification(): { title: string; body: string } {
  const i = Math.floor(Math.random() * PLAN_NOTIFICATIONS.length)
  return PLAN_NOTIFICATIONS[i]
}

function showMainWindow(): void {
  if (!S.mainWindow || S.mainWindow.isDestroyed()) return
  if (S.isWidgetMode) {
    exitWidget()
    safeWinOp('showMain:exitWidget', (win) => win.webContents.send('widget:exit'))
  }
  safeWinOp('showMain', (win) => {
    win.show()
    win.focus()
  })
  updateTrayMenu()
}

function checkPlanTime(): void {
  if (!S.cachedPlanTime) return
  const today = getTodayStr()
  const now = getNowHHMM()
  if (S.lastPlanNotifiedDate === today) return
  if (now === S.cachedPlanTime) {
    S.lastPlanNotifiedDate = today
    const { title, body } = pickPlanNotification()
    const notification = new Notification({ title, body, silent: false })
    notification.on('click', () => showMainWindow())
    notification.show()
  }
}

export function startPlanTimer(): void {
  if (S.planTimer) clearInterval(S.planTimer)
  const profile = loadProfile()
  S.cachedPlanTime = profile.planTime ? String(profile.planTime) : null
  if (!S.cachedPlanTime) {
    S.planTimer = null
    return
  }
  checkPlanTime()
  S.planTimer = setInterval(checkPlanTime, 30_000)
}

// ===================== 托盘图标 =====================

function buildTrayIcon(): Electron.NativeImage {
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAB' +
    'AElEQVR4nO2WMQrCQBBFZ9cj6Bm8gCdhwMJCsLGwt/EAFnoCL2BhIXgCCwsLwcLCQrC2sLDY' +
    '2VhY2FgEQf8gIYSQkJA3mQlhd3d2Z/5/dxJCCCGEEEIIIYQQQgghhBBC/jVJkrRVVe29956q' +
    'qqrqvffee++99957773333vvvffee++99957773333vvvffee++99957773333vvvffee++99957' +
    '773333vvvffee++99957773333vvvffee++99957773333vvvffee++99957773333vvvffee++9' +
    '9957773333vvvffee++99957773333vvvffee++99957773333vvvffee++99957773333vvvffe' +
    'e++9RQghJABeP3UBMgAAAABJRU5ErkJggg=='
  )
}

// ===================== 创建主窗口 =====================

export function createMainWindow(): void {
  S.mainWindow = new BrowserWindow({
    width: scaled(MAIN_WIDTH),
    height: scaled(MAIN_HEIGHT),
    show: false,
    frame: false,
    resizable: true,
    transparent: true,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  S.mainWindow.on('ready-to-show', () => {
    S.mainWindow?.webContents.setZoomFactor(S.uiScale)
    S.mainWindow?.show()
  })

  // 渲染进程崩溃自动恢复
  S.mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Crash] Render process gone:', details.reason)
    if (S.mainWindow && !S.mainWindow.isDestroyed()) {
      setTimeout(() => {
        S.mainWindow?.webContents.reload()
        console.log('[Crash] Page reloaded after render-process-gone')
      }, 500)
    }
  })
  S.mainWindow.webContents.on('unresponsive', () => {
    console.error('[Crash] Renderer unresponsive, reloading...')
    if (S.mainWindow && !S.mainWindow.isDestroyed()) {
      S.mainWindow.webContents.reload()
    }
  })

  // 点「×」关闭时不退出，而是隐藏到托盘
  S.mainWindow.on('close', (e) => {
    if (!S.forceQuit) {
      e.preventDefault()
      if (S.isWidgetMode) {
        stopWidgetHeartbeat()
        S.isWidgetMode = false
        S.mainWindow?.off('moved', onWidgetMoved)
        S.mainWindow?.off('minimize', onWidgetMinimize)
        S.mainWindow?.off('blur', onWidgetBlur)
        S.mainWindow?.webContents.send('widget:exit')
      }
      S.mainWindow?.hide()
      updateTrayMenu()
    }
  })

  S.mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    S.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    S.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ===================== 系统托盘 =====================

export function updateTrayMenu(): void {
  if (!S.tray) return

  const isVisible = S.mainWindow?.isVisible() ?? false
  const menu = Menu.buildFromTemplate([
    {
      label: S.pendingCount > 0 ? `📋 待办任务：${S.pendingCount} 项` : '✅ 所有任务已完成',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: isVisible ? '隐藏主窗口' : '显示主窗口',
      click: () => {
        safeWinOp('tray:toggleVisible', (win) => {
          if (win.isVisible()) {
            win.hide()
          } else {
            win.show()
            win.focus()
            if (S.isWidgetMode) exitWidget()
          }
        })
        updateTrayMenu()
      },
    },
    {
      label: S.isWidgetMode ? '退出小组件模式' : '切换为小组件置顶',
      click: () => {
        if (S.isWidgetMode) {
          exitWidget()
          safeWinOp('tray:exitWidget', (win) => win.webContents.send('widget:exit'))
        } else {
          enterWidget()
          safeWinOp('tray:enterWidget', (win) => win.webContents.send('widget:enter'))
        }
        updateTrayMenu()
      },
    },
    { type: 'separator' },
    {
      label: '退出应用',
      click: () => {
        S.forceQuit = true
        // app.quit() 需要在调用处处理
        // 这里通过 process exit 触发
        const { app } = require('electron')
        app.quit()
      },
    },
  ])

  S.tray.setContextMenu(menu)
  S.tray.setToolTip(
    S.pendingCount > 0 ? `任务管理器 · ${S.pendingCount} 项待办` : '任务管理器 · 全部完成 🎉'
  )
}

export function createTray(): void {
  let icon: Electron.NativeImage
  const iconPath = join(__dirname, '../../resources/icon.png')
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  } else {
    icon = buildTrayIcon()
  }

  S.tray = new Tray(icon)
  updateTrayMenu()

  S.tray.on('double-click', () => {
    safeWinOp('tray:dblclick', (win) => {
      if (win.isVisible()) {
        win.hide()
      } else {
        win.show()
        win.focus()
      }
    })
    updateTrayMenu()
  })
}
