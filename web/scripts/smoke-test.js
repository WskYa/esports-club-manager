// 全链路冒烟测试：模拟真实用户流程（Node + @cloudbase/js-sdk）
// 用法：node scripts/smoke-test.js（从 web/.env 读取环境配置）
import cloudbase from '@cloudbase/js-sdk'

try {
  process.loadEnvFile(new URL('../.env', import.meta.url))
} catch (e) { console.error('未找到 web/.env，请先复制 .env.example 并填写配置'); process.exit(1) }

const ENV_ID = process.env.VITE_CB_ENV
const PUBLISHABLE_KEY = process.env.VITE_CB_PUBLISHABLE_KEY

// 测试账号（从 .env 读取，勿提交真实密码）
const ADMIN = { username: process.env.CB_ADMIN_SID || '1000000000', password: process.env.CB_ADMIN_PW }
const CAPTAIN = { username: process.env.CB_CAPTAIN_SID || '2024000011', password: process.env.CB_CAPTAIN_PW }

const app = cloudbase.init({ env: ENV_ID, accessKey: PUBLISHABLE_KEY, auth: { detectSessionInUrl: true } })
const auth = app.auth

const NEW_SID = '2024999999'
const NEW_PW = 'Test12345a'

let passed = 0, failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name} ${extra}`) }
}
async function call(action, data = {}) {
  const r = await app.callFunction({ name: 'cs2-api', data: { action, ...data } })
  return r.result
}
// 注册用户登录：云函数校验 → 自定义 ticket 登录
async function loginAs(u) {
  // 未登录调用云函数需要会话：无会话时先匿名占位
  const { data: s } = await auth.getSession()
  if (!s?.session) await auth.signInAnonymously().catch(() => {})
  const r = await call('loginVerify', { sid: u.username, password: u.password })
  if (!r.ok) throw new Error('loginVerify: ' + r.error)
  if (r.method === 'custom') {
    auth.setCustomSignFunc(async () => r.ticket)
    const { data, error } = await auth.signInWithCustomTicket()
    if (error) throw new Error('custom login: ' + error.message)
    return data
  }
  const { data, error } = await auth.signInWithPassword({ username: u.username, password: u.password })
  if (error) throw new Error('platform login: ' + error.message)
  return data
}
async function logout() {
  await auth.signOut().catch(() => {})
  // 登出后保持匿名会话，未登录态调用云函数需要
  await auth.signInAnonymously().catch(() => {})
}

console.log('=== 1. 管理员登录与读操作 ===')
try {
  await loginAs(ADMIN)
  const me = await call('getMe')
  check('管理员登录 getMe role=admin', me.ok && me.user?.role === 'admin', JSON.stringify(me))
  const stats = await call('stats')
  check('stats 返回计数', stats.ok && typeof stats.userCount === 'number')
  const teams = await call('teamList')
  check('teamList 有演示战队', teams.ok && teams.teams.length >= 1)
  const tours = await call('tournamentList')
  check('tournamentList 有赛事', tours.ok && tours.tournaments.length >= 1)
  const champ = await call('championGet')
  check('championGet 正常', champ.ok && champ.teamName === 'CS2 一队')
  const ul = await call('userList', { page: 1, pageSize: 20 })
  check('userList(admin) 返回用户', ul.ok && ul.total >= 2, JSON.stringify(ul))
  const wl = await call('whitelistGet')
  check('whitelistGet(admin) 正常', wl.ok && typeof wl.enabled === 'boolean')
  await logout()
} catch (e) { failed++; console.log('  ❌ 管理员流程异常:', e.message) }

console.log('=== 2. 游客只读 ===')
try {
  const { data, error } = await auth.signInAnonymously()
  if (error) throw new Error(error.message)
  check('匿名登录成功', !!data)
  const me = await call('getMe')
  check('游客 getMe guest=true', me.ok && me.guest === true)
  const t = await call('teamList')
  check('游客可读 teamList', t.ok)
  const writeDenied = await call('teamCreate', { name: '游客战队' })
  check('游客写操作被拒', !writeDenied.ok && writeDenied.error === '游客不可操作')
  await logout()
} catch (e) { failed++; console.log('  ❌ 游客流程异常:', e.message) }

console.log('=== 3. 新用户注册 → 激活 → 建队 ===')
let newUid = null
let newTeamId = null
try {
  // 未登录调用云函数需要会话：匿名占位
  await auth.signInAnonymously().catch(() => {})
  // 注册：云函数签发 ticket → 自定义登录（平台自动建用户）
  const reg = await call('register', {
    sid: NEW_SID, realName: '测试同学', college: '计算机与软件工程学院',
    nickname: 'Tester', qq: '123456', password: NEW_PW
  })
  check('register 返回 ticket', reg.ok && typeof reg.ticket === 'string' && reg.ticket.length > 20, JSON.stringify(reg).slice(0, 120))
  auth.setCustomSignFunc(async () => reg.ticket)
  const signup = await auth.signInWithCustomTicket()
  check('ticket 登录创建用户', !signup.error, signup.error?.message || '')
  const me1 = await call('getMe')
  check('注册后未激活', me1.ok && me1.user?.activated === 0, JSON.stringify(me1))
  newUid = me1.user?._id
  await logout()

  await loginAs(ADMIN)
  const me2 = await call('getMe')
  check('管理员登录(2)', me2.ok)
  // 管理员激活
  const ul = await call('userList', { search: NEW_SID })
  const nu = (ul.users || []).find(u => u.sid === NEW_SID)
  check('管理员搜索到新用户', !!nu)
  const act = await call('userActivate', { sid: NEW_SID })
  check('管理员激活', act.ok, JSON.stringify(act))
  await logout()

  await loginAs({ username: NEW_SID, password: NEW_PW })
  const me3 = await call('getMe')
  check('新用户登录后已激活', me3.ok && me3.user?.activated === 1 && me3.user?.role === 'member')
  // 错误密码登录应失败
  await logout()
  const bad = await call('loginVerify', { sid: NEW_SID, password: 'WrongPass1' })
  check('错误密码被拒', !bad.ok, JSON.stringify(bad))
  await loginAs({ username: NEW_SID, password: NEW_PW })
  const ct = await call('teamCreate', { name: '测试战队', shortName: '测' })
  check('创建战队成功且返回邀请码', ct.ok && /^[A-Z0-9]{6}$/.test(ct.inviteCode || ''), JSON.stringify(ct))
  newTeamId = ct.id
  const tp = await call('teamList')
  const myT = (tp.teams || []).find(t => t.id === newTeamId)
  check('新战队状态 pending', myT && myT.status === 'pending')
  check('新战队邀请码不暴露学号', myT && /^[A-Z0-9]{6}$/.test(myT.invite_code || ''))
  // 重复 pending 战队被拒
  const dup = await call('teamCreate', { name: '重复战队' })
  check('重复待审核战队被拒', !dup.ok && dup.error.includes('待审核'))
  await logout()
} catch (e) { failed++; console.log('  ❌ 注册/建队流程异常:', e.message) }

console.log('=== 4. 管理员审核战队 ===')
try {
  if (newTeamId) {
    await loginAs(ADMIN)
    const appr = await call('adminTeamApprove', { id: newTeamId })
    check('管理员审核通过战队', appr.ok, JSON.stringify(appr))
    await logout()
    await loginAs({ username: NEW_SID, password: NEW_PW })
    const me = await call('getMe')
    check('新用户自动升为 captain', me.ok && me.user?.role === 'captain', JSON.stringify(me.user))
    await logout()
  }
} catch (e) { failed++; console.log('  ❌ 战队审核流程异常:', e.message) }

console.log('=== 5. 约战全流程（发起→审核→接受→比分→双确认→排名） ===')
try {
  if (newTeamId) {
    await loginAs({ username: NEW_SID, password: NEW_PW })
    const teams = await call('teamList')
    const demo = (teams.teams || []).find(t => t.name === 'CS2 一队')
    const ch = await call('challengeCreate', { opponentTeamId: demo.id })
    check('新队长发起约战', ch.ok, JSON.stringify(ch))
    await logout()

    await loginAs(ADMIN)
    const chs1 = await call('challengeList')
    const pch = (chs1.challenges || []).find(c => c.status === 'pending_admin')
    check('管理员看到待审核约战', !!pch)
    const appr = await call('adminChallengeApprove', { id: pch.id })
    check('管理员审核约战通过', appr.ok)
    await logout()

    await loginAs(CAPTAIN)
    const chs2 = await call('challengeList')
    const pch2 = (chs2.challenges || []).find(c => c.id === pch.id)
    check('接收方看到约战状态 pending_accept', pch2 && pch2.status === 'pending_accept')
    const n1 = await call('notificationList')
    check('接收方收到约战通知', n1.ok && (n1.notifications || []).some(n => n.type === 'challenge'), JSON.stringify(n1))
    const acc = await call('challengeAccept', { id: pch.id })
    check('接收方接受约战', acc.ok)
    await logout()

    // 新队长上报比分
    await loginAs({ username: NEW_SID, password: NEW_PW })
    const report = await call('challengeReportResult', { id: pch.id, winnerTeamId: newTeamId, score: '2-1' })
    check('发起方上报比分', report.ok, JSON.stringify(report))
    const chs3 = await call('challengeList')
    const fin = (chs3.challenges || []).find(c => c.id === pch.id)
    check('比分待确认状态', fin && fin.status === 'finished' && fin.result_confirmed === 0 && fin.result === '2-1')
    const selfConfirm = await call('challengeConfirmResult', { id: pch.id })
    check('不能确认自己上报的比分', !selfConfirm.ok)
    await logout()

    // 对方确认
    await loginAs(CAPTAIN)
    const conf = await call('challengeConfirmResult', { id: pch.id })
    check('对方确认比分', conf.ok, JSON.stringify(conf))
    await logout()

    // 排名生效
    const rk = await call('rankings')
    const mine = (rk.rankings || []).find(r => r.teamId === newTeamId)
    check('确认后战绩计入排名(1胜)', mine && mine.wins === 1, JSON.stringify(mine))
    await logout()
  }
} catch (e) { failed++; console.log('  ❌ 约战流程异常:', e.message) }

console.log('=== 6. 活动/公告/通知 ===')
try {
  await loginAs(ADMIN)
  const acts = await call('activityList')
  check('活动列表有演示活动', acts.ok && acts.activities.length >= 1)
  const anns = await call('announcementList')
  check('公告列表有演示公告', anns.ok && anns.announcements.length >= 1)
  const logs = await call('activityLog', { limit: 50 })
  check('操作日志有记录', logs.ok && logs.logs.length >= 1)
  await logout()
} catch (e) { failed++; console.log('  ❌ 活动/公告流程异常:', e.message) }

console.log('=== 7. 清理测试数据 ===')
try {
  if (newUid) {
    await loginAs(ADMIN)
    const ul = await call('userList', { search: NEW_SID })
    const nu = (ul.users || []).find(u => u.sid === NEW_SID)
    if (nu) {
      const del = await call('userDelete', { sid: NEW_SID })
      check('删除测试用户（级联清战队）', del.ok, JSON.stringify(del))
    }
    await logout()
  }
} catch (e) { console.log('  ⚠️ 清理异常:', e.message) }

console.log(`\n========== 结果: ${passed} 通过 / ${failed} 失败 ==========`)
process.exit(failed > 0 ? 1 : 0)
