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
    // 后台自动刷新 token 时同步写入本地文件，防止 refresh token rotation 导致旧 token 失效
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) {
        persistSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        })
        console.log('[Auth] Token refreshed and persisted')
      }
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

function isNetworkError(err: { message?: string } | null | undefined): boolean {
  if (!err?.message) return false
  const msg = err.message.toLowerCase()
  return msg.includes('fetch') || msg.includes('network') || msg.includes('enotfound') || msg.includes('timeout')
}

/** 离线回退：从 JWT 解析用户 ID，保留本地使用能力 */
function offlineFallback(accessToken: string): User | null {
  const offlineId = parseUserIdFromJWT(accessToken)
  if (offlineId) {
    cachedUserId = offlineId
    console.log('[Auth] Offline fallback, using cached user:', offlineId)
    return { id: offlineId, email: '' } as User
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

    if (!error && data.session && data.user) {
      cachedUserId = data.user.id
      persistSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      })
      console.log('[Auth] Session restored for:', data.user.email)
      return data.user
    }

    if (error) {
      console.error('[Auth] setSession failed:', error.message)

      // setSession 失败后用 refresh_token 再试一次（access_token 过期但 refresh_token 仍有效的情况）
      try {
        const { data: refreshed, error: refreshErr } = await getSupabase()
          .auth.refreshSession({ refresh_token: saved.refresh_token })

        if (!refreshErr && refreshed.session && refreshed.user) {
          cachedUserId = refreshed.user.id
          persistSession({
            access_token: refreshed.session.access_token,
            refresh_token: refreshed.session.refresh_token,
          })
          console.log('[Auth] Session recovered via refreshSession for:', refreshed.user.email)
          return refreshed.user
        }

        // 两次都失败：非网络错误才清除本地 token
        if (!isNetworkError(error) && !isNetworkError(refreshErr)) {
          console.log('[Auth] Both setSession and refreshSession failed, clearing token')
          persistSession(null)
        }
      } catch {
        if (!isNetworkError(error)) {
          persistSession(null)
        }
      }

      return offlineFallback(saved.access_token)
    }
  } catch (e) {
    console.error('[Auth] Session restore error (network?):', e)
    return offlineFallback(saved.access_token)
  }
  return null
}
