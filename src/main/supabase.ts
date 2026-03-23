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

/** 从 JWT 中解析 user_id（不需要网络） */
function parseUserIdFromJWT(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    return payload.sub ?? null
  } catch { return null }
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
      // 认证错误（token 过期/无效）才清除，网络错误不清除
      if (!error.message?.includes('fetch') && !error.message?.includes('network')) {
        persistSession(null)
      }
      // 网络不可用时从本地 token 解析用户信息，离线继续使用
      const offlineId = parseUserIdFromJWT(saved.access_token)
      if (offlineId) {
        cachedUserId = offlineId
        console.log('[Auth] Offline mode, using cached user:', offlineId)
        return { id: offlineId, email: '' } as User
      }
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
    console.error('[Auth] Session restore error (network?):', e)
    // 网络异常时走离线模式，从 JWT 解析用户 ID
    const offlineId = parseUserIdFromJWT(saved.access_token)
    if (offlineId) {
      cachedUserId = offlineId
      console.log('[Auth] Offline fallback, using cached user:', offlineId)
      return { id: offlineId, email: '' } as User
    }
  }
  return null
}
