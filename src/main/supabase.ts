/**
 * Supabase 客户端初始化模块
 *
 * 主进程中统一管理 Supabase 连接和认证状态。
 * 渲染进程通过 IPC 间接使用。
 */

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { app } from 'electron'
import fs from 'fs'
import { join } from 'path'

const SUPABASE_URL = 'https://xpqumculcviwzdybdjoc.supabase.co'
const SUPABASE_KEY = 'sb_publishable_sW6LstpCjs53wLzo3F25YQ_cTo3LC52'

const getTokenPath = (): string => join(app.getPath('userData'), 'auth-token.json')

let supabase: SupabaseClient

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
      },
    })
  }
  return supabase
}

let cachedUserId: string | null = null

/** 获取当前登录的用户 ID，未登录返回 null */
export function getCurrentUserId(): string | null {
  return cachedUserId
}

export function setCachedUserId(id: string | null): void {
  cachedUserId = id
}

/** 保存 session token 到本地，用于应用重启后自动恢复登录 */
export function persistSession(session: { access_token: string; refresh_token: string } | null): void {
  const tokenPath = getTokenPath()
  try {
    if (session) {
      fs.writeFileSync(tokenPath, JSON.stringify(session), 'utf-8')
    } else {
      if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath)
    }
  } catch (e) {
    console.error('[Auth] Failed to persist session:', e)
  }
}

/** 从本地读取已保存的 session token */
export function loadPersistedSession(): { access_token: string; refresh_token: string } | null {
  try {
    const tokenPath = getTokenPath()
    if (fs.existsSync(tokenPath)) {
      return JSON.parse(fs.readFileSync(tokenPath, 'utf-8'))
    }
  } catch (e) {
    console.error('[Auth] Failed to load persisted session:', e)
  }
  return null
}

/** 应用启动时尝试恢复登录态 */
export async function restoreSession(): Promise<User | null> {
  const saved = loadPersistedSession()
  if (!saved) return null

  try {
    const { data, error } = await getSupabase().auth.setSession({
      access_token: saved.access_token,
      refresh_token: saved.refresh_token,
    })
    if (error) {
      console.error('[Auth] Session restore failed:', error.message)
      persistSession(null)
      return null
    }
    if (data.session && data.user) {
      cachedUserId = data.user.id
      persistSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      })
      console.log('[Auth] Session restored for:', data.user.email)
      return data.user
    }
  } catch (e) {
    console.error('[Auth] Session restore error:', e)
  }
  return null
}
