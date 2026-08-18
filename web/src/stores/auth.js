// 全局状态：认证 + 用户
import { defineStore } from 'pinia'
import { auth } from '../cloudbase'
import { api } from '../api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,        // users 集合 profile（含 role/activated）
    guest: false,      // 匿名游客
    ready: false,      // 初始会话检查完成
    unread: 0
  }),
  getters: {
    isAdmin: (s) => !s.guest && s.user && s.user.role === 'admin',
    isLoggedIn: (s) => !s.guest && !!s.user
  },
  actions: {
    // 启动时恢复会话；无会话时静默建立匿名会话（未登录态调用云函数需要）
    async init() {
      try {
        const { data } = await auth.getSession()
        if (data && data.session) {
          const r = await api.me()
          this.user = r.user
          this.guest = !!r.guest
          if (r.guest) this.user = null
        } else {
          // 无会话：匿名登录占位（游客浏览 / 登录前调用云函数都需要）
          await auth.signInAnonymously().catch(() => {})
        }
      } catch (e) { /* 未登录 */ }
      this.ready = true
    },
    // 登录（学号 + 密码）：
    // 注册用户 → 云函数校验哈希并签发自定义登录 ticket
    // 平台预置用户 → 平台 username/password 登录
    async login(sid, password) {
      let r
      try {
        r = await api.loginVerify(sid, password)
      } catch (e) {
        throw new Error(e.message)
      }
      if (r.method === 'custom') {
        auth.setCustomSignFunc(async () => r.ticket)
        const { data, error } = await auth.signInWithCustomTicket()
        if (error || !data) throw new Error('登录失败，请重试')
      } else {
        const { data, error } = await auth.signInWithPassword({ username: sid, password })
        if (error) throw new Error('学号或密码错误')
      }
      const me = await api.me()
      if (me.guest || !me.user) throw new Error('账号不存在，请先注册')
      this.user = me.user
      this.guest = false
      // 未激活：提示并登出
      if (!me.user.activated) {
        await this.logout()
        throw new Error('账号未激活，请等待管理员激活')
      }
      await this.refreshUnread()
      return me.user
    },
    // 注册：云函数校验+哈希存储+签发 ticket → ticket 登录（平台自动建用户）→ 登出等待激活
    async register(form) {
      const r = await api.register({
        sid: form.sid, realName: form.realName, college: form.college,
        nickname: form.nickname, qq: form.qq, password: form.password
      })
      auth.setCustomSignFunc(async () => r.ticket)
      const { error } = await auth.signInWithCustomTicket()
      if (!error) await this.logout() // 注册后等待管理员激活，清除临时会话
    },
    // 游客模式
    async guestLogin() {
      const { data, error } = await auth.signInAnonymously()
      if (error) throw new Error('游客模式不可用')
      const r = await api.me()
      this.guest = true
      this.user = null
    },
    async logout() {
      await auth.signOut().catch(() => {})
      this.user = null
      this.guest = false
      this.unread = 0
    },
    async refreshUnread() {
      if (this.guest) { this.unread = 0; return }
      try {
        const r = await api.unreadCount()
        this.unread = r.unread || 0
      } catch (e) { this.unread = 0 }
    },
    // 修改密码：注册用户走云函数（scrypt）；平台预置用户走平台 API
    async changePassword(oldPw, newPw) {
      if (this.user?.is_platform) {
        const { data, error } = await auth.resetPasswordForOld({ old_password: oldPw, new_password: newPw })
        if (error) throw new Error(error.message || '修改失败')
        return data
      }
      await api.changePassword(oldPw, newPw)
    }
  }
})
