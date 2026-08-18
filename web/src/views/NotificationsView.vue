<script setup>
import { onMounted, ref } from 'vue'
import AppShell from '../components/AppShell.vue'
import { api } from '../api'
import { useAuthStore } from '../stores/auth'
import { toast } from '../toast'

const store = useAuthStore()
const items = ref([])
const typeIcon = { team: '🎮', challenge: '⚔️', tournament: '🏆', account: '👤', info: '📢' }

function fmtTime(t) {
  const d = new Date((t || 0) * 1000)
  const p = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

async function load() {
  try {
    const r = await api.notifications(50)
    items.value = r.notifications || []
    store.refreshUnread()
  } catch (e) { toast(e.message, 'err') }
}
onMounted(load)

async function markRead(n) {
  if (n.read) return
  try {
    await api.markNotificationsRead(n.id)
    n.read = 1
    store.refreshUnread()
  } catch (e) {}
}
async function markAll() {
  try {
    await api.markNotificationsRead(null)
    items.value.forEach(n => { n.read = 1 })
    store.refreshUnread()
  } catch (e) { toast(e.message, 'err') }
}
</script>

<template>
  <AppShell>
    <div class="card-title-row" style="margin-bottom:16px">
      <div>
        <h1 class="page-title" style="margin-bottom:0">通知</h1>
        <p class="page-desc" style="margin-bottom:0;margin-top:4px">入队申请、约战与活动相关消息</p>
      </div>
      <button class="btn sm" @click="markAll">全部已读</button>
    </div>

    <div v-if="items.length">
      <div v-for="n in items" :key="n.id" class="notif-item" :class="{ unread: !n.read }" @click="markRead(n)">
        <div class="t">{{ typeIcon[n.type] || '📢' }} {{ n.title }} <span v-if="!n.read" class="badge accent">未读</span></div>
        <div class="d">{{ n.content }}</div>
        <div class="time">{{ fmtTime(n.created_at) }}</div>
      </div>
    </div>
    <div v-else class="card"><div class="empty">暂无通知</div></div>
  </AppShell>
</template>
