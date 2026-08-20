// HAU CS2 社团管理系统 v2 — 业务云函数（单事件函数，action 分发）
// 认证策略：
//  - 预置账号（管理员/队长）：平台 username/password 登录
//  - 注册用户：scrypt 哈希密码存 users 集合 → 云函数签发自定义登录 ticket →
//    前端 signInWithCustomTicket 登录（平台自动建用户，会话管理交给平台）
//  - 游客：平台匿名登录
// 数据库集合权限均为 ADMINONLY（客户端不直连，全部经本函数）
const crypto = require("crypto");
const tcb = require("@cloudbase/node-sdk");

// 自定义登录私钥（环境变量 CUSTOM_LOGIN_KEY：base64 编码的 tcb_custom_login.json）
// 部署到自己的环境时：请在函数配置中设置该环境变量（见 README 部署指南）
let credentials = null;
try {
  if (process.env.CUSTOM_LOGIN_KEY) {
    credentials = JSON.parse(Buffer.from(process.env.CUSTOM_LOGIN_KEY, "base64").toString("utf8"));
  }
} catch (e) { console.error("credentials parse fail:", e.message); }

// 部署到自己的环境时，请将 env 替换为你的 CloudBase 环境 ID
const ENV = process.env.CB_ENV || "cfls-d8gradwxmda9d2b28";
const app = tcb.init(credentials
  ? { env: ENV, credentials }
  : { env: ENV });
const db = app.database();
const _ = db.command;
const auth = app.auth();

const DAY = 86400;
const TEAM_LIMIT = 12; // 每队人数上限
const now = () => Math.floor(Date.now() / 1000);

// ================= 工具 =================

function ok(extra) { return Object.assign({ ok: true }, extra); }
function fail(error) { return { ok: false, error }; }

// doc(id).get() 的返回结构在不同 SDK 版本有差异，统一归一化
async function getDoc(collection, id) {
  try {
    const r = await db.collection(collection).doc(id).get();
    const d = r && r.data;
    if (Array.isArray(d)) return d[0] || null;
    return d && d._id ? d : null;
  } catch (e) { return null; }
}

async function list(collection, cond, orderBy, orderDir, limit, skip) {
  let q = db.collection(collection);
  if (cond && Object.keys(cond).length) q = q.where(cond);
  if (orderBy) q = q.orderBy(orderBy, orderDir || "desc");
  if (limit) q = q.limit(limit);
  if (skip) q = q.skip(skip);
  const r = await q.get();
  return (r && r.data) || [];
}

async function count(collection, cond) {
  let q = db.collection(collection);
  if (cond && Object.keys(cond).length) q = q.where(cond);
  const r = await q.count();
  return (r && r.total) || 0;
}

function callerUid() {
  try { return auth.getUserInfo().uid || ""; } catch (e) { return ""; }
}

// 当前调用者 profile；未注册（游客）返回 null
async function getCaller() {
  const uid = callerUid();
  if (!uid) return null;
  return getDoc("users", uid);
}

// 根据 sid 列表批量取用户
async function usersByIds(sids) {
  if (!sids || !sids.length) return [];
  return list("users", { _id: _.in(sids) });
}

// 操作日志（活动日志，仅管理员可看）
async function logAction(sid, nick, action, target, detail) {
  try {
    await db.collection("activity_log").add({
      sid: sid || "", nickname: nick || "", action: action || "",
      target: target || "", detail: detail || "", created_at: now()
    });
  } catch (e) { console.error("log fail:", e.message); }
}

// 站内通知
async function notify(toSid, type, title, content) {
  if (!toSid) return;
  try {
    await db.collection("notifications").add({
      to_sid: toSid, type: type || "info",
      title: String(title || "").slice(0, 80),
      content: String(content || "").slice(0, 300),
      read: 0, created_at: now()
    });
  } catch (e) { console.error("notify fail:", e.message); }
}

// 随机邀请码（密码学安全随机数，排除易混淆字符）
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function genInviteCode(len) {
  let s = "";
  for (let i = 0; i < (len || 6); i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}
async function uniqueInviteCode() {
  for (let i = 0; i < 10; i++) {
    const code = genInviteCode();
    const dup = await list("teams", { invite_code: code });
    if (!dup.length) return code;
  }
  throw new Error("生成邀请码失败");
}

// 校验规则
const RE_SID = /^\d{10,12}$/;
const RE_NAME = /^[\u4e00-\u9fa5]{2,10}$/;
const RE_QQ = /^\d{5,12}$/;

// 图片（data URL）白名单：仅常见位图格式，拒绝 SVG 等可执行内容；长度限制防文档超限
const MAX_LOGO_LEN = 700000;
function validLogo(logo) {
  if (logo === undefined || logo === null || logo === "") return true;
  return typeof logo === "string"
    && logo.length <= MAX_LOGO_LEN
    && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(logo.slice(0, 40));
}

// ---------- 密码哈希（scrypt）与登录保护 ----------
const SCRYPT_N = 16384;
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64, { N: SCRYPT_N }).toString("hex");
}
function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const calc = crypto.scryptSync(String(password), salt, 64, { N: SCRYPT_N }).toString("hex");
  // 恒定时间比较
  const a = Buffer.from(calc, "hex"), b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// 签发自定义登录 ticket（customUserId 用学号，平台自动创建/复用用户）
function createLoginTicket(sid) {
  if (!credentials) throw new Error("自定义登录未配置");
  return auth.createTicket(sid, { refresh: 7 * 86400e3, expire: 24 * 3600e3 });
}

function isGuest(u) { return !u; }

// 业务写操作要求：已登录且已激活（未激活用户即使拿到 ticket 也不能操作业务）
function requireActive(u) {
  if (isGuest(u)) return "游客不可操作";
  if (u.activated !== 1) return "账号未激活，请等待管理员激活";
  return null;
}

// 剔除敏感字段（password_hash / password_salt）后返回用户
function sanitizeUser(u) {
  if (!u) return u;
  const s = Object.assign({}, u);
  delete s.password_hash;
  delete s.password_salt;
  s.uid = s._id;
  s.is_platform = !u.password_hash;
  return s;
}

// ================= 认证 =================

// 注册：校验 → 哈希存储 → 签发自定义登录 ticket
async function actionRegister(event) {
  const { sid, realName, college, nickname, qq, password } = event;
  if (!RE_SID.test(sid)) return fail("学号须为10-12位数字");
  if (!RE_NAME.test(realName)) return fail("实名须为2-10位中文");
  if (!college) return fail("请选择学院");
  if (typeof nickname !== "string" || nickname.length < 2 || nickname.length > 16) return fail("昵称须为2-16字符");
  if (!RE_QQ.test(qq)) return fail("QQ号格式不正确");
  if (typeof password !== "string" || !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) return fail("密码至少8位，含字母和数字");
  const dup = await list("users", { sid });
  if (dup.length) return fail("该学号已被注册");
  const wl = await getDoc("whitelist_config", "1");
  if (wl && wl.enabled) {
    if (!(await getDoc("whitelist_entries", sid))) return fail("不在白名单内");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  // 先以学号占位写入（_id=sid），自定义登录拿到 uid 后由 getMe 迁移
  await db.collection("users").doc(sid).set({
    sid, real_name: realName, college, nickname, qq,
    password_hash: hash, password_salt: salt,
    role: "member", status: "在校", activated: 0, created_at: now(),
    fail_count: 0, locked_until: 0
  });
  const ticket = createLoginTicket(sid);
  return ok({ ticket });
}

// 登录校验：注册用户（哈希）→ 签发 ticket；平台预置用户 → 走平台登录
async function actionLoginVerify(event) {
  const sid = String(event.sid || "").trim();
  const password = String(event.password || "");
  if (!RE_SID.test(sid) || !password) return fail("学号或密码错误");
  const users = await list("users", { sid });
  const u = users[0];
  if (!u) return fail("学号或密码错误");
  // 锁定检查
  if (u.locked_until && u.locked_until > now()) return fail("登录失败次数过多，请稍后再试");
  if (u.password_hash) {
    // 注册用户：校验 scrypt 哈希
    if (!verifyPassword(password, u.password_hash, u.password_salt)) {
      const fails = (u.fail_count || 0) + 1;
      const patch = { fail_count: fails };
      if (fails >= 5) { patch.locked_until = now() + 900; patch.fail_count = 0; }
      await db.collection("users").doc(u._id).update(patch);
      return fail("学号或密码错误" + (fails >= 5 ? "，已锁定15分钟" : ""));
    }
    await db.collection("users").doc(u._id).update({ fail_count: 0, locked_until: 0 });
    const ticket = createLoginTicket(sid);
    return ok({ method: "custom", ticket });
  }
  // 平台预置用户（无 password_hash）：交给平台用户名密码登录
  return ok({ method: "platform" });
}

// 修改密码（注册用户）：登录态下校验旧密码 → 更新哈希
async function actionChangePassword(event) {
  const u = await getCaller();
  if (isGuest(u)) return fail("请先登录");
  if (!u.password_hash) return fail("该账号由平台管理，不支持此方式修改密码");
  const { oldPassword, newPassword } = event;
  if (!verifyPassword(oldPassword || "", u.password_hash, u.password_salt)) return fail("当前密码不正确");
  if (typeof newPassword !== "string" || !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(newPassword)) return fail("新密码至少8位，含字母和数字");
  const salt = crypto.randomBytes(16).toString("hex");
  await db.collection("users").doc(u._id).update({
    password_hash: hashPassword(newPassword, salt), password_salt: salt
  });
  return ok();
}

// 当前用户信息（含激活状态、角色）；自定义登录新用户首次访问时迁移占位文档
async function actionGetMe() {
  const uid = callerUid();
  if (!uid) return ok({ user: null, guest: true });
  let u = await getDoc("users", uid);
  if (!u) {
    // 自定义登录：customUserId = 学号，把注册时的占位文档迁移到 uid
    try {
      const info = auth.getUserInfo();
      if (info && info.customUserId) {
        const tmp = await getDoc("users", info.customUserId);
        if (tmp) {
          await db.collection("users").doc(uid).set(tmp);
          await db.collection("users").doc(info.customUserId).remove().catch(() => {});
          u = tmp;
        }
      }
    } catch (e) { console.error("migrate fail:", e.message); }
  }
  if (!u) return ok({ user: null, guest: true });
  return ok({ user: sanitizeUser(u), guest: false });
}

// ================= 统计 =================

async function actionStats() {
  const userCount = await count("users", { activated: 1 });
  const teamCount = await count("teams", { status: "approved" });
  return ok({ userCount, teamCount });
}

// ================= 用户管理（admin） =================

async function actionUserList(event) {
  const u = await getCaller();
  if (isGuest(u)) return fail("请先登录");
  if (u.role !== "admin") return fail("仅管理员");
  const page = Math.max(1, parseInt(event.page) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(event.pageSize) || 20));
  let cond = {};
  if (event.search) {
    const s = String(event.search).trim();
    if (s) {
      const re = db.RegExp({ regexp: s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options: "i" });
      cond = _.or([{ sid: re }, { real_name: re }, { nickname: re }, { college: re }]);
    }
  }
  const total = await count("users", cond);
  const users = (await list("users", cond, "created_at", "desc", pageSize, (page - 1) * pageSize)).map(sanitizeUser);
  return ok({ users, total, page, pageSize });
}

async function actionUserActivate(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const t = await getDoc("users", event.sid);
  if (!t) return fail("用户不存在");
  await db.collection("users").doc(event.sid).update({ activated: 1 });
  await logAction(u.sid, u.nickname, "activate_user", event.sid, "");
  await notify(event.sid, "account", "账号已激活", "管理员已激活你的账号，现在可以正常使用了。");
  return ok();
}

async function actionUserSetRole(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  if (event.sid === u._id) return fail("不能修改自己");
  const t = await getDoc("users", event.sid);
  if (!t) return fail("用户不存在");
  const role = event.role;
  if (!["member", "captain", "admin"].includes(role)) return fail("无效角色");
  await db.collection("users").doc(event.sid).update({ role });
  await logAction(u.sid, u.nickname, "change_role", event.sid, role);
  return ok();
}

async function actionUserSetStatus(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  if (event.sid === u._id) return fail("不能修改自己");
  const t = await getDoc("users", event.sid);
  if (!t) return fail("用户不存在");
  await db.collection("users").doc(event.sid).update({ status: event.status || "在校" });
  await logAction(u.sid, u.nickname, "change_status", event.sid, event.status || "在校");
  return ok();
}

async function actionUserDelete(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  if (event.sid === u._id) return fail("不能删除自己");
  const t = await getDoc("users", event.sid);
  if (!t) return fail("用户不存在");
  // 级联清理：入队申请、通知
  await db.collection("join_requests").where({ sid: event.sid }).remove().catch(() => {});
  await db.collection("notifications").where({ to_sid: event.sid }).remove().catch(() => {});
  // 从所有战队成员中移除
  const allTeams = await list("teams");
  for (const team of allTeams) {
    if (team.members && team.members.includes(event.sid)) {
      await db.collection("teams").doc(team._id).update({ members: _.pull(event.sid) });
    }
    // 若被删用户是该队队长 → 级联删除战队及其报名
    if (team.captain_sid === event.sid) {
      await db.collection("teams").doc(team._id).remove().catch(() => {});
      await db.collection("registrations").where({ team_id: team._id }).remove().catch(() => {});
    }
  }
  // 从活动报名中移除
  const acts = await list("activities");
  for (const a of acts) {
    if (a.participants && a.participants.includes(event.sid)) {
      await db.collection("activities").doc(a._id).update({ participants: _.pull(event.sid) });
    }
  }
  await db.collection("users").doc(event.sid).remove().catch(() => {});
  await logAction(u.sid, u.nickname, "delete_user", event.sid, "");
  return ok();
}

// ================= 战队 =================

// 战队详情；邀请码仅队长/成员可见（公开列表不泄露）
async function teamDetail(t, viewerUid) {
  if (!t) return null;
  const members = await usersByIds(t.members || []);
  const isMember = !!viewerUid && (t.captain_sid === viewerUid || (t.members || []).includes(viewerUid));
  return {
    id: t._id, name: t.name, short_name: t.short_name || "", logo: t.logo || "",
    captain_sid: t.captain_sid, status: t.status, recruiting: !!t.recruiting,
    invite_code: isMember ? (t.invite_code || "") : "",
    members: t.members || [], memberDetails: members.map(m => ({ sid: m._id, nickname: m.nickname, status: m.status })),
    created_at: t.created_at
  };
}

async function actionTeamList() {
  const u = await getCaller();
  const viewerUid = u ? u._id : null;
  const teams = await list("teams", null, "created_at", "desc");
  const result = [];
  for (const t of teams) result.push(await teamDetail(t, viewerUid));
  return ok({ teams: result });
}

async function actionTeamCreate(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const name = String(event.name || "").trim();
  if (name.length < 2 || name.length > 16) return fail("战队名称须为2-16字");
  const pending = await list("teams", { captain_sid: u._id, status: "pending" });
  if (pending.length) return fail("你已有待审核的战队申请");
  const code = await uniqueInviteCode();
  if (!validLogo(event.logo)) return fail("队徽格式不支持或文件过大");
  const id = "t" + Date.now() + Math.floor(Math.random() * 1000);
  await db.collection("teams").doc(id).set({
    name, short_name: String(event.shortName || "").slice(0, 8), logo: event.logo || "",
    captain_sid: u._id, status: "pending", recruiting: 0,
    invite_code: code, members: [u._id], created_at: now()
  });
  await logAction(u.sid, u.nickname, "create_team", id, name);
  return ok({ id, inviteCode: code });
}

async function actionTeamUpdate(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const t = await getDoc("teams", event.id);
  if (!t) return fail("战队不存在");
  if (t.captain_sid !== u._id) return fail("仅队长可操作");
  const name = event.name !== undefined ? String(event.name).trim() : t.name;
  if (name.length < 2 || name.length > 16) return fail("战队名称须为2-16字");
  const patch = { name };
  if (event.shortName !== undefined) patch.short_name = String(event.shortName).slice(0, 8);
  if (event.logo !== undefined) {
    if (!validLogo(event.logo)) return fail("队徽格式不支持或文件过大");
    patch.logo = event.logo;
  }
  await db.collection("teams").doc(t._id).update(patch);
  await logAction(u.sid, u.nickname, "edit_team", t._id, name);
  return ok();
}

async function actionTeamToggleRecruit(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const t = await getDoc("teams", event.id);
  if (!t) return fail("战队不存在");
  if (t.captain_sid !== u._id) return fail("仅队长可操作");
  const nv = t.recruiting ? 0 : 1;
  await db.collection("teams").doc(t._id).update({ recruiting: nv });
  return ok({ recruiting: !!nv });
}

// 通过邀请码加入（原系统：学号后6位 → 现在：随机邀请码）
async function actionTeamJoin(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const code = String(event.inviteCode || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return fail("邀请码格式不正确");
  const found = await list("teams", { invite_code: code, status: "approved" });
  if (!found.length) return fail("未找到对应战队，请核对邀请码");
  const t = found[0];
  if (t.captain_sid === u._id || (t.members || []).includes(u._id)) return fail("你已在该战队中");
  const active = (await usersByIds(t.members || [])).filter(m => m.status !== "已毕业").length;
  if (active >= TEAM_LIMIT) return fail("人数已达上限");
  const dup = await list("join_requests", { team_id: t._id, sid: u._id, status: _.in(["pending", "pending_captain"]) });
  if (dup.length) return fail("你已提交申请，等待审核");
  const jid = "jr" + Date.now() + Math.floor(Math.random() * 1000);
  await db.collection("join_requests").doc(jid).set({
    team_id: t._id, sid: u._id, status: "pending", via: "invite", created_at: now()
  });
  await notify(t.captain_sid, "team", "新的入队申请", u.nickname + " 申请加入你的战队「" + t.name + "」");
  return ok();
}

// 向招募中的战队投递申请
async function actionTeamApply(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const t = await getDoc("teams", event.id);
  if (!t) return fail("战队不存在");
  if (!t.recruiting) return fail("未在招募");
  if (t.captain_sid === u._id || (t.members || []).includes(u._id)) return fail("你已在该战队中");
  const dup = await list("join_requests", { team_id: t._id, sid: u._id, status: _.in(["pending", "pending_captain"]) });
  if (dup.length) return fail("你已提交申请，等待审核");
  const jid = "jr" + Date.now() + Math.floor(Math.random() * 1000);
  await db.collection("join_requests").doc(jid).set({
    team_id: t._id, sid: u._id, status: "pending_captain", via: "recruit", created_at: now()
  });
  await notify(t.captain_sid, "team", "新的入队申请", u.nickname + " 申请加入你的战队「" + t.name + "」");
  return ok();
}

async function actionTeamJoinRequests(event) {
  const u = await getCaller();
  if (isGuest(u)) return fail("请先登录");
  const t = await getDoc("teams", event.id);
  if (!t) return fail("战队不存在");
  if (t.captain_sid !== u._id) return fail("仅队长可查看");
  const reqs = await list("join_requests", { team_id: t._id }, "created_at", "desc");
  const users = await usersByIds(reqs.map(r => r.sid));
  const umap = {};
  users.forEach(m => { umap[m._id] = m.nickname; });
  return ok({ requests: reqs.map(r => Object.assign({}, r, { user_nickname: umap[r.sid] || r.sid })) });
}

async function actionTeamApproveJoin(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const j = await getDoc("join_requests", event.jid);
  if (!j) return fail("申请不存在");
  const t = await getDoc("teams", j.team_id);
  if (!t || t.captain_sid !== u._id) return fail("仅队长可审核");
  const active = (await usersByIds(t.members || [])).filter(m => m.status !== "已毕业").length;
  if (active >= TEAM_LIMIT) return fail("人数已达上限");
  const members = t.members || [];
  if (!members.includes(j.sid)) members.push(j.sid);
  await db.collection("teams").doc(t._id).update({ members });
  await db.collection("join_requests").doc(j._id).remove().catch(() => {});
  await notify(j.sid, "team", "入队申请已通过", "你已加入战队「" + t.name + "」");
  return ok();
}

async function actionTeamRejectJoin(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const j = await getDoc("join_requests", event.jid);
  if (!j) return fail("申请不存在");
  const t = await getDoc("teams", j.team_id);
  if (!t || t.captain_sid !== u._id) return fail("仅队长可审核");
  await db.collection("join_requests").doc(j._id).remove().catch(() => {});
  await notify(j.sid, "team", "入队申请被拒绝", "你加入「" + t.name + "」的申请被队长拒绝");
  return ok();
}

async function actionTeamKick(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const t = await getDoc("teams", event.id);
  if (!t || t.captain_sid !== u._id) return fail("仅队长可操作");
  if (event.sid === u._id) return fail("不能踢出自己");
  await db.collection("teams").doc(t._id).update({ members: _.pull(event.sid) });
  return ok();
}

async function actionTeamLeave(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const t = await getDoc("teams", event.id);
  if (!t) return fail("战队不存在");
  if (t.captain_sid === u._id) return fail("队长不能退队，请先转让队长");
  await db.collection("teams").doc(t._id).update({ members: _.pull(u._id) });
  return ok();
}

async function actionTeamTransfer(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const t = await getDoc("teams", event.id);
  if (!t || t.captain_sid !== u._id) return fail("仅队长可操作");
  if (!(t.members || []).includes(event.sid)) return fail("该用户不在战队中");
  await db.collection("teams").doc(t._id).update({ captain_sid: event.sid });
  // 角色调整：新队长升 captain（保留 admin），旧队长降 member
  const old = await getDoc("users", u._id);
  const neu = await getDoc("users", event.sid);
  if (neu && neu.role !== "admin") await db.collection("users").doc(event.sid).update({ role: "captain" });
  if (old && old.role !== "admin") await db.collection("users").doc(u._id).update({ role: "member" });
  return ok();
}

// 管理员审核战队
async function actionAdminTeamApprove(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const t = await getDoc("teams", event.id);
  if (!t) return fail("战队不存在");
  await db.collection("teams").doc(t._id).update({ status: "approved" });
  const cap = await getDoc("users", t.captain_sid);
  if (cap && cap.role !== "admin") await db.collection("users").doc(t.captain_sid).update({ role: "captain" });
  await logAction(u.sid, u.nickname, "approve_team", t._id, t.name);
  await notify(t.captain_sid, "team", "战队审核通过", "你的战队「" + t.name + "」已通过审核");
  return ok();
}

async function actionAdminTeamDelete(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const t = await getDoc("teams", event.id);
  if (!t) return fail("战队不存在");
  await db.collection("join_requests").where({ team_id: t._id }).remove().catch(() => {});
  await db.collection("registrations").where({ team_id: t._id }).remove().catch(() => {});
  await db.collection("teams").doc(t._id).remove().catch(() => {});
  await logAction(u.sid, u.nickname, "delete_team", t._id, t.name);
  await notify(t.captain_sid, "team", "战队被删除", "你的战队「" + t.name + "」已被管理员删除");
  return ok();
}

// ================= 赛事 =================

async function actionTournamentList() {
  const u = await getCaller();
  const tours = await list("tournaments", null, "created_at", "desc");
  // 当前用户已通过战队的报名状态（前端展示"已报名/审核中"用）
  let regMap = {};
  if (u) {
    const myTeam = await list("teams", { captain_sid: u._id, status: "approved" });
    if (myTeam.length) {
      const regs = await list("registrations", { team_id: myTeam[0]._id });
      regs.forEach(r => { regMap[r.tournament_id] = r.status; });
    }
  }
  return ok({ tournaments: tours.map(t => Object.assign({
    id: t._id, name: t.name, intro: t.intro || "", date: t.date || "",
    status: t.status || "报名中", created_at: t.created_at
  }, { myStatus: regMap[t._id] || "" })) });
}

async function actionTournamentCreate(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const name = String(event.name || "").trim();
  if (!name) return fail("请输入赛事名称");
  const VALID_STATUS = ["报名中", "进行中", "已结束"];
  const status = VALID_STATUS.includes(event.status) ? event.status : "报名中";
  const id = "tr" + Date.now() + Math.floor(Math.random() * 1000);
  await db.collection("tournaments").doc(id).set({
    name: name.slice(0, 30), intro: String(event.intro || "").slice(0, 120),
    date: String(event.date || "").slice(0, 20), status,
    created_at: now()
  });
  await logAction(u.sid, u.nickname, "create_tournament", id, name);
  return ok({ id });
}

async function actionRegistrationList(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const regs = await list("registrations", null, "created_at", "desc");
  const tours = await list("tournaments");
  const tmap = {};
  tours.forEach(t => { tmap[t._id] = t.name; });
  return ok({ registrations: regs.map(r => Object.assign({}, r, { tournament_name: tmap[r.tournament_id] || "" })) });
}

async function actionRegistrationCreate(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const myTeam = await list("teams", { captain_sid: u._id, status: "approved" });
  if (!myTeam.length) return fail("你不是已通过战队的队长");
  const t = myTeam[0];
  const tour = await getDoc("tournaments", event.tournamentId);
  if (!tour) return fail("赛事不存在");
  if (tour.status !== "报名中") return fail("该赛事当前不可报名");
  const dup = await list("registrations", { tournament_id: tour._id, team_id: t._id });
  if (dup.length) return fail("该战队已报名");
  const id = "rg" + Date.now() + Math.floor(Math.random() * 1000);
  await db.collection("registrations").doc(id).set({
    tournament_id: tour._id, team_id: t._id, team_name: t.name,
    captain_sid: u._id, status: "pending", created_at: now()
  });
  return ok();
}

async function actionRegistrationApprove(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const r = await getDoc("registrations", event.rid);
  if (!r) return fail("报名不存在");
  await db.collection("registrations").doc(r._id).update({ status: "approved" });
  await notify(r.captain_sid, "tournament", "赛事报名已通过", "「" + r.team_name + "」报名赛事已通过审核");
  return ok();
}

async function actionRegistrationDelete(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const r = await getDoc("registrations", event.rid);
  if (!r) return fail("报名不存在");
  await db.collection("registrations").doc(r._id).remove().catch(() => {});
  await notify(r.captain_sid, "tournament", "赛事报名被拒绝", "「" + r.team_name + "」的赛事报名已被管理员拒绝");
  return ok();
}

// ================= 对阵（赛事比赛） =================

async function actionMatchList(event) {
  const cond = event.tournamentId ? { tournament_id: event.tournamentId } : null;
  const matches = await list("matches", cond, "match_time", "asc");
  const teams = await list("teams");
  const tmap = {};
  teams.forEach(t => { tmap[t._id] = t.name; });
  return ok({ matches: matches.map(m => ({
    id: m._id, tournament_id: m.tournament_id, round: m.round || "1",
    team_a: tmap[m.team_a_id] || "轮空", team_b: tmap[m.team_b_id] || "轮空",
    team_a_id: m.team_a_id || "", team_b_id: m.team_b_id || "",
    score_a: m.score_a || 0, score_b: m.score_b || 0, winner_team_id: m.winner_team_id || "",
    status: m.status || "scheduled", match_time: m.match_time || 0
  })) });
}

async function actionMatchCreate(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  if (!event.tournamentId) return fail("缺少赛事");
  if (!event.teamAId && !event.teamBId) return fail("请选择对阵双方");
  // 校验参赛战队存在且已通过审核
  const teamIds = [event.teamAId, event.teamBId].filter(Boolean);
  const checkTeams = await list("teams", { _id: _.in(teamIds) });
  const approvedIds = new Set(checkTeams.filter(t => t.status === "approved").map(t => t._id));
  if (event.teamAId && !approvedIds.has(event.teamAId)) return fail("战队 A 不存在或未通过审核");
  if (event.teamBId && !approvedIds.has(event.teamBId)) return fail("战队 B 不存在或未通过审核");
  const id = "mt" + Date.now() + Math.floor(Math.random() * 1000);
  await db.collection("matches").doc(id).set({
    tournament_id: event.tournamentId, round: String(event.round || "1").slice(0, 10),
    team_a_id: event.teamAId || "", team_b_id: event.teamBId || "",
    score_a: 0, score_b: 0, winner_team_id: "", status: "scheduled",
    match_time: parseInt(event.matchTime) || 0, created_at: now()
  });
  await logAction(u.sid, u.nickname, "create_match", id, event.tournamentId);
  return ok({ id });
}

async function actionMatchSetResult(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const m = await getDoc("matches", event.id);
  if (!m) return fail("对阵不存在");
  const a = parseInt(event.scoreA) || 0, b = parseInt(event.scoreB) || 0;
  if (a < 0 || b < 0) return fail("比分不能为负数");
  if (a === b) return fail("比分不能相同，请区分胜负");
  const winner = a > b ? m.team_a_id : m.team_b_id;
  await db.collection("matches").doc(m._id).update({ score_a: a, score_b: b, winner_team_id: winner, status: "finished" });
  await logAction(u.sid, u.nickname, "set_match_result", m._id, a + ":" + b);
  return ok();
}

async function actionMatchDelete(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const m = await getDoc("matches", event.id);
  if (!m) return fail("对阵不存在");
  await db.collection("matches").doc(event.id).remove().catch(() => {});
  return ok();
}

// ================= 约战（含比分双方确认） =================

// 懒过期：待审核约战超24h自动过期；已上报比分超24h未确认自动生效
async function expireChallenges() {
  const t = now();
  const pendings = await list("challenges", { status: _.in(["pending_admin", "pending_accept"]) });
  for (const c of pendings) {
    if (t - (c.created_at || 0) > DAY) {
      await db.collection("challenges").doc(c._id).update({ status: "expired" });
    }
  }
  const unconfirmed = await list("challenges", { status: "finished", result_confirmed: 0 });
  for (const c of unconfirmed) {
    if (t - (c.result_reported_at || 0) > DAY) {
      await db.collection("challenges").doc(c._id).update({ result_confirmed: 1 });
    }
  }
}

async function actionChallengeList() {
  const u = await getCaller();
  if (isGuest(u)) return fail("请先登录");
  await expireChallenges();
  const chs = await list("challenges", null, "created_at", "desc");
  return ok({ challenges: chs.map(c => ({
    id: c._id, from_team_id: c.from_team_id, to_team_id: c.to_team_id,
    from_team_name: c.from_team_name, to_team_name: c.to_team_name,
    from_captain_sid: c.from_captain_sid, to_captain_sid: c.to_captain_sid,
    status: c.status, result: c.result || "", winner_team_id: c.winner_team_id || "",
    result_confirmed: c.result_confirmed || 0, result_reporter_sid: c.result_reporter_sid || "",
    created_at: c.created_at
  })) });
}

async function actionChallengeCreate(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const myTeam = await list("teams", { captain_sid: u._id, status: "approved" });
  if (!myTeam.length) return fail("仅队长可发起");
  const me = myTeam[0];
  const opp = await getDoc("teams", event.opponentTeamId);
  if (!opp || opp.status !== "approved" || opp._id === me._id) return fail("无效的对手");
  const id = "ch" + Date.now() + Math.floor(Math.random() * 1000);
  await db.collection("challenges").doc(id).set({
    from_team_id: me._id, to_team_id: opp._id,
    from_team_name: me.name, to_team_name: opp.name,
    from_captain_sid: u._id, to_captain_sid: opp.captain_sid,
    status: "pending_admin", result: "", winner_team_id: "",
    result_confirmed: 0, result_reporter_sid: "", created_at: now()
  });
  await notify(opp.captain_sid, "challenge", "收到约战", me.name + " 向你的战队发起了约战，等待管理员审核");
  return ok();
}

async function actionChallengeAccept(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const c = await getDoc("challenges", event.id);
  if (!c) return fail("约战不存在");
  if (c.status !== "pending_accept") return fail("当前状态不可接受（需管理员审核通过后）");
  const myTeam = await list("teams", { captain_sid: u._id, status: "approved" });
  if (!myTeam.length || myTeam[0]._id !== c.to_team_id) return fail("仅接收方队长可操作");
  await db.collection("challenges").doc(c._id).update({ status: "accepted" });
  await notify(c.from_captain_sid, "challenge", "约战已接受", c.to_team_name + " 已接受约战，可以准备比赛了");
  return ok();
}

async function actionChallengeReject(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const c = await getDoc("challenges", event.id);
  if (!c) return fail("约战不存在");
  if (c.status !== "pending_accept") return fail("当前状态不可拒绝（需管理员审核通过后）");
  const myTeam = await list("teams", { captain_sid: u._id, status: "approved" });
  if (!myTeam.length || myTeam[0]._id !== c.to_team_id) return fail("仅接收方队长可操作");
  await db.collection("challenges").doc(c._id).update({ status: "rejected" });
  await notify(c.from_captain_sid, "challenge", "约战被拒绝", c.to_team_name + " 拒绝了你的约战");
  return ok();
}

// 上报比分（双方任一队长）→ 待对方确认
async function actionChallengeReportResult(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const c = await getDoc("challenges", event.id);
  if (!c) return fail("约战不存在");
  if (c.status !== "accepted") return fail("仅已接受的约战可上报比分");
  if (c.from_captain_sid !== u._id && c.to_captain_sid !== u._id) return fail("仅约战双方队长可操作");
  const winner = event.winnerTeamId;
  if (!winner || (winner !== c.from_team_id && winner !== c.to_team_id)) return fail("请选择胜者");
  const score = String(event.score || "").slice(0, 20);
  await db.collection("challenges").doc(c._id).update({
    result: score, winner_team_id: winner, status: "finished",
    result_confirmed: 0, result_reporter_sid: u._id, result_reported_at: now()
  });
  const confirmSid = c.from_captain_sid === u._id ? c.to_captain_sid : c.from_captain_sid;
  await notify(confirmSid, "challenge", "比分待确认",
    c.from_team_name + " vs " + c.to_team_name + " 已上报比分（" + (score || "-") + "），请在24小时内确认，超时自动生效");
  return ok();
}

// 对方确认比分 → 生效入排名
async function actionChallengeConfirmResult(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const c = await getDoc("challenges", event.id);
  if (!c) return fail("约战不存在");
  if (c.status !== "finished" || c.result_confirmed) return fail("当前状态无需确认");
  if (c.result_reporter_sid === u._id) return fail("不能确认自己上报的比分");
  if (c.from_captain_sid !== u._id && c.to_captain_sid !== u._id) return fail("仅约战双方队长可操作");
  await db.collection("challenges").doc(c._id).update({ result_confirmed: 1 });
  await notify(c.result_reporter_sid, "challenge", "比分已确认", "对方已确认比分，战绩已计入排名");
  return ok();
}

async function actionAdminChallengeApprove(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const c = await getDoc("challenges", event.id);
  if (!c || c.status !== "pending_admin") return fail("状态异常");
  await db.collection("challenges").doc(c._id).update({ status: "pending_accept" });
  await notify(c.to_captain_sid, "challenge", "约战待确认", c.from_team_name + " 的约战已通过管理员审核，请确认是否接受");
  await notify(c.from_captain_sid, "challenge", "约战审核通过", "你发起的约战已通过管理员审核，等待对方确认");
  return ok();
}

async function actionAdminChallengeReject(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const c = await getDoc("challenges", event.id);
  if (!c || c.status !== "pending_admin") return fail("状态异常");
  await db.collection("challenges").doc(c._id).update({ status: "rejected" });
  await notify(c.from_captain_sid, "challenge", "约战被驳回", "你发起的约战未通过管理员审核");
  return ok();
}

// ================= 排行榜 =================

async function actionRankings() {
  const stats = {};
  function add(teamId, win) {
    if (!teamId) return;
    const s = stats[teamId] || (stats[teamId] = { wins: 0, losses: 0 });
    if (win) s.wins++; else s.losses++;
  }
  // 赛事对阵（管理员录入，直接生效）
  const finishedMatches = await list("matches", { status: "finished" });
  finishedMatches.forEach(m => {
    if (!m.winner_team_id) return;
    add(m.team_a_id, m.winner_team_id === m.team_a_id);
    add(m.team_b_id, m.winner_team_id === m.team_b_id);
  });
  // 约战（仅统计双方确认后的结果）
  const finishedChs = await list("challenges", { status: "finished", result_confirmed: 1 });
  finishedChs.forEach(c => {
    if (!c.winner_team_id) return;
    add(c.from_team_id, c.winner_team_id === c.from_team_id);
    add(c.to_team_id, c.winner_team_id === c.to_team_id);
  });
  const teams = await list("teams");
  const tmap = {};
  teams.forEach(t => { tmap[t._id] = t.name; });
  const list2 = Object.keys(stats).map(id => {
    const s = stats[id], total = s.wins + s.losses;
    return {
      teamId: id, teamName: tmap[id] || "未知战队",
      wins: s.wins, losses: s.losses, played: total,
      rate: total ? (s.wins / total * 100).toFixed(0) + "%" : "-"
    };
  });
  // 排序：胜场降序 → 胜率降序 → 场次降序
  list2.sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    const rx = parseFloat(x.rate), ry = parseFloat(y.rate);
    if (!isNaN(rx) && !isNaN(ry) && rx !== ry) return ry - rx;
    if (isNaN(rx)) return 1;
    if (isNaN(ry)) return -1;
    return y.played - x.played;
  });
  return ok({ rankings: list2 });
}

// ================= 活动 =================

async function actionActivityList() {
  const u = await getCaller();
  const acts = await list("activities", null, "created_at", "desc");
  return ok({ activities: acts.map(a => ({
    id: a._id, title: a.title, content: a.content || "", location: a.location || "",
    time: a.time || "", capacity: a.capacity || 0, status: a.status || "报名中",
    count: (a.participants || []).length,
    joined: u ? (a.participants || []).includes(u._id) : false,
    created_at: a.created_at
  })) });
}

async function actionActivityCreate(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const title = String(event.title || "").trim();
  if (!title) return fail("请输入活动标题");
  const VALID_STATUS = ["报名中", "进行中", "已结束"];
  const status = VALID_STATUS.includes(event.status) ? event.status : "报名中";
  const id = "ac" + Date.now() + Math.floor(Math.random() * 1000);
  await db.collection("activities").doc(id).set({
    title: title.slice(0, 30), content: String(event.content || "").slice(0, 300),
    location: String(event.location || "").slice(0, 30), time: String(event.time || "").slice(0, 30),
    capacity: Math.max(0, parseInt(event.capacity) || 0), status,
    participants: [], created_at: now()
  });
  await logAction(u.sid, u.nickname, "create_activity", id, title);
  return ok({ id });
}

async function actionActivityDelete(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  await db.collection("activities").doc(event.id).remove().catch(() => {});
  return ok();
}

async function actionActivityJoin(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const a = await getDoc("activities", event.id);
  if (!a) return fail("活动不存在");
  if (a.status !== "报名中") return fail("该活动当前不可报名");
  const parts = a.participants || [];
  if (parts.includes(u._id)) return fail("你已报名该活动");
  if (a.capacity > 0 && parts.length >= a.capacity) return fail("名额已满");
  // addToSet 原子添加，避免并发重复报名
  await db.collection("activities").doc(a._id).update({ participants: _.addToSet(u._id) });
  await logAction(u.sid, u.nickname, "join_activity", a._id, a.title);
  return ok();
}

async function actionActivityLeave(event) {
  const u = await getCaller();
  const denied = requireActive(u); if (denied) return fail(denied);
  const a = await getDoc("activities", event.id);
  if (!a) return fail("活动不存在");
  await db.collection("activities").doc(a._id).update({ participants: _.pull(u._id) });
  return ok();
}

async function actionActivityParticipants(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const a = await getDoc("activities", event.id);
  if (!a) return fail("活动不存在");
  const parts = await usersByIds(a.participants || []);
  return ok({ participants: parts.map(p => ({ sid: p._id, nickname: p.nickname, college: p.college })) });
}

// ================= 公告 =================

async function actionAnnouncementList() {
  const anns = await list("announcements", null, "created_at", "desc");
  return ok({ announcements: anns.map(a => ({ id: a._id, title: a.title, content: a.content, created_at: a.created_at })) });
}

async function actionAnnouncementCreate(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const title = String(event.title || "").trim(), content = String(event.content || "").trim();
  if (!title || !content) return fail("标题和内容不能为空");
  const id = "an" + Date.now() + Math.floor(Math.random() * 1000);
  await db.collection("announcements").doc(id).set({
    title: title.slice(0, 30), content: content.slice(0, 300), created_at: now()
  });
  return ok();
}

async function actionAnnouncementDelete(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  await db.collection("announcements").doc(event.id).remove().catch(() => {});
  return ok();
}

// ================= 冠军墙 =================

async function actionChampionGet() {
  const c = await getDoc("champion", "1");
  return ok({
    teamName: (c && c.team_name) || "", season: (c && c.season) || "",
    logo: (c && c.logo) || "", members: (c && c.members) || []
  });
}

async function actionChampionUpdate(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员可编辑冠军墙");
  await db.collection("champion").doc("1").set({
    team_name: String(event.teamName || "").slice(0, 16),
    season: String(event.season || "").slice(0, 20),
    logo: validLogo(event.logo) ? event.logo : "",
    members: Array.isArray(event.members) ? event.members.slice(0, 20).map(m => String(m).slice(0, 16)) : []
  });
  await logAction(u.sid, u.nickname, "update_champion", String(event.teamName || ""), "");
  return ok();
}

// ================= 白名单 =================

async function actionWhitelistGet() {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const cfg = await getDoc("whitelist_config", "1");
  const entries = await list("whitelist_entries");
  return ok({ enabled: !!(cfg && cfg.enabled), sids: entries.map(e => e._id) });
}

async function actionWhitelistImport(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const sids = (Array.isArray(event.sids) ? event.sids : []).filter(s => RE_SID.test(String(s)));
  let imported = 0;
  for (const sid of sids) {
    if (await getDoc("whitelist_entries", sid)) continue;
    await db.collection("whitelist_entries").doc(sid).set({ created_at: now() });
    imported++;
  }
  await logAction(u.sid, u.nickname, "import_whitelist", "", imported + " 条");
  return ok({ count: imported });
}

async function actionWhitelistClear() {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  await db.collection("whitelist_entries").remove().catch(() => {});
  await db.collection("whitelist_config").doc("1").update({ enabled: 0 }).catch(() => {});
  return ok();
}

async function actionWhitelistToggle() {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const cfg = await getDoc("whitelist_config", "1");
  const nv = cfg && cfg.enabled ? 0 : 1;
  await db.collection("whitelist_config").doc("1").set({ enabled: nv });
  return ok({ enabled: !!nv });
}

// ================= 操作日志 =================

async function actionActivityLog(event) {
  const u = await getCaller();
  if (isGuest(u) || u.role !== "admin") return fail("仅管理员");
  const limit = Math.min(parseInt(event.limit) || 200, 1000);
  const logs = await list("activity_log", null, "created_at", "desc", limit);
  return ok({ logs });
}

// ================= 通知 =================

async function actionNotificationList(event) {
  const uid = callerUid();
  if (!uid) return fail("请先登录");
  const limit = Math.min(parseInt(event.limit) || 50, 100);
  const n = await list("notifications", { to_sid: uid }, "created_at", "desc", limit);
  return ok({ notifications: n });
}

async function actionNotificationUnreadCount() {
  const uid = callerUid();
  if (!uid) return ok({ unread: 0 });
  const unread = await count("notifications", { to_sid: uid, read: 0 });
  return ok({ unread });
}

async function actionNotificationMarkRead(event) {
  const uid = callerUid();
  if (!uid) return fail("请先登录");
  if (event.id) {
    const n = await getDoc("notifications", event.id);
    if (n && n.to_sid === uid) await db.collection("notifications").doc(event.id).update({ read: 1 });
  } else {
    await db.collection("notifications").where({ to_sid: uid, read: 0 }).update({ read: 1 }).catch(() => {});
  }
  return ok();
}

// 清除已读通知（仅删除当前用户已读的）
async function actionNotificationClearRead() {
  const uid = callerUid();
  if (!uid) return fail("请先登录");
  const read = await list("notifications", { to_sid: uid, read: 1 });
  for (const n of read) {
    await db.collection("notifications").doc(n._id).remove().catch(() => {});
  }
  return ok({ cleared: read.length });
}

// ================= 入口 =================

exports.main = async (event) => {
  const action = event && event.action;
  try {
    switch (action) {
      // 认证
      case "register": return await actionRegister(event);
      case "loginVerify": return await actionLoginVerify(event);
      case "changePassword": return await actionChangePassword(event);
      case "getMe": return await actionGetMe();
      // 统计
      case "stats": return await actionStats();
      // 用户管理
      case "userList": return await actionUserList(event);
      case "userActivate": return await actionUserActivate(event);
      case "userSetRole": return await actionUserSetRole(event);
      case "userSetStatus": return await actionUserSetStatus(event);
      case "userDelete": return await actionUserDelete(event);
      // 战队
      case "teamList": return await actionTeamList();
      case "teamCreate": return await actionTeamCreate(event);
      case "teamUpdate": return await actionTeamUpdate(event);
      case "teamToggleRecruit": return await actionTeamToggleRecruit(event);
      case "teamJoin": return await actionTeamJoin(event);
      case "teamApply": return await actionTeamApply(event);
      case "teamJoinRequests": return await actionTeamJoinRequests(event);
      case "teamApproveJoin": return await actionTeamApproveJoin(event);
      case "teamRejectJoin": return await actionTeamRejectJoin(event);
      case "teamKick": return await actionTeamKick(event);
      case "teamLeave": return await actionTeamLeave(event);
      case "teamTransfer": return await actionTeamTransfer(event);
      case "adminTeamApprove": return await actionAdminTeamApprove(event);
      case "adminTeamDelete": return await actionAdminTeamDelete(event);
      // 赛事
      case "tournamentList": return await actionTournamentList();
      case "tournamentCreate": return await actionTournamentCreate(event);
      case "registrationList": return await actionRegistrationList();
      case "registrationCreate": return await actionRegistrationCreate(event);
      case "registrationApprove": return await actionRegistrationApprove(event);
      case "registrationDelete": return await actionRegistrationDelete(event);
      // 对阵
      case "matchList": return await actionMatchList(event);
      case "matchCreate": return await actionMatchCreate(event);
      case "matchSetResult": return await actionMatchSetResult(event);
      case "matchDelete": return await actionMatchDelete(event);
      // 约战
      case "challengeList": return await actionChallengeList();
      case "challengeCreate": return await actionChallengeCreate(event);
      case "challengeAccept": return await actionChallengeAccept(event);
      case "challengeReject": return await actionChallengeReject(event);
      case "challengeReportResult": return await actionChallengeReportResult(event);
      case "challengeConfirmResult": return await actionChallengeConfirmResult(event);
      case "adminChallengeApprove": return await actionAdminChallengeApprove(event);
      case "adminChallengeReject": return await actionAdminChallengeReject(event);
      // 排行榜
      case "rankings": return await actionRankings();
      // 活动
      case "activityList": return await actionActivityList();
      case "activityCreate": return await actionActivityCreate(event);
      case "activityDelete": return await actionActivityDelete(event);
      case "activityJoin": return await actionActivityJoin(event);
      case "activityLeave": return await actionActivityLeave(event);
      case "activityParticipants": return await actionActivityParticipants(event);
      // 公告
      case "announcementList": return await actionAnnouncementList();
      case "announcementCreate": return await actionAnnouncementCreate(event);
      case "announcementDelete": return await actionAnnouncementDelete(event);
      // 冠军墙
      case "championGet": return await actionChampionGet();
      case "championUpdate": return await actionChampionUpdate(event);
      // 白名单
      case "whitelistGet": return await actionWhitelistGet();
      case "whitelistImport": return await actionWhitelistImport(event);
      case "whitelistClear": return await actionWhitelistClear();
      case "whitelistToggle": return await actionWhitelistToggle();
      // 日志 / 通知
      case "activityLog": return await actionActivityLog(event);
      case "notificationList": return await actionNotificationList(event);
      case "notificationUnreadCount": return await actionNotificationUnreadCount();
      case "notificationMarkRead": return await actionNotificationMarkRead(event);
      case "notificationClearRead": return await actionNotificationClearRead();
      default: return fail("未知操作: " + action);
    }
  } catch (e) {
    console.error("cs2-api error [" + action + "]:", e && e.message || e);
    return fail("服务器开小差了，请稍后重试");
  }
};
