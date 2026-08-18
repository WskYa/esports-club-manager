<script setup>
import { onMounted, ref } from 'vue'
import AppShell from '../components/AppShell.vue'
import Modal from '../components/Modal.vue'
import { api } from '../api'
import { useAuthStore } from '../stores/auth'
import { toast } from '../toast'

const store = useAuthStore()
const acts = ref([])
const modal = ref(null)
const form = ref({ title: '', location: '', time: '', capacity: 0, status: '报名中', content: '' })

async function load() {
  try {
    const r = await api.activities()
    acts.value = r.activities || []
  } catch (e) { toast(e.message, 'err') }
}
onMounted(load)

async function join(a) {
  try { await api.joinActivity(a.id); toast('报名成功'); load() } catch (e) { toast(e.message, 'err') }
}
async function leave(a) {
  try { await api.leaveActivity(a.id); toast('已取消报名'); load() } catch (e) { toast(e.message, 'err') }
}
async function remove(a) {
  if (!confirm('确定删除该活动？报名记录将一并清除')) return
  try { await api.deleteActivity(a.id); toast('已删除'); load() } catch (e) { toast(e.message, 'err') }
}
async function create() {
  if (!form.value.title.trim()) { toast('请输入活动标题', 'err'); return }
  try {
    await api.createActivity({ ...form.value })
    toast('活动已发布')
    form.value = { title: '', location: '', time: '', capacity: 0, status: '报名中', content: '' }
    load()
  } catch (e) { toast(e.message, 'err') }
}
async function viewParticipants(a) {
  try {
    const r = await api.activityParticipants(a.id)
    modal.value = { type: 'participants', activity: a, list: r.participants || [] }
  } catch (e) { toast(e.message, 'err') }
}
</script>

<template>
  <AppShell>
    <h1 class="page-title">活动</h1>
    <p class="page-desc">社团训练与活动报名</p>

    <div v-if="store.isAdmin" class="card">
      <h3>发布活动</h3>
      <div class="grid2" style="margin-bottom:0">
        <div class="field"><span>标题</span><input v-model="form.title" maxlength="30"></div>
        <div class="field"><span>地点</span><input v-model="form.location" maxlength="30"></div>
        <div class="field"><span>时间</span><input v-model="form.time" type="datetime-local"></div>
        <div class="field"><span>名额（0=不限）</span><input v-model.number="form.capacity" type="number" min="0"></div>
        <div class="field"><span>状态</span>
          <select v-model="form.status"><option>报名中</option><option>进行中</option><option>已结束</option></select>
        </div>
        <div class="field" style="grid-column:1/-1"><span>内容</span><textarea v-model="form.content" maxlength="300"></textarea></div>
        <div><button class="btn primary" @click="create">发布活动</button></div>
      </div>
    </div>

    <div v-if="acts.length">
      <div v-for="a in acts" :key="a.id" class="card">
        <div class="card-title-row">
          <div>
            <h3 style="margin-bottom:2px">{{ a.title }}</h3>
            <div style="font-size:12px;color:var(--text-dim)">
              <template v-if="a.location">📍 {{ a.location }}</template>
              <template v-if="a.location && a.time"> · </template>
              <template v-if="a.time">🕐 {{ a.time }}</template>
            </div>
          </div>
          <span class="badge" :class="a.status === '报名中' ? 'ok' : 'muted'">{{ a.status }}</span>
        </div>
        <div v-if="a.content" style="font-size:13px;color:var(--text-dim);margin-bottom:10px">{{ a.content }}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <template v-if="store.guest"><span class="badge muted">游客不可报名</span></template>
          <template v-else-if="a.status !== '报名中'"><span class="badge muted">{{ a.status }}</span></template>
          <template v-else-if="a.joined"><button class="btn sm danger" @click="leave(a)">取消报名</button></template>
          <template v-else-if="a.capacity > 0 && a.count >= a.capacity"><span class="badge warn">名额已满</span></template>
          <template v-else><button class="btn primary sm" @click="join(a)">报名</button></template>
          <span class="badge" :class="a.capacity > 0 && a.count >= a.capacity ? 'warn' : 'muted'">{{ a.capacity > 0 ? a.count + '/' + a.capacity + ' 人' : a.count + ' 人' }}</span>
          <template v-if="store.isAdmin">
            <button class="btn sm" @click="viewParticipants(a)">名单</button>
            <button class="btn sm danger" @click="remove(a)">删除</button>
          </template>
        </div>
      </div>
    </div>
    <div v-else class="card"><div class="empty">暂无活动，等管理员发布吧</div></div>

    <Modal :show="modal?.type === 'participants'" @close="modal = null">
      <h3>报名名单 · {{ modal?.activity?.title }}（{{ modal?.list?.length }} 人）</h3>
      <div v-if="modal?.list?.length">
        <div v-for="p in modal.list" :key="p.sid" class="mem-row">
          <span class="nick">{{ p.nickname || p.sid }}</span>
          <span style="font-size:11px;color:var(--text-faint)">{{ p.college || '' }}</span>
        </div>
      </div>
      <div v-else class="empty">暂无报名</div>
      <div class="modal-foot"><button class="btn ghost" @click="modal = null">关闭</button></div>
    </Modal>
  </AppShell>
</template>
