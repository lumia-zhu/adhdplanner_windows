/**
 * E2E 测试：任务增删改查 + 数据持久化
 */

import { test, expect, expandToMainView } from './fixtures/launch'

test.describe('任务 CRUD', () => {

  test('创建任务：输入文字后按 Enter', async ({ window }) => {
    await expandToMainView(window)

    const input = window.locator('input[placeholder="输入第一个任务…"]')
    await input.waitFor({ state: 'visible', timeout: 8000 })
    await input.click()
    await input.fill('测试任务一')
    await input.press('Enter')
    await window.waitForTimeout(500)

    await expect(window.locator('input[value="测试任务一"]')).toBeVisible()
  })

  test('创建多个任务', async ({ window }) => {
    await expandToMainView(window)

    const getInput = () =>
      window.locator('input[placeholder="输入第一个任务…"], input[placeholder="新任务…"]').last()

    const i1 = getInput()
    await i1.waitFor({ state: 'visible', timeout: 8000 })
    await i1.click()
    await i1.fill('任务 Alpha')
    await i1.press('Enter')
    await window.waitForTimeout(400)

    const i2 = getInput()
    await i2.click()
    await i2.fill('任务 Beta')
    await i2.press('Enter')
    await window.waitForTimeout(400)

    await expect(window.locator('input[value="任务 Alpha"]')).toBeVisible()
    await expect(window.locator('input[value="任务 Beta"]')).toBeVisible()
  })

  test('创建子任务：按 Tab 缩进', async ({ window }) => {
    await expandToMainView(window)

    const getInput = () =>
      window.locator('input[placeholder="输入第一个任务…"], input[placeholder="新任务…"]').last()

    const i1 = getInput()
    await i1.waitFor({ state: 'visible', timeout: 8000 })
    await i1.click()
    await i1.fill('父任务')
    await i1.press('Enter')
    await window.waitForTimeout(400)

    const i2 = getInput()
    await i2.click()
    await i2.press('Tab')
    await window.waitForTimeout(300)

    const subInput = window.locator('input[placeholder="子任务…"]').last()
    await subInput.fill('子任务一')
    await subInput.press('Enter')
    await window.waitForTimeout(400)

    await expect(window.locator('input[value="子任务一"]')).toBeVisible()
  })

  test('删除空任务：Backspace 删除空行', async ({ window }) => {
    await expandToMainView(window)

    const getInput = () =>
      window.locator('input[placeholder="输入第一个任务…"], input[placeholder="新任务…"]').last()

    const i1 = getInput()
    await i1.waitFor({ state: 'visible', timeout: 8000 })
    await i1.click()
    await i1.fill('保留的任务')
    await i1.press('Enter')
    await window.waitForTimeout(400)

    const i2 = getInput()
    await i2.click()
    await i2.fill('要删的任务')
    await i2.press('Enter')
    await window.waitForTimeout(400)

    const taskInput = window.locator('input[value="要删的任务"]')
    await taskInput.click()
    await taskInput.fill('')
    await taskInput.press('Backspace')
    await window.waitForTimeout(500)

    await expect(window.locator('input[value="要删的任务"]')).toHaveCount(0)
    await expect(window.locator('input[value="保留的任务"]')).toBeVisible()
  })
})
