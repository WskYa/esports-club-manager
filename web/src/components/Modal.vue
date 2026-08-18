<script setup>
defineProps({ show: Boolean })
const emit = defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-mask" @click.self="emit('close')">
      <div class="modal">
        <slot />
      </div>
    </div>
  </Teleport>
</template>
