<template>
     <!-- wwFront:start -->
    <router-view />
    <!-- wwFront:end -->
</template>

<script>
import { reactive, computed, provide, onMounted, watch } from 'vue';

 
export default {
    setup() {
        const wwFrontState = reactive({
            lang: computed(() => wwLib.store.front.lang),
            pageId: computed(() => wwLib.store.websiteData.pageId),
            screenSize: computed(() => wwLib.store.front.activeScreenSize),
            screenSizes: computed(() => wwLib.store.front.screenSizes),
        });
        provide('wwFrontState', wwFrontState);

     },
};
</script>

<style>
 </style>
