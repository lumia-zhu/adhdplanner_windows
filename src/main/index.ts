import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage, net } from 'electron'
import { join } from 'path'
import fs from 'fs'

// ===================== 数据存储相关 =====================

const getDataPath = (): string => join(app.getPath('userData'), 'tasks.json')
const getAIConfigPath = (): string => join(app.getPath('userData'), 'ai-config.json')

function loadAIConfig(): Record<string, string> {
  try {
    const p = getAIConfigPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadAIConfig]', e) }
  return {}
}

function saveAIConfig(config: Record<string, string>): boolean {
  try {
    fs.writeFileSync(getAIConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch (e) { console.error('[saveAIConfig]', e); return false }
}

function loadTasks(): unknown[] {
  try {
    const p = getDataPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadTasks]', e) }
  return []
}

function saveTasks(tasks: unknown[]): boolean {
  try {
    fs.writeFileSync(getDataPath(), JSON.stringify(tasks, null, 2), 'utf-8')
    return true
  } catch (e) { console.error('[saveTasks]', e); return false }
}

// ===================== 窗口尺寸常量 =====================

const MAIN_WIDTH  = 480
const MAIN_HEIGHT = 680
const WIDGET_WIDTH  = 380
const WIDGET_HEIGHT = 44

// ===================== 全局状态 =====================

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isWidgetMode = false
let pendingCount = 0   // 当前待办任务数（用于更新托盘提示）
let forceQuit = false  // 标记是否真正退出（区分"关闭"和"退出"）

// ===================== 小组件位置记忆 =====================

const getWidgetPosPath = (): string => join(app.getPath('userData'), 'widget-pos.json')

function loadWidgetPos(): { x: number; y: number } | null {
  try {
    const p = getWidgetPosPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch { /* 忽略 */ }
  return null
}

function saveWidgetPos(x: number, y: number): void {
  try { fs.writeFileSync(getWidgetPosPath(), JSON.stringify({ x, y }), 'utf-8') }
  catch { /* 忽略 */ }
}

// ===================== 托盘图标（32×32 PNG，任务清单样式）=====================

/**
 * 用纯像素数据生成托盘图标
 * 紫色圆角背景 + 白色勾选符号
 */
function buildTrayIcon(): Electron.NativeImage {
  // 一个 16×16 的简洁 PNG（indigo 背景 + 白色 ✓）
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

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
    show: false,
    frame: false,
    resizable: true,   // ★ 必须为 true，否则 Windows 系统最小高度限制会阻止 setSize() 缩小到 44px
    transparent: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // ★ 关键改动：点「×」关闭时不退出，而是隐藏到托盘
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()       // 阻止真正关闭
      mainWindow?.hide()       // 隐藏到托盘
      updateTrayMenu()         // 更新菜单显示"显示窗口"
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ===================== 系统托盘 =====================

/** 刷新托盘右键菜单（窗口显示/隐藏状态变化时调用）*/
function updateTrayMenu(): void {
  if (!tray) return

  const isVisible = mainWindow?.isVisible() ?? false
  const isAutoStart = app.getLoginItemSettings().openAtLogin

  const menu = Menu.buildFromTemplate([
    // 第一行：显示当前任务数量（不可点击，只作提示）
    {
      label: pendingCount > 0 ? `📋 待办任务：${pendingCount} 项` : '✅ 所有任务已完成',
      enabled: false,
    },
    { type: 'separator' },

    // 显示/隐藏主窗口
    {
      label: isVisible ? '隐藏主窗口' : '显示主窗口',
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow?.show()
          mainWindow?.focus()
          // 如果在小组件模式，先退出小组件
          if (isWidgetMode) exitWidget()
        }
        updateTrayMenu()
      },
    },

    // 切换小组件模式
    {
      label: isWidgetMode ? '退出小组件模式' : '切换为小组件置顶',
      click: () => {
        if (isWidgetMode) {
          exitWidget()
          mainWindow?.webContents.send('widget:exit') // 通知前端切换 UI
        } else {
          enterWidget()
          mainWindow?.webContents.send('widget:enter') // 通知前端切换 UI
        }
        updateTrayMenu()
      },
    },

    { type: 'separator' },

    // 开机自启开关
    {
      label: isAutoStart ? '✓ 开机自动启动' : '开机自动启动',
      click: () => {
        const newValue = !isAutoStart
        app.setLoginItemSettings({ openAtLogin: newValue })
        updateTrayMenu() // 立刻更新菜单勾选状态
      },
    },

    { type: 'separator' },

    // 退出
    {
      label: '退出应用',
      click: () => {
        forceQuit = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(menu)
  // 托盘悬停提示也同步更新
  tray.setToolTip(
    pendingCount > 0 ? `任务管理器 · ${pendingCount} 项待办` : '任务管理器 · 全部完成 🎉'
  )
}

function createTray(): void {
  // 尝试加载 resources 目录的图标，否则用内置图标
  let icon: Electron.NativeImage
  const iconPath = join(__dirname, '../../resources/icon.png')
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  } else {
    icon = buildTrayIcon()
  }

  tray = new Tray(icon)
  updateTrayMenu()

  // 双击托盘图标：显示/隐藏主窗口
  tray.on('double-click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
    updateTrayMenu()
  })
}

// ===================== 小组件模式核心逻辑 =====================

function onWidgetMoved(): void {
  if (!mainWindow || !isWidgetMode) return
  const [x, y] = mainWindow.getPosition()
  saveWidgetPos(x, y)
}

function enterWidget(): void {
  if (!mainWindow || isWidgetMode) return
  isWidgetMode = true

  const { screen } = require('electron')
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize
  const saved = loadWidgetPos()
  const x = saved ? saved.x : Math.round((sw - WIDGET_WIDTH) / 2)
  const y = saved ? saved.y : 8

  mainWindow.setMinimumSize(WIDGET_WIDTH, WIDGET_HEIGHT)
  mainWindow.setMaximumSize(WIDGET_WIDTH, WIDGET_HEIGHT)  // 固定小组件大小，防止用户拖拽缩放
  mainWindow.setAlwaysOnTop(true, 'floating')
  mainWindow.setVisibleOnAllWorkspaces(true)
  mainWindow.setSize(WIDGET_WIDTH, WIDGET_HEIGHT)
  mainWindow.setPosition(x, y)
  mainWindow.show()
  mainWindow.on('moved', onWidgetMoved)
}

function exitWidget(): void {
  if (!mainWindow || !isWidgetMode) return
  isWidgetMode = false

  const [cx, cy] = mainWindow.getPosition()
  saveWidgetPos(cx, cy)
  mainWindow.off('moved', onWidgetMoved)

  const { screen } = require('electron')
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  mainWindow.setMaximumSize(0, 0)    // 0,0 表示取消最大尺寸限制
  mainWindow.setMinimumSize(MAIN_WIDTH, MAIN_HEIGHT)
  mainWindow.setAlwaysOnTop(false)
  mainWindow.setVisibleOnAllWorkspaces(false)
  mainWindow.setSize(MAIN_WIDTH, MAIN_HEIGHT)
  mainWindow.setPosition(Math.round((sw - MAIN_WIDTH) / 2), Math.round((sh - MAIN_HEIGHT) / 2))
}

// ===================== IPC 通信 =====================

function setupIPC(): void {
  ipcMain.handle('tasks:load', () => loadTasks())

  ipcMain.handle('tasks:save', (_, tasks: unknown[]) => saveTasks(tasks))

  // 前端同步待办数量，用于更新托盘提示
  ipcMain.on('tray:updateCount', (_, count: number) => {
    pendingCount = count
    updateTrayMenu()
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:hide',     () => { mainWindow?.hide(); updateTrayMenu() })
  ipcMain.on('window:quit',     () => { forceQuit = true; app.quit() })

  ipcMain.on('window:enterWidget', () => { enterWidget(); updateTrayMenu() })
  ipcMain.on('window:exitWidget',  () => { exitWidget();  updateTrayMenu() })

  // -------- 小组件动态调整大小 --------
  ipcMain.on('window:resizeWidget', (_, width: number, height: number) => {
    if (!mainWindow || !isWidgetMode) return
    mainWindow.setMinimumSize(width, height)
    mainWindow.setMaximumSize(width, height)
    mainWindow.setSize(width, height)
  })

  // -------- AI 配置 --------
  ipcMain.handle('ai:loadConfig', () => loadAIConfig())
  ipcMain.handle('ai:saveConfig', (_, config: Record<string, string>) => saveAIConfig(config))

  // -------- AI 请求代理（绕过 CORS） --------
  ipcMain.handle('ai:request', async (_, payload: { url: string; apiKey: string; body: string }) => {
    try {
      const resp = await net.fetch(payload.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${payload.apiKey}`,
        },
        body: payload.body,
      })

      const text = await resp.text()

      if (!resp.ok) {
        return { ok: false, status: resp.status, body: text }
      }
      return { ok: true, status: resp.status, body: text }
    } catch (e) {
      return { ok: false, status: 0, body: String(e) }
    }
  })
}

// ===================== 应用生命周期 =====================

app.whenReady().then(() => {
  app.setAppUserModelId('com.taskmanager.app')
  setupIPC()
  createMainWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

// 所有窗口关闭时：只有 forceQuit=true 才真正退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && forceQuit) {
    app.quit()
  }
})
