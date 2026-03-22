/**
 * E2E 测试：日期切换 + 搬迁流程
 *
 * 搬迁测试通过纯 UI 操作完成：先在昨天添加任务，再切回今天检测搬迁提示。
 */

import { test, expect, expandToMainView } from './fixtures/launch'

function getTodayLabel(): string {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function getYesterdayLabel(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

test.describe('日期切换', () => {

  test('点击左箭头切到昨天', async ({ window }) => {
    await expandToMainView(window)

    const todayLabel = getTodayLabel()
    await expect(window.getByText(todayLabel).first()).toBeVisible({ timeout: 8000 })

    await window.locator('button[title="前一天"]').click()
    await window.waitForTimeout(800)

    const yesterdayLabel = getYesterdayLabel()
    await expect(window.getByText(yesterdayLabel).first()).toBeVisible()
  })

  test('历史日期添加任务后切回今天，数据互不干扰', async ({ window }) => {
    await expandToMainView(window)

    const getInput = () =>
      window.locator('input[placeholder="输入第一个任务…"], input[placeholder="新任务…"]').last()

    // 今天加一个任务
    const i1 = getInput()
    await i1.waitFor({ state: 'visible', timeout: 8000 })
    await i1.click()
    await i1.fill('今天的任务')
    await i1.press('Enter')
    await window.waitForTimeout(500)

    // 切到昨天
    await window.locator('button[title="前一天"]').click()
    await window.waitForTimeout(1000)

    // 在昨天添加任务
    const i2 = getInput()
    await i2.click()
    await i2.fill('昨天的任务')
    await i2.press('Enter')
    await window.waitForTimeout(500)

    await expect(window.locator('input[value="昨天的任务"]')).toBeVisible()

    // 切回今天
    await window.locator('button[title="后一天"]').click()
    await window.waitForTimeout(1000)

    // 验证数据隔离
    await expect(window.locator('input[value="今天的任务"]')).toBeVisible()
    await expect(window.locator('input[value="昨天的任务"]')).toHaveCount(0)
  })
})

test.describe('搬迁流程', () => {

  test('昨天有未完成任务时，底部出现搬迁提示', async ({ window }) => {
    await expandToMainView(window)

    const getInput = () =>
      window.locator('input[placeholder="输入第一个任务…"], input[placeholder="新任务…"]').last()

    // 切到昨天，添加一个未完成的任务
    await window.locator('button[title="前一天"]').click()
    await window.waitForTimeout(1000)

    const i1 = getInput()
    await i1.waitFor({ state: 'visible', timeout: 8000 })
    await i1.click()
    await i1.fill('搬迁测试任务')
    await i1.press('Enter')
    await window.waitForTimeout(800)

    // 切回今天
    await window.locator('button[title="后一天"]').click()
    await window.waitForTimeout(1500)

    // 检查搬迁提示条是否出现
    const banner = window.getByText('未完成任务')
    await expect(banner.first()).toBeVisible({ timeout: 8000 })
  })

  test('点击搬到今天后任务出现在今天', async ({ window }) => {
    await expandToMainView(window)

    const getInput = () =>
      window.locator('input[placeholder="输入第一个任务…"], input[placeholder="新任务…"]').last()

    // 切到昨天添加任务
    await window.locator('button[title="前一天"]').click()
    await window.waitForTimeout(1000)

    const i1 = getInput()
    await i1.waitFor({ state: 'visible', timeout: 8000 })
    await i1.click()
    await i1.fill('需要搬迁的任务')
    await i1.press('Enter')
    await window.waitForTimeout(800)

    // 切回今天
    await window.locator('button[title="后一天"]').click()
    await window.waitForTimeout(1500)

    // 展开搬迁面板
    const banner = window.getByText('未完成任务')
    await expect(banner.first()).toBeVisible({ timeout: 8000 })
    await banner.first().click()
    await window.waitForTimeout(500)

    // 点击搬到今天
    const confirmBtn = window.locator('button:has-text("搬到今天")')
    await expect(confirmBtn).toBeVisible({ timeout: 5000 })
    await confirmBtn.click()
    await window.waitForTimeout(1500)

    // 验证任务出现在今天
    await expect(window.locator('input[value="需要搬迁的任务"]')).toBeVisible({ timeout: 5000 })
  })

  test('点击 ✕ 关闭搬迁提示', async ({ window }) => {
    await expandToMainView(window)

    const getInput = () =>
      window.locator('input[placeholder="输入第一个任务…"], input[placeholder="新任务…"]').last()

    // 切到昨天添加任务
    await window.locator('button[title="前一天"]').click()
    await window.waitForTimeout(1000)

    const i1 = getInput()
    await i1.waitFor({ state: 'visible', timeout: 8000 })
    await i1.click()
    await i1.fill('忽略搬迁测试')
    await i1.press('Enter')
    await window.waitForTimeout(800)

    // 切回今天
    await window.locator('button[title="后一天"]').click()
    await window.waitForTimeout(1500)

    // 等搬迁提示出现
    const banner = window.getByText('未完成任务')
    await expect(banner.first()).toBeVisible({ timeout: 8000 })

    // 点击 ✕
    const dismissBtn = window.locator('button[title="不需要，今天不再提示"]')
    await dismissBtn.click()
    await window.waitForTimeout(500)

    // 确认消失
    await expect(banner.first()).not.toBeVisible()
  })
})
