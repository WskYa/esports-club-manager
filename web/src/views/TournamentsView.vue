<script setup>
import { computed, onMounted, ref } from 'vue'
import AppShell from '../components/AppShell.vue'
import Modal from '../components/Modal.vue'
import { api } from '../api'
import { useAuthStore } from '../stores/auth'
import { toast } from '../toast'

const store = useAuthStore()
const rankings = ref([])
const challenges = ref([])
const teams = ref([])
const tournaments = ref([])
const matches = ref([])

const modal = ref(null)
const sel = ref({})

const myTeam = computed(() => teams.value.find(t =>
  t.captain_sid === store.user?.uid && t.status === 'approved'))

const myChallenges = computed(() => {
  if (!myTeam.value) return []
  return challenges.value.filter(c => c.from_team_id === myTeam.value.id || c.to_team_id === myTeam.value.id)
})

const availOpponents = computed(() => {
  if (!myTeam.value) return []
  const busy = new Set()
  myChallenges.value.forEach(c => {
    if (['pending_admin', 'pending_accept', 'accepted'].includes(c.status)) {
      busy.add(c.from_team_id === myTeam.value.id ? c.to_team_id : c.from_team_id)
    }
  })
  return teams.value.filter(t => t.id !== myTeam.value.id && t.status === 'approved' && !busy.has(t.id))
})

const chState = {
  pending_admin: ['待审核', 'warn'],
  pending_accept: ['待确认', 'warn'],
  accepted: ['已确认', 'ok'],
  finished: ['已结束', 'muted'],
  rejected: ['已拒绝', 'danger'],
  expired: ['已过期', 'muted']
}

async function load() {
  try {
    const [rk, ch, tm, td, md] = await Promise.all([
      api.rankings(), api.challenges(), api.teams(), api.tournaments(), api.matches()
    ])
    rankings.value = rk.rankings || []
    challenges.value = ch.challenges || []
    teams.value = tm.teams || []
    tournaments.value = td.tournaments || []
    matches.value = md.matches || []
  } catch (e) { toast(e.message, 'err') }
}
onMounted(load)

function fmtTime(t) {
  const d = new Date((t || 0) * 1000)
  const p = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

// ---- 约战 ----
function openChallenge() {
  sel.value = { opponentTeamId: availOpponents.value[0]?.id }
  modal.value = { type: 'challenge' }
}
async function submitChallenge() {
  try {
    await api.createChallenge(sel.value.opponentTeamId)
    toast('约战已发起，等待管理员审核')
    modal.value = null; load()
  } catch (e) { toast(e.message, 'err') }
}
async function acceptChallenge(c) {
  try { await api.acceptChallenge(c.id); toast('已接受约战'); load() } catch (e) { toast(e.message, 'err') }
}
async function rejectChallenge(c) {
  try { await api.rejectChallenge(c.id); toast('已拒绝'); load() } catch (e) { toast(e.message, 'err') }
}
function openResult(c) {
  sel.value = { cid: c.id, winnerTeamId: c.from_team_id, score: '' }
  modal.value = { type: 'result', challenge: c }
}
async function submitResult() {
  try {
    await api.reportResult(sel.value.cid, sel.value.winnerTeamId, sel.value.score)
    toast('比分已上报，等待对方确认（24小时内未确认自动生效）')
    modal.value = null; load()
  } catch (e) { toast(e.message, 'err') }
}
async function confirmResult(c) {
  if (!confirm('确认该比分为准？确认后战绩将计入排名')) return
  try { await api.confirmResult(c.id); toast('比分已确认，战绩已生效'); load() } catch (e) { toast(e.message, 'err') }
}

// ---- 赛事报名 ----
async function registerTournament(t) {
  try {
    await api.registerTournament(t.id)
    toast('报名成功，等待审核')
    load()
  } catch (e) { toast(e.message, 'err') }
}

// ---- 对阵（admin） ----
function openAddMatch(t) {
  const ok = teams.value.filter(x => x.status === 'approved')
  sel.value = { tournamentId: t.id, round: '', teamAId: ok[0]?.id, teamBId: ok[1]?.id, matchTime: '' }
  modal.value = { type: 'addMatch', teams: ok }
}
async function submitMatch() {
  try {
    await api.createMatch({
      tournamentId: sel.value.tournamentId, round: sel.value.round || '1',
      teamAId: sel.value.teamAId, teamBId: sel.value.teamBId,
      matchTime: sel.value.matchTime ? Math.floor(new Date(sel.value.matchTime).getTime() / 1000) : 0
    })
    toast('对阵已创建')
    modal.value = null; load()
  } catch (e) { toast(e.message, 'err') }
}
function openEditMatch(m) {
  sel.value = { mid: m.id, scoreA: m.score_a || 0, scoreB: m.score_b || 0, match: m }
  modal.value = { type: 'editMatch' }
}
async function submitScore() {
  try {
    await api.setMatchResult(sel.value.mid, parseInt(sel.value.scoreA) || 0, parseInt(sel.value.scoreB) || 0)
    toast('比分已录入')
    modal.value = null; load()
  } catch (e) { toast(e.message, 'err') }
}
async function deleteMatch(m) {
  if (!confirm('确定删除该对阵？')) return
  try { await api.deleteMatch(m.id); toast('已删除'); load() } catch (e) { toast(e.message, 'err') }
}

// ---- 赛事创建（admin） ----
const tourForm = ref({ name: '', intro: '', date: '', status: '报名中' })
async function createTournament() {
  if (!tourForm.value.name.trim()) { toast('请输入赛事名称', 'err'); return }
  try {
    await api.createTournament({ ...tourForm.value })
    toast('赛事已创建')
    tourForm.value = { name: '', intro: '', date: '', status: '报名中' }
    load()
  } catch (e) { toast(e.message, 'err') }
}
</script>

<template>
  <AppShell>
    <h1 class="page-title">赛事</h1>
    <p class="page-desc">战队排名 · 约战 · 赛事对阵</p>

    <!-- 排行榜 -->
    <div class="card">
      <h3>🏅 战队排名</h3>
      <div class="tbl-wrap">
        <table class="tbl rank-tbl">
          <thead><tr><th>排名</th><th>战队</th><th>胜</th><th>负</th><th>胜率</th><th>场次</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in rankings" :key="r.teamId">
              <td :class="{ r1: i === 0 }">{{ i + 1 }}</td>
              <td>{{ r.teamName }}</td>
              <td style="color:var(--ok)">{{ r.wins }}</td>
              <td>{{ r.losses }}</td>
              <td>{{ r.rate }}</td>
              <td style="color:var(--text-dim)">{{ r.played }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="!rankings.length" class="empty">暂无战绩，打完比赛就会出现在这里</div>
    </div>

    <!-- 约战 -->
    <div v-if="!store.guest" class="card">
      <div class="card-title-row">
        <h3>⚔️ 约战</h3>
        <button v-if="myTeam" class="btn primary sm" :disabled="!availOpponents.length" @click="openChallenge">发起约战</button>
      </div>
      <template v-if="myTeam">
        <div v-if="myChallenges.length">
          <div v-for="c in myChallenges" :key="c.id" class="ch-row">
            <div class="info">
              <div class="t">{{ c.to_team_id === myTeam.id ? '收到约战: ' : '发出约战: ' }}{{ c.to_team_id === myTeam.id ? c.from_team_name : c.to_team_name }}</div>
              <div class="d">{{ fmtTime(c.created_at) }}</div>
              <div v-if="c.winner_team_id && c.status === 'finished'" class="d" style="color:var(--ok)">
                胜者: {{ c.winner_team_id === myTeam.id ? '我方' : (c.winner_team_id === c.from_team_id ? c.from_team_name : c.to_team_name) }}{{ c.result ? ' · ' + c.result : '' }}
                <span v-if="!c.result_confirmed" class="badge warn" style="margin-left:6px">待对方确认</span>
                <span v-else class="badge ok" style="margin-left:6px">已确认</span>
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <span class="badge" :class="chState[c.status]?.[1] || 'muted'">{{ chState[c.status]?.[0] || c.status }}</span>
              <button v-if="c.to_team_id === myTeam.id && c.status === 'pending_accept'" class="btn sm primary" @click="acceptChallenge(c)">接受</button>
              <button v-if="c.to_team_id === myTeam.id && c.status === 'pending_accept'" class="btn sm danger" @click="rejectChallenge(c)">拒绝</button>
              <button v-if="c.status === 'accepted'" class="btn sm" @click="openResult(c)">上报比分</button>
              <button v-if="c.status === 'finished' && !c.result_confirmed && c.result_reporter_sid !== store.user?.uid" class="btn sm primary" @click="confirmResult(c)">确认比分</button>
            </div>
          </div>
        </div>
        <div v-else class="empty">还没有约战，发起第一场吧</div>
      </template>
      <div v-else class="empty">仅已通过审核的战队队长可发起约战</div>
    </div>

    <!-- 赛事列表 -->
    <div v-if="store.isAdmin" class="card">
      <h3>创建赛事</h3>
      <div class="grid2" style="margin-bottom:0">
        <div class="field"><span>名称</span><input v-model="tourForm.name" maxlength="30"></div>
        <div class="field"><span>日期</span><input v-model="tourForm.date" type="date"></div>
        <div class="field" style="grid-column:1/-1"><span>简介</span><input v-model="tourForm.intro" maxlength="120"></div>
        <div class="field"><span>状态</span>
          <select v-model="tourForm.status"><option>报名中</option><option>进行中</option><option>已结束</option></select>
        </div>
        <div style="display:flex;align-items:flex-end"><button class="btn primary" @click="createTournament">创建</button></div>
      </div>
    </div>

    <div v-for="t in tournaments" :key="t.id" class="card">
      <div class="card-title-row">
        <div>
          <h3 style="margin-bottom:2px">{{ t.name }}</h3>
          <div style="font-size:12px;color:var(--text-dim)">{{ t.date || '' }}<span v-if="t.intro"> · {{ t.intro }}</span></div>
        </div>
        <span class="badge" :class="t.status === '报名中' ? 'ok' : 'muted'">{{ t.status }}</span>
      </div>
      <div style="margin-bottom:10px">
        <template v-if="store.guest"><span class="badge muted">游客模式</span></template>
        <template v-else-if="t.myStatus === 'pending'"><span class="badge warn">审核中</span></template>
        <template v-else-if="t.myStatus === 'approved'"><span class="badge ok">已通过</span></template>
        <template v-else-if="t.status === '报名中' && myTeam"><button class="btn primary sm" @click="registerTournament(t)">报名参赛</button></template>
        <template v-else-if="t.status === '报名中' && !myTeam"><span class="badge warn">仅队长可报名</span></template>
      </div>

      <div v-if="matches.filter(m => m.tournament_id === t.id).length">
        <div v-for="m in matches.filter(m => m.tournament_id === t.id)" :key="m.id" class="m-row">
          <span class="m-team" style="text-align:right">{{ m.team_a }}</span>
          <span class="m-score">{{ m.status === 'finished' ? m.score_a + ' : ' + m.score_b : 'VS' }}</span>
          <span class="m-team">{{ m.team_b }}</span>
          <span class="badge" :class="m.status === 'finished' ? 'muted' : 'warn'">{{ m.status === 'finished' ? '已结束' : '待进行' }}</span>
          <template v-if="store.isAdmin">
            <button class="btn sm" @click="openEditMatch(m)">{{ m.status === 'finished' ? '改比分' : '录比分' }}</button>
            <button class="btn sm danger" @click="deleteMatch(m)">删</button>
          </template>
        </div>
      </div>
      <div v-else class="empty" style="padding:12px 0">暂无对阵</div>
      <button v-if="store.isAdmin" class="btn sm" style="margin-top:8px" @click="openAddMatch(t)">+ 添加对阵</button>
    </div>
    <div v-if="!tournaments.length" class="card"><div class="empty">暂无赛事</div></div>

    <!-- 发起约战弹窗 -->
    <Modal :show="modal?.type === 'challenge'" @close="modal = null">
      <h3>发起约战 · {{ myTeam?.name }}</h3>
      <div class="field">
        <span>选择对手</span>
        <select v-model="sel.opponentTeamId">
          <option v-for="t in availOpponents" :key="t.id" :value="t.id">{{ t.name }}（{{ (t.members || []).length }}人）</option>
        </select>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" @click="modal = null">取消</button>
        <button class="btn primary" @click="submitChallenge">发起</button>
      </div>
    </Modal>

    <!-- 上报比分弹窗 -->
    <Modal :show="modal?.type === 'result'" @close="modal = null">
      <h3>上报比分 · {{ modal?.challenge?.from_team_name }} vs {{ modal?.challenge?.to_team_name }}</h3>
      <div class="field">
        <span>胜者</span>
        <select v-model="sel.winnerTeamId">
          <option :value="modal?.challenge?.from_team_id">{{ modal?.challenge?.from_team_name }}</option>
          <option :value="modal?.challenge?.to_team_id">{{ modal?.challenge?.to_team_name }}</option>
        </select>
      </div>
      <div class="field"><span>比分（如 2-1）</span><input v-model="sel.score" maxlength="10"></div>
      <div class="modal-foot">
        <button class="btn ghost" @click="modal = null">取消</button>
        <button class="btn primary" @click="submitResult">确认上报</button>
      </div>
    </Modal>

    <!-- 添加对阵弹窗 -->
    <Modal :show="modal?.type === 'addMatch'" @close="modal = null">
      <h3>添加对阵</h3>
      <div class="field"><span>轮次</span><input v-model="sel.round" maxlength="10" placeholder="小组赛 / 八强 / 半决赛"></div>
      <div class="field">
        <span>战队 A</span>
        <select v-model="sel.teamAId">
          <option v-for="t in modal?.teams" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </div>
      <div class="field">
        <span>战队 B</span>
        <select v-model="sel.teamBId">
          <option v-for="t in modal?.teams" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </div>
      <div class="field"><span>比赛时间</span><input v-model="sel.matchTime" type="datetime-local"></div>
      <div class="modal-foot">
        <button class="btn ghost" @click="modal = null">取消</button>
        <button class="btn primary" @click="submitMatch">创建对阵</button>
      </div>
    </Modal>

    <!-- 录入比分弹窗 -->
    <Modal :show="modal?.type === 'editMatch'" @close="modal = null">
      <h3>录入比分 · {{ sel.match?.team_a }} vs {{ sel.match?.team_b }}</h3>
      <div style="display:flex;gap:10px;align-items:flex-end">
        <div class="field" style="flex:1"><span>{{ sel.match?.team_a }}</span><input v-model.number="sel.scoreA" type="number" min="0"></div>
        <div class="field" style="flex:1"><span>{{ sel.match?.team_b }}</span><input v-model.number="sel.scoreB" type="number" min="0"></div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" @click="modal = null">取消</button>
        <button class="btn primary" @click="submitScore">确认比分</button>
      </div>
    </Modal>
  </AppShell>
</template>
