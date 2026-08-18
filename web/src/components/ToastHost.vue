<script setup>
import { toasts } from '../toast'
</script>

<template>
  <div id="toast-wrap">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.msg }}</div>
  </div>
</template>
