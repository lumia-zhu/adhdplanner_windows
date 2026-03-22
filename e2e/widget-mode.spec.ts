/**
 * E2E 测试：Widget 模式切换
 *
 * 验证 Widget 待命模式的进入和退出。
 */

import { test, expect } from './fixtures/launch'

test.describe('Widget 模式', () => {

  test('首次启动默认进入 Widget 待命模式', async ({ window }) => {
    // 首次启动时应自动进入 widget 待命模式
    // 检查展开按钮存在（widget 模式标志）
    const expandBtn = window.locator('button[title="展开主界面"]')
    await expect(expandBtn).toBeVisible({ timeout: 8000 })
  })

  test('点击展开按钮从 Widget 回到主界面', async ({ window }) => {
    const expandBtn = window.locator('button[title="展开主界面"]')
    await expect(expandBtn).toBeVisible({ timeout: 8000 })

    await expandBtn.click()
    await window.waitForTimeout(2000)

    // 主界面标志：输入框可见
    const input = window.locator('input[placeholder="输入第一个任务…"]')
    await expect(input).toBeVisible({ timeout: 5000 })

    // 展开按钮应该消失（已不在 widget 模式）
    await expect(expandBtn).not.toBeVisible()
  })

  test('主界面点击"收起为桌面小组件"进入 Widget 模式', async ({ window }) => {
    // 先展开到主界面
    const expandBtn = window.locator('button[title="展开主界面"]')
    await expect(expandBtn).toBeVisible({ timeout: 8000 })
    await expandBtn.click()
    await window.waitForTimeout(2000)

    // 找到并点击收起按钮
    const standbyBtn = window.locator('button[title="收起为桌面小组件"]')
    await expect(standbyBtn).toBeVisible({ timeout: 5000 })
    await standbyBtn.click()
    await window.waitForTimeout(2000)

    // 确认又回到 Widget 模式
    const expandBtnAgain = window.locator('button[title="展开主界面"]')
    await expect(expandBtnAgain).toBeVisible({ timeout: 5000 })
  })
})
