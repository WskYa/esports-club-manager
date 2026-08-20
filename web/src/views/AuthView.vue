<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { toast } from '../toast'

const store = useAuthStore()
const router = useRouter()
const tab = ref('login')
const loading = ref(false)
const err = ref('')

const loginForm = reactive({ sid: '', password: '' })
const regForm = reactive({ sid: '', realName: '', college: '', nickname: '', qq: '', password: '', password2: '' })

const COLLEGES = ['机械与材料工程学院', '自动化学院', '电子信息工程学院', '计算机与软件工程学院', '建筑工程学院', '化学工程学院', '生命科学与食品工程学院', '农学院', '交通工程学院', '管理工程学院', '商学院', '数理学院', '人文与社会科学学院', '外国语学院', '设计艺术学院', '特拉华学院', '郑和学院', '国际教育学院', '创新创业学院', '工程训练中心', '翔宇学院', '马克思主义学院', '体育部']

async function doLogin() {
  err.value = ''
  if (!/^\d{10,12}$/.test(loginForm.sid) || !loginForm.password) { err.value = '请输入正确的学号和密码'; return }
  loading.value = true
  try {
    await store.login(loginForm.sid.trim(), loginForm.password)
    toast('登录成功')
    router.push('/')
  } catch (e) {
    err.value = e.message
  } finally {
    loading.value = false
  }
}

async function doRegister() {
  err.value = ''
  const f = regForm
  if (!/^\d{10,12}$/.test(f.sid)) { err.value = '学号须为10-12位数字'; return }
  if (!/^[\u4e00-\u9fa5]{2,10}$/.test(f.realName)) { err.value = '实名须为2-10位中文'; return }
  if (!f.college) { err.value = '请选择学院'; return }
  if (f.nickname.length < 2 || f.nickname.length > 16) { err.value = '昵称须为2-16字符'; return }
  if (!/^\d{5,12}$/.test(f.qq)) { err.value = 'QQ号格式不正确'; return }
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(f.password)) { err.value = '密码至少8位，含字母和数字'; return }
  if (f.password !== f.password2) { err.value = '两次输入的密码不一致'; return }
  loading.value = true
  try {
    await store.register({ ...f })
    toast('注册成功，请等待管理员激活')
    tab.value = 'login'
  } catch (e) {
    err.value = e.message
  } finally {
    loading.value = false
  }
}

async function guestLogin() {
  loading.value = true
  try {
    await store.guestLogin()
    toast('游客模式，仅可浏览')
    router.push('/')
  } catch (e) {
    err.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">
        <img class="logo" src="/logo.jpg" alt="HAU CS2">
        <h1>HAU CS2</h1>
        <p>淮安大学 CS2 电竞社团 · 内部管理系统</p>
      </div>

      <div class="auth-tabs">
        <button class="auth-tab" :class="{ active: tab === 'login' }" @click="tab = 'login'">登 录</button>
        <button class="auth-tab" :class="{ active: tab === 'register' }" @click="tab = 'register'">注 册</button>
      </div>

      <form v-if="tab === 'login'" @submit.prevent="doLogin">
        <div class="field">
          <span>学号</span>
          <input v-model.trim="loginForm.sid" placeholder="10-12 位学号" autocomplete="username">
        </div>
        <div class="field">
          <span>密码</span>
          <input v-model="loginForm.password" type="password" placeholder="输入密码" autocomplete="current-password">
        </div>
        <p class="err-text">{{ err }}</p>
        <button class="btn primary full" type="submit" :disabled="loading">{{ loading ? '登录中...' : '登 录' }}</button>
      </form>

      <form v-else @submit.prevent="doRegister">
        <div class="field">
          <span>学号（即登录账号）</span>
          <input v-model.trim="regForm.sid" placeholder="10-12 位数字">
        </div>
        <div class="field">
          <span>实名（仅存储，不公开）</span>
          <input v-model.trim="regForm.realName" placeholder="中文姓名">
        </div>
        <div class="field">
          <span>学院</span>
          <select v-model="regForm.college">
            <option value="">请选择</option>
            <option v-for="c in COLLEGES" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="field">
          <span>游戏昵称（公开身份）</span>
          <input v-model.trim="regForm.nickname" placeholder="2-16 个字符" maxlength="16">
        </div>
        <div class="field">
          <span>QQ 号</span>
          <input v-model.trim="regForm.qq" placeholder="5-12 位数字">
        </div>
        <div class="field">
          <span>密码（至少 8 位，含字母和数字）</span>
          <input v-model="regForm.password" type="password" placeholder="设置密码">
        </div>
        <div class="field">
          <span>确认密码</span>
          <input v-model="regForm.password2" type="password" placeholder="再次输入">
        </div>
        <p class="err-text">{{ err }}</p>
        <button class="btn primary full" type="submit" :disabled="loading">{{ loading ? '提交中...' : '注 册' }}</button>
      </form>

      <div class="auth-divider">或</div>
      <button class="btn full" @click="guestLogin" :disabled="loading">👤 游客浏览</button>
    </div>
  </div>
</template>
