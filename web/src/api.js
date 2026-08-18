// 业务 API 封装：统一走云函数 cs2-api
import { app } from './cloudbase'

export async function call(action, data = {}) {
  const res = await app.callFunction({ name: 'cs2-api', data: { action, ...data } })
  const r = res && res.result
  if (!r) throw new Error('服务无响应，请稍后重试')
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
  activateUser: (sid) => call('userActivate', { sid }),
  setUserRole: (sid, role) => call('userSetRole', { sid, role }),
  setUserStatus: (sid, status) => call('userSetStatus', { sid, status }),
  deleteUser: (sid) => call('userDelete', { sid }),
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
  markNotificationsRead: (id) => call('notificationMarkRead', { id })
}
