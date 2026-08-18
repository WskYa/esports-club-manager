// CloudBase 初始化
// envId 与 publishable key 通过 Vite 环境变量注入（见 web/.env.example，本地复制为 .env）
import cloudbase from '@cloudbase/js-sdk'

export const ENV_ID = import.meta.env.VITE_CB_ENV || ''
export const PUBLISHABLE_KEY = import.meta.env.VITE_CB_PUBLISHABLE_KEY || ''

export const app = cloudbase.init({
  env: ENV_ID,
  accessKey: PUBLISHABLE_KEY,
  auth: { detectSessionInUrl: true }
})

export const auth = app.auth
