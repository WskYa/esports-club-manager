// 轻量 Toast：独立模块（非组件）
import { ref } from 'vue'

export const toasts = ref([])
let seq = 0

export function toast(msg, type = 'ok', duration = 2400) {
  const id = ++seq
  toasts.value.push({ id, msg: String(msg), type })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, duration)
}
