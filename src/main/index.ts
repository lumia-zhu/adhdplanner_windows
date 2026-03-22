import { app, BrowserWindow, ipcMain, net, powerMonitor, screen } from 'electron'
import fs from 'fs'
import { S } from './state'
import {
  getSupabase, getCurrentUserId, setCachedUserId,
  persistSession, restoreSession,
} from './supabase'
import { markDirty, startSync, stopSync, flushSync } from './sync'
import {
  migrateTasksIfNeeded,
  loadAIConfig, saveAIConfig,
  loadTasks, saveTasks,
  findCarryOverTasks, findAllCarryOverTasks, executeCarryOver, executeMultiCarryOver,
  loadProfile, saveProfile,
  loadActivityData, activitySampler,
  appendTrackerEvents, loadTrackerEvents,
  safeWriteJSON, getReflectionChatPath,
  getTodayStr,
  setUserDataDir, migrateRootDataToUser,
} from './storage'
import {
  MAIN_WIDTH, MAIN_HEIGHT,
  computeUIScale, scaled,
  safeWinOp,
  createMainWindow, createTray, updateTrayMenu,
  enterWidget, exitWidget,
  startWidgetHeartbeat, stopWidgetHeartbeat,
  validateWidgetBounds, refreshDragRegion,
  startReflectionTimer,
} from './window'

// ===================== 全局异常兜底（防止闪退） =====================

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason)
})

// ===================== E2E 测试：自定义数据目录 =====================

if (process.env.TEST_USER_DATA_DIR) {
  app.setPath('userData', process.env.TEST_USER_DATA_DIR)
}

// ===================== Chromium flags =====================

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

// ===================== Single Instance Lock =====================

const isTestMode = !!process.env.TEST_USER_DATA_DIR
const gotTheLock = isTestMode || app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

// ===================== IPC 通信 =====================

function setupIPC(): void {
  // -------- 认证（用户名模式：内部转成合成邮箱） --------
  const toEmail = (username: string): string => `${username.toLowerCase()}@app.local`

  ipcMain.handle('auth:signUp', async (_, username: string, password: string) => {
    try {
      const email = toEmail(username)
      const { data, error } = await getSupabase().auth.signUp({ email, password })
      if (error) return { ok: false, error: error.message }
      if (data.user) {
        setCachedUserId(data.user.id)
        setUserDataDir(data.user.id)
        if (data.session) {
          persistSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          })
        }
        return { ok: true, user: { id: data.user.id, email: username } }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('auth:signIn', async (_, username: string, password: string) => {
    try {
      const email = toEmail(username)
      const { data, error } = await getSupabase().auth.signInWithPassword({ email, password })
      if (error) return { ok: false, error: error.message }
      if (data.user && data.session) {
        setCachedUserId(data.user.id)
        setUserDataDir(data.user.id)
        migrateRootDataToUser(data.user.id)
        persistSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        })
      }
      return { ok: true, user: { id: data.user?.id, email: username } }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('auth:signOut', async () => {
    await getSupabase().auth.signOut()
    setCachedUserId(null)
    setUserDataDir(null)
    persistSession(null)
  })

  ipcMain.handle('auth:getUser', async () => {
    const userId = getCurrentUserId()
    if (!userId) return { user: null }
    const { data } = await getSupabase().auth.getUser()
    if (!data.user) return { user: null }
    const displayName = (data.user.email ?? '').replace(/@app\.local$/, '')
    return { user: { id: data.user.id, email: displayName } }
  })

  // -------- 任务数据 --------
  ipcMain.handle('tasks:load', (_, date?: string) => loadTasks(date || getTodayStr()))
  ipcMain.handle('tasks:save', (_, date: string, tasks: unknown[]) => saveTasks(date, tasks))
  ipcMain.handle('tasks:findCarryOver', (_, today?: string) =>
    findCarryOverTasks(today || getTodayStr()))
  ipcMain.handle('tasks:findAllCarryOver', (_, today?: string) =>
    findAllCarryOverTasks(today || getTodayStr()))
  ipcMain.handle('tasks:carryOver', (_, fromDate: string, taskIds: string[], today?: string) =>
    executeCarryOver(fromDate, taskIds, today || getTodayStr()))
  ipcMain.handle('tasks:multiCarryOver', (_, dateTaskMap: Record<string, string[]>, today?: string) =>
    executeMultiCarryOver(dateTaskMap, today || getTodayStr()))

  // -------- 托盘同步 --------
  ipcMain.on('tray:updateCount', (_, count: number) => {
    S.pendingCount = count
    updateTrayMenu()
  })

  // -------- 窗口模式查询 --------
  ipcMain.handle('window:getMode', () => {
    const isFirstInit = !S.rendererReady
    S.rendererReady = true
    return { isWidgetMode: S.isWidgetMode, isFirstInit }
  })

  // -------- 窗口控制 --------
  ipcMain.on('window:minimize', () => S.mainWindow?.minimize())
  ipcMain.on('window:hide',     () => { S.mainWindow?.hide(); updateTrayMenu() })
  ipcMain.on('window:quit',     () => { S.forceQuit = true; app.quit() })
  ipcMain.on('window:enterWidget', () => { enterWidget(); updateTrayMenu() })
  ipcMain.on('window:exitWidget',  () => { exitWidget();  updateTrayMenu() })

  // -------- 小组件动态 resize --------
  ipcMain.on('window:resizeWidget', (_, width: number, height: number) => {
    if (!S.mainWindow || S.mainWindow.isDestroyed() || !S.isWidgetMode) return
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return

    const sw = scaled(width)
    const sh = scaled(height)

    safeWinOp('resizeWidget', (win) => {
      win.setMinimumSize(1, 1)
      win.setMaximumSize(9999, 9999)
      win.setSize(sw, sh)
      win.setMinimumSize(sw, sh)
      win.setMaximumSize(sw, sh)
      win.setAlwaysOnTop(true, 'floating')
    })

    setTimeout(() => {
      if (S.mainWindow && !S.mainWindow.isDestroyed()) {
        S.mainWindow.webContents.send('widget:refreshDrag')
      }
    }, 80)

    setTimeout(() => {
      safeWinOp('resizeWidget:verify', (win) => {
        if (S.isWidgetMode) {
          let needRefresh = false
          if (!win.isVisible()) {
            console.log('[resizeWidget] Window not visible, restoring')
            win.show()
            needRefresh = true
          }
          if (win.isMinimized()) {
            win.restore()
            needRefresh = true
          }
          if (needRefresh) refreshDragRegion()
        }
      })
    }, 200)
  })

  // -------- 主窗口动态 resize --------
  ipcMain.on('window:resizeMain', (_, width: number, height: number) => {
    if (!S.mainWindow || S.mainWindow.isDestroyed() || S.isWidgetMode) return
    if (!Number.isFinite(width) || width < 1) return
    safeWinOp('resizeMain', (win) => {
      const [, curH] = win.getSize()
      const sw = scaled(width)
      const sh = height && Number.isFinite(height) ? scaled(height) : curH
      win.setMinimumSize(Math.min(sw, scaled(MAIN_WIDTH)), scaled(MAIN_HEIGHT))
      win.setSize(sw, sh)
    })
  })

  // -------- 用户资料 --------
  ipcMain.handle('profile:load', () => loadProfile())
  ipcMain.handle('profile:save', (_, profile: Record<string, unknown>) => {
    const result = saveProfile(profile)
    startReflectionTimer()
    return result
  })

  // -------- AI 配置 --------
  ipcMain.handle('ai:loadConfig', () => loadAIConfig())
  ipcMain.handle('ai:saveConfig', (_, config: Record<string, string>) => saveAIConfig(config))

  // -------- AI 请求代理（30 秒超时） --------
  ipcMain.handle('ai:request', async (_, payload: { url: string; apiKey: string; body: string }) => {
    const AI_TIMEOUT_MS = 30_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
    try {
      const resp = await net.fetch(payload.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${payload.apiKey}`,
        },
        body: payload.body,
        signal: controller.signal as AbortSignal,
      })
      const text = await resp.text()
      if (!resp.ok) return { ok: false, status: resp.status, body: text }
      return { ok: true, status: resp.status, body: text }
    } catch (e: unknown) {
      const isTimeout = e instanceof Error && e.name === 'AbortError'
      return {
        ok: false,
        status: 0,
        body: isTimeout ? 'AI 请求超时（30 秒无响应）' : String(e),
      }
    } finally {
      clearTimeout(timer)
    }
  })

  // -------- 行为追踪 --------
  ipcMain.handle('tracker:append', (_, date: string, events: unknown[]) =>
    appendTrackerEvents(date, events))
  ipcMain.handle('tracker:load', (_, date: string) =>
    loadTrackerEvents(date))

  // -------- 反思记录 --------
  ipcMain.handle('reflection:save', (_, key: string, data: unknown) => {
    try {
      safeWriteJSON(getReflectionChatPath(key), data)
      markDirty('reflection', key)
      return true
    } catch (e) { console.error('[reflection:save]', e); return false }
  })
  ipcMain.handle('reflection:load', (_, key: string) => {
    try {
      const p = getReflectionChatPath(key)
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
    } catch (e) { console.error('[reflection:load]', e) }
    return null
  })

  // -------- 活跃度数据 --------
  ipcMain.handle('activity:load', (_, date: string) => {
    activitySampler.flush()
    return loadActivityData(date)
  })
}

// ===================== 应用生命周期 =====================

app.on('second-instance', () => {
  safeWinOp('second-instance', (win) => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
})

app.whenReady().then(async () => {
  app.setAppUserModelId('com.taskmanager.app')

  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true })
  }

  // 尝试恢复登录态，并切换到对应用户的数据目录
  const restored = await restoreSession()
  if (restored) {
    setUserDataDir(restored.id)
    console.log('[Auth] Auto-login restored for:', restored.email)
  }

  migrateTasksIfNeeded()

  S.uiScale = computeUIScale()
  console.log(`[UIScale] workArea=${screen.getPrimaryDisplay().workAreaSize.width}, uiScale=${S.uiScale}`)

  setupIPC()
  createMainWindow()
  createTray()
  startReflectionTimer()
  activitySampler.start()
  startSync()

  // 显示器变化时重新校验 widget 位置
  screen.on('display-removed', () => {
    console.log('[Display] Display removed, validating widget bounds')
    validateWidgetBounds()
  })
  screen.on('display-metrics-changed', () => {
    console.log('[Display] Display metrics changed, validating widget bounds')
    validateWidgetBounds()
  })

  // 系统唤醒后重新同步窗口状态
  powerMonitor.on('resume', () => {
    if (!S.mainWindow) return
    safeWinOp('resume', (win) => {
      if (S.isWidgetMode) {
        win.setAlwaysOnTop(true, 'floating')
        if (win.isMinimized()) win.restore()
        win.show()
        refreshDragRegion()
        startWidgetHeartbeat()
      }
      win.webContents.setZoomFactor(S.uiScale)
      win.webContents.send('window:modeSync', { isWidgetMode: S.isWidgetMode })
    })
    validateWidgetBounds()
  })

  // 锁屏解锁后也同步一次
  powerMonitor.on('unlock-screen', () => {
    if (!S.mainWindow) return
    safeWinOp('unlock-screen', (win) => {
      if (S.isWidgetMode) {
        win.setAlwaysOnTop(true, 'floating')
        if (win.isMinimized()) win.restore()
        win.show()
        refreshDragRegion()
        startWidgetHeartbeat()
      }
      win.webContents.setZoomFactor(S.uiScale)
      setTimeout(() => {
        if (S.mainWindow && !S.mainWindow.isDestroyed()) {
          S.mainWindow.webContents.invalidate()
          S.mainWindow.webContents.send('window:modeSync', { isWidgetMode: S.isWidgetMode })
        }
      }, 200)
    })
    validateWidgetBounds()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
  stopWidgetHeartbeat()
  activitySampler.stop()
  stopSync()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && S.forceQuit) {
    app.quit()
  }
})
