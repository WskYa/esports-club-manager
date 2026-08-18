<script setup>
import { onMounted, ref } from 'vue'
import AppShell from '../components/AppShell.vue'
import { api } from '../api'
import { useAuthStore } from '../stores/auth'
import { toast } from '../toast'

const store = useAuthStore()
const tab = ref('users')

// ---- 用户管理 ----
const users = ref([])
const userTotal = ref(0)
const page = ref(1)
const pageSize = 20
const search = ref('')
const loading = ref(false)

// ---- 审核 ----
const teams = ref([])
const challenges = ref([])
const registrations = ref([])
const joinReqs = ref([])
const reviewTab = ref('teams')

// ---- 白名单 ----
const wl = ref({ enabled: false, sids: [] })
const wlInput = ref('')

// ---- 公告 ----
const anns = ref([])
const annForm = ref({ title: '', content: '' })

// ---- 日志 ----
const logs = ref([])

const roleName = r => ({ admin: '管理员', captain: '队长', member: '成员' })[r] || r

function fmtTime(t) {
  const d = new Date((t || 0) * 1000)
  const p = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

async function loadUsers() {
  loading.value = true
  try {
    const r = await api.users(page.value, pageSize, search.value)
    users.value = r.users || []
    userTotal.value = r.total || 0
  } catch (e) { toast(e.message, 'err') } finally { loading.value = false }
}

async function loadReviews() {
  try {
    const [t, c] = await Promise.all([api.teams(), api.challenges()])
    teams.value = (t.teams || []).filter(x => x.status === 'pending')
    challenges.value = (c.challenges || []).filter(x => x.status === 'pending_admin')
  } catch (e) { toast(e.message, 'err') }
}

async function loadRegs() {
  try {
    const r = await api.adminRegistrations()
    registrations.value = (r.registrations || []).filter(x => x.status === 'pending')
  } catch (e) { toast(e.message, 'err') }
}

async function loadJoins() {
  try {
    const t = await api.teams()
    const reqs = []
    for (const team of (t.teams || [])) {
      try {
        const r = await api.teamJoinRequests(team.id)
        ;(r.requests || []).forEach(j => { reqs.push({ ...j, team_name: team.name }) })
      } catch (e) {}
    }
    joinReqs.value = reqs.filter(j => ['pending', 'pending_captain'].includes(j.status))
  } catch (e) { toast(e.message, 'err') }
}

async function loadWhitelist() {
  try { wl.value = await api.whitelist() } catch (e) { toast(e.message, 'err') }
}

async function loadAnns() {
  try {
    const r = await api.announcements()
    anns.value = (r.announcements || []).sort((a, b) => b.created_at - a.created_at)
  } catch (e) { toast(e.message, 'err') }
}

async function loadLogs() {
  try {
    const r = await api.activityLog(200)
    logs.value = r.logs || []
  } catch (e) { toast(e.message, 'err') }
}

function switchTab(t) {
  tab.value = t
  if (t === 'users') loadUsers()
  else if (t === 'reviews') { loadReviews(); loadRegs(); loadJoins() }
  else if (t === 'wl') loadWhitelist()
  else if (t === 'ann') loadAnns()
  else if (t === 'logs') loadLogs()
}
onMounted(switchTab)

// ---- 用户操作 ----
async function activate(u) {
  try { await api.activateUser(u.sid); toast('已激活'); loadUsers() } catch (e) { toast(e.message, 'err') }
}
async function setAdmin(u) {
  try { await api.setUserRole(u.sid, 'admin'); toast('已设为管理员'); loadUsers() } catch (e) { toast(e.message, 'err') }
}
async function markGrad(u) {
  if (!confirm(`确定将 ${u.nickname} 标记为已毕业？`)) return
  try { await api.setUserStatus(u.sid, '已毕业'); toast('已标记'); loadUsers() } catch (e) { toast(e.message, 'err') }
}
async function delUser(u) {
  if (!confirm(`确定删除用户 ${u.nickname}（${u.sid}）？此操作不可恢复，将级联清理其战队与报名`)) return
  try { await api.deleteUser(u.sid); toast('已删除'); loadUsers() } catch (e) { toast(e.message, 'err') }
}

// ---- 审核操作 ----
async function approveTeam(t) {
  try { await api.approveTeam(t.id); toast('已通过'); loadReviews() } catch (e) { toast(e.message, 'err') }
}
async function rejectTeam(t) {
  if (!confirm('确定拒绝该战队申请？')) return
  try { await api.rejectTeam(t.id); toast('已拒绝'); loadReviews() } catch (e) { toast(e.message, 'err') }
}
async function approveChallenge(c) {
  try { await api.approveChallenge(c.id); toast('已通过'); loadReviews() } catch (e) { toast(e.message, 'err') }
}
async function rejectChallenge(c) {
  try { await api.rejectChallengeAdmin(c.id); toast('已拒绝'); loadReviews() } catch (e) { toast(e.message, 'err') }
}
async function approveReg(r) {
  try { await api.approveReg(r.id); toast('已通过'); loadRegs() } catch (e) { toast(e.message, 'err') }
}
async function rejectReg(r) {
  try { await api.rejectReg(r.id); toast('已拒绝'); loadRegs() } catch (e) { toast(e.message, 'err') }
}
async function approveJoinAdmin(j) {
  try { await api.approveJoin(j.id); toast('已通过'); loadJoins() } catch (e) { toast(e.message, 'err') }
}
async function rejectJoinAdmin(j) {
  try { await api.rejectJoin(j.id); toast('已拒绝'); loadJoins() } catch (e) { toast(e.message, 'err') }
}

// ---- 白名单操作 ----
async function importWl() {
  const raw = wlInput.value.trim()
  const sids = [...new Set(raw.split(/[\s,，;；]+/).map(s => s.trim()).filter(s => /^\d{10,12}$/.test(s)))]
  if (!sids.length) { toast('未识别到有效学号', 'err'); return }
  try {
    const r = await api.importWhitelist(sids)
    toast(`已导入 ${r.count} 条`)
    wlInput.value = ''
    loadWhitelist()
  } catch (e) { toast(e.message, 'err') }
}
async function clearWl() {
  if (!confirm('确定清空白名单？')) return
  try { await api.clearWhitelist(); toast('已清空'); loadWhitelist() } catch (e) { toast(e.message, 'err') }
}
async function toggleWl() {
  try {
    const r = await api.toggleWhitelist()
    wl.value.enabled = r.enabled
    toast(r.enabled ? '白名单已启用' : '白名单已关闭')
  } catch (e) { toast(e.message, 'err') }
}

// ---- 公告操作 ----
async function createAnn() {
  if (!annForm.value.title.trim() || !annForm.value.content.trim()) { toast('标题和内容不能为空', 'err'); return }
  try {
    await api.createAnnouncement({ ...annForm.value })
    toast('已发布')
    annForm.value = { title: '', content: '' }
    loadAnns()
  } catch (e) { toast(e.message, 'err') }
}
async function delAnn(a) {
  if (!confirm('确定删除该公告？')) return
  try { await api.deleteAnnouncement(a.id); toast('已删除'); loadAnns() } catch (e) { toast(e.message, 'err') }
}
</script>

<template>
  <AppShell>
    <h1 class="page-title">管理后台</h1>
    <p class="page-desc">用户 · 审核 · 白名单 · 公告 · 日志</p>

    <div class="admin-tabs">
      <button :class="{ active: tab === 'users' }" @click="switchTab('users')">用户</button>
      <button :class="{ active: tab === 'reviews' }" @click="switchTab('reviews')">审核</button>
      <button :class="{ active: tab === 'wl' }" @click="switchTab('wl')">白名单</button>
      <button :class="{ active: tab === 'ann' }" @click="switchTab('ann')">公告</button>
      <button :class="{ active: tab === 'logs' }" @click="switchTab('logs')">日志</button>
    </div>

    <!-- 用户管理 -->
    <template v-if="tab === 'users'">
      <div class="card">
        <div class="search-bar">
          <input v-model="search" placeholder="搜索学号 / 姓名 / 昵称 / 学院..." @keyup.enter="page = 1; loadUsers()">
          <button class="btn" @click="page = 1; loadUsers()">搜索</button>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>学号</th><th>姓名</th><th>昵称</th><th>学院</th><th>身份</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="u in users" :key="u.sid">
                <td>{{ u.sid }}</td>
                <td>{{ u.real_name }}</td>
                <td>{{ u.nickname }}</td>
                <td>{{ u.college }}</td>
                <td>{{ roleName(u.role) }}</td>
                <td><span class="badge" :class="u.activated ? 'ok' : 'warn'">{{ u.activated ? '已激活' : '未激活' }}</span></td>
                <td>
                  <div class="ops">
                    <button v-if="!u.activated" class="btn sm" @click="activate(u)">激活</button>
                    <button v-if="u.sid !== store.user?.sid && u.role !== 'admin'" class="btn sm" @click="setAdmin(u)">设为管理员</button>
                    <button v-if="u.sid !== store.user?.sid && u.status !== '已毕业'" class="btn sm ghost" @click="markGrad(u)">标记毕业</button>
                    <button v-if="u.sid !== store.user?.sid" class="btn sm danger" @click="delUser(u)">删除</button>
                    <span v-else style="font-size:11px;color:var(--text-faint)">自己</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="loading" class="empty">加载中...</div>
        <div v-if="userTotal > pageSize" class="pager">
          <button class="btn sm" :disabled="page <= 1" @click="page--; loadUsers()">上一页</button>
          <span>{{ page }} / {{ Math.ceil(userTotal / pageSize) }}（共 {{ userTotal }} 人）</span>
          <button class="btn sm" :disabled="page >= Math.ceil(userTotal / pageSize)" @click="page++; loadUsers()">下一页</button>
        </div>
      </div>
    </template>

    <!-- 审核 -->
    <template v-if="tab === 'reviews'">
      <div class="admin-tabs">
        <button :class="{ active: reviewTab === 'teams' }" @click="reviewTab = 'teams'">战队 ({{ teams.length }})</button>
        <button :class="{ active: reviewTab === 'challenges' }" @click="reviewTab = 'challenges'">约战 ({{ challenges.length }})</button>
        <button :class="{ active: reviewTab === 'regs' }" @click="reviewTab = 'regs'">赛事报名 ({{ registrations.length }})</button>
        <button :class="{ active: reviewTab === 'joins' }" @click="reviewTab = 'joins'">入队申请 ({{ joinReqs.length }})</button>
      </div>

      <template v-if="reviewTab === 'teams'">
        <div v-if="teams.length">
          <div v-for="t in teams" :key="t.id" class="card team-card">
            <div class="team-head">
              <div class="team-logo"><img v-if="t.logo" :src="t.logo" alt=""><span v-else>{{ t.name.slice(0, 1) }}</span></div>
              <div class="team-meta">
                <div class="t-name">{{ t.name }}</div>
                <div style="font-size:11px;color:var(--text-faint)">队长: {{ t.captain_nickname || t.captain_sid }}</div>
              </div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn sm primary" @click="approveTeam(t)">通过</button>
              <button class="btn sm danger" @click="rejectTeam(t)">拒绝</button>
            </div>
          </div>
        </div>
        <div v-else class="card"><div class="empty">暂无待审核战队</div></div>
      </template>

      <template v-else-if="reviewTab === 'challenges'">
        <div v-if="challenges.length">
          <div v-for="c in challenges" :key="c.id" class="ch-row">
            <div class="info">
              <div class="t">{{ c.from_team_name }} vs {{ c.to_team_name }}</div>
              <div class="d">发起于 {{ fmtTime(c.created_at) }}</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn sm primary" @click="approveChallenge(c)">通过</button>
              <button class="btn sm danger" @click="rejectChallenge(c)">拒绝</button>
            </div>
          </div>
        </div>
        <div v-else class="card"><div class="empty">暂无待审核约战</div></div>
      </template>

      <template v-else-if="reviewTab === 'regs'">
        <div v-if="registrations.length">
          <div v-for="r in registrations" :key="r.id" class="ch-row">
            <div class="info">
              <div class="t">{{ r.team_name }}</div>
              <div class="d">{{ r.tournament_name }}</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn sm primary" @click="approveReg(r)">通过</button>
              <button class="btn sm danger" @click="rejectReg(r)">拒绝</button>
            </div>
          </div>
        </div>
        <div v-else class="card"><div class="empty">暂无待审核报名</div></div>
      </template>

      <template v-else>
        <div v-if="joinReqs.length">
          <div v-for="j in joinReqs" :key="j.id" class="ch-row">
            <div class="info">
              <div class="t">{{ j.user_nickname || j.sid }}</div>
              <div class="d">→ {{ j.team_name }}</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn sm primary" @click="approveJoinAdmin(j)">通过</button>
              <button class="btn sm danger" @click="rejectJoinAdmin(j)">拒绝</button>
            </div>
          </div>
        </div>
        <div v-else class="card"><div class="empty">暂无入队申请</div></div>
      </template>
    </template>

    <!-- 白名单 -->
    <template v-if="tab === 'wl'">
      <div class="card">
        <h3>注册白名单</h3>
        <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px">启用后，仅白名单内的学号可注册。当前共 {{ wl.sids.length }} 条，状态：{{ wl.enabled ? '已启用' : '未启用' }}</p>
        <textarea v-model="wlInput" placeholder="学号，每行一个" style="width:100%;min-height:80px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border);color:var(--text);font-size:13px;outline:none;padding:10px;resize:vertical;font-family:inherit"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
          <button class="btn sm" @click="importWl">导入</button>
          <button class="btn sm ghost" @click="clearWl">清空</button>
          <button class="btn sm" :class="wl.enabled ? 'danger' : 'primary'" @click="toggleWl">{{ wl.enabled ? '关闭白名单' : '启用白名单' }}</button>
        </div>
      </div>
    </template>

    <!-- 公告 -->
    <template v-if="tab === 'ann'">
      <div class="card">
        <h3>发布公告</h3>
        <div class="field"><span>标题</span><input v-model="annForm.title" maxlength="30"></div>
        <div class="field"><span>内容</span><textarea v-model="annForm.content" maxlength="300"></textarea></div>
        <button class="btn primary" @click="createAnn">发布</button>
      </div>
      <div v-for="a in anns" :key="a.id" class="card">
        <div class="card-title-row">
          <div><span style="font-weight:600;font-size:13.5px">{{ a.title }}</span><span style="font-size:11px;color:var(--text-faint);margin-left:10px">{{ fmtTime(a.created_at) }}</span></div>
          <button class="btn sm danger" @click="delAnn(a)">删除</button>
        </div>
        <div style="font-size:12.5px;color:var(--text-dim)">{{ a.content }}</div>
      </div>
    </template>

    <!-- 日志 -->
    <template v-if="tab === 'logs'">
      <div class="card">
        <h3>操作日志（最近 200 条）</h3>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>时间</th><th>用户</th><th>操作</th><th>对象</th><th>详情</th></tr></thead>
            <tbody>
              <tr v-for="l in logs" :key="l._id">
                <td style="white-space:nowrap">{{ fmtTime(l.created_at) }}</td>
                <td>{{ l.nickname }}</td>
                <td>{{ l.action }}</td>
                <td>{{ l.target }}</td>
                <td>{{ l.detail }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!logs.length" class="empty">暂无日志</div>
      </div>
    </template>
  </AppShell>
</template>
