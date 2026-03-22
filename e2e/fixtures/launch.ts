/**
 * Electron 启动 fixture —— 为每个测试提供隔离的 Electron 实例。
 */

import { test as base, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import os from 'os'

interface ElectronFixtures {
  electronApp: ElectronApplication
  window: Page
  tmpDir: string
}

export const test = base.extend<ElectronFixtures>({
  tmpDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
    await use(dir)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  },

  electronApp: async ({ tmpDir }, use) => {
    const app = await electron.launch({
      args: [path.join(__dirname, '../../out/main/index.js')],
      env: {
        ...process.env,
        TEST_USER_DATA_DIR: tmpDir,
      },
      timeout: 20_000,
    })

    await use(app)

    try {
      await Promise.race([
        app.close(),
        new Promise<void>(r => setTimeout(r, 8000)),
      ])
    } catch {}
  },

  window: async ({ electronApp }, use) => {
    const win = await electronApp.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.waitForTimeout(3000)
    await use(win)
  },
})

/**
 * 首次启动时应用会自动进入 Widget 待命模式，
 * 调用此函数点击展开按钮回到主界面。
 */
export async function expandToMainView(window: Page) {
  const expandBtn = window.locator('button[title="展开主界面"]')
  if (await expandBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await expandBtn.click()
    await window.waitForTimeout(2500)
  }
}

export { expect } from '@playwright/test'
