<script setup>
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const store = useAuthStore()
const route = useRoute()
const router = useRouter()

const navs = computed(() => {
  const items = [
    { name: 'home', label: '首页', icon: '🏠' },
    { name: 'teams', label: '战队', icon: '🎮' },
    { name: 'tournaments', label: '赛事', icon: '🏆' },
    { name: 'activities', label: '活动', icon: '📅' },
    { name: 'notifications', label: '通知', icon: '🔔' },
    { name: 'profile', label: '个人中心', icon: '👤' }
  ]
  if (store.isAdmin) items.push({ name: 'admin', label: '管理', icon: '⚙️' })
  return items
})

const roleName = computed(() =>
  store.guest ? '游客' : ({ admin: '管理员', captain: '队长', member: '成员' })[store.user?.role] || '成员'
)

// 通知未读数轮询
let timer = null
async function refreshUnread() {
  if (!store.guest) await store.refreshUnread()
}
onMounted(() => {
  refreshUnread()
  timer = setInterval(refreshUnread, 30000)
})
onUnmounted(() => clearInterval(timer))
watch(() => route.fullPath, refreshUnread)

async function logout() {
  await store.logout()
  router.push('/auth')
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo">🎯</div>
        <div>
          <div class="brand-name">HAU CS2</div>
          <div class="brand-sub">电竞社团管理系统</div>
        </div>
      </div>
      <nav class="nav">
        <RouterLink v-for="n in navs" :key="n.name" :to="{ name: n.name }" class="nav-item"
          :class="{ active: route.name === n.name }">
          <span class="ico">{{ n.icon }}</span>
          <span class="txt">{{ n.label }}</span>
          <span v-if="n.name === 'notifications' && store.unread > 0" class="nav-badge">{{ store.unread > 99 ? '99+' : store.unread }}</span>
        </RouterLink>
      </nav>
      <div class="side-foot">
        <div class="user-chip">
          <div class="ava">{{ store.guest ? '客' : (store.user?.nickname || '?').slice(0, 1).toUpperCase() }}</div>
          <div>
            <div class="nm">{{ store.guest ? '游客' : store.user?.nickname }}</div>
            <div class="rl">{{ roleName }}</div>
          </div>
        </div>
        <button class="btn ghost sm full" @click="logout">退出登录</button>
      </div>
    </aside>
    <main class="main">
      <slot />
    </main>
  </div>
</template>
