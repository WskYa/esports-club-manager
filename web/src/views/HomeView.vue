<script setup>
import { onMounted, ref } from 'vue'
import AppShell from '../components/AppShell.vue'
import Modal from '../components/Modal.vue'
import { api } from '../api'
import { useAuthStore } from '../stores/auth'
import { toast } from '../toast'
import { checkImage, fileToDataUrl } from '../utils'

const store = useAuthStore()
const stats = ref({ userCount: 0, teamCount: 0 })
const champ = ref({ teamName: '', season: '', logo: '', members: [] })
const anns = ref([])
const showEdit = ref(false)
const editForm = ref({ teamName: '', season: '', members: [] })
const newMember = ref('')

function fmtTime(t) {
  const d = new Date((t || 0) * 1000)
  const p = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

async function load() {
  const [s, c, a] = await Promise.all([api.stats(), api.champion(), api.announcements()])
  stats.value = s
  champ.value = c
  anns.value = a.announcements || []
}

onMounted(load)

function openEdit() {
  editForm.value = { teamName: champ.value.teamName, season: champ.value.season, members: [...(champ.value.members || [])] }
  newMember.value = ''
  showEdit.value = true
}

function addMember() {
  const v = newMember.value.trim()
  if (!v) return
  if (editForm.value.members.includes(v)) { toast('该成员已存在', 'err'); return }
  editForm.value.members.push(v)
  newMember.value = ''
}

function delMember(i) { editForm.value.members.splice(i, 1) }

async function saveChamp() {
  try {
    await api.updateChampion({
      teamName: editForm.value.teamName.trim(),
      season: editForm.value.season.trim(),
      logo: champ.value.logo,
      members: editForm.value.members.filter(Boolean)
    })
    toast('已保存')
    showEdit.value = false
    load()
  } catch (e) { toast(e.message, 'err') }
}

async function onPickLogo(e) {
  const f = e.target.files[0]
  if (!f) return
  const chk = checkImage(f)
  if (!chk.ok) { toast(chk.error, 'err'); return }
  try {
    const logo = await fileToDataUrl(f)
    await api.updateChampion({
      teamName: editForm.value.teamName.trim(),
      season: editForm.value.season.trim(),
      logo,
      members: editForm.value.members.filter(Boolean)
    })
    toast('图标已更新')
    showEdit.value = false
    load()
  } catch (err) { toast(err.message, 'err') }
}
</script>

<template>
  <AppShell>
    <h1 class="page-title">首页</h1>
    <p class="page-desc">HAU CS2 电竞社团 · 最新动态</p>

    <div class="stat-grid">
      <div class="stat-card"><div class="num">{{ stats.userCount }}</div><div class="label">注册玩家</div></div>
      <div class="stat-card"><div class="num">{{ stats.teamCount }}</div><div class="label">战队</div></div>
      <div class="stat-card"><div class="num">{{ anns.length }}</div><div class="label">公告</div></div>
    </div>

    <div class="card">
      <div class="card-title-row">
        <h3>🏆 冠军战队</h3>
        <button v-if="store.isAdmin" class="btn sm" @click="openEdit">编辑</button>
      </div>
      <div class="champ-box">
        <div class="champ-logo">
          <img v-if="champ.logo" :src="champ.logo" alt="队徽">
          <span v-else>🎯</span>
        </div>
        <div>
          <div style="font-size:17px;font-weight:700">{{ champ.teamName || '暂无冠军战队' }}</div>
          <div style="font-size:12px;color:var(--text-dim)">{{ champ.season || '' }}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            <span v-for="m in champ.members" :key="m" class="badge accent">{{ m }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>📢 公告</h3>
      <div v-if="anns.length">
        <div v-for="a in anns" :key="a.id" class="ann-item">
          <div class="ann-head">
            <span class="ann-title">{{ a.title }}</span>
            <span class="ann-time">{{ fmtTime(a.created_at) }}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text-dim);white-space:pre-wrap">{{ a.content }}</div>
        </div>
      </div>
      <div v-else class="empty">暂无公告</div>
    </div>

    <Modal :show="showEdit" @close="showEdit = false">
      <h3>编辑冠军战队</h3>
      <div class="field"><span>战队名称</span><input v-model="editForm.teamName" maxlength="16"></div>
      <div class="field"><span>赛季</span><input v-model="editForm.season" maxlength="20"></div>
      <div class="field">
        <span>队员昵称</span>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input v-model="newMember" placeholder="添加队员昵称" maxlength="16" style="flex:1" @keyup.enter="addMember">
          <button class="btn sm" @click="addMember">添加</button>
        </div>
        <div v-for="(m, i) in editForm.members" :key="i" class="mem-row">
          <span class="nick">{{ m }}</span>
          <button class="btn sm danger" @click="delMember(i)">移除</button>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" @click="showEdit = false">取消</button>
        <button class="btn primary" @click="saveChamp">保存</button>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" id="champ-logo-input" @change="onPickLogo">
      <button class="btn sm" style="margin-top:4px" @click="document.getElementById('champ-logo-input').click()">更换队徽</button>
    </Modal>
  </AppShell>
</template>
