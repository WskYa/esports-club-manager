// 业务 API 封装：统一走云函数 cs2-api
import { app, auth } from './cloudbase'

// 调用云函数；未登录/匿名会话过期时网关返回 INVALID_CREDENTIALS，
// 自动重建匿名会话并重试一次（登录/注册页未登录场景的兜底）
async function callWithRetry(action, data) {
  let res = await app.callFunction({ name: 'cs2-api', data: { action, ...data } })
  if (res && (res.code === 'INVALID_CREDENTIALS' || (res.result === undefined && res.code))) {
    await auth.signInAnonymously().catch(() => {})
    res = await app.callFunction({ name: 'cs2-api', data: { action, ...data } })
  }
  return res
}

export async function call(action, data = {}) {
  const res = await callWithRetry(action, data)
  const r = res && res.result
  if (!r) throw new Error(res && res.message ? res.message : '服务无响应，请稍后重试')
  if (r.ok === false) throw new Error(r.error || '操作失败')
  return r
}

export const api = {
  // 认证
  me: () => call('getMe'),
  register: (data) => call('register', data),
  loginVerify: (sid, password) => call('loginVerify', { sid, password }),
  changePassword: (oldPassword, newPassword) => call('changePassword', { oldPassword, newPassword }),
  // 统计
  stats: () => call('stats'),
  // 用户
  users: (page = 1, pageSize = 20, search = '') => call('userList', { page, pageSize, search }),
  activateUser: (uid) => call('userActivate', { uid }),
  setUserRole: (uid, role) => call('userSetRole', { uid, role }),
  setUserStatus: (uid, status) => call('userSetStatus', { uid, status }),
  deleteUser: (uid) => call('userDelete', { uid }),
  // 战队
  teams: () => call('teamList'),
  createTeam: (data) => call('teamCreate', data),
  updateTeam: (id, data) => call('teamUpdate', { id, ...data }),
  toggleRecruit: (id) => call('teamToggleRecruit', { id }),
  joinTeam: (inviteCode) => call('teamJoin', { inviteCode }),
  applyTeam: (id) => call('teamApply', { id }),
  teamJoinRequests: (id) => call('teamJoinRequests', { id }),
  approveJoin: (jid) => call('teamApproveJoin', { jid }),
  rejectJoin: (jid) => call('teamRejectJoin', { jid }),
  kickMember: (id, sid) => call('teamKick', { id, sid }),
  leaveTeam: (id) => call('teamLeave', { id }),
  transferCaptain: (id, sid) => call('teamTransfer', { id, sid }),
  // 赛事
  tournaments: () => call('tournamentList'),
  createTournament: (data) => call('tournamentCreate', data),
  registerTournament: (tournamentId) => call('registrationCreate', { tournamentId }),
  adminRegistrations: () => call('registrationList'),
  approveTeam: (id) => call('adminTeamApprove', { id }),
  rejectTeam: (id) => call('adminTeamReject', { id }),
  approveReg: (rid) => call('registrationApprove', { rid }),
  rejectReg: (rid) => call('registrationDelete', { rid }),
  // 对阵
  matches: (tournamentId) => call('matchList', { tournamentId }),
  createMatch: (data) => call('matchCreate', data),
  setMatchResult: (id, scoreA, scoreB) => call('matchSetResult', { id, scoreA, scoreB }),
  deleteMatch: (id) => call('matchDelete', { id }),
  // 约战
  challenges: () => call('challengeList'),
  createChallenge: (opponentTeamId) => call('challengeCreate', { opponentTeamId }),
  acceptChallenge: (id) => call('challengeAccept', { id }),
  rejectChallenge: (id) => call('challengeReject', { id }),
  reportResult: (id, winnerTeamId, score) => call('challengeReportResult', { id, winnerTeamId, score }),
  confirmResult: (id) => call('challengeConfirmResult', { id }),
  approveChallenge: (id) => call('adminChallengeApprove', { id }),
  rejectChallengeAdmin: (id) => call('adminChallengeReject', { id }),
  // 排行榜
  rankings: () => call('rankings'),
  // 活动
  activities: () => call('activityList'),
  createActivity: (data) => call('activityCreate', data),
  deleteActivity: (id) => call('activityDelete', { id }),
  joinActivity: (id) => call('activityJoin', { id }),
  leaveActivity: (id) => call('activityLeave', { id }),
  activityParticipants: (id) => call('activityParticipants', { id }),
  // 公告
  announcements: () => call('announcementList'),
  createAnnouncement: (data) => call('announcementCreate', data),
  deleteAnnouncement: (id) => call('announcementDelete', { id }),
  // 冠军墙
  champion: () => call('championGet'),
  updateChampion: (data) => call('championUpdate', data),
  // 白名单
  whitelist: () => call('whitelistGet'),
  importWhitelist: (sids) => call('whitelistImport', { sids }),
  clearWhitelist: () => call('whitelistClear'),
  toggleWhitelist: () => call('whitelistToggle'),
  // 日志 / 通知
  activityLog: (limit = 200) => call('activityLog', { limit }),
  notifications: (limit = 50) => call('notificationList', { limit }),
  unreadCount: () => call('notificationUnreadCount'),
  markNotificationsRead: (id) => call('notificationMarkRead', { id }),
  clearNotifications: () => call('notificationClearRead')
}
