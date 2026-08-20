<script setup>
import { ref } from 'vue'
import AppShell from '../components/AppShell.vue'
import { useAuthStore } from '../stores/auth'
import { toast } from '../toast'

const store = useAuthStore()
const pw = ref({ old: '', next: '', next2: '' })
const loading = ref(false)

const roleName = ({ admin: '管理员', captain: '队长', member: '成员' })[store.user?.role] || '成员'

async function changePw() {
  if (!pw.value.old) { toast('请输入当前密码', 'err'); return }
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pw.value.next)) { toast('新密码至少8位，含字母和数字', 'err'); return }
  if (pw.value.next !== pw.value.next2) { toast('两次输入的新密码不一致', 'err'); return }
  loading.value = true
  try {
    await store.changePassword(pw.value.old, pw.value.next)
    toast('密码修改成功')
    pw.value = { old: '', next: '', next2: '' }
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AppShell>
    <h1 class="page-title">个人中心</h1>
    <p class="page-desc">个人信息与账号安全</p>

    <div class="card profile-card">
      <h3>👤 基本信息</h3>
      <div class="info-grid">
        <div><div class="k">学号</div><div class="v">{{ store.user?.sid }}</div></div>
        <div><div class="k">身份</div><div class="v">{{ roleName }}</div></div>
        <div><div class="k">昵称</div><div class="v">{{ store.user?.nickname }}</div></div>
        <div><div class="k">学院</div><div class="v">{{ store.user?.college }}</div></div>
        <div><div class="k">实名</div><div class="v">{{ store.user?.real_name }}</div></div>
        <div><div class="k">QQ</div><div class="v">{{ store.user?.qq }}</div></div>
        <div><div class="k">账号状态</div><div class="v">{{ store.user?.status }}</div></div>
      </div>
    </div>

    <div class="card profile-card">
      <h3>🔑 修改密码</h3>
      <div class="field"><span>当前密码</span><input v-model="pw.old" type="password" autocomplete="current-password"></div>
      <div class="field"><span>新密码（至少 8 位，含字母和数字）</span><input v-model="pw.next" type="password" autocomplete="new-password" maxlength="72"></div>
      <div class="field"><span>确认新密码</span><input v-model="pw.next2" type="password" autocomplete="new-password" maxlength="72"></div>
      <button class="btn primary" :disabled="loading" @click="changePw">{{ loading ? '提交中...' : '修改密码' }}</button>
    </div>
  </AppShell>
</template>
