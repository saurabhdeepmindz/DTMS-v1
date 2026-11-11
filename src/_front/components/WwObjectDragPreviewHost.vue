<template>
    <div class="ww-drag-preview-render-host" :style="{ width: `${width}px` }" aria-hidden="true" inert>
        <wwElement :uid="uid" no-interaction />
    </div>
</template>

<script setup lang="ts">
import { provide } from 'vue';

defineProps<{
    uid: string;
    width: number;
}>();

provide('_wwIsDragPreview', true);
</script>

<style scoped lang="scss">
.ww-drag-preview-render-host {
    position: fixed;
    top: 0;
    left: -100000px;
    display: block;
    min-width: 1px;
    min-height: 1px;
    pointer-events: none;
    visibility: hidden;
}
</style>
