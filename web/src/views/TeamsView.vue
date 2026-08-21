<script setup>
import { onMounted, ref, computed } from 'vue'
import AppShell from '../components/AppShell.vue'
import Modal from '../components/Modal.vue'
import { api } from '../api'
import { useAuthStore } from '../stores/auth'
import { toast } from '../toast'
import { checkImage, fileToDataUrl } from '../utils'

const store = useAuthStore()
const teams = ref([])
const loading = ref(false)

// 弹窗状态
const modal = ref(null) // { type: 'create'|'edit'|'view'|'join', team }
const inviteCode = ref('')
const editForm = ref({ name: '', shortName: '' })
const newLogo = ref('')

const myTeams = computed(() => teams.value.filter(t =>
  t.captain_sid === store.user?.uid || (t.members || []).includes(store.user?.uid)))
const myIds = computed(() => new Set(myTeams.value.map(t => t.id)))
// 招募中：显示所有招募中的战队（含自己的，便于确认招募已生效）
const recruiting = computed(() => teams.value.filter(t =>
  t.status === 'approved' && t.recruiting))
const approved = computed(() => teams.value.filter(t =>
  t.status === 'approved' && !myIds.value.has(t.id)))

async function load() {
  loading.value = true
  try {
    const r = await api.teams()
    teams.value = r.teams || []
  } catch (e) { toast(e.message, 'err') } finally { loading.value = false }
}
onMounted(load)

// 我的战队操作
async function toggleRecruit(t) {
  try { await api.toggleRecruit(t.id); toast(t.recruiting ? '已关闭招募' : '已开启招募'); load() }
  catch (e) { toast(e.message, 'err') }
}
function openEdit(t) {
  editForm.value = { name: t.name, shortName: t.short_name || '' }
  newLogo.value = ''
  modal.value = { type: 'edit', team: t }
}
async function saveEdit() {
  const m = modal.value
  try {
    const data = { name: editForm.value.name.trim(), shortName: editForm.value.shortName.trim() }
    if (newLogo.value) data.logo = newLogo.value
    await api.updateTeam(m.team.id, data)
    toast('已保存'); modal.value = null; load()
  } catch (e) { toast(e.message, 'err') }
}
async function openView(t) {
  let joinRequests = []
  if (t.captain_sid === store.user?.uid) {
    try { joinRequests = (await api.teamJoinRequests(t.id)).requests || [] } catch (e) {}
  }
  modal.value = { type: 'view', team: { ...t, joinRequests } }
}
async function approveJoin(j) {
  try { await api.approveJoin(j.id); toast('已通过'); load(); }
  catch (e) { toast(e.message, 'err') }
}
async function rejectJoin(j) {
  try { await api.rejectJoin(j.id); toast('已拒绝'); load(); }
  catch (e) { toast(e.message, 'err') }
}
async function kickMember(t, sid) {
  if (!confirm('确定将该成员踢出战队？')) return
  try { await api.kickMember(t.id, sid); toast('已踢出'); load() } catch (e) { toast(e.message, 'err') }
}
async function transferCaptain(t, sid) {
  if (!confirm('确定将队长转让给该成员？')) return
  try { await api.transferCaptain(t.id, sid); toast('队长已转让'); load() } catch (e) { toast(e.message, 'err') }
}
async function leaveTeam(t) {
  if (!confirm('确定退出该战队？')) return
  try { await api.leaveTeam(t.id); toast('已退出'); load() } catch (e) { toast(e.message, 'err') }
}

// 创建战队
async function createTeam() {
  const name = document.getElementById('team-name')?.value?.trim()
  const short = document.getElementById('team-short')?.value?.trim()
  const file = document.getElementById('team-logo-file')?.files?.[0]
  if (!name || name.length < 2 || name.length > 16) { toast('战队名称至少 2 个字', 'err'); return }
  try {
    let logo = ''
    if (file) {
      const chk = checkImage(file)
      if (!chk.ok) { toast(chk.error, 'err'); return }
      logo = await fileToDataUrl(file)
    }
    const r = await api.createTeam({ name, shortName: short || '', logo })
    toast('已提交审核，请等待管理员通过')
    modal.value = null
    load()
  } catch (e) { toast(e.message, 'err') }
}

// 邀请码加入
async function joinByCode() {
  const code = inviteCode.value.trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) { toast('邀请码为 6 位大写字母/数字', 'err'); return }
  try { await api.joinTeam(code); toast('入队申请已提交'); modal.value = null; load() }
  catch (e) { toast(e.message, 'err') }
}

// 招募中申请
async function applyTeam(t) {
  try { await api.applyTeam(t.id); toast('申请已提交'); load() } catch (e) { toast(e.message, 'err') }
}

async function readLogo(e) {
  const f = e.target.files[0]
  if (!f) return
  const chk = checkImage(f)
  if (!chk.ok) { toast(chk.error, 'err'); return }
  newLogo.value = await fileToDataUrl(f)
}

function teamCard(t) {
  const isCap = t.captain_sid === store.user?.uid
  return {
    isCap,
    badge: t.status === 'pending' ? { text: '待审核', cls: 'warn' } : (t.recruiting ? { text: '招募中', cls: 'ok' } : { text: '已激活', cls: 'muted' })
  }
}
</script>

<template>
  <AppShell>
    <h1 class="page-title">战队</h1>
    <p class="page-desc">创建、加入与管理 CS2 战队</p>

    <div class="grid2">
      <div class="card">
        <h3>创建战队</h3>
        <div class="field"><span>战队名称</span><input id="team-name" maxlength="16" placeholder="2-16 字"></div>
        <div class="field"><span>简称</span><input id="team-short" maxlength="8" placeholder="选填，如：一队"></div>
        <div class="field"><span>队徽</span><input id="team-logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></div>
        <button v-if="!store.guest" class="btn primary full" @click="createTeam">提交审核</button>
        <button v-else class="btn full" disabled>游客不可操作</button>
      </div>
      <div class="card">
        <h3>加入战队</h3>
        <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px">输入队长分享的 6 位邀请码</p>
        <div class="field"><span>邀请码</span><input v-model.trim="inviteCode" maxlength="6" placeholder="6 位大写字母/数字" style="text-transform:uppercase"></div>
        <button v-if="!store.guest" class="btn primary full" @click="joinByCode">申请加入</button>
        <button v-else class="btn full" disabled>游客不可操作</button>
      </div>
    </div>

    <template v-if="!store.guest">
      <div class="sec-title">我的战队</div>
      <div v-if="myTeams.length" class="grid2">
        <div v-for="t in myTeams" :key="t.id" class="card team-card">
          <div class="team-head">
            <div class="team-logo"><img v-if="t.logo" :src="t.logo" alt=""><span v-else>{{ t.name.slice(0, 1) }}</span></div>
            <div class="team-meta">
              <div class="t-name">{{ t.name }}</div>
              <div class="t-short">{{ t.short_name || '-' }}</div>
            </div>
            <span class="badge" :class="teamCard(t).badge.cls">{{ teamCard(t).badge.text }}</span>
          </div>
          <div class="team-info">
            <span>{{ (t.members || []).length }}/12 人</span>
            <span v-if="teamCard(t).isCap && t.status === 'approved'">邀请码: <code style="font-family:var(--mono);color:var(--accent)">{{ t.invite_code }}</code></span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <template v-if="teamCard(t).isCap">
              <button v-if="t.status === 'approved'" class="btn sm" :class="{ danger: t.recruiting }" @click="toggleRecruit(t)">{{ t.recruiting ? '关闭招募' : '开启招募' }}</button>
              <button class="btn sm" @click="openEdit(t)">编辑</button>
            </template>
            <button class="btn sm" @click="openView(t)">管理成员</button>
          </div>
        </div>
      </div>
      <div v-else class="card"><div class="empty">暂无战队，创建或加入一个吧</div></div>
    </template>

    <div class="sec-title">招募中</div>
    <div v-if="recruiting.length" class="grid2">
      <div v-for="t in recruiting" :key="t.id" class="card team-card">
        <div class="team-head">
          <div class="team-logo"><img v-if="t.logo" :src="t.logo" alt=""><span v-else>{{ t.name.slice(0, 1) }}</span></div>
          <div class="team-meta"><div class="t-name">{{ t.name }}</div><div class="t-short">{{ (t.members || []).length }}/12 人</div></div>
          <span v-if="myIds.has(t.id)" class="badge accent">我的战队</span>
          <span class="badge ok">招募中</span>
        </div>
        <button v-if="myIds.has(t.id)" class="btn sm ghost" @click="openView(t)">管理成员</button>
        <button v-else-if="!store.guest" class="btn sm" @click="applyTeam(t)">申请加入</button>
      </div>
    </div>
    <div v-else class="card"><div class="empty">暂无招募中的战队</div></div>

    <div class="sec-title">全部战队</div>
    <div v-if="approved.length" class="grid2">
      <div v-for="t in approved" :key="t.id" class="card team-card">
        <div class="team-head">
          <div class="team-logo"><img v-if="t.logo" :src="t.logo" alt=""><span v-else>{{ t.name.slice(0, 1) }}</span></div>
          <div class="team-meta"><div class="t-name">{{ t.name }}</div><div class="t-short">{{ (t.members || []).length }}/12 人</div></div>
        </div>
        <button class="btn sm" @click="openView(t)">查看成员</button>
      </div>
    </div>
    <div v-else class="card"><div class="empty">暂无战队</div></div>

    <!-- 编辑弹窗 -->
    <Modal :show="modal?.type === 'edit'" @close="modal = null">
      <h3>编辑战队 · {{ modal?.team?.name }}</h3>
      <div class="field"><span>名称</span><input v-model="editForm.name" maxlength="16"></div>
      <div class="field"><span>简称</span><input v-model="editForm.shortName" maxlength="8"></div>
      <div class="field">
        <span>队徽</span>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="readLogo">
        <span v-if="newLogo" style="font-size:11px;color:var(--ok)">已选择新队徽</span>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" @click="modal = null">取消</button>
        <button class="btn primary" @click="saveEdit">保存</button>
      </div>
    </Modal>

    <!-- 成员管理弹窗 -->
    <Modal :show="modal?.type === 'view'" @close="modal = null">
      <template v-if="modal">
        <h3>{{ modal.team.name }}</h3>
        <div style="margin-bottom:10px">
          <div v-for="m in modal.team.memberDetails" :key="m.sid" class="mem-row">
            <span class="nick">{{ m.nickname || m.sid }}</span>
            <span v-if="m.sid === modal.team.captain_sid" class="badge accent">队长</span>
            <template v-if="modal.team.captain_sid === store.user?.uid && m.sid !== store.user?.uid">
              <button class="btn sm" @click="transferCaptain(modal.team, m.sid)">转让</button>
              <button class="btn sm danger" @click="kickMember(modal.team, m.sid)">踢出</button>
            </template>
          </div>
        </div>
        <template v-if="modal.team.captain_sid === store.user?.uid">
          <div class="sec-title" style="margin-top:14px">入队申请</div>
          <div v-if="modal.team.joinRequests?.length">
            <div v-for="j in modal.team.joinRequests" :key="j.id" class="mem-row">
              <span class="badge" :class="j.via === 'recruit' ? 'warn' : 'ok'">{{ j.via === 'recruit' ? '申请' : '邀请' }}</span>
              <span class="nick">{{ j.user_nickname || j.sid }}</span>
              <button class="btn sm primary" @click="approveJoin(j)">通过</button>
              <button class="btn sm danger" @click="rejectJoin(j)">拒绝</button>
            </div>
          </div>
          <div v-else class="empty" style="padding:12px 0">暂无申请</div>
        </template>
        <div style="margin-top:10px;text-align:right">
          <button v-if="modal.team.captain_sid !== store.user?.uid && (modal.team.members || []).includes(store.user?.uid)"
            class="btn sm danger" @click="leaveTeam(modal.team)">退出战队</button>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" @click="modal = null">关闭</button>
        </div>
      </template>
    </Modal>
  </AppShell>
</template>
