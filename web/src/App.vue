<script setup>
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import ToastHost from './components/ToastHost.vue'
import { useAuthStore } from './stores/auth'

const store = useAuthStore()
onMounted(async () => {
  if (!store.ready) await store.init()
  if (!store.isLoggedIn && !store.guest) {
    const { useRouter } = await import('vue-router')
    const router = useRouter()
    router.push('/auth')
  }
})
</script>

<template>
  <RouterView />
  <ToastHost />
</template>
